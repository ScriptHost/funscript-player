// Grafiken für die GitHub-Seite (README) im 2.0-Design „Graphit + Neon“ – GitHub erlaubt dort kein CSS/JS, SVG-Bilder
// schon. Texte englisch. Screenshots/GIF liegen in docs/img/screens (Demo-Modus). Aufruf im Projektordner:
//   node docs/img/gh/build.js
// social-preview.png (GitHub → Settings → Social preview, 1280×640) entsteht aus social-preview.svg, z. B. mit
//   msedge --headless --screenshot=social-preview.png --window-size=1280,640 social-preview.svg
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const C = { bg: '#0b0b0d', card: '#131316', line: '#26262c', text: '#f2f2f5', muted: '#8b8a96', cyan: '#22d3ee', violet: '#b46cff', pink: '#ff4fa3' };
const FONT = 'Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NEON = `<linearGradient id="neon" x1="0" x2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".55" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>`;
const svg = (w, h, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${FONT}">
<defs>${NEON}</defs>
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

write('social-preview.svg', svg(1280, 640, 'Funscript Player', `
<rect width="1280" height="640" fill="${C.bg}"/>
<text x="640" y="150" text-anchor="middle" font-size="22" font-weight="700" letter-spacing="3" fill="${C.muted}">FUNSCRIPT PLAYER</text>
<text x="640" y="262" text-anchor="middle" font-size="76" font-weight="800" fill="${C.text}">Your video. Your devices.</text>
<text x="640" y="350" text-anchor="middle" font-size="76" font-weight="800" fill="url(#neon)">Perfectly in sync.</text>
<text x="640" y="420" text-anchor="middle" font-size="26" fill="${C.muted}">The Handy · Satisfyer · Stash · self-hosted in Docker</text>
${mountain(140, 500, 1000, 70, 160, 1.3)}
`));
console.log('fertig');
