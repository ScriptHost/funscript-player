'use strict';

// Script-Logik: Einlesen, Script-Automatik, Touch-Aufnahme, Intensitäts-Zusammenfassung
const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers');

const { parseFunscript } = loadFunctions('public/app.js', ['parseFunscript']);
const { analyzeScript, removeJitter, stretchRange, limitSpeed, halveFast } = loadFunctions('public/tools.js', ['analyzeScript', 'removeJitter', 'stretchRange', 'limitSpeed', 'halveFast'], 'const VIB_AMP = 20;');
const { handyModelKey } = loadFunctions('public/handy.js', ['handyModelKey']);
const { touchToTempoActions, touchToPositionActions } = loadFunctions('public/touchpad.js', ['touchToTempoActions', 'touchToPositionActions']);
const { heatSummary } = loadFunctions('lib/data.js', ['heatSummary'], 'const HEAT_BINS = 48;');

const strokes = (n, step, lo, hi) => Array.from({ length: n }, (_, i) => ({ at: i * step, pos: i % 2 ? hi : lo }));
const maxSpeed = (a) => Math.max(...a.slice(1).map((x, i) => (Math.abs(x.pos - a[i].pos) / (x.at - a[i].at)) * 1000));

test('Funscript einlesen: sortiert, begrenzt, umgekehrt', () => {
  const a = parseFunscript(JSON.stringify({ inverted: true, actions: [{ at: 200, pos: 120 }, { at: 0, pos: 10 }, { at: 100, pos: 'x' }] }));
  assert.deepStrictEqual(a, [{ at: 0, pos: 90 }, { at: 200, pos: 0 }]);
  assert.throws(() => parseFunscript('{"actions":[]}'));
});

test('Analyse erkennt flachen Hub und Zittern', () => {
  const flat = analyzeScript(strokes(200, 250, 35, 65));
  assert.strictEqual(flat.hi - flat.lo, 30);
  const jitter = analyzeScript([...strokes(100, 250, 10, 90), ...Array.from({ length: 50 }, (_, i) => ({ at: 25000 + i * 100, pos: 50 + (i % 2) }))]);
  assert.ok(jitter.jitter >= 40);
});

test('Zittern entfernen lässt Haltepunkte stehen', () => {
  const r = removeJitter([{ at: 0, pos: 50 }, { at: 100, pos: 51 }, { at: 200, pos: 50 }, { at: 1500, pos: 50 }, { at: 1700, pos: 90 }]);
  assert.strictEqual(r.removed, 1);
  assert.ok(r.actions.some((a) => a.at === 1500));
});

test('Hub strecken auf 0–100', () => {
  const out = stretchRange(strokes(4, 250, 35, 65), 35, 65);
  assert.deepStrictEqual(out.map((a) => a.pos), [0, 100, 0, 100]);
});

test('Zu schnelle Stellen: mittig verkleinert und nie schneller als erlaubt', () => {
  const r = limitSpeed(strokes(100, 120, 0, 100), 450);
  assert.ok(r.changed > 0);
  assert.ok(maxSpeed(r.actions) <= 451, `max ${maxSpeed(r.actions)}`);
  const pos = r.actions.map((a) => a.pos);
  assert.ok(Math.min(...pos) > 10 && Math.max(...pos) < 90, 'bleibt mittig');
});

test('Zählung: jeder Stoß einmal, winzige Kürzungen zählen nicht', () => {
  const r = limitSpeed(strokes(100, 120, 0, 100), 450);
  assert.ok(r.changed <= 100, `höchstens ein Mal pro Punkt (${r.changed})`);
  assert.strictEqual(limitSpeed(strokes(100, 225, 0, 100), 450).changed, 0, 'genau an der Grenze = nichts gekürzt');
});

test('Voller Hub, halbes Tempo: jeder zweite Stoß fällt weg, Hub bleibt 0–100', () => {
  const a = strokes(41, 150, 0, 100); // 667 %/s – zu schnell
  const h = halveFast(a, 450);
  assert.ok(h.halved >= 19);
  assert.deepStrictEqual([...new Set(h.actions.map((x) => x.pos))].sort((x, y) => x - y), [0, 100], 'voller Hub');
  assert.ok(maxSpeed(h.actions) <= 340, `halbes Tempo (${maxSpeed(h.actions)})`);
  for (let i = 1; i < h.actions.length; i++) assert.notStrictEqual(h.actions[i].pos, h.actions[i - 1].pos, 'keine Halte-Stellen');
  const slow = strokes(20, 400, 0, 100);
  assert.deepStrictEqual(halveFast(slow, 450).actions, slow, 'langsame Stellen bleiben');
});

test('Takt-Schutz: Vibrationen bleiben, große Stöße um ihre eigene Mitte gekürzt', () => {
  const vib = Array.from({ length: 40 }, (_, i) => ({ at: i * 30, pos: i % 2 ? 95 : 85 })); // 10 % Hub, sehr schnell
  assert.deepStrictEqual(limitSpeed(vib, 450).actions, vib, 'Vibration oben bleibt unverändert');
  const high = strokes(40, 80, 60, 100); // 40 % Hub oben, zu schnell
  const r = limitSpeed(high, 450);
  const pos = r.actions.map((a) => a.pos);
  assert.ok(Math.min(...pos) >= 60 && Math.max(...pos) <= 100, 'bleibt oben');
  assert.ok(r.marks.length === r.changed);
});

