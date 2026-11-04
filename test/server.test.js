'use strict';

// Server als Ganzes: gemeinsame Einstellungen, Intensität, eigene Scripts, Fernbedienung, HereSphere
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers');
const { runSelfcheck } = require('../lib/selfcheck');
const { newer } = require('../lib/update');

let srv;
test.before(async () => {
  srv = await startServer();
  fs.writeFileSync(path.join(srv.media, 'Filme', 'clip.mp4'), 'kein echtes Video');
  fs.writeFileSync(path.join(srv.media, 'Filme', 'mit.mp4'), 'x');
  fs.writeFileSync(path.join(srv.media, 'Filme', 'mit.funscript'), JSON.stringify({ actions: [{ at: 0, pos: 0 }, { at: 200, pos: 100 }, { at: 400, pos: 0 }] }));
});
test.after(() => srv.stop());

const put = (url, body, method = 'PUT') => fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Startseite, Version und Bibliothek', async () => {
  const home = await fetch(srv.base + '/');
  assert.strictEqual(home.status, 200, 'Startseite wird ausgeliefert');
  assert.ok((await home.text()).includes('<title>'));
  const v = (await (await fetch(srv.base + '/api/version')).json()).version;
  assert.ok(v && v !== 'dev', `echte Versionsnummer (${v})`);
  const lib = await (await fetch(srv.base + '/api/library')).json();
  assert.ok(lib.some((it) => it.video === 'Filme/mit.mp4' && it.script === 'Filme/mit.funscript'));
});

test('Gemeinsame Einstellungen: zusammenführen und löschen', async () => {
  await put('/api/prefs', { offset: 40, key: 'abc' });
  await put('/api/prefs', { offset: 60, key: null });
  const prefs = await (await fetch(srv.base + '/api/prefs')).json();
  assert.deepStrictEqual(prefs, { offset: 60 });
});

test('Intensität eines Ordner-Scripts', async () => {
  const h = await (await fetch(srv.base + '/api/heat?src=' + encodeURIComponent('media:Filme/mit.funscript'))).json();
  assert.strictEqual(h.bins.length, 48);
  assert.ok(h.avg > 0);
  assert.strictEqual((await fetch(srv.base + '/api/heat?src=media:../../etc/passwd')).status, 400);
});

test('Eigenes Script: neben das Video, eigenes ersetzen, Original nie anfassen, löschen', async () => {
  const funscript = { actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] };
  const neu = { actions: [{ at: 0, pos: 20 }, { at: 400, pos: 80 }] };
  let r = await put('/api/userscript', { src: 'media:Filme/clip.mp4', funscript }, 'POST');
  assert.strictEqual((await r.json()).where, 'folder');
  assert.ok(fs.existsSync(path.join(srv.media, 'Filme', 'clip.funscript')));
  r = await (await put('/api/userscript', { src: 'media:Filme/clip.mp4', funscript: neu }, 'POST')).json();
  assert.ok(r.replaced, 'eigenes Script wird ersetzt');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(srv.media, 'Filme', 'clip.funscript'), 'utf8')).actions, neu.actions);
  // Original daneben (nicht vom Player) bleibt unverändert, eigenes kommt auf den Server
  const orig = fs.readFileSync(path.join(srv.media, 'Filme', 'mit.funscript'), 'utf8');
  r = await (await put('/api/userscript', { src: 'media:Filme/mit.mp4', funscript }, 'POST')).json();
  assert.strictEqual(r.where, 'server');
  assert.strictEqual(fs.readFileSync(path.join(srv.media, 'Filme', 'mit.funscript'), 'utf8'), orig);
  r = await put('/api/userscript', { src: 'stash:42', funscript }, 'POST');
  assert.strictEqual((await r.json()).where, 'server');
  const back = await (await fetch(srv.base + '/api/userscript?src=stash:42')).json();
  assert.deepStrictEqual(back.actions, funscript.actions);
  const own = await (await fetch(srv.base + '/api/userscripts')).json();
  assert.deepStrictEqual(Object.keys(own).sort(), ['media:Filme/clip.mp4', 'media:Filme/mit.mp4', 'stash:42']);
  // Löschen: nur eigene
  assert.strictEqual((await fetch(srv.base + '/api/userscript?src=media:Filme/mit.mp4', { method: 'DELETE' })).status, 204);
  assert.ok(fs.existsSync(path.join(srv.media, 'Filme', 'mit.funscript')), 'Original bleibt');
  assert.strictEqual((await fetch(srv.base + '/api/userscript?src=media:Filme/mit.mp4', { method: 'DELETE' })).status, 404);
});

