'use strict';

// 2.0: weitere Scripts zu Stash-Szenen. Stash kennt nur „<Video>.funscript“; Varianten wie „<Video>.soft.funscript“
// im selben Ordner findet der Player, wenn dieser Ordner auch im Player eingebunden ist (/media/…, read-only).
// Der Ordner wird automatisch gesucht: das Ende des Stash-Pfads unter /media und seinen Unterordnern,
// nur mit gleicher Dateigröße (so kann kein gleichnamiges anderes Video verwechselt werden).
const fsp = require('fs').promises;
const path = require('path');
const { MEDIA_DIR } = require('./config');
const { safeJoin } = require('./util');
const { scriptVariants } = require('./library');

let rootsCache = { at: 0, roots: [] };
async function mediaRoots() {
  if (Date.now() - rootsCache.at < 60000) return rootsCache.roots;
  const subs = (await fsp.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  rootsCache = { at: Date.now(), roots: [MEDIA_DIR, ...subs.map((e) => path.join(MEDIA_DIR, e.name))] };
  return rootsCache.roots;
}

// Datei im Player zu einem Stash-Pfad (oder null)
const found = new Map();
async function localVideo(stashPath, size) {
  if (!stashPath || !size) return null;
  const key = `${stashPath}|${size}`;
  if (found.has(key)) return found.get(key);
  const parts = String(stashPath).replace(/\\/g, '/').split('/').filter(Boolean);
  let hit = null;
  for (let k = Math.min(parts.length, 8); k >= 1 && !hit; k--) {
    const tail = parts.slice(-k).join('/');
    for (const r of await mediaRoots()) {
      const f = safeJoin(r, tail);
      const st = f && (await fsp.stat(f).catch(() => null));
      if (st && st.isFile() && st.size === size) { hit = f; break; }
    }
  }
  if (found.size > 5000) found.clear();
  found.set(key, hit);
  return hit;
}

// Varianten als Pfade relativ zu /media: [{ name: 'soft', script: 'Stash/Ordner/clip.soft.funscript' }]
async function stashVariants(stashPath, size) {
  const file = await localVideo(stashPath, size);
  if (!file) return [];
  const dir = path.dirname(file);
  const names = await fsp.readdir(dir).catch(() => []);
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const rel = path.relative(MEDIA_DIR, dir).split(path.sep).join('/');
  return scriptVariants(names, base).map((v) => ({ name: v.name, script: rel ? `${rel}/${v.file}` : v.file }));
}

module.exports = { localVideo, stashVariants };
