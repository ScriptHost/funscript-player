'use strict';

// ===========================================================================
// 🧪 Beta (1.19.7): Vibration nach Ton – für Videos ohne Funscript.
//   Unter dem Video „🎵 Nach Ton“: der Satisfyer folgt Lautstärke und Rhythmus des Tons,
//   seit 1.19.8 auch die Handy (Tempo nach der geglätteten Lautheit, in 10er-Stufen über selfctl.js).
//   Web Audio: Video -> AnalyserNode -> Lautsprecher. Die Lautheit wird an den Pegel des
//   Videos angepasst (leise Filme vibrieren nicht schwächer), Anstiege (Schläge) betont.
//   Stärke min/max, „Stärke für diese Szene“, „Max. Geschwindigkeit“, Pause und STOPP gelten.
//   Ton von fremder Adresse ohne Freigabe liefert dem Browser nur Stille – Stash läuft über den
//   Player-Server (gleiche Adresse), Ordner-Videos ohnehin.
// ===========================================================================
const audioVibe = { ctx: null, analyser: null, buf: null, avg: 0, peak: 0.05, prev: 0, level: 0, at: 0, silentSince: 0 };

// Einmal anlegen (braucht einen Klick – der Knopf ist einer). Danach läuft der Ton immer über Web Audio.
function audioVibeSetup() {
  if (audioVibe.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    const ctx = new AC();
    const src = ctx.createMediaElementSource(video);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0;
    src.connect(an);
    an.connect(ctx.destination);
    Object.assign(audioVibe, { ctx, analyser: an, buf: new Float32Array(an.fftSize) });
    // Ohne laufenden AudioContext wäre das Video stumm – beim Abspielen immer fortsetzen
    video.addEventListener('play', () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); });
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return true;
  } catch (e) {
    log('Vibration nach Ton geht in diesem Browser nicht: ' + e.message, true);
    return false;
  }
}

// Für vibe.js: Stärke 0…1 nach Ton (null = nicht zuständig)
function audioVibeLevel() {
  if (selfCtl.mode !== 'audio' || script || !nowPlaying || !videoPlaying() || !audioVibe.analyser) return null;
  const now = performance.now();
  if (now - audioVibe.at < 40) return audioVibe.level; // vibe.js fragt je Gerät – einmal pro Takt rechnen
  audioVibe.at = now;
  audioVibe.analyser.getFloatTimeDomainData(audioVibe.buf);
  let sum = 0;
  for (const x of audioVibe.buf) sum += x * x;
  const rms = Math.sqrt(sum / audioVibe.buf.length);
  // Langsamer Mittelwert (≈ 2 s) und abklingende Spitze: Pegel des Videos
  audioVibe.avg = audioVibe.avg * 0.97 + rms * 0.03;
  audioVibe.peak = Math.max(rms, audioVibe.peak * 0.995, 0.02);
  // Lautheit über dem Grundpegel + Anstieg (Schlag/Stoß) betont
  const body = Math.max(0, (rms - audioVibe.avg * 0.5) / (audioVibe.peak - audioVibe.avg * 0.5 || 1));
  const rise = Math.max(0, rms - audioVibe.prev) / audioVibe.peak * 3;
  audioVibe.prev = rms;
  const level = Math.min(1, body * 0.75 + rise * 0.5);
  // Stille (oder Ton ohne Freigabe): aus
  audioVibe.level = rms < 0.003 ? 0 : level;
  if (rms < 0.0005) audioVibe.silentSince ||= now; else audioVibe.silentSince = 0;
  return audioVibe.level;
}

// Für die Handy (selfctl.js): Tempo 0–100 nach Ton. Ruhiger als beim Satisfyer (≈ 0,8 s geglättet) und in
// 10er-Stufen – jede Änderung ist ein Befehl an die Handy-Cloud.
const audioHandy = { level: 0, at: 0 };
function audioHandySpeed() {
  const raw = audioVibeLevel();
  if (raw === null) { audioHandy.level = 0; return 0; }
  const now = performance.now();
  const k = 1 - Math.exp(-Math.min(now - (audioHandy.at || now), 1000) / 800);
  audioHandy.at = now;
  audioHandy.level += (raw - audioHandy.level) * k;
  if (audioHandy.level < 0.08) return 0;
  const speed = Math.round((20 + audioHandy.level * 80) / 10) * 10;
  return Math.min(speed, Number($('capSpeed').value));
}

function audioVibeUI() {
  const on = selfCtl.mode === 'audio';
  $('audioInfo').hidden = !on || $('selfRow').hidden;
  if (!on) return;
  const silent = audioVibe.silentSince && performance.now() - audioVibe.silentSince > 8000 && videoPlaying() && !video.muted;
  const h = hasHandy(), v = hasVibe();
  $('audioInfo').textContent = !h && !v ? '🧪 Beta: Kein Gerät verbunden – oben auf den Status tippen und verbinden.'
    : silent ? '🧪 Beta: Kein Ton erkannt – bei diesem Video liefert der Browser den Ton nicht (fremde Adresse) oder es ist still.'
      : `🧪 Beta: ${h && v ? 'Handy und Satisfyer folgen' : h ? 'Die Handy folgt' : 'Der Satisfyer folgt'} Lautstärke und Rhythmus des Tons – Esc oder „Alles stoppen“ hält an.`;
}

document.querySelectorAll('#selfSeg button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.self === 'audio') audioVibeSetup();
  setTimeout(audioVibeUI);
}));
// Gespeicherte Wahl „Nach Ton“: Web Audio erst beim ersten Abspielen per Klick anlegen –
// ohne Klick bliebe der AudioContext angehalten und das Video stumm
video.addEventListener('play', () => {
  if (selfCtl.mode === 'audio' && !script && navigator.userActivation?.isActive !== false) audioVibeSetup();
});
document.addEventListener('self-ui', audioVibeUI);
setInterval(audioVibeUI, 2000);
