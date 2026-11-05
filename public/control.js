import './library.js'; // Ladereihenfolge wie bisher – siehe boot.js
import { modulesReady, video } from './state.js';
import {
  $, claimHandy, downloadFunscript, handy, handyErrText, log, positionAt, setStatus, store, toCsv,
} from './handy.js';
import { allVibes, setVibeLevel, setVibePaused } from './vibe.js';
import { selfHampLevel } from './selfctl.js';
import { touchSync } from './touchpad.js';
modulesReady.add('control');

// ===========================================================================
// Reiter „Steuerung & Patterns“
//   Direktsteuerung (HAMP) und Pattern-Editor (HSSP).
//   Patterns liegen auf dem Server (data/store.json; alte Baukasten-Scripts in „sequences“ bleiben dort unangetastet, der Baukasten ist seit 1.19.3 raus).
// ===========================================================================

// Ein Pattern ist ein Bewegungszyklus: Punkte mit t (0 … <1, Anteil am Zyklus)
// und pos (0–100). Beim Abspielen wird der Zyklus wiederholt.
const sine = (n) => Array.from({ length: n }, (_, i) => ({ t: i / n, pos: Math.round(50 - 50 * Math.cos((2 * Math.PI * i) / n)) }));
const PRESETS = {
  'Gleichmäßig': { length: 1000, points: [{ t: 0, pos: 0 }, { t: 0.5, pos: 100 }] },
  'Sanft (Sinus)': { length: 1600, points: sine(12) },
  'Nur Spitze': { length: 500, points: [{ t: 0, pos: 55 }, { t: 0.5, pos: 100 }] },
  'Nur Basis': { length: 500, points: [{ t: 0, pos: 0 }, { t: 0.5, pos: 45 }] },
  'Doppelstoß': { length: 1400, points: [{ t: 0, pos: 0 }, { t: 0.2, pos: 100 }, { t: 0.35, pos: 45 }, { t: 0.5, pos: 100 }] },
  'Langsam rauf, schnell runter': { length: 1500, points: [{ t: 0, pos: 0 }, { t: 0.8, pos: 100 }] },
  'Schnell rauf, langsam runter': { length: 1500, points: [{ t: 0, pos: 0 }, { t: 0.2, pos: 100 }] },
  'Wellen': { length: 3000, points: [{ t: 0, pos: 0 }, { t: 0.25, pos: 100 }, { t: 0.4, pos: 0 }, { t: 0.5, pos: 80 }, { t: 0.6, pos: 10 }, { t: 0.7, pos: 90 }, { t: 0.8, pos: 20 }, { t: 0.9, pos: 70 }] },
  'Treppe': { length: 2400, points: [{ t: 0, pos: 0 }, { t: 0.1, pos: 25 }, { t: 0.2, pos: 25 }, { t: 0.3, pos: 50 }, { t: 0.4, pos: 50 }, { t: 0.5, pos: 75 }, { t: 0.6, pos: 75 }, { t: 0.7, pos: 100 }] },
  'Zufall': null, // wird bei Auswahl erzeugt
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function presetPoints(name) {
  if (name === 'Zufall') {
    const n = 4 + Math.floor(Math.random() * 6);
    return { length: 2000, points: Array.from({ length: n }, (_, i) => ({ t: i / n, pos: Math.round(Math.random() * 100) })) };
  }
  const p = PRESETS[name];
  return { length: p.length, points: p.points.map((x) => ({ ...x })) };
}

// ---------------------------------------------------------------------------
// Speicher
// ---------------------------------------------------------------------------
let db = { patterns: [], sequences: [] };

async function loadStore() {
  try {
    const res = await fetch('/api/store');
    if (res.ok) db = await res.json();
  } catch { /* offline: mit Standardwerten weiter */ }
  db.patterns = Array.isArray(db.patterns) ? db.patterns : [];
  db.sequences = Array.isArray(db.sequences) ? db.sequences : [];
  if (!db.patterns.length) {
    db.patterns = ['Gleichmäßig', 'Sanft (Sinus)', 'Doppelstoß', 'Wellen'].map((name) => ({ id: uid(), name, ...presetPoints(name) }));
    saveStore();
  }
}

// Touch-Aufnahme als Pattern: Punkte als Anteil der Gesamtlänge (höchstens ~2000 Punkte)
export function saveRecordingAsPattern(name, length, actions) {
  const step = Math.max(1, Math.ceil(actions.length / 2000));
  const points = actions.filter((_, i) => i % step === 0).map((a) => ({ t: Math.min(0.9999, a.at / length), pos: a.pos }));
  db.patterns.push({ id: uid(), name, length: Math.round(length), points });
  saveStore();
  fillPatternSelects();
}

let saveTimer;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      log('Speichern fehlgeschlagen: ' + e.message, true);
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// Script aus Patterns erzeugen
// ---------------------------------------------------------------------------
const cycleMs = (p, tempo) => (p.length * 100) / tempo;

function appendPattern(out, p, tempo, duration, offset) {
  const c = cycleMs(p, tempo);
  const pts = [...p.points].sort((a, b) => a.t - b.t);
  for (let k = 0; k * c < duration; k++) {
    for (const pt of pts) {
      const at = Math.round(offset + (k + pt.t) * c);
      if (at - offset >= duration) break;
      if (!out.length || at > out[out.length - 1].at) out.push({ at, pos: pt.pos });
    }
  }
  return out;
}

// Max. 20 000 Punkte und höchstens 60 Minuten für die Endlosschleife eines Patterns.
function patternLoop(p, tempo) {
  const duration = Math.min(3600000, (20000 / p.points.length) * cycleMs(p, tempo));
  const actions = appendPattern([], p, tempo, duration, 0);
  return { actions, duration: actions[actions.length - 1].at };
}

function maxSpeed(p, tempo) {
  const c = cycleMs(p, tempo);
  const pts = [...p.points].sort((a, b) => a.t - b.t);
  let max = 0;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dt = ((b.t - a.t + 1) % 1 || 1) * c;
    max = Math.max(max, (Math.abs(b.pos - a.pos) / dt) * 1000);
  });
  return Math.round(max);
}

