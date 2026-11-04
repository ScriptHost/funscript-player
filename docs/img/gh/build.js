// Grafiken für die GitHub-Seite (README) im Stil der Webseite – GitHub erlaubt dort kein CSS/JS, SVG-Bilder schon
// (auch mit Animation). Texte wie auf funscript-player.de (englisch). Aufruf im Projektordner:
//   node docs/img/gh/build.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const C = { bg: '#111317', card: '#1a1d23', card2: '#22262e', line: '#2c313b', text: '#e8eaed', muted: '#9aa1ab', accent: '#e0457b', pink: '#ff5c93', violet: '#a07bff', green: '#36c47a', vis: '#101218' };
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
  <linearGradient id="grad" x1="0" x2="1"><stop offset="0" stop-color="${C.pink}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
  ${defs}
</defs>
${body}
</svg>
`;
const write = (name, content) => { fs.writeFileSync(path.join(OUT, name), content); console.log('  ' + name); };

// ---------- Einstieg ----------
write('hero.svg', svg(1280, 330, 'Your video. Your devices. Perfectly in sync.', `
<rect width="1280" height="330" rx="22" fill="${C.bg}"/>
<text x="640" y="62" text-anchor="middle" font-size="16" font-weight="700" letter-spacing="1.5" fill="${C.accent}">SELF-HOSTED · IN THE BROWSER</text>
<text x="640" y="140" text-anchor="middle" font-size="62" font-weight="800" fill="${C.text}">Your video. Your devices.</text>
<text x="640" y="212" text-anchor="middle" font-size="62" font-weight="800" fill="url(#grad)">Perfectly in sync.</text>
${textBlock(640, 262, ['A Funscript player that drives The Handy and the Satisfyer at the same time –', 'from any script, right from your Stash library.'], 21, C.muted, 1.45, 'middle')}
`));

// ---------- Knöpfe ----------
function button(name, label, primary, w) {
  write(name, svg(w, 56, label, primary
    ? `<rect width="${w}" height="56" rx="14" fill="${C.accent}"/><text x="${w / 2}" y="35" text-anchor="middle" font-size="19" font-weight="700" fill="#fff">${esc(label)}</text>`
    : `<rect x="1" y="1" width="${w - 2}" height="54" rx="14" fill="${C.card}" stroke="${C.line}" stroke-width="2"/><text x="${w / 2}" y="35" text-anchor="middle" font-size="19" font-weight="600" fill="${C.text}">${esc(label)}</text>`));
}
button('btn-install.svg', 'Install', true, 150);
button('btn-website.svg', 'Website ↗', false, 170);
button('btn-download.svg', 'Download ZIP', false, 190);

// ---------- Live-Animation (wie auf der Webseite: Video läuft, Handy fährt, Satisfyer pulsiert) ----------
const heat = ['#1e90ff', '#28c864', '#f0d228', '#fa821e', '#e62832', '#fa821e', '#28c864', '#f0d228', '#e62832', '#1e90ff'];
const heatBars = heat.map((c, i) => `<rect x="${i * 46}" y="0" width="46" height="34" fill="${c}" opacity=".55"/>`).join('');
// Stöße: Wendepunkte im Takt (Dauer 4 s, wiederholt)
const stroke = 'M0 30 L23 4 L46 30 L69 6 L92 30 L115 4 L138 30 L161 10 L184 30 L207 4 L230 30 L253 6 L276 30 L299 4 L322 30 L345 8 L368 30 L391 4 L414 30 L437 6 L460 30';
write('live.svg', svg(1060, 520, 'Animation: video plays, The Handy strokes and the Satisfyer pulses in sync', `
<rect width="1060" height="520" rx="22" fill="${C.bg}"/>
<g transform="translate(-40 0)">
<g transform="translate(380 30)">
  <rect width="520" height="460" rx="40" fill="#000" stroke="#2a2d35" stroke-width="2"/>
  <rect x="14" y="14" width="492" height="432" rx="30" fill="#0b0c10"/>
  <rect x="30" y="30" width="240" height="30" rx="15" fill="none" stroke="${C.line}"/>
  <circle cx="48" cy="45" r="5" fill="${C.green}"/><text x="60" y="51" font-size="14" fill="${C.green}">↕ connected · 〰 connected ▾</text>
  <text x="470" y="52" font-size="20" fill="${C.text}">☰</text>
  <rect x="30" y="74" width="460" height="200" rx="6" fill="url(#vid)"/>
  <g transform="translate(30 214)">
    ${heatBars}
    <path d="${stroke}" fill="none" stroke="#fff" stroke-width="2"/>
    <rect x="0" y="0" width="3" height="34" fill="#fff"><animate attributeName="x" from="0" to="457" dur="8s" repeatCount="indefinite"/></rect>
  </g>
  <rect x="30" y="252" width="460" height="4" fill="${C.line}"/>
  <rect x="30" y="252" width="0" height="4" fill="${C.accent}"><animate attributeName="width" from="0" to="460" dur="8s" repeatCount="indefinite"/></rect>
  <g font-size="13" fill="${C.text}">
    <rect x="30" y="292" width="40" height="28" rx="7" fill="${C.card2}"/><text x="38" y="311">−10</text>
    <rect x="76" y="292" width="40" height="28" rx="7" fill="${C.card2}"/><text x="83" y="311">+10</text>
    <text x="128" y="311" fill="${C.muted}">0:03 / 0:10</text>
    <rect x="414" y="292" width="34" height="28" rx="7" fill="${C.card2}"/><text x="423" y="311">🔥</text>
    <rect x="456" y="292" width="34" height="28" rx="7" fill="${C.card2}"/><text x="466" y="311">⛶</text>
  </g>
  <rect x="30" y="336" width="460" height="92" rx="12" fill="${C.card}"/>
  <text x="48" y="374" font-size="19" font-weight="700" fill="${C.text}">Lakeside scene</text>
  <text x="48" y="402" font-size="15" fill="${C.muted}">running in sync</text>
