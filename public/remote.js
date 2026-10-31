'use strict';

// ===========================================================================
// Fernbedienung: Video läuft am Bildschirm (TV/PC), Bedienung und Satisfyer am
// Smartphone. Abgleich über den Server (Server-Sent Events + POST, server.js).
//   Bildschirm:     meldet Szene, Position und läuft/pausiert; führt Befehle aus.
//   Fernbedienung:  zeigt die gewohnte Player-Leiste ohne eigenes Video, schickt
//                   Befehle und lässt Satisfyer/Handy dem Script im Takt folgen.
// Beide Seiten gleichen ihre Uhr mit dem Server ab. Der Bildschirm stempelt seine
// Position mit Serverzeit, die Fernbedienung rechnet von dort aus weiter.
// ===========================================================================

// Eigene ID je Tab (bleibt beim Neuladen gleich, damit die Fernbedienung dranbleibt)
const rcId = (() => {
  const make = () => (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 20).padEnd(8, '0');
  try {
    let id = sessionStorage.getItem('hp.rcId');
    if (!id) sessionStorage.setItem('hp.rcId', (id = make()));
    return id;
  } catch { return make(); }
})();

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/SMART-TV|Tizen|Web0S|webOS|CrKey|BRAVIA|AFT/i.test(ua)) return 'TV';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android-Smartphone' : 'Android-Tablet';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Windows/.test(ua)) return 'Windows-PC';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux-PC';
  return 'Gerät';
}
const rcName = () => $('rcName').value.trim() || defaultDeviceName();

// ---------------------------------------------------------------------------
// Uhr: Abweichung zur Serveruhr (kürzeste Anfrage zählt)
// ---------------------------------------------------------------------------
let clockOffset = 0;
async function syncClock() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const { now } = await (await fetch('/api/remote/time', { cache: 'no-store' })).json();
      const t1 = Date.now();
      if (!best || t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: now + (t1 - t0) / 2 - t1 };
    } catch { return; }
  }
  if (best) clockOffset = best.offset;
}
const serverNow = () => Date.now() + clockOffset;

// ---------------------------------------------------------------------------
// Verbindung zum Server
// ---------------------------------------------------------------------------
let es = null;
let screens = []; // andere Bildschirme: { id, name, state }
let peers = 0;    // wie viele andere Seiten gerade offen sind

function rcPost(kind, data) {
  return fetch('/api/remote/' + kind, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: rcId, ...data }),
  });
}

function rcConnect() {
  es?.close();
  const p = new URLSearchParams({ id: rcId, name: rcName(), screen: $('rcScreen').checked ? '1' : '0' });
  es = new EventSource('/api/remote/events?' + p);
  es.addEventListener('screens', (e) => {
    const d = JSON.parse(e.data);
    screens = d.list.filter((s) => s.id !== rcId);
    peers = d.peers;
    if (peers) sendState(true);
    if (remote.on) remoteCheckScreen();
    renderCast();
  });
  es.addEventListener('state', (e) => {
    const d = JSON.parse(e.data);
    const s = screens.find((x) => x.id === d.id);
    if (s) s.state = d.state;
    if (remote.on && d.id === remote.target) applyState(d.state);
    renderCast();
  });
  es.addEventListener('cmd', (e) => runCmd(JSON.parse(e.data)));
}

// ---------------------------------------------------------------------------
// Bildschirm: Zustand melden, Befehle ausführen
// ---------------------------------------------------------------------------
let rcError = '';
let stateTimer = null;
function screenState() {
  if (!nowPlaying) return { src: null };
  const info = stashSession?.info;
  return {
    src: nowPlaying,
    t: mediaTime(),
    at: serverNow(),
    playing: !video.paused && !video.ended && video.readyState >= 3,
    rate: video.playbackRate,
    paused: video.paused,
    duration: duration() / 1000,
    handy: handy.connected && syncActive(), // dann steuert der Bildschirm die Handy
    info: info ? { rating100: info.rating100 || 0, favorite: !!info.favorite, oCounter: info.oCounter || 0 } : null,
    markers: (stashSession?.markers || []).slice(0, 200).map((m) => ({ seconds: m.seconds, title: m.title })),
    error: rcError,
  };
}
function sendState(now = false) {
  if (!peers || remote.on || !$('rcScreen').checked) return;
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => rcPost('state', { state: screenState() }).catch(() => {}), now ? 0 : 50);
}
['play', 'playing', 'pause', 'seeked', 'waiting', 'ended', 'loadedmetadata', 'emptied', 'ratechange']
  .forEach((ev) => video.addEventListener(ev, () => sendState()));