// ---------------------------------------------------------------------------
// Wiedergabe von Patterns / Scripts über HSSP
// ---------------------------------------------------------------------------
export let active = null; // { kind, actions, duration, loop, start, cycle }

// Handy und/oder Vibrator – mindestens eins muss verbunden sein
function requireDevice() {
  if (handy.connected || allVibes().length) return true;
  log('Bitte zuerst oben die Handy oder den Satisfyer verbinden.', true);
  return false;
}

async function startPlayback(kind, actions, duration, loop, cycle = 0) {
  if (!requireDevice() || !actions.length) return;
  claimHandy(kind);
  if (handy.connected) {
    setStatus('busy', 'Script wird übertragen …');
    try {
      await handy.prepare(toCsv(actions));
      if (handy.owner !== kind) return;
      await handy.play(0);
      setStatus('on', kind === 'pattern' ? 'Pattern läuft' : 'Script läuft');
      log('');
    } catch (e) {
      setStatus('err', handyErrText(e));
      log(e, true);
      updateButtons();
      return;
    }
  }
  active = { kind, actions, duration, loop, cycle, start: performance.now() };
  updateButtons();
}

async function stopPlayback() {
  const wasMine = active && handy.owner === active.kind && handy.connected;
  active = null;
  updateButtons();
  if (wasMine) {
    try { await handy.stop(); } catch (e) { log(e, true); }
    setStatus('on', 'verbunden');
  }
}

function playPattern() {
  const p = currentPattern();
  const tempo = Number($('patternTempo').value);
  const { actions, duration } = patternLoop(p, tempo);
  startPlayback('pattern', actions, duration, true, cycleMs(p, tempo));
}

