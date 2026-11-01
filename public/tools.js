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

// tooFast: 'shorten' = Hub kürzen, 'half' = voller Hub, dort halbes Tempo
const tools = Object.assign({ stretch: false, limit: false, maxSpeed: 400, tooFast: 'shorten' }, store.get('scriptTools', {}));
let toolCache = { handy: null, vibe: null };

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
// changed = Zahl der Stöße, die spürbar (≥ 3 %) kürzer werden – jeder Punkt zählt nur einmal.
function limitSpeed(a, maxSpeed) {
  const scaled = a.map((x, i) => {
    let k = 1;
    for (const y of [a[i - 1], a[i + 1]]) {
      const d = y ? Math.abs(x.pos - y.pos) : 0;
      if (d > 0) k = Math.min(k, (maxSpeed * Math.max(1, Math.abs(x.at - y.at))) / 1000 / d);
    }
    return k >= 1 ? x : { at: x.at, pos: Math.round(50 + (x.pos - 50) * k) };
  });
  const res = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) {
    const prev = res[res.length - 1];
    const maxStep = (maxSpeed * Math.max(1, scaled[i].at - prev.at)) / 1000;
    const d = scaled[i].pos - prev.pos;
    res.push(Math.abs(d) > maxStep ? { at: scaled[i].at, pos: Math.round(prev.pos + Math.sign(d) * maxStep) } : scaled[i]);
  }
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(res[i].pos - a[i].pos) >= 3) changed++;
  return { actions: res, changed };
}

// „Voller Hub, halbes Tempo“: An Stellen, die zu schnell sind, fällt jeder zweite Stoß weg
// (Hin- und Rückweg werden zu einem doppelt so langen) – der volle Hub bleibt, der Takt auch.
// Was danach noch zu schnell ist, kürzt limitSpeed wie gewohnt.
function halveFast(a, maxSpeed) {
  const fast = (x, y) => (Math.abs(y.pos - x.pos) / Math.max(1, y.at - x.at)) * 1000 > maxSpeed;
  const out = [a[0]];
  let halved = 0;
  for (let i = 1; i < a.length; i++) {
    const p = out[out.length - 1];
    if (i + 1 < a.length && fast(a[i - 1], a[i])) {
      // Zwei Bewegungen werden eine über die doppelte Zeit: Ziel ist der weiter entfernte der beiden Punkte
      const t = Math.abs(a[i].pos - p.pos) >= Math.abs(a[i + 1].pos - p.pos) ? a[i] : a[i + 1];
      out.push({ at: a[i + 1].at, pos: t.pos });
      i++;
      halved++;
    } else {
      out.push(a[i]);
    }
  }
  return { actions: out, halved };
}

const handyMaxSpeedSafe = () => (typeof handyMaxSpeed === 'function' ? handyMaxSpeed() : 450);
// Zu schnelle Stellen: je nach ⚙️ → Script erst halbieren (voller Hub) oder gleich kürzen
function fitHandy(out, maxSpeed, only) {
  if (tools.tooFast === 'half') {
    const h = halveFast(out, maxSpeed);
    out = h.actions;
    if (h.halved) only.push(`${h.halved}× halbes Tempo (voller Hub)`);
  }
  const r = limitSpeed(out, maxSpeed);
  if (r.changed) only.push(`${r.changed} von ${out.length} Stößen etwas kürzer`);
  return r.changed ? r.actions : out;
}