</g>
<!-- Handy -->
<g transform="translate(990 70)">
  <rect width="52" height="260" rx="26" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
  <rect x="8" y="20" width="36" height="58" rx="18" fill="${C.pink}">
    <animate attributeName="y" values="182;20;182;24;182;20;182;40;182" dur="2s" repeatCount="indefinite"/>
  </rect>
  <text x="26" y="300" text-anchor="middle" font-size="18" fill="${C.text}">↕ The Handy</text>
</g>
<!-- Satisfyer -->
<g transform="translate(1016 410)">
  <circle r="34" fill="${C.accent}" opacity=".25"><animate attributeName="r" values="30;46;30" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".35;.08;.35" dur="1s" repeatCount="indefinite"/></circle>
  <circle r="24" fill="${C.accent}"><animate attributeName="r" values="22;27;22" dur="1s" repeatCount="indefinite"/></circle>
  <text x="0" y="70" text-anchor="middle" font-size="18" fill="${C.text}">〰 Satisfyer</text>
</g>
<!-- Script-Erklärung links -->
<g transform="translate(70 150)">
  <text font-size="15" font-weight="700" letter-spacing="1.2" fill="${C.accent}">ONE FUNSCRIPT</text>
  ${textBlock(0, 40, ['Video, script and devices', 'in the same beat.'], 26, C.text, 1.3, 'start', 700)}
  ${textBlock(0, 128, ['The Handy follows the strokes,', 'the Satisfyer turns the same', 'script into vibration – live.'], 18, C.muted, 1.5)}
