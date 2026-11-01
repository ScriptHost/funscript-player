'use strict';

// Daten des Players: gemeinsame Einstellungen, Intensität, eigene Scripts, Handy-Merkliste, Sicherung, Patterns
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DATA_DIR, MAX_STORE_BYTES, MEDIA_DIR, STASH_URL, STORE_FILE, VERSION, VIDEO_EXT } = require('./config');
const { readBody, safeJoin } = require('./util');
const { libraryInvalidate } = require('./library');
const { SETTINGS_FILE, serverSettings } = require('./settings');
const { stashRequest } = require('./stash');

// Gemeinsame Einstellungen aller Geräte (data/prefs.json): Handy-Key, Offsets, Satisfyer-
// Übersetzung … Welche Schlüssel dazugehören, entscheidet die Oberfläche (handy.js).
// PUT führt zusammen; null löscht einen Schlüssel.
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
async function readPrefs() {
  try { return JSON.parse(await fsp.readFile(PREFS_FILE, 'utf8')); } catch { return {}; }
}
let prefsWrite = Promise.resolve();
async function writePrefs(req) {
  const patch = JSON.parse(await readBody(req, 1024 * 1024) || '{}');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('Ungültige Daten'), { status: 400 });
  // Nacheinander schreiben, damit sich zwei Geräte nicht gegenseitig überschreiben
  prefsWrite = prefsWrite.then(async () => {
    const prefs = await readPrefs();
    for (const [k, v] of Object.entries(patch)) {
      if (!/^[\w.:-]{1,80}$/.test(k)) continue;
      if (v === null) delete prefs[k]; else prefs[k] = v;
    }
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(PREFS_FILE + '.tmp', JSON.stringify(prefs));
    await fsp.rename(PREFS_FILE + '.tmp', PREFS_FILE);
  });
  await prefsWrite;
}

// Intensität für die Kacheln der Bibliothek: Funscript -> 48 Abschnitte mit mittlerem Tempo
// (Positionseinheiten pro Sekunde, wie die Heatmap im Player). Wird im Speicher gemerkt.
const HEAT_BINS = 48;
const heatCache = new Map();
function heatSummary(text) {
  const actions = (JSON.parse(text).actions || [])
    .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.pos)).sort((x, y) => x.at - y.at);
  if (actions.length < 2) return { bins: [], avg: 0 };
  const end = actions[actions.length - 1].at || 1;
  const sum = new Array(HEAT_BINS).fill(0), dur = new Array(HEAT_BINS).fill(0);
  let total = 0, totalDt = 0;
  for (let i = 1; i < actions.length; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    if (dt <= 0) continue;
    const v = (Math.abs(actions[i].pos - actions[i - 1].pos) / dt) * 1000;
    const b = Math.min(HEAT_BINS - 1, Math.floor((actions[i - 1].at / end) * HEAT_BINS));
    sum[b] += v * dt; dur[b] += dt; total += v * dt; totalDt += dt;
  }
  return { bins: sum.map((s, i) => (dur[i] ? Math.round(s / dur[i]) : 0)), avg: Math.round(total / (totalDt || 1)) };
}
async function scriptHeat(src) {
  if (heatCache.has(src)) return heatCache.get(src);
  const m = /^(stash|media):(.+)$/.exec(src || '');
  if (!m) throw Object.assign(new Error('Ungültige Quelle'), { status: 400 });
  let text;
  if (m[1] === 'stash') {
    if (!STASH_URL || !/^\d+$/.test(m[2])) throw Object.assign(new Error('Ungültige Stash-Szene'), { status: 400 });
    const up = await stashRequest('GET', `/scene/${m[2]}/funscript`);
    if (up.statusCode !== 200) { up.resume(); throw Object.assign(new Error('Kein Funscript'), { status: 404 }); }
    const chunks = [];
    for await (const c of up) chunks.push(c);
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    const file = safeJoin(MEDIA_DIR, m[2]);
    if (!file || !/\.funscript$/i.test(file)) throw Object.assign(new Error('Ungültige Datei'), { status: 400 });
    text = await fsp.readFile(file, 'utf8');
  }
  const heat = heatSummary(text);
  if (heatCache.size > 5000) heatCache.clear();
  heatCache.set(src, heat);
  return heat;
}

