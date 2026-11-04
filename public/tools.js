'use strict';

// ===========================================================================
// 🛠️ Script-Intensität – rechnet das Script beim Abspielen um, Dateien bleiben unverändert.
//   Seit 1.19.3 eine Auswahl für Handy und Satisfyer:
//     Original     – genau die Datei, nichts geändert
//     Automatisch  – kleinen Hub strecken, was die Handy nicht schafft anpassen (Takt-Schutz)
//     Sanft        – kleinerer Hub (20–80 %), langsamer, Satisfyer schwächer und ruhiger
//     Intensiv     – voller Hub, ruhige Stellen im doppelten/dreifachen Takt, Satisfyer stärker
//   Standard unter ⚙️ → Script, pro Szene am Video (wird wie der Offset gemerkt).
//   Takt einmessen:  im Takt der Stöße tippen -> Offset für diese Szene berechnen
// Ergebnis wird zwischengespeichert (Vibrator fragt ~16× pro Sekunde nach).
// ===========================================================================

// tooFast: 'shorten' = Hub kürzen, 'half' = voller Hub, dort halbes Tempo
const tools = Object.assign({ tooFast: 'shorten' }, store.get('scriptTools', {}));
let toolCache = {};

const SCRIPT_PRESETS = { original: 'Original', auto: 'Automatisch', soft: 'Sanft', intense: 'Intensiv' };
// 1.19.3: nur noch eine Auswahl für beide Geräte. Alte Werte („Original + Takt-Schutz“, „Eigene“) -> Automatisch
const presetFix = (p) => (SCRIPT_PRESETS[p] ? p : 'auto');
// Neuer Schlüssel „scriptIntensity“: die Umstellung läuft nur einmal (auf dem ersten Gerät), weil sie
// gemeinsam gespeichert wird – ein zweites Gerät überschreibt danach nichts mehr.
if (store.get('scriptIntensity', null) === null) {
  store.set('scriptIntensity', presetFix(store.get('scriptPresetHandy', 'auto')));
  const map = store.get('scenePresets', {});
  for (const k of Object.keys(map)) {
    if (typeof map[k] === 'string' && SCRIPT_PRESETS[map[k]]) continue;
    const v = typeof map[k] === 'string' ? map[k] : map[k]?.handy || map[k]?.vibe;
    if (SCRIPT_PRESETS[v]) map[k] = v; else delete map[k];
  }
  store.set('scenePresets', map);
}
if (store.get('scriptPresetHandy', undefined) !== undefined) store.del('scriptPresetHandy'); // umgestellt – alter Schlüssel weg
let presetDefault = presetFix(store.get('scriptIntensity', 'auto'));
let localPreset = null; // Szene ohne festen Schlüssel (lokale Datei): nur bis zum nächsten Video

// Preset dieser Szene (gilt für Handy und Satisfyer)
function currentPreset() {
  const k = offsetKey();
  if (!k) return localPreset || presetDefault;
  const p = store.get('scenePresets', {})[k];
  return typeof p === 'string' && SCRIPT_PRESETS[p] ? p : presetDefault;
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

// Kleine, schnelle Bewegungen (Hub bis VIB_AMP %) sind „Vibrationen“ im Script: Die bleiben für die
// Handy immer erhalten – sie fährt sie, so gut ihr Motor kann; den Takt gefährden sie nicht.
const VIB_AMP = 20;

// Große Stöße schneller als maxSpeed (%/s) auf das Machbare kürzen – um die Mitte DIESES Stoßes
// (ein Stoß oben bleibt oben). Ein zweiter Durchgang garantiert, dass danach kein großer Stoß mehr
// zu schnell ist. changed = Stöße, die spürbar (≥ 3 %) kürzer werden; marks = deren Zeiten (Heatmap).
function limitSpeed(a, maxSpeed) {
  const scaled = a.map((x, i) => {
    let k = 1, lo = x.pos, hi = x.pos;
    for (const y of [a[i - 1], a[i + 1]]) {
      const d = y ? Math.abs(x.pos - y.pos) : 0;
      if (d <= VIB_AMP) continue; // Vibration oder Halt: unangetastet
      k = Math.min(k, (maxSpeed * Math.max(1, Math.abs(x.at - y.at))) / 1000 / d);
      lo = Math.min(lo, y.pos);
      hi = Math.max(hi, y.pos);
    }
    if (k >= 1) return x;
    const mid = (lo + hi) / 2;
    return { at: x.at, pos: Math.round(mid + (x.pos - mid) * k) };
  });
  const res = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) {
    const prev = res[res.length - 1];
    const maxStep = (maxSpeed * Math.max(1, scaled[i].at - prev.at)) / 1000;
    const d = scaled[i].pos - prev.pos;
    res.push(Math.abs(d) > maxStep && Math.abs(d) > VIB_AMP ? { at: scaled[i].at, pos: Math.round(prev.pos + Math.sign(d) * maxStep) } : scaled[i]);
  }
  const marks = [];
  for (let i = 0; i < a.length; i++) if (Math.abs(res[i].pos - a[i].pos) >= 3) marks.push(a[i].at);
  return { actions: res, changed: marks.length, marks };
}

