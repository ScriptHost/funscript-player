'use strict';

// ===========================================================================
// Mini-Player zum Ausprobieren (Doku/Vorstellung): eigenes Video + Funscript wählen
// oder ein Beispiel-Script abspielen. Heatmap-Zeitleiste, Handy- und Satisfyer-Anzeige
// im Takt; optional echte Geräte (Satisfyer per Web Bluetooth, Handy per Connection Key).
// Stark vereinfacht gegenüber dem Player – Script-Automatik und Satisfyer-Übersetzung
// rechnen wie dort (tools.js / vibe.js), nur ohne Einstellungen.
// ===========================================================================
(() => {
  const root = document.getElementById('tryDemo');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const video = $('video');
  const bar = $('.tr-bar');
  const ctx = bar.getContext('2d');
  let src = null;                 // Script wie geladen
  let hActs = null, vActs = null; // Fassung für Handy / Satisfyer
  let auto = true, vmode = 'rhythm';
  let clock = null;               // eigene Uhr, wenn kein Video gewählt ist

  // Beispiel-Script: 60 s mit typischen Schwächen – flacher Hub, zu schnelle Stelle, Zittern
  function exampleScript() {
    const a = [];
    const strokes = (from, to, period, lo, hi) => { for (let t = from, up = false; t < to; t += period / 2, up = !up) a.push({ at: t, pos: up ? hi : lo }); };
    strokes(0, 18000, 1200, 30, 70);
    strokes(18000, 34000, 300, 25, 75);
    for (let t = 34000, up = false; t < 40000; t += 100, up = !up) a.push({ at: t, pos: up ? 52 : 50 });
    strokes(40000, 60001, 700, 25, 75);
    return a;
  }
  function parse(text) {
    const d = JSON.parse(text);
    const a = (d.actions || []).filter((x) => Number.isFinite(x.at) && Number.isFinite(x.pos)).map((x) => ({ at: x.at, pos: Math.max(0, Math.min(100, x.pos)) })).sort((x, y) => x.at - y.at);
    if (a.length < 2) throw new Error('Das Funscript enthält keine Bewegungen.');
    return d.inverted ? a.map((x) => ({ at: x.at, pos: 100 - x.pos })) : a;
  }

  // --- Script-Automatik (wie Preset „Automatisch“ im Player) ----------------------
  function analyze(a) {
    const pos = a.map((x) => x.pos).sort((x, y) => x - y);
    let segs = 0, jitter = 0;
    for (let i = 1; i < a.length; i++) { const d = Math.abs(a[i].pos - a[i - 1].pos); if (a[i].at > a[i - 1].at) { segs++; if (d > 0 && d < 3) jitter++; } }
    return { lo: pos[Math.floor(pos.length * 0.02)], hi: pos[Math.ceil(pos.length * 0.98) - 1], jitter: segs ? jitter / segs : 0 };
  }
  function removeJitter(a) {
    const out = [a[0]];
    for (let i = 1; i < a.length; i++) { const d = Math.abs(a[i].pos - out[out.length - 1].pos); if (d > 0 && d < 3 && i < a.length - 1) continue; out.push(a[i]); }
    return out;
  }
  const stretch = (a, lo, hi) => a.map((x) => ({ at: x.at, pos: Math.max(0, Math.min(100, Math.round(((x.pos - lo) / (hi - lo)) * 100))) }));
  // Zu schnelle Stellen zur Mitte hin kürzen (die Handy schafft ~400 %/s)
  function limitSpeed(a, max) {
    let n = 0;
    const s = a.map((x, i) => {
      let k = 1;
      for (const y of [a[i - 1], a[i + 1]]) { const d = y ? Math.abs(x.pos - y.pos) : 0; if (d > 0) k = Math.min(k, (max * Math.max(1, Math.abs(x.at - y.at))) / 1000 / d); }
      if (k >= 1) return x;
      n++;
      return { at: x.at, pos: Math.round(50 + (x.pos - 50) * k) };
    });
    return { acts: s, n };
  }
  function process() {
    if (!src) return;
    const notes = [];
    let out = src;
    if (auto) {
      const st = analyze(out);
      if (st.jitter > 0.05) { const n = out.length; out = removeJitter(out); if (out.length < n) notes.push(`${n - out.length} Zitterpunkte entfernt`); }
      if (st.hi - st.lo >= 5 && st.hi - st.lo < 70) { out = stretch(out, st.lo, st.hi); notes.push(`Hub ${st.lo}–${st.hi} → 0–100 gestreckt`); }
    }
    vActs = out;
    hActs = out;
    if (auto) { const r = limitSpeed(out, 400); if (r.n) { hActs = r.acts; notes.push(`${r.n} zu schnelle Stellen nur für die Handy gekürzt`); } }
    $('.tr-note').textContent = !auto ? 'Original: das Script läuft unverändert.' : notes.length ? '⚡ ' + notes.join(' · ') : '⚡ Script ist schon gut – nichts geändert.';
    handy.url = null; // geänderte Fassung -> neu hochladen
    draw();
    syncHandy();
  }

  const seg = (a, ms) => { let i = a.findIndex((x) => x.at > ms); if (i <= 0) i = i < 0 ? a.length - 1 : 1; return [a[i - 1], a[i]]; };
  const posAt = (a, ms) => { const [p, q] = seg(a, ms); return p.pos + (q.pos - p.pos) * Math.max(0, Math.min(1, (ms - p.at) / Math.max(1, q.at - p.at))); };
  const speedAt = (a, ms) => { const [p, q] = seg(a, ms); return ms > q.at ? 0 : (Math.abs(q.pos - p.pos) / Math.max(1, q.at - p.at)) * 1000; };
  const total = () => (video.src && video.duration ? video.duration * 1000 : src ? src[src.length - 1].at : 0);
  const now = () => (video.src ? video.currentTime * 1000 : clock ? (clock.playing ? clock.t + performance.now() - clock.t0 : clock.t) : 0);
  const playing = () => (video.src ? !video.paused && !video.ended : !!clock?.playing);

  const HEAT = [[0, [30, 60, 160]], [120, [30, 144, 255]], [220, [40, 200, 100]], [320, [240, 210, 40]], [420, [250, 130, 30]], [520, [230, 40, 50]]];
  function heat(v) {
    for (let i = 1; i < HEAT.length; i++) if (v <= HEAT[i][0]) { const [s0, c0] = HEAT[i - 1], [s1, c1] = HEAT[i], k = (v - s0) / (s1 - s0); return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`; }
    return 'rgb(230,40,50)';
  }
  // Heatmap oben, darunter der Verlauf des Hubs (Handy-Fassung)
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = Math.round(bar.clientWidth * dpr), h = Math.round(bar.clientHeight * dpr);
    if (bar.width !== w || bar.height !== h) { bar.width = w; bar.height = h; }
    ctx.clearRect(0, 0, w, h);
    const T = total();
    if (!hActs || !T) return;
    const hh = Math.round(h * 0.3);
    for (let i = 1; i < hActs.length; i++) {
      const a = hActs[i - 1], b = hActs[i];
      ctx.fillStyle = heat((Math.abs(b.pos - a.pos) / Math.max(1, b.at - a.at)) * 1000);
      ctx.fillRect((a.at / T) * w, 0, Math.max(1, ((b.at - a.at) / T) * w), hh);
    }
    ctx.strokeStyle = '#ff5c93'; ctx.lineWidth = dpr; ctx.beginPath();
    hActs.forEach((a, i) => { const x = (a.at / T) * w, y = h - 2 * dpr - (a.pos / 100) * (h - hh - 6 * dpr); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    const x = (now() / T) * w;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, 0, w - x, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - dpr, 0, 3 * dpr, h);
  }

  // Satisfyer-Stärke wie im Player: Rhythmus (pulsiert mit jedem Stoß), Tempo oder Position
  function level(ms) {
    const pos = posAt(vActs, ms), tempo = Math.min(1, speedAt(vActs, ms) / 300);
    if (vmode === 'pos') return tempo ? 1 - pos / 100 : 0;
    if (vmode === 'speed') return tempo;
    return tempo ? Math.max(0.12, 1 - pos / 100) * (0.35 + 0.65 * tempo) : 0;
  }
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function tick() {
    if (src) {
      const ms = now();
      if (clock && clock.playing && ms >= total()) { clock.playing = false; clock.t = 0; }
      const p = posAt(hActs, ms);
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

  // --- Laden & Bedienen ----------------------------------------------------------
  function ready(name, actions) {
    src = actions;
    $('.tr-stage').hidden = false;
    $('.tr-name').textContent = name;
    process();
  }
  $('.tr-files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    const vid = files.find((f) => /^video\//.test(f.type) || /\.(mp4|m4v|webm|mov|mkv)$/i.test(f.name));
    const fs = files.find((f) => /\.funscript$/i.test(f.name) || f.type === 'application/json');
    try {
      if (!fs) throw new Error('Bitte das Video UND die passende .funscript zusammen auswählen.');
      const acts = parse(await fs.text());
      clock = null;
      if (vid) { video.src = URL.createObjectURL(vid); video.hidden = false; } else { video.removeAttribute('src'); video.hidden = true; clock = { t: 0, t0: 0, playing: false }; }
      $('.tr-msg').textContent = '';
      ready(vid ? vid.name : fs.name, acts);
    } catch (err) { $('.tr-msg').textContent = err.message; }
    e.target.value = '';
  });
  $('.tr-example').addEventListener('click', () => {
    video.removeAttribute('src'); video.hidden = true;
    clock = { t: 0, t0: 0, playing: false };
    $('.tr-msg').textContent = '';
    ready('Beispiel-Script (60 s, ohne Video) – absichtlich mit flachem Hub, zu schneller Stelle und Zittern', exampleScript());
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
  root.querySelectorAll('[data-auto]').forEach((b) => b.addEventListener('click', () => {
    auto = b.dataset.auto === '1';
    root.querySelectorAll('[data-auto]').forEach((x) => x.classList.toggle('on', x === b));
    process();
  }));
  root.querySelectorAll('[data-tmode]').forEach((b) => b.addEventListener('click', () => {
    vmode = b.dataset.tmode;
    root.querySelectorAll('[data-tmode]').forEach((x) => x.classList.toggle('on', x === b));
  }));

  // --- Optional: Satisfyer per Web Bluetooth ------------------------------------
  const SF = '51361500-c5e7-47c7-8a6e-47ebc99d80e8';
  let tx = null, lastSent = -1, sending = false;
  $('.tr-ble')?.addEventListener('click', async () => {
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
  $('.tr-handy')?.addEventListener('click', async () => {
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
    if (!handy.ok || !hActs) return;
    try {
      if (!handy.url) {
        const form = new FormData();
        form.append('syncFile', new Blob(['#Funscript Player Demo\n' + hActs.map((a) => `${a.at},${Math.round(a.pos)}`).join('\r\n')], { type: 'text/csv' }), 'script.csv');
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
