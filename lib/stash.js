'use strict';

// Stash: Szenen, Filter, Zurückschreiben, Dateien durchreichen
const http = require('http');
const os = require('os');
const https = require('https');
const { STASH_INSECURE } = require('./config');
const { stashConf } = require('./settings');
const { cleanTitle, readBody } = require('./util');

// ---------------------------------------------------------------------------
// Stash: GraphQL für die Szenenliste, Videos/Funscripts/Bilder werden durchgereicht.
// Der API-Key bleibt auf dem Server.
// ---------------------------------------------------------------------------
function stashRequest(method, pathAndQuery, headers = {}, body, timeout = 15000) {
  const { url, key } = stashConf();
  if (!url) return Promise.reject(Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404, code: 'unreachable' }));
  const target = new URL(url + pathAndQuery);
  const mod = target.protocol === 'https:' ? https : http;
  if (key) headers.ApiKey = key;
  return new Promise((resolve, reject) => {
    const req = mod.request(target, { method, headers, rejectUnauthorized: !STASH_INSECURE }, resolve);
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error('keine Antwort')));
    req.on('error', (err) => {
      const why = err.code === 'ENOTFOUND' ? `Adresse ${target.hostname} unbekannt (DNS)` : err.code || err.message;
      reject(Object.assign(new Error(`Stash nicht erreichbar: ${why}`), { status: 502, code: 'unreachable' }));
    });
    req.end(body);
  });
}

async function stashGraphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  const res = await stashRequest('POST', '/graphql', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
  const text = await readBody(res, 20 * 1024 * 1024);
  if (res.statusCode === 401) throw Object.assign(new Error('Stash: API-Key fehlt oder ist falsch'), { status: 502, code: 'auth' });
  // Stash ab 0.32: ohne eigene Anmeldung lehnt es Anfragen aus „öffentlichen“ Netzen mit 403 ab
  if (res.statusCode === 403) throw Object.assign(new Error('Stash: Zugriff verweigert (HTTP 403) – siehe ⚙️ → Bibliothek'), { status: 502, code: 'forbidden' });
  if (res.statusCode !== 200) throw Object.assign(new Error(`Stash: HTTP ${res.statusCode}`), { status: 502, code: 'http' });
  const json = JSON.parse(text);
  if (json.errors?.length) throw Object.assign(new Error('Stash: ' + json.errors[0].message), { status: 502 });
  return json.data;
}

const SCENES_QUERY = `query($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) {
    count
    scenes { id title date interactive files { basename duration } studio { id name } performers { id name } tags { id name } }
  }
}`;

// ---------------------------------------------------------------------------
// Gespeicherte Filter aus Stash („2D“, „VR Script“ …)
//   Stash speichert sie im Format seiner Oberfläche. Für die Suche werden sie in
//   SceneFilterType übersetzt; unbekannte Bedingungen werden notfalls weggelassen.
// ---------------------------------------------------------------------------
const HIERARCHICAL = new Set(['tags', 'studios', 'performer_tags', 'scene_tags', 'parents', 'children']);
const BOOLEAN_KEYS = new Set(['organized', 'interactive', 'performer_favorite', 'ignore_auto_tag']);
const RESOLUTION = {
  '144p': 'VERY_LOW', '240p': 'LOW', '360p': 'R360P', '480p': 'STANDARD', '540p': 'WEB_HD', '720p': 'STANDARD_HD',
  '1080p': 'FULL_HD', '1440p': 'QUAD_HD', '1920p': 'VR_HD', '4k': 'FOUR_K', '5k': 'FIVE_K', '6k': 'SIX_K',
  '7k': 'SEVEN_K', '8k': 'EIGHT_K', huge: 'HUGE',
};
const ids = (list) => (list || []).map((x) => (typeof x === 'object' ? x.id : x)).filter((x) => x !== undefined);