// Herzschlag: bleibt er aus, hält die Fernbedienung ihre Geräte an
setInterval(() => { if (nowPlaying) sendState(true); }, 3000);

function screenPlay() {
  video.play().then(() => { rcError = ''; sendState(); }).catch(() => {
    rcError = 'autoplay';
    sendState();
    showOverlay();
    log('Die Fernbedienung möchte abspielen – bitte hier einmal tippen/klicken (Browser-Sperre).', true);
  });
}
video.addEventListener('playing', () => { rcError = ''; });

function runCmd({ cmd, arg }) {
  if (remote.on || !$('rcScreen').checked) return;
  if (cmd === 'open') {
    if (arg?.kind === 'stash') openStashScene(arg);
    else if (arg?.kind === 'media') openFolderItem(arg);
  } else if (cmd === 'play') screenPlay();
  else if (cmd === 'pause') video.pause();
  else if (cmd === 'toggle') { if (video.paused) screenPlay(); else video.pause(); }
  else if (cmd === 'seek' && Number.isFinite(Number(arg))) seekTo(Number(arg));
  else if (cmd === 'stop') emergencyStop('Not-Aus von der Fernbedienung');
  else if (cmd === 'fs') { if (isFs()) exitFullscreen(); else enterFullscreen(); }
  else if (cmd === 'refresh' && stashSession) refreshStashInfo(stashSession);
  else if (cmd === 'hello') sendState(true);
}

// Bewertung/O/Marker wurden an der Fernbedienung geändert -> neu laden
async function refreshStashInfo(session) {
  try {
    const d = await (await fetch(`/api/stash/scene/${session.id}`)).json();
    if (stashSession !== session) return;
    session.markers = d.markers;
    showSceneInfo(d);
    drawHeatmap();
  } catch { /* nächster Versuch beim nächsten Mal */ }
}

// ---------------------------------------------------------------------------
// Fernbedienung
// ---------------------------------------------------------------------------
const srcKey = (s) => (!s ? '' : s.kind === 'stash' ? 'stash:' + s.id : s.kind === 'media' ? 'media:' + s.video : 'file:' + s.title);

function remotePlaying() {
  const s = remote.state;
  // Ohne Herzschlag (> 8 s) gilt der Bildschirm als angehalten -> Geräte stoppen
  return !!(s && s.src && s.playing && Date.now() - remote.stateAt < 8000 && screens.some((x) => x.id === remote.target));
}
function remoteTime() {
  const s = remote.state;
  if (!s || !s.src) return 0;
  let t = s.t;
  if (remotePlaying()) t += ((serverNow() - s.at) / 1000) * (s.rate || 1);
  return Math.max(0, s.duration ? Math.min(t, s.duration) : t);
}

// Befehl an den Bildschirm. Spulen beim Ziehen: höchstens alle 250 ms senden,
// die Leiste springt aber sofort mit.
let seekPending = null, seekTimer = null;
function remoteCmd(cmd, arg = null) {
  if (!remote.on) return;
  if (cmd === 'seek') {
    if (remote.state) Object.assign(remote.state, { t: arg, at: serverNow() });
    seekPending = arg;
    if (!seekTimer) {
      seekTimer = setTimeout(() => { seekTimer = null; post('seek', seekPending); }, 250);
    }
    return;
  }
  post(cmd, arg);
  function post(c, a) {
    rcPost('cmd', { to: remote.target, cmd: c, arg: a })
      .then((r) => { if (!r.ok) setRemoteState('Bildschirm nicht erreichbar', true); })
      .catch(() => setRemoteState('Server nicht erreichbar', true));
  }
}