// Laufendes Pattern nach Änderungen neu übertragen (entprellt)
let restartTimer;
function restartPatternIfPlaying() {
  if (active?.kind !== 'pattern') return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(playPattern, 350);
}

function updateButtons() {
  const pat = active?.kind === 'pattern';
  $('patternPlay').textContent = pat ? '■ Stopp' : '▶ Pattern abspielen';
  $('patternPlay').classList.toggle('running', pat);
  $('hampToggle').textContent = hampOn ? '■ Stopp' : '▶ Start';
  $('hampToggle').classList.toggle('running', hampOn);
}

// Andere Bereiche (Video, Direktsteuerung …) haben übernommen
document.addEventListener('handy-owner', (e) => {
  if (active && e.detail !== active.kind) active = null;
  if (hampOn && e.detail !== 'manual') hampOn = false;
  updateButtons();
});

// ---------------------------------------------------------------------------
// Direktsteuerung (HAMP)
// ---------------------------------------------------------------------------
export let hampOn = false;

export async function toggleHamp() {
  if (!requireDevice()) return;
  const btn = $('hampToggle');
  btn.disabled = true;
  try {
    if (hampOn) {
      hampOn = false;
      if (handy.connected) {
        await handy.hampStop();
        setStatus('on', 'verbunden');
      }
    } else {
      claimHandy('manual');
      if (handy.connected) {
        await handy.hampStart(Number($('speed').value));
        setStatus('on', 'Direktsteuerung');
      }
      hampOn = true;
      log('');
    }
  } catch (e) {
    log(e, true);
  } finally {
    btn.disabled = false;
    updateButtons();
    if (modulesReady.has('touchpad')) touchSync('control', hampOn ? Number($('speed').value) : null);
  }
}

let speedTimer, speedPending = false;
export function setSpeed(v, send = true) {
  v = clamp(Math.round(v), 0, Number($('capSpeed').value));
  $('speed').value = v;
  $('speedVal').textContent = `${v} %`;
  store.set('speed', v);
  if (hampOn && modulesReady.has('touchpad')) touchSync('control', v);
  if (!send || !hampOn || !handy.connected) return;
  // Höchstens alle 150 ms an die Handy senden
  speedPending = true;
  if (speedTimer) return;
  const flush = async () => {
    if (!speedPending || !hampOn) { speedTimer = null; return; }
    speedPending = false;
    try { await handy.hampVelocity(Number($('speed').value)); } catch (e) { log(e, true); }
    speedTimer = setTimeout(flush, 150);
  };
  flush();
}

$('hampToggle').addEventListener('click', toggleHamp);
$('speed').addEventListener('input', () => setSpeed($('speed').value));
$('speedChips').addEventListener('click', (e) => { if (e.target.dataset.v) setSpeed(Number(e.target.dataset.v)); });

// Sicherheits-Obergrenze für die Direktsteuerung
$('capSpeed').value = store.get('capSpeed', 100);
$('capSpeedVal').textContent = `${$('capSpeed').value} %`;
$('capSpeed').addEventListener('input', () => {
  store.set('capSpeed', Number($('capSpeed').value));
  $('capSpeedVal').textContent = `${$('capSpeed').value} %`;
  if (Number($('speed').value) > Number($('capSpeed').value)) setSpeed($('capSpeed').value);
});
setSpeed(store.get('speed', 30), false);

document.addEventListener('keydown', (e) => {
  if ($('view-control').hidden || e.target.closest('input, select, textarea, button')) return;
  if (e.code === 'Space') { e.preventDefault(); toggleHamp(); }
  if (e.code === 'ArrowUp') { e.preventDefault(); setSpeed(Number($('speed').value) + 5); }
  if (e.code === 'ArrowDown') { e.preventDefault(); setSpeed(Number($('speed').value) - 5); }
});

// ---------------------------------------------------------------------------
// Pattern-Editor
// ---------------------------------------------------------------------------
let currentPatternId = store.get('pattern', null);

function currentPattern() {
  return db.patterns.find((p) => p.id === currentPatternId) || db.patterns[0];
}

