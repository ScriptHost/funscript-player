'use strict';

// Script-Logik: Einlesen, Script-Automatik, Touch-Aufnahme, Intensitäts-Zusammenfassung
const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers');

const { parseFunscript } = loadFunctions('public/app.js', ['parseFunscript']);
const { analyzeScript, removeJitter, stretchRange, limitSpeed } = loadFunctions('public/tools.js', ['analyzeScript', 'removeJitter', 'stretchRange', 'limitSpeed']);
const { touchToTempoActions, touchToPositionActions } = loadFunctions('public/touchpad.js', ['touchToTempoActions', 'touchToPositionActions']);
const { heatSummary } = loadFunctions('server.js', ['heatSummary'], 'const HEAT_BINS = 48;');

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