function convertCriterion(key, c) {
  if (!c || typeof c !== 'object') return undefined;
  const { modifier } = c;
  let v = c.value;
  if (v && typeof v === 'object' && !Array.isArray(v) && 'items' in v) {
    const out = { value: ids(v.items), modifier };
    if (v.excluded?.length) out.excludes = ids(v.excluded);
    if (HIERARCHICAL.has(key)) out.depth = v.depth ?? 0;
    return out;
  }
  if (key === 'resolution' || key === 'average_resolution') {
    return { value: RESOLUTION[String(v).toLowerCase()] || v, modifier };
  }
  if (BOOLEAN_KEYS.has(key)) return v === true || v === 'true';
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) {
    const out = { value: v.value, modifier };
    if (v.value2 !== undefined && v.value2 !== null) out.value2 = v.value2;
    return out;
  }
  if (Array.isArray(v) && (key === 'orientation')) return { value: v };
  if (Array.isArray(v)) return { value: ids(v), modifier };
  return { value: v, modifier };
}

function convertObjectFilter(obj) {
  const out = {};
  for (const [key, c] of Object.entries(obj || {})) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue; // 1.19.10 (CodeQL #16)
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const sub = convertObjectFilter(c);
      if (Object.keys(sub).length) out[key] = sub;
      continue;
    }
    const conv = convertCriterion(key, c);
    if (conv !== undefined) out[key] = conv;
  }
  return out;
}

let savedCache = { at: 0, list: null };
async function stashSavedFilters() {
  if (savedCache.list && Date.now() - savedCache.at < 60000) return savedCache.list;
  const data = await stashGraphql(`{
    findSavedFilters(mode: SCENES) { id name find_filter { q sort direction } object_filter }
  }`);
  const list = (data.findSavedFilters || []).map((f) => ({
    id: String(f.id),
    name: f.name,
    q: f.find_filter?.q || '',
    sort: f.find_filter?.sort || '',
    direction: f.find_filter?.direction || '',
    filter: convertObjectFilter(f.object_filter),
  })).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  savedCache = { at: Date.now(), list };
  return list;
}

// Findet Stash eine Bedingung nicht (andere Version), wird sie weggelassen und neu gesucht.
async function findScenesTolerant(variables, dropped = [], query = SCENES_QUERY) {
  try {
    return { data: await stashGraphql(query, variables), dropped };
  } catch (e) {
    const sf = variables.scene_filter.AND || {};
    const keys = [...Object.keys(sf), ...Object.keys(variables.scene_filter)].filter((k) => k !== 'AND');
    const bad = keys.find((k) => new RegExp(`\\b${k}\\b`).test(e.message));
    if (!bad || dropped.length > 5) throw e;
    delete sf[bad];
    delete variables.scene_filter[bad];
    return findScenesTolerant(variables, [...dropped, bad], query);
  }
}

// test11: Tags, die eine Szene als VR kennzeichnen (wie lib/heresphere.js) – für „Nur 2D“ (10 min gemerkt)
const isVrTag = (t) => /\b(vr|virtual reality|180°?|360°?)\b/i.test(t);
let vrTagCache = { at: 0, ids: null };
async function vrTagIds() {
  if (vrTagCache.ids && Date.now() - vrTagCache.at < 600000) return vrTagCache.ids;
  const data = await stashGraphql('{ findTags(filter: { per_page: -1 }) { tags { id name } } }');
  vrTagCache = { at: Date.now(), ids: data.findTags.tags.filter((x) => isVrTag(x.name)).map((x) => x.id) };
  return vrTagCache.ids;
}

