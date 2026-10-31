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
// Fernbedienung (remote.js): ist sie an, kommen Zeit, Dauer und „läuft“ vom Bildschirm
const remote = { on: false, target: '', state: null, stateAt: 0, srcKey: '' };
let nowPlaying = null; // was hier läuft (für die Fernbedienung): { kind: 'stash'|'media'|'file', … }
function mediaTime() {
  if (remote.on) return remoteTime();
  return (hq.active ? hq.offset : 0) + (video.currentTime || 0);
}
function seekTo(sec) {
  const max = duration() / 1000;
  sec = Math.max(0, max ? Math.min(sec, max - 0.5) : sec);
  if (remote.on) remoteCmd('seek', sec);
  else if (hq.active) hqRestart(sec); else video.currentTime = sec;
}
// Läuft das Video gerade – hier oder (als Fernbedienung) auf dem Bildschirm?
function videoPlaying() {
  return remote.on ? remotePlaying() : !video.paused && !video.ended;
}

// ---------------------------------------------------------------------------
// Modi und Seiten
// ---------------------------------------------------------------------------
let appMode = store.get('mode', 'sync');
const syncActive = () => appMode === 'sync';

function showView(view) {
  closeDevices();
  document.body.dataset.view = view;
  ['library', 'player', 'control', 'settings'].forEach((v) => { $('view-' + v).hidden = v !== view; });
  $('navSettings').classList.toggle('active', view === 'settings');
  document.querySelectorAll('button[data-mode]').forEach((b) => b.classList.toggle('active', view !== 'settings' && b.dataset.mode === appMode));
  window.dispatchEvent(new Event('resize'));
}

// Einstellungen: eigene Seite, ändert den Modus nicht. Video, Handy und Satisfyer laufen weiter;
// zurück geht es über die „Läuft gerade“-Leiste unten oder die Modus-Knöpfe.
function openSettings(section) {
  showView('settings');
  if (section) $(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else window.scrollTo(0, 0);
}
// Links in die Einstellungen (Geräte-Spalte, Bereichs-Leiste) – ohne die Adresse (#player) zu ändern
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-settings], #setNav a');
  if (!a) return;
  e.preventDefault();
  closeDevices();
  openSettings(a.dataset.settings || a.getAttribute('href').slice(1));
});
$('navSettings').addEventListener('click', () => (document.body.dataset.view === 'settings' ? setMode(appMode) : openSettings()));
$('openImageSettings').addEventListener('click', () => openSettings('imageSettings'));

function setMode(mode) {
  appMode = mode;
  store.set('mode', mode);
  document.body.dataset.mode = mode;
  document.querySelectorAll('button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (typeof updateSyncToggles === 'function') updateSyncToggles();
  if (mode === 'control') {
    showView('control');
  } else {
    showView(location.hash === '#player' && (video.src || remote.on) ? 'player' : 'library');
    // Streamen: Geräte folgen dem Video nicht mehr
    if (mode === 'stream' && handy.connected && handy.owner === 'video') handy.stop().catch(() => {});
    resync();
    // Jeder Modus hat seinen eigenen Stash-Filter (z. B. Streamen „2D“, Sync „2D Script“)
    if (typeof modeFilterChanged === 'function') modeFilterChanged();
    // „nur mit Funscript“ gilt nur bei Sync -> Bibliothek passend neu laden
    if (typeof refresh === 'function' && typeof lib !== 'undefined' && document.body.dataset.view === 'library') refresh();
  }
}
document.querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Player öffnen = eigener Verlaufseintrag, damit die Zurück-Geste zur Bibliothek führt
function openPlayer() {
  if (appMode === 'control') setMode(store.get('lastWatchMode', 'sync'));
  if (location.hash !== '#player') history.pushState(null, '', '#player');
  showView('player');
  window.scrollTo(0, 0); // Video oben, nicht da, wo die Bibliothek gerade gescrollt war
}
// Zurück zur Bibliothek: Video, Handy und Satisfyer laufen weiter (Leiste „Läuft gerade“ unten)
function backToLibrary() {
  if (location.hash === '#player') history.back();
  else showView('library');
}
window.addEventListener('popstate', () => {
  if (location.hash !== '#player' && document.body.dataset.view === 'player') {
    showView('library');
  } else if (location.hash === '#player' && (video.src || remote.on) && appMode !== 'control') {
    showView('player');
  }
});
$('backToLib').addEventListener('click', backToLibrary);
document.querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode !== 'control') store.set('lastWatchMode', b.dataset.mode);
}));

