// Handy Player – kleiner Webserver ohne externe Abhängigkeiten.
// Liefert die Weboberfläche aus, listet die Bibliothek und streamt Videos (mit Range-Support).

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || '/media');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MAX_STORE_BYTES = 5 * 1024 * 1024;
const STASH_URL = (process.env.STASH_URL || '').replace(/\/+$/, '');
const STASH_API_KEY = process.env.STASH_API_KEY || '';
const STASH_INSECURE = process.env.STASH_INSECURE === '1'; // selbstsigniertes Zertifikat bei Stash akzeptieren
// HQ-Stream: ffmpeg mit Intel-Grafik (VAAPI = Quick-Sync-Hardware) oder notfalls CPU
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const HQ_DEVICE = process.env.HQ_DEVICE || '/dev/dri/renderD128';
const HQ_MAX = Number(process.env.HQ_MAX) || 3; // gleichzeitige Umwandlungen
const VERSION = (() => { try { return fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.funscript': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
};

const sha = (s) => crypto.createHash('sha256').update(s).digest();

function authOk(req) {
  if (!AUTH_USER) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString().split(':');
  const okUser = crypto.timingSafeEqual(sha(user), sha(AUTH_USER));
  const okPass = crypto.timingSafeEqual(sha(rest.join(':')), sha(AUTH_PASS));
  return okUser && okPass;
}

function checkAuth(req, res) {
  if (authOk(req)) return true;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Handy Player", charset="UTF-8"' });
  res.end('Anmeldung erforderlich');
  return false;
}

// Verhindert Pfade außerhalb des Basisordners (../ usw.)
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
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

// Patterns und Sequenzen aus dem Steuerungs-Reiter (eine JSON-Datei)
async function readStore() {
  try {
    return JSON.parse(await fsp.readFile(STORE_FILE, 'utf8'));
  } catch {
    return { patterns: [], sequences: [] };
  }
}

// ---------------------------------------------------------------------------
// Stash: GraphQL für die Szenenliste, Videos/Funscripts/Bilder werden durchgereicht.
// Der API-Key bleibt auf dem Server.
// ---------------------------------------------------------------------------
function stashRequest(method, pathAndQuery, headers = {}, body, timeout = 15000) {
  const target = new URL(STASH_URL + pathAndQuery);
  const mod = target.protocol === 'https:' ? https : http;
  if (STASH_API_KEY) headers.ApiKey = STASH_API_KEY;
  return new Promise((resolve, reject) => {
    const req = mod.request(target, { method, headers, rejectUnauthorized: !STASH_INSECURE }, resolve);
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error('keine Antwort')));
    req.on('error', (err) => {
      const why = err.code === 'ENOTFOUND' ? `Adresse ${target.hostname} unbekannt (DNS)` : err.code || err.message;
      reject(Object.assign(new Error(`Stash nicht erreichbar: ${why}`), { status: 502 }));
    });
    req.end(body);
  });
}

async function stashGraphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  const res = await stashRequest('POST', '/graphql', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
  const text = await readBody(res, 20 * 1024 * 1024);
  if (res.statusCode === 401) throw Object.assign(new Error('Stash: API-Key fehlt oder ist falsch'), { status: 502 });
  if (res.statusCode !== 200) throw Object.assign(new Error(`Stash: HTTP ${res.statusCode}`), { status: 502 });
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

// Lesbarer Titel aus einem Dateinamen, wenn in Stash keiner gepflegt ist:
// „Studio_Szene.Name_1080p_60fps.mp4“ -> „Studio Szene Name“
function cleanTitle(basename) {
  if (!basename) return '';
  let t = basename.replace(/\.[a-z0-9]{2,4}$/i, '');
  t = t.replace(/[[(][^\])]*(\d{3,4}p|\dk|fps|x26[45]|h\.?26[45]|hevc|web|hd|uhd)[^\])]*[\])]/gi, ' ');
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/\b(\d{3,4}p|[2-8]k|uhd|fhd|hd|\d{2,3}fps|x26[45]|h ?26[45]|hevc|avc|aac|web(rip|dl)?|mp4|180|360|lr|sbs|tb|3dh|3dv|vr|mkx\d+|fisheye\d*)\b/gi, ' ');
  t = t.replace(/\s*-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return t || basename;
}