test('Intensität: Original unverändert, Sanft kleiner, Intensiv im Takt (keine Zusatz-Stöße) – Handy nie zu schnell', () => {
  const { loadPresets, sampleScript, topSpeed } = require('../lib/selfcheck');
  const run = loadPresets(450);
  const a = sampleScript();
  assert.strictEqual(JSON.stringify(run(a, 'handy', 'original')), JSON.stringify(a));
  const soft = run(a, 'handy', 'soft');
  assert.ok(Math.min(...soft.map((x) => x.pos)) >= 20 && Math.max(...soft.map((x) => x.pos)) <= 80);
  assert.ok(topSpeed(soft) <= 242);
  const auto = run(a, 'handy', 'auto'), intense = run(a, 'handy', 'intense');
  // nach test2: Intensiv bleibt im Takt – keine zusätzlichen Stöße, jeder Punkt liegt auf einem Zeitpunkt des Scripts
  assert.ok(intense.length <= auto.length, `${intense.length} > ${auto.length}`);
  const times = new Set(a.map((x) => x.at));
  assert.ok(intense.every((x) => times.has(x.at)), 'Takt des Scripts');
  assert.ok(topSpeed(intense) <= 452 && topSpeed(auto) <= 452);
});

test('Handy-Modell erkennen', () => {
  assert.strictEqual(handyModelKey('', ''), 'h1');
  assert.strictEqual(handyModelKey('H02', ''), 'h2');
  assert.strictEqual(handyModelKey('Handy 2 Pro', ''), 'h2pro');
});

test('Touch-Aufnahme als Tempo: oben schneller, losgelassen = Pause', () => {
  const fast = touchToTempoActions([[0, 100]], 3000);
  const slow = touchToTempoActions([[0, 10]], 3000);
  assert.ok(fast.length > slow.length * 3);
  const pause = touchToTempoActions([[0, 50], [1000, null]], 4000);
  assert.ok(pause[pause.length - 1].at <= 1700, 'nach dem Loslassen keine Stöße mehr');
  const fromVideo = touchToTempoActions([[60000, 50]], 62000, 60000);
  assert.strictEqual(fromVideo[0].at, 60000, 'Mitschnitt beginnt an der Video-Zeit');
});

test('Touch-Aufnahme als Position', () => {
  const a = touchToPositionActions([[0, 10], [50, 11], [100, 80], [150, null], [700, null]]);
  assert.deepStrictEqual(a.map((x) => x.pos), [10, 80, 80]);
});

test('Intensitäts-Zusammenfassung: 48 Abschnitte, ruhig < schnell', () => {
  const calm = heatSummary(JSON.stringify({ actions: strokes(100, 1000, 40, 60) }));
  const hot = heatSummary(JSON.stringify({ actions: strokes(100, 150, 0, 100) }));
  assert.strictEqual(calm.bins.length, 48);
  assert.ok(calm.avg < 120 && hot.avg > 250);
});

test('2.0 Intensiv: kleine, langsame Stöße auf vollen Hub – trotzdem machbar', () => {
  const { loadPresets, topSpeed } = require('../lib/selfcheck');
  const run = loadPresets(450);
  const a = [];
  let t = 0;
  for (let i = 0; i < 6; i++) { a.push({ at: t, pos: i % 2 ? 100 : 0 }); t += 400; }
  for (let i = 0; i < 10; i++) { a.push({ at: t, pos: i % 2 ? 65 : 35 }); t += 1000; } // klein und langsam
  const intense = run(a, 'handy', 'intense');
  const calm = intense.filter((x) => x.at >= 2400);
  assert.ok(Math.min(...calm.map((x) => x.pos)) <= 2 && Math.max(...calm.map((x) => x.pos)) >= 98, 'voller Hub');
  assert.ok(topSpeed(intense) <= 452);
});

test('2.0 Aufwärmen: Handy unten mit kurzen Hüben (0–35 %, 0,4 s je Weg), Satisfyer bekommt das Script', () => {
  const { loadPresets, sampleScript, topSpeed } = require('../lib/selfcheck');
  const run = loadPresets(450);
  const a = sampleScript();
  const w = run(a, 'handy', 'auto', true);
  assert.ok(w.every((x) => x.pos >= 0 && x.pos <= 35), 'unten');
  assert.ok(Math.max(...w.map((x) => x.pos)) === 35, 'Hub bis 35 %');
  assert.ok(topSpeed(w) <= 90, 'nicht zu schnell (beta1: 0,4 s je Weg)');
  assert.ok(w[w.length - 1].at >= a[a.length - 1].at, 'ganze Länge');
  assert.ok(run(a, 'vibe', 'auto', true).length > 2);
});