async function stashScenes(params) {
  const sorts = { new: 'created_at', date: 'date', title: 'title', random: `random_${Number(params.get('seed')) || 1}` };
  let sort = sorts[params.get('sort')] || 'created_at';
  let direction = sort === 'title' ? 'ASC' : 'DESC';
  const idList = (key) => (params.get(key) || '').split(',').filter((x) => /^\d+$/.test(x));

  // Eigene Filter (Chips, „nur mit Funscript“)
  const own = {};
  if (params.get('interactive') === '1') own.interactive = true;
  const tagIds = idList('tag');
  if (tagIds.length) own.tags = { value: tagIds, modifier: 'INCLUDES_ALL', depth: 0 };
  // „Nur 2D“ (⚙️ → Bibliothek, je Gerät) – test11: Szenen mit VR-Tag ausblenden (vorher: Tag „2D“ nötig, fehlte er,
  // wirkte der Schalter gar nicht)
  if (params.get('only2d') === '1') {
    const vr = await vrTagIds();
    if (vr.length) own.AND = { tags: { value: vr, modifier: 'EXCLUDES', depth: 0 } };
  }
  if (idList('performer').length) own.performers = { value: idList('performer'), modifier: 'INCLUDES_ALL' };
  if (idList('studio').length) own.studios = { value: idList('studio'), modifier: 'INCLUDES', depth: 0 };

  // Gespeicherter Stash-Filter als Grundlage, eigene Filter per AND dazu
  let sceneFilter = own;
  let q = params.get('q') || '';
  const savedId = params.get('saved');
  if (savedId) {
    const saved = (await stashSavedFilters()).find((f) => f.id === savedId);
    if (saved) {
      sceneFilter = JSON.parse(JSON.stringify(saved.filter));
      if (Object.keys(own).length) sceneFilter.AND = own;
      if (!q) q = saved.q;
      if (params.get('sort') === 'saved' && saved.sort) {
        sort = saved.sort.startsWith('random') ? `random_${Number(params.get('seed')) || 1}` : saved.sort;
        direction = saved.direction || 'DESC';
      }
    }
  }

  const { data, dropped } = await findScenesTolerant({
    filter: {
      q,
      page: Math.max(1, Number(params.get('page')) || 1),
      per_page: Math.min(100, Math.max(1, Number(params.get('per_page')) || 40)),
      sort,
      direction,
    },
    scene_filter: sceneFilter,
  });
  return {
    count: data.findScenes.count,
    ignored: dropped,
    scenes: data.findScenes.scenes.map((s) => ({
      id: s.id,
      title: s.title || cleanTitle(s.files[0]?.basename) || `Szene ${s.id}`,
      date: s.date || '',
      interactive: s.interactive,
      duration: s.files[0]?.duration || 0,
      studio: s.studio ? { id: s.studio.id, name: s.studio.name } : null,
      performers: (s.performers || []).map((p) => ({ id: p.id, name: p.name })),
      tags: (s.tags || []).map((t) => ({ id: t.id, name: t.name })),
    })),
  };
}

// Details einer Szene: Marker (Kapitel) und Wiedergabeposition zum Weiterschauen
const SCENE_QUERY = `query($id: ID!) {
  findScene(id: $id) {
    id title date details interactive resume_time play_count rating100 o_counter
    files { basename path size duration width height }
    studio { id name }
    performers { id name }
    tags { id name }
    scene_markers { title seconds end_seconds primary_tag { name } }
  }
}`;

async function stashScene(id) {
  let s;
  try {
    s = (await stashGraphql(SCENE_QUERY, { id })).findScene;
  } catch (e) {
    // ältere Stash-Versionen kennen end_seconds noch nicht
    if (!/end_seconds/.test(e.message)) throw e;
    s = (await stashGraphql(SCENE_QUERY.replace(' end_seconds', ''), { id })).findScene;
  }
  if (!s) throw Object.assign(new Error('Szene nicht gefunden'), { status: 404 });
  return {
    id: s.id,
    title: s.title || cleanTitle(s.files[0]?.basename) || `Szene ${s.id}`,
    basename: s.files[0]?.basename || '',
    // 2.0: weitere Scripts im selben Ordner (nur wenn der Ordner auch im Player eingebunden ist)
    scripts: await require('./stashscripts').stashVariants(s.files[0]?.path, Number(s.files[0]?.size) || 0).catch(() => []),
    width: s.files[0]?.width || 0,
    height: s.files[0]?.height || 0,
    interactive: s.interactive,
    duration: s.files[0]?.duration || 0,
    resume: s.resume_time || 0,
    playCount: s.play_count || 0,
    rating100: s.rating100 || 0,
    oCounter: s.o_counter || 0,
    favorite: (s.tags || []).some((t) => t.name.toLowerCase() === FAV_TAG.toLowerCase()),
    date: s.date || '',
    details: s.details || '',
    studio: s.studio ? { id: s.studio.id, name: s.studio.name } : null,
    performers: (s.performers || []).map((p) => ({ id: p.id, name: p.name })),
    tags: (s.tags || []).map((t) => ({ id: t.id, name: t.name })),
    markers: (s.scene_markers || [])
      .map((m) => ({ seconds: m.seconds, end: m.end_seconds || null, title: m.title || m.primary_tag?.name || 'Marker' }))
      .sort((a, b) => a.seconds - b.seconds),
  };
}