test('Eigenes Script nur neben Videos', async () => {
  fs.writeFileSync(path.join(srv.media, 'Filme', 'notiz.txt'), 'x');
  const r = await put('/api/userscript', { src: 'media:Filme/notiz.txt', funscript: { actions: [] } }, 'POST');
  assert.strictEqual(r.status, 404);
  assert.ok(!fs.existsSync(path.join(srv.media, 'Filme', 'notiz.funscript')));
});

test('Schutz-Header und Herkunftsprüfung', async () => {
  const r = await fetch(srv.base + '/api/prefs');
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  const evil = await fetch(srv.base + '/api/prefs', { method: 'PUT', headers: { Origin: 'https://boese.example', 'Content-Type': 'text/plain' }, body: '{"key":"x"}' });
  assert.strictEqual(evil.status, 403);
  const cross = await fetch(srv.base + '/api/prefs', { method: 'PUT', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{"key":"x"}' });
  assert.strictEqual(cross.status, 403);
  const own = await fetch(srv.base + '/api/prefs', { method: 'PUT', headers: { Origin: srv.base }, body: '{"own":1}' });
  assert.strictEqual(own.status, 200);
});

test('Handy-Script-Merkliste', async () => {
  const k = 'v2:' + 'a'.repeat(64);
  assert.strictEqual((await fetch(srv.base + '/api/handycache?k=' + k)).status, 404);
  assert.strictEqual((await put('/api/handycache', { k, url: 'https://example.com/s.csv' })).status, 204);
  assert.strictEqual((await (await fetch(srv.base + '/api/handycache?k=' + k)).json()).url, 'https://example.com/s.csv');
  assert.strictEqual((await put('/api/handycache', { k: 'v2:zz', url: 'https://x' })).status, 400);
});

test('HereSphere: nur VR, Passwort', async () => {
  fs.writeFileSync(path.join(srv.media, 'Filme', 'szene_vr_180_sbs.mp4'), 'x');
  const urls = async (h = {}) => (await (await fetch(srv.base + '/heresphere', { headers: h })).json()).library.flatMap((l) => l.list);
  let list = await urls();
  assert.ok(list.some((u) => u.includes('szene_vr_180_sbs')) && !list.some((u) => u.includes('clip.mp4')), 'Standard: nur VR');
  assert.strictEqual((await fetch(srv.base + '/heresphere/media/Filme/clip.mp4', { method: 'POST' })).status, 404);
  await put('/api/settings', { hsVrOnly: false });
  assert.ok((await urls()).some((u) => u.includes('clip.mp4')), 'alle Videos');
  await put('/api/settings', { hsVrOnly: true, hsPassword: 'geheim' });
  assert.strictEqual((await (await fetch(srv.base + '/heresphere')).json()).access, -1);
  const bad = await (await put('/heresphere/auth', { username: 'x', password: 'falsch' }, 'POST')).json();
  assert.strictEqual(bad.access, -1);
  const ok = await (await put('/heresphere/auth', { username: 'x', password: 'geheim' }, 'POST')).json();
  assert.strictEqual(ok.access, 1);
  list = await urls({ 'auth-token': ok['auth-token'] });
  assert.ok(list.length && list.every((u) => u.endsWith('?hs=' + ok['auth-token'])));
  const s = await (await fetch(srv.base + '/api/settings')).json();
  assert.strictEqual(s.hsPassword, true);
  await put('/api/settings', { hsPassword: '' });
  assert.ok((await urls()).length);
});

test('Fernbedienung und Sicherung sind raus (1.19.3)', async () => {
  for (const p of ['/api/backup', '/api/remote/time']) assert.strictEqual((await fetch(srv.base + p)).status, 404, p);
});

test('Selbsttest beim Start: alles grün', async () => {
  const bad = (await runSelfcheck()).filter((c) => !c.ok);
  assert.deepStrictEqual(bad, []);
});

test('Update-Hinweis: Versionen vergleichen', () => {
  assert.ok(newer('1.19.10', '1.19.9'));
  assert.ok(newer('1.20', '1.19.3'));
  assert.ok(!newer('1.19.3', '1.19.3'));
  assert.ok(!newer('1.19.2', '1.19.3'));
});

test('Stiller Selbsttest der Oberfläche wird angenommen', async () => {
  assert.strictEqual((await put('/api/clientcheck', { fails: [], ua: 'test' }, 'POST')).status, 204);
});

test('HereSphere abschaltbar', async () => {
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 200);
  await put('/api/settings', { heresphere: false });
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 404);
  await put('/api/settings', { heresphere: true });
});