// Eigene Scripts (Touch-Aufnahmen, Mitschnitte, über „📂 Datei“ geladene) dauerhaft zu einem Video:
//   Ordner-Video -> <Video>.funscript daneben (wie in der Bibliothek üblich), wenn der Ordner beschreibbar ist,
//   sonst und bei Stash-Szenen -> data/scripts/ auf dem Player-Server (Stash selbst bleibt unverändert).
const USER_SCRIPTS = path.join(DATA_DIR, 'scripts');
const userScriptFile = (src) => path.join(USER_SCRIPTS, src.replace(/[^\w.-]+/g, '_').slice(0, 180) + '.funscript');
// Verzeichnis der eigenen Scripts (data/userscripts.json): src -> { where: 'folder'|'server', at }.
// Nur was hier steht, darf der Player überschreiben oder löschen – Original-Funscripts nie.
const OWN_FILE = path.join(DATA_DIR, 'userscripts.json');
let ownIndex = null;
async function ownScripts() {
  if (!ownIndex) ownIndex = JSON.parse(await fsp.readFile(OWN_FILE, 'utf8').catch(() => '{}'));
  return ownIndex;
}
async function saveOwnIndex() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(OWN_FILE, JSON.stringify(ownIndex));
}
const folderScript = (src) => {
  const video = safeJoin(MEDIA_DIR, src.slice('media:'.length));
  return video ? video.replace(/\.[^.]+$/, '.funscript') : null;
};
// Datei eines eigenen Scripts (oder null)
async function ownScriptFile(src) {
  const own = (await ownScripts())[src];
  if (!own) return fs.existsSync(userScriptFile(src)) ? userScriptFile(src) : null; // vor 1.18 gespeichert
  return own.where === 'folder' ? folderScript(src) : userScriptFile(src);
}
async function deleteUserScript(src) {
  const index = await ownScripts();
  const file = await ownScriptFile(src);
  if (!file) throw Object.assign(new Error('Kein eigenes Script'), { status: 404 });
  await fsp.unlink(file).catch(() => {});
  delete index[src];
  heatCache.clear();
  libraryInvalidate();
  await saveOwnIndex();
}
async function saveUserScript(req) {
  const { src, funscript } = JSON.parse(await readBody(req, 20 * 1024 * 1024) || '{}');
  const m = /^(stash|media):(.+)$/.exec(src || '');
  if (!m || !funscript || !Array.isArray(funscript.actions)) throw Object.assign(new Error('Ungültige Daten'), { status: 400 });
  const text = JSON.stringify(funscript);
  const index = await ownScripts();
  // Schon ein eigenes Script? Dann genau dieses ersetzen (das gehört dem Nutzer, kein Original)
  const existing = index[src] ? await ownScriptFile(src) : null;
  if (existing) {
    await fsp.writeFile(existing, text);
    index[src].at = Date.now();
    heatCache.clear();
    await saveOwnIndex();
    return { where: index[src].where, file: path.basename(existing), replaced: true };
  }
  if (m[1] === 'media') {
    const video = safeJoin(MEDIA_DIR, m[2]);
    // nur neben echten Videos ablegen, nicht neben beliebigen Dateien im Medienordner
    if (!video || !VIDEO_EXT.has(path.extname(video).toLowerCase()) || !fs.existsSync(video)) {
      throw Object.assign(new Error('Video nicht gefunden'), { status: 404 });
    }
    const target = video.replace(/\.[^.]+$/, '.funscript');
    try {
      await fsp.writeFile(target, text, { flag: 'wx' }); // nie eine vorhandene Datei überschreiben
      heatCache.delete('media:' + path.relative(MEDIA_DIR, target).split(path.sep).join('/'));
      index[src] = { where: 'folder', at: Date.now() };
      libraryInvalidate(); // Bibliothek neu einlesen: das Video hat jetzt ein Script
      await saveOwnIndex();
      return { where: 'folder', file: path.basename(target) };
    } catch {
      // Original-Funscript daneben (bleibt unangetastet) oder schreibgeschützt („:ro“)
      // -> eigenes Script auf dem Player-Server, das Original bleibt wählbar
    }
  }
  await fsp.mkdir(USER_SCRIPTS, { recursive: true });
  await fsp.writeFile(userScriptFile(src), text);
  index[src] = { where: 'server', at: Date.now() };
  await saveOwnIndex();
  return { where: 'server' };
}

