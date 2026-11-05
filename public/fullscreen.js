
import { modulesReady, video } from './state.js';
import { $, handy, store } from './handy.js';
import {
  base, duration, hq, mediaTime, paintMarkers, script, seekTo, stashSession, syncActive, videoPlaying,
} from './app.js';
import { active, emergencyStop, hampOn } from './control.js';
import { allVibes, setVibePaused, vibeLevel, vibePaused } from './vibe.js';
import { fin } from './finale.js';
import { selfRunning } from './selfctl.js';

// ===========================================================================
// Eigene Player-Bedienung (statt der Browser-Leiste), Vollbild fürs Smartphone,
// Not-Aus-Knopf und Bildschirm-wach-halten.
//   Vollbild läuft auf dem Player-Container (nicht auf dem <video>), damit die
//   Bedienung, der STOPP-Knopf und die Bildverbesserung sichtbar bleiben. Wo der
//   Browser kein Fullscreen erlaubt (iPhone), füllt der Container per CSS den
//   Bildschirm – als installierte App (Homescreen) ganz ohne Browserleisten.
// ===========================================================================

export const stage = $('drop');
const ov = $('ov');
let realFullscreen = false;

const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
export const isFs = () => stage.classList.contains('fs');

// ---------------------------------------------------------------------------
// Vollbild an/aus
// ---------------------------------------------------------------------------
// Vollbild nur mit dem Video (seit 1.19.3 immer): Android schickt beim Verlassen der App nur ein Video, das
// selbst im Vollbild ist, automatisch ins kleine Fenster (der ganze Player-Bereich bliebe schwarz).
// Dafür gibt es dann die Bedienleiste des Browsers statt der eigenen.
let nativeFs = false;
async function enterFullscreen() {
  if (isFs() || nativeFs) return;
  // 1.19.11: wieder eigenes Vollbild mit allen Knöpfen und Einpassen/Füllen (Nutzerwunsch) – das echte
  // Video-Vollbild (enterNativeFullscreen) brachte nur die Browser-Leiste. Bild-in-Bild dafür per ⧉.
  stage.classList.add('fs');
  document.body.classList.add('fs-open');
  $('ovFs').textContent = '✕';
  $('ovFs').title = 'Vollbild beenden (F)';
  realFullscreen = false;
  try {
    if (stage.requestFullscreen) { await stage.requestFullscreen({ navigationUI: 'hide' }); realFullscreen = true; }
    else if (stage.webkitRequestFullscreen) { stage.webkitRequestFullscreen(); realFullscreen = true; }
  } catch { /* iPhone: CSS-Vollbild reicht */ }
  // Querformat erzwingen (Android); Hochkant-Videos bleiben hochkant
  try {
    const portrait = video.videoHeight > video.videoWidth;
    await screen.orientation.lock(portrait ? 'portrait' : 'landscape');
  } catch { /* nicht unterstützt */ }
  showOverlay();
  window.dispatchEvent(new Event('resize'));
}

