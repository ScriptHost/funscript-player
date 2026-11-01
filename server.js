// Funscript Player – kleiner Webserver ohne externe Abhängigkeiten.
// Liefert die Weboberfläche aus, listet die Bibliothek und streamt Videos (mit Range-Support).

// Die Teile stehen in lib/: config, util, library, settings, data, stash, heresphere, hq, remote.
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { AUTH_PASS, AUTH_USER, HOST, MEDIA_DIR, MIME, PORT, PUBLIC_DIR, STASH_URL, VERSION } = require('./lib/config');
const { readBody, safeJoin, sendFile } = require('./lib/util');
const { libraryItems, libraryRescan, libraryScanMs } = require('./lib/library');
const { heresphereOn, hsAuthorized, hsHash, hsToken, intifaceLanOnly, publicSettings, serverSettings, writeSettings } = require('./lib/settings');
const { backupGet, backupPut, deleteUserScript, handyCacheGet, handyCachePut, ownScriptFile, ownScripts, readPrefs, readStore, saveUserScript, scriptHeat, userScriptFile, writePrefs, writeStore } = require('./lib/data');
const { proxyStash, stashFilters, stashSavedFilters, stashScene, stashSceneAction, stashScenes, stashSetFavorite, stashSetRating, stashStatus } = require('./lib/stash');
const { HS_HEADERS, heresphereIndex, heresphereMedia, heresphereStash } = require('./lib/heresphere');
const { hqBench, hqProbe, hqStatus, hqStream } = require('./lib/hq');
const { rcEvents, rcPost } = require('./lib/remote');

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
  if (authOk(req)) return true;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Funscript Player", charset="UTF-8"' });
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
  'Content-Security-Policy': "frame-ancestors 'self'",
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

