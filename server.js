// Funscript Player – kleiner Webserver ohne externe Abhängigkeiten.
// Liefert die Weboberfläche aus, listet die Bibliothek und streamt Videos (mit Range-Support).

// Die Teile stehen in lib/: config, util, library, settings, data, stash, heresphere, hq, update, selfcheck.
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { AUTH_IGNORED, STASH_IGNORED, PLACEHOLDERS, AUTH_USER, LOGIN_EXAMPLE, LOGIN_OFF, HOST, MEDIA_DIR, MIME, PORT, PUBLIC_DIR, VERSION, VIDEO_EXT } = require('./lib/config');
const path = require('path');
const { loginBlocked, loginFailed } = require('./lib/guard');
const { readBody, safeJoin, sendFile, logSafe } = require('./lib/util');
const { libraryItems, libraryRescan, libraryScanMs } = require('./lib/library');
const { heresphereOn, hsAuthorized, hsRedirectOn, hsCheckPassword, hsToken, intifaceLanOnly, loginCheckHeader, loginOwnActive, publicSettings, serverSettings, setLoginPassword, writeSettings,
  LOGIN_RESET, LOGIN_RESET_DONE, loginMissing, loginSource, loginUser, removeLogin, setupLogin, setStashConf, stashConf } = require('./lib/settings');
const { deleteUserScript, handyCacheGet, handyCachePut, ownScriptFile, ownScripts, readPrefs, readStore, saveUserScript, scriptHeat, userScriptFile, writePrefs, writeStore } = require('./lib/data');
const { proxyStash, stashFilters, stashSavedFilters, stashScene, stashSceneAction, stashScenes, stashSetFavorite, stashSetRating, stashCheck, stashCurrent, stashMonitor, stashReconfigure } = require('./lib/stash');
const { HS_HEADERS, heresphereIndex, heresphereMedia, heresphereStash, isVrVideo } = require('./lib/heresphere');
const { GPU_TEXT, hqBench, hqKillAll, hqProbe, hqStatus, hqStream } = require('./lib/hq');
const { UPDATE_OFF, updateInfo } = require('./lib/update');
const { runSelfcheck } = require('./lib/selfcheck');

const sha = (s) => crypto.createHash('sha256').update(s).digest();

function authOk(req) {
  const user0 = loginUser();
  if (!user0) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString().split(':');
  const okUser = crypto.timingSafeEqual(sha(user), sha(user0));
  // test10/11: Passwort aus ⚙️ (lib/settings.js) – sonst AUTH_PASS aus der .env
  const okPass = loginCheckHeader(m[1], rest.join(':'));
  return okUser && okPass;
}

function checkAuth(req, res) {
  if (!loginUser()) return true;
  // 2.0: nach zu vielen Fehlversuchen eine Minute Pause (auch für das richtige Passwort)
  if (req.headers.authorization && loginBlocked(req)) {
    res.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Zu viele Fehlversuche – bitte eine Minute warten');
    return false;
  }
  if (authOk(req)) return true;
  if (req.headers.authorization) loginFailed(req);
  res.writeHead(401,{ 'WWW-Authenticate': 'Basic realm="Funscript Player", charset="UTF-8"' });
  res.end('Anmeldung erforderlich');
  return false;
}

async function loginPassRoute(req, res, reset) {
  if (loginBlocked(req)) return json(res, { error: 'blocked' }, 'no-store', 429);
  const body = JSON.parse(await readBody(req, 2000) || '{}');
  const r = await setLoginPassword(body.current, reset ? null : body.next);
  if (r.msg === 'wrongCurrent') loginFailed(req);
  json(res, r.status === 200 ? { ok: true, own: loginOwnActive() } : { error: r.msg }, 'no-store', r.status);
}

