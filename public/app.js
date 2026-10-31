'use strict';

// ===========================================================================
// Modi (Streamen / Sync / Steuern), Seiten (Bibliothek / Player / Steuern),
// Video + Funscript synchron abspielen und die Handy-Einstellungen.
// Die Bibliothek (Ordner + Stash) steckt in library.js.
// ===========================================================================

function parseFunscript(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.actions) || !data.actions.length) throw new Error('Funscript enthält keine Aktionen');
  const actions = data.actions
    .filter((a) => Number.isFinite(a.at) && Number.isFinite(a.pos))
    .map((a) => ({ at: Math.round(a.at), pos: Math.max(0, Math.min(100, Math.round(a.pos))) }))
    .sort((a, b) => a.at - b.at);
  if (data.inverted) actions.forEach((a) => (a.pos = 100 - a.pos));
  return actions;
}

const video = $('video');
let script = null;       // { name, actions }
let objectUrl = null;
let stashSession = null; // aktuelle Stash-Szene: { id, markers, resume, played, lastSave, counted }

// Zeitachse des Films. Beim HQ-Stream (hq.js) startet das <video> nach jedem Spulen
// wieder bei 0 – die echte Position ist dann hq.offset + video.currentTime.
const hq = { active: false, offset: 0, duration: 0, src: '', url: '' };
function mediaTime() {
  return (hq.active ? hq.offset : 0) + (video.currentTime || 0);
}
function seekTo(sec) {
  const max = duration() / 1000;
  sec = Math.max(0, max ? Math.min(sec, max - 0.5) : sec);
  if (hq.active) hqRestart(sec); else video.currentTime = sec;
}

// ---------------------------------------------------------------------------
// Modi und Seiten
// ---------------------------------------------------------------------------
let appMode = store.get('mode', 'sync');
const syncActive = () => appMode === 'sync';

function showView(view) {
  document.body.dataset.view = view;
  ['library', 'player', 'control', 'settings'].forEach((v) => { $('view-' + v).hidden = v !== view; });
  $('navSettings').classList.toggle('active', view === 'settings');
  document.querySelectorAll('.modes button[data-mode]').forEach((b) => b.classList.toggle('active', view !== 'settings' && b.dataset.mode === appMode));
  window.dispatchEvent(new Event('resize'));
}

// Einstellungen: eigene Seite, ändert den Modus nicht
function openSettings(section) {
  if (!video.paused) video.pause();
  showView('settings');
  if (section) $(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('navSettings').addEventListener('click', () => (document.body.dataset.view === 'settings' ? setMode(appMode) : openSettings()));
$('openImageSettings').addEventListener('click', () => openSettings('imageSettings'));

function setMode(mode) {
  appMode = mode;
  store.set('mode', mode);
  document.body.dataset.mode = mode;
  document.querySelectorAll('.modes button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'control') {
    showView('control');
  } else {
    showView(location.hash === '#player' && video.src ? 'player' : 'library');
    // Streamen: Geräte folgen dem Video nicht mehr
    if (mode === 'stream' && handy.connected && handy.owner === 'video') handy.stop().catch(() => {});
    resync();
  }
}
document.querySelectorAll('.modes button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Player öffnen = eigener Verlaufseintrag, damit die Zurück-Geste zur Bibliothek führt
function openPlayer() {
  if (appMode === 'control') setMode(store.get('lastWatchMode', 'sync'));
  if (location.hash !== '#player') history.pushState(null, '', '#player');
  showView('player');
}
function backToLibrary() {
  if (location.hash === '#player') history.back();
  else { video.pause(); showView('library'); }
}
window.addEventListener('popstate', () => {
  if (location.hash !== '#player' && document.body.dataset.view === 'player') {
    video.pause();
    showView('library');
  } else if (location.hash === '#player' && video.src && appMode !== 'control') {
    showView('player');
  }
});
$('backToLib').addEventListener('click', backToLibrary);
document.querySelectorAll('.modes button[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode !== 'control') store.set('lastWatchMode', b.dataset.mode);
}));

// Unterreiter (Geräte: Handy/Vibrator/Sicherheit, Steuern: Direkt/Patterns/Baukasten)
document.querySelectorAll('nav.subtabs').forEach((nav) => {
  const group = nav.dataset.group;
  const show = (sub) => {
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    document.querySelectorAll(`[data-panel^="${group}:"]`).forEach((p) => { p.hidden = p.dataset.panel !== `${group}:${sub}`; });
    store.set('sub.' + group, sub);
    window.dispatchEvent(new Event('resize'));
  };
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => show(b.dataset.sub)));
  show(store.get('sub.' + group, nav.querySelector('button').dataset.sub));
});

