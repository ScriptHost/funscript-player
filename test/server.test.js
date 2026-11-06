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

test('2.0: benannte eigene Scripts je Szene (own:<Name>)', async () => {
  const a = { actions: [{ at: 0, pos: 0 }, { at: 300, pos: 100 }] };
  const b = { actions: [{ at: 0, pos: 50 }, { at: 600, pos: 60 }] };
  const src = 'stash:77';
  let r = await (await put('/api/userscript', { src, name: 'sanft', funscript: a }, 'POST')).json();
  assert.deepStrictEqual([r.where, r.name, r.replaced], ['server', 'sanft', false]);
  r = await (await put('/api/userscript', { src, name: 'Lange Fassung', funscript: b }, 'POST')).json();
  r = await (await put('/api/userscript', { src, name: 'sanft', funscript: b }, 'POST')).json();
  assert.ok(r.replaced, 'gleicher Name ersetzt');
  const q = (name) => srv.base + '/api/userscript?src=' + encodeURIComponent(src) + '&name=' + encodeURIComponent(name);
  assert.deepStrictEqual((await (await fetch(q('sanft'))).json()).actions, b.actions);
  assert.strictEqual((await fetch(q('fehlt'))).status, 404);
  let own = (await (await fetch(srv.base + '/api/userscripts')).json())[src];
  assert.deepStrictEqual(Object.keys(own.named).sort(), ['Lange Fassung', 'sanft']);
  assert.ok(!own.where, 'kein Haupt-Script');
  // Haupt-Script dazu – die benannten bleiben
  await put('/api/userscript', { src, funscript: a }, 'POST');
  own = (await (await fetch(srv.base + '/api/userscripts')).json())[src];
  assert.strictEqual(own.where, 'server');
  assert.strictEqual(Object.keys(own.named).length, 2);
  // Ungültige Namen
  for (const name of ['', '   ', '__proto__']) assert.strictEqual((await put('/api/userscript', { src, name, funscript: a }, 'POST')).status, 400);
  // Löschen einzeln, zuletzt verschwindet der Eintrag
  assert.strictEqual((await fetch(q('sanft'), { method: 'DELETE' })).status, 204);
  assert.strictEqual((await fetch(q('Lange Fassung'), { method: 'DELETE' })).status, 204);
  assert.strictEqual((await fetch(srv.base + '/api/userscript?src=' + src, { method: 'DELETE' })).status, 204);
  assert.ok(!(src in await (await fetch(srv.base + '/api/userscripts')).json()));
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
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 404, '2.0: ab Werk aus');
  await put('/api/settings', { heresphere: true });
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
  // 2.0: Dateien nur unter /heresphere/file/… und nur mit Token
  const hs = await (await fetch(srv.base + '/heresphere/media/Filme/szene_vr_180_sbs.mp4', { method: 'POST', headers: { 'auth-token': ok['auth-token'] } })).json();
  const src = hs.media[0].sources[0].url;
  assert.ok(src.includes('/heresphere/file/media/Filme/szene_vr_180_sbs.mp4?hs='), src);
  const file = srv.base + '/heresphere/file/media/Filme/szene_vr_180_sbs.mp4';
  assert.strictEqual((await fetch(file)).status, 401);
  assert.strictEqual((await fetch(file + '?hs=' + 'f'.repeat(64))).status, 401);
  assert.strictEqual((await fetch(file + '?hs=' + ok['auth-token'])).status, 200);
  assert.strictEqual((await fetch(srv.base + '/heresphere/file/media/..%2F..%2Fdata%2Fsettings.json?hs=' + ok['auth-token'])).status, 403);
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
  await put('/api/settings', { heresphere: true });
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 200);
  await put('/api/settings', { heresphere: false });
  assert.strictEqual((await fetch(srv.base + '/heresphere')).status, 404);
  await put('/api/settings', { heresphere: true });
});