// test11: Anmeldung in ⚙️ einrichten (nur ohne Anmeldung) bzw. wieder entfernen (nur die in ⚙️ eingerichtete)
async function loginSetupRoute(req, res, remove) {
  if (loginBlocked(req)) return json(res, { error: 'blocked' }, 'no-store', 429);
  const body = JSON.parse(await readBody(req, 2000) || '{}');
  const r = remove ? await removeLogin(body.current) : await setupLogin(body.user, body.pass);
  if (r.msg === 'wrongCurrent') loginFailed(req);
  if (r.status === 200) logLine(remove ? 'Login removed in the interface' : `Login set up in the interface (user “${loginUser()}”)`);
  json(res, r.status === 200 ? { ok: true } : { error: r.msg }, 'no-store', r.status);
}
// test11: Stash-Adresse/API-Key aus ⚙️ – danach neu prüfen und Überwachung neu starten
async function stashConfRoute(req, res, reset) {
  const body = reset ? {} : JSON.parse(await readBody(req, 5000) || '{}');
  const r = await setStashConf(body, reset);
  if (r.status !== 200) return json(res, { error: r.msg }, 'no-store', r.status);
  stashReconfigure();
  const st = stashConf().url ? await stashCheck() : { configured: false };
  logLine(`Stash: connection changed in the interface → ${stashConf().url || 'none'} (${st.ok ? 'connected' : st.configured ? st.error : 'not configured'})`);
  startStashMonitor();
  json(res, { settings: publicSettings(), status: st });
}

// Optional direkt HTTPS: entweder TLS_PFX (+ TLS_PFX_PASS) oder TLS_CERT + TLS_KEY (PEM).
function tlsOptions() {
  if (process.env.TLS_PFX) return { pfx: fs.readFileSync(process.env.TLS_PFX), passphrase: process.env.TLS_PFX_PASS || '' };
  if (process.env.TLS_CERT && process.env.TLS_KEY) return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) };
  return null;
}
const tls = tlsOptions();

// Nicht in fremde Seiten einbetten, Dateitypen nicht raten, Adresse nicht an fremde Seiten weitergeben
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  // 1.19.5: Content-Security-Policy – nur eigene Skripte (keine eingeschleusten), Verbindungen nur zum eigenen Server,
  // zur Handy-Cloud und zu Intiface (ws:// im Heimnetz, wenn der Player ohne HTTPS läuft)
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:",
    "connect-src 'self' https://www.handyfeeling.com ws: wss:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
  'Referrer-Policy': 'same-origin',
};
// Kommt die Anfrage von dieser Seite? Ohne Origin (z. B. curl, Apps) gilt sie als eigene.
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}