// Ein anderer Bereich steuert jetzt die Handy -> Video anhalten
document.addEventListener('handy-owner', (e) => {
  if (e.detail !== 'video' && e.detail !== 'finale' && !video.paused && syncActive()) video.pause();
});

// ---------------------------------------------------------------------------
// Laden von Video und Script
// ---------------------------------------------------------------------------
// hqSrc: Quelle für den HQ-Stream des Servers ("stash:<id>" / "media:<pfad>"), sonst leer
function loadVideo(src, name, hqSrc = '') {
  if (typeof saveStashActivity === 'function') saveStashActivity();
  stashSession = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = src.startsWith('blob:') ? src : null;
  Object.assign(hq, { active: false, offset: 0, duration: 0, height: 0, src: hqSrc, url: src });
  // HQ prüft erst Auflösung/Format und setzt die Quelle dann selbst
  if (!(typeof hqMaybeStart === 'function' && hqMaybeStart())) video.src = src;
  loadOffsetForVideo();
  $('videoName').textContent = name;
  $('ovTitle').textContent = name;
  $('dropHint').classList.add('hidden');
  ['sceneMeta', 'sceneDetails'].forEach((id) => { $(id).textContent = ''; });
  ['scenePeople', 'sceneTags', 'sceneMarkers'].forEach((id) => $(id).replaceChildren());
}

function loadScript(text, name) {
  try {
    script = { name, actions: parseFunscript(text) };
    $('scriptName').textContent = `⚡ ${name} (${script.actions.length} Punkte)`;
    drawHeatmap();
    preloadScript();
  } catch (e) {
    script = null;
    $('scriptName').textContent = 'Kein Script';
    log('Funscript ungültig: ' + e.message, true);
    drawHeatmap();
  }
}

function clearScript() {
  script = null;
  $('scriptName').textContent = 'Kein Script';
  drawHeatmap();
  if (handy.connected && handy.owner === 'video') handy.stop().catch(() => {});
}

async function handleFiles(fileList) {
  const files = [...fileList];
  const vid = files.find((f) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name));
  const fs = files.find((f) => /\.funscript$/i.test(f.name) || f.type === 'application/json');
  if (vid) {
    openPlayer();
    loadVideo(URL.createObjectURL(vid), vid.name);
    if (!fs) clearScript();
  }
  if (fs) loadScript(await fs.text(), fs.name);
  if (!vid && !fs) log('Keine Video- oder .funscript-Datei erkannt', true);
}

// Script schon vor dem Abspielen übertragen, damit Play sofort reagiert.
async function preloadScript() {
  if (!syncActive() || !handy.connected || !script || (handy.owner && handy.owner !== 'video')) return;
  setStatus('busy', 'Script wird übertragen …');
  try {
    await handy.prepare(toCsv(script.actions));
    setStatus('on', 'bereit');
    log('Script geladen – Video starten.');
    resync();
  } catch (e) {
    setStatus('err', 'Fehler');
    log(e, true);
  }
}

// ---------------------------------------------------------------------------
// Synchronisation Video <-> Handy (nur im Modus „Sync“)
// ---------------------------------------------------------------------------
let syncTimer;
function resync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 40);
}

async function doSync() {
  if (!handy.connected || !script || (typeof fin !== 'undefined' && fin.active)) return;
  try {
    const playing = syncActive() && !video.paused && !video.ended && video.readyState >= 3;
    if (!playing) {
      if (handy.owner === 'video') await handy.stop();
      return;
    }
    if (video.playbackRate !== 1) {
      if (handy.owner === 'video') await handy.stop();
      log('Handy pausiert: Wiedergabegeschwindigkeit muss 1× sein.');
      return;
    }
    claimHandy('video');
    if (handy.hsspUrl === null || handy.mode !== 1) setStatus('busy', 'Script wird übertragen …');
    await handy.prepare(toCsv(script.actions));
    if (video.paused || handy.owner !== 'video') return;
    await handy.play(mediaTime() * 1000 + Number($('offset').value));
    setStatus('on', 'Video läuft');
  } catch (e) {
    setStatus('err', 'Fehler');
    log(e, true);
  }
}

['playing', 'pause', 'seeked', 'waiting', 'ratechange', 'ended'].forEach((ev) => video.addEventListener(ev, resync));

// Für den Vibrator: laufendes Video-Script und aktuelle Stelle (nur im Modus „Sync“)
function videoScriptSource() {
  if (!syncActive() || !script || video.paused || video.ended) return null;
  return { actions: script.actions, ms: mediaTime() * 1000 };
}