</g>
</g>
`, `<radialGradient id="vid" cx="35%" cy="30%" r="90%"><stop offset="0" stop-color="#6a2a4a"/><stop offset=".55" stop-color="#23182a"/><stop offset="1" stop-color="#0e0f14"/></radialGradient>`));

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
<path d="M125 62 L135 8 L145 62 L155 8 L165 62 L175 8 L185 62 L195 8 L205 62 L215 8" fill="none" stroke="${C.pink}" stroke-width="2.8"/>`;
const visVibe = `<path d="M5 60 L17 10 L29 60 L37 22 L45 60 L50 30 L55 60 L59 30 L63 60 L67 30 L71 60 L83 15 L95 60" fill="none" stroke="#7d8591" stroke-width="2.4"/>
<path d="M100 35 H118" stroke="#9098a3" stroke-width="2"/><path d="M114 30 L120 35 L114 40" fill="none" stroke="#9098a3" stroke-width="2"/>
<g fill="${C.violet}"><rect x="126" y="44" width="7" height="18" rx="2"/><rect x="136" y="34" width="7" height="28" rx="2"/><rect x="146" y="20" width="7" height="42" rx="2"/><rect x="156" y="12" width="7" height="50" rx="2"/><rect x="166" y="8" width="7" height="54" rx="2"/><rect x="176" y="18" width="7" height="44" rx="2"/><rect x="186" y="32" width="7" height="30" rx="2"/><rect x="196" y="40" width="7" height="22" rx="2"/><rect x="206" y="46" width="7" height="16" rx="2"/></g>`;
const visUp = `<defs><pattern id="px" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#3a2a40"/><rect width="5" height="5" fill="#5a3050"/><rect x="5" y="5" width="5" height="5" fill="#5a3050"/></pattern>
<radialGradient id="sharp" cx="60%" cy="45%" r="70%"><stop offset="0" stop-color="#ff7fb0"/><stop offset=".5" stop-color="#7a3a8a"/><stop offset="1" stop-color="#1e1830"/></radialGradient></defs>
<rect x="0" y="0" width="108" height="58" rx="6" fill="url(#px)"/><rect x="112" y="0" width="108" height="58" rx="6" fill="url(#sharp)"/>
<rect x="108" y="0" width="4" height="58" fill="#fff"/>
<rect x="4" y="40" width="34" height="14" rx="4" fill="#000" opacity=".6"/><text x="21" y="51" text-anchor="middle" font-size="9" fill="#fff">720p</text>
<rect x="166" y="40" width="50" height="14" rx="4" fill="#000" opacity=".6"/><text x="191" y="51" text-anchor="middle" font-size="9" fill="#fff">✨ 1440p</text>`;

cards('highlights.svg', 'Highlights: script automation, Satisfyer with any script, upscaling', [
  { vis: visOriginal, title: '⚡ Automatic – and still in time', text: 'Every Funscript keeps its fine movements and vibrations. Only strokes the motor can’t manage are adapted by the beat guard – shorter, or full stroke at half tempo – and small strokes are stretched to the full range. Your files stay untouched.' },
  { vis: visVibe, title: '〰 Satisfyer with any script', text: 'Almost all Funscripts are made for strokers like the Handy – vibration scripts barely exist. The player converts the stroke script into vibration live while playing: following the rhythm of the strokes, their speed or the position.' },
  { vis: visUp, title: '✨ Sharper picture', text: 'If the video is smaller than your screen, the server upscales, denoises and sharpens it – in hardware via Intel Quick Sync. The browser sharpens a little more. “Automatic” picks the best picture per video and steps back if playback stutters.' },
], { vis: true, bar: true });

cards('for-whom.svg', 'Who is it for: just a Handy, just a Satisfyer, a Stash library', [
  { title: '↕ Just a Handy', text: 'Clean sync via the Handy cloud, scripts corrected automatically, 0.5×–2× speed without drift – and the library shows you beforehand how intense a scene is.' },
  { title: '〰 Just a Satisfyer', text: 'You don’t need vibration scripts: every Handy script becomes vibration live. Connects via Bluetooth right in the browser, no app.' },
  { title: '📚 A Stash library', text: 'Scenes with Funscript, heatmap and intensity at a glance. Watch on the TV, control from your phone – or in VR via HereSphere.' },
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
console.log('fertig');