// 2.0: Seite, solange keine Anmeldung eingerichtet und LOGIN=off nicht gesetzt ist.
// test11: Einrichtungsseite – Benutzer + Passwort hier festlegen (wie bei Portainer) oder wie bisher über die .env.
// Ohne JavaScript (normales Formular), Aussehen aus /setup.css (die Sicherheitsregeln erlauben kein Inline-CSS).
const SETUP_CSS = `body{font:16px/1.5 system-ui,sans-serif;max-width:34em;margin:2em auto;padding:0 1em;background:#0b0b0d;color:#eee}
h1{font-size:1.4em}label{display:block;margin:.8em 0}input{display:block;width:100%;box-sizing:border-box;margin-top:.3em;padding:.7em;
font:inherit;background:#18181c;color:#eee;border:1px solid #333;border-radius:8px}button{margin-top:1em;padding:.8em 1.4em;font:inherit;
font-weight:600;color:#fff;background:#7c3aed;border:0;border-radius:10px;cursor:pointer}.err{color:#ffb020}.note{color:#aaa;font-size:.9em}
code{background:#222;padding:0 .3em;border-radius:4px}hr{border:0;border-top:1px solid #333;margin:2em 0}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SETUP_ERR = {
  badUser: 'Please enter a user name (no colon) · Bitte einen Benutzernamen eingeben (ohne Doppelpunkt)',
  tooShort: 'The password needs at least 8 characters · Das Passwort braucht mindestens 8 Zeichen',
  example: 'Please choose your own password · Bitte ein eigenes Passwort wählen',
  mismatch: 'The passwords don’t match · Die Passwörter stimmen nicht überein',
  blocked: 'Too many attempts – wait a minute · Zu viele Versuche – eine Minute warten',
  origin: 'Please send the form from this page · Bitte das Formular auf dieser Seite absenden',
};
const loginPage = (err = '', user = '') => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Funscript Player – set up a login</title><link rel="stylesheet" href="/setup.css">
<h1>Funscript Player: set up a login · Anmeldung einrichten</h1>
<p>The player needs a login – otherwise everyone who can reach it sees your library and Handy key.<br>
<span lang="de">Der Player braucht eine Anmeldung – sonst sieht jeder, der ihn erreicht, deine Bibliothek und den Handy-Key.</span></p>
${LOGIN_EXAMPLE ? '<p class="err">AUTH_PASS in the .env is still the example password <code>change-me</code> – it does not count. · Das Beispielpasswort <code>change-me</code> gilt nicht.</p>' : ''}
${err ? `<p class="err">${esc(SETUP_ERR[err] || err)}</p>` : ''}
<form method="post" action="/setup-login">
<label>User name · Benutzername<input name="user" autocomplete="username" required maxlength="64" value="${esc(user)}"></label>
<label>Password (at least 8 characters) · Passwort (mind. 8 Zeichen)<input name="pass" type="password" autocomplete="new-password" required minlength="8"></label>
<label>Repeat password · Passwort wiederholen<input name="pass2" type="password" autocomplete="new-password" required minlength="8"></label>
<button type="submit">Set up login · Anmeldung einrichten</button>
</form>
<p class="note">Afterwards the browser asks for user name and password. Change or remove it later in ⚙️ → Security &amp; privacy.
Forgotten? Add <code>LOGIN_RESET=1</code> to the .env, run <code>docker compose up -d</code>, then remove the line again.<br>
<span lang="de">Danach fragt der Browser nach Benutzer und Passwort. Ändern oder entfernen später in ⚙️ → Sicherheit &amp; Privatsphäre.
Vergessen? <code>LOGIN_RESET=1</code> in die .env, <code>docker compose up -d</code>, Zeile danach wieder entfernen.</span></p>
<hr><p class="note">Alternatively in the <code>.env</code>: <code>AUTH_USER=</code> + <code>AUTH_PASS=</code> (takes precedence), or <code>LOGIN=off</code>
if the player is protected otherwise (e.g. a reverse proxy with its own login). Then <code>docker compose up -d</code>.<br>
<span lang="de">Alternativ in der <code>.env</code>: <code>AUTH_USER</code>/<code>AUTH_PASS</code> (gehen vor) oder <code>LOGIN=off</code>, wenn er anders
geschützt ist (z. B. Reverse Proxy mit eigener Anmeldung).</span></p>`;
async function loginSetupPage(req, res) {
  const path0 = req.url.split('?')[0];
  if (path0 === '/setup.css') {
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
    return res.end(SETUP_CSS);
  }
  const page = (status, err, user) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(loginPage(err, user));
  };
  if (path0 !== '/setup-login' || req.method !== 'POST') return page(503);
  if (!sameOrigin(req)) return page(403, 'origin');
  if (loginBlocked(req)) return page(429, 'blocked');
  const f = new URLSearchParams(await readBody(req, 4000));
  if (f.get('pass') !== f.get('pass2')) return page(400, 'mismatch', f.get('user') || '');
  const r = await setupLogin(f.get('user'), f.get('pass'));
  if (r.status !== 200) { loginFailed(req); return page(r.status === 409 ? 503 : 400, r.msg, f.get('user') || ''); }
  logLine(`Login set up on the setup page (user “${loginUser()}”)`);
  res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
  res.end();
}

// Antworten und kleine Helfer für die Routen
const json = (res, data, cache = 'no-store', status = 200) => {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': cache });
  res.end(JSON.stringify(data));
};
const noContent = (res) => { res.writeHead(204); res.end(); };
const needStash = () => { if (!stashConf().url) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 }); };
const userSrc = (url) => {
  const src = url.searchParams.get('src') || '';
  if (!/^(stash|media):/.test(src)) throw Object.assign(new Error('Ungültige Quelle'), { status: 400 });
  return src;
};

// Fehlermeldungen aus dem Browser (stiller Selbsttest, JavaScript-Fehler) – höchstens 20 pro Minute in „docker logs“
let clientLogs = { at: 0, n: 0 };
async function clientReport(req, res) {
  const r = JSON.parse((await readBody(req, 20000)) || '{}');
  const fails = Array.isArray(r.fails) ? r.fails.slice(0, 20).map((f) => String(f).replace(/\s+/g, ' ').slice(0, 200)) : [];
  if (Date.now() - clientLogs.at > 60000) clientLogs = { at: Date.now(), n: 0 };
  if (fails.length && clientLogs.n++ < 20) logLine(`Interface (${String(r.ua || '').replace(/\s+/g, ' ').slice(0, 60)}): ✗ ${fails.join(' · ')}`);
  noContent(res);
}