// LOG_LEVEL=debug: jede Anfrage; sonst nur langsame (> 1 s) API-Anfragen – Videos/Streams nicht
const LOG_DEBUG = /^debug$/i.test(process.env.LOG_LEVEL || '');
const handler = async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (LOG_DEBUG || (ms > 1000 && /^\/(api|heresphere)/.test(req.url) && !req.url.startsWith('/api/remote/events'))) {
      logLine(`${ms > 1000 ? 'langsam' : 'Anfrage'}: ${req.method} ${req.url.split('?')[0]} → ${res.statusCode} in ${ms} ms`);
    }
  });
  try {
    if (req.url === '/healthz') return res.end('ok');
    if (req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ version: VERSION }));
    }
    if (!checkAuth(req, res)) return;
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    // Änderungen nur von der eigenen Seite – fremde Webseiten im selben Browser dürfen nichts auslösen.
    // HereSphere (eigene App, ohne Origin) hat dafür das optionale Passwort.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !pathname.startsWith('/heresphere') && !sameOrigin(req)) {
      throw Object.assign(new Error('Fremde Herkunft'), { status: 403 });
    }

    if (pathname === '/api/store') {
      if (req.method === 'PUT') {
        await writeStore(req);
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await readStore()));
    }

    if (pathname === '/api/remote/time') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ now: Date.now() }));
    }
    if (pathname === '/api/remote/events' && req.method === 'GET') return rcEvents(req, res, url.searchParams);
    if ((pathname === '/api/remote/state' || pathname === '/api/remote/cmd') && req.method === 'POST') {
      await rcPost(req, pathname.endsWith('state') ? 'state' : 'cmd');
      res.writeHead(204);
      return res.end();
    }

    const sa = /^\/api\/stash\/scene\/(\d+)(?:\/(activity|play|rating|favorite|o|o-undo|marker))?$/.exec(pathname);
    if (sa) {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      if (sa[2] && req.method === 'POST') {
        const result = await stashSceneAction(sa[1], sa[2], req);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(JSON.stringify(result || { ok: true }));
      }
      if (!sa[2] && req.method === 'GET') {
        const scene = await stashScene(sa[1]);
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(scene));
      }
      throw Object.assign(new Error('Methode nicht erlaubt'), { status: 405 });
    }

    // HereSphere fragt per GET oder POST an. Bei Stash-Szenen enthält der POST ggf. eine
    // neue Bewertung (0–5) oder den Favoriten-Status – das wird nach Stash geschrieben.
    if (pathname === '/api/prefs') {
      if (req.method === 'PUT') await writePrefs(req);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await readPrefs()));
    }
    if (pathname === '/api/userscript') {
      if (req.method === 'POST') {
        const r = await saveUserScript(req);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(JSON.stringify(r));
      }
      const src = url.searchParams.get('src') || '';
      if (!/^(stash|media):/.test(src)) throw Object.assign(new Error('Ungültige Quelle'), { status: 400 });
      if (req.method === 'DELETE') {
        await deleteUserScript(src);
        res.writeHead(204);
        return res.end();
      }
      return sendFile(req, res, (await ownScriptFile(src)) || userScriptFile(src));
    }
    if (pathname === '/api/backup') {
      if (req.method === 'PUT') {
        await backupPut(req);
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await backupGet()));
    }
    if (pathname === '/api/userscripts') {
      // Welche Videos ein eigenes Script haben (für ✋ in der Bibliothek und die Script-Wahl)
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await ownScripts()));
    }
    if (pathname === '/api/heat') {
      const heat = await scriptHeat(url.searchParams.get('src'));
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'max-age=3600' });
      return res.end(JSON.stringify(heat));
    }

    if (pathname === '/api/settings') {
      if (req.method === 'PUT') await writeSettings(req);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(publicSettings()));
    }
    if (pathname === '/api/handycache') {
      if (req.method === 'PUT') {
        await handyCachePut(req);
        res.writeHead(204);
        return res.end();
      }
      const hit = await handyCacheGet(url.searchParams.get('k') || '');
      res.writeHead(hit ? 200 : 404, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(hit || {}));
    }

    // Abgeschaltet: keine Antwort unter /heresphere – die Ausnahme in der Proxy-Anmeldung kann dann weg
    if ((pathname === '/heresphere' || pathname.startsWith('/heresphere/')) && !heresphereOn()) {
      throw Object.assign(new Error('HereSphere ist abgeschaltet'), { status: 404 });
    }
    if (pathname === '/heresphere' || pathname.startsWith('/heresphere/')) {
      let body = {};
      try { body = JSON.parse((await readBody(req, 100000)) || '{}'); } catch { body = {}; }
      let data;
      if (pathname === '/heresphere/auth') {
        // Anmeldung aus HereSphere (Benutzername egal) -> Token, das HereSphere bei jeder Anfrage mitschickt
        const p = serverSettings.hsPass;
        const ok = !p || hsHash(p.salt, String(body.password || '')) === p.hash;
        data = ok ? { 'auth-token': hsToken(), access: 1 } : { 'auth-token': '', access: -1 };
      } else if (!hsAuthorized(req, url)) {
        // -1 = Anmeldung nötig: HereSphere fragt dann nach Benutzer und Passwort
        data = { access: -1, library: [] };
      } else if (pathname === '/heresphere' || pathname === '/heresphere/') data = await heresphereIndex(req);
      else if (/^\/heresphere\/stash\/\d+$/.test(pathname)) {
        if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
        const id = pathname.split('/').pop();
        data = await heresphereStash(req, id); // prüft vorher „nur VR“
        if (typeof body.rating === 'number') {
          await stashSetRating(id, body.rating * 20).catch((e) => console.warn('HereSphere-Bewertung:', e.message));
          data.rating = body.rating;
        }
        if (typeof body.isFavorite === 'boolean') {
          await stashSetFavorite(id, body.isFavorite).catch((e) => console.warn('HereSphere-Favorit:', e.message));
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

    if (pathname === '/hq/stream') return await hqStream(req, res, url.searchParams);
    if (pathname === '/api/hq/status' || pathname === '/api/hq/probe' || pathname === '/api/hq/bench') {
      const data = pathname.endsWith('status') ? await hqStatus()
        : pathname.endsWith('probe') ? await hqProbe(url.searchParams.get('src'))
          : await hqBench(url.searchParams);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }

    if (pathname === '/api/stash/saved-filters') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const list = (await stashSavedFilters()).map(({ id, name }) => ({ id, name }));
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(list));
    }

    if (pathname === '/api/stash/filters') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const filters = await stashFilters();
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(filters));
    }

    if (pathname === '/api/library') {
      const items = await libraryItems();
      items.sort((a, b) => a.video.localeCompare(b.video, 'de', { numeric: true }));
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(items));
    }

    if (pathname === '/api/stash/status') {
      const status = await stashStatus();
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(status));
    }

    if (pathname === '/api/stash/scenes') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const scenes = await stashScenes(url.searchParams);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(scenes));
    }

    // Durchgereicht werden nur diese Stash-Dateien: Videos, Funscript, Vorschauen, Spul-Sprites und Bilder
    const sm = /^\/stash\/(scene)\/(\d+)\/(stream|stream\.mp4|funscript|screenshot|preview|webp|vtt\/thumbs|vtt\/sprite)$/.exec(pathname)
      || /^\/stash\/(tag|performer|studio)\/(\d+)\/(image)$/.exec(pathname);
    if (sm) {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      url.searchParams.delete('hs'); // HereSphere-Token bleibt hier
      return await proxyStash(req, res, sm[1], sm[2], sm[3], url.search);
    }

    if (pathname.startsWith('/media/')) {
      const file = safeJoin(MEDIA_DIR, pathname.slice('/media/'.length));
      if (!file) {
        res.writeHead(403);
        return res.end();
      }
      return sendFile(req, res, file);
    }

    const file = safeJoin(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file) {
      res.writeHead(403);
      return res.end();
    }
    return sendFile(req, res, file);
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(err);
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 500 ? 'Serverfehler' : err.message);
  }
};

