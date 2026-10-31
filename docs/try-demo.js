'use strict';

// ===========================================================================
// Mini-Player zum Ausprobieren (Doku/Vorstellung): eigenes Video + Funscript wählen
// oder ein Beispiel-Script abspielen. Heatmap-Zeitleiste, Handy- und Satisfyer-Anzeige
// im Takt; optional echte Geräte (Satisfyer per Web Bluetooth, Handy per Connection Key).
// Stark vereinfacht gegenüber dem Player – gleiche Rechnung für die Vibration (Rhythmus).
// ===========================================================================
(() => {
  const root = document.getElementById('tryDemo');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const video = $('video');
  const bar = $('.tr-bar');
  const ctx = bar.getContext('2d');
  let actions = null, clock = null; // clock: eigene Uhr, wenn kein Video gewählt ist

  // Beispiel-Script: 60 s, langsam -> schnell -> Pause -> mittel
  function exampleScript() {
    const a = [];
    const strokes = (from, to, period, lo, hi) => { for (let t = from, up = false; t <= to; t += period / 2, up = !up) a.push({ at: t, pos: up ? hi : lo }); };
    strokes(0, 20000, 1200, 10, 90); strokes(20000, 38000, 420, 15, 85); a.push({ at: 38000, pos: 50 }, { at: 42000, pos: 50 }); strokes(42000, 60000, 700, 0, 100);
    return a.sort((x, y) => x.at - y.at);
  }
  function parse(text) {
    const d = JSON.parse(text);
    const a = (d.actions || []).filter((x) => Number.isFinite(x.at) && Number.isFinite(x.pos)).map((x) => ({ at: x.at, pos: Math.max(0, Math.min(100, x.pos)) })).sort((x, y) => x.at - y.at);
    if (a.length < 2) throw new Error('Das Funscript enthält keine Bewegungen.');
    return d.inverted ? a.map((x) => ({ at: x.at, pos: 100 - x.pos })) : a;
  }
  const seg = (ms) => { let i = actions.findIndex((x) => x.at > ms); if (i <= 0) i = i < 0 ? actions.length - 1 : 1; return [actions[i - 1], actions[i]]; };
  const posAt = (ms) => { const [a, b] = seg(ms); return a.pos + (b.pos - a.pos) * Math.max(0, Math.min(1, (ms - a.at) / Math.max(1, b.at - a.at))); };
  const speedAt = (ms) => { const [a, b] = seg(ms); return ms > b.at ? 0 : (Math.abs(b.pos - a.pos) / Math.max(1, b.at - a.at)) * 1000; };
  const total = () => (video.src && video.duration ? video.duration * 1000 : actions ? actions[actions.length - 1].at : 0);
  const now = () => (video.src ? video.currentTime * 1000 : clock ? (clock.playing ? clock.t + performance.now() - clock.t0 : clock.t) : 0);
  const playing = () => (video.src ? !video.paused && !video.ended : !!clock?.playing);

  const HEAT = [[0, [30, 60, 160]], [120, [30, 144, 255]], [220, [40, 200, 100]], [320, [240, 210, 40]], [420, [250, 130, 30]], [520, [230, 40, 50]]];
  function heat(v) {
    for (let i = 1; i < HEAT.length; i++) if (v <= HEAT[i][0]) { const [s0, c0] = HEAT[i - 1], [s1, c1] = HEAT[i], k = (v - s0) / (s1 - s0); return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`; }
    return 'rgb(230,40,50)';
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = Math.round(bar.clientWidth * dpr), h = Math.round(bar.clientHeight * dpr);
    if (bar.width !== w || bar.height !== h) { bar.width = w; bar.height = h; }
    ctx.clearRect(0, 0, w, h);
    const T = total();
    if (!actions || !T) return;
    for (let i = 1; i < actions.length; i++) {
      const a = actions[i - 1], b = actions[i];
      ctx.fillStyle = heat((Math.abs(b.pos - a.pos) / Math.max(1, b.at - a.at)) * 1000);
      ctx.fillRect((a.at / T) * w, 0, Math.max(1, ((b.at - a.at) / T) * w), h);
    }
    const x = (now() / T) * w;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, 0, w - x, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - dpr, 0, 3 * dpr, h);
  }

  // Satisfyer-Stärke wie im Player („Rhythmus“): pulsiert mit jedem Stoß, Tempo = Gesamtstärke
  const level = (ms) => { const tempo = Math.min(1, speedAt(ms) / 300); return tempo ? Math.max(0.12, 1 - posAt(ms) / 100) * (0.35 + 0.65 * tempo) : 0; };
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function tick() {
    if (actions) {
      const ms = now();
      if (clock && clock.playing && ms >= total()) { clock.playing = false; clock.t = 0; }
      const p = posAt(ms);
      const l = playing() ? level(ms) : 0;
      $('.tr-carriage').style.bottom = `calc(${p}% * 0.82 + 4%)`;
      $('.tr-hpos').textContent = `${Math.round(p)} %`;
      $('.tr-orb').style.setProperty('--lvl', l.toFixed(3));
      $('.tr-vlvl').textContent = `${Math.round(l * 100)} %`;
      $('.tr-time').textContent = `${fmt(ms)} / ${fmt(total())}`;
      $('.tr-play').textContent = playing() ? '❚❚' : '▶';
      sendVibe(l);
      draw();
    }
    requestAnimationFrame(tick);
  }

  // --- Laden -------------------------------------------------------------------
  function ready(name) {
    $('.tr-stage').hidden = false;
    $('.tr-name').textContent = name;
    handy.url = null; // neues Script -> neu hochladen
    draw();
    syncHandy();
  }
  $('.tr-files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    const vid = files.find((f) => /^video\//.test(f.type) || /\.(mp4|m4v|webm|mov|mkv)$/i.test(f.name));
    const fs = files.find((f) => /\.funscript$/i.test(f.name) || f.type === 'application/json');
    try {
      if (!fs) throw new Error('Bitte das Video UND die passende .funscript zusammen auswählen.');
      actions = parse(await fs.text());
      clock = null;
      if (vid) { video.src = URL.createObjectURL(vid); video.hidden = false; } else { video.removeAttribute('src'); video.hidden = true; clock = { t: 0, t0: 0, playing: false }; }
      $('.tr-msg').textContent = '';
      ready(vid ? vid.name : fs.name);
    } catch (err) { $('.tr-msg').textContent = err.message; }
    e.target.value = '';
  });
  $('.tr-example').addEventListener('click', () => {
    actions = exampleScript();
    video.removeAttribute('src'); video.hidden = true;
    clock = { t: 0, t0: 0, playing: false };
    $('.tr-msg').textContent = '';
    ready('Beispiel-Script (60 s, ohne Video)');
  });
  function togglePlay() {
    if (video.src) { if (video.paused) video.play(); else video.pause(); }
    else if (clock) { if (clock.playing) { clock.t = now(); clock.playing = false; } else { clock.t0 = performance.now(); clock.playing = true; } }
    setTimeout(syncHandy, 50);
  }
  $('.tr-play').addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);
  ['pause', 'play', 'seeked'].forEach((ev) => video.addEventListener(ev, syncHandy));
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * total();
    if (video.src) video.currentTime = t / 1000; else if (clock) { clock.t = t; clock.t0 = performance.now(); }
    setTimeout(syncHandy, 50);
  });

  // --- Optional: Satisfyer per Web Bluetooth ------------------------------------
  const SF = '51361500-c5e7-47c7-8a6e-47ebc99d80e8';
  let tx = null, lastSent = -1, sending = false;
  $('.tr-ble').addEventListener('click', async () => {
    try {
      if (!navigator.bluetooth) throw new Error('Bluetooth geht nur in Chrome oder Edge (Android/PC).');
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SF] });
      const svc = await (await dev.gatt.connect()).getPrimaryService(SF);
      await (await svc.getCharacteristic('51361501-c5e7-47c7-8a6e-47ebc99d80e8')).writeValueWithResponse(new Uint8Array([1]));
      tx = await svc.getCharacteristic('51361502-c5e7-47c7-8a6e-47ebc99d80e8');
      $('.tr-ble').textContent = `〰 ${dev.name || 'Satisfyer'} verbunden`;
    } catch (err) { $('.tr-msg').textContent = 'Satisfyer: ' + err.message; }
  });
  async function sendVibe(l) {
    if (!tx || sending) return;
    const v = Math.round(l * 100);
    if (Math.abs(v - lastSent) < 2 && !(v === 0 && lastSent !== 0)) return;
    sending = true;
    try { await tx.writeValueWithoutResponse(new Uint8Array([v, v, v, v])); lastSent = v; } catch { /* nächster Versuch */ } finally { sending = false; }
  }

  // --- Optional: The Handy per Connection Key (Handy-Cloud, API v2) -------------
  const API = 'https://www.handyfeeling.com/api/handy/v2';
  const handy = { key: '', offset: 0, url: null, ok: false };
  const req = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { 'X-Connection-Key': handy.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return j;
  };
  $('.tr-handy').addEventListener('click', async () => {
    handy.key = $('.tr-key').value.trim();
    try {
      if (!handy.key) throw new Error('Connection Key eingeben.');
      if (!(await req('GET', '/connected')).connected) throw new Error('Handy ist nicht online (WLAN-Modus?).');
      const t0 = Date.now(), { serverTime } = await req('GET', '/servertime'), t1 = Date.now();
      handy.offset = serverTime + (t1 - t0) / 2 - t1;
      handy.ok = true;
      handy.url = null;
      $('.tr-handy').textContent = '↕ Handy verbunden';
      syncHandy();
    } catch (err) { $('.tr-msg').textContent = 'Handy: ' + err.message; }
  });
  async function syncHandy() {
    if (!handy.ok || !actions) return;
    try {
      if (!handy.url) {
        const form = new FormData();
        form.append('syncFile', new Blob(['#Funscript Player Demo\n' + actions.map((a) => `${a.at},${Math.round(a.pos)}`).join('\r\n')], { type: 'text/csv' }), 'script.csv');
        handy.url = (await (await fetch('https://www.handyfeeling.com/api/sync/upload?local=true', { method: 'POST', body: form })).json()).url;
        await req('PUT', '/mode', { mode: 1 });
        await req('PUT', '/hssp/setup', { url: handy.url });
      }
      if (playing()) await req('PUT', '/hssp/play', { estimatedServerTime: Math.round(Date.now() + handy.offset), startTime: Math.round(now()) });
      else await req('PUT', '/hssp/stop');
    } catch (err) { $('.tr-msg').textContent = 'Handy: ' + err.message; }
  }

  window.addEventListener('resize', draw);
  requestAnimationFrame(tick);
})();
