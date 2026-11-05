import './handy.js'; // Ladereihenfolge wie bisher – siehe boot.js
import { modulesReady, video } from './state.js';
import { $, claimHandy, handy, handyErrText, log, setStatus, store, toCsv } from './handy.js';
import { modeFilterChanged, nowKey, refresh, saveScriptToLibrary, saveStashActivity } from './library.js';
import { allVibes, checkVibes, setVibePaused, vibePaused, vibeSlow } from './vibe.js';
import { togglePlay } from './fullscreen.js';
import { enh, enhClear, enhSetPreset } from './enhance.js';
import { hqMaybeStart, hqRestart } from './hq.js';
import { effectiveActions, finDetached } from './finale.js';
import { adaptedMarks, processScript, toolsChanged } from './tools.js';
import { strokers } from './stroker.js';
import { selfCtl } from './selfctl.js';
import { setAdvMode, setQualityMode } from './settings.js';
modulesReady.add('app');

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

export let script = null;       // { name, actions }
let objectUrl = null;
export let stashSession = null; // aktuelle Stash-Szene: { id, markers, resume, played, lastSave, counted }

// Zeitachse des Films. Beim HQ-Stream (hq.js) startet das <video> nach jedem Spulen
// wieder bei 0 – die echte Position ist dann hq.offset + video.currentTime.
export const hq = { active: false, offset: 0, duration: 0, src: '', url: '' };
export let nowPlaying = null; // was hier läuft: { kind: 'stash'|'media'|'file', … }
export function setNowPlaying(v) { nowPlaying = v; }
export function setStashSession(v) { stashSession = v; }
export function mediaTime() {
  return (hq.active ? hq.offset : 0) + (video.currentTime || 0);
}
export function seekTo(sec) {
  const max = duration() / 1000;
  sec = Math.max(0, max ? Math.min(sec, max - 0.5) : sec);
  if (hq.active) hqRestart(sec); else video.currentTime = sec;
}
export function videoPlaying() {
  return !video.paused && !video.ended;
}

// ---------------------------------------------------------------------------
// Modi und Seiten
// ---------------------------------------------------------------------------
// (Einmal-Umstellungen aus 1.2, 1.16 und 1.17 sind seit 1.18 entfernt – alle Geräte haben sie durchlaufen.)
export let appMode = store.get('mode', 'sync');
export const syncActive = () => appMode === 'sync';

function showView(view) {
  closeDevices();
  document.body.dataset.view = view;
  if (typeof updateNowBar === 'function') setTimeout(updateNowBar, 0);
  ['library', 'player', 'control', 'settings'].forEach((v) => { $('view-' + v).hidden = v !== view; });
  $('navSettings').classList.toggle('active', view === 'settings');
  document.querySelectorAll('button[data-mode]').forEach((b) => b.classList.toggle('active', view !== 'settings' && b.dataset.mode === appMode));
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('hp:view')); // 2.0: Navigation (nav.js) markiert den Bereich
}

// Einstellungen: eigene Seite, ändert den Modus nicht. Video, Handy und Satisfyer laufen weiter;
// zurück geht es über die „Läuft gerade“-Leiste unten oder die Modus-Knöpfe.
export function openSettings(section) {
  showView('settings');
  // Ziel liegt bei den erweiterten Einstellungen -> diese einblenden
  if (section && $(section)?.closest('.adv') && modulesReady.has('settings')) setAdvMode(true);
  // Zugeklappte Bereiche auf dem Weg zum Ziel öffnen
  for (let d = section && $(section)?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
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
// Bild-Popup unter dem Video (alle Einstellungen über den Link darin)
function renderImgPop() {
  const q = enh.settings.preset === 'off' ? 'off' : 'auto';
  document.querySelectorAll('#imgPop [data-q]').forEach((b) => b.classList.toggle('active', b.dataset.q === q && ['auto', 'off'].includes(enh.settings.preset)));
  document.querySelectorAll('#imgPop [data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === enh.settings.preset));
}
$('openImageSettings').addEventListener('click', (e) => {
  e.stopPropagation();
  $('imgPop').hidden = !$('imgPop').hidden;
  renderImgPop();
});
$('imgPop').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.q) setQualityMode(b.dataset.q); else enhSetPreset(b.dataset.preset);
  renderImgPop();
});
document.addEventListener('click', (e) => { if (!$('imgPop').hidden && !e.target.closest('#imgPop, #openImageSettings')) $('imgPop').hidden = true; });