async function stashScenes(params) {
  const sorts = { new: 'created_at', date: 'date', title: 'title', random: `random_${Number(params.get('seed')) || 1}` };
  let sort = sorts[params.get('sort')] || 'created_at';
  let direction = sort === 'title' ? 'ASC' : 'DESC';
  const idList = (key) => (params.get(key) || '').split(',').filter((x) => /^\d+$/.test(x));

  // Eigene Filter (Chips, „nur mit Funscript“)
  const own = {};
  if (params.get('interactive') === '1') own.interactive = true;
  if (idList('tag').length) own.tags = { value: idList('tag'), modifier: 'INCLUDES_ALL', depth: 0 };
  if (idList('performer').length) own.performers = { value: idList('performer'), modifier: 'INCLUDES_ALL' };
  if (idList('studio').length) own.studios = { value: idList('studio'), modifier: 'INCLUDES', depth: 0 };
  // „Weiterschauen“: angefangene Szenen, zuletzt gesehene zuerst
  if (params.get('continue') === '1') {
    own.resume_time = { value: 10, modifier: 'GREATER_THAN' };
    sort = 'last_played_at';
    direction = 'DESC';
  }

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
    files { basename duration width height }
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
// HereSphere (VR-Player): eigene API, damit die Brille die Bibliothek direkt
// durchsuchen und Videos samt Funscript abspielen kann.
//   In HereSphere die Adresse https://<player>/heresphere öffnen.
//   Kategorien: gespeicherte Stash-Filter, „Alle mit Script“, eingebundene Ordner.
// ---------------------------------------------------------------------------
const HS_HEADERS = { 'Content-Type': MIME['.json'], 'HereSphere-JSON-Version': '1', 'Cache-Control': 'no-store' };

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim();
  return `${proto}://${host}`;
}
const encPath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

// VR-Format aus Dateinamen (übliche Kennungen) und VR-Tags ableiten
function vrFormat(name, tags = []) {
  const n = ` ${String(name).toLowerCase().replace(/[._\-\s()[\]]+/g, ' ')} `;
  const has = (re) => re.test(n);
  const vrTag = tags.some((t) => /\b(vr|virtual reality|180°?|360°?)\b/i.test(t));
  const vr = vrTag || has(/ (vr|180|190|200|220|360|lr|sbs|tb|ou|3dh|3dv|fisheye\d*|mkx200|mkx220|vrca220|rf52) /);
  if (!vr) return { projection: 'perspective', stereo: 'mono', fov: 180, lens: 'Linear' };
  const stereo = has(/ (tb|ou|3dv|over under) /) ? 'tb' : has(/ (mono|2d) /) ? 'mono' : 'sbs';
  let projection = 'equirectangular', fov = 180, lens = 'Linear';
  if (has(/ 360 /)) { projection = 'equirectangular360'; fov = 360; }
  if (has(/ (fisheye\d*|mkx200|mkx220|vrca220|rf52|190|200|220) /)) {
    projection = 'fisheye';
    fov = has(/ (mkx220|vrca220|220) /) ? 220 : has(/ (mkx200|200) /) ? 200 : 190;
    if (has(/ mkx200 /)) lens = 'MKX200';
    else if (has(/ mkx220 /)) lens = 'MKX220';
    else if (has(/ vrca220 /)) lens = 'VRCA220';
  }
  return { projection, stereo, fov, lens };
}

const HS_IDS_QUERY = `query($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) { count scenes { id } }
}`;

async function heresphereIndex(req) {
  const base = publicBase(req);
  const library = [];
  if (STASH_URL) {
    const lists = [{ name: 'Alle mit Script', filter: { interactive: true }, sort: 'created_at', direction: 'DESC' }];
    try {
      for (const f of await stashSavedFilters()) lists.push({ name: f.name, filter: f.filter, sort: f.sort || 'created_at', direction: f.direction || 'DESC', q: f.q });
    } catch { /* ohne gespeicherte Filter */ }
    for (const l of lists) {
      try {
        const { data } = await findScenesTolerant({
          filter: { q: l.q || '', per_page: -1, sort: l.sort.startsWith('random') ? 'created_at' : l.sort, direction: l.direction },
          scene_filter: JSON.parse(JSON.stringify(l.filter)),
        }, [], HS_IDS_QUERY);
        library.push({ name: l.name, list: data.findScenes.scenes.map((s) => `${base}/heresphere/stash/${s.id}`) });
      } catch (e) {
        console.warn(`HereSphere: Liste „${l.name}“ übersprungen: ${e.message}`);
      }
    }
  }
  const items = await scanLibrary(MEDIA_DIR);
  const roots = new Map();
  for (const it of items) {
    const root = it.video.includes('/') ? it.video.split('/')[0] : 'Ordner';
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(`${base}/heresphere/media/${encPath(it.video)}`);
  }
  for (const [name, list] of roots) library.push({ name: `Ordner: ${name}`, list });
  return { access: 1, library };
}