test('2.0: HereSphere wird von / auf /heresphere weitergeleitet – vor der Anmeldung, nur /', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'p' });
  const auth = { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
  const hs = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Quest 3) HereSphere/1.0' };
  const get = (p, h) => fetch(s.base + p, { headers: h, redirect: 'manual' });
  try {
    assert.strictEqual((await get('/', hs)).status, 401, 'HereSphere aus: keine Weiterleitung');
    await fetch(s.base + '/api/settings', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ heresphere: true }) });
    const r = await get('/', hs);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), '/heresphere');
    assert.strictEqual((await get('/', {})).status, 401, 'normaler Browser: Anmeldung');
    assert.strictEqual((await get('/index.html', hs)).status, 401, 'nur / wird umgeleitet');
    assert.strictEqual((await get('/api/version', hs)).status, 401);
    const set = await (await fetch(s.base + '/api/settings', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ hsRedirect: false }) })).json();
    assert.strictEqual(set.hsRedirect, false);
    assert.strictEqual((await get('/', hs)).status, 401, 'Schalter aus: keine Weiterleitung');
    // Ohne HereSphere-Passwort bleibt /heresphere hinter der Anmeldung, mit Passwort prüft der Player selbst
    assert.strictEqual((await get('/heresphere', hs)).status, 401);
    await fetch(s.base + '/api/settings', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ hsPassword: 'geheim' }) });
    const idx = await get('/heresphere', hs);
    assert.strictEqual(idx.status, 200);
    assert.strictEqual((await idx.json()).access, -1, 'ohne Token keine Bibliothek');
    assert.strictEqual((await get('/heresphere/file/media/Filme/clip.mp4', hs)).status, 401);
    assert.strictEqual((await get('/stash/1/stream', hs)).status, 401, '/stash bleibt hinter der Anmeldung');
  } finally { s.stop(); }
});

test('Mit Anmeldung: nur /healthz ist offen, die Versionsnummer nicht (1.19.10)', async () => {
  const auth = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'p' });
  try {
    assert.strictEqual((await fetch(auth.base + '/healthz')).status, 200);
    assert.strictEqual((await fetch(auth.base + '/api/version')).status, 401);
    const ok = await fetch(auth.base + '/api/version', { headers: { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } });
    assert.strictEqual(ok.status, 200);
  } finally { auth.stop(); }
});

test('2.0: Bremse gegen Durchprobieren (Anmeldung und HereSphere)', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'p' });
  const basic = (pw) => ({ Authorization: 'Basic ' + Buffer.from('u:' + pw).toString('base64') });
  try {
    for (let i = 0; i < 10; i++) assert.strictEqual((await fetch(s.base + '/api/version', { headers: basic('falsch') })).status, 401);
    assert.strictEqual((await fetch(s.base + '/api/version', { headers: basic('p') })).status, 429, 'auch richtig gesperrt');
    assert.strictEqual((await fetch(s.base + '/healthz')).status, 200);
  } finally { s.stop(); }
});

test('2.0: HereSphere ab Werk aus, alte Installationen behalten es', async () => {
  const old = await startServer({}, (media) => fs.writeFileSync(path.join(media, '..', 'data', 'settings.json'), JSON.stringify({ hsVrOnly: true, v: 2 })));
  try {
    assert.strictEqual((await (await fetch(old.base + '/api/settings')).json()).heresphere, true);
  } finally { old.stop(); }
});

test('2.0: ohne Anmeldung und ohne LOGIN=off nur die Erklärseite', async () => {
  const s = await startServer({ LOGIN: '' });
  try {
    assert.strictEqual((await fetch(s.base + '/healthz')).status, 200);
    const r = await fetch(s.base + '/api/prefs');
    assert.strictEqual(r.status, 503);
    assert.match(await r.text(), /LOGIN=off/);
  } finally { s.stop(); }
});

