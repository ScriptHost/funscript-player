'use strict';

// Bibliothek: Videos unter /media mit gleichnamigem Funscript (gemerkt, bei Änderungen neu eingelesen)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { MEDIA_DIR, VIDEO_EXT } = require('./config');
const { cleanTitle } = require('./util');

// Bibliothek gemerkt: Antwort sofort aus dem Speicher, im Hintergrund neu einlesen, wenn älter als 30 s
// (große Ordner oder Netzlaufwerke brauchen sonst bei jedem Öffnen Sekunden).
let libCache = { at: 0, items: null, scanning: null, sig: '' };
// Kennung der Ordner (Änderungszeit von /media und den Ordnern darin): neue/gelöschte Dateien ändern sie
async function librarySignature() {
  const dirs = [MEDIA_DIR, ...(await fsp.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory()).map((e) => path.join(MEDIA_DIR, e.name))];
  const times = await Promise.all(dirs.map((d) => fsp.stat(d).then((st) => st.mtimeMs, () => 0)));
  return times.join(',');
}
function libraryRescan() {
  if (!libCache.scanning) {
    const t0 = Date.now();
    libCache.scanning = Promise.all([scanLibrary(MEDIA_DIR), librarySignature()]).then(([items, sig]) => {
      libCache = { at: Date.now(), items, scanning: null, ms: Date.now() - t0, sig };
      return items;
    }, (e) => { libCache.scanning = null; throw e; });
  }
  return libCache.scanning;
}
async function libraryItems() {
  if (!libCache.items || (await librarySignature()) !== libCache.sig) return libraryRescan();
  if (Date.now() - libCache.at > 30000) libraryRescan().catch(() => {}); // Unterordner: im Hintergrund auffrischen
  return libCache.items;
}

async function scanLibrary(dir, rel = '') {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = new Set(entries.map((e) => e.name));
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await scanLibrary(path.join(dir, e.name), relPath)));
    } else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      const base = e.name.slice(0, -path.extname(e.name).length);
      const scriptName = `${base}.funscript`;
      out.push({
        name: cleanTitle(e.name),
        folder: rel,
        // Quelle = erster Unterordner (z. B. /media/Downloads), Dateien direkt in /media = „Ordner“
        root: relPath.includes('/') ? relPath.split('/')[0] : '',
        mtime: (await fsp.stat(path.join(dir, e.name)).catch(() => null))?.mtimeMs || 0,
        video: relPath,
        script: names.has(scriptName) ? (rel ? `${rel}/${scriptName}` : scriptName) : null,
      });
    }
  }
  return out;
}

// Für andere Teile: neu einlesen lassen bzw. Dauer des letzten Einlesens
const libraryInvalidate = () => { libCache.sig = ''; };
const libraryScanMs = () => libCache.ms;

module.exports = { libraryInvalidate, libraryScanMs, libCache, librarySignature, libraryRescan, libraryItems, scanLibrary };