// „Voller Hub, halbes Tempo“: An Stellen, die zu schnell sind, fällt jeder zweite Stoß weg
// (Hin- und Rückweg werden zu einem doppelt so langen) – der volle Hub bleibt, der Takt auch.
// Vibrationen (kleiner Hub) bleiben. Was danach noch zu schnell ist, kürzt limitSpeed wie gewohnt.
function halveFast(a, maxSpeed) {
  const fast = (x, y) => Math.abs(y.pos - x.pos) > VIB_AMP && (Math.abs(y.pos - x.pos) / Math.max(1, y.at - x.at)) * 1000 > maxSpeed;
  const out = [a[0]];
  const marks = [];
  for (let i = 1; i < a.length; i++) {
    const p = out[out.length - 1];
    if (i + 1 < a.length && fast(a[i - 1], a[i])) {
      // Zwei Bewegungen werden eine über die doppelte Zeit: Ziel ist der weiter entfernte der beiden Punkte
      const t = Math.abs(a[i].pos - p.pos) >= Math.abs(a[i + 1].pos - p.pos) ? a[i] : a[i + 1];
      out.push({ at: a[i + 1].at, pos: t.pos });
      marks.push(a[i].at);
      i++;
    } else {
      out.push(a[i]);
    }
  }
  return { actions: out, halved: marks.length, marks };
}

const handyMaxSpeedSafe = () => (typeof handyMaxSpeed === 'function' ? handyMaxSpeed() : 450);
// Zu schnelle Stellen: je nach ⚙️ → Script erst halbieren (voller Hub) oder gleich kürzen.
// res.marks sammelt die Zeiten der angepassten Stellen (Striche in der Heatmap).
function fitHandy(out, maxSpeed, only, res) {
  if (tools.tooFast === 'half') {
    const h = halveFast(out, maxSpeed);
    out = h.actions;
    res.marks.push(...h.marks);
    if (h.halved) only.push(`${h.halved}× halbes Tempo (voller Hub)`);
  }
  const r = limitSpeed(out, maxSpeed);
  res.marks.push(...r.marks);
  if (r.changed) only.push(`${r.changed} von ${out.length} Stößen etwas kürzer`);
  return r.changed ? r.actions : out;
}

// „Intensiv“: ruhige Stellen im mehrfachen Takt – aus einer langsamen Bewegung A→B wird A→B→A→B
// (dreifaches Tempo) bzw. bei mittlerem Tempo A→B→Mitte→B (doppelt). Nur wo das Ergebnis noch
// unter dem Höchsttempo bleibt; Vibrationen (kleiner Hub) und Pausen bleiben.
function multiplyCalm(a, maxSpeed) {
  const out = [a[0]];
  let added = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1], x = a[i];
    const dt = x.at - p.at, d = Math.abs(x.pos - p.pos);
    const speed = dt > 0 ? (d / dt) * 1000 : 0;
    if (d > VIB_AMP && dt >= 450 && speed * 3 <= maxSpeed * 0.9) {
      out.push({ at: Math.round(p.at + dt / 3), pos: x.pos }, { at: Math.round(p.at + (2 * dt) / 3), pos: p.pos });
      added++;
    } else if (d > VIB_AMP && dt >= 350 && speed * 2 <= maxSpeed * 0.9) {
      out.push({ at: Math.round(p.at + dt / 2), pos: x.pos }, { at: Math.round(p.at + (3 * dt) / 4), pos: Math.round((p.pos + x.pos) / 2) });
      added++;
    }
    out.push(x);
  }
  return { actions: out, added };
}
// Hub um die Mitte skalieren (Sanft: kleiner)
const scaleAround = (a, k, mid = 50) => a.map((x) => ({ at: x.at, pos: Math.max(0, Math.min(100, Math.round(mid + (x.pos - mid) * k))) }));