function setMode(mode) {
  appMode = mode;
  store.set('mode', mode);
  document.body.dataset.mode = mode;
  document.querySelectorAll('button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (typeof updateSyncToggles === 'function') updateSyncToggles();
  if (mode === 'control') {
    showView('control');
  } else {
    showView(location.hash === '#player' && video.src ? 'player' : 'library');
    // Streamen: Geräte folgen dem Video nicht mehr
    if (mode === 'stream' && handy.connected && handy.owner === 'video') handy.stop().catch(() => {});
    resync();
    // Jeder Modus hat seinen eigenen Stash-Filter (z. B. Streamen „2D“, Sync „2D Script“)
    if (modulesReady.has('library')) modeFilterChanged();
    // „nur mit Funscript“ gilt nur bei Sync -> Bibliothek passend neu laden
    if (modulesReady.has('library') && document.body.dataset.view === 'library') refresh();
  }
}
document.querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Player öffnen = eigener Verlaufseintrag, damit die Zurück-Geste zur Bibliothek führt
export function openPlayer() {
  if (appMode === 'control') setMode(store.get('lastWatchMode', 'sync'));
  if (location.hash !== '#player') history.pushState(null, '', '#player');
  showView('player');
  window.scrollTo(0, 0); // Video oben, nicht da, wo die Bibliothek gerade gescrollt war
}
// Zurück zur Bibliothek: Video, Handy und Satisfyer laufen weiter (Leiste „Läuft gerade“ unten)
export function backToLibrary() {
  if (location.hash === '#player') history.back();
  else showView('library');
}
window.addEventListener('popstate', () => {
  if (location.hash !== '#player' && document.body.dataset.view === 'player') {
    showView('library');
  } else if (location.hash === '#player' && video.src && appMode !== 'control') {
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
export function goLibrary() {
  if (appMode === 'control') setMode(store.get('lastWatchMode', 'sync'));
  showView('library');
}
$('menuLibrary').addEventListener('click', goLibrary);
// Titel „Funscript Player“: zur Bibliothek – steht man schon dort und läuft ein Video, zurück zum Video
function goHome() {
  const loaded = !!video.currentSrc && !!nowPlaying;
  if (document.body.dataset.view === 'library' && loaded) openPlayer();
  else goLibrary();
}
$('homeBtn').addEventListener('click', goHome);
$('homeBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter') goHome(); });

// Geräte-Fenster: oben rechts (PC) bzw. von unten (Smartphone).
// Im Player steht die Geräte-Steuerung fest am Video (⚙️ → Anzeige) – dann nur dorthin springen.
export function openDevices(sub) {
  if (sub) document.querySelector(`nav[data-group="dev"] [data-sub="${sub}"]`)?.click();
  document.body.classList.add('dev-open');
  $('sheetBackdrop').hidden = false;
  window.dispatchEvent(new Event('hp:view'));
}
export function closeDevices() {
  document.body.classList.remove('dev-open');
  $('sheetBackdrop').hidden = true;
  window.dispatchEvent(new Event('hp:view'));
}
// Gemeinsame Status-Anzeige: öffnet/schließt das Geräte-Fenster; Reiter = das verbundene Gerät
$('devChip').addEventListener('click', () => {
  if (document.body.classList.contains('dev-open')) return closeDevices();
  openDevices(hasHandy() && !hasVibe() ? 'handy' : hasVibe() && !hasHandy() ? 'vibe' : null);
});
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
export function loadVideo(src, name, hqSrc = '') {
  if (modulesReady.has('library')) saveStashActivity();
  // Neues Video = Geräte wieder aktiv (auch nach „Geräte pausieren“ oder STOPP beim vorigen)
  if (modulesReady.has('vibe') && vibePaused) setVibePaused(false);
  stashSession = null;
  nowPlaying = { kind: 'file', title: name };
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = src.startsWith('blob:') ? src : null;
  // Altes Bild nicht kurz zeigen: Video leeren (Stash-Szenen bekommen ihr Standbild als Poster)
  video.pause();
  video.removeAttribute('poster');
  video.removeAttribute('src');
  video.load();
  if (modulesReady.has('enhance')) enhClear(); // altes Bild der Bildverbesserung weg (sonst kurz Standbild des vorigen Videos)
  $('drop').classList.add('loading');
  Object.assign(hq, { active: false, offset: 0, duration: 0, height: 0, src: hqSrc, url: src });
  // HQ prüft erst Auflösung/Format und setzt die Quelle dann selbst
  if (!(modulesReady.has('hq') && hqMaybeStart())) video.src = src;
  loadOffsetForVideo();
  resetSceneInfo(name);
  // Poster (Stash-Standbild) setzt library.js direkt danach – darum erst im nächsten Takt lesen
  setTimeout(showStartCover);
}

// 1.19.11: Beim Start eines Videos das Vorschaubild (bzw. schwarz mit Ladekreis) zeigen, bis ein echtes Bild
// zu sehen ist – statt Schwarz oder einem alten Standbild (auch mit Bildverbesserung/HQ-Stream).
function showStartCover() {
  const img = $('startCover').querySelector('img');
  const poster = video.getAttribute('poster');
  if (poster) img.src = poster; else img.removeAttribute('src');
  $('startCover').hidden = false;
}
function hideStartCover() {
  if ($('startCover').hidden) return;
  // Ein Bild weiter warten: dann hat auch die Bildverbesserung gezeichnet
  const done = () => { $('startCover').hidden = true; };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => requestAnimationFrame(done)); else setTimeout(done, 150);
}
['playing', 'seeked'].forEach((ev) => video.addEventListener(ev, hideStartCover));
video.addEventListener('error', () => { $('startCover').hidden = true; });

// Video schließen (✕ am Mini-Player): anhalten, Geräte stoppen, Mini-Player weg
function closeVideo() {
  if (modulesReady.has('library')) saveStashActivity();
  video.pause();
  if (handy.connected && handy.owner === 'video') handy.stop().catch(() => {});
  if (handy.connected) setStatus('on', 'verbunden');
  if (modulesReady.has('selfctl')) selfCtl.handyOn = false;
  stashSession = null;
  nowPlaying = null;
  script = null;
  Object.assign(hq, { active: false, offset: 0, duration: 0, src: '', url: '' });
  video.removeAttribute('poster');
  video.removeAttribute('src');
  video.load();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  resetSceneInfo('Kein Video');
  $('dropHint').classList.remove('hidden');
  $('scriptName').textContent = 'Kein Script';
  drawHeatmap();
  if (modulesReady.has('tools')) toolsChanged();
  if (document.body.dataset.view === 'player') backToLibrary();
  updateNowBar();
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

export function loadScript(text, name) {
  try {
    script = { name, actions: parseFunscript(text) };
    $('scriptName').textContent = `⚡ ${name} (${script.actions.length} Punkte)`;
    drawHeatmap();
    if (modulesReady.has('tools')) toolsChanged(); // Info der Script-Werkzeuge für dieses Video
    preloadScript();
  } catch (e) {
    script = null;
    $('scriptName').textContent = 'Kein Script';
    log('Funscript ungültig: ' + e.message, true);
    drawHeatmap();
  }
}

export function clearScript() {
  script = null;
  $('scriptName').textContent = 'Kein Script';
  drawHeatmap();
  if (modulesReady.has('tools')) toolsChanged(); // Anpassungs-Zeile ausblenden
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
  if (fs) {
    const text = await fs.text();
    loadScript(text, fs.name);
    // Nur ein Script zu einem Bibliotheks-Video gewählt -> anbieten, es dauerhaft dazu zu speichern
    if (!vid && script && nowKey() && store.get('saveScripts', true) && confirm('Dieses Script dauerhaft zu diesem Video speichern?')) {
      saveScriptToLibrary(script.actions);
    }
  }
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
    setStatus('err', handyErrText(e));
    log(e, true);
  }
}

// ---------------------------------------------------------------------------
// Synchronisation Video <-> Handy (nur im Modus „Sync“)
// ---------------------------------------------------------------------------
let syncTimer;
export function resync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 40);
}

