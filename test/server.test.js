'use strict';

// Server als Ganzes: gemeinsame Einstellungen, Intensität, eigene Scripts, Fernbedienung, HereSphere
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, listen, wait } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  fs.writeFileSync(path.join(srv.media, 'Filme', 'clip.mp4'), 'kein echtes Video');
  fs.writeFileSync(path.join(srv.media, 'Filme', 'mit.mp4'), 'x');
  fs.writeFileSync(path.join(srv.media, 'Filme', 'mit.funscript'), JSON.stringify({ actions: [{ at: 0, pos: 0 }, { at: 200, pos: 100 }, { at: 400, pos: 0 }] }));
});
test.after(() => srv.stop());

const put = (url, body, method = 'PUT') => fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Version und Bibliothek', async () => {
  assert.ok((await (await fetch(srv.base + '/api/version')).json()).version);
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

test('Eigenes Script: neben das Video, nie überschreiben, Stash auf den Server', async () => {
  const funscript = { actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] };
  let r = await put('/api/userscript', { src: 'media:Filme/clip.mp4', funscript }, 'POST');
  assert.strictEqual((await r.json()).where, 'folder');
  assert.ok(fs.existsSync(path.join(srv.media, 'Filme', 'clip.funscript')));
  r = await put('/api/userscript', { src: 'media:Filme/clip.mp4', funscript }, 'POST');
  assert.strictEqual(r.status, 409, 'vorhandene Datei bleibt');
  r = await put('/api/userscript', { src: 'stash:42', funscript }, 'POST');
  assert.strictEqual((await r.json()).where, 'server');
  const back = await (await fetch(srv.base + '/api/userscript?src=stash:42')).json();
  assert.deepStrictEqual(back.actions, funscript.actions);
});

test('Fernbedienung: Bildschirm sichtbar, Befehl kommt mit Namen an', async () => {
  const screen = listen(srv.base + '/api/remote/events?id=screen1&name=TV&screen=1');
  const phone = listen(srv.base + '/api/remote/events?id=phone1&name=Pixel&screen=0');
  await wait(300);
  const list = phone.events.filter((e) => e.event === 'screens').pop();
  assert.ok(list.data.list.some((s) => s.id === 'screen1' && s.name === 'TV'));
  await put('/api/remote/cmd', { from: 'phone1', to: 'screen1', cmd: 'vol', arg: 40 }, 'POST');
  await put('/api/remote/state', { from: 'screen1', state: { t: 12, playing: true } }, 'POST');
  await wait(200);
  const cmd = screen.events.find((e) => e.event === 'cmd');
  assert.deepStrictEqual([cmd.data.cmd, cmd.data.arg, cmd.data.fromName], ['vol', 40, 'Pixel']);
  assert.ok(phone.events.some((e) => e.event === 'state' && e.data.state.t === 12));
  assert.strictEqual((await put('/api/remote/cmd', { from: 'screen1', to: 'phone1', cmd: 'play' }, 'POST')).status, 404, 'nur „kicked“ an Nicht-Bildschirme');
  screen.close(); phone.close();
});

test('HereSphere abschaltbar', async () => {
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 200);
  await put('/api/settings', { heresphere: false });
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 404);
  await put('/api/settings', { heresphere: true });
});