// Feste Pfade: { pfad: { METHODE: (req, res, url) => … } }
const ROUTES = {
  '/api/store': {
    GET: async (req, res) => json(res, await readStore()),
    PUT: async (req, res) => { await writeStore(req); noContent(res); },
  },
  '/api/prefs': {
    GET: async (req, res) => json(res, await readPrefs()),
    PUT: async (req, res) => { await writePrefs(req); json(res, await readPrefs()); },
  },
  '/api/userscript': {
    POST: async (req, res) => json(res, await saveUserScript(req)),
    // ?name=… = benanntes eigenes Script (2.0), ohne = das eine eigene Script der Szene
    GET: async (req, res, url) => {
      const src = userSrc(url), name = url.searchParams.get('name');
      if (name === null) return sendFile(req, res, (await ownScriptFile(src)) || userScriptFile(src));
      const file = await ownScriptFile(src, name);
      if (!file) throw Object.assign(new Error('Kein eigenes Script'), { status: 404 });
      return sendFile(req, res, file);
    },
    DELETE: async (req, res, url) => { const name = url.searchParams.get('name'); await deleteUserScript(userSrc(url), name ?? undefined); noContent(res); },
  },
  // Welche Videos ein eigenes Script haben (für ✋ in der Bibliothek und die Script-Wahl)
  '/api/userscripts': { GET: async (req, res) => json(res, await ownScripts()) },
  '/api/heat': { GET: async (req, res, url) => json(res, await scriptHeat(url.searchParams.get('src')), 'max-age=3600') },
  // test11: Anmeldung in ⚙️ einrichten (POST, nur ohne Anmeldung) / entfernen (DELETE, nur die in ⚙️ eingerichtete)
  '/api/login/setup': {
    POST: async (req, res) => loginSetupRoute(req, res, false),
    DELETE: async (req, res) => loginSetupRoute(req, res, true),
  },
  // test11: Stash-Adresse + API-Key aus ⚙️ (PUT), DELETE = wieder die Werte aus der .env
  '/api/stash/config': {
    PUT: async (req, res) => stashConfRoute(req, res, false),
    DELETE: async (req, res) => stashConfRoute(req, res, true),
  },
  // test10: Player-Passwort ändern (Anmeldung aus .env oder ⚙️); DELETE = wieder das Passwort aus der .env
  '/api/login/password': {
    POST: async (req, res) => loginPassRoute(req, res, false),
    DELETE: async (req, res) => loginPassRoute(req, res, true),
  },
  '/api/settings': {
    GET: async (req, res) => json(res, publicSettings()),
    PUT: async (req, res) => { await writeSettings(req); json(res, publicSettings()); },
  },
  '/api/handycache': {
    GET: async (req, res, url) => { const hit = await handyCacheGet(url.searchParams.get('k') || ''); json(res, hit || {}, 'no-store', hit ? 200 : 404); },
    PUT: async (req, res) => { await handyCachePut(req); noContent(res); },
  },
  '/api/clientcheck': { POST: clientReport },
  '/api/update': { GET: async (req, res) => json(res, await updateInfo()) },
  '/api/library': {
    GET: async (req, res) => json(res, (await libraryItems()).map((it) => ({ ...it, vr: isVrVideo(it.video) }))
      .sort((a, b) => a.video.localeCompare(b.video, 'de', { numeric: true }))),
  },
  // test10: zwischengespeicherter Zustand (prüft im Hintergrund selbst neu); ?fresh=1 = „Verbindung testen“
  '/api/stash/status': { GET: async (req, res) => json(res, /[?&]fresh=1/.test(req.url) ? await stashCheck() : await stashCurrent()) },
  '/api/stash/saved-filters': { GET: async (req, res) => { needStash(); json(res, (await stashSavedFilters()).map(({ id, name }) => ({ id, name }))); } },
  '/api/stash/filters': { GET: async (req, res) => { needStash(); json(res, await stashFilters()); } },
  '/api/stash/scenes': { GET: async (req, res, url) => { needStash(); json(res, await stashScenes(url.searchParams)); } },
  '/hq/stream': { GET: (req, res, url) => hqStream(req, res, url.searchParams) },
  '/api/hq/status': { GET: async (req, res) => json(res, await hqStatus()) },
  '/api/hq/probe': { GET: async (req, res, url) => json(res, await hqProbe(url.searchParams.get('src'))) },
  '/api/hq/bench': { GET: async (req, res, url) => json(res, await hqBench(url.searchParams)) },
};