test('2.0: Beispielpasswort change-me gilt nicht', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: 'admin', AUTH_PASS: 'change-me' });
  try {
    const r = await fetch(s.base + '/', { headers: { Authorization: 'Basic ' + Buffer.from('admin:change-me').toString('base64') } });
    assert.strictEqual(r.status, 503);
    assert.match(await r.text(), /change-me/);
  } finally { s.stop(); }
});

test('2.0: LOGIN=off gewinnt – AUTH_USER/AUTH_PASS zählen dann nicht', async () => {
  const s = await startServer({ LOGIN: 'off', AUTH_USER: '<benutzername>', AUTH_PASS: '<passwort>' });
  try {
    assert.strictEqual((await fetch(s.base + '/api/version')).status, 200, 'ohne Anmeldung offen');
  } finally { s.stop(); }
});

test('2.0: Platzhalter <…> aus der Vorlage zählen als leer', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: '<benutzername>', AUTH_PASS: '<passwort>' });
  try {
    // Anmeldung gilt als nicht eingerichtet -> Erklärseite statt Passwortabfrage mit „<benutzername>“
    assert.strictEqual((await fetch(s.base + '/')).status, 503);
  } finally { s.stop(); }
});

test('2.0: mehrere Scripts je Video (Varianten), Achsen zählen nicht', async () => {
  const s = await startServer({}, (media) => {
    for (const f of ['multi.mp4', 'multi.funscript', 'multi.soft.funscript', 'multi.roll.funscript', 'nur.mp4', 'nur.hard.funscript']) {
      fs.writeFileSync(path.join(media, 'Filme', f), f.endsWith('.funscript') ? '{"actions":[]}' : 'x');
    }
  });
  try {
    const lib = await (await fetch(s.base + '/api/library')).json();
    const multi = lib.find((it) => it.video === 'Filme/multi.mp4');
    assert.strictEqual(multi.script, 'Filme/multi.funscript');
    assert.deepStrictEqual(multi.scripts, [{ name: 'soft', script: 'Filme/multi.soft.funscript' }]);
    const nur = lib.find((it) => it.video === 'Filme/nur.mp4');
    assert.strictEqual(nur.script, 'Filme/nur.hard.funscript');
    assert.strictEqual(nur.scripts, undefined);
  } finally { s.stop(); }
});

test('2.0: Schalter STASH=off gewinnt, LOGIN=on ist die normale Anmeldung', async () => {
  const s = await startServer({ LOGIN: 'on', AUTH_USER: 'u', AUTH_PASS: 'p', STASH: 'off', STASH_URL: 'http://127.0.0.1:9', STASH_API_KEY: 'abc' });
  const auth = { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
  try {
    assert.strictEqual((await fetch(s.base + '/api/version')).status, 401, 'LOGIN=on verlangt Anmeldung');
    const st = await (await fetch(s.base + '/api/stash/status', { headers: auth })).json();
    assert.strictEqual(st.configured, false, 'STASH=off: Stash gilt als nicht eingerichtet');
    assert.strictEqual((await fetch(s.base + '/api/stash/scenes', { headers: auth })).status, 404);
  } finally { s.stop(); }
});

test('2.0: Demo-Modus /demo liefert die Seite (hinter der Anmeldung)', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'p' });
  try {
    assert.strictEqual((await fetch(s.base + '/demo')).status, 401);
    const r = await fetch(s.base + '/demo', { headers: { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } });
    assert.strictEqual(r.status, 200);
    assert.ok((await r.text()).includes('id="view-settings"'));
  } finally { s.stop(); }
});