async function doSync() {
  if (!handy.connected || !script || (modulesReady.has('finale') && finDetached())) return;
  try {
    const playing = syncActive() && videoPlaying() && !vibePaused && video.readyState >= 3;
    if (!playing) {
      if (handy.owner === 'video') await handy.stop();
      return;
    }
    // Andere Geschwindigkeit als 1×: mit API v3 läuft die Handy mit, mit v2 pausiert sie
    const rate = video.playbackRate;
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
    // Cloud weg, aber die Handy hängt per Bluetooth an Intiface: dorthin wechseln (stroker.js übernimmt)
    if (e.kind === 'net' && modulesReady.has('stroker') && strokers().length) {
      handy.connected = false;
      log('Handy-Cloud nicht erreichbar – steuere die Handy per Bluetooth (Intiface).', true);
      setTimeout(() => connectHandy(true), 60000); // später wieder die Cloud versuchen
      return;
    }
    setStatus('err', handyErrText(e));
    log(e, true);
  }
}

['playing', 'pause', 'seeking', 'seeked', 'waiting', 'ratechange', 'ended'].forEach((ev) => video.addEventListener(ev, resync));

// Script nach den Script-Werkzeugen (Hub strecken, Spitzen glätten) – siehe tools.js
export function toolActions(target = 'handy') {
  return modulesReady.has('tools') ? processScript(script.actions, target) : script.actions;
}

// Was an die Handy geht: das Script, im Finale „sanfter + halbes Tempo“ halbiert
function sendActions() {
  return modulesReady.has('finale') ? effectiveActions(toolActions('handy')) : toolActions('handy');
}
// Was der Satisfyer bekommt: eigene Fassung (ungekürzt), sonst gleich
function vibeActions() {
  return modulesReady.has('finale') ? effectiveActions(toolActions('vibe')) : toolActions('vibe');
}