// Schon zur Handy hochgeladene Scripts (Hash des CSV -> URL der Handy-Ablage): ein einmal gespieltes
// Video startet danach ohne erneutes Hochladen – auch nach Neuladen und auf anderen Geräten.
const HANDY_CACHE_FILE = path.join(DATA_DIR, 'handy-cache.json');
let handyCache = null;
async function handyCacheGet(k) {
  if (!handyCache) handyCache = JSON.parse(await fsp.readFile(HANDY_CACHE_FILE, 'utf8').catch(() => '{}'));
  return handyCache[k] || null;
}
async function handyCachePut(req) {
  const { k, url } = JSON.parse(await readBody(req, 4000) || '{}');
  if (!/^v[23]:[a-f0-9]{64}$/.test(k || '') || !/^https:\/\/[^\s]{1,500}$/.test(url || '')) throw Object.assign(new Error('Ungültige Daten'), { status: 400 });
  await handyCacheGet(k);
  handyCache[k] = { url, at: Date.now() };
  // Nicht endlos wachsen lassen: die ältesten Einträge fallen weg
  const keys = Object.keys(handyCache);
  if (keys.length > 3000) keys.sort((a, b) => handyCache[a].at - handyCache[b].at).slice(0, keys.length - 3000).forEach((x) => delete handyCache[x]);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(HANDY_CACHE_FILE, JSON.stringify(handyCache));
}

// Sicherung: alles, was der Player selbst anlegt – Einstellungen, Patterns, eigene Scripts samt Inhalt.
// Original-Funscripts und Videos gehören nicht dazu. Das HereSphere-Passwort bleibt als Hash.
async function backupGet() {
  const scripts = {};
  for (const src of Object.keys(await ownScripts())) {
    const file = await ownScriptFile(src);
    if (file) scripts[src] = JSON.parse(await fsp.readFile(file, 'utf8').catch(() => 'null'));
  }
  return {
    app: 'funscript-player', version: VERSION, at: new Date().toISOString(),
    prefs: await readPrefs(), store: await readStore(), settings: serverSettings, scripts,
  };
}
async function backupPut(req) {
  const data = JSON.parse(await readBody(req, 100 * 1024 * 1024) || '{}');
  if (data.app !== 'funscript-player') throw Object.assign(new Error('Keine Sicherung des Funscript Players'), { status: 400 });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (data.prefs && typeof data.prefs === 'object') await fsp.writeFile(PREFS_FILE, JSON.stringify(data.prefs));
  if (Array.isArray(data.store?.patterns)) await fsp.writeFile(STORE_FILE, JSON.stringify({ patterns: data.store.patterns, sequences: data.store.sequences || [] }));
  if (data.settings && typeof data.settings === 'object') {
    for (const k of ['heresphere', 'hsVrOnly', 'intifaceLan']) if (typeof data.settings[k] === 'boolean') serverSettings[k] = data.settings[k];
    if (data.settings.hsPass === null || (data.settings.hsPass?.salt && data.settings.hsPass?.hash)) serverSettings.hsPass = data.settings.hsPass;
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(serverSettings));
  }
  // Eigene Scripts zurück – auf den Player-Server (Originale neben den Videos werden nie angefasst)
  const index = await ownScripts();
  for (const [src, fun] of Object.entries(data.scripts || {})) {
    if (!/^(stash|media):.+$/.test(src) || !Array.isArray(fun?.actions)) continue;
    if (index[src]?.where === 'folder') { await fsp.writeFile(folderScript(src), JSON.stringify(fun)).catch(() => {}); continue; }
    await fsp.mkdir(USER_SCRIPTS, { recursive: true });
    await fsp.writeFile(userScriptFile(src), JSON.stringify(fun));
    index[src] = { where: 'server', at: index[src]?.at || Date.now() };
  }
  heatCache.clear();
  await saveOwnIndex();
}

async function readStore() {
  try {
    return JSON.parse(await fsp.readFile(STORE_FILE, 'utf8'));
  } catch {
    return { patterns: [], sequences: [] };
  }
}

async function writeStore(req) {
  const data = JSON.parse(await readBody(req, MAX_STORE_BYTES));
  if (!data || !Array.isArray(data.patterns) || !Array.isArray(data.sequences)) {
    throw Object.assign(new Error('Ungültige Daten'), { status: 400 });
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify({ patterns: data.patterns, sequences: data.sequences }));
  await fsp.rename(tmp, STORE_FILE);
}

module.exports = { PREFS_FILE, readPrefs, prefsWrite, writePrefs, HEAT_BINS, heatCache, heatSummary, scriptHeat, USER_SCRIPTS, userScriptFile, OWN_FILE, ownIndex, ownScripts, saveOwnIndex, folderScript, ownScriptFile, deleteUserScript, saveUserScript, HANDY_CACHE_FILE, handyCache, handyCacheGet, handyCachePut, backupGet, backupPut, readStore, writeStore };