// Stash-Marker der aktuellen Szene (für Zeitleisten)
function currentMarkers() {
  return stashSession?.markers || [];
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------
const canvas = $('heatmap');
const ctx = canvas.getContext('2d');
const base = document.createElement('canvas');

const HEAT = [[0, [30, 60, 160]], [120, [30, 144, 255]], [220, [40, 200, 100]], [320, [240, 210, 40]], [420, [250, 130, 30]], [520, [230, 40, 50]]];
function heatColor(speed) {
  for (let i = 1; i < HEAT.length; i++) {
    if (speed <= HEAT[i][0]) {
      const [s0, c0] = HEAT[i - 1];
      const [s1, c1] = HEAT[i];
      const t = (speed - s0) / (s1 - s0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
    }
  }
  return `rgb(${HEAT[HEAT.length - 1][1].join(',')})`;
}

function duration() {
  if (hq.active && hq.duration) return hq.duration * 1000;
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  return script ? script.actions[script.actions.length - 1].at : 0;
}

let lastDrawn = -1;
function drawHeatmap() {
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = base.width = Math.round(canvas.clientWidth * dpr) || 800);
  const h = (canvas.height = base.height = Math.round(canvas.clientHeight * dpr) || 56);
  lastDrawn = -1;
  const b = base.getContext('2d');
  b.clearRect(0, 0, w, h);
  const total = duration();
  if (script && total > 0) {
    const a = script.actions;
    const x = (ms) => (ms / total) * w;
    for (let i = 1; i < a.length; i++) {
      const dt = a[i].at - a[i - 1].at;
      if (dt <= 0) continue;
      const speed = (Math.abs(a[i].pos - a[i - 1].pos) / dt) * 1000;
      b.fillStyle = heatColor(speed);
      b.fillRect(x(a[i - 1].at), 0, Math.max(1, x(a[i].at) - x(a[i - 1].at)), h);
    }
    b.strokeStyle = 'rgba(255,255,255,.55)';
    b.lineWidth = dpr;
    b.beginPath();
    a.forEach((p, i) => {
      const y = h - (p.pos / 100) * (h - 4 * dpr) - 2 * dpr;
      i ? b.lineTo(x(p.at), y) : b.moveTo(x(p.at), y);
    });
    b.stroke();
  }
  // Stash-Marker als gelbe Striche oben
  if (total > 0) {
    b.fillStyle = '#ffd54f';
    for (const m of currentMarkers()) b.fillRect((m.seconds * 1000 / total) * w - dpr, 0, 2 * dpr, h * 0.35);
  }
}

function renderLoop() {
  const t = mediaTime();
  if (t !== lastDrawn && canvas.width && canvas.height && canvas.clientWidth) {
    lastDrawn = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    const total = duration();
    if (total > 0) {
      const px = ((t * 1000) / total) * canvas.width;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - 1, 0, 2 * (window.devicePixelRatio || 1), canvas.height);
    }
  }
  requestAnimationFrame(renderLoop);
}

canvas.addEventListener('click', (e) => {
  const total = duration();
  if (!total || !video.src) return;
  const r = canvas.getBoundingClientRect();
  seekTo((((e.clientX - r.left) / r.width) * total) / 1000);
});
video.addEventListener('loadedmetadata', drawHeatmap);
new ResizeObserver(() => { if (canvas.clientWidth) drawHeatmap(); }).observe(canvas);

// ---------------------------------------------------------------------------
// Handy-Einstellungen
// ---------------------------------------------------------------------------
$('key').value = store.get('key', '');
$('offset').value = store.get('offset', 0);
$('slideMin').value = store.get('min', 0);
$('slideMax').value = store.get('max', 100);
$('invert').checked = store.get('invert', false);

function updateOutputs() {
  $('offsetVal').textContent = `${$('offset').value} ms`;
  $('minVal').textContent = `${$('slideMin').value} %`;
  $('maxVal').textContent = `${$('slideMax').value} %`;
}
updateOutputs();

async function connectHandy(auto = false) {
  const key = $('key').value.trim();
  if (!key) return auto ? undefined : log('Bitte Connection Key eingeben.', true);
  store.set('key', key);
  const btn = $('connect');
  btn.disabled = true;
  setStatus('busy', auto ? 'verbinde automatisch …' : 'verbinde …');
  if (!auto) log('');
  try {
    claimHandy(null);
    await handy.connect(key);
    setStatus('on', 'verbunden');
    log(auto ? 'Handy automatisch verbunden.' : 'Verbunden.');
    await applySlide();
    if (script) await preloadScript();
  } catch (e) {
    setStatus(auto ? 'off' : 'err', auto ? 'getrennt' : 'Fehler');
    log((auto ? 'Automatisches Verbinden fehlgeschlagen: ' : '') + (e.message || e), true);
  } finally {
    btn.disabled = false;
  }
}
$('connect').addEventListener('click', () => connectHandy());