test('test10: Player-Passwort ändern – nur mit .env-Anmeldung, .env-Änderung setzt zurück', async () => {
  const b = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64'), 'Content-Type': 'application/json' });
  const s = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'envpass1' });
  let saved;
  try {
    const set = (h, body, method = 'POST') => fetch(s.base + '/api/login/password', { method, headers: h, body: JSON.stringify(body) });
    assert.strictEqual((await set(b('u', 'falsch'), { current: 'envpass1', next: 'neuespass' })).status, 401, 'nur angemeldet');
    assert.strictEqual((await set(b('u', 'envpass1'), { current: 'falsch', next: 'neuespass' })).status, 403, 'aktuelles Passwort nötig');
    assert.strictEqual((await set(b('u', 'envpass1'), { current: 'envpass1', next: 'kurz' })).status, 400, 'mindestens 8 Zeichen');
    assert.strictEqual((await set(b('u', 'envpass1'), { current: 'envpass1', next: 'neuespass' })).status, 200);
    assert.strictEqual((await fetch(s.base + '/api/version', { headers: b('u', 'envpass1') })).status, 401, 'altes .env-Passwort gilt nicht mehr');
    assert.strictEqual((await fetch(s.base + '/api/version', { headers: b('u', 'neuespass') })).status, 200);
    const st = await (await fetch(s.base + '/api/settings', { headers: b('u', 'neuespass') })).json();
    assert.strictEqual(st.loginOwn, true);
    saved = fs.readFileSync(path.join(s.data, 'settings.json'), 'utf8');
    assert.ok(!saved.includes('neuespass'), 'nur Hash gespeichert');
    // zurück auf die .env
    assert.strictEqual((await set(b('u', 'neuespass'), { current: 'neuespass' }, 'DELETE')).status, 200);
    assert.strictEqual((await fetch(s.base + '/api/version', { headers: b('u', 'envpass1') })).status, 200);
    assert.strictEqual((await set(b('u', 'envpass1'), { current: 'envpass1', next: 'neuespass' })).status, 200);
    saved = fs.readFileSync(path.join(s.data, 'settings.json'), 'utf8');
  } finally { s.stop(); }
  // Rettungsweg: AUTH_PASS in der .env geändert -> eigenes Passwort gilt nicht mehr
  const s2 = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'envpass2' }, (media) => fs.writeFileSync(path.join(media, '..', 'data', 'settings.json'), saved));
  try {
    assert.strictEqual((await fetch(s2.base + '/api/version', { headers: b('u', 'neuespass') })).status, 401);
    assert.strictEqual((await fetch(s2.base + '/api/version', { headers: b('u', 'envpass2') })).status, 200);
  } finally { s2.stop(); }
  // LOGIN=off: nichts zu ändern
  const s3 = await startServer({ LOGIN: 'off' });
  try {
    const r = await fetch(s3.base + '/api/login/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: '', next: 'neuespass' }) });
    assert.strictEqual(r.status, 400);
  } finally { s3.stop(); }
});