// Für den Vibrator: laufendes Video-Script und aktuelle Stelle (nur im Modus „Sync“)
// Springt oder lädt das Video (seeking/waiting), ruhen die Geräte – sonst vibriert der Satisfyer
// schon mit der neuen Stelle, während das Bild noch steht.
export function videoScriptSource() {
  if (!syncActive() || !script || !videoPlaying() || video.seeking || video.readyState < 3) return null;
  return { actions: vibeActions(), ms: mediaTime() * 1000, video: true };
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
export const base = document.createElement('canvas');

const HEAT = [[0, [30, 60, 160]], [120, [30, 144, 255]], [220, [40, 200, 100]], [320, [240, 210, 40]], [420, [250, 130, 30]], [520, [230, 40, 50]]];
export function heatColor(speed) {
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

export function duration() {
  if (hq.active && hq.duration) return hq.duration * 1000;
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  return script ? script.actions[script.actions.length - 1].at : 0;
}

// Farbstreifen nach Tempo (Heatmap, Vorschau in den Intensitäts-Knöpfen)
export function paintHeat(g, a, total, w, h) {
  for (let i = 1; i < a.length; i++) {
    const dt = a[i].at - a[i - 1].at;
    if (dt <= 0) continue;
    g.fillStyle = heatColor((Math.abs(a[i].pos - a[i - 1].pos) / dt) * 1000);
    g.fillRect((a[i - 1].at / total) * w, 0, Math.max(1, (dt / total) * w), h);
  }
}
// Stash-Marker als gelbe Striche oben (Heatmap und Player-Leiste)
export function paintMarkers(g, total, w, h, dpr) {
  g.fillStyle = '#ffd54f';
  for (const m of currentMarkers()) g.fillRect((m.seconds * 1000 / total) * w - dpr, 0, 2 * dpr, h * 0.35);
}

let lastDrawn = -1;
export function drawHeatmap() {
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = base.width = Math.round(canvas.clientWidth * dpr) || 800);
  const h = (canvas.height = base.height = Math.round(canvas.clientHeight * dpr) || 56);
  lastDrawn = -1;
  const b = base.getContext('2d');
  b.clearRect(0, 0, w, h);
  const total = duration();
  if (script && total > 0) {
    // Heatmap: Handy-Fassung, wenn eine Handy verbunden ist, sonst die des Satisfyers
    const a = toolActions(typeof hasHandy === 'function' && !hasHandy() && hasVibe() ? 'vibe' : 'handy');
    const x = (ms) => (ms / total) * w;
    paintHeat(b, a, total, w, h);
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
    paintMarkers(b, total, w, h, dpr);
    // Für die Handy angepasste Stellen (Takt-Schutz): feine türkise Striche unten
    if (modulesReady.has('tools')) {
      b.fillStyle = 'rgba(0, 229, 255, .95)';
      for (const at of adaptedMarks()) b.fillRect((at / total) * w - dpr / 2, h * 0.78, Math.max(1, dpr), h * 0.22);
    }
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
// Einmalig (1.19.2): alter Standard „Hub max 90“ -> 100, auch in den je Szene gemerkten Werten
if (!store.get('hubFix1192', false)) {
  if (store.get('max', 100) === 90) store.set('max', 100);
  const dev = store.get('sceneDev', {});
  let changed = false;
  Object.values(dev).forEach((d) => { if (d && d.max === 90) { d.max = 100; changed = true; } });
  if (changed) store.set('sceneDev', dev);
  store.set('hubFix1192', true);
}
$('slideMin').value = store.get('min', 0);
$('slideMax').value = store.get('max', 100);
$('invert').checked = store.get('invert', false);

function updateOutputs() {
  $('offsetVal').textContent = `${$('offset').value} ms`;
  $('minVal').textContent = `${$('slideMin').value} %`;
  $('maxVal').textContent = `${$('slideMax').value} %`;
  $('hubSummary').textContent = `· Hub ${$('slideMin').value}–${$('slideMax').value} %`;
}
// Feineinstellungen im Geräte-Bereich: auf/zu merken
document.querySelectorAll('details.dev-fine').forEach((d) => {
  d.open = store.get('fine.' + d.dataset.fine, false);
  d.addEventListener('toggle', () => store.set('fine.' + d.dataset.fine, d.open));
});
updateOutputs();

// 1.19.11: welche Handy-API gerade läuft (im Geräte-Fenster)
function showHandyApi() {
  $('handyApi').textContent = !handy.connected ? ''
    : handy.v3 ? '✓ Handy-API v3 (mit Application ID) – auch bei 0,5×–2× im Takt'
      : 'Handy-API v2 – für v3 die Application ID in ⚙️ → Geräte eintragen';
}
setInterval(showHandyApi, 2000);

// 1.19.11: Automatisches Verbinden still – nur der Status oben; erst nach dem letzten Versuch EINE ruhige Meldung
const AUTO_RETRY_S = [3, 10, 30, 60];
let autoRetries = 0;
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
    if (!auto) log(`Verbunden${api}.`);
    autoRetries = 0;
    await applySlide();
    if (script) await preloadScript();
  } catch (e) {
    // Beim Start einfach ausgeschaltet = kein Fehler, nur „aus“
    if (auto && e.kind === 'offline') setStatus('off', 'aus');
    else setStatus(auto ? 'off' : 'err', handyErrText(e));
    // 1.19.7: Nach dem Neuladen ist die Handy-Cloud manchmal kurz nicht bereit (oder bremst wegen vieler Anfragen) –
    // automatisch noch ein paar Mal versuchen statt getrennt zu bleiben
    if (auto && e.kind !== 'auth' && autoRetries < AUTO_RETRY_S.length) {
      setTimeout(() => { if (!handy.connected && $('key').value.trim()) connectHandy(true); }, AUTO_RETRY_S[autoRetries++] * 1000);
    } else if (auto) {
      log('Handy nicht erreichbar – einschalten (WLAN, LED blau), dann oben auf den Status tippen und verbinden.');
    } else {
      log((e.message || e) + ' – oben auf den Status tippen und „Verbinden“.', true);
    }
  } finally {
    btn.disabled = false;
  }
}
$('connect').addEventListener('click', () => { autoRetries = AUTO_RETRY_S.length; connectHandy(); });
// 1.19.11: zurück in der App (z. B. nach Neuladen im Hintergrund) und nicht verbunden -> still neu versuchen
document.addEventListener('visibilitychange', () => {
  if (document.hidden || handy.connected || $('connect').disabled || !$('autoConnect').checked || !$('key').value.trim()) return;
  autoRetries = 0;
  connectHandy(true);
});
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
// 1.19.7: Key auch im Geräte-Fenster (🔑 Verbindung) – gespiegelt zu ⚙️ → Geräte (Application ID seit 1.19.9 nur dort)
export function mirrorField(mirror, src) {
  $(mirror).value = $(src).value;
  for (const ev of ['input', 'change']) {
    $(mirror).addEventListener(ev, () => { $(src).value = $(mirror).value; $(src).dispatchEvent(new Event(ev)); });
    $(src).addEventListener(ev, () => { if ($(mirror).value !== $(src).value) $(mirror).value = $(src).value; });
  }
}
mirrorField('keyDev', 'key');
// Ohne Key gleich aufgeklappt
$('keyBox').open = !$('key').value.trim();

// ---------------------------------------------------------------------------
// „Läuft gerade“: unten in Bibliothek/Einstellungen/Steuern, solange ein Video geladen ist
// ---------------------------------------------------------------------------
function updateNowBar() {
  const loaded = !!video.currentSrc && !!nowPlaying;
  // Beim Stöbern: Mini-Player in der Ecke (Standard) oder nur die Leiste
  const corner = store.get('browseMini', 'left');
  // Läuft es schon im System-Fenster (Bild-in-Bild), kein zweites Fenster – nur die Leiste
  const mini = loaded && document.body.dataset.view !== 'player' && corner !== 'bar' && !$('drop').classList.contains('fs')
    && !document.pictureInPictureElement;
  document.body.classList.toggle('mini-on', mini);
  document.body.classList.toggle('mini-right', corner === 'right');
  $('miniPlay').textContent = videoPlaying() ? '❚❚' : '▶';
  $('nowBar').hidden = !loaded || mini || document.body.dataset.view === 'player';
  if ($('nowBar').hidden) return;
  $('nowTitle').textContent = $('ovTitle').textContent;
  $('nowPlay').textContent = videoPlaying() ? '❚❚' : '▶';
}
setInterval(updateNowBar, 500);

// Welche Geräte verbunden sind -> nur deren Regler zeigen (CSS: has-handy / has-vibe / has-dev)
export const hasHandy = () => handy.connected || (modulesReady.has('stroker') && strokers().length > 0);
export const hasVibe = () => modulesReady.has('vibe') && allVibes().some((d) => !d.linear?.length);
let lastDevState = '';
const HANDY_SLOW_MS = 600; // ab dieser Antwortzeit der Handy-Cloud: Status gelb
export function updateDevClasses() {
  const h = hasHandy(), v = hasVibe();
  if (lastDevState !== `${h}${v}`) { lastDevState = `${h}${v}`; if (modulesReady.has('tools')) toolsChanged(); }
  document.body.classList.toggle('has-handy', h);
  document.body.classList.toggle('has-vibe', v);
  document.body.classList.toggle('has-dev', h || v);
  // Status oben: ein Wort für alle Geräte; Handy-Cloud spürbar langsam = gelb
  const handySlow = handy.connected && Math.max(handy.rtt || 0, handy.lat || 0) > HANDY_SLOW_MS;
  const bleSlow = modulesReady.has('vibe') && vibeSlow();
  const slow = handySlow || bleSlow;
  $('devState').textContent = h || v ? (slow ? 'verbunden · langsam' : 'verbunden') : 'getrennt';
  $('devState').className = 'pill ' + (h || v ? (slow ? 'busy' : 'on') : 'off');
  $('devChip').title = handySlow ? `Handy-Cloud antwortet langsam (${Math.round(Math.max(handy.rtt || 0, handy.lat || 0))} ms) – Befehle kommen verzögert an`
    : bleSlow ? 'Bluetooth zum Satisfyer schwankt – Vibration kann leicht daneben liegen' : 'Geräte – antippen für Verbinden, Offset, Hub, Stärke';
  $('handyLat').textContent = handy.connected && handy.rtt ? `${handy.modelName ? handy.modelName + ' · ' : ''}Handy-Cloud: ${Math.round(Math.max(handy.rtt, handy.lat || 0))} ms Antwortzeit · API ${handy.v3 ? 'v3' : 'v2'} – die Uhr wird abgeglichen, kein Vorlauf nötig` : '';
  // Verbinden-Knopf zeigt den Zustand (verbunden = grau, „neu verbinden“)
  const btn = $('connect');
  if (!btn.disabled) {
    btn.textContent = handy.connected ? '✓ Verbunden – neu verbinden' : 'Verbinden';
    btn.classList.toggle('secondary', handy.connected);
  }
  // Video ohne Funscript und „Keine Steuerung“: Geräte-Regler und Geräte-Knöpfe sind nutzlos
  const loaded = !!nowPlaying;
  document.body.classList.toggle('dev-idle', loaded && !script && !(modulesReady.has('selfctl') && selfCtl.mode === 'self'));
  // Hinweis im Player: Gerät da, Video mit Script, aber Sync aus
  $('syncHint').hidden = !(h || v) || !script || appMode !== 'stream' || document.body.dataset.view !== 'player';
}
setInterval(updateDevClasses, 500);
$('syncHintOn').addEventListener('click', () => {
  store.set('lastWatchMode', 'sync');
  setMode('sync');
  showView('player');
  updateDevClasses();
  log('🔄 Geräte folgen dem Video.');
});

// „Mehr zur Szene“ nur zeigen, wenn darin etwas steht (und es nicht unter ⚙️ → Anzeige ausgeblendet ist)
function updateSceneMore() {
  const parts = ['scenePeople', 'sceneTags', 'sceneMarkers', 'sceneDetails'].map($);
  const shown = parts.filter((p) => p.textContent.trim() && getComputedStyle(p).display !== 'none');
  $('sceneMore').hidden = !shown.length;
  const single = shown.length === 1;
  $('sceneMore').classList.toggle('single', single);
  if (single) $('sceneMore').open = true;
}
setInterval(updateSceneMore, 1000);
$('nowPlay').addEventListener('click', () => { togglePlay(); setTimeout(updateNowBar, 100); });
$('nowOpen').addEventListener('click', () => openPlayer());
$('miniPlay').addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); setTimeout(updateNowBar, 100); });
$('miniOpen').addEventListener('click', (e) => { e.stopPropagation(); openPlayer(); });
$('miniClose').addEventListener('click', (e) => { e.stopPropagation(); closeVideo(); });
$('drop').addEventListener('click', (e) => {
  if (!document.body.classList.contains('mini-on') || e.target.closest('#miniCtl')) return;
  e.stopPropagation();
  openPlayer();
}, true);
$('browseMini').value = store.get('browseMini', 'left');
$('browseMini').addEventListener('change', () => { store.set('browseMini', $('browseMini').value); updateNowBar(); });
// System-Bild-in-Bild (schwebt auch über anderen Apps)
$('ovPip').hidden = !document.pictureInPictureEnabled;
$('ovPip').addEventListener('click', () => {
  if (document.pictureInPictureElement) return document.exitPictureInPicture().catch(() => {});
  video.requestPictureInPicture().then(() => {
  }).catch((e) => log('Bild-in-Bild: ' + e.message, true));
});
// App verlassen, während das Video läuft -> Bild-in-Bild (⚙️ → Anzeige, pro Gerät).
// Chrome erlaubt das automatisch nur über die Media Session („enterpictureinpicture“);
// Safari kennt dafür autoPictureInPicture. Ob der Browser es tut, entscheidet er selbst.
$('autoPip').checked = store.get('autoPip', true);
function applyAutoPip() {
  const on = $('autoPip').checked;
  video.autoPictureInPicture = on;
  try {
    navigator.mediaSession?.setActionHandler('enterpictureinpicture', on ? () => {
      if (!document.pictureInPictureElement && videoPlaying()) video.requestPictureInPicture().catch(() => {});
    } : null);
  } catch { /* Browser kennt die Aktion nicht */ }
}
$('autoPip').addEventListener('change', () => { store.set('autoPip', $('autoPip').checked); applyAutoPip(); });
applyAutoPip();
// Zurück aus dem kleinen Fenster: Android schließt es und hält das Video dabei an – lief es, weiterspielen.
// (Im kleinen Fenster selbst pausiert = bleibt pausiert: dann war es schon vorher angehalten.)
let pipWasPlaying = false;
video.addEventListener('enterpictureinpicture', () => { pipWasPlaying = !video.paused; updateNowBar(); });
video.addEventListener('pause', () => { if (document.pictureInPictureElement && document.visibilityState === 'hidden') pipWasPlaying = false; });
video.addEventListener('leavepictureinpicture', () => {
  const resume = pipWasPlaying;
  setTimeout(() => { if (resume && video.paused && video.currentSrc) video.play().catch(() => {}); updateNowBar(); }, 300);
});
// Aus dem Vollbild in den Hintergrund: das Video selbst ins kleine Fenster
// (sonst nimmt Android den ganzen Vollbild-Bereich – der bleibt im Hintergrund schwarz).
// 1.19.9: wieder nur aus dem Video-Vollbild – von der Player-Seite schaltete Chrome (Android) das Video auf
// Bild-in-Bild, zeigte aber kein Fenster; zurück in der App blieb es grau. Ein so hängendes Bild-in-Bild
// beendet der Player beim Zurückkommen selbst.
let autoPipAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (autoPipAt && document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
    autoPipAt = 0;
    return;
  }
  if (!$('autoPip').checked || !videoPlaying()) return;
  if (!document.pictureInPictureElement && document.fullscreenElement === video) {
    autoPipAt = Date.now();
    video.requestPictureInPicture().catch(() => { autoPipAt = 0; });
  }
});