function hsCommon() {
  return {
    access: 1, rating: 0, favorites: 0, comments: 0, isFavorite: false, isEyeSwapped: false, cameraIPD: 6.5,
    subtitles: [], writeFavorite: false, writeRating: false, writeTags: false, writeHSP: false,
  };
}

async function heresphereStash(req, id) {
  const base = publicBase(req);
  const s = await stashScene(id);
  const ms = (sec) => Math.round(sec * 1000);
  const tags = [
    ...(s.studio ? [{ name: `Studio:${s.studio.name}` }] : []),
    ...s.performers.map((p) => ({ name: `Performer:${p.name}` })),
    ...s.tags.map((t) => ({ name: `Tag:${t.name}` })),
    ...s.markers.map((m) => ({ name: `Marker:${m.title}`, start: ms(m.seconds), end: ms(m.end || m.seconds + 20), track: 0 })),
  ];
  return {
    ...hsCommon(),
    // Bewertung (0–5 Sterne) und Favorit können in HereSphere geändert werden
    rating: s.rating100 / 20,
    isFavorite: s.favorite,
    writeRating: true,
    writeFavorite: true,
    title: s.title,
    description: s.details,
    thumbnailImage: `${base}/stash/scene/${id}/screenshot`,
    thumbnailVideo: `${base}/stash/scene/${id}/preview`,
    dateReleased: s.date || undefined,
    duration: ms(s.duration),
    ...vrFormat(s.basename || s.title, s.tags.map((t) => t.name)),
    scripts: s.interactive ? [{ name: `${s.title}.funscript`, url: `${base}/stash/scene/${id}/funscript` }] : [],
    tags,
    media: [{
      name: 'Original',
      sources: [{ resolution: s.height, height: s.height, width: s.width, url: `${base}/stash/scene/${id}/stream` }],
    }],
  };
}

async function heresphereMedia(req, rel) {
  const base = publicBase(req);
  const file = safeJoin(MEDIA_DIR, rel);
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error('Datei nicht gefunden'), { status: 404 });
  const name = path.basename(rel).replace(/\.[^.]+$/, '');
  const scriptRel = rel.replace(/\.[^.]+$/, '.funscript');
  const info = await hqProbe('media:' + rel).catch(() => ({ width: 0, height: 0, duration: 0 }));
  return {
    ...hsCommon(),
    title: cleanTitle(path.basename(rel)),
    description: '',
    duration: Math.round((info.duration || 0) * 1000),
    ...vrFormat(name),
    scripts: fs.existsSync(safeJoin(MEDIA_DIR, scriptRel) || '') ? [{ name: path.basename(scriptRel), url: `${base}/media/${encPath(scriptRel)}` }] : [],
    tags: rel.includes('/') ? [{ name: `Ordner:${rel.split('/')[0]}` }] : [],
    media: [{ name: 'Original', sources: [{ resolution: info.height, height: info.height, width: info.width, url: `${base}/media/${encPath(rel)}` }] }],
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

async function stashStatus() {
  if (!STASH_URL) return { configured: false };
  try {
    const data = await stashGraphql('{ version { version } }');
    return { configured: true, ok: true, version: data.version?.version || '' };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

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

// ---------------------------------------------------------------------------
// HQ-Stream: Video live entrauschen, hochskalieren, schärfen und als H.264 streamen.
//   VAAPI nutzt die Video-Hardware der Intel-Grafik (dieselbe wie Quick Sync bei
//   Jellyfin): denoise_vaapi -> scale_vaapi (hq) -> sharpness_vaapi -> h264_vaapi.
//   Ohne /dev/dri oder bei Fehlern: CPU (hqdn3d -> lanczos -> unsharp -> x264).
//   Ausgabe ist fragmentiertes MP4; Spulen = neue Anfrage mit Startzeit t.
// ---------------------------------------------------------------------------
const HQ_PRESETS = {
  clean: { dn: 12, sh: 24, cpuDn: 'hqdn3d=1.5:1.5:3:3', cpuSh: 'unsharp=5:5:0.5:5:5:0' },
  strong: { dn: 28, sh: 44, cpuDn: 'hqdn3d=3:2.5:5:4', cpuSh: 'unsharp=5:5:0.9:5:5:0' },
};
let hqInfo = null;
let hqRunning = 0;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
});

async function hqStatus() {
  if (hqInfo) return hqInfo;
  const { err } = await run(FFMPEG, ['-hide_banner', '-version']);
  if (err) return (hqInfo = { available: false, reason: 'ffmpeg ist nicht installiert' });
  const accel = process.env.HQ_ACCEL || (fs.existsSync(HQ_DEVICE) ? 'vaapi' : 'cpu');
  return (hqInfo = { available: true, accel });
}

// Quelle: "stash:<id>" oder "media:<pfad im Bibliotheksordner>"
function hqSource(src) {
  const m = /^(stash|media):(.+)$/.exec(src || '');
  if (!m) throw Object.assign(new Error('Ungültige Quelle'), { status: 400 });
  if (m[1] === 'stash') {
    if (!STASH_URL || !/^\d+$/.test(m[2])) throw Object.assign(new Error('Ungültige Stash-Szene'), { status: 400 });
    const headers = STASH_API_KEY ? ['-headers', `ApiKey: ${STASH_API_KEY}\r\n`] : [];
    const tls = STASH_INSECURE ? ['-tls_verify', '0'] : [];
    return { input: `${STASH_URL}/scene/${m[2]}/stream`, pre: [...headers, ...tls] };
  }
  const file = safeJoin(MEDIA_DIR, m[2]);
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error('Datei nicht gefunden'), { status: 404 });
  return { input: file, pre: [] };
}

