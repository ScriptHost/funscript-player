'use strict';

// ===========================================================================
// 🛠️ Script-Werkzeuge – rechnen das Script beim Abspielen um, Dateien bleiben unverändert.
//   Presets:  Original · Automatisch · Sanft · Intensiv · Eigene (Haken unten)
//   Automatisch prüft jedes Script und ändert nur, was nötig ist:
//     Zittern (winzige Bewegungen < 3 %) entfernen, zu kleinen Hub strecken,
//     physisch zu schnelle Stellen kürzen, bei stark schwankendem Tempo den Satisfyer beruhigen.
//   Preset gilt als Standard und lässt sich pro Szene ändern (wird wie der Offset gemerkt).
//   Takt einmessen:  im Takt der Stöße tippen -> Offset für diese Szene berechnen
// Ergebnis wird zwischengespeichert (Vibrator fragt ~16× pro Sekunde nach).
// ===========================================================================

const tools = Object.assign({ stretch: false, limit: false, maxSpeed: 400 }, store.get('scriptTools', {}));
let toolCache = { src: null, key: '', actions: null, info: '', even: 0 };

const SCRIPT_PRESETS = { original: 'Original', auto: 'Automatisch', soft: 'Sanft', intense: 'Intensiv', custom: 'Eigene' };
// Wer schon eigene Haken gesetzt hatte, bleibt bei „Eigene“; alle anderen starten mit „Automatisch“
let presetDefault = store.get('scriptPreset', tools.stretch || tools.limit ? 'custom' : 'auto');
let localPreset = null; // Szene ohne festen Schlüssel (lokale Datei): nur bis zum nächsten Video

function currentPreset() {
  const k = offsetKey();
  if (!k) return localPreset || presetDefault;
  return store.get('scenePresets', {})[k] || presetDefault;
}

// Kennzahlen eines Scripts. Der Hub zählt ohne die äußersten 2 % (einzelne Ausreißer)
function analyzeScript(a) {
  if (!a || a.length < 3) return null;
  const pos = a.map((x) => x.pos).sort((x, y) => x - y);
  const lo = pos[Math.floor(pos.length * 0.02)];
  const hi = pos[Math.ceil(pos.length * 0.98) - 1];
  const speeds = [];
  let segs = 0, jitter = 0;
  for (let i = 1; i < a.length; i++) {
    const dt = a[i].at - a[i - 1].at;
    const d = Math.abs(a[i].pos - a[i - 1].pos);
    if (dt <= 0) continue;
    segs++;
    if (d > 0 && d < 3) jitter++;
    if (d > 0) speeds.push((d / dt) * 1000);
  }
  const mean = speeds.reduce((s, v) => s + v, 0) / (speeds.length || 1);
  const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / (speeds.length || 1));
  return { lo, hi, segs, jitter, cv: mean ? sd / mean : 0 };
}

// Winzige Bewegungen (0 < Änderung < 3 %) weglassen – sie lassen die Handy nur rattern.
// Haltepunkte (Änderung 0) bleiben, damit Pausen erhalten bleiben.
function removeJitter(a) {
  const out = [a[0]];
  let removed = 0;
  for (let i = 1; i < a.length; i++) {
    const d = Math.abs(a[i].pos - out[out.length - 1].pos);
    if (d > 0 && d < 3 && i < a.length - 1) { removed++; continue; }
    out.push(a[i]);
  }
  return { actions: out, removed };
}

function stretchRange(a, lo, hi) {
  return a.map((x) => ({ at: x.at, pos: Math.max(0, Math.min(100, Math.round(((x.pos - lo) / (hi - lo)) * 100))) }));
}

// Bewegungen schneller als maxSpeed (%/s) auf das Machbare kürzen.
// Erst wird jeder zu schnelle Punkt zur Mitte (50 %) hin verkleinert – so bleiben schnelle
// Stöße mittig (z. B. 23–77 %) statt nach unten zu rutschen. Ein zweiter Durchgang
// garantiert, dass danach keine Bewegung mehr zu schnell ist.
function limitSpeed(a, maxSpeed) {
  let changed = 0;
  const scaled = a.map((x, i) => {
    let k = 1;
    for (const y of [a[i - 1], a[i + 1]]) {
      const d = y ? Math.abs(x.pos - y.pos) : 0;
      if (d > 0) k = Math.min(k, (maxSpeed * Math.max(1, Math.abs(x.at - y.at))) / 1000 / d);
    }
    if (k >= 1) return x;
    changed++;
    return { at: x.at, pos: Math.round(50 + (x.pos - 50) * k) };
  });
  const res = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) {
    const prev = res[res.length - 1];
    const maxStep = (maxSpeed * Math.max(1, scaled[i].at - prev.at)) / 1000;
    const d = scaled[i].pos - prev.pos;
    if (Math.abs(d) > maxStep) {
      res.push({ at: scaled[i].at, pos: Math.round(prev.pos + Math.sign(d) * maxStep) });
      changed++;
    } else {
      res.push(scaled[i]);
    }
  }
  return { actions: res, changed };
}

