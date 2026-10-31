'use strict';

// ===========================================================================
// 🛠️ Script-Werkzeuge – rechnen das Script beim Abspielen um, Dateien bleiben unverändert.
//   Hub strecken:   genutzten Bereich (z. B. 30–70) auf 0–100 dehnen
//   Spitzen glätten: Bewegungen schneller als die Höchstgeschwindigkeit sanft kürzen
//   Takt einmessen:  im Takt der Stöße tippen -> Offset für diese Szene berechnen
// Ergebnis wird zwischengespeichert (Vibrator fragt ~16× pro Sekunde nach).
// ===========================================================================

const tools = Object.assign({ stretch: false, limit: false, maxSpeed: 400 }, store.get('scriptTools', {}));
let toolCache = { src: null, key: '', actions: null, info: '' };

function processScript(actions) {
  if (!actions) return actions;
  const key = `${tools.stretch}|${tools.limit}|${tools.maxSpeed}`;
  if (toolCache.src === actions && toolCache.key === key) return toolCache.actions;
  let out = actions;
  const notes = [];

  if (tools.stretch) {
    let min = 100, max = 0;
    for (const a of out) { if (a.pos < min) min = a.pos; if (a.pos > max) max = a.pos; }
    if (max - min >= 5 && max - min < 90) {
      out = out.map((a) => ({ at: a.at, pos: Math.round(((a.pos - min) / (max - min)) * 100) }));
      notes.push(`Hub ${min}–${max} → 0–100 gestreckt`);
    } else {
      notes.push('Hub nutzt schon fast den ganzen Bereich');
    }
  }

  if (tools.limit) {
    const res = [out[0]];
    let changed = 0;
    for (let i = 1; i < out.length; i++) {
      const prev = res[res.length - 1];
      const dt = out[i].at - prev.at;
      const maxStep = (tools.maxSpeed * Math.max(1, dt)) / 1000;
      const d = out[i].pos - prev.pos;
      if (Math.abs(d) > maxStep) {
        res.push({ at: out[i].at, pos: Math.round(prev.pos + Math.sign(d) * maxStep) });
        changed++;
      } else {
        res.push(out[i]);
      }
    }
    out = res;
    notes.push(changed ? `${changed} zu schnelle Stellen geglättet` : 'keine zu schnellen Stellen');
  }

  toolCache = { src: actions, key, actions: out, info: notes.join(' · ') };
  return out;
}

function toolsChanged() {
  store.set('scriptTools', tools);
  $('toolMaxRow').hidden = !tools.limit;
  $('tool_maxSpeedVal').textContent = `${tools.maxSpeed} %/s`;
  if (script) processScript(script.actions);
  $('toolInfo').textContent = script && (tools.stretch || tools.limit) ? `Aktuelles Video: ${toolCache.info}` : '';
  drawHeatmap();
  if (handy.owner === 'video') resync(); // geändertes Script sofort an die Handy
}

$('tool_stretch').checked = tools.stretch;
$('tool_limit').checked = tools.limit;
$('tool_maxSpeed').value = tools.maxSpeed;
$('tool_stretch').addEventListener('change', () => { tools.stretch = $('tool_stretch').checked; toolsChanged(); });
$('tool_limit').addEventListener('change', () => { tools.limit = $('tool_limit').checked; toolsChanged(); });
$('tool_maxSpeed').addEventListener('input', () => { tools.maxSpeed = Number($('tool_maxSpeed').value); $('tool_maxSpeedVal').textContent = `${tools.maxSpeed} %/s`; });
$('tool_maxSpeed').addEventListener('change', toolsChanged);
toolsChanged();

// ---------------------------------------------------------------------------
// 🎯 Offset per Takt einmessen
//   Während das Video läuft, bei jedem sichtbaren Stoß „nach unten“ tippen (Knopf oder T).
//   Nach 8 Tipps: Abstand zum nächsten Tiefpunkt im Script, Median -> Offset (pro Szene).
//   Positiv = Script kommt später als das Bild -> Handy früher starten.
// ---------------------------------------------------------------------------
const CALIB_TAPS = 8;
let calib = null; // { diffs: [], last }

function scriptBottoms() {
  const a = toolActions();
  const out = [];
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i].pos <= a[i - 1].pos && a[i].pos < a[i + 1].pos) out.push(a[i].at);
  }
  return out;
}

function calibTap() {
  if (!script) return log('Für das Einmessen muss ein Video mit Script laufen.', true);
  if (video.paused) return log('Bitte das Video starten und dann im Takt tippen.', true);
  const now = Date.now();
  if (!calib || now - calib.last > 8000) {
    calib = { diffs: [], last: now, bottoms: scriptBottoms() };
    if (!calib.bottoms.length) { calib = null; return log('Im Script wurden keine Stöße gefunden.', true); }
  }
  calib.last = now;
  // Was du siehst, ist mediaTime – der aktuelle Offset spielt für die Messung keine Rolle
  const t = mediaTime() * 1000;
  let best = null;
  for (const b of calib.bottoms) if (best === null || Math.abs(b - t) < Math.abs(best - t)) best = b;
  if (best !== null && Math.abs(best - t) < 700) calib.diffs.push(best - t);
  const n = calib.diffs.length;
  $('calibBtn').textContent = `🎯 Weiter tippen … ${n}/${CALIB_TAPS}`;
  if (n < CALIB_TAPS) return;
  const sorted = [...calib.diffs].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const offset = Math.max(-500, Math.min(500, Math.round(median / 10) * 10));
  $('offset').value = offset;
  $('offset').dispatchEvent(new Event('input'));
  $('offset').dispatchEvent(new Event('change')); // speichert für diese Szene und synchronisiert neu
  $('calibBtn').textContent = '🎯 Offset per Takt einmessen';
  log(`🎯 Offset eingemessen: ${offset} ms (für diese Szene gespeichert).`);
  calib = null;
}
$('calibBtn').addEventListener('click', calibTap);
document.addEventListener('keydown', (e) => {
  if (e.key === 't' && document.body.dataset.view === 'player' && !e.target.closest('input, select, textarea')) calibTap();
});