async function hqProbe(src) {
  const { input, pre } = hqSource(src);
  const { err, stdout } = await run(FFPROBE, [...pre, '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', input]);
  if (err) throw Object.assign(new Error('Video konnte nicht gelesen werden'), { status: 502 });
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] || {};
  return { width: s.width || 0, height: s.height || 0, codec: s.codec_name || '', duration: Number(j.format?.duration) || 0 };
}

// Zielgröße: auf die gewünschte Höhe (Standard 1080p) skalieren, gerade Pixelzahlen
function hqSize(info, height) {
  const h = Math.max(240, Math.min(2160, height || 1080)) & ~1;
  const w = info.width && info.height ? Math.round((info.width * h) / info.height / 2) * 2 : Math.round((h * 16) / 9 / 2) * 2;
  return { w, h };
}

function hqArgs({ input, pre }, { start, preset, size, accel, output }) {
  const p = HQ_PRESETS[preset] || HQ_PRESETS.clean;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (accel === 'vaapi') args.push('-vaapi_device', HQ_DEVICE, '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi');
  args.push(...pre, '-ss', String(Math.max(0, start || 0)), '-i', input, '-map', '0:v:0', '-map', '0:a:0?');
  if (accel === 'vaapi') {
    // format=nv12|vaapi + hwupload: klappt mit Hardware- und Software-Decoding
    args.push('-vf', `format=nv12|vaapi,hwupload,denoise_vaapi=denoise=${p.dn},`
      + `scale_vaapi=w=${size.w}:h=${size.h}:mode=hq:format=nv12,sharpness_vaapi=sharpness=${p.sh}`,
    '-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '21', '-g', '60');
  } else {
    args.push('-vf', `${p.cpuDn},scale=${size.w}:${size.h}:flags=lanczos,${p.cpuSh},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-g', '60');
  }
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  return args.concat(output);
}

// Startet ffmpeg; wartet auf die ersten Daten. Scheitert VAAPI, wird automatisch die CPU genutzt.
function hqSpawn(source, opts, onData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, hqArgs(source, opts), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', started = false;
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    proc.stdout.once('data', (chunk) => { started = true; resolve({ proc, first: chunk }); });
    proc.on('error', (e) => { if (!started) reject(e); });
    proc.on('close', (code) => {
      if (started) return;
      if (opts.accel === 'vaapi') {
        console.warn('HQ: VAAPI fehlgeschlagen, nutze CPU:', err.trim().split('\n').pop());
        hqSpawn(source, { ...opts, accel: 'cpu' }, onData).then(resolve, reject);
      } else {
        reject(Object.assign(new Error(`ffmpeg: ${err.trim().split('\n').pop() || 'Exitcode ' + code}`), { status: 502 }));
      }
    });
  });
}

async function hqStream(req, res, params) {
  const status = await hqStatus();
  if (!status.available) throw Object.assign(new Error(status.reason), { status: 501 });
  if (hqRunning >= HQ_MAX) throw Object.assign(new Error('Zu viele HQ-Streams gleichzeitig'), { status: 503 });
  const source = hqSource(params.get('src'));
  const info = await hqProbe(params.get('src')).catch(() => ({ width: 0, height: 0 }));
  const opts = {
    start: Number(params.get('t')) || 0,
    preset: params.get('preset') || 'clean',
    size: hqSize(info, Number(params.get('h')) || 1080),
    accel: status.accel,
    output: ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'],
  };
  hqRunning++;
  let proc;
  const done = () => { if (proc) proc.kill('SIGKILL'); };
  res.on('close', done);
  try {
    const started = await hqSpawn(source, opts);
    proc = started.proc;
    if (res.destroyed) return done();
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    res.write(started.first);
    proc.stdout.pipe(res);
    await new Promise((r) => proc.on('close', r));
  } finally {
    hqRunning--;
  }
}

// Leistungstest: 20 s umwandeln (ohne Ausgabe) und Geschwindigkeit messen
async function hqBench(params) {
  const status = await hqStatus();
  if (!status.available) throw Object.assign(new Error(status.reason), { status: 501 });
  const src = params.get('src');
  const info = await hqProbe(src);
  const t0 = Date.now();
  const accel = params.get('accel') || status.accel;
  const opts = {
    start: Math.min(60, info.duration / 3 || 0),
    preset: params.get('preset') || 'clean',
    size: hqSize(info, Number(params.get('h')) || 1080),
    accel,
    output: ['-t', '20', '-progress', 'pipe:1', '-f', 'null', '-'],
  };
  const { err, stdout, stderr } = await run(FFMPEG, hqArgs(hqSource(src), opts));
  const secs = (Date.now() - t0) / 1000;
  const outMs = Number([...stdout.matchAll(/out_time_ms=(\d+)/g)].pop()?.[1] || 0) / 1e6;
  const fps = Number([...stdout.matchAll(/fps=([\d.]+)/g)].pop()?.[1] || 0);
  if (err && !outMs) throw Object.assign(new Error(`ffmpeg (${accel}): ${String(stderr).trim().split('\n').pop()}`), { status: 502 });
  return { accel, source: info, target: opts.size, seconds: secs, speed: outMs / secs, fps };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Zu groß'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

async function sendFile(req, res, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    res.writeHead(404);
    return res.end('Nicht gefunden');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');

  if (range && (range[1] || range[2])) {
    let start, end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    } else {
      start = Math.max(stat.size - Number(range[2]), 0);
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Fernbedienung: Jede offene Player-Seite hält eine Server-Sent-Events-Verbindung.
// Bildschirme (TV/PC) melden ihren Zustand (Szene, Position, läuft/pausiert), die
// Fernbedienung (Smartphone) schickt Befehle. Der Server reicht nur weiter und merkt
// sich den letzten Zustand je Bildschirm – nichts davon wird gespeichert.
// ---------------------------------------------------------------------------
const rc = { clients: new Map(), states: new Map() };
const RC_ID = /^[a-z0-9]{6,32}$/;

function rcSend(c, event, data) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function rcScreens() {
  return [...rc.clients.values()].filter((c) => c.screen)
    .map((c) => ({ id: c.id, name: c.name, state: rc.states.get(c.id) || null }));
}
function rcAnnounce() {
  const list = rcScreens();
  for (const c of rc.clients.values()) rcSend(c, 'screens', { list, peers: rc.clients.size - 1 });
}

function rcEvents(req, res, params) {
  const id = params.get('id') || '';
  if (!RC_ID.test(id)) throw Object.assign(new Error('Ungültige Geräte-ID'), { status: 400 });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Reverse Proxy soll nicht puffern
  });
  res.write('retry: 2000\n\n');
  rc.clients.get(id)?.res.end(); // gleiche Seite neu verbunden -> alte Verbindung schließen
  const client = { id, res, screen: params.get('screen') === '1', name: String(params.get('name') || 'Gerät').slice(0, 40) };
  rc.clients.set(id, client);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    if (rc.clients.get(id) !== client) return;
    rc.clients.delete(id);
    rc.states.delete(id);
    rcAnnounce();
  });
  rcAnnounce();
}

async function rcPost(req, kind) {
  const body = JSON.parse(await readBody(req, 20000) || '{}');
  if (!RC_ID.test(body.from || '')) throw Object.assign(new Error('Ungültige Geräte-ID'), { status: 400 });
  if (kind === 'state') {
    // Zustand eines Bildschirms an alle anderen Seiten
    rc.states.set(body.from, body.state || null);
    for (const c of rc.clients.values()) if (c.id !== body.from) rcSend(c, 'state', { id: body.from, state: body.state || null });
    return;
  }
  // Befehl der Fernbedienung an einen Bildschirm
  const target = rc.clients.get(body.to);
  if (!target || !target.screen) throw Object.assign(new Error('Bildschirm nicht verbunden'), { status: 404 });
  rcSend(target, 'cmd', { from: body.from, cmd: String(body.cmd || ''), arg: body.arg ?? null });
}

// Optional direkt HTTPS: entweder TLS_PFX (+ TLS_PFX_PASS) oder TLS_CERT + TLS_KEY (PEM).
function tlsOptions() {
  if (process.env.TLS_PFX) return { pfx: fs.readFileSync(process.env.TLS_PFX), passphrase: process.env.TLS_PFX_PASS || '' };
  if (process.env.TLS_CERT && process.env.TLS_KEY) return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) };
  return null;
}
const tls = tlsOptions();

const handler = async (req, res) => {
  try {
    if (req.url === '/healthz') return res.end('ok');
    if (req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ version: VERSION }));
    }
    if (!checkAuth(req, res)) return;
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/store') {
      if (req.method === 'PUT') {
        await writeStore(req);
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await readStore()));
    }

    if (pathname === '/api/remote/time') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ now: Date.now() }));
    }
    if (pathname === '/api/remote/events' && req.method === 'GET') return rcEvents(req, res, url.searchParams);
    if ((pathname === '/api/remote/state' || pathname === '/api/remote/cmd') && req.method === 'POST') {
      await rcPost(req, pathname.endsWith('state') ? 'state' : 'cmd');
      res.writeHead(204);
      return res.end();
    }

    const sa = /^\/api\/stash\/scene\/(\d+)(?:\/(activity|play|rating|favorite|o|o-undo|marker))?$/.exec(pathname);
    if (sa) {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      if (sa[2] && req.method === 'POST') {
        const result = await stashSceneAction(sa[1], sa[2], req);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(JSON.stringify(result || { ok: true }));
      }
      if (!sa[2] && req.method === 'GET') {
        const scene = await stashScene(sa[1]);
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(scene));
      }
      throw Object.assign(new Error('Methode nicht erlaubt'), { status: 405 });
    }

    // HereSphere fragt per GET oder POST an. Bei Stash-Szenen enthält der POST ggf. eine
    // neue Bewertung (0–5) oder den Favoriten-Status – das wird nach Stash geschrieben.
    if (pathname === '/heresphere' || pathname.startsWith('/heresphere/')) {
      let body = {};
      try { body = JSON.parse((await readBody(req, 100000)) || '{}'); } catch { body = {}; }
      let data;
      if (pathname === '/heresphere' || pathname === '/heresphere/') data = await heresphereIndex(req);
      else if (/^\/heresphere\/stash\/\d+$/.test(pathname)) {
        if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
        const id = pathname.split('/').pop();
        if (typeof body.rating === 'number') await stashSetRating(id, body.rating * 20).catch((e) => console.warn('HereSphere-Bewertung:', e.message));
        if (typeof body.isFavorite === 'boolean') await stashSetFavorite(id, body.isFavorite).catch((e) => console.warn('HereSphere-Favorit:', e.message));
        data = await heresphereStash(req, id);
      } else if (pathname.startsWith('/heresphere/media/')) data = await heresphereMedia(req, pathname.slice('/heresphere/media/'.length));
      else throw Object.assign(new Error('Nicht gefunden'), { status: 404 });
      res.writeHead(200, HS_HEADERS);
      return res.end(JSON.stringify(data));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }

    if (pathname === '/hq/stream') return await hqStream(req, res, url.searchParams);
    if (pathname === '/api/hq/status' || pathname === '/api/hq/probe' || pathname === '/api/hq/bench') {
      const data = pathname.endsWith('status') ? await hqStatus()
        : pathname.endsWith('probe') ? await hqProbe(url.searchParams.get('src'))
          : await hqBench(url.searchParams);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }

    if (pathname === '/api/stash/saved-filters') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const list = (await stashSavedFilters()).map(({ id, name }) => ({ id, name }));
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(list));
    }

    if (pathname === '/api/stash/filters') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const filters = await stashFilters();
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(filters));
    }

    if (pathname === '/api/library') {
      const items = await scanLibrary(MEDIA_DIR);
      items.sort((a, b) => a.video.localeCompare(b.video, 'de', { numeric: true }));
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(items));
    }

    if (pathname === '/api/stash/status') {
      const status = await stashStatus();
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(status));
    }

    if (pathname === '/api/stash/scenes') {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      const scenes = await stashScenes(url.searchParams);
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(scenes));
    }

    // Durchgereicht werden nur diese Stash-Dateien: Videos, Funscript, Vorschauen, Spul-Sprites und Bilder
    const sm = /^\/stash\/(scene)\/(\d+)\/(stream|stream\.mp4|funscript|screenshot|preview|webp|vtt\/thumbs|vtt\/sprite)$/.exec(pathname)
      || /^\/stash\/(tag|performer|studio)\/(\d+)\/(image)$/.exec(pathname);
    if (sm) {
      if (!STASH_URL) throw Object.assign(new Error('Stash ist nicht eingerichtet'), { status: 404 });
      return await proxyStash(req, res, sm[1], sm[2], sm[3], url.search);
    }

    if (pathname.startsWith('/media/')) {
      const file = safeJoin(MEDIA_DIR, pathname.slice('/media/'.length));
      if (!file) {
        res.writeHead(403);
        return res.end();
      }
      return sendFile(req, res, file);
    }

    const file = safeJoin(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file) {
      res.writeHead(403);
      return res.end();
    }
    return sendFile(req, res, file);
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(err);
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 500 ? 'Serverfehler' : err.message);
  }
};

const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// WebSocket-Weiterleitung /intiface?target=IP:PORT -> ws://IP:PORT (Intiface Central auf dem Smartphone).
// Nötig, weil eine HTTPS-Seite keine unverschlüsselte ws://-Verbindung öffnen darf.
// Erlaubt sind nur private IPv4-Adressen im lokalen Netz.
const PRIVATE_IP = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|127\.\d+)\.\d+\.\d+$/;

server.on('upgrade', (req, socket, head) => {
  const fail = (code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.on('error', () => {});
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/intiface') return fail(404, 'Not Found');
  if (!authOk(req)) return fail(401, 'Unauthorized');
  const m = /^([\d.]+):(\d{1,5})$/.exec(url.searchParams.get('target') || '');
  if (!m || !PRIVATE_IP.test(m[1]) || Number(m[2]) > 65535) return fail(400, 'Bad Request');

  const upstream = net.connect(Number(m[2]), m[1]);
  upstream.setTimeout(5000, () => upstream.destroy(new Error('timeout')));
  upstream.on('connect', () => {
    upstream.setTimeout(0);
    const lines = ['GET / HTTP/1.1', `Host: ${m[1]}:${m[2]}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (!/^(host|authorization|cookie)$/i.test(name)) lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', (err) => {
    if (!socket.destroyed && socket.bytesWritten === 0) fail(502, 'Bad Gateway');
    else socket.destroy();
    console.warn(`Intiface ${m[1]}:${m[2]} nicht erreichbar: ${err.message}`);
  });
  socket.on('close', () => upstream.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`Handy Player ${VERSION} läuft auf ${tls ? 'https' : 'http'}://${HOST}:${PORT}, Bibliothek: ${MEDIA_DIR}`);
  if (STASH_URL) console.log(`Stash: ${STASH_URL}${STASH_API_KEY ? ' (mit API-Key)' : ''}`);
  if (!AUTH_USER) console.warn('WARNUNG: Keine Anmeldung gesetzt (AUTH_USER/AUTH_PASS). Nur hinter einem geschützten Proxy betreiben!');
});