// target = 'handy' oder 'vibe' – das Preset gilt für beide, jedes Gerät bekommt seine Fassung:
// die Handy nur, was sie physisch schafft (Vibrationen bleiben); der Satisfyer ungekürzt,
// dafür mit eigener Stärke/Gleichmäßigkeit (presetVibeShape, presetVibeEven).
// preset: zum Ausprobieren (Vorschau in den Knöpfen) – sonst das der Szene.
function processScript(actions, target = 'handy', preset = currentPreset()) {
  if (!actions) return actions;
  const key = `${tools.tooFast}|${handyMaxSpeedSafe()}`;
  const slot = preset === currentPreset() ? target : `${target}:${preset}`;
  const hit = toolCache[slot];
  if (hit && hit.src === actions && hit.key === key && hit.preset === preset) return hit.actions;
  let out = actions;
  const notes = [];      // was am Script geändert wurde
  const only = [];       // gerätetypische Anpassungen
  const res = { marks: [] };
  let even = 0;          // zusätzliche Gleichmäßigkeit für den Satisfyer (0–1)
  const handyTarget = target === 'handy';
  const st = preset === 'original' ? null : analyzeScript(out);

  if (st) {
    const max = handyMaxSpeedSafe();
    const range = st.hi - st.lo;
    // Satisfyer: Zittern glätten, wenn es viel davon gibt (die Handy behält feine Vibrationen)
    if (!handyTarget && (preset !== 'auto' || st.jitter / st.segs > 0.05)) {
      const r = removeJitter(out);
      if (r.removed) { out = r.actions; notes.push(`${r.removed} Zitterpunkte entfernt`); }
    }
    if (range >= 5 && range < (preset === 'auto' ? 70 : 95)) {
      out = stretchRange(out, st.lo, st.hi);
      notes.push(`Hub ${st.lo}–${st.hi} → 0–100 gestreckt`);
    }
    if (preset === 'soft') {
      out = scaleAround(out, 0.6);
      notes.push('Hub 20–80 %');
    }
    if (preset === 'intense') {
      const m = multiplyCalm(out, max);
      if (m.added) { out = m.actions; notes.push(`${m.added} ruhige Stellen im mehrfachen Takt`); }
    }
    if (handyTarget) {
      // Was die Handy nicht schafft, anpassen (nach dem Strecken – das macht Bewegungen schneller).
      // „Sanft“ bleibt deutlich darunter.
      out = fitHandy(out, preset === 'soft' ? Math.min(240, max) : max, only, res);
    } else {
      even = preset === 'soft' ? 0.5 : 0;
      if (preset === 'soft') only.push('schwächer, ruhiger');
      if (preset === 'intense') only.push('stärker');
    }
  }
  toolCache[slot] = { src: actions, key, actions: out, notes, only, even, preset, marks: res.marks };
  return out;
}

// Info je Gerät: was am Script geändert wird
const tr = (s) => (typeof I18N !== 'undefined' ? I18N.t(s) : s);
function presetInfoParts() {
  if (!script) return { handy: '', vibe: '' };
  const text = (target) => {
    processScript(script.actions, target);
    const c = toolCache[target];
    // Teile einzeln übersetzen (englische Oberfläche) – der zusammengesetzte Satz steht in keiner Tabelle
    const parts = [...c.notes, ...c.only].map(tr);
    return parts.join(', ') || tr(c.preset === 'original' ? 'unverändert' : 'passt, nichts geändert');
  };
  return { handy: text('handy'), vibe: text('vibe') };
}
function presetInfoText() {
  if (!script) return '';
  const p = presetInfoParts();
  const anyDev = typeof hasHandy === 'function' && (hasHandy() || hasVibe());
  const showH = !anyDev || hasHandy(), showV = !anyDev || hasVibe();
  return [showH ? `Handy: ${p.handy}` : '', showV ? `Satisfyer: ${p.vibe}` : ''].filter(Boolean).join(' · ');
}
// Zeiten der für die Handy angepassten Stellen (Striche in der Heatmap)
function adaptedMarks() {
  return script && toolCache.handy?.src === script.actions ? toolCache.handy.marks || [] : [];
}