// ---------------------------------------------------------------------------
// Sync-Pflege: die Handy läuft nach ihrer eigenen Uhr. Kleine Abweichungen
// (Puffern, Uhrdrift, Ruckler) werden regelmäßig still nachkorrigiert.
// ---------------------------------------------------------------------------
$('autoConnect').checked = store.get('autoConnect', true);
$('autoSync').checked = store.get('autoSync', true);
$('autoConnect').addEventListener('change', () => store.set('autoConnect', $('autoConnect').checked));
$('autoSync').addEventListener('change', () => store.set('autoSync', $('autoSync').checked));

async function manualResync() {
  if (!handy.connected) return log('Handy ist nicht verbunden.', true);
  setStatus('busy', 'synchronisiere …');
  try {
    await handy.syncTime();
    resync();
    setStatus('on', 'synchronisiert');
    log('Handy neu synchronisiert.');
  } catch (e) {
    setStatus('err', 'Fehler');
    log(e, true);
  }
}
$('resyncBtn').addEventListener('click', manualResync);
$('ovSync').addEventListener('click', manualResync);
document.addEventListener('keydown', (e) => { if (e.key === 's' && document.body.dataset.view === 'player' && !e.target.closest('input, select, textarea')) manualResync(); });

// Alle 30 s die Position neu senden (ersetzt die Laufzeit der Handy durch die echte Videoposition)
setInterval(() => {
  if ($('autoSync').checked && handy.connected && handy.owner === 'video' && !video.paused && syncActive()) doSync();
}, 30000);
// Alle 5 min die Uhr mit dem Handy-Server neu abgleichen (Uhren driften auseinander)
setInterval(() => {
  if ($('autoSync').checked && handy.connected) handy.syncTime().catch(() => {});
}, 300000);
// Zurück in die App / Bildschirm wieder an: sofort neu ausrichten
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });

// ---------------------------------------------------------------------------
// Offset: wird pro Szene gemerkt (manche Scripts sind leicht versetzt)
// ---------------------------------------------------------------------------
function offsetKey() { return hq.src || ''; }
function loadOffsetForVideo() {
  const map = store.get('offsets', {});
  const v = offsetKey() in map ? map[offsetKey()] : store.get('offset', 0);
  $('offset').value = v;
  updateOutputs();
  $('offsetVal').textContent += offsetKey() in map ? ' · Szene' : '';
}
$('offset').addEventListener('input', updateOutputs);
$('offset').addEventListener('change', () => {
  const v = Number($('offset').value);
  if (offsetKey()) {
    const map = store.get('offsets', {});
    map[offsetKey()] = v;
    store.set('offsets', map);
    $('offsetVal').textContent += ' · Szene';
  } else {
    store.set('offset', v);
  }
  resync();
});

async function applySlide() {
  let min = Number($('slideMin').value);
  let max = Number($('slideMax').value);
  if (min >= max) {
    max = Math.min(100, min + 1);
    min = max - 1;
    $('slideMin').value = min;
    $('slideMax').value = max;
    updateOutputs();
  }
  store.set('min', min);
  store.set('max', max);
  if (handy.connected) {
    try { await handy.slide(min, max); } catch (e) { log(e, true); }
  }
}
['slideMin', 'slideMax'].forEach((id) => {
  $(id).addEventListener('input', updateOutputs);
  $(id).addEventListener('change', applySlide);
});

$('invert').addEventListener('change', () => {
  store.set('invert', $('invert').checked);
  if (handy.owner === 'video') resync();
});

// Drag & Drop + Dateiauswahl
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
$('fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

// Beim Schließen der Seite Handy anhalten
window.addEventListener('pagehide', () => {
  if (!handy.connected) return;
  (handy.mode === 0 ? handy.hampStop() : handy.stop()).catch(() => {});
});

// Start: ohne geladenes Video nie auf der Player-Seite landen
if (location.hash === '#player') history.replaceState(null, '', location.pathname + location.search);
setMode(appMode);
requestAnimationFrame(renderLoop);
// Gespeicherten Key gleich beim Start verbinden
if ($('autoConnect').checked && $('key').value.trim()) setTimeout(() => connectHandy(true), 300);
fetch('/api/version').then((r) => r.json()).then((v) => { $('appVersion').textContent = 'v' + v.version; }).catch(() => {});
