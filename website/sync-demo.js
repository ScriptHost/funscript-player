'use strict';

// ===========================================================================
// Sync-Animation für die Doku: Video, Funscript, The Handy und Satisfyer im Takt.
// Ein 24-s-Beispielscript läuft in Schleife; „Original / Automatisch“ zeigt die Script-Automatik.
// Handy und Satisfyer nutzen dasselbe Funscript – ein eigenes Vibrations-Script braucht es nicht.
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

  // Beispielscript mit typischen Schwächen – und wie die Script-Automatik es anpasst:
  //   0–8 s   langsam, mit Zittern     -> Zittern entfernt
  //   8–16 s  schnell, zu schnell      -> mittig gekürzt (16–84 %)
  //   16–19 s Pause
  //   19–24 s flach (35–65 %)          -> auf 0–100 % gestreckt
  function build(auto) {
    const a = [];
    const strokes = (from, to, period, lo, hi, jitter) => {
      for (let t = from, up = false; t <= to; t += period / 2, up = !up) {
        a.push({ at: t, pos: up ? hi : lo });
        if (jitter && t + 200 < to) a.push({ at: t + 120, pos: (up ? hi : lo) + (up ? -2 : 2) }, { at: t + 200, pos: up ? hi : lo });
      }
    };
    strokes(0, 8000, 1200, 10, 90, !auto);
    strokes(8000, 16000, 300, auto ? 16 : 0, auto ? 84 : 100);
    a.push({ at: 16000, pos: 50 }, { at: 19000, pos: 50 });
    strokes(19000, 24000, 700, auto ? 0 : 35, auto ? 100 : 65);
    return a.sort((x, y) => x.at - y.at);
  }
  const SCRIPTS = { original: build(false), auto: build(true) };
  let actions = SCRIPTS.original;

  function segment(ms, list = actions) {
    let i = list.findIndex((a) => a.at > ms);
    if (i <= 0) i = 1;
    return [list[i - 1], list[i]];
  }
  function posAt(ms, list = actions) {
    const [a, b] = segment(ms, list);
    return a.pos + ((b.pos - a.pos) * Math.min(1, Math.max(0, (ms - a.at) / (b.at - a.at))));
  }
  function speedAt(ms, list = actions) {
    const [a, b] = segment(ms, list);
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
    // Bei „Automatisch“ das Original als dünne Linie zum Vergleich
    if (actions !== SCRIPTS.original) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      for (let t = ms - WINDOW / 2; t <= ms + WINDOW / 2; t += 20) {
        const tt = ((t % LOOP) + LOOP) % LOOP;
        const p = y(posAt(tt, SCRIPTS.original));
        if (t === ms - WINDOW / 2 || tt < 20) ctx.moveTo(x(t), p); else ctx.lineTo(x(t), p);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Abspielposition
    ctx.fillStyle = colors.text;
    ctx.fillRect(w / 2 - dpr, 0, 2 * dpr, h);
    ctx.beginPath(); ctx.arc(w / 2, y(posAt(ms)), 6 * dpr, 0, Math.PI * 2); ctx.fill();
  }

  const fmt = (ms) => `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}`;
  const SECTIONS = {
    original: [[8000, 'langsam, mit Zittern'], [16000, 'zu schnell für die Handy'], [19000, 'Pause'], [24000, 'flach (35–65 %)']],
    auto: [[8000, 'langsam – Zittern entfernt'], [16000, 'schnell – mittig gekürzt'], [19000, 'Pause'], [24000, 'flach – gestreckt']],
  };
  let scriptMode = 'original';
  function render(ms, dt) {
    const pos = posAt(ms);
    const lvl = vibeLevel(ms, dt);
    drawGraph(ms);
    $('.sdv-dot').style.top = `${12 + (1 - pos / 100) * 76}%`;
    $('.sdv-bar i').style.width = `${(ms / LOOP) * 100}%`;
    $('.sdv-time').textContent = `${fmt(ms)} / 0:24 · ${SECTIONS[scriptMode].find(([end]) => ms < end)[1]}`;
    $('.sd-carriage').style.bottom = `calc(${pos}% * 0.82 + 4%)`;
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
  root.querySelectorAll('[data-smode]').forEach((b) => b.addEventListener('click', () => {
    scriptMode = b.dataset.smode;
    actions = SCRIPTS[scriptMode];
    root.querySelectorAll('[data-smode]').forEach((x) => x.classList.toggle('on', x === b));
    $('.sd-auto-info').textContent = scriptMode === 'auto'
      ? 'Automatisch: Zittern entfernt · zu schnelle Stellen mittig gekürzt · flacher Hub gestreckt – gestrichelt das Original'
      : 'Original: genau wie die Datei';
    render(ms, 0);
    kick();
  }));
  render(ms, 16);
})();
