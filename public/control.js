'use strict';

// ===========================================================================
// Reiter „Steuerung & Patterns“
//   Direktsteuerung (HAMP), Pattern-Editor und Script-Baukasten (beide HSSP).
//   Patterns und Scripts liegen auf dem Server (data/store.json).
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
const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
let active = null; // { kind, actions, duration, loop, start, cycle }

// Handy und/oder Vibrator – mindestens eins muss verbunden sein
function requireDevice() {
  if (handy.connected || allVibes().length) return true;
  log('Bitte zuerst rechts die Handy oder einen Vibrator verbinden.', true);
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
      setStatus('err', 'Fehler');
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
  const seq = active?.kind === 'sequence';
  $('patternPlay').textContent = pat ? '■ Stopp' : '▶ Pattern abspielen';
  $('patternPlay').classList.toggle('running', pat);
  $('seqPlay').textContent = seq ? '■ Stopp' : '▶ Script abspielen';
  $('seqPlay').classList.toggle('running', seq);
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
let hampOn = false;

async function toggleHamp() {
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
  }
}

let speedTimer, speedPending = false;
function setSpeed(v, send = true) {
  v = clamp(Math.round(v), 0, Number($('capSpeed').value));
  $('speed').value = v;
  $('speedVal').textContent = `${v} %`;
  store.set('speed', v);
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
  renderSteps();
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
  const used = db.sequences.some((s) => s.steps.some((st) => st.patternId === p.id));
  if (!confirm(`Pattern „${p.name}“ löschen?${used ? '\nEs wird in einem Script verwendet – diese Schritte entfallen.' : ''}`)) return;
  db.patterns = db.patterns.filter((x) => x !== p);
  db.sequences.forEach((s) => (s.steps = s.steps.filter((st) => st.patternId !== p.id)));
  currentPatternId = db.patterns[0].id;
  fillPatternSelects();
  showPattern();
  showSequence();
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
// Script-Baukasten
// ---------------------------------------------------------------------------
let currentSeqId = store.get('sequence', null);

function currentSeq() {
  return db.sequences.find((s) => s.id === currentSeqId) || db.sequences[0] || null;
}

function newSequence() {
  const s = {
    id: uid(),
    name: 'Mein Script',
    steps: db.patterns.slice(0, 3).map((p, i) => ({ patternId: p.id, seconds: 30, tempo: 80 + i * 20 })),
  };
  db.sequences.push(s);
  currentSeqId = s.id;
  saveStore();
  return s;
}

function showSequence() {
  const s = currentSeq() || newSequence();
  currentSeqId = s.id;
  store.set('sequence', s.id);
  $('seqSelect').replaceChildren(...db.sequences.map((x) => new Option(x.name, x.id)));
  $('seqSelect').value = s.id;
  $('seqName').value = s.name;
  renderSteps();
}

function renderSteps() {
  const s = currentSeq();
  if (!s) return;
  const tbody = $('seqSteps');
  tbody.replaceChildren();
  s.steps.forEach((st, i) => {
    const tr = document.createElement('tr');
    const sel = document.createElement('select');
    sel.append(...db.patterns.map((p) => new Option(p.name, p.id)));
    sel.value = st.patternId;
    sel.addEventListener('change', () => { st.patternId = sel.value; seqChanged(); });

    const sec = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 3600, value: st.seconds });
    sec.addEventListener('change', () => { st.seconds = clamp(Number(sec.value) || 1, 1, 3600); sec.value = st.seconds; seqChanged(); });

    const tempo = Object.assign(document.createElement('input'), { type: 'number', min: 25, max: 300, step: 5, value: st.tempo });
    tempo.addEventListener('change', () => { st.tempo = clamp(Number(tempo.value) || 100, 25, 300); tempo.value = st.tempo; seqChanged(); });

    const del = Object.assign(document.createElement('button'), { textContent: '✕', title: 'Schritt entfernen' });
    del.addEventListener('click', () => { s.steps.splice(i, 1); renderSteps(); seqChanged(); });

    [sel, sec, tempo, del].forEach((el) => { const td = document.createElement('td'); td.append(el); tr.append(td); });
    tbody.append(tr);
  });
  updateSeqInfo();
}

