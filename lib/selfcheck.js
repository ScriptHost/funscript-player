'use strict';

// Selbsttest beim Start (1.19.3, statt des Knopfs in der Oberfläche): prüft Server und Oberfläche,
// ohne ein Gerät zu bewegen. Ergebnis steht im Startprotokoll („docker logs“); die Tests unter
// test/ rufen ihn ebenfalls auf.
//   Server:     Datenordner beschreibbar, gespeicherte Dateien lesbar
//   Oberfläche: alle Skripte fehlerfrei, jede Element-ID aus den Skripten steht in index.html,
//               Script-Intensität (Original/Automatisch/Sanft/Intensiv) rechnet wie vorgesehen
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const vm = require('vm');
const { DATA_DIR, PUBLIC_DIR } = require('./config');

// Benannte Funktionen und einzeilige Konstanten aus einem Browser-Skript herauslösen
// (die Dateien greifen beim Laden aufs DOM zu und lassen sich nicht einfach ausführen)
function extract(src, names) {
  return names.map((name) => {
    const fn = src.indexOf(`function ${name}(`);
    if (fn < 0) {
      const line = new RegExp(`^(?:const|let) ${name} = .*$`, 'm').exec(src);
      if (!line) throw new Error(`${name} fehlt`);
      return line[0];
    }
    let depth = 0, i = src.indexOf('{', fn);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(fn, i + 1);
  }).join('\n');
}

// Script-Intensität im eigenen Kontext laden; preset = Auswahl der Szene
function loadPresets(maxSpeed = 450) {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'tools.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`
    const tools = { tooFast: 'shorten' };
    let toolCache = {};
    let scenePreset = 'auto';
    const currentPreset = () => scenePreset;
    const handyMaxSpeedSafe = () => ${maxSpeed};
    const t = (k) => k; // Texte (lang.js) – hier nur die Schlüssel
    ${extract(src, ['VIB_AMP', 'analyzeScript', 'removeJitter', 'stretchRange', 'limitSpeed', 'halveFast', 'fitHandy', 'expandStrokes', 'WARMUP', 'warmup', 'warmupActions', 'scaleAround', 'processScript'])}
    this.run = (actions, target, preset, warm = false) => { scenePreset = preset; warmup = warm; toolCache = {}; return JSON.parse(JSON.stringify(processScript(actions, target))); };
  `, ctx);
  return ctx.run;
}

// Prüf-Script: ruhiger Teil (langsam, halber Hub) und schneller Teil (zu schnell für die Handy)
function sampleScript() {
  const a = [];
  let t = 0;
  for (let i = 0; i < 20; i++) { a.push({ at: t, pos: i % 2 ? 70 : 30 }); t += 800; }
  for (let i = 0; i < 40; i++) { a.push({ at: t, pos: i % 2 ? 100 : 0 }); t += 120; }
  return a;
}
// Höchsttempo großer Bewegungen (Vibrationen ≤ 20 % zählen nicht)
function topSpeed(a) {
  let top = 0;
  for (let i = 1; i < a.length; i++) {
    const d = Math.abs(a[i].pos - a[i - 1].pos), dt = a[i].at - a[i - 1].at;
    if (d > 20 && dt > 0) top = Math.max(top, (d / dt) * 1000);
  }
  return top;
}

async function runSelfcheck() {
  const results = [];
  const check = async (name, fn) => {
    try {
      const r = await fn();
      results.push({ name, ok: r !== false && !(typeof r === 'string'), info: typeof r === 'string' ? r : '' });
    } catch (e) { results.push({ name, ok: false, info: e.message }); }
  };

  // --- Server
  await check('Datenordner beschreibbar', async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const f = path.join(DATA_DIR, '.selfcheck');
    await fsp.writeFile(f, 'ok');
    await fsp.unlink(f);
  });
  await check('Gespeicherte Daten lesbar', async () => {
    const bad = [];
    for (const name of ['prefs.json', 'store.json', 'settings.json', 'userscripts.json']) {
      const txt = await fsp.readFile(path.join(DATA_DIR, name), 'utf8').catch(() => null);
      if (txt !== null) { try { JSON.parse(txt); } catch { bad.push(name); } }
    }
    return bad.length ? `beschädigt: ${bad.join(', ')}` : true;
  });

  // --- Oberfläche
  const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  // 2.0: alle .js-Dateien (ES-Module über main.js, nicht mehr einzeln in index.html). vm.Script kennt kein
  // import/export – die Zeilen werden für die Syntaxprüfung entfernt (gleiche Zeilenzahl für die Fehlermeldung).
  // Sprachtexte (lang/*.js, „export default { … }“) gehören dazu.
  const scripts = (await fsp.readdir(PUBLIC_DIR, { recursive: true })).map((n) => n.split(path.sep).join('/'))
    .filter((n) => n.endsWith('.js')).sort();
  const asScript = (src) => src.replace(/^import\b[\s\S]*?;[ \t]*(\/\/.*)?$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^export default /gm, 'void ').replace(/^export /gm, '');
  await check('Skripte der Oberfläche fehlerfrei', async () => {
    const bad = [];
    for (const s of scripts) {
      try { new vm.Script(asScript(await fsp.readFile(path.join(PUBLIC_DIR, s), 'utf8')), { filename: s }); } catch (e) { bad.push(`${s}: ${e.message}`); }
    }
    return bad.length ? bad.join(' · ') : true;
  });
  await check('Alle Bedienelemente vorhanden', async () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const missing = new Set();
    // selftest.js prüft auch, dass alte Elemente NICHT mehr da sind (z. B. ovSync) – deshalb ausgenommen
    for (const s of scripts.filter((n) => n !== 'selftest.js')) {
      const src = await fsp.readFile(path.join(PUBLIC_DIR, s), 'utf8').catch(() => '');
      for (const m of src.matchAll(/\$\('([\w-]+)'\)/g)) if (!ids.has(m[1])) missing.add(`${m[1]} (${s})`);
    }
    return missing.size ? `fehlt: ${[...missing].join(', ')}` : true;
  });

  const run = loadPresets(450);
  const a = sampleScript();
  await check('Intensität „Original“ lässt das Script unverändert', () => JSON.stringify(run(a, 'handy', 'original')) === JSON.stringify(a));
  await check('Intensität „Automatisch“: nie schneller als die Handy', () => topSpeed(run(a, 'handy', 'auto')) <= 452 || `${Math.round(topSpeed(run(a, 'handy', 'auto')))} %/s`);
  await check('Intensität „Sanft“: Hub 20–80 %, langsamer', () => {
    const s = run(a, 'handy', 'soft');
    const lo = Math.min(...s.map((x) => x.pos)), hi = Math.max(...s.map((x) => x.pos));
    return (lo >= 20 && hi <= 80 && topSpeed(s) <= 242) || `Hub ${lo}–${hi}, ${Math.round(topSpeed(s))} %/s`;
  });
  await check('Intensität „Intensiv“: im Takt, keine Zusatz-Stöße, machbar', () => {
    const i = run(a, 'handy', 'intense'), au = run(a, 'handy', 'auto');
    return (i.length <= au.length && topSpeed(i) <= 452) || `${i.length} vs. ${au.length} Punkte, ${Math.round(topSpeed(i))} %/s`;
  });
  await check('Intensität beim Satisfyer: ungekürzt', () => run(a, 'vibe', 'auto').length >= a.length);
  return results;
}

module.exports = { runSelfcheck, loadPresets, sampleScript, topSpeed };