function exitFullscreen() {
  if (!isFs()) return;
  stage.classList.remove('fs');
  document.body.classList.remove('fs-open');
  $('ovFs').textContent = '⛶';
  $('ovFs').title = 'Vollbild (F)';
  try { screen.orientation.unlock(); } catch { /* egal */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  realFullscreen = false;
  window.dispatchEvent(new Event('resize'));
}
const toggleFullscreen = () => (isFs() ? exitFullscreen() : enterFullscreen());

// Füllen (Zoom, schneidet Ränder ab) oder Einpassen (ganzes Bild, ggf. schwarze Balken) – nur im Vollbild
function setFit(fit) {
  stage.dataset.fit = fit;
  $('ovFit').textContent = fit === 'cover' ? 'Einpassen' : 'Füllen';
  store.set('fit', fit);
  window.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------------------
// Bedienelemente
// ---------------------------------------------------------------------------
let hideTimer;
export function showOverlay() {
  ov.classList.remove('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!video.paused) ov.classList.add('hide'); }, 3000);
}
function hideOverlay() {
  clearTimeout(hideTimer);
  if (!video.paused) ov.classList.add('hide');
}

export function togglePlay() {
  if (video.paused) video.play().catch(() => {}); else video.pause();
}
function seekBy(s) {
  seekTo(mediaTime() + s);
  showOverlay();
}

// Einfach tippen = Bedienung ein/aus, doppelt tippen links/rechts = ±5/10 s (⚙️ → Anzeige), Mitte = Vollbild
let lastTap = 0, tapTimer;
// Gedrückt halten (1.19.2): rechts = doppelte Geschwindigkeit, links = im selben Tempo rückwärts; Loslassen = normal.
// Rückwärts kann der Browser nicht abspielen: angehalten alle 0,1 s 0,2 s zurück. Beim HQ-Stream würde jeder
// Sprung den Stream neu starten – dort läuft nur die Zielzeit mit, gesprungen wird einmal beim Loslassen.
let holdTimer = null, holdRepeat = null, held = false, holdState = null;
export const endHold = () => {
  clearTimeout(holdTimer);
  clearInterval(holdRepeat);
  holdTimer = holdRepeat = null;
  if (!holdState) return;
  if (hq.active && holdState.target !== null) seekTo(holdState.target);
  video.playbackRate = holdState.rate;
  if (holdState.paused) video.pause(); else video.play().catch(() => {});
  ov.classList.remove('fast', 'rewind');
  delete ov.dataset.t;
  holdState = null;
};
// Sprungweite fürs Doppeltippen links/rechts: 5 oder 10 s (⚙️ → Anzeige) – die −/+-Knöpfe gibt es seit 1.19.8 nicht mehr
const skipSec = () => (store.get('skipSec', 10) === 5 ? 5 : 10);
function applySkip() {
  $('skipSec').value = String(skipSec());
}

function updateMute() { $('ovMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; }

// Zeitleiste mit Heatmap und Markern; tippen/ziehen zum Springen
const bar = $('ovBar');
let bctx;
function drawOvBar() {
  if (!stage.classList.contains('ready')) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(bar.clientWidth * dpr), h = Math.round(bar.clientHeight * dpr);
  if (!w || !h) return;
  if (bar.width !== w || bar.height !== h) { bar.width = w; bar.height = h; }
  bctx.clearRect(0, 0, w, h);
  bctx.fillStyle = 'rgba(255,255,255,.18)';
  bctx.fillRect(0, 0, w, h);
  if (base.width && base.height && script && syncActive()) bctx.drawImage(base, 0, 0, w, h);
  const total = duration();
  if (total > 0) {
    const x = ((seekPreview ?? mediaTime()) * 1000 / total) * w;
    // 2.0: Play-Verlauf als Neon-Linie unten; mit Script bleibt die Heatmap sichtbar, der Rest wird dunkler
    const neon = bctx.createLinearGradient(0, 0, w, 0);
    neon.addColorStop(0, '#22d3ee'); neon.addColorStop(0.55, '#b46cff'); neon.addColorStop(1, '#ff4fa3');
    if (script && syncActive()) {
      bctx.fillStyle = 'rgba(11,11,13,.28)';
      bctx.fillRect(x, 0, w - x, h);
      bctx.fillStyle = neon;
      bctx.fillRect(0, h - 3 * dpr, x, 3 * dpr);
    } else {
      bctx.fillStyle = neon;
      bctx.fillRect(0, 0, x, h);
    }
    bctx.fillStyle = '#fff';
    bctx.fillRect(x - dpr, 0, 2 * dpr, h);
    paintMarkers(bctx, total, w, h, dpr);
  }
  $('ovTime').textContent = `${fmtClock(seekPreview ?? mediaTime())} /${fmtClock(total / 1000)}${hq.active ? ' · HQ' : ''}`;
}

let seeking = false;
let seekPreview = null;
function seekFromBar(e) {
  const total = duration();
  if (!total) return;
  const r = bar.getBoundingClientRect();
  const target = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total / 1000;
  // Beim HQ-Stream erst beim Loslassen springen (jeder Sprung startet die Umwandlung neu)
  if (hq.active) { seekPreview = target; drawOvBar(); return; }
  seekTo(target);
  drawOvBar();
  showOverlay();
}
// Vorschaubild aus dem Stash-Sprite über der Zeitleiste
function showSeekPreview(e) {
  const sp = stashSession?.sprites;
  const box = $('seekPreview');
  const total = duration();
  // Nur beim Spulen (Finger/Maus auf der Leiste) bzw. mit Maus darüber
  if (!total || (!seeking && e.pointerType !== 'mouse')) { box.hidden = true; return; }
  const r = bar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const t = frac * total / 1000;
  // Bild erst zeigen, wenn das Sprite wirklich geladen ist – sonst nur die Zeit (kein schwarzes Kästchen)
  const cue = sp?.ready ? sp.cues.find((c) => t >= c.start && t < c.end) || sp.cues[sp.cues.length - 1] : null;
  box.hidden = false;
  box.classList.toggle('time-only', !cue);
  const w = cue ? cue.w : 60;
  if (cue) {
    box.style.width = cue.w + 'px';
    box.style.height = cue.h + 'px';
    box.style.backgroundImage = `url("${sp.url}")`;
    box.style.backgroundPosition = `-${cue.x}px -${cue.y}px`;
  } else {
    box.style.backgroundImage = 'none';
  }
  const pr = (box.offsetParent || bar).getBoundingClientRect();
  box.style.left = (r.left - pr.left + Math.max(0, Math.min(r.width - w, frac * r.width - w / 2))) + 'px';
  box.querySelector('span').textContent = fmtClock(t);
}

// ---------------------------------------------------------------------------
// Not-Aus: schwebender Knopf, Esc-Taste, automatisch bei Bildschirmsperre
// ---------------------------------------------------------------------------
// Läuft gerade etwas, das ein Gerät bewegt?
function anyRunning() {
  const devices = handy.connected || allVibes().length > 0;
  return devices && ((videoPlaying() && !!script && syncActive()) || !!active || hampOn || vibeLevel > 0 || (modulesReady.has('finale') && fin.active) || (modulesReady.has('selfctl') && selfRunning()));
}
const applyStopButton = () => document.body.classList.toggle('no-stop-btn', !$('stopButton').checked);

// Auto-Stopp (⚙️ → Notaus): keine Bedienung und kein laufendes Video -> nach X Minuten alles aus.
// Ein laufendes Video mit Script zählt als „dabei“ – nur Direktsteuerung, Patterns, manuelle Stärke usw.
let lastInput;

// ---------------------------------------------------------------------------
// Bildschirm nicht abschalten, solange etwas läuft
// ---------------------------------------------------------------------------
let wakeLock = null;
async function updateWakeLock() {
  if (!('wakeLock' in navigator)) return;
  const want = document.visibilityState === 'visible' && (anyRunning() || videoPlaying());
  if (want && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* z. B. Akku-Sparmodus */ }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// Start (main.js ruft die Module in fester Reihenfolge auf): alles, was beim Laden der Seite einmal läuft
export function init() {
  // Bedienung erst zeigen, wenn ein Video geladen ist
  video.addEventListener('loadedmetadata', () => { stage.classList.add('ready'); showOverlay(); drawOvBar(); });
  video.addEventListener('emptied', () => stage.classList.remove('ready'));
  // Zurück-Geste / Esc beendet das echte Fullscreen -> auch unseren Modus
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
    if (nativeFs && document.fullscreenElement !== video) { nativeFs = false; video.controls = false; try { screen.orientation.unlock(); } catch { /* egal */ } }
    if (realFullscreen && !document.fullscreenElement && !document.webkitFullscreenElement) exitFullscreen();
  }));
  $('ovFs').addEventListener('click', toggleFullscreen);
  // nach test2: Player verlassen (Zurück-Geste, Navigation) beendet das Vollbild – sonst blieb der Player im
  // Vollbild-Zustand hängen und der Mini-Player beim Stöbern war leer/schwarz
  window.addEventListener('hp:view', () => { if (document.body.dataset.view !== 'player' && isFs()) exitFullscreen(); });
  setFit(store.get('fit', 'cover'));
  $('ovFit').addEventListener('click', () => { setFit(stage.dataset.fit === 'cover' ? 'contain' : 'cover'); showOverlay(); });
  $('ovHit').addEventListener('pointerdown', (e) => {
    const r = stage.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 3 ? -1 : e.clientX > r.right - r.width / 3 ? 1 : 0;
    held = false;
    if (!side) return;
    holdTimer = setTimeout(() => {
      held = true;
      showOverlay();
      holdState = { paused: video.paused, rate: video.playbackRate, target: null };
      if (side > 0) {
        video.playbackRate = 2;
        if (video.paused) video.play().catch(() => {});
        ov.classList.add('fast');
      } else {
        video.pause();
        ov.classList.add('rewind');
        holdState.target = mediaTime();
        const step = () => {
          holdState.target = Math.max(0, holdState.target - 0.2);
          ov.dataset.t = fmtClock(holdState.target);
          if (!hq.active) seekTo(holdState.target);
          showOverlay();
        };
        step();
        holdRepeat = setInterval(step, 100);
      }
    }, 450);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('ovHit').addEventListener(ev, endHold));
  $('ovHit').addEventListener('click', (e) => {
    if (held) { held = false; return; } // war gedrückt halten, kein Tippen
    const now = Date.now();
    const r = stage.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 3 ? -1 : e.clientX > r.right - r.width / 3 ? 1 : 0;
    if (now - lastTap < 300) {
      clearTimeout(tapTimer);
      lastTap = 0;
      if (side) seekBy(side * skipSec());
      else toggleFullscreen();
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(() => {
      // Maus: Klick = Play/Pause (wie gewohnt). Touch: Bedienung ein/aus.
      if (e.pointerType === 'mouse' || (!e.pointerType && matchMedia('(hover: hover)').matches)) { togglePlay(); showOverlay(); }
      else if (ov.classList.contains('hide')) showOverlay();
      else hideOverlay();
    }, 280);
  });
  stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showOverlay(); });
  $('ovPlay').addEventListener('click', () => { togglePlay(); showOverlay(); });
  $('skipSec').addEventListener('change', () => { store.set('skipSec', Number($('skipSec').value)); applySkip(); });
  applySkip();
  $('ovVibe').addEventListener('click', () => { setVibePaused(!vibePaused); showOverlay(); });
  $('ovStop').addEventListener('click', () => emergencyStop());
  $('ovMute').addEventListener('click', () => { video.muted = !video.muted; store.set('muted', video.muted); showOverlay(); });
  video.addEventListener('volumechange', updateMute);
  video.muted = store.get('muted', false);
  updateMute();
  video.addEventListener('play', () => { $('ovPlay').textContent = '❚❚'; showOverlay(); });
  video.addEventListener('pause', () => { $('ovPlay').textContent = '▶'; showOverlay(); });
  // 1.19.7: Videowechsel – load() hält das alte Video an, ohne „pause“ zu melden; sonst bliebe ❚❚ stehen
  ['emptied', 'loadstart'].forEach((ev) => video.addEventListener(ev, () => { $('ovPlay').textContent = video.paused ? '▶' : '❚❚'; }));
  bctx = bar.getContext('2d');
  setInterval(drawOvBar, 250);
  video.addEventListener('timeupdate', drawOvBar);
  bar.addEventListener('pointermove', showSeekPreview);
  bar.addEventListener('pointerleave', () => { if (!seeking) $('seekPreview').hidden = true; });
  bar.addEventListener('pointerdown', (e) => { seeking = true; bar.setPointerCapture(e.pointerId); seekFromBar(e); showSeekPreview(e); });
  bar.addEventListener('pointermove', (e) => { if (seeking) seekFromBar(e); });
  bar.addEventListener('pointerup', () => {
    seeking = false;
    $('seekPreview').hidden = true;
    if (seekPreview !== null) { const t = seekPreview; seekPreview = null; seekTo(t); }
  });
  // Tastatur im Player: Leertaste/K Play, ←/→ ±5 s, F Vollbild, M Ton
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || document.body.dataset.view !== 'player') return;
    if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); togglePlay(); showOverlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
    else if (e.key === 'f') toggleFullscreen();
    else if (e.key === 'm') { video.muted = !video.muted; showOverlay(); }
  });
  // Abschaltbar (⚙️ → Notaus); Esc, „Alles stoppen“ und Stopp bei Bildschirmsperre bleiben
  // 1.19.8: STOPP-Knöpfe und Stopp bei Bildschirmsperre standardmäßig aus – Esc und „Alles stoppen“ im Geräte-Fenster bleiben
  $('stopButton').checked = store.get('stopButton', false);
  $('stopButton').addEventListener('change', () => { store.set('stopButton', $('stopButton').checked); applyStopButton(); });
  applyStopButton();
  setInterval(() => { $('fabStop').hidden = !anyRunning() || !$('stopButton').checked; }, 300);
  $('fabStop').addEventListener('click', () => emergencyStop());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (anyRunning()) emergencyStop();
    exitFullscreen();
  });
  $('stopHidden').checked = store.get('stopHidden', false);
  $('stopHidden').addEventListener('change', () => store.set('stopHidden', $('stopHidden').checked));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !$('stopHidden').checked || !anyRunning()) return;
    // Läuft das Video als Bild-in-Bild weiter, schaut man noch zu -> nicht stoppen.
    // Kurz warten: das kleine Fenster öffnet sich erst nach dem Verlassen der App.
    setTimeout(() => {
      if (document.visibilityState === 'hidden' && !document.pictureInPictureElement && anyRunning()) {
        emergencyStop('Bildschirm gesperrt / App gewechselt');
      }
    }, 700);
  });
  lastInput = Date.now();
  ['pointerdown', 'keydown', 'input', 'wheel'].forEach((ev) => document.addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true }));
  // 1.19.7: Standard „nie“ (vorher 10 min) – STOPP-Knopf, Esc und Stopp bei Bildschirmsperre bleiben
  $('autoStop').value = String(store.get('autoStop', 0));
  $('autoStop').addEventListener('change', () => store.set('autoStop', Number($('autoStop').value)));
  setInterval(() => {
    const min = Number(store.get('autoStop', 0));
    if (!min || videoPlaying() || !anyRunning() || Date.now() - lastInput < min * 60000) return;
    emergencyStop(`Auto-Stopp: ${min} min keine Bedienung`);
    lastInput = Date.now();
  }, 15000);
  setInterval(updateWakeLock, 2000);
  document.addEventListener('visibilitychange', updateWakeLock);
}