// ---------------------------------------------------------------------------
// Ruhige Oberfläche: Menü (☰), Geräte-Fenster (Status oben antippen), Sync-Schalter
// ---------------------------------------------------------------------------
function toggleMenu(open = $('menu').hidden) {
  $('menu').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
}
$('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => { if (!$('menu').hidden && !e.target.closest('#menu, #menuBtn')) toggleMenu(false); });
$('menu').addEventListener('click', (e) => { if (e.target.closest('button')) toggleMenu(false); });
function goLibrary() {
  if (appMode === 'control') setMode(store.get('lastWatchMode', 'sync'));
  showView('library');
}
$('menuLibrary').addEventListener('click', goLibrary);
// Titel „Funscript Player“: zur Bibliothek – steht man schon dort und läuft ein Video, zurück zum Video
function goHome() {
  const loaded = remote.on ? !!remote.state?.src : !!video.currentSrc && !!nowPlaying;
  if (document.body.dataset.view === 'library' && loaded) openPlayer();
  else goLibrary();
}
$('homeBtn').addEventListener('click', goHome);
$('homeBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter') goHome(); });

// Geräte-Fenster: oben rechts (PC) bzw. von unten (Smartphone).
// Im Player steht die Geräte-Steuerung fest am Video (⚙️ → Anzeige) – dann nur dorthin springen.
const devInline = () => document.body.dataset.view === 'player' && !document.body.classList.contains('hud-off-devices');
function openDevices(sub) {
  if (sub) document.querySelector(`nav[data-group="dev"] [data-sub="${sub}"]`)?.click();
  if (devInline()) { $('devices').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  document.body.classList.add('dev-open');
  $('sheetBackdrop').hidden = false;
}
function closeDevices() {
  document.body.classList.remove('dev-open');
  $('sheetBackdrop').hidden = true;
}
document.querySelectorAll('.pills [data-dev]').forEach((b) => b.addEventListener('click', () => {
  const same = document.querySelector(`nav[data-group="dev"] [data-sub="${b.dataset.dev}"]`)?.classList.contains('active');
  if (document.body.classList.contains('dev-open') && same) closeDevices(); else openDevices(b.dataset.dev);
}));
$('sheetClose').addEventListener('click', closeDevices);
$('sheetBackdrop').addEventListener('click', closeDevices);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDevices(); toggleMenu(false); } });

// „Geräte folgen dem Video“ = Sync, aus = nur Streamen (ersetzt die Modus-Knöpfe oben)
function updateSyncToggles() {
  const on = (appMode === 'control' ? store.get('lastWatchMode', 'sync') : appMode) === 'sync';
  document.querySelectorAll('.sync-toggle').forEach((cb) => { cb.checked = on; });
}
document.querySelectorAll('.sync-toggle').forEach((cb) => cb.addEventListener('change', () => {
  const mode = cb.checked ? 'sync' : 'stream';
  store.set('lastWatchMode', mode);
  if (appMode !== 'control') setMode(mode);
  updateSyncToggles();
  log(cb.checked ? '🔄 Geräte folgen dem Video.' : '📺 Nur schauen – Geräte folgen dem Video nicht.');
}));

