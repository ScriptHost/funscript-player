'use strict';

// ===========================================================================
// Eigene Player-Bedienung (statt der Browser-Leiste), Vollbild fürs Smartphone,
// Not-Aus-Knopf und Bildschirm-wach-halten.
//   Vollbild läuft auf dem Player-Container (nicht auf dem <video>), damit die
//   Bedienung, der STOPP-Knopf und die Bildverbesserung sichtbar bleiben. Wo der
//   Browser kein Fullscreen erlaubt (iPhone), füllt der Container per CSS den
//   Bildschirm – als installierte App (Homescreen) ganz ohne Browserleisten.
// ===========================================================================

const stage = $('drop');
const ov = $('ov');
let realFullscreen = false;

const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const isFs = () => stage.classList.contains('fs');

// Bedienung erst zeigen, wenn ein Video geladen ist
video.addEventListener('loadedmetadata', () => { stage.classList.add('ready'); showOverlay(); drawOvBar(); });
video.addEventListener('emptied', () => { if (!remote.on) stage.classList.remove('ready'); });

// ---------------------------------------------------------------------------
// Vollbild an/aus
// ---------------------------------------------------------------------------
async function enterFullscreen() {
  if (isFs()) return;
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
// Als Fernbedienung schaltet ⛶ das Vollbild am Bildschirm
const toggleFullscreen = () => (remote.on ? remoteCmd('fs') : isFs() ? exitFullscreen() : enterFullscreen());

// Zurück-Geste / Esc beendet das echte Fullscreen -> auch unseren Modus
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  if (realFullscreen && !document.fullscreenElement && !document.webkitFullscreenElement) exitFullscreen();
}));

$('ovFs').addEventListener('click', toggleFullscreen);

// Füllen (Zoom, schneidet Ränder ab) oder Einpassen (ganzes Bild, ggf. schwarze Balken) – nur im Vollbild
function setFit(fit) {
  stage.dataset.fit = fit;
  $('ovFit').textContent = fit === 'cover' ? 'Einpassen' : 'Füllen';
  store.set('fit', fit);
  window.dispatchEvent(new Event('resize'));
}
setFit(store.get('fit', 'cover'));
$('ovFit').addEventListener('click', () => { setFit(stage.dataset.fit === 'cover' ? 'contain' : 'cover'); showOverlay(); });