function fillPatternSelects() {
  const sel = $('patternSelect');
  sel.replaceChildren(...db.patterns.map((p) => new Option(p.name, p.id)));
  sel.value = currentPattern().id;
}

function showPattern() {
  const p = currentPattern();
  currentPatternId = p.id;
  store.set('pattern', p.id);
  $('patternSelect').value = p.id;
  $('patternName').value = p.name;
  $('patternLength').value = p.length;
  updatePatternInfo();
  drawEditor();
}

function updatePatternInfo() {
  const p = currentPattern();
  const tempo = Number($('patternTempo').value);
  const c = cycleMs(p, tempo);
  const speed = maxSpeed(p, tempo);
  $('lengthVal').textContent = `${p.length} ms`;
  $('tempoVal').textContent = `${tempo} %`;
  $('patternInfo').textContent = `${p.points.length} Punkte · Zyklus ${Math.round(c)} ms · ${(60000 / c).toFixed(1)} Zyklen/min · `
    + `max. ${speed} %/s${speed > 450 ? ' – evtl. zu schnell für die Handy, sie fährt dann kürzere Hübe' : ''}`;
}

function patternChanged() {
  saveStore();
  updatePatternInfo();
  drawEditor();
  restartPatternIfPlaying();
}

$('patternSelect').addEventListener('change', (e) => { currentPatternId = e.target.value; showPattern(); restartPatternIfPlaying(); });
$('patternName').addEventListener('input', (e) => {
  currentPattern().name = e.target.value.trim() || 'Ohne Namen';
  fillPatternSelects();
  saveStore();
});
$('patternLength').addEventListener('input', (e) => { currentPattern().length = Number(e.target.value); updatePatternInfo(); });
$('patternLength').addEventListener('change', patternChanged);
$('patternTempo').addEventListener('input', updatePatternInfo);
$('patternTempo').addEventListener('change', () => { store.set('tempo', Number($('patternTempo').value)); restartPatternIfPlaying(); });

$('patternNew').addEventListener('click', () => {
  const p = { id: uid(), name: 'Neues Pattern', ...presetPoints('Gleichmäßig') };
  db.patterns.push(p);
  currentPatternId = p.id;
  fillPatternSelects();
  showPattern();
  saveStore();
  $('patternName').select();
});
$('patternDup').addEventListener('click', () => {
  const src = currentPattern();
  const p = { ...structuredClone(src), id: uid(), name: src.name + ' (Kopie)' };
  db.patterns.push(p);
  currentPatternId = p.id;
  fillPatternSelects();
  showPattern();
  saveStore();
});
$('patternDel').addEventListener('click', () => {
  if (db.patterns.length <= 1) return log('Das letzte Pattern kann nicht gelöscht werden.', true);
  const p = currentPattern();
  if (!confirm(`Pattern „${p.name}“ löschen?`)) return;
  db.patterns = db.patterns.filter((x) => x !== p);
  currentPatternId = db.patterns[0].id;
  fillPatternSelects();
  showPattern();
  saveStore();
});

const presetSel = $('patternPreset');
Object.keys(PRESETS).forEach((name) => presetSel.add(new Option(name, name)));
presetSel.addEventListener('change', () => {
  if (!presetSel.value) return;
  Object.assign(currentPattern(), presetPoints(presetSel.value));
  presetSel.value = '';
  $('patternLength').value = currentPattern().length;
  patternChanged();
});

$('patternPlay').addEventListener('click', () => (active?.kind === 'pattern' ? stopPlayback() : playPattern()));
$('patternExport').addEventListener('click', () => {
  const p = currentPattern();
  const minutes = clamp(Number($('patternExportMin').value) || 5, 1, 120);
  downloadFunscript(appendPattern([], p, Number($('patternTempo').value), minutes * 60000, 0), p.name);
});

// --- Zeichenfläche ----------------------------------------------------------
const pc = $('patternCanvas');
const pctx = pc.getContext('2d');
const PAD = 12;
let drag = null;

