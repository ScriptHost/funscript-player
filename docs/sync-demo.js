'use strict';

// ===========================================================================
// Sync-Animation für die Doku: Video, Funscript, The Handy und Satisfyer im Takt.
// Ein 24-s-Beispielscript läuft in Schleife: langsam, schnell, Pause, mittel.
// Die Satisfyer-Stärke ist dieselbe Rechnung wie im Player (vibe.js):
//   Rhythmus:    max(0,12; Tiefe) · (0,35 + 0,65 · Tempo)  – pulsiert mit jedem Stoß
//   Gleichmäßig: nur das Tempo, über ~0,8 s geglättet
// Pausiert außerhalb des Bildes; bei „Bewegung reduzieren“ ein Standbild.
// ===========================================================================
(() => {
  const root = document.getElementById('syncDemo');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const LOOP = 24000;
  const WINDOW = 4000; // sichtbarer Ausschnitt der Kurve (ms)

  // Beispielscript: [Start, Ende, Periode, unten, oben]
  const actions = [];
  for (const [from, to, period, lo, hi] of [[0, 8000, 1200, 10, 90], [8000, 16000, 400, 20, 80], [19000, 24000, 700, 0, 100]]) {
    for (let t = from, up = false; t <= to; t += period / 2, up = !up) actions.push({ at: t, pos: up ? hi : lo });
  }
  actions.push({ at: 16000, pos: 50 }, { at: 19000, pos: 50 }); // Pause
  actions.sort((a, b) => a.at - b.at);

  function segment(ms) {
    let i = actions.findIndex((a) => a.at > ms);
    if (i <= 0) i = 1;
    return [actions[i - 1], actions[i]];
  }
  function posAt(ms) {
    const [a, b] = segment(ms);
    return a.pos + ((b.pos - a.pos) * Math.min(1, Math.max(0, (ms - a.at) / (b.at - a.at))));
  }
  function speedAt(ms) {
    const [a, b] = segment(ms);
    return (Math.abs(b.pos - a.pos) / Math.max(1, b.at - a.at)) * 1000;
  }

  const HEAT = [[0, [30, 60, 160]], [120, [30, 144, 255]], [220, [40, 200, 100]], [320, [240, 210, 40]], [420, [250, 130, 30]], [520, [230, 40, 50]]];
  function heat(v) {
    for (let i = 1; i < HEAT.length; i++) {
      if (v <= HEAT[i][0]) {
        const [s0, c0] = HEAT[i - 1], [s1, c1] = HEAT[i], k = (v - s0) / (s1 - s0);
        return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
      }
    }
    return 'rgb(230,40,50)';
  }

  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    colors = { text: cs.getPropertyValue('--text').trim(), muted: cs.getPropertyValue('--muted').trim(), line: cs.getPropertyValue('--line').trim() };
  };
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

  let mode = 'rhythm';
  let even = 0; // geglättete Stärke im Modus „Gleichmäßig“
  function vibeLevel(ms, dt) {
    const tempo = Math.min(1, speedAt(ms) / 300);
    if (mode === 'rhythm') return tempo === 0 ? 0 : Math.max(0.12, 1 - posAt(ms) / 100) * (0.35 + 0.65 * tempo);
    const k = 1 - Math.exp(-dt / 800);
    even += (tempo - even) * k;
    return even < 0.01 ? 0 : even;
  }

  function drawGraph(ms) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const pad = 10 * dpr;
    const x = (t) => ((t - ms + WINDOW / 2) / WINDOW) * w;
    const y = (p) => h - pad - (p / 100) * (h - 2 * pad);
    // Hilfslinien 0 / 50 / 100 %
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = dpr;
    for (const p of [0, 50, 100]) { ctx.beginPath(); ctx.moveTo(0, y(p)); ctx.lineTo(w, y(p)); ctx.stroke(); }
    // Kurve in Stücken, gefärbt nach Tempo; Vergangenes blasser
    ctx.lineWidth = 3 * dpr;
    ctx.lineCap = 'round';
    for (let t = ms - WINDOW / 2 - 50; t < ms + WINDOW / 2 + 50; t += 40) {
      const t0 = ((t % LOOP) + LOOP) % LOOP, t1 = (((t + 40) % LOOP) + LOOP) % LOOP;
      if (t1 < t0) continue; // Sprung am Schleifenende
      ctx.globalAlpha = t + 20 < ms ? 0.35 : 1;
      ctx.strokeStyle = heat(speedAt(t0 + 20));
      ctx.beginPath(); ctx.moveTo(x(t), y(posAt(t0))); ctx.lineTo(x(t + 40), y(posAt(t1))); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Abspielposition
    ctx.fillStyle = colors.text;
    ctx.fillRect(w / 2 - dpr, 0, 2 * dpr, h);
    ctx.beginPath(); ctx.arc(w / 2, y(posAt(ms)), 6 * dpr, 0, Math.PI * 2); ctx.fill();
  }

  const fmt = (ms) => `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}`;
  const SECTIONS = [[8000, 'langsam'], [16000, 'schnell'], [19000, 'Pause'], [24000, 'mittel']];
  function render(ms, dt) {
    const pos = posAt(ms);
    const lvl = vibeLevel(ms, dt);
    drawGraph(ms);
    $('.sdv-dot').style.top = `${12 + (1 - pos / 100) * 76}%`;
    $('.sdv-bar i').style.width = `${(ms / LOOP) * 100}%`;
    $('.sdv-time').textContent = `${fmt(ms)} / 0:24 · ${SECTIONS.find(([end]) => ms < end)[1]}`;
    $('.sd-slider').style.bottom = `calc(${pos}% * 0.82 + 4%)`;
    $('.sd-pos').textContent = `${Math.round(pos)} %`;
    $('.sd-orb').style.setProperty('--lvl', lvl.toFixed(3));
    $('.sd-lvl').textContent = `${Math.round(lvl * 100)} %`;
  }

  // Ablauf: läuft nur sichtbar; „Bewegung reduzieren“ = Standbild bis zum Klick auf ▶
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = !still, visible = false, ms = 5200, last = 0, raf = 0;
  function frame(now) {
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    if (playing) ms = (ms + dt) % LOOP;
    render(ms, dt);
    raf = playing && visible ? requestAnimationFrame(frame) : 0;
  }
  function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(root);
  window.addEventListener('resize', () => render(ms, 0));

  $('.sd-play').addEventListener('click', () => {
    playing = !playing;
    $('.sd-play').textContent = playing ? '❚❚ Pause' : '▶ Abspielen';
    kick();
  });
  $('.sd-play').textContent = playing ? '❚❚ Pause' : '▶ Abspielen';
  root.querySelectorAll('[data-vmode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.vmode;
    even = 0;
    root.querySelectorAll('[data-vmode]').forEach((x) => x.classList.toggle('on', x === b));
    kick();
  }));
  render(ms, 16);
})();