const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// WebSocket-Weiterleitung /intiface?target=IP:PORT -> ws://IP:PORT (Intiface Central auf dem Smartphone).
// Nötig, weil eine HTTPS-Seite keine unverschlüsselte ws://-Verbindung öffnen darf.
// Erlaubt sind nur private IPv4-Adressen; mit „nur Heimnetz“ (⚙️ → Geräte / INTIFACE_LAN_ONLY)
// nur 192.168.x und 10.x – also keine Docker-Netze (172.x) und nichts im Container selbst (127.x).
const PRIVATE_IP = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|127\.\d+)\.\d+\.\d+$/;
const LAN_IP = /^(10\.\d+|192\.168)\.\d+\.\d+$/;

server.on('upgrade', (req, socket, head) => {
  const fail = (code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.on('error', () => {});
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/intiface') return fail(404, 'Not Found');
  if (!authOk(req)) return fail(401, 'Unauthorized');
  if (!sameOrigin(req)) return fail(403, 'Forbidden'); // keine Verbindung von fremden Webseiten
  const m = /^([\d.]+):(\d{1,5})$/.exec(url.searchParams.get('target') || '');
  if (!m || !(intifaceLanOnly() ? LAN_IP : PRIVATE_IP).test(m[1]) || Number(m[2]) > 65535) return fail(400, 'Bad Request');

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
    console.warn(`Intiface ${m[1]}:${m[2]} nicht erreichbar: ${err.message}`);
  });
  socket.on('close', () => upstream.destroy());
});

// Start-Übersicht in „docker logs“: was gefunden wurde, was erreichbar ist – und wann der Player bereit ist
const logLine = (msg) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);
server.listen(PORT, HOST, async () => {
  logLine(`Funscript Player ${VERSION} – lauscht auf ${tls ? 'https' : 'http'}://${HOST}:${PORT}`);
  if (!AUTH_USER) logLine('Hinweis: keine Anmeldung gesetzt (AUTH_USER/AUTH_PASS) – nur hinter einem geschützten Proxy oder im Heimnetz betreiben.');
  logLine(`Bibliothek: lese ${MEDIA_DIR} …`);
  const [lib, stash, hqs] = await Promise.allSettled([libraryRescan(), STASH_URL ? stashStatus() : null, hqStatus()]);
  if (lib.status === 'fulfilled') {
    const roots = new Set(lib.value.map((it) => it.root || '(Hauptordner)'));
    logLine(`Bibliothek: ${lib.value.length} Videos, ${lib.value.filter((it) => it.script).length} mit Funscript, ${roots.size} Ordner – eingelesen in ${libraryScanMs()} ms`);
  } else logLine(`Bibliothek: Fehler – ${lib.reason?.message}`);
  if (!STASH_URL) logLine('Stash: nicht eingerichtet');
  else if (stash.value?.ok) logLine(`Stash: verbunden (${STASH_URL}, Version ${stash.value.version || '?'})`);
  else logLine(`Stash: NICHT erreichbar (${STASH_URL}) – ${stash.value?.error || stash.reason?.message || 'unbekannt'}`);
  logLine(`HQ-Stream: ${hqs.value?.available ? (hqs.value.accel === 'vaapi' ? 'Intel-Grafik (VAAPI)' : 'CPU') : 'nicht verfügbar (kein ffmpeg)'}`);
  logLine(`HereSphere: ${heresphereOn() ? (serverSettings.hsPass ? 'an, mit Passwort' : 'an') : 'aus'} · Intiface: ${intifaceLanOnly() ? 'nur Heimnetz' : 'private Adressen'}`);
  logLine('✓ bereit');
});