// LOG_LEVEL=debug: jede Anfrage; sonst nur langsame (> 1 s) API-Anfragen – Videos/Streams nicht
const LOG_DEBUG = /^debug$/i.test(process.env.LOG_LEVEL || '');
const handler = async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (LOG_DEBUG || (ms > 1000 && /^\/(api|heresphere)/.test(req.url))) {
      logLine(`${ms > 1000 ? 'slow' : 'request'}: ${req.method} ${req.url.split('?')[0]} → ${res.statusCode} in ${ms} ms`);
    }
  });
  try {
    if (req.url === '/healthz') return res.end('ok'); // für den Docker-Healthcheck – ohne Anmeldung, verrät nichts
    // 2.0: keine Anmeldung eingerichtet und nicht bewusst abgeschaltet → nur die Einrichtungsseite, sonst nichts
    if (loginMissing()) return await loginSetupPage(req, res);
    // 2.0: HereSphere mit der normalen Adresse → gleich zur VR-Bibliothek. Vor der Anmeldung, denn HereSphere kann
    // keine Browser-Anmeldung; umgeleitet wird nur genau „/“, alles andere bleibt hinter der Anmeldung.
    if (req.url.split('?')[0] === '/' && (req.method === 'GET' || req.method === 'HEAD') && /HereSphere/i.test(req.headers['user-agent'] || '') && hsRedirectOn()) {
      res.writeHead(302, { Location: '/heresphere', 'Cache-Control': 'no-store' });
      return res.end();
    }
    // 2.0: HereSphere kann keine Browser-Anmeldung. Mit eigenem HereSphere-Passwort prüft der Player /heresphere selbst
    // (Token je Anfrage) – dann gilt die Anmeldung dort nicht. Ohne Passwort bleibt auch /heresphere hinter der Anmeldung.
    const hsOwnLogin = /^\/heresphere(\/|$)/.test(req.url.split('?')[0]) && heresphereOn() && !!serverSettings.hsPass;
    if (!hsOwnLogin && !checkAuth(req, res)) return;
    // 1.19.10: Versionsnummer erst nach der Anmeldung (CodeQL #17)
    if (req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ version: VERSION }));
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    // Änderungen nur von der eigenen Seite – fremde Webseiten im selben Browser dürfen nichts auslösen.
    // HereSphere (eigene App, ohne Origin) hat dafür das optionale Passwort.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !pathname.startsWith('/heresphere') && !sameOrigin(req)) {
      throw Object.assign(new Error('Fremde Herkunft'), { status: 403 });
    }

    // Feste Pfade aus der Tabelle (ROUTES), GET gilt auch für HEAD
    const route = ROUTES[pathname];
    if (route) {
      const fn = route[req.method === 'HEAD' ? 'GET' : req.method];
      if (!fn) throw Object.assign(new Error('Methode nicht erlaubt'), { status: 405 });
      return await fn(req, res, url);
    }

    const sa = /^\/api\/stash\/scene\/(\d+)(?:\/(activity|play|rating|favorite|o|o-undo|marker))?$/.exec(pathname);
    if (sa) {
      needStash();
      if (sa[2] && req.method === 'POST') return json(res, (await stashSceneAction(sa[1], sa[2], req)) || { ok: true });
      if (!sa[2] && req.method === 'GET') return json(res, await stashScene(sa[1]));
      throw Object.assign(new Error('Methode nicht erlaubt'), { status: 405 });
    }

    // HereSphere fragt per GET oder POST an. Bei Stash-Szenen enthält der POST ggf. eine
    // neue Bewertung (0–5) oder den Favoriten-Status – das wird nach Stash geschrieben.
    if (pathname === '/heresphere' || pathname.startsWith('/heresphere/')) {
      // Abgeschaltet: keine Antwort – die Ausnahme in der Proxy-Anmeldung kann dann weg
      if (!heresphereOn()) throw Object.assign(new Error('HereSphere ist abgeschaltet'), { status: 404 });
      // 2.0: Videos, Scripts und Vorschauen für HereSphere nur hier – jede Anfrage mit Token geprüft. So reicht im
      // Proxy die Ausnahme für /heresphere; /stash/… und /media/… bleiben immer hinter der Anmeldung.
      const hf = /^\/heresphere\/file\/(?:stash\/(\d+)\/(stream|funscript|screenshot|preview)|media\/(.+))$/.exec(pathname);
      if (hf) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Methode nicht erlaubt'), { status: 405 });
        if (!hsAuthorized(req, url)) throw Object.assign(new Error('Anmeldung erforderlich'), { status: 401 });
        url.searchParams.delete('hs'); // Token nicht an Stash weitergeben
        if (hf[1]) {
          needStash();
          return await proxyStash(req, res, 'scene', hf[1], hf[2], url.search);
        }
        const ext = path.extname(hf[3]).toLowerCase();
        const file = (VIDEO_EXT.has(ext) || ext === '.funscript') && safeJoin(MEDIA_DIR, hf[3]);
        if (!file) throw Object.assign(new Error('Nicht erlaubt'), { status: 403 });
        return sendFile(req, res, file);
      }
      let body = {};
      try { body = JSON.parse((await readBody(req, 100000)) || '{}'); } catch { body = {}; }
      let data;
      if (pathname === '/heresphere/auth') {
        // Anmeldung aus HereSphere (Benutzername egal) -> Token, das HereSphere bei jeder Anfrage mitschickt
        // 2.0: Bremse – nach zu vielen Fehlversuchen eine Minute lang keine Anmeldung
        const ok = !loginBlocked(req) && hsCheckPassword(String(body.password || ''));
        if (!ok && serverSettings.hsPass) loginFailed(req);
        data = ok ? { 'auth-token': hsToken(), access: 1 } : { 'auth-token': '', access: -1 };
      } else if (!hsAuthorized(req, url)) {
        // -1 = Anmeldung nötig: HereSphere fragt dann nach Benutzer und Passwort
        data = { access: -1, library: [] };
      } else if (pathname === '/heresphere' || pathname === '/heresphere/') data = await heresphereIndex(req);
      else if (/^\/heresphere\/stash\/\d+$/.test(pathname)) {
        needStash();
        const id = pathname.split('/').pop();
        data = await heresphereStash(req, id); // prüft vorher „nur VR“
        if (typeof body.rating === 'number') {
          await stashSetRating(id, body.rating * 20).catch((e) => logLine(`HereSphere rating not saved: ${e.message}`));
          data.rating = body.rating;
        }
        if (typeof body.isFavorite === 'boolean') {
          await stashSetFavorite(id, body.isFavorite).catch((e) => logLine(`HereSphere favourite not saved: ${e.message}`));
          data.isFavorite = body.isFavorite;
        }
      } else if (pathname.startsWith('/heresphere/media/')) data = await heresphereMedia(req, pathname.slice('/heresphere/media/'.length), body.needsMediaSource !== false);
      else throw Object.assign(new Error('Nicht gefunden'), { status: 404 });
      res.writeHead(200, HS_HEADERS);
      return res.end(JSON.stringify(data));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }

    // Durchgereicht werden nur diese Stash-Dateien: Videos, Funscript, Vorschauen, Spul-Sprites und Bilder
    const sm = /^\/stash\/(scene)\/(\d+)\/(stream|stream\.mp4|funscript|screenshot|preview|webp|vtt\/thumbs|vtt\/sprite)$/.exec(pathname)
      || /^\/stash\/(tag|performer|studio)\/(\d+)\/(image)$/.exec(pathname);
    if (sm) {
      needStash();
      return await proxyStash(req, res, sm[1], sm[2], sm[3], url.search);
    }

    // Dateien: /media/… aus den Videoordnern, sonst die Oberfläche
    const file = pathname.startsWith('/media/') ? safeJoin(MEDIA_DIR, pathname.slice('/media/'.length))
      : safeJoin(PUBLIC_DIR, pathname === '/' || pathname === '/demo' ? 'index.html' : pathname.slice(1));
    if (!file) {
      res.writeHead(403);
      return res.end();
    }
    return sendFile(req, res, file);
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(err);
    // Stash/Handy-Cache nicht erreichbar (502/503/504): auch in „docker logs“, sonst sieht man nur die Oberfläche
    else if (status >= 502) logLine(`Error ${status}: ${req.method} ${req.url.split('?')[0]} – ${err.message}`);
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 500 ? 'Serverfehler' : err.message);
  }
};