function setRemoteState(text, warn = false) {
  $('remoteState').textContent = text;
  $('remoteState').classList.toggle('warn', warn);
}

// Fernbedienung für einen Bildschirm starten (id) oder beenden ('')
function setCastTarget(id) {
  if (!id) return remoteLeave();
  if (!remote.on && video.src) {
    saveStashActivity();
    video.pause();
    video.removeAttribute('src');
    video.load();
    hq.active = false;
  }
  Object.assign(remote, { on: true, target: id, state: null, stateAt: 0, srcKey: '' });
  document.body.classList.add('remote-on');
  $('remoteBanner').hidden = false;
  const s = screens.find((x) => x.id === id);
  $('remoteName').textContent = s?.name || 'Bildschirm';
  setRemoteState('verbunden');
  if (s?.state) applyState(s.state);
  remoteCmd('hello');
  renderCast();
}

// toLibrary = false: es wird gleich hier ein Video geöffnet (Player bleibt offen)
function remoteLeave(toLibrary = true) {
  if (!remote.on) return;
  Object.assign(remote, { on: false, target: '', state: null, stateAt: 0, srcKey: '' });
  document.body.classList.remove('remote-on');
  $('remoteBanner').hidden = true;
  stashSession = null;
  clearScript();
  video.removeAttribute('poster');
  $('drop').classList.remove('ready');
  $('dropHint').classList.remove('hidden');
  resetSceneInfo('Kein Video');
  if (toLibrary && document.body.dataset.view === 'player') backToLibrary();
  resync();
  renderCast();
}

// Szene am Bildschirm öffnen (aus der Bibliothek der Fernbedienung)
function remoteOpen(src) {
  remoteCmd('open', src);
  openPlayer();
  remoteLoad(src);
}