// ---------------------------------------------------------------------------
// Zurückschreiben in Stash: Bewertung, Favorit, O-Zähler, Marker.
// Szenen haben in Stash kein Favoriten-Feld – „Favorit“ ist ein Tag (wie bei Stashs
// eigener HereSphere-Anbindung). Marker brauchen einen Tag: „Lieblingsstelle“.
// Fehlende Tags legt der Player einmalig an.
// ---------------------------------------------------------------------------
const FAV_TAG = process.env.STASH_FAVORITE_TAG || 'Favorit';
const MARKER_TAG = process.env.STASH_MARKER_TAG || 'Lieblingsstelle';
const tagIdCache = new Map();

async function tagId(name) {
  if (tagIdCache.has(name)) return tagIdCache.get(name);
  const found = await stashGraphql(`query($n: String!) {
    findTags(tag_filter: { name: { value: $n, modifier: EQUALS } }, filter: { per_page: 1 }) { tags { id } }
  }`, { n: name });
  let id = found.findTags.tags[0]?.id;
  if (!id) id = (await stashGraphql('mutation($n: String!) { tagCreate(input: { name: $n }) { id } }', { n: name })).tagCreate.id;
  tagIdCache.set(name, id);
  return id;
}

async function stashSetRating(id, rating100) {
  const r = Math.max(0, Math.min(100, Math.round(Number(rating100) || 0)));
  await stashGraphql('mutation($id: ID!, $r: Int) { sceneUpdate(input: { id: $id, rating100: $r }) { id } }', { id, r: r || null });
  return { rating100: r };
}

async function stashSetFavorite(id, on) {
  const fav = await tagId(FAV_TAG);
  const scene = (await stashGraphql('query($id: ID!) { findScene(id: $id) { tags { id } } }', { id })).findScene;
  const ids = new Set((scene?.tags || []).map((t) => t.id));
  if (on) ids.add(fav); else ids.delete(fav);
  await stashGraphql('mutation($id: ID!, $t: [ID!]) { sceneUpdate(input: { id: $id, tag_ids: $t }) { id } }', { id, t: [...ids] });
  return { favorite: !!on };
}

async function stashO(id, undo) {
  const add = undo ? 'sceneDeleteO' : 'sceneAddO';
  try {
    const d = await stashGraphql(`mutation($id: ID!) { ${add}(id: $id) { count } }`, { id });
    return { oCounter: d[add].count };
  } catch {
    // ältere Stash-Versionen
    const old = undo ? 'sceneDecrementO' : 'sceneIncrementO';
    const d = await stashGraphql(`mutation($id: ID!) { ${old}(id: $id) }`, { id });
    return { oCounter: d[old] };
  }
}

async function stashAddMarker(id, seconds, title) {
  const tag = await tagId(MARKER_TAG);
  const d = await stashGraphql(`mutation($s: ID!, $sec: Float!, $t: String!, $tag: ID!) {
    sceneMarkerCreate(input: { scene_id: $s, seconds: $sec, title: $t, primary_tag_id: $tag }) { id seconds title }
  }`, { s: id, sec: Math.max(0, Number(seconds) || 0), t: String(title || MARKER_TAG).slice(0, 200), tag });
  return { marker: d.sceneMarkerCreate };
}

async function stashSceneAction(id, action, req) {
  const body = action === 'play' ? {} : JSON.parse((await readBody(req, 10000)) || '{}');
  switch (action) {
    case 'activity': return stashActivity(id, body);
    case 'play': return stashAddPlay(id);
    case 'rating': return stashSetRating(id, body.rating100);
    case 'favorite': return stashSetFavorite(id, body.favorite);
    case 'o': return stashO(id, false);
    case 'o-undo': return stashO(id, true);
    case 'marker': return stashAddMarker(id, body.seconds, body.title);
    default: throw Object.assign(new Error('Unbekannte Aktion'), { status: 404 });
  }
}

// Position und Spieldauer an Stash melden (wie Stash es selbst beim Abspielen tut)
async function stashActivity(id, { resume, played }) {
  await stashGraphql('mutation($id: ID!, $r: Float, $p: Float) { sceneSaveActivity(id: $id, resume_time: $r, playDuration: $p) }', {
    id, r: Math.max(0, Number(resume) || 0), p: Math.max(0, Number(played) || 0),
  });
}