const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// WebSocket-Weiterleitung /intiface?target=IP:PORT -> ws://IP:PORT (Intiface Central auf dem Smartphone).
// Nötig, weil eine HTTPS-Seite keine unverschlüsselte ws://-Verbindung öffnen darf.
// Erlaubt sind nur private IPv4-Adressen; mit „nur Heimnetz“ (Standard seit 1.19.5, ⚙️ → Geräte / INTIFACE_LAN_ONLY)
// nur 192.168.x und 10.x – also keine Docker-Netze (172.x) und nichts im Container selbst (127.x).
const PRIVATE_IP = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|127\.\d+)\.\d+\.\d+$/;
const LAN_IP = /^(10\.\d+|192\.168)\.\d+\.\d+$/;
// 1.19.5: nur der Intiface-Port (Standard 12345, mehrere mit Komma in INTIFACE_PORTS) – so wird die
// Weiterleitung kein Tunnel zu beliebigen Diensten im Netz
const INTIFACE_PORTS = new Set((process.env.INTIFACE_PORTS || '12345').split(',').map((p) => Number(p.trim())).filter(Boolean));

server.on('upgrade', (req, socket, head) => {
  const fail = (code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.on('error', () => {});
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/intiface') return fail(404, 'Not Found');
  if (loginMissing() || !authOk(req)) return fail(401, 'Unauthorized');
  if (!sameOrigin(req)) return fail(403, 'Forbidden'); // keine Verbindung von fremden Webseiten
  const m = /^([\d.]+):(\d{1,5})$/.exec(url.searchParams.get('target') || '');
  if (!m || !(intifaceLanOnly() ? LAN_IP : PRIVATE_IP).test(m[1]) || !INTIFACE_PORTS.has(Number(m[2]))) return fail(400, 'Bad Request');

  const upstream = net.connect(Number(m[2]), m[1]);
  upstream.setTimeout(5000, () => upstream.destroy(new Error('timeout')));
  upstream.on('connect', () => {
    upstream.setTimeout(0);
    const lines = ['GET / HTTP/1.1', `Host: ${m[1]}:${m[2]}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (!/^(host|authorization|cookie)$/i.test(name)) lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', (err) => {
    if (!socket.destroyed && socket.bytesWritten === 0) fail(502, 'Bad Gateway');
    else socket.destroy();
    console.warn(logSafe(`Intiface ${m[1]}:${m[2]} not reachable: ${err.message}`));
  });
  socket.on('close', () => upstream.destroy());
});

// Start-Übersicht in „docker logs“ (seit 1.19.7 englisch): was gefunden wurde, was erreichbar ist – und wann der Player bereit ist
const logLine = (msg) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${logSafe(msg)}`);
// 2.0 nach test7: Docker stoppt mit SIGTERM. Ohne Behandlung ignoriert Node als Prozess 1 das Signal und Docker
// wartet 10 s bis zum harten Abbruch. So: ffmpeg beenden, Verbindungen schließen, sofort raus.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    logLine(`Stopping (${sig}) …`);
    hqKillAll();
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
// Stash ab 0.32 lehnt fremde Netze ohne Stash-Anmeldung mit 403 ab – erklären, was zu tun ist
function logStash403(st) {
  logLine('  Stash 0.32+ rejects requests from networks it considers public when Stash has no login. Either:');
  logLine(`  a) in Stash's config.yml: public_whitelist: [${(st.networks || []).map((n) => '"' + n + '"').join(', ') || '"<docker network>/16"'}] – then restart Stash, or`);
  logLine('  b) set a user + password in Stash (Settings → Security) and put its API key into ⚙️ → Library or STASH_API_KEY.');
}
// Stash von selbst neu prüfen (alle 30 s / 5 min) und Wechsel ins Log schreiben – auch nach Änderung in ⚙️
function startStashMonitor() {
  stashMonitor((now) => {
    if (now.ok) logLine(`Stash: reachable again (version ${now.version || '?'})`);
    else { logLine(`Stash: no longer reachable – ${now.error}`); if (now.code === 'forbidden') logStash403(now); }
  });
}
server.listen(PORT, HOST, async () => {
  logLine(`Funscript Player ${VERSION} – listening on ${tls ? 'https' : 'http'}://${HOST}:${PORT}`);
  // test11: welche Anmeldung gilt – .env > in ⚙️ eingerichtet > LOGIN=off > Einrichtungsseite
  if (LOGIN_RESET_DONE) logLine('LOGIN_RESET=1: the login set in the interface was removed – now remove LOGIN_RESET from .env again.');
  else if (LOGIN_RESET) logLine('Note: LOGIN_RESET=1 is set but there was nothing to reset – remove the line from .env.');
  if (LOGIN_EXAMPLE) logLine('⚠ AUTH_PASS is still the example password "change-me" – it does not count.');
  const src = loginSource();
  if (src === 'env') logLine(`Login: from .env (user “${AUTH_USER}”${loginOwnActive() ? ', password changed in the interface' : ''})${serverSettings.uiLogin ? ' – the login set in the interface is ignored' : ''}`);
  else if (src === 'ui') logLine(`Login: set up in the interface (user “${loginUser()}”)${LOGIN_OFF ? ' – takes precedence over LOGIN=off' : ''}`);
  else if (src === 'off') logLine('Login: off (LOGIN=off) – everyone who reaches the player sees your library and Handy key. A login can be set up in ⚙️.');
  else logLine('⚠ NO LOGIN SET UP: the player shows the setup page – set user + password there (or AUTH_USER + AUTH_PASS in .env, or LOGIN=off).');
  if (AUTH_IGNORED) logLine('Note: LOGIN=off – AUTH_USER/AUTH_PASS in .env are ignored.');
  if (STASH_IGNORED) logLine('Note: STASH=off – STASH_URL/STASH_API_KEY in .env are ignored.');
  if (stashConf().source === 'ui') logLine('Stash: address/API key set in the interface (overrides STASH_URL/STASH_API_KEY from .env)');
  if (PLACEHOLDERS.length) logLine(`Note: placeholder <…> in .env counts as empty: ${PLACEHOLDERS.join(', ')}`);
  logLine(`Library: reading ${MEDIA_DIR} …`);
  const STASH_URL = stashConf().url;
  const [lib, stash, hqs] = await Promise.allSettled([libraryRescan(), STASH_URL ? stashCheck() : null, hqStatus()]);
  if (lib.status === 'fulfilled') {
    const roots = new Set(lib.value.map((it) => it.root || '(main folder)'));
    logLine(`Library: ${lib.value.length} videos, ${lib.value.filter((it) => it.script).length} with Funscript, ${roots.size} folders – scanned in ${libraryScanMs()} ms`);
  } else logLine(`Library: error – ${lib.reason?.message}`);
  if (!STASH_URL) logLine('Stash: not configured');
  else if (stash.value?.ok) logLine(`Stash: connected (${STASH_URL}, version ${stash.value.version || '?'})`);
  else logLine(`Stash: NOT reachable (${STASH_URL}) – ${stash.value?.error || stash.reason?.message || 'unknown'}`);
  if (stash.value?.code === 'forbidden') logStash403(stash.value);
  if (STASH_URL) {
    if (!stash.value?.ok) logLine('Stash: trying again every 30 s …');
    startStashMonitor();
  }
  logLine(`HQ stream: ${hqs.value?.available ? (hqs.value.accel === 'vaapi' ? 'Intel graphics (VAAPI)' : 'CPU') : 'not available (no ffmpeg)'}`);
  const gpu = hqs.value?.gpu;
  if (gpu) logLine(`Graphics: ${GPU_TEXT[gpu.state]}${gpu.error ? ' – ' + gpu.error : ''}`);
  if (UPDATE_OFF) logLine('Update check: off (UPDATE_CHECK=off)');
  const checks = await runSelfcheck().catch((e) => [{ name: 'Self-test', ok: false, info: e.message }]);
  const bad = checks.filter((c) => !c.ok);
  logLine(`Self-test: ${checks.length - bad.length}/${checks.length} ok${bad.length ? '' : ' (server, interface, script intensity)'}`);
  for (const c of bad) logLine(`  ✗ ${c.name}${c.info ? ' – ' + c.info : ''}`);
  logLine(`HereSphere: ${heresphereOn() ? (serverSettings.hsPass ? 'on, with password' : 'on') : 'off'} · Intiface: ${intifaceLanOnly() ? 'home network only' : 'private addresses'}`);
  logLine('✓ ready');
});