// Szene in der Fernbedienung anzeigen: Titel, Infos, Script – aber kein Video
async function remoteLoad(src) {
  remote.srcKey = srcKey(src);
  stashSession = null;
  clearScript();
  resetSceneInfo(src.title || src.name || 'Video');
  video.removeAttribute('poster');
  $('drop').classList.remove('loading');
  $('drop').classList.add('ready');
  showOverlay();

  if (src.kind === 'stash') {
    video.poster = `/stash/scene/${src.id}/screenshot`;
    const session = { id: src.id, markers: [], resume: 0, played: 0, lastSave: Date.now(), counted: true };
    stashSession = session;
    fetch(`/api/stash/scene/${src.id}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || stashSession !== session) return;
      session.markers = d.markers;
      loadSprites(session);
      showSceneInfo(d);
      drawHeatmap();
    }).catch(() => {});
    if (src.interactive === false) return;
    try {
      const res = await fetch(`/stash/scene/${src.id}/funscript`);
      if (res.ok && remote.srcKey === srcKey(src)) loadScript(await res.text(), 'Funscript');
    } catch { /* ohne Script */ }
  } else if (src.kind === 'media') {
    $('sceneMeta').textContent = src.folder ? `Ordner: ${src.folder}` : 'Bibliotheksordner';
    if (!src.script) return;
    try {
      const res = await fetch(mediaUrl(src.script));
      if (res.ok && remote.srcKey === srcKey(src)) loadScript(await res.text(), src.script.split('/').pop());
    } catch { /* ohne Script */ }
  } else {
    $('scriptName').textContent = 'Lokale Datei am Bildschirm – das Script gibt es nur dort';
  }
}

// Neuer Zustand vom Bildschirm
function applyState(s) {
  const prev = remote.state;
  const wasPlaying = remotePlaying();
  const expected = remoteTime();
  remote.state = s ? { ...s } : null;
  remote.stateAt = Date.now();
  if (!s?.src) {
    remote.srcKey = '';
    setRemoteState('am Bildschirm läuft nichts – Szene in der Bibliothek wählen');
    resync();
    return;
  }
  if (srcKey(s.src) !== remote.srcKey) remoteLoad(s.src);
  setRemoteState(s.error === 'autoplay' ? 'bitte am Bildschirm einmal tippen/klicken' : s.paused ? 'pausiert' : s.playing ? 'läuft' : 'lädt …', s.error === 'autoplay');
  $('ovPlay').textContent = s.paused ? '▶' : '❚❚';

  // Bewertung/O/Marker, die am Bildschirm geändert wurden
  const info = stashSession?.info;
  if (s.info && info && (info.rating100 !== s.info.rating100 || !!info.favorite !== s.info.favorite || info.oCounter !== s.info.oCounter)) {
    showActions({ ...info, ...s.info });
  }
  if (info && s.markers && s.markers.length !== stashSession.markers.length) {
    stashSession.markers = s.markers;
    showSceneInfo({ ...info, markers: s.markers });
    drawHeatmap();
  }
  if (!prev || prev.duration !== s.duration) drawHeatmap();

  // Handy (falls hier gesteuert): bei Start/Stopp oder Sprung neu ausrichten
  if (remotePlaying() !== wasPlaying || Math.abs(expected - s.t) > 0.5 || !!prev?.handy !== !!s.handy) resync();
  drawOvBar();
}

// Bildschirm weg? Geräte anhalten, Fernbedienung bleibt und wartet
function remoteCheckScreen() {
  const there = screens.some((x) => x.id === remote.target);
  if (!there) setRemoteState('Bildschirm getrennt – wartet …', true);
  else remoteCmd('hello');
}
let lastPlaying = false;
setInterval(() => {
  if (!remote.on) return;
  const p = remotePlaying();
  if (p !== lastPlaying) { lastPlaying = p; resync(); }
  if (remote.state?.src && Date.now() - remote.stateAt > 8000) setRemoteState('keine Verbindung zum Bildschirm – Geräte angehalten', true);
}, 1000);

// ---------------------------------------------------------------------------
// Auswahl „Abspielen auf“ in der Bibliothek
// ---------------------------------------------------------------------------
function renderCast() {
  const sel = $('castTarget');
  const opts = [['', 'Diesem Gerät']];
  for (const s of screens) if (s.id !== rcId) opts.push([s.id, s.name + (s.state?.src ? ' ▶' : '')]);
  if (remote.on && !screens.some((s) => s.id === remote.target)) opts.push([remote.target, ($('remoteName').textContent || 'Bildschirm') + ' (getrennt)']);
  sel.replaceChildren(...opts.map(([v, t]) => el('option', { value: v }, t)));
  sel.value = remote.on ? remote.target : '';
  $('castBar').hidden = opts.length < 2;
  const st = remote.on && remote.state?.src ? remote.state : null;
  $('castNow').textContent = st ? `Läuft dort: ${st.src.title || st.src.name || 'Video'}` : remote.on ? 'Szene antippen, um sie dort zu öffnen' : '';
  $('castOpen').hidden = !st;
}
$('castTarget').addEventListener('change', () => setCastTarget($('castTarget').value));
$('castOpen').addEventListener('click', () => openPlayer());
$('remoteLeave').addEventListener('click', () => remoteLeave());

// ---------------------------------------------------------------------------
// Einstellungen + Start
// ---------------------------------------------------------------------------
$('rcScreen').checked = store.get('rcScreen', true);
$('rcName').value = store.get('rcName', '');
$('rcName').placeholder = defaultDeviceName();
$('rcScreen').addEventListener('change', () => { store.set('rcScreen', $('rcScreen').checked); rcConnect(); });
$('rcName').addEventListener('change', () => { store.set('rcName', $('rcName').value.trim()); rcConnect(); });

syncClock().then(rcConnect);
setInterval(syncClock, 60000);