async function stashAddPlay(id) {
  try {
    await stashGraphql('mutation($id: ID!) { sceneAddPlay(id: $id) { count } }', { id });
  } catch {
    // ältere Stash-Versionen
    await stashGraphql('mutation($id: ID!) { sceneIncrementPlayCount(id: $id) }', { id });
  }
}

// Auswahllisten für die Filter (5 Minuten zwischengespeichert)
let filterCache = { at: 0, data: null };
async function stashFilters() {
  if (filterCache.data && Date.now() - filterCache.at < 300000) return filterCache.data;
  const data = await stashGraphql(`{
    findTags(filter: { per_page: -1 }) { tags { id name scene_count } }
    findPerformers(filter: { per_page: -1 }) { performers { id name scene_count } }
    findStudios(filter: { per_page: -1 }) { studios { id name scene_count } }
  }`);
  // Nach Anzahl Szenen sortiert (beliebteste zuerst), leere ausgeblendet
  const list = (items) => items
    .filter((x) => x.scene_count > 0)
    .map((x) => ({ id: x.id, name: x.name, count: x.scene_count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  filterCache = {
    at: Date.now(),
    data: { tags: list(data.findTags.tags), performers: list(data.findPerformers.performers), studios: list(data.findStudios.studios) },
  };
  return filterCache.data;
}

// Netze des Containers als CIDR (z. B. 172.18.0.0/16) – für den Hinweis „public_whitelist“ in Stash ab 0.32
function ownNetworks() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.internal || (n.family !== 'IPv4' && n.family !== 4)) continue;
      const ip = n.address.split('.').map(Number);
      const mask = n.netmask.split('.').map(Number);
      const bits = mask.reduce((sum, m) => sum + m.toString(2).split('1').length - 1, 0);
      out.add(ip.map((x, i) => x & mask[i]).join('.') + '/' + bits);
    }
  }
  return [...out];
}

async function stashStatus() {
  if (!stashConf().url) return { configured: false };
  try {
    const data = await stashGraphql('{ version { version } findScenes(filter: { per_page: 1 }) { count } }');
    return { configured: true, ok: true, version: data.version?.version || '', scenes: data.findScenes?.count ?? null, at: Date.now() };
  } catch (e) {
    const st = { configured: true, ok: false, error: e.message, code: e.code || 'error', at: Date.now() };
    if (e.code === 'forbidden') { st.networks = ownNetworks(); st.hasKey = !!stashConf().key; }
    return st;
  }
}

// test10: Stash-Zustand merken und von selbst neu prüfen – nicht erreichbar alle 30 s, sonst alle 5 min.
// onChange(neu, alt) meldet Wechsel (Log „wieder erreichbar“ / „nicht mehr erreichbar“).
let stashState = null;
let stashTimer = null;
async function stashCheck() {
  stashState = await stashStatus();
  return stashState;
}
// test11: Adresse/Key in ⚙️ geändert – Zwischenspeicher leeren, Überwachung neu starten
function stashReconfigure() {
  savedCache = { at: 0, list: null };
  filterCache = { at: 0, data: null };
  vrTagCache = { at: 0, ids: null };
  stashState = null;
  clearTimeout(stashTimer);
  stashTimer = null;
}
function stashMonitor(onChange) {
  if (!stashConf().url || stashTimer) return;
  const loop = async () => {
    const before = stashState;
    const now = await stashCheck();
    if (before && before.ok !== now.ok) onChange(now, before);
    stashTimer = setTimeout(loop, now.ok ? 300000 : 30000);
    stashTimer.unref?.();
  };
  stashTimer = setTimeout(loop, stashState?.ok ? 300000 : 30000);
  stashTimer.unref?.();
}
const stashCurrent = async () => stashState || stashCheck();

async function proxyStash(req, res, kind, id, file, search) {
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const up = await stashRequest(req.method, `/${kind}/${id}/${file}${search}`, headers, undefined, 0);
  const pass = {};
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']) {
    if (up.headers[h]) pass[h] = up.headers[h];
  }
  res.writeHead(up.statusCode, pass);
  up.pipe(res);
  res.on('close', () => up.destroy());
}

module.exports = { stashRequest, ids, stashSavedFilters, findScenesTolerant, stashScenes, stashScene, stashSetRating, stashSetFavorite, stashSceneAction, stashFilters, stashCheck, stashMonitor, stashCurrent, stashReconfigure, proxyStash };