function buildSequence(s) {
  const actions = [];
  let offset = 0;
  for (const st of s.steps) {
    const p = db.patterns.find((x) => x.id === st.patternId);
    if (!p) continue;
    appendPattern(actions, p, st.tempo, st.seconds * 1000, offset);
    offset += st.seconds * 1000;
  }
  if (actions.length) actions.push({ at: offset, pos: actions[0].pos });
  return { actions, duration: offset };
}

function updateSeqInfo() {
  const s = currentSeq();
  const total = s.steps.reduce((sum, st) => sum + st.seconds * 1000, 0);
  $('seqInfo').textContent = `${s.steps.length} Schritte · Gesamtdauer ${fmtTime(total)}`;
}

function seqChanged() {
  saveStore();
  updateSeqInfo();
  if (active?.kind === 'sequence') stopPlayback();
}

$('seqSelect').addEventListener('change', (e) => { currentSeqId = e.target.value; showSequence(); });
$('seqName').addEventListener('input', (e) => {
  currentSeq().name = e.target.value.trim() || 'Ohne Namen';
  $('seqSelect').selectedOptions[0].textContent = currentSeq().name;
  saveStore();
});
$('seqNew').addEventListener('click', () => { newSequence(); showSequence(); $('seqName').select(); });
$('seqDel').addEventListener('click', () => {
  const s = currentSeq();
  if (!confirm(`Script „${s.name}“ löschen?`)) return;
  db.sequences = db.sequences.filter((x) => x !== s);
  currentSeqId = null;
  showSequence();
  saveStore();
});
$('seqAdd').addEventListener('click', () => {
  const s = currentSeq();
  const lastStep = s.steps[s.steps.length - 1];
  s.steps.push({ patternId: currentPattern().id, seconds: 30, tempo: lastStep ? lastStep.tempo : 100 });
  renderSteps();
  seqChanged();
});
function playSequence() {
  const { actions, duration } = buildSequence(currentSeq());
  if (!actions.length) return log('Das Script hat keine Schritte.', true);
  startPlayback('sequence', actions, duration, $('seqLoop').checked);
}
$('seqPlay').addEventListener('click', () => (active?.kind === 'sequence' ? stopPlayback() : playSequence()));
$('seqLoop').addEventListener('change', () => { if (active?.kind === 'sequence') active.loop = $('seqLoop').checked; });
$('seqExport').addEventListener('click', () => {
  const s = currentSeq();
  const { actions } = buildSequence(s);
  if (!actions.length) return log('Das Script hat keine Schritte.', true);
  downloadFunscript(actions, s.name);
});

// ---------------------------------------------------------------------------
// Für den Vibrator: laufendes Pattern/Script bzw. Direktsteuerung
// ---------------------------------------------------------------------------
function controlScriptSource() {
  if (!active) return null;
  const elapsed = performance.now() - active.start;
  return { actions: active.actions, ms: active.loop ? elapsed % active.duration : elapsed };
}

function hampLevel() {
  return hampOn ? Number($('speed').value) / 100 : null;
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
      $('seqProgress').style.width = active.kind === 'sequence' ? `${Math.min(100, (elapsed / active.duration) * 100)}%` : '0';
    }
  }
  if (!active) $('seqProgress').style.width = '0';
  $('strokerFill').style.height = pos === null ? '0' : `${pos}%`;
  requestAnimationFrame(controlLoop);
}

// Script umkehren betrifft auch laufende Patterns/Scripts
$('invert').addEventListener('change', () => {
  if (active?.kind === 'pattern') playPattern();
  else if (active?.kind === 'sequence') playSequence();
});

// Alles stoppen: egal, wer gerade steuert (pausiert auch das Video)
// Not-Aus: Video, Patterns, Direktsteuerung, Handy und Vibratoren sofort anhalten
async function emergencyStop(reason = 'Not-Aus') {
  if (remote.on) remoteCmd('stop'); // Fernbedienung: Bildschirm (Video + dortige Geräte) mit anhalten
  claimHandy('none');
  if (!video.paused) video.pause();
  active = null;
  hampOn = false;
  updateButtons();
  setVibePaused(true);
  vibeLevel = 0;
  for (const dev of allVibes()) {
    Promise.resolve(dev.setLevel(0)).then(() => { dev.level = 0; }).catch(() => {});
  }
  if (handy.connected) {
    try {
      if (handy.mode === 0) await handy.hampStop();
      else await handy.stop();
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
  showSequence();
  updateButtons();
  requestAnimationFrame(controlLoop);
})();
