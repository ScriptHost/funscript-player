'use strict';

// HQ-Stream über ffmpeg (VAAPI / CPU)
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const { FFMPEG, FFPROBE, HQ_DEVICE, HQ_MAX, MEDIA_DIR, STASH_API_KEY, STASH_INSECURE, STASH_URL } = require('./config');
const { safeJoin } = require('./util');

// ---------------------------------------------------------------------------
// HQ-Stream: Video live entrauschen, hochskalieren, schärfen und als H.264 streamen.
//   VAAPI nutzt die Video-Hardware der Intel-Grafik (dieselbe wie Quick Sync bei
//   Jellyfin): denoise_vaapi -> scale_vaapi (hq) -> sharpness_vaapi -> h264_vaapi.
//   Ohne /dev/dri oder bei Fehlern: CPU (hqdn3d -> lanczos -> unsharp -> x264).
//   Ausgabe ist fragmentiertes MP4; Spulen = neue Anfrage mit Startzeit t.
// ---------------------------------------------------------------------------
const HQ_PRESETS = {
  // natural (1.19.3, für „Auto“): nur hochrechnen + leicht entrauschen, kaum Schärfe – wirkt wie das Original, nur größer
  natural: { dn: 6, sh: 10, cpuDn: 'hqdn3d=1:1:2:2', cpuSh: 'unsharp=5:5:0.25:5:5:0' },
  clean: { dn: 12, sh: 24, cpuDn: 'hqdn3d=1.5:1.5:3:3', cpuSh: 'unsharp=5:5:0.5:5:5:0' },
  strong: { dn: 28, sh: 44, cpuDn: 'hqdn3d=3:2.5:5:4', cpuSh: 'unsharp=5:5:0.9:5:5:0' },
};
let hqInfo = null;
let hqRunning = 0;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
});

async function hqStatus() {
  if (hqInfo) return hqInfo;
  const { err } = await run(FFMPEG, ['-hide_banner', '-version']);
  if (err) return (hqInfo = { available: false, reason: 'ffmpeg ist nicht installiert' });
  const gpu = await gpuCheck();
  const accel = process.env.HQ_ACCEL || (gpu.state === 'ok' ? 'vaapi' : 'cpu');
  return (hqInfo = { available: true, accel, gpu });
}

// 2.0: Intel-Grafik prüfen (für ⚙️ → System und „docker logs“):
//   ok = Quick Sync aktiv · missing = /dev/dri nicht eingebunden (HQ läuft auf der CPU)
//   noaccess = eingebunden, aber kein Zugriff (RENDER_GID falsch) · driver = Treiber-Test fehlgeschlagen
async function gpuCheck() {
  if (!fs.existsSync(HQ_DEVICE)) return { state: 'missing', device: HQ_DEVICE };
  try { fs.accessSync(HQ_DEVICE, fs.constants.R_OK | fs.constants.W_OK); } catch { return { state: 'noaccess', device: HQ_DEVICE }; }
  // Eine Sekunde Testbild über die Grafik in H.264 umwandeln
  const { err, stderr } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-vaapi_device', HQ_DEVICE,
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-t', '1', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-']);
  if (err) return { state: 'driver', device: HQ_DEVICE, error: String(stderr || err.message).trim().split('\n').pop().slice(0, 200) };
  return { state: 'ok', device: HQ_DEVICE };
}
const GPU_TEXT = {
  ok: 'Intel graphics active (Quick Sync)',
  missing: 'Intel graphics not mounted (/dev/dri) – HQ stream uses the CPU; see docker-compose.yml to enable it',
  noaccess: 'Intel graphics mounted but no access – check RENDER_GID in .env',
  driver: 'Intel graphics driver test failed – HQ stream uses the CPU',
};

// Quelle: "stash:<id>" oder "media:<pfad im Bibliotheksordner>"
function hqSource(src) {
  const m = /^(stash|media):(.+)$/.exec(src || '');
  if (!m) throw Object.assign(new Error('Ungültige Quelle'), { status: 400 });
  if (m[1] === 'stash') {
    if (!STASH_URL || !/^\d+$/.test(m[2])) throw Object.assign(new Error('Ungültige Stash-Szene'), { status: 400 });
    const headers = STASH_API_KEY ? ['-headers', `ApiKey: ${STASH_API_KEY}\r\n`] : [];
    const tls = STASH_INSECURE ? ['-tls_verify', '0'] : [];
    return { input: `${STASH_URL}/scene/${m[2]}/stream`, pre: [...headers, ...tls] };
  }
  const file = safeJoin(MEDIA_DIR, m[2]);
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error('Datei nicht gefunden'), { status: 404 });
  return { input: file, pre: [] };
}

// Ergebnisse gemerkt: Ordner-Videos solange Größe/Datum gleich bleiben, Stash-Szenen 10 Minuten.
// (HereSphere fragt beim Durchblättern jedes Video einzeln ab – ohne Merken startet jedes Mal ffprobe.)
const probeCache = new Map();
async function probeKey(src, input) {
  if (src.startsWith('stash:')) return `${src}|${Math.floor(Date.now() / 600000)}`;
  const st = await fsp.stat(input).catch(() => null);
  return st ? `${src}|${st.size}|${st.mtimeMs}` : '';
}
async function hqProbe(src, { cachedOnly = false } = {}) {
  const { input, pre } = hqSource(src);
  const key = await probeKey(src, input);
  if (key && probeCache.has(key)) return probeCache.get(key);
  if (cachedOnly) return null;
  const { err, stdout } = await run(FFPROBE, [...pre, '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', input]);
  if (err) throw Object.assign(new Error('Video konnte nicht gelesen werden'), { status: 502 });
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] || {};
  const info = { width: s.width || 0, height: s.height || 0, codec: s.codec_name || '', duration: Number(j.format?.duration) || 0 };
  if (key) {
    if (probeCache.size > 5000) probeCache.clear();
    probeCache.set(key, info);
  }
  return info;
}