// Gleichmäßigkeit, die das Preset für das laufende Video-Script vorgibt (vibe.js)
function presetVibeEven() {
  return script && toolCache.vibe?.src === script.actions ? toolCache.vibe.even : 0;
}
// Stärke des Satisfyers je Preset (raw 0–1 -> 0–1): Sanft schwächer und weicher, Intensiv kräftiger
function presetVibeShape(raw) {
  const p = script ? currentPreset() : 'auto';
  if (p === 'soft') return 0.7 * raw ** 1.3;
  if (p === 'intense') return Math.min(1, 1.25 * raw ** 0.75);
  return raw;
}

function toolsChanged() {
  store.set('scriptTools', tools);
  document.querySelectorAll('[data-preset-default] button').forEach((b) => b.classList.toggle('active', b.dataset.preset === presetDefault));
  const cur = currentPreset();
  document.querySelectorAll('[data-preset-scene] button').forEach((b) => b.classList.toggle('active', b.dataset.preset === cur));
  const info = presetInfoParts();
  $('toolInfo').textContent = script ? `Aktuelles Video: ${tr(SCRIPT_PRESETS[cur])} – Handy: ${info.handy} · Satisfyer: ${info.vibe}` : '';
  $('sbInfo').textContent = script ? presetInfoText() : '';
  if (typeof renderScriptBox === 'function') renderScriptBox();
  drawPresetPreviews();
  drawHeatmap();
  if (handy.owner === 'video') resync(); // geändertes Script sofort an die Handy
}

// Standard (Einstellungen) und Auswahl dieser Szene (Script-Bereich + Popup in der Player-Leiste)
document.querySelectorAll('[data-preset-default] button').forEach((b) => b.addEventListener('click', () => {
  presetDefault = b.dataset.preset;
  store.set('scriptIntensity', presetDefault);
  toolsChanged();
}));
function setScenePreset(p) {
  const k = offsetKey();
  if (!k) localPreset = p;
  else {
    const map = store.get('scenePresets', {});
    if (p === presetDefault) delete map[k]; else map[k] = p;
    store.set('scenePresets', map);
  }
  toolsChanged();
  log(`Script: ${tr(SCRIPT_PRESETS[p])}${k ? ' (für diese Szene gemerkt)' : ''}`);
}
document.querySelectorAll('[data-preset-scene] button').forEach((b) => b.addEventListener('click', () => setScenePreset(b.dataset.preset)));
video.addEventListener('emptied', () => { localPreset = null; });

// 🧪 Vorschau in den Knöpfen: Mini-Heatmap, wie das Script mit diesem Preset aussieht
function drawPresetPreviews() {
  document.querySelectorAll('[data-preset-scene] canvas').forEach((c) => {
    if (!c.clientWidth) return; // versteckt: beim Öffnen neu
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = Math.round(c.clientWidth * dpr)), h = (c.height = Math.round(c.clientHeight * dpr));
    g.clearRect(0, 0, w, h);
    if (!script) return;
    const a = processScript(script.actions, typeof hasHandy === 'function' && !hasHandy() && hasVibe() ? 'vibe' : 'handy', c.parentElement.dataset.preset);
    paintHeat(g, a, a[a.length - 1].at || 1, w, h);
  });
}

// Player-Leiste: 🎚 öffnet die Auswahl über dem Video
$('ovInt').addEventListener('click', (e) => { e.stopPropagation(); $('intPop').hidden = !$('intPop').hidden; drawPresetPreviews(); });
document.addEventListener('click', (e) => { if (!$('intPop').hidden && !e.target.closest('#intPop, #ovInt')) $('intPop').hidden = true; });

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
  offsetSource = 'calib'; // als „eingemessen“ merken (app.js)
  $('offset').dispatchEvent(new Event('change')); // speichert für diese Szene und synchronisiert neu
  $('calibBtn').textContent = '🎯 Offset per Takt einmessen';
  log(`🎯 Offset eingemessen: ${offset} ms (für diese Szene gespeichert).`);
  calib = null;
}
$('calibBtn').addEventListener('click', calibTap);
document.addEventListener('keydown', (e) => {
  if (e.key === 't' && document.body.dataset.view === 'player' && !e.target.closest('input, select, textarea')) calibTap();
});