test('test10: Stash antwortet 403 (ab 0.32) – Status mit Art und Netzen', async () => {
  const http = require('http');
  const fake = http.createServer((req, res) => { res.writeHead(403); res.end('forbidden'); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const s = await startServer({ STASH_URL: `http://127.0.0.1:${fake.address().port}` });
  try {
    const st = await (await fetch(s.base + '/api/stash/status?fresh=1')).json();
    assert.strictEqual(st.ok, false);
    assert.strictEqual(st.code, 'forbidden');
    assert.ok(Array.isArray(st.networks));
  } finally { s.stop(); fake.close(); }
});

test('test11: Anmeldung in der Oberfläche einrichten, ändern, entfernen; Einrichtungsseite; LOGIN_RESET', async () => {
  const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  const s = await startServer({ LOGIN: 'off' });
  const call = (m, p, body, h = {}) => fetch(s.base + p, { method: m, headers: { ...h, 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify(body) });
  let saved;
  try {
    assert.strictEqual((await call('POST', '/api/login/setup', { user: 'anna', pass: 'kurz' })).status, 400);
    assert.strictEqual((await call('POST', '/api/login/setup', { user: 'a:b', pass: 'langes-pw' })).status, 400);
    assert.strictEqual((await call('POST', '/api/login/setup', { user: 'anna', pass: 'geheim123' })).status, 200);
    assert.strictEqual((await fetch(s.base + '/api/version')).status, 401, 'jetzt mit Anmeldung (vor LOGIN=off)');
    const st = await (await fetch(s.base + '/api/settings', { headers: basic('anna', 'geheim123') })).json();
    assert.strictEqual(st.loginSource, 'ui');
    assert.strictEqual(st.loginUser, 'anna');
    assert.strictEqual((await call('POST', '/api/login/setup', { user: 'x', pass: 'nochmal123' }, basic('anna', 'geheim123'))).status, 409, 'nur eine Anmeldung');
    assert.strictEqual((await call('POST', '/api/login/password', { current: 'geheim123', next: 'neues-pw1' }, basic('anna', 'geheim123'))).status, 200);
    assert.strictEqual((await fetch(s.base + '/api/version', { headers: basic('anna', 'neues-pw1') })).status, 200);
    saved = fs.readFileSync(path.join(s.data, 'settings.json'), 'utf8');
    assert.ok(!saved.includes('neues-pw1'), 'kein Klartext');
    assert.strictEqual((await call('DELETE', '/api/login/setup', { current: 'falsch' }, basic('anna', 'neues-pw1'))).status, 403);
    assert.strictEqual((await call('DELETE', '/api/login/setup', { current: 'neues-pw1' }, basic('anna', 'neues-pw1'))).status, 200);
    assert.strictEqual((await fetch(s.base + '/api/version')).status, 200, 'wieder LOGIN=off');
  } finally { s.stop(); }
  // .env-Anmeldung geht vor
  const e = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'envpass1' }, (media) => fs.writeFileSync(path.join(media, '..', 'data', 'settings.json'), saved));
  try {
    assert.strictEqual((await fetch(e.base + '/api/version', { headers: basic('anna', 'neues-pw1') })).status, 401);
    assert.strictEqual((await fetch(e.base + '/api/version', { headers: basic('u', 'envpass1') })).status, 200);
  } finally { e.stop(); }
  // LOGIN_RESET=1 löscht die in ⚙️ gesetzte Anmeldung
  const r = await startServer({ LOGIN: 'off', LOGIN_RESET: '1' }, (media) => fs.writeFileSync(path.join(media, '..', 'data', 'settings.json'), saved));
  try {
    assert.strictEqual((await fetch(r.base + '/api/version')).status, 200);
  } finally { r.stop(); }
  // Ohne alles: Einrichtungsseite mit Formular
  const m = await startServer({ LOGIN: '' });
  try {
    const page = await fetch(m.base + '/');
    assert.strictEqual(page.status, 503);
    assert.match(await page.text(), /setup-login/);
    assert.strictEqual((await fetch(m.base + '/setup.css')).status, 200);
    const form = (b) => fetch(m.base + '/setup-login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: m.base }, body: new URLSearchParams(b).toString() });
    assert.strictEqual((await form({ user: 'bob', pass: 'passwort1', pass2: 'anders123' })).status, 400);
    const ok = await form({ user: 'bob', pass: 'passwort1', pass2: 'passwort1' });
    assert.strictEqual(ok.status, 303);
    assert.strictEqual((await fetch(m.base + '/api/version')).status, 401);
    assert.strictEqual((await fetch(m.base + '/api/version', { headers: basic('bob', 'passwort1') })).status, 200);
    assert.strictEqual((await form({ user: 'eve', pass: 'passwort2', pass2: 'passwort2' })).status, 401, 'Seite gibt es danach nicht mehr');
  } finally { m.stop(); }
});

test('test11: Stash-Adresse und API-Key in der Oberfläche', async () => {
  const http = require('http');
  let gotKey = '';
  const fake = http.createServer((req, res) => {
    gotKey = req.headers.apikey || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { version: { version: 'v0.32.0' }, findScenes: { count: 7 } } }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const s = await startServer({});
  const put = (body) => fetch(s.base + '/api/stash/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await (await fetch(s.base + '/api/stash/status')).json()).configured, false);
    assert.strictEqual((await put({ url: 'ftp://x' })).status, 400);
    const r = await (await put({ url: `127.0.0.1:${fake.address().port}/`, key: 'k1' })).json();
    assert.strictEqual(r.status.ok, true);
    assert.strictEqual(r.status.scenes, 7);
    assert.strictEqual(gotKey, 'k1');
    assert.strictEqual(r.settings.stash.source, 'ui');
    assert.strictEqual(r.settings.stash.hasKey, true);
    assert.ok(!JSON.stringify(r.settings).includes('k1'), 'Key geht nicht an den Browser');
    await put({ url: `http://127.0.0.1:${fake.address().port}` }); // Key leer = bleibt
    await fetch(s.base + '/api/stash/status?fresh=1');
    assert.strictEqual(gotKey, 'k1');
    const c = await (await put({ url: `http://127.0.0.1:${fake.address().port}`, clearKey: true })).json();
    assert.strictEqual(c.settings.stash.hasKey, false);
    const back = await (await fetch(s.base + '/api/stash/config', { method: 'DELETE', headers: { Origin: s.base } })).json();
    assert.strictEqual(back.settings.stash.source, 'env');
    assert.strictEqual(back.status.configured, false);
  } finally { s.stop(); fake.close(); }
});

test('test12: /api/library meldet VR-Videos (für „Nur 2D“ bei Ordnern)', async () => {
  const s = await startServer({}, (media) => {
    for (const f of ['flach.mp4', 'szene_180_sbs.mp4', 'Clip VR 6K.mp4']) fs.writeFileSync(path.join(media, 'Filme', f), 'x');
  });
  try {
    const lib = await (await fetch(s.base + '/api/library')).json();
    const vr = Object.fromEntries(lib.map((it) => [it.video, it.vr]));
    assert.strictEqual(vr['Filme/flach.mp4'], false);
    assert.strictEqual(vr['Filme/szene_180_sbs.mp4'], true);
    assert.strictEqual(vr['Filme/Clip VR 6K.mp4'], true);
  } finally { s.stop(); }
});

test('test13: Cast-Token – Fernseher holt nur Videos ohne Anmeldung', async () => {
  const s = await startServer({ LOGIN: '', AUTH_USER: 'u', AUTH_PASS: 'geheim123' }, (media) => fs.writeFileSync(path.join(media, 'Filme', 'tv.mp4'), 'x'));
  const auth = { Authorization: 'Basic ' + Buffer.from('u:geheim123').toString('base64') };
  try {
    assert.strictEqual((await fetch(s.base + '/api/cast/token')).status, 401, 'Token nur mit Anmeldung');
    const { token, exp } = await (await fetch(s.base + '/api/cast/token', { headers: auth })).json();
    assert.ok(exp * 1000 > Date.now() + 23 * 3600000);
    assert.strictEqual((await fetch(s.base + '/media/Filme/tv.mp4')).status, 401);
    assert.strictEqual((await fetch(s.base + '/media/Filme/tv.mp4?cast=' + token)).status, 200);
    assert.strictEqual((await fetch(s.base + '/media/Filme/tv.mp4?cast=' + token.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).status, 401, 'falsche Unterschrift');
    assert.strictEqual((await fetch(s.base + '/media/Filme/tv.mp4?cast=1000000000.' + token.split('.')[1])).status, 401, 'abgelaufen');
    for (const p of ['/api/version', '/api/settings', '/api/library', '/', '/index.html']) {
      assert.strictEqual((await fetch(s.base + p + '?cast=' + token)).status, 401, p + ' bleibt hinter der Anmeldung');
    }
  } finally { s.stop(); }
});