// Zielgröße: auf die gewünschte Höhe (Standard 1080p) skalieren, gerade Pixelzahlen
function hqSize(info, height) {
  const h = Math.max(240, Math.min(2160, height || 1080)) & ~1;
  const w = info.width && info.height ? Math.round((info.width * h) / info.height / 2) * 2 : Math.round((h * 16) / 9 / 2) * 2;
  return { w, h };
}

function hqArgs({ input, pre }, { start, preset, size, accel, output }) {
  const p = HQ_PRESETS[preset] || HQ_PRESETS.clean;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (accel === 'vaapi') args.push('-vaapi_device', HQ_DEVICE, '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi');
  args.push(...pre, '-ss', String(Math.max(0, start || 0)), '-i', input, '-map', '0:v:0', '-map', '0:a:0?');
  if (accel === 'vaapi') {
    // format=nv12|vaapi + hwupload: klappt mit Hardware- und Software-Decoding
    args.push('-vf', `format=nv12|vaapi,hwupload,denoise_vaapi=denoise=${p.dn},`
      + `scale_vaapi=w=${size.w}:h=${size.h}:mode=hq:format=nv12,sharpness_vaapi=sharpness=${p.sh}`,
    '-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '21', '-g', '60');
  } else {
    args.push('-vf', `${p.cpuDn},scale=${size.w}:${size.h}:flags=lanczos,${p.cpuSh},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-g', '60');
  }
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  return args.concat(output);
}

// Startet ffmpeg; wartet auf die ersten Daten. Scheitert VAAPI, wird automatisch die CPU genutzt.
function hqSpawn(source, opts, onData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, hqArgs(source, opts), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', started = false;
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    proc.stdout.once('data', (chunk) => { started = true; resolve({ proc, first: chunk }); });
    proc.on('error', (e) => { if (!started) reject(e); });
    proc.on('close', (code) => {
      if (started) return;
      if (opts.accel === 'vaapi') {
        console.warn('HQ: VAAPI failed, using CPU:', err.trim().split('\n').pop());
        hqSpawn(source, { ...opts, accel: 'cpu' }, onData).then(resolve, reject);
      } else {
        reject(Object.assign(new Error(`ffmpeg: ${err.trim().split('\n').pop() || 'Exitcode ' + code}`), { status: 502 }));
      }
    });
  });
}

async function hqStream(req, res, params) {
  const status = await hqStatus();
  if (!status.available) throw Object.assign(new Error(status.reason), { status: 501 });
  if (hqRunning >= HQ_MAX) throw Object.assign(new Error('Zu viele HQ-Streams gleichzeitig'), { status: 503 });
  const source = hqSource(params.get('src'));
  const info = await hqProbe(params.get('src')).catch(() => ({ width: 0, height: 0 }));
  const opts = {
    start: Number(params.get('t')) || 0,
    preset: params.get('preset') || 'clean',
    size: hqSize(info, Number(params.get('h')) || 1080),
    accel: status.accel,
    output: ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'],
  };
  hqRunning++;
  let proc;
  const done = () => { if (proc) proc.kill('SIGKILL'); };
  res.on('close', done);
  try {
    const started = await hqSpawn(source, opts);
    proc = started.proc;
    if (res.destroyed) return done();
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    res.write(started.first);
    proc.stdout.pipe(res);
    await new Promise((r) => proc.on('close', r));
  } finally {
    hqRunning--;
  }
}

// Leistungstest: 20 s umwandeln (ohne Ausgabe) und Geschwindigkeit messen
async function hqBench(params) {
  const status = await hqStatus();
  if (!status.available) throw Object.assign(new Error(status.reason), { status: 501 });
  // 2.0: der Leistungstest zählt wie ein Stream gegen HQ_MAX – sonst beliebig viele ffmpeg gleichzeitig
  if (hqRunning >= HQ_MAX) throw Object.assign(new Error('Zu viele HQ-Umwandlungen gleichzeitig'), { status: 503 });
  hqRunning++;
  try { return await hqBenchRun(params, status); } finally { hqRunning--; }
}
async function hqBenchRun(params, status) {
  const src = params.get('src');
  const info = await hqProbe(src);
  const t0 = Date.now();
  const accel = params.get('accel') || status.accel;
  const opts = {
    start: Math.min(60, info.duration / 3 || 0),
    preset: params.get('preset') || 'clean',
    size: hqSize(info, Number(params.get('h')) || 1080),
    accel,
    output: ['-t', '20', '-progress', 'pipe:1', '-f', 'null', '-'],
  };
  const { err, stdout, stderr } = await run(FFMPEG, hqArgs(hqSource(src), opts));
  const secs = (Date.now() - t0) / 1000;
  const outMs = Number([...stdout.matchAll(/out_time_ms=(\d+)/g)].pop()?.[1] || 0) / 1e6;
  const fps = Number([...stdout.matchAll(/fps=([\d.]+)/g)].pop()?.[1] || 0);
  if (err && !outMs) throw Object.assign(new Error(`ffmpeg (${accel}): ${String(stderr).trim().split('\n').pop()}`), { status: 502 });
  return { accel, source: info, target: opts.size, seconds: secs, speed: outMs / secs, fps };
}

module.exports = { HQ_PRESETS, GPU_TEXT, gpuCheck, hqInfo, hqRunning, run, hqStatus, hqSource, probeCache, probeKey, hqProbe, hqSize, hqArgs, hqSpawn, hqStream, hqBench };
