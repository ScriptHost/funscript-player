// Funscript Player – kleiner Webserver ohne externe Abhängigkeiten.
// Liefert die Weboberfläche aus, listet die Bibliothek und streamt Videos (mit Range-Support).

// Die Teile stehen in lib/: config, util, library, settings, data, stash, heresphere, hq, update, selfcheck.
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { AUTH_IGNORED, PLACEHOLDERS, AUTH_PASS, AUTH_USER, LOGIN_EXAMPLE, LOGIN_MISSING, HOST, MEDIA_DIR, MIME, PORT, PUBLIC_DIR, STASH_URL, VERSION, VIDEO_EXT } = require('./lib/config');
const path = require('path');
const { loginBlocked, loginFailed } = require('./lib/guard');
const { readBody, safeJoin, sendFile, logSafe } = require('./lib/util');
const { libraryItems, libraryRescan, libraryScanMs } = require('./lib/library');
const { heresphereOn, hsAuthorized, hsCheckPassword, hsToken, intifaceLanOnly, publicSettings, serverSettings, writeSettings } = require('./lib/settings');
const { deleteUserScript, handyCacheGet, handyCachePut, ownScriptFile, ownScripts, readPrefs, readStore, saveUserScript, scriptHeat, userScriptFile, writePrefs, writeStore } = require('./lib/data');
const { proxyStash, stashFilters, stashSavedFilters, stashScene, stashSceneAction, stashScenes, stashSetFavorite, stashSetRating, stashStatus } = require('./lib/stash');
const { HS_HEADERS, heresphereIndex, heresphereMedia, heresphereStash } = require('./lib/heresphere');
const { GPU_TEXT, hqBench, hqProbe, hqStatus, hqStream } = require('./lib/hq');
const { UPDATE_OFF, updateInfo } = require('./lib/update');
const { runSelfcheck } = require('./lib/selfcheck');

const sha = (s) => crypto.createHash('sha256').update(s).digest();

function authOk(req) {
  if (!AUTH_USER) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString().split(':');
  const okUser = crypto.timingSafeEqual(sha(user), sha(AUTH_USER));
  const okPass = crypto.timingSafeEqual(sha(rest.join(':')), sha(AUTH_PASS));
  return okUser && okPass;
}

function checkAuth(req, res) {
  if (!AUTH_USER) return true;
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

// 2.0: Seite, solange weder AUTH_USER/AUTH_PASS noch LOGIN=off gesetzt ist
const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Funscript Player – set up a login</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:2em auto;padding:0 1em;background:#111;color:#eee">
<h1>Funscript Player: please set up a login</h1>
<p>Since 2.0 the player needs a login, because otherwise everyone who can reach it also sees your
Handy connection key and your library.</p>
<p>In the <code>.env</code> file next to <code>docker-compose.yml</code>, either</p>
<p><b>Still set to the example password <code>change-me</code>? Choose your own.</b></p>
<ul><li>set <code>AUTH_USER=</code> and <code>AUTH_PASS=</code> (recommended), or</li>
<li>set <code>LOGIN=off</code> if the player is protected otherwise (e.g. a reverse proxy with its own login).</li></ul>
<p>Then run <code>docker compose up -d</code>.</p>
<hr><p lang="de">Seit 2.0 braucht der Player eine Anmeldung. In der <code>.env</code> entweder
<code>AUTH_USER</code>/<code>AUTH_PASS</code> setzen (empfohlen – das Beispielpasswort <code>change-me</code> gilt nicht) oder <code>LOGIN=off</code>, wenn er anders geschützt ist
(z. B. Reverse Proxy mit eigener Anmeldung). Danach <code>docker compose up -d</code>.</p>`;

// Antworten und kleine Helfer für die Routen
const json = (res, data, cache = 'no-store', status = 200) => {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': cache });
  res.end(JSON.stringify(data));
};
const noContent = (res) => { res.writeHead(204); res.end(); };
const needStash = () => { if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 }); };
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
    GET: async (req, res) => json(res, (await libraryItems()).sort((a, b) => a.video.localeCompare(b.video, 'de', { numeric: true }))),
  },
  '/api/stash/status': { GET: async (req, res) => json(res, await stashStatus()) },
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
    // 2.0: keine Anmeldung eingerichtet und nicht bewusst abgeschaltet → nur eine Erklärseite, sonst nichts
    if (LOGIN_MISSING) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      return res.end(LOGIN_PAGE);
    }
    if (!checkAuth(req, res)) return;
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
      : safeJoin(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
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
  if (LOGIN_MISSING || !authOk(req)) return fail(401, 'Unauthorized');
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
server.listen(PORT, HOST, async () => {
  logLine(`Funscript Player ${VERSION} – listening on ${tls ? 'https' : 'http'}://${HOST}:${PORT}`);
  if (LOGIN_EXAMPLE) logLine('⚠ AUTH_PASS is still the example password "change-me" – choose your own in .env. Until then the player only shows a help page.');
  else if (LOGIN_MISSING) logLine('⚠ NO LOGIN SET UP: the player only shows a help page. Set AUTH_USER + AUTH_PASS in .env – or LOGIN=off if a proxy protects it.');
  else if (!AUTH_USER) logLine('Note: login switched off (LOGIN=off) – everyone who reaches the player sees your library and Handy key.');
  if (AUTH_IGNORED) logLine('Note: LOGIN=off – AUTH_USER/AUTH_PASS in .env are ignored.');
  if (PLACEHOLDERS.length) logLine(`Note: placeholder <…> in .env counts as empty: ${PLACEHOLDERS.join(', ')}`);
  logLine(`Library: reading ${MEDIA_DIR} …`);
  const [lib, stash, hqs] = await Promise.allSettled([libraryRescan(), STASH_URL ? stashStatus() : null, hqStatus()]);
  if (lib.status === 'fulfilled') {
    const roots = new Set(lib.value.map((it) => it.root || '(main folder)'));
    logLine(`Library: ${lib.value.length} videos, ${lib.value.filter((it) => it.script).length} with Funscript, ${roots.size} folders – scanned in ${libraryScanMs()} ms`);
  } else logLine(`Library: error – ${lib.reason?.message}`);
  if (!STASH_URL) logLine('Stash: not configured');
  else if (stash.value?.ok) logLine(`Stash: connected (${STASH_URL}, version ${stash.value.version || '?'})`);
  else logLine(`Stash: NOT reachable (${STASH_URL}) – ${stash.value?.error || stash.reason?.message || 'unknown'}`);
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
