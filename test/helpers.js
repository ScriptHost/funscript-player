'use strict';

// Hilfen für die Tests: Funktionen aus den Browser-Skripten herauslösen (die Dateien greifen beim
// Laden aufs DOM zu und lassen sich deshalb nicht einfach „requiren“) und einen Testserver starten.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Liest benannte Funktionsdeklarationen (oberste Ebene) aus einer Datei und wertet sie in einem
// eigenen Kontext aus. extra = zusätzlicher Code (z. B. Konstanten), der vorher läuft.
function loadFunctions(file, names, extra = '') {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const parts = names.map((name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} nicht in ${file}`);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
  });
  const ctx = vm.createContext({});
  vm.runInContext(`${extra}\n${parts.join('\n')}`, ctx);
  const fns = vm.runInContext(`({ ${names.join(', ')} })`, ctx);
  // Ergebnisse in Objekte dieses Kontexts umwandeln (sonst scheitern strenge Vergleiche an den Prototypen)
  return Object.fromEntries(names.map((n) => [n, (...args) => JSON.parse(JSON.stringify(fns[n](...args)))]));
}

// Startet server.js mit eigenen Test-Ordnern auf einem freien Port; prepare(media) legt vorher Dateien an
async function startServer(env = {}, prepare = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-test-'));
  const media = path.join(tmp, 'media');
  const data = path.join(tmp, 'data');
  fs.mkdirSync(path.join(media, 'Filme'), { recursive: true });
  fs.mkdirSync(data);
  if (prepare) prepare(media);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MEDIA_DIR: media, DATA_DIR: data, STASH_URL: '', ...env },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* startet noch */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, media, data, stop: () => { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { loadFunctions, startServer, wait, ROOT };
