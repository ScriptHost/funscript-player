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

// 2.0: weitere Scripts zum selben Video: „<Name>.<Variante>.funscript“ (z. B. clip.soft.funscript).
// Achsen von Mehrachs-Geräten (clip.roll.funscript …) sind keine Varianten und bleiben außen vor.
const AXES = new Set(['roll', 'pitch', 'twist', 'surge', 'sway', 'stroke', 'vib', 'vib1', 'vib2', 'pump', 'suck', 'valve', 'lube', 'raw', 'l0', 'l1', 'l2', 'r0', 'r1', 'r2', 'v0', 'v1', 'a0', 'a1', 'a2']);
function scriptVariants(names, base) {
  const out = [];
  for (const n of names) {
    if (!n.startsWith(base + '.') || !n.toLowerCase().endsWith('.funscript')) continue;
    const variant = n.slice(base.length + 1, -'.funscript'.length);
    if (!variant || variant.includes('/') || AXES.has(variant.toLowerCase())) continue;
    out.push({ name: variant, file: n });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
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
      const at = (n) => (rel ? `${rel}/${n}` : n);
      const variants = scriptVariants(names, base).map((v) => ({ name: v.name, script: at(v.file) }));
      // Nur Varianten, kein „<Name>.funscript“: die erste gilt als Haupt-Script
      const main = names.has(scriptName) ? at(scriptName) : variants.shift()?.script || null;
      out.push({
        name: cleanTitle(e.name),
        folder: rel,
        // Quelle = erster Unterordner (z. B. /media/Downloads), Dateien direkt in /media = „Ordner“
        root: relPath.includes('/') ? relPath.split('/')[0] : '',
        mtime: (await fsp.stat(path.join(dir, e.name)).catch(() => null))?.mtimeMs || 0,
        video: relPath,
        script: main,
        ...(variants.length ? { scripts: variants } : {}),
      });
    }
  }
  return out;
}

// Für andere Teile: neu einlesen lassen bzw. Dauer des letzten Einlesens
const libraryInvalidate = () => { libCache.sig = ''; };
const libraryScanMs = () => libCache.ms;

module.exports = { AXES, scriptVariants, libraryInvalidate, libraryScanMs, libCache, librarySignature, libraryRescan, libraryItems, scanLibrary };