// ---------------------------------------------------------------------------
// Bedienelemente
// ---------------------------------------------------------------------------
let hideTimer;
function showOverlay() {
  ov.classList.remove('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!video.paused) ov.classList.add('hide'); }, 3000);
}
function hideOverlay() {
  clearTimeout(hideTimer);
  if (!video.paused) ov.classList.add('hide');
}

function togglePlay() {
  if (remote.on) remoteCmd('toggle');
  else if (video.paused) video.play().catch(() => {}); else video.pause();
}
function seekBy(s) {
  seekTo(mediaTime() + s);
  showOverlay();
}

// Einfach tippen = Bedienung ein/aus, doppelt tippen links/rechts = ±10 s, Mitte = Vollbild
let lastTap = 0, tapTimer;
$('ovHit').addEventListener('click', (e) => {
  const now = Date.now();
  const r = stage.getBoundingClientRect();
  const side = e.clientX < r.left + r.width / 3 ? -1 : e.clientX > r.right - r.width / 3 ? 1 : 0;
  if (now - lastTap < 300) {
    clearTimeout(tapTimer);
    lastTap = 0;
    if (side) seekBy(side * 10);
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
$('ovBack').addEventListener('click', () => seekBy(-10));
$('ovFwd').addEventListener('click', () => seekBy(10));
$('ovVibe').addEventListener('click', () => { setVibePaused(!vibePaused); showOverlay(); });
$('ovStop').addEventListener('click', () => emergencyStop());

function updateMute() { $('ovMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; }
$('ovMute').addEventListener('click', () => { video.muted = !video.muted; store.set('muted', video.muted); showOverlay(); });
video.addEventListener('volumechange', updateMute);
video.muted = store.get('muted', false);
updateMute();

video.addEventListener('play', () => { $('ovPlay').textContent = '❚❚'; showOverlay(); });
video.addEventListener('pause', () => { $('ovPlay').textContent = '▶'; showOverlay(); });

// Zeitleiste mit Heatmap und Markern; tippen/ziehen zum Springen
const bar = $('ovBar');
const bctx = bar.getContext('2d');
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
    if (script && syncActive()) {
      bctx.fillStyle = 'rgba(0,0,0,.45)';
      bctx.fillRect(x, 0, w - x, h);
    } else {
      bctx.fillStyle = '#e0457b';
      bctx.fillRect(0, 0, x, h);
    }
    bctx.fillStyle = '#fff';
    bctx.fillRect(x - dpr, 0, 3 * dpr, h);
    bctx.fillStyle = '#ffd54f';
    for (const m of currentMarkers()) bctx.fillRect((m.seconds * 1000 / total) * w - dpr, 0, 2 * dpr, h * 0.35);
  }
  $('ovTime').textContent = `${fmtClock(seekPreview ?? mediaTime())} /${fmtClock(total / 1000)}${hq.active ? ' · HQ' : ''}`;
}
setInterval(drawOvBar, 250);
video.addEventListener('timeupdate', drawOvBar);

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
  if (!sp || !total) { box.hidden = true; return; }
  const r = bar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const t = frac * total / 1000;
  const cue = sp.cues.find((c) => t >= c.start && t < c.end) || sp.cues[sp.cues.length - 1];
  box.hidden = false;
  box.style.width = cue.w + 'px';
  box.style.height = cue.h + 'px';
  box.style.backgroundImage = `url("${sp.url}")`;
  box.style.backgroundPosition = `-${cue.x}px -${cue.y}px`;
  const pr = (box.offsetParent || bar).getBoundingClientRect();
  box.style.left = (r.left - pr.left + Math.max(0, Math.min(r.width - cue.w, frac * r.width - cue.w / 2))) + 'px';
  box.querySelector('span').textContent = fmtClock(t);
}
bar.addEventListener('pointermove', showSeekPreview);
bar.addEventListener('pointerleave', () => { if (!seeking) $('seekPreview').hidden = true; });

bar.addEventListener('pointerdown', (e) => { seeking = true; bar.setPointerCapture(e.pointerId); seekFromBar(e); });
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

// ---------------------------------------------------------------------------
// Not-Aus: schwebender Knopf, Esc-Taste, automatisch bei Bildschirmsperre
// ---------------------------------------------------------------------------
// Läuft gerade etwas, das ein Gerät bewegt?
function anyRunning() {
  const devices = handy.connected || allVibes().length > 0;
  return devices && ((videoPlaying() && !!script && syncActive()) || !!active || hampOn || vibeLevel > 0 || (typeof fin !== 'undefined' && fin.active) || (typeof selfRunning === 'function' && selfRunning()));
}

// Abschaltbar (Geräte → Sicherheit); Esc, „Alles stoppen“ und Stopp bei Bildschirmsperre bleiben
$('stopButton').checked = store.get('stopButton', true);
const applyStopButton = () => document.body.classList.toggle('no-stop-btn', !$('stopButton').checked);
$('stopButton').addEventListener('change', () => { store.set('stopButton', $('stopButton').checked); applyStopButton(); });
applyStopButton();
setInterval(() => { $('fabStop').hidden = !anyRunning() || !$('stopButton').checked; }, 300);
$('fabStop').addEventListener('click', () => emergencyStop());

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (anyRunning()) emergencyStop();
  exitFullscreen();
});

$('stopHidden').checked = store.get('stopHidden', true);
$('stopHidden').addEventListener('change', () => store.set('stopHidden', $('stopHidden').checked));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && $('stopHidden').checked && anyRunning()) {
    emergencyStop('Bildschirm gesperrt / App gewechselt');
  }
});

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
setInterval(updateWakeLock, 2000);
document.addEventListener('visibilitychange', updateWakeLock);