const toX = (t) => PAD + t * (pc.width - 2 * PAD);
const toY = (pos) => PAD + (1 - pos / 100) * (pc.height - 2 * PAD);

function canvasPoint(e) {
  const r = pc.getBoundingClientRect();
  const dpr = pc.width / r.width;
  const x = (e.clientX - r.left) * dpr;
  const y = (e.clientY - r.top) * dpr;
  return {
    x, y,
    t: clamp((x - PAD) / (pc.width - 2 * PAD), 0, 0.995),
    pos: Math.round(clamp(100 - ((y - PAD) / (pc.height - 2 * PAD)) * 100, 0, 100)),
  };
}

function hitPoint(e) {
  const { x, y } = canvasPoint(e);
  const dpr = window.devicePixelRatio || 1;
  return currentPattern().points.find((p) => Math.hypot(toX(p.t) - x, toY(p.pos) - y) < 12 * dpr);
}

function drawEditor(playhead = null) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(pc.clientWidth * dpr), h = Math.round(pc.clientHeight * dpr);
  if (pc.width !== w || pc.height !== h) { pc.width = w; pc.height = h; }
  if (!w || !h) return;
  const p = currentPattern();
  pctx.clearRect(0, 0, w, h);

  // Raster
  pctx.strokeStyle = 'rgba(255,255,255,.07)';
  pctx.lineWidth = dpr;
  pctx.beginPath();
  for (let i = 0; i <= 4; i++) { const y = toY(i * 25); pctx.moveTo(PAD, y); pctx.lineTo(w - PAD, y); }
  for (let i = 0; i <= 8; i++) { const x = toX(i / 8); pctx.moveTo(x, PAD); pctx.lineTo(x, h - PAD); }
  pctx.stroke();
  pctx.fillStyle = 'rgba(255,255,255,.35)';
  pctx.font = `${11 * dpr}px system-ui, sans-serif`;
  pctx.fillText('oben', PAD + 4 * dpr, PAD + 12 * dpr);
  pctx.fillText('unten', PAD + 4 * dpr, h - PAD - 4 * dpr);

  // Kurve (zyklisch: vom letzten Punkt zurück zum ersten)
  const pts = [...p.points].sort((a, b) => a.t - b.t);
  const first = pts[0], last = pts[pts.length - 1];
  const span = first.t + 1 - last.t;
  const edge = last.pos + ((first.pos - last.pos) * (1 - last.t)) / span;
  pctx.strokeStyle = '#e0457b';
  pctx.lineWidth = 2.5 * dpr;
  pctx.lineJoin = 'round';
  pctx.beginPath();
  pctx.moveTo(toX(0), toY(edge));
  pts.forEach((pt) => pctx.lineTo(toX(pt.t), toY(pt.pos)));
  pctx.lineTo(toX(1), toY(edge));
  pctx.stroke();

  // Punkte
  pts.forEach((pt) => {
    pctx.beginPath();
    pctx.arc(toX(pt.t), toY(pt.pos), (pt === drag ? 7 : 5.5) * dpr, 0, Math.PI * 2);
    pctx.fillStyle = pt === drag ? '#fff' : '#e0457b';
    pctx.fill();
    pctx.strokeStyle = '#fff';
    pctx.lineWidth = 1.5 * dpr;
    pctx.stroke();
  });

  if (playhead !== null) {
    pctx.fillStyle = 'rgba(255,255,255,.8)';
    pctx.fillRect(toX(playhead) - dpr, PAD, 2 * dpr, h - 2 * PAD);
  }
}