function processScript(actions) {
  if (!actions) return actions;
  const preset = currentPreset();
  const key = `${preset}|${tools.stretch}|${tools.limit}|${tools.maxSpeed}`;
  if (toolCache.src === actions && toolCache.key === key) return toolCache.actions;
  let out = actions;
  const notes = [];
  let even = 0; // zusätzliche Gleichmäßigkeit für den Satisfyer (0–1)

  if (preset === 'custom') {
    if (tools.stretch) {
      let min = 100, max = 0;
      for (const a of out) { if (a.pos < min) min = a.pos; if (a.pos > max) max = a.pos; }
      if (max - min >= 5 && max - min < 90) {
        out = stretchRange(out, min, max);
        notes.push(`Hub ${min}–${max} → 0–100 gestreckt`);
      } else notes.push('Hub nutzt schon fast den ganzen Bereich');
    }
    if (tools.limit) {
      const r = limitSpeed(out, tools.maxSpeed);
      out = r.actions;
      notes.push(r.changed ? `${r.changed} zu schnelle Stellen geglättet` : 'keine zu schnellen Stellen');
    }
  } else if (preset !== 'original') {
    const s = analyzeScript(out);
    if (s) {
      // Zittern: Automatisch erst ab 5 % der Bewegungen, Sanft/Intensiv immer
      if (preset !== 'auto' || s.jitter / s.segs > 0.05) {
        const r = removeJitter(out);
        if (r.removed) { out = r.actions; notes.push(`${r.removed} Zitterpunkte entfernt`); }
      }
      // Hub: Automatisch streckt, wenn weniger als 70 % genutzt werden, Intensiv schon unter 90 %
      const range = s.hi - s.lo;
      if (range >= 5 && ((preset === 'auto' && range < 70) || (preset === 'intense' && range < 90))) {
        out = stretchRange(out, s.lo, s.hi);
        notes.push(`Hub ${s.lo}–${s.hi} → 0–100 gestreckt`);
      }
      // Sanft: jedes Script auf 15–85 % bringen (flache werden nicht noch flacher)
      if (preset === 'soft' && range >= 5) {
        out = stretchRange(out, s.lo, s.hi).map((x) => ({ at: x.at, pos: Math.round(15 + x.pos * 0.7) }));
        notes.push(`Hub ${s.lo}–${s.hi} → 15–85 %`);
      }
      // Tempo: was die Handy nicht schafft, kürzen (nach dem Strecken, das macht Bewegungen schneller)
      const r = limitSpeed(out, preset === 'soft' ? 300 : preset === 'intense' ? 500 : 450);
      if (r.changed) { out = r.actions; notes.push(`${r.changed} zu schnelle Stellen geglättet`); }
      // Satisfyer: bei stark schwankendem Tempo ruhiger, bei Sanft immer
      even = preset === 'soft' ? 0.5 : preset === 'auto' && s.cv > 0.7 ? 0.3 : 0;
      if (even) notes.push('Satisfyer ruhiger');
    }
  }

  const info = notes.join(' · ') || (preset === 'original' ? 'unverändert' : 'Script passt, nichts geändert');
  toolCache = { src: actions, key, actions: out, info: `${SCRIPT_PRESETS[preset]}: ${info}`, even };
  return out;
}

// Gleichmäßigkeit, die das Preset für das laufende Video-Script vorgibt (vibe.js)
function presetVibeEven() {
  return script && toolCache.src === script.actions ? toolCache.even : 0;
}

function toolsChanged() {
  store.set('scriptTools', tools);
  $('toolMaxRow').hidden = !tools.limit;
  $('tool_maxSpeedVal').textContent = `${tools.maxSpeed} %/s`;
  document.querySelectorAll('#presetDefault button').forEach((b) => b.classList.toggle('active', b.dataset.preset === presetDefault));
  $('toolCustom').hidden = presetDefault !== 'custom' && currentPreset() !== 'custom';
  if (script) processScript(script.actions);
  $('toolInfo').textContent = script ? `Aktuelles Video – ${toolCache.info}` : '';
  $('presetRow').hidden = !script;
  $('scenePreset').value = currentPreset();
  $('presetInfo').textContent = script ? toolCache.info.replace(/^[^:]+: /, '') : '';
  drawHeatmap();
  if (handy.owner === 'video') resync(); // geändertes Script sofort an die Handy
}

// Standard-Preset (Einstellungen) und Preset dieser Szene (unter dem Video)
document.querySelectorAll('#presetDefault button').forEach((b) => b.addEventListener('click', () => {
  presetDefault = b.dataset.preset;
  store.set('scriptPreset', presetDefault);
  toolsChanged();
}));
$('scenePreset').addEventListener('change', () => {
  const v = $('scenePreset').value;
  const k = offsetKey();
  if (!k) localPreset = v;
  else {
    const map = store.get('scenePresets', {});
    if (v === presetDefault) delete map[k]; else map[k] = v;
    store.set('scenePresets', map);
  }
  toolsChanged();
  log(`Script-Anpassung für diese Szene: ${SCRIPT_PRESETS[v]}.`);
});
video.addEventListener('emptied', () => { localPreset = null; });

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