// Kopfzeile kompakt um die Kamera herum (⚙️ → Anzeige)
// Pixel-Smartphones haben die Kamera oben mittig -> dort standardmäßig an
$('hdrNotch').checked = store.get('hdrNotch', /Pixel/i.test(navigator.userAgent));
const applyHdr = () => document.body.classList.toggle('hdr-notch', $('hdrNotch').checked);
$('hdrNotch').addEventListener('change', () => { store.set('hdrNotch', $('hdrNotch').checked); applyHdr(); });
applyHdr();
if (store.get('hdrNotch', null) === null && navigator.userAgentData?.getHighEntropyValues) {
  navigator.userAgentData.getHighEntropyValues(['model']).then(({ model }) => {
    if (!/pixel/i.test(model || '') || store.get('hdrNotch', null) !== null) return;
    $('hdrNotch').checked = true;
    applyHdr();
  }).catch(() => {});
}
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
    setStatus('err', handyErrText(e));
    log(e, true);
  }
}
$('resyncBtn').addEventListener('click', manualResync);
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
export function offsetKey() { return hq.src || ''; }
// Hub und Satisfyer-Stärke dieser Szene (gemerkt wie der Offset)
function loadSceneDev() {
  const d = store.get('sceneDev', {})[offsetKey()] || {};
  $('slideMin').value = d.min ?? store.get('min', 0);
  $('slideMax').value = d.max ?? store.get('max', 100);
  $('vibeScene').value = d.vibe ?? 100;
  $('vibeSceneVal').textContent = `${$('vibeScene').value} %`;
  updateOutputs();
  if (handy.connected) handy.slide(Number($('slideMin').value), Number($('slideMax').value)).catch(() => {});
}
$('vibeScene').addEventListener('input', () => {
  $('vibeSceneVal').textContent = `${$('vibeScene').value} %`;
  const k = offsetKey();
  if (!k) return;
  const map = store.get('sceneDev', {});
  map[k] = { ...map[k], vibe: Number($('vibeScene').value) };
  store.set('sceneDev', map);
});