pc.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = currentPattern();
  drag = hitPoint(e);
  if (!drag) {
    const { t, pos } = canvasPoint(e);
    if (p.points.some((x) => Math.abs(x.t - t) < 0.005)) return;
    drag = { t: Math.round(t * 1000) / 1000, pos };
    p.points.push(drag);
  }
  pc.setPointerCapture(e.pointerId);
  drawEditor();
});
pc.addEventListener('pointermove', (e) => {
  if (!drag) {
    pc.style.cursor = hitPoint(e) ? 'grab' : 'crosshair';
    return;
  }
  const { t, pos } = canvasPoint(e);
  if (!currentPattern().points.some((x) => x !== drag && Math.abs(x.t - t) < 0.005)) drag.t = Math.round(t * 1000) / 1000;
  drag.pos = pos;
  drawEditor();
});
pc.addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  currentPattern().points.sort((a, b) => a.t - b.t);
  patternChanged();
});
function deletePoint(e) {
  e.preventDefault();
  const p = currentPattern();
  const pt = hitPoint(e);
  if (!pt) return;
  if (p.points.length <= 2) return log('Ein Pattern braucht mindestens 2 Punkte.', true);
  p.points = p.points.filter((x) => x !== pt);
  patternChanged();
}
pc.addEventListener('dblclick', deletePoint);
pc.addEventListener('contextmenu', deletePoint);
new ResizeObserver(() => drawEditor()).observe(pc);

// ---------------------------------------------------------------------------
// Für den Vibrator: laufendes Pattern/Script bzw. Direktsteuerung
// ---------------------------------------------------------------------------
export function controlScriptSource() {
  if (!active) return null;
  const elapsed = performance.now() - active.start;
  return { actions: active.actions, ms: active.loop ? elapsed % active.duration : elapsed };
}

export function hampLevel() {
  if (hampOn) return Number($('speed').value) / 100;
  return modulesReady.has('selfctl') ? selfHampLevel() : null; // „Selbst steuern“ am Video
}

// ---------------------------------------------------------------------------
// Anzeige während der Wiedergabe + Endlosschleife
// ---------------------------------------------------------------------------
let restarting = false;
function controlLoop() {
  let pos = null;
  if (active) {
    const elapsed = performance.now() - active.start;
    if (elapsed >= active.duration && !restarting) {
      if (active.loop) {
        restarting = true;
        const a = active;
        (handy.connected && handy.owner === a.kind ? handy.play(0) : Promise.resolve())
          .then(() => { if (active === a) a.start = performance.now(); })
          .catch((e) => log(e, true))
          .finally(() => { restarting = false; });
      } else {
        stopPlayback();
      }
    }
    if (active) {
      pos = positionAt(active.actions, Math.min(elapsed, active.duration));
      if (active.kind === 'pattern') drawEditor((elapsed % active.cycle) / active.cycle);
    }
  }
  $('strokerFill').style.height = pos === null ? '0' : `${pos}%`;
  requestAnimationFrame(controlLoop);
}

// Script umkehren betrifft auch laufende Patterns/Scripts
$('invert').addEventListener('change', () => {
  if (active?.kind === 'pattern') playPattern();
});

// Alles stoppen: egal, wer gerade steuert (pausiert auch das Video)
// Not-Aus: Video, Patterns, Direktsteuerung, Handy und Vibratoren sofort anhalten
export async function emergencyStop(reason = 'Not-Aus') {
  claimHandy('none');
  if (!video.paused) video.pause();
  active = null;
  hampOn = false;
  updateButtons();
  setVibePaused(true);
  setVibeLevel(0);
  for (const dev of allVibes()) {
    Promise.resolve(dev.setLevel(0)).then(() => { dev.level = 0; }).catch(() => {});
  }
  if (handy.connected) {
    try {
      if (handy.mode === 0) await handy.hampStop();
      else if (handy.mode === 1) await handy.stop();
      // Modus 2 (Direkt-Position): jede Bewegung endet von selbst am Ziel
      setStatus('on', 'verbunden');
    } catch (e) {
      log(e, true);
      return;
    }
  }
  log(`${reason}: alles gestoppt.`);
}
$('stopAll').addEventListener('click', () => emergencyStop());

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  $('patternTempo').value = store.get('tempo', 100);
  await loadStore();
  fillPatternSelects();
  showPattern();
  updateButtons();
  requestAnimationFrame(controlLoop);
})();