// Unterreiter (Geräte: Handy/Vibrator/Sicherheit, Steuern: Direkt/Patterns/Baukasten)
document.querySelectorAll('nav.subtabs').forEach((nav) => {
  const group = nav.dataset.group;
  const show = (sub) => {
    if (!nav.querySelector(`[data-sub="${sub}"]`)) sub = nav.querySelector('button').dataset.sub; // z. B. alter Reiter „Sicherheit“
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
  if (e.detail !== 'video' && e.detail !== 'finale' && e.detail !== 'self' && !video.paused && syncActive()) video.pause();
});

// ---------------------------------------------------------------------------
// Laden von Video und Script
// ---------------------------------------------------------------------------
// hqSrc: Quelle für den HQ-Stream des Servers ("stash:<id>" / "media:<pfad>"), sonst leer
function loadVideo(src, name, hqSrc = '') {
  if (remote.on) remoteLeave(false); // hier abspielen = Fernbedienung beenden
  if (typeof saveStashActivity === 'function') saveStashActivity();
  stashSession = null;
  nowPlaying = { kind: 'file', title: name };
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = src.startsWith('blob:') ? src : null;
  // Altes Bild nicht kurz zeigen: Video leeren (Stash-Szenen bekommen ihr Standbild als Poster)
  video.pause();
  video.removeAttribute('poster');
  video.removeAttribute('src');
  video.load();
  $('drop').classList.add('loading');
  Object.assign(hq, { active: false, offset: 0, duration: 0, height: 0, src: hqSrc, url: src });
  // HQ prüft erst Auflösung/Format und setzt die Quelle dann selbst
  if (!(typeof hqMaybeStart === 'function' && hqMaybeStart())) video.src = src;
  loadOffsetForVideo();
  resetSceneInfo(name);
}

// Titel setzen, Szenen-Infos leeren (auch für die Fernbedienung, die kein eigenes Video hat)
function resetSceneInfo(name) {
  $('videoName').textContent = name;
  $('ovTitle').textContent = name;
  $('dropHint').classList.add('hidden');
  ['sceneMeta', 'sceneDetails'].forEach((id) => { $(id).textContent = ''; });
  $('sceneActions').hidden = $('ovStash').hidden = $('ovRatePop').hidden = true; // nur bei Stash-Szenen
  ['scenePeople', 'sceneTags', 'sceneMarkers'].forEach((id) => $(id).replaceChildren());
}

function loadScript(text, name) {
  try {
    script = { name, actions: parseFunscript(text) };
    $('scriptName').textContent = `⚡ ${name} (${script.actions.length} Punkte)`;
    drawHeatmap();
    if (typeof toolsChanged === 'function') toolsChanged(); // Info der Script-Werkzeuge für dieses Video
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
  if (typeof toolsChanged === 'function') toolsChanged(); // Anpassungs-Zeile ausblenden
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
    await handy.prepare(toCsv(sendActions()));
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
  if (!handy.connected || !script || (typeof finDetached === 'function' && finDetached())) return;
  try {
    // Fernbedienung: die Handy steuert der Bildschirm, wenn sie dort verbunden ist (genauer)
    const playing = syncActive() && videoPlaying() && (remote.on ? !remote.state?.handy : video.readyState >= 3);
    if (!playing) {
      if (handy.owner === 'video') await handy.stop();
      return;
    }
    // Andere Geschwindigkeit als 1×: mit API v3 läuft die Handy mit, mit v2 pausiert sie
    const rate = remote.on ? (remote.state?.rate || 1) : video.playbackRate;
    if (rate !== 1 && !handy.v3) {
      if (handy.owner === 'video') await handy.stop();
      log('Handy pausiert: Wiedergabegeschwindigkeit muss 1× sein – mit Application ID (⚙️ → Geräte) läuft sie mit.');
      return;
    }
    claimHandy('video');
    if (handy.hsspUrl === null || handy.mode !== 1) setStatus('busy', 'Script wird übertragen …');
    await handy.prepare(toCsv(sendActions()));
    if (!videoPlaying() || handy.owner !== 'video') return;
    await handy.play(mediaTime() * 1000 + Number($('offset').value), rate);
    setStatus('on', 'Video läuft');
  } catch (e) {
    setStatus('err', 'Fehler');
    log(e, true);
  }
}

['playing', 'pause', 'seeked', 'waiting', 'ratechange', 'ended'].forEach((ev) => video.addEventListener(ev, resync));

// Script nach den Script-Werkzeugen (Hub strecken, Spitzen glätten) – siehe tools.js
function toolActions() {
  return typeof processScript === 'function' ? processScript(script.actions) : script.actions;
}

// Was an Handy und Vibrator geht: das Script, im Finale „sanfter + halbes Tempo“ halbiert
function sendActions() {
  return typeof effectiveActions === 'function' ? effectiveActions(toolActions()) : toolActions();
}

// Für den Vibrator: laufendes Video-Script und aktuelle Stelle (nur im Modus „Sync“)
function videoScriptSource() {
  if (!syncActive() || !script || !videoPlaying()) return null;
  return { actions: sendActions(), ms: mediaTime() * 1000 };
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
  if (remote.on && remote.state?.duration) return remote.state.duration * 1000;
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
    const a = toolActions(); // so, wie es an die Geräte geht (inkl. Script-Werkzeuge)
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
  if (!key) return auto ? undefined : openSettings('setDevices');
  store.set('key', key);
  const btn = $('connect');
  btn.disabled = true;
  setStatus('busy', auto ? 'verbinde automatisch …' : 'verbinde …');
  if (!auto) log('');
  try {
    claimHandy(null);
    await handy.connect(key, store.get('appId', '').trim());
    setStatus('on', 'verbunden');
    const api = handy.v3 ? ' (Handy-API v3)' : '';
    log(auto ? `Handy automatisch verbunden${api}.` : `Verbunden${api}.`);
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
// Application ID (Handy-API v3): gilt für alle Geräte; ändern = neu verbinden
$('appId').value = store.get('appId', '');
$('appId').addEventListener('change', () => {
  store.set('appId', $('appId').value.trim());
  if ($('key').value.trim()) connectHandy();
});

// Key steht in den Einstellungen; in der Geräte-Spalte nur ein Hinweis, solange er fehlt
const updateKeyHint = () => { $('keyHint').hidden = !!$('key').value.trim(); };
$('key').addEventListener('input', updateKeyHint);
$('key').addEventListener('change', () => { if ($('key').value.trim()) connectHandy(); });
updateKeyHint();

// ---------------------------------------------------------------------------
// „Läuft gerade“: unten in Bibliothek/Einstellungen/Steuern, solange ein Video geladen ist
// ---------------------------------------------------------------------------
function updateNowBar() {
  const loaded = remote.on ? !!remote.state?.src : !!video.currentSrc && !!nowPlaying;
  $('nowBar').hidden = !loaded || document.body.dataset.view === 'player';
  if ($('nowBar').hidden) return;
  $('nowTitle').textContent = $('ovTitle').textContent;
  $('nowPlay').textContent = videoPlaying() ? '❚❚' : '▶';
}
setInterval(updateNowBar, 500);

// „Mehr zur Szene“ nur zeigen, wenn darin etwas steht (und es nicht unter ⚙️ → Anzeige ausgeblendet ist)
function updateSceneMore() {
  const parts = ['scenePeople', 'sceneTags', 'sceneMarkers', 'sceneDetails'].map($);
  $('sceneMore').hidden = !parts.some((p) => p.textContent.trim() && getComputedStyle(p).display !== 'none');
}
setInterval(updateSceneMore, 1000);
$('nowPlay').addEventListener('click', () => { togglePlay(); setTimeout(updateNowBar, 100); });
$('nowOpen').addEventListener('click', () => openPlayer());

// Kopfzeile kompakt um die Kamera herum (⚙️ → Anzeige)
// Pixel-Smartphones haben die Kamera oben mittig -> dort standardmäßig an
$('hdrNotch').checked = store.get('hdrNotch', /Pixel/i.test(navigator.userAgent));
const applyHdr = () => document.body.classList.toggle('hdr-notch', $('hdrNotch').checked);
$('hdrNotch').addEventListener('change', () => { store.set('hdrNotch', $('hdrNotch').checked); applyHdr(); });
applyHdr();
// Höhe der (klebenden) Kopfzeile für die Bereichs-Leiste der Einstellungen
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--hdr-h', e.target.offsetHeight + 'px'))
  .observe(document.querySelector('header'));

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
  if ($('autoSync').checked && handy.connected && handy.owner === 'video' && videoPlaying() && syncActive()) doSync();
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
['loadeddata', 'error'].forEach((ev) => video.addEventListener(ev, () => drop.classList.remove('loading')));
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