// Offset pro Szene + woher er kommt (offsetInfo: { how: 'calib' | 'hand', at }) – steht neben dem Regler
export let offsetSource = 'hand';
export function setOffsetSource(v) { offsetSource = v; }
function showOffsetInfo() {
  updateOutputs();
  const k = offsetKey();
  const scene = k && k in store.get('offsets', {});
  const info = scene ? store.get('offsetInfo', {})[k] : null;
  const date = info?.at ? ' ' + new Date(info.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
  $('offsetVal').textContent += scene ? (info?.how === 'calib' ? ` · Szene · 🎯 eingemessen${date}` : ' · Szene') : '';
  $('offsetReset').hidden = !scene;
  const v = Number($('offset').value);
  $('offsetSum').textContent = `${v > 0 ? '+' : ''}${v} ms${scene ? ' · Szene' : ''}`;
}
function loadOffsetForVideo() {
  loadSceneDev();
  const map = store.get('offsets', {});
  $('offset').value = offsetKey() in map ? map[offsetKey()] : store.get('offset', 0);
  showOffsetInfo();
}
$('offset').addEventListener('input', updateOutputs);
// −/+ wie den Schieber bewegen (gleiche Speicherung je Szene)
[['offMinus', -10], ['offPlus', 10]].forEach(([id, d]) => $(id).addEventListener('click', () => {
  $('offset').value = Number($('offset').value) + d;
  $('offset').dispatchEvent(new Event('change'));
}));
$('offset').addEventListener('change', () => {
  const v = Number($('offset').value);
  const k = offsetKey();
  if (k) {
    const map = store.get('offsets', {});
    map[k] = v;
    store.set('offsets', map);
    const info = store.get('offsetInfo', {});
    info[k] = { how: offsetSource, at: Date.now() };
    store.set('offsetInfo', info);
  } else {
    store.set('offset', v);
  }
  offsetSource = 'hand';
  showOffsetInfo();
  resync();
});
// ↺ Szenen-Offset verwerfen -> wieder der allgemeine Wert
$('offsetReset').addEventListener('click', () => {
  const k = offsetKey();
  const map = store.get('offsets', {}), info = store.get('offsetInfo', {});
  delete map[k];
  delete info[k];
  store.set('offsets', map);
  store.set('offsetInfo', info);
  loadOffsetForVideo();
  resync();
});

export async function applySlide() {
  let min = Number($('slideMin').value);
  let max = Number($('slideMax').value);
  if (min >= max) {
    max = Math.min(100, min + 1);
    min = max - 1;
    $('slideMin').value = min;
    $('slideMax').value = max;
    updateOutputs();
  }
  // Gilt ab jetzt allgemein (bis 1.19.1 nur für die geladene Szene – andere Szenen zeigten den alten Wert)
  // und zusätzlich für diese Szene, damit ein dort gemerkter Hub nicht wieder greift
  store.set('min', min);
  store.set('max', max);
  const k = offsetKey();
  if (k) {
    const map = store.get('sceneDev', {});
    map[k] = { ...map[k], min, max };
    store.set('sceneDev', map);
  }
  if (handy.connected) {
    try { await handy.slide(min, max); } catch (e) { log(e, true); }
  }
}
let hubPreviewAt = 0;
function hubPreview(id) {
  if (!handy.connected || (handy.owner && handy.owner !== 'video') || videoPlaying() || Date.now() - hubPreviewAt < 250) return;
  hubPreviewAt = Date.now();
  // Hub vorübergehend 0–100, dann die Grenze anfahren; „change“ setzt den Hub wieder richtig
  handy.slide(0, 100).then(() => handy.hdspMove(Number($(id).value), 300)).catch(() => {});
}
['slideMin', 'slideMax'].forEach((id) => {
  $(id).addEventListener('input', updateOutputs);
  $(id).addEventListener('input', () => hubPreview(id));
  $(id).addEventListener('change', applySlide);
});

$('invert').addEventListener('change', () => {
  store.set('invert', $('invert').checked);
  if (handy.owner === 'video') resync();
});

// 1.19.9: Health Check – „verbunden“ wirklich prüfen: beim Zurückkommen (nach > 20 s im Hintergrund) und
// jede Minute. Handy: die Cloud fragen, ob sie online ist; Satisfyer: Bluetooth-Verbindung (vibe.js checkVibes).
let hiddenAt = 0, healthBusy = false;
async function checkDevices() {
  if (healthBusy) return;
  healthBusy = true;
  try {
    if (handy.connected) {
      let ok;
      try { ok = !!(await handy.req('GET', '/connected')).connected; } catch (e) { ok = e.kind === 'limit'; }
      if (!ok && handy.connected) {
        handy.connected = false;
        setStatus('off', 'getrennt');
        if (typeof updateDevClasses === 'function') updateDevClasses();
        deviceLost('Handy');
        autoRetries = 0;
        connectHandy(true);
      }
    }
    if (modulesReady.has('vibe')) checkVibes();
  } finally { healthBusy = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 20000) checkDevices();
  hiddenAt = 0;
});
setInterval(() => { if (!document.hidden) checkDevices(); }, 60000);

// 1.19.9: Reißt ein Gerät mitten im Video ab, hält das Video an (⚙️ → Notaus, abschaltbar) – sonst läuft es ohne Geräte weiter
export function deviceLost(name) {
  if (!$('pauseOnLoss').checked || document.hidden || !videoPlaying()) return;
  video.pause();
  log(`${name} getrennt – Video angehalten. Oben auf den Status tippen, um neu zu verbinden.`, true);
}
$('pauseOnLoss').checked = store.get('pauseOnLoss', true);
$('pauseOnLoss').addEventListener('change', () => store.set('pauseOnLoss', $('pauseOnLoss').checked));

// Drag & Drop + Dateiauswahl
const drop = $('drop');
// Erst mit dem neuen Video „geladen“ – das Leeren (load() ohne Quelle) zählt nicht
['loadeddata', 'error'].forEach((ev) => video.addEventListener(ev, () => { if (video.currentSrc) drop.classList.remove('loading'); }));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

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