// target = 'handy' oder 'vibe': Die Handy bekommt Kürzungen auf das, was sie physisch schafft;
// der Satisfyer hat keine Tempo-Grenze und bekommt das Script ungekürzt (dafür ggf. ruhiger).
function processScript(actions, target = 'handy') {
  if (!actions) return actions;
  const preset = currentPreset();
  const key = `${preset}|${tools.stretch}|${tools.limit}|${tools.maxSpeed}|${tools.tooFast}|${handyMaxSpeedSafe()}`;
  const hit = toolCache[target];
  if (hit && hit.src === actions && hit.key === key) return hit.actions;
  let out = actions;
  const notes = [];      // gilt für beide Geräte
  const only = [];       // nur für dieses Gerät
  let even = 0;          // zusätzliche Gleichmäßigkeit für den Satisfyer (0–1)

  if (preset === 'custom') {
    if (tools.stretch) {
      let min = 100, max = 0;
      for (const a of out) { if (a.pos < min) min = a.pos; if (a.pos > max) max = a.pos; }
      if (max - min >= 5 && max - min < 90) {
        out = stretchRange(out, min, max);
        notes.push(`Hub ${min}–${max} → 0–100 gestreckt`);
      }
    }
    if (tools.limit && target === 'handy') out = fitHandy(out, tools.maxSpeed, only);
  } else if (preset !== 'original') {
    const st = analyzeScript(out);
    if (st) {
      if (preset !== 'auto' || st.jitter / st.segs > 0.05) {
        const r = removeJitter(out);
        if (r.removed) { out = r.actions; notes.push(`${r.removed} Zitterpunkte entfernt`); }
      }
      const range = st.hi - st.lo;
      if (range >= 5 && ((preset === 'auto' && range < 70) || (preset === 'intense' && range < 90))) {
        out = stretchRange(out, st.lo, st.hi);
        notes.push(`Hub ${st.lo}–${st.hi} → 0–100 gestreckt`);
      }
      if (preset === 'soft' && range >= 5) {
        out = stretchRange(out, st.lo, st.hi).map((x) => ({ at: x.at, pos: Math.round(15 + x.pos * 0.7) }));
        notes.push(`Hub ${st.lo}–${st.hi} → 15–85 %`);
      }
      if (target === 'handy') {
        // Was die Handy nicht schafft, anpassen (nach dem Strecken – das macht Bewegungen schneller).
        // Grenze nach Modell / ⚙️ → Geräte; „Sanft“ bleibt darunter, „Intensiv“ etwas darüber.
        const max = handyMaxSpeedSafe();
        out = fitHandy(out, preset === 'soft' ? Math.min(300, max) : preset === 'intense' ? max + 50 : max, only);
      } else {
        even = preset === 'soft' ? 0.5 : preset === 'auto' && st.cv > 0.7 ? 0.3 : 0;
        if (even) only.push('ruhiger');
      }
    }
  }
  toolCache[target] = { src: actions, key, actions: out, notes, only, even, preset };
  return out;
}

// Info-Zeile: Gemeinsames + was für die VERBUNDENEN Geräte gilt (ohne Gerät: beides)
function presetInfoText() {
  if (!script) return '';
  const h = processScript(script.actions, 'handy') && toolCache.handy;
  const v = processScript(script.actions, 'vibe') && toolCache.vibe;
  const anyDev = typeof hasHandy === 'function' && (hasHandy() || hasVibe());
  const showH = !anyDev || hasHandy(), showV = !anyDev || hasVibe();
  const parts = [...h.notes];
  if (showH && h.only.length) parts.push(`Handy: ${h.only.join(', ')}`);
  if (showV && v.only.length) parts.push(`Satisfyer: ${v.only.join(', ')}`);
  return parts.join(' · ') || (h.preset === 'original' ? 'unverändert' : 'Script passt, nichts geändert');
}

// Gleichmäßigkeit, die das Preset für das laufende Video-Script vorgibt (vibe.js)
function presetVibeEven() {
  return script && toolCache.vibe?.src === script.actions ? toolCache.vibe.even : 0;
}

function toolsChanged() {
  store.set('scriptTools', tools);
  $('toolMaxRow').hidden = !tools.limit;
  $('tool_maxSpeedVal').textContent = `${tools.maxSpeed} %/s`;
  document.querySelectorAll('#presetDefault button').forEach((b) => b.classList.toggle('active', b.dataset.preset === presetDefault));
  $('toolCustom').hidden = presetDefault !== 'custom' && currentPreset() !== 'custom';
  if (script) processScript(script.actions);
  $('toolInfo').textContent = script ? `Aktuelles Video – ${SCRIPT_PRESETS[currentPreset()]}: ${presetInfoText()}` : '';
  $('presetRow').hidden = !script;
  $('scenePreset').value = currentPreset();
  $('presetInfo').textContent = presetInfoText();
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
$('tooFast').value = tools.tooFast;
$('tooFast').addEventListener('change', () => { tools.tooFast = $('tooFast').value; toolsChanged(); });

// Höchsttempo der Handy (⚙️ → Geräte): automatisch nach erkanntem Modell oder von Hand
function showHandyMax() {
  const auto = store.get('handyMaxAuto', true);
  $('handyMaxAuto').checked = auto;
  $('handyMax').value = handyMaxSpeed();
  $('handyMax').disabled = auto;
  $('handyMaxVal').textContent = `${handyMaxSpeed()} %/s`;
  $('handyModelInfo').textContent = handy.modelName ? `– erkannt: ${handy.modelName}` : '– Modell wird beim Verbinden erkannt';
}
$('handyMaxAuto').addEventListener('change', () => {
  store.set('handyMaxAuto', $('handyMaxAuto').checked);
  if (!$('handyMaxAuto').checked) store.set('handyMax', handyMaxSpeed());
  showHandyMax();
  toolsChanged();
});
$('handyMax').addEventListener('input', () => { $('handyMaxVal').textContent = `${$('handyMax').value} %/s`; });
$('handyMax').addEventListener('change', () => { store.set('handyMax', Number($('handyMax').value)); showHandyMax(); toolsChanged(); });
document.addEventListener('handy-info', () => { showHandyMax(); toolsChanged(); });
showHandyMax();
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
