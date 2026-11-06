// Grafiken für die GitHub-Seite (README) im 2.0-Design „Graphit + Neon“ – GitHub erlaubt dort kein CSS/JS, SVG-Bilder
// schon. Texte englisch. Screenshots/GIF liegen in docs/img/screens (Demo-Modus). Aufruf im Projektordner:
//   node docs/img/gh/build.js
// social-preview.png (GitHub → Settings → Social preview, 1280×640) entsteht aus social-preview.svg, z. B. mit
//   msedge --headless --screenshot=social-preview.png --window-size=1280,640 social-preview.svg
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const C = { bg: '#0b0b0d', card: '#131316', card2: '#1c1c21', line: '#26262c', text: '#f2f2f5', muted: '#8b8a96', accent: '#b46cff', cyan: '#22d3ee', pink: '#ff4fa3', violet: '#b46cff', green: '#34d399', vis: '#0f0f12' };
const FONT = "Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Zeilenumbruch nach geschätzter Zeichenbreite (≈ 0,53 em)
function wrap(text, width, size) {
  const max = Math.floor(width / (size * 0.53));
  const lines = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
const textBlock = (x, y, lines, size, fill, lh = 1.5, anchor = 'start', weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">` +
  lines.map((l, i) => `<tspan x="${x}" dy="${i ? size * lh : 0}">${esc(l)}</tspan>`).join('') + '</text>';

const svg = (w, h, label, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${FONT}">
<defs>
  <linearGradient id="grad" x1="0" x2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".55" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>
  <linearGradient id="neon" x1="0" x2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".55" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>
  ${defs}
</defs>
${body}
</svg>
`;
const write = (name, content) => { fs.writeFileSync(path.join(OUT, name), content); console.log('  ' + name); };

// Script-„Gebirge“ wie in der Player-Leiste: Höhe und Farbe nach Tempo
function mountain(x, y, w, h, n, seed = 1) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = 0.25 + 0.75 * Math.abs(Math.sin(t * 9 * seed + 1) * Math.sin(t * 3.3 + seed)) ** 0.8;
    pts.push(`${(x + t * w).toFixed(1)},${(y + h - v * h).toFixed(1)}`);
  }
  return `<polygon points="${x},${y + h} ${pts.join(' ')} ${x + w},${y + h}" fill="url(#neon)" opacity=".85"/>`;
}

write('hero.svg', svg(1280, 330, 'Funscript Player – your video, your devices, perfectly in sync', `
<rect width="1280" height="330" rx="22" fill="${C.bg}"/>
<rect x=".5" y=".5" width="1279" height="329" rx="22" fill="none" stroke="${C.line}"/>
<text x="640" y="64" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="2" fill="${C.muted}">SELF-HOSTED · IN THE BROWSER · OPEN SOURCE</text>
<text x="640" y="138" text-anchor="middle" font-size="60" font-weight="800" fill="${C.text}">Your video. Your devices.</text>
<text x="640" y="206" text-anchor="middle" font-size="60" font-weight="800" fill="url(#neon)">Perfectly in sync.</text>
<text x="640" y="252" text-anchor="middle" font-size="20" fill="${C.muted}">A Funscript player for The Handy and Satisfyer – with your Stash library or plain video folders.</text>
${mountain(240, 278, 800, 30, 120, 1.3)}
`));

function button(name, label, primary, w) {
  write(name, svg(w, 56, label, primary
    ? `<rect x=".75" y=".75" width="${w - 1.5}" height="54.5" rx="14" fill="${C.card}" stroke="url(#neon)" stroke-width="1.5"/><text x="${w / 2}" y="35" text-anchor="middle" font-size="19" font-weight="700" fill="${C.text}">${esc(label)}</text>`
    : `<rect x=".75" y=".75" width="${w - 1.5}" height="54.5" rx="14" fill="${C.card}" stroke="${C.line}" stroke-width="1.5"/><text x="${w / 2}" y="35" text-anchor="middle" font-size="19" font-weight="600" fill="${C.text}">${esc(label)}</text>`));
}
button('btn-install.svg', 'Install', true, 150);
button('btn-download.svg', 'Download ZIP', false, 190);


// ---------- Live-Animation (2.0): Player auf dem Smartphone, Handy und Satisfyer folgen DEMSELBEN Script ----------
// Ein Script (10 s, Schleife) treibt alles: Abspielkopf über dem Script-Gebirge, Handy-Schlitten, Satisfyer-Puls,
// Geräte-Balken im Player und die Signale auf den Verbindungslinien. Nur SMIL-Animation (GitHub zeigt SVG als Bild).
const LOOP = 10; // Sekunden
const liveScript = (() => {
  // ruhig → schneller → kräftig → ruhig: [Dauer eines Wegs in ms, Hub unten, Hub oben]
  const parts = [[700, 30, 70, 4], [450, 15, 85, 6], [300, 5, 95, 8], [220, 0, 100, 8], [500, 20, 80, 4]];
  const a = [];
  let t = 0;
  a.push({ at: 0, pos: 50 });
  for (const [ms, lo, hi, n] of parts) for (let i = 0; i < n; i++) { t += ms; a.push({ at: t, pos: i % 2 ? hi : lo }); }
  const k = (LOOP * 1000) / (t + 400);
  const out = a.map((x) => ({ at: Math.round(x.at * k), pos: x.pos }));
  out.push({ at: LOOP * 1000, pos: 50 });
  return out;
})();
// Tempo je Abschnitt (Prozent pro Sekunde) – fürs Gebirge und den Satisfyer
const liveSpeed = liveScript.map((x, i) => (i ? Math.abs(x.pos - liveScript[i - 1].pos) / Math.max(1, x.at - liveScript[i - 1].at) * 1000 : 0));
const maxSpeed = Math.max(...liveSpeed);
const kt = liveScript.map((x) => (x.at / (LOOP * 1000)).toFixed(4)).join(';');
const anim = (attr, vals, extra = '') => `<animate attributeName="${attr}" values="${vals.join(';')}" keyTimes="${kt}" dur="${LOOP}s" repeatCount="indefinite"${extra}/>`;

function liveSvg() {
  const W = 1280, H = 600;
  // --- Smartphone mit Player ---
  const px = 70, py = 30, pw = 380, ph = 540;
  const vx = px + 18, vy = py + 70, vw = pw - 36, vh = 200;
  // Script-Gebirge unter dem Video: Tempo als Höhe, Farbe Cyan → Violett → Pink
  const gy = vy + vh + 26, gh = 46;
  const mt = liveScript.map((x, i) => `${(vx + (x.at / (LOOP * 1000)) * vw).toFixed(1)},${(gy + gh - (liveSpeed[i] / maxSpeed) * gh * 0.92).toFixed(1)}`);
  const mountainPath = `M${vx},${gy + gh} L${mt.join(' L')} L${vx + vw},${gy + gh} Z`;
  const strokeLine = liveScript.map((x) => `${(vx + (x.at / (LOOP * 1000)) * vw).toFixed(1)},${(gy + gh - (x.pos / 100) * gh).toFixed(1)}`).join(' ');
  const chips = ['Auto', 'Original', 'Soft', 'Intense'].map((c, i) => {
    const cw = (vw - 18) / 4, x = vx + i * (cw + 6);
    return `<rect x="${x}" y="${gy + gh + 22}" width="${cw}" height="34" rx="9" fill="${i ? C.card2 : '#24183a'}" stroke="${i ? C.line : C.violet}" stroke-width="${i ? 1 : 1.5}"/>
  <text x="${x + cw / 2}" y="${gy + gh + 44}" text-anchor="middle" font-size="13" font-weight="${i ? 500 : 700}" fill="${i ? C.muted : C.text}">${c}</text>`;
  }).join('\n  ');
  const by = gy + gh + 78; // Geräte-Balken
  const barW = (vw - 12) / 2;
  const handyBar = anim('width', liveScript.map((x) => ((x.pos / 100) * (barW - 28)).toFixed(1)), ' calcMode="linear"');
  const vibeBar = anim('width', liveSpeed.map((s) => ((0.15 + 0.85 * s / maxSpeed) * (barW - 28)).toFixed(1)));
  const phone = `
<g>
  <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="44" fill="#050506" stroke="#2a2a31" stroke-width="2"/>
  <rect x="${px + 10}" y="${py + 10}" width="${pw - 20}" height="${ph - 20}" rx="36" fill="${C.bg}"/>
  <rect x="${px + 22}" y="${py + 26}" width="112" height="26" rx="13" fill="none" stroke="${C.line}"/>
  <text x="${px + 40}" y="${py + 44}" font-size="13" fill="${C.green}">connected ▾</text>
  <text x="${px + pw - 30}" y="${py + 45}" text-anchor="end" font-size="12" fill="${C.muted}">Funscript Player</text>
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="14" fill="url(#vid)"/>
  <circle cx="${vx + vw * 0.62}" cy="${vy + vh * 0.42}" r="70" fill="${C.violet}" opacity=".18">
    <animate attributeName="cx" values="${vx + vw * 0.62};${vx + vw * 0.38};${vx + vw * 0.62}" dur="${LOOP}s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${vx + vw * 0.3}" cy="${vy + vh * 0.62}" r="50" fill="${C.cyan}" opacity=".10">
    <animate attributeName="cy" values="${vy + vh * 0.62};${vy + vh * 0.35};${vy + vh * 0.62}" dur="${LOOP / 2}s" repeatCount="indefinite"/>
  </circle>
  <path d="${mountainPath}" fill="url(#grad)" opacity=".9"/>
  <polyline points="${strokeLine}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>
  <rect x="${vx}" y="${gy - 3}" width="2.5" height="${gh + 6}" fill="#fff">
    <animate attributeName="x" from="${vx}" to="${vx + vw - 2}" dur="${LOOP}s" repeatCount="indefinite"/>
  </rect>
  <rect x="${vx}" y="${gy + gh + 6}" width="${vw}" height="3" rx="1.5" fill="${C.line}"/>
  <rect x="${vx}" y="${gy + gh + 6}" width="0" height="3" rx="1.5" fill="url(#grad)">
    <animate attributeName="width" from="0" to="${vw}" dur="${LOOP}s" repeatCount="indefinite"/>
  </rect>
  ${chips}
  <g transform="translate(${vx} ${by})">
    <rect width="${barW}" height="58" rx="12" fill="${C.card}" stroke="${C.line}"/>
    <circle cx="16" cy="20" r="4.5" fill="${C.cyan}"/><text x="28" y="25" font-size="13" fill="${C.text}">The Handy</text>
    <rect x="14" y="38" width="${barW - 28}" height="6" rx="3" fill="${C.line}"/>
    <rect x="14" y="38" width="0" height="6" rx="3" fill="${C.cyan}">${handyBar}</rect>
  </g>
  <g transform="translate(${vx + barW + 12} ${by})">
    <rect width="${barW}" height="58" rx="12" fill="${C.card}" stroke="${C.line}"/>
    <circle cx="16" cy="20" r="4.5" fill="${C.pink}"/><text x="28" y="25" font-size="13" fill="${C.text}">Satisfyer</text>
    <rect x="14" y="38" width="${barW - 28}" height="6" rx="3" fill="${C.line}"/>
    <rect x="14" y="38" width="0" height="6" rx="3" fill="${C.pink}">${vibeBar}</rect>
  </g>
  <g font-size="11" fill="${C.muted}" text-anchor="middle">
    ${['Library', 'Player', 'Devices', 'Settings'].map((n, i) => `<text x="${px + 30 + (i + 0.5) * ((pw - 60) / 4)}" y="${py + ph - 30}" ${i === 1 ? `fill="${C.text}" font-weight="700"` : ''}>${n}</text>`).join('')}
  </g>
</g>`;

  // --- The Handy (Stroker): Schlitten fährt exakt das Script ---
  const hx = 640, hy = 70, hh = 380, track = hh - 40 - 70;
  const slideY = anim('y', liveScript.map((x) => (hy + 20 + (1 - x.pos / 100) * track).toFixed(1)), ' calcMode="linear"');
  const handy = `
<g>
  <rect x="${hx}" y="${hy}" width="96" height="${hh}" rx="48" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
  <rect x="${hx + 44}" y="${hy + 26}" width="8" height="${track + 58}" rx="4" fill="#0a0a0c"/>
  <rect x="${hx + 14}" y="${hy + 20}" width="68" height="70" rx="22" fill="${C.cyan}" opacity=".95">${slideY}</rect>
  <rect x="${hx + 14}" y="${hy + 20}" width="68" height="70" rx="22" fill="none" stroke="${C.cyan}" stroke-width="10" opacity=".18">${slideY}</rect>
  <circle cx="${hx + 48}" cy="${hy + hh - 22}" r="5" fill="${C.cyan}">
    <animate attributeName="opacity" values="1;.35;1" dur="1.2s" repeatCount="indefinite"/>
  </circle>
  <text x="${hx + 48}" y="${hy + hh + 40}" text-anchor="middle" font-size="20" font-weight="700" fill="${C.text}">The Handy</text>
  <text x="${hx + 48}" y="${hy + hh + 64}" text-anchor="middle" font-size="14" fill="${C.muted}">strokes</text>
</g>`;

  // --- Satisfyer: Puls nach Tempo ---
  const sx = 960, sy = 250;
  const rCore = anim('r', liveSpeed.map((s) => (30 + 10 * s / maxSpeed).toFixed(1)));
  const rings = [0, 1, 2].map((i) => `<circle cx="${sx}" cy="${sy}" r="40" fill="none" stroke="${C.pink}" stroke-width="2">
    <animate attributeName="r" values="40;118" dur="1.5s" begin="${i * 0.5}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".7;0" dur="1.5s" begin="${i * 0.5}s" repeatCount="indefinite"/>
  </circle>`).join('\n  ');
  const glow = anim('opacity', liveSpeed.map((s) => (0.08 + 0.3 * s / maxSpeed).toFixed(2)));
  const satisfyer = `
<g>
  ${rings}
  <circle cx="${sx}" cy="${sy}" r="70" fill="${C.pink}" opacity=".15">${glow}</circle>
  <circle cx="${sx}" cy="${sy}" r="34" fill="${C.pink}">${rCore}</circle>
  <text x="${sx}" y="${sy + 150}" text-anchor="middle" font-size="20" font-weight="700" fill="${C.text}">Satisfyer</text>
  <text x="${sx}" y="${sy + 174}" text-anchor="middle" font-size="14" fill="${C.muted}">the same script as vibration</text>
</g>`;

  // --- Verbindungen: Signale laufen vom Player zu den Geräten ---
  const from = [px + pw + 8, py + 300];
  // Handy direkt, Satisfyer unten um die Handy herum
  const links = [[`${from[0] + 70},${from[1]} ${hx - 80},${hy + hh / 2}`, hx - 10, hy + hh / 2, C.cyan], [`${from[0] + 80},${H + 40} ${sx - 200},${H + 40}`, sx - 100, sy + 20, C.pink]].map(([ctl, x, y, c], i) => {
    const d = `M${from[0]},${from[1]} C${ctl} ${x},${y}`;
    return `<path d="${d}" fill="none" stroke="${c}" stroke-opacity=".25" stroke-width="2"/>
  <path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="10 60">
    <animate attributeName="stroke-dashoffset" from="70" to="0" dur="${0.7 + i * 0.15}s" repeatCount="indefinite"/>
  </path>`;
  }).join('\n');

  // --- Text rechts oben ---
  const text = `
<text x="${W - 60}" y="78" text-anchor="end" font-size="15" font-weight="700" letter-spacing="2" fill="${C.muted}">ONE FUNSCRIPT · EVERY DEVICE</text>
<text x="${W - 60}" y="118" text-anchor="end" font-size="30" font-weight="800" fill="${C.text}">Same script. Same beat.</text>`;

  return svg(W, H, 'Animation: the player plays a scene, The Handy strokes and the Satisfyer pulses – both from the same Funscript', `
<rect width="${W}" height="${H}" rx="22" fill="${C.bg}"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="none" stroke="${C.line}"/>
${text}
${links}
${phone}
${handy}
${satisfyer}
`, `<radialGradient id="vid" cx="35%" cy="30%" r="95%"><stop offset="0" stop-color="#3a2558"/><stop offset=".55" stop-color="#161320"/><stop offset="1" stop-color="#0b0b0d"/></radialGradient>`);
}
write('live.svg', liveSvg());

// ---------- Karten ----------
function cards(name, label, items, opts = {}) {
  const W = 960, gap = 18, cw = (W - gap * 2) / 3, pad = 18; // schmal: GitHub zeigt ~830 px, Text bleibt lesbar
  const visH = opts.vis ? 88 : 0;
  const laid = items.map((it) => ({ ...it, lines: wrap(it.text, cw - pad * 2, 16) }));
  const maxLines = Math.max(...laid.map((l) => l.lines.length));
  const top = opts.vis ? pad + visH + 18 : pad;
  const H = Math.ceil(top + 34 + maxLines * 16 * 1.5 + pad + 6);
  const body = laid.map((it, i) => {
    const x = i * (cw + gap);
    return `<g transform="translate(${x} 0)">
  <rect x="1" y="1" width="${cw - 2}" height="${H - 2}" rx="18" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
  ${opts.bar ? `<path d="M19 1 H${cw - 19} A18 18 0 0 1 ${cw - 1} 19 V4 H1 V19 A18 18 0 0 1 19 1 Z" fill="url(#grad)"/>` : ''}
  ${it.vis ? `<rect x="${pad}" y="${pad}" width="${cw - pad * 2}" height="${visH}" rx="12" fill="${C.vis}"/><g transform="translate(${pad + (cw - pad * 2 - 242) / 2} ${pad + 9}) scale(1.1)">${it.vis}</g>` : ''}
  ${it.num ? `<circle cx="${pad + 18}" cy="${pad + 18}" r="18" fill="${C.accent}"/><text x="${pad + 18}" y="${pad + 25}" text-anchor="middle" font-size="18" font-weight="800" fill="#fff">${it.num}</text>` : ''}
  <text x="${pad + (it.num ? 48 : 0)}" y="${top + (it.num ? 24 : 22)}" font-size="19" font-weight="700" fill="${C.text}">${esc(it.title)}</text>
  ${textBlock(pad, top + (it.num ? 62 : 52), it.lines, 16, C.muted, 1.5)}
</g>`;
  }).join('\n');
  write(name, svg(W, H, label, body));
}

const visOriginal = `<path d="M5 44 L15 26 L25 44 L35 26 L45 44 L55 26 L65 44 L75 26 L85 44 L95 26" fill="none" stroke="#7d8591" stroke-width="2.4"/>
<path d="M100 35 H118" stroke="#9098a3" stroke-width="2"/><path d="M114 30 L120 35 L114 40" fill="none" stroke="#9098a3" stroke-width="2"/>
<path d="M125 62 L135 8 L145 62 L155 8 L165 62 L175 8 L185 62 L195 8 L205 62 L215 8" fill="none" stroke="${C.cyan}" stroke-width="2.8"/>`;
const visVibe = `<path d="M5 60 L17 10 L29 60 L37 22 L45 60 L50 30 L55 60 L59 30 L63 60 L67 30 L71 60 L83 15 L95 60" fill="none" stroke="#7d8591" stroke-width="2.4"/>
<path d="M100 35 H118" stroke="#9098a3" stroke-width="2"/><path d="M114 30 L120 35 L114 40" fill="none" stroke="#9098a3" stroke-width="2"/>
<g fill="${C.pink}"><rect x="126" y="44" width="7" height="18" rx="2"/><rect x="136" y="34" width="7" height="28" rx="2"/><rect x="146" y="20" width="7" height="42" rx="2"/><rect x="156" y="12" width="7" height="50" rx="2"/><rect x="166" y="8" width="7" height="54" rx="2"/><rect x="176" y="18" width="7" height="44" rx="2"/><rect x="186" y="32" width="7" height="30" rx="2"/><rect x="196" y="40" width="7" height="22" rx="2"/><rect x="206" y="46" width="7" height="16" rx="2"/></g>`;
const visUp = `<defs><pattern id="px" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#3a2a40"/><rect width="5" height="5" fill="#5a3050"/><rect x="5" y="5" width="5" height="5" fill="#5a3050"/></pattern>
<radialGradient id="sharp" cx="60%" cy="45%" r="70%"><stop offset="0" stop-color="#ff7fb0"/><stop offset=".5" stop-color="#7a3a8a"/><stop offset="1" stop-color="#1e1830"/></radialGradient></defs>
<rect x="0" y="0" width="108" height="58" rx="6" fill="url(#px)"/><rect x="112" y="0" width="108" height="58" rx="6" fill="url(#sharp)"/>
<rect x="108" y="0" width="4" height="58" fill="#fff"/>
<rect x="4" y="40" width="34" height="14" rx="4" fill="#000" opacity=".6"/><text x="21" y="51" text-anchor="middle" font-size="9" fill="#fff">720p</text>
<rect x="166" y="40" width="50" height="14" rx="4" fill="#000" opacity=".6"/><text x="191" y="51" text-anchor="middle" font-size="9" fill="#fff">✨ 1440p</text>`;

cards('highlights.svg', 'Highlights: script automation, Satisfyer with any script, upscaling', [
  { vis: visOriginal, title: '🎚 One choice, every device', text: 'Automatic keeps fine movements and vibrations, adapts only what the motor can’t manage and stretches small strokes. Want more? Intense. Calmer? Soft. Picked per scene right at the video, with a preview – your files stay untouched.' },
  { vis: visVibe, title: '〰 Satisfyer with any script', text: 'Almost all Funscripts are made for strokers like the Handy – vibration scripts barely exist. The player converts the stroke script into vibration live while playing: following the rhythm of the strokes, their speed or the position.' },
  { vis: visUp, title: '✨ Natural picture', text: 'If the video is smaller than your screen, the server upscales it and denoises lightly – in hardware via Intel Quick Sync. Colours and contrast stay as in the original, more sharpness on request. Steps back by itself if playback stutters.' },
], { vis: true, bar: true });

cards('for-whom.svg', 'Who is it for: just a Handy, just a Satisfyer, a Stash library', [
  { title: '↕ Just a Handy', text: 'Clean sync via the Handy cloud, scripts corrected automatically, 0.5×–2× speed without drift – and the library shows you beforehand how intense a scene is.' },
  { title: '〰 Just a Satisfyer', text: 'You don’t need vibration scripts: every Handy script becomes vibration live. Connects via Bluetooth right in the browser, no app.' },
  { title: '📚 A Stash library', text: 'Scenes with Funscript, heatmap and intensity at a glance. Ratings, favourites and markers go back to Stash – also from VR via HereSphere.' },
]);

cards('steps.svg', 'Three steps: connect, pick a scene, play', [
  { num: 1, title: 'Connect', text: 'Tap the status at the top: Handy with its connection key, Satisfyer via Bluetooth. Once set up, the player connects on its own – on all your devices.' },
  { num: 2, title: 'Pick a scene', text: 'In the library every tile with a Funscript shows its intensity. Filter by calm, medium or intense – or hit 🎲 Random.' },
  { num: 3, title: 'Play', text: 'Handy and Satisfyer run in sync. Below the video you only see the controls of connected devices – and STOP is always within reach.' },
]);

// ---------- Abschnitts-Überschriften (Kicker + Titel wie auf der Webseite) ----------
function heading(name, kicker, title) {
  write(name, svg(960, 96, `${kicker} – ${title}`, `
<text x="2" y="30" font-size="15" font-weight="700" letter-spacing="1.4" fill="${C.accent}">${esc(kicker.toUpperCase())}</text>
<text x="0" y="76" font-size="36" font-weight="800" fill="${C.text}">${esc(title)}</text>`));
}
heading('h-look.svg', 'See it', 'The player as it looks today');
heading('h-for-whom.svg', 'Who is it for?', 'Whatever you own');
heading('h-steps.svg', 'In three steps', 'Connect, pick, play');
heading('h-install.svg', 'Installation', 'Docker in five minutes');

write('social-preview.svg', svg(1280, 640, 'Funscript Player', `
<rect width="1280" height="640" fill="${C.bg}"/>
<text x="640" y="150" text-anchor="middle" font-size="22" font-weight="700" letter-spacing="3" fill="${C.muted}">FUNSCRIPT PLAYER</text>
<text x="640" y="262" text-anchor="middle" font-size="76" font-weight="800" fill="${C.text}">Your video. Your devices.</text>
<text x="640" y="350" text-anchor="middle" font-size="76" font-weight="800" fill="url(#neon)">Perfectly in sync.</text>
<text x="640" y="420" text-anchor="middle" font-size="26" fill="${C.muted}">The Handy · Satisfyer · Stash · self-hosted in Docker</text>
${mountain(140, 500, 1000, 70, 160, 1.3)}
`));
console.log('fertig');
