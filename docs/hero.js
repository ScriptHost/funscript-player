'use strict';

// ===========================================================================
// Kopf der Vorstellung: kleine Geschichte in Schleife (≈ 14 s) –
//   Status „aus“ -> „verbinde …“ -> „verbunden“ -> Play -> Handy und Satisfyer laufen im Takt
//   des Scripts mit, die Kurve wandert unter dem Video. „Bewegung reduzieren“ = Standbild im Takt.
// ===========================================================================
(function heroDemo() {
  const root = document.getElementById('heroDemo');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const canvas = $('.hd-graph');
  const ctx = canvas.getContext('2d');
  const TEXT = {
    de: { off: '↕ aus', connecting: '↕ verbinde …', on: '↕ verbunden', vOff: '〰 aus', vOn: '〰 verbunden', title: 'Szene am See', tap: 'Status antippen → verbinden', ready: 'bereit – Play drücken', run: 'läuft im Takt' },
    en: { off: '↕ off', connecting: '↕ connecting …', on: '↕ connected', vOff: '〰 off', vOn: '〰 connected', title: 'Lakeside scene', tap: 'tap the status → connect', ready: 'ready – press play', run: 'running in sync' },
  };
  const L = () => TEXT[document.documentElement.lang === 'de' ? 'de' : 'en'];

  // Beispiel-Script: wechselndes Tempo, ein ruhiger Teil, ein schneller Teil mit feinen Vibrationen oben
  const script = [];
  let t = 0, up = false;
  while (t < 10000) {
    const fast = t > 5200 && t < 7600;
    const calm = t > 2600 && t < 3800;
    const half = fast ? 180 : calm ? 520 : 300;
    t += half;
    up = !up;
    if (fast && up) { // Vibration oben: kleine, schnelle Bewegungen
      script.push({ at: t, pos: 92 });
      for (let k = 1; k <= 3; k++) script.push({ at: t + k * 45, pos: k % 2 ? 82 : 94 });
      t += 135;
    } else script.push({ at: t, pos: up ? (calm ? 70 : 95) : (calm ? 30 : 5) });
  }
  const posAt = (ms) => {
    if (ms <= script[0].at) return 50;
    for (let i = 1; i < script.length; i++) {
      if (script[i].at >= ms) {
        const a = script[i - 1], b = script[i];
        return a.pos + ((b.pos - a.pos) * (ms - a.at)) / (b.at - a.at);
      }
    }
    return 50;
  };
  const speedAt = (ms) => Math.abs(posAt(ms + 40) - posAt(ms - 40)) / 80 * 1000; // %/s

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOOP = 14000, CONNECT = 1400, CONNECTED = 2600, PLAY = 3600, END = 13600;
  const start = performance.now();
  let lastPhase = '', lastLang = '';

  function draw(scriptMs) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const span = 3000; // sichtbarer Ausschnitt: 1 s zurück, 2 s voraus
    const x = (ms) => ((ms - scriptMs + 1000) / span) * w;
    // Farbe nach Tempo (Heatmap)
    for (let px = 0; px < w; px += 2 * dpr) {
      const ms = scriptMs - 1000 + (px / w) * span;
      if (ms < 0 || ms > 10000) continue;
      const v = speedAt(ms);
      ctx.fillStyle = v > 520 ? '#e62832' : v > 380 ? '#fa821e' : v > 260 ? '#f0d228' : v > 150 ? '#28c864' : '#1e90ff';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(px, 0, 2 * dpr, h);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    let first = true;
    for (const p of script) {
      const px = x(p.at);
      if (px < -20 || px > w + 20) continue;
      const py = h - (p.pos / 100) * (h - 6 * dpr) - 3 * dpr;
      if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x(scriptMs) - dpr, 0, 2 * dpr, h); // jetzt
  }

  function frame(now) {
    const tl = reduce ? PLAY + 3000 : (now - start) % LOOP;
    const playing = tl >= PLAY && tl < END;
    const scriptMs = playing ? tl - PLAY : tl >= END ? END - PLAY : 0;
    const txt = L();
    const phase = tl < CONNECT ? 'off' : tl < CONNECTED ? 'connecting' : !playing ? 'ready' : 'run';
    const lang = document.documentElement.lang;
    if (phase !== lastPhase || lang !== lastLang) {
      lastPhase = phase;
      lastLang = lang;
      $('.hd-h').textContent = phase === 'off' ? txt.off : phase === 'connecting' ? txt.connecting : txt.on;
      $('.hd-h').className = 'hd-h ' + (phase === 'off' ? '' : phase === 'connecting' ? 'busy' : 'ok');
      $('.hd-v').textContent = phase === 'off' || phase === 'connecting' ? txt.vOff : txt.vOn;
      $('.hd-v').className = 'hd-v ' + (phase === 'off' || phase === 'connecting' ? '' : 'ok');
      $('.hd-note').textContent = phase === 'off' || phase === 'connecting' ? txt.tap : phase === 'ready' ? txt.ready : txt.run;
      $('.scr-info b').textContent = txt.title;
      $('.hd-play').textContent = playing ? '❚❚' : '▶';
      root.classList.toggle('playing', playing);
      root.classList.toggle('tapping', phase === 'connecting');
    }
    const pos = playing ? posAt(scriptMs) : 50;
    $('.hd-carriage').style.bottom = `calc(${pos}% - ${pos * 0.18}px)`;
    $('.hd-hpos').textContent = `${Math.round(pos)} %`;
    // Satisfyer: Rhythmus – stärker bei schnellem Tempo
    const lvl = playing ? Math.min(100, Math.round(speedAt(scriptMs) / 6)) : 0;
    $('.hd-orb').style.setProperty('--lvl', lvl / 100);
    $('.hd-vlvl').textContent = `${lvl} %`;
    const sec = Math.floor(scriptMs / 1000);
    $('.hd-time').textContent = `0:${String(sec).padStart(2, '0')} / 0:10`;
    $('.hd-progress').style.width = `${(scriptMs / 10000) * 100}%`;
    draw(scriptMs);
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (reduce) window.addEventListener('resize', () => requestAnimationFrame(frame));
})();
