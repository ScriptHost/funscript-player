'use strict';

// HereSphere (VR-Brille)
const fs = require('fs');
const path = require('path');
const { MEDIA_DIR, MIME, STASH_URL, VIDEO_EXT } = require('./config');
const { cleanTitle, safeJoin } = require('./util');
const { libraryItems } = require('./library');
const { hsToken, serverSettings } = require('./settings');
const { findScenesTolerant, stashSavedFilters, stashScene } = require('./stash');
const { hqProbe } = require('./hq');

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

// Stash-Tag, der eine Szene als VR kennzeichnet (z. B. „VR“, „180°“, „Virtual Reality“)
const isVrTag = (t) => /\b(vr|virtual reality|180°?|360°?)\b/i.test(t);

// VR-Format aus Dateinamen (übliche Kennungen) und VR-Tags ableiten
function vrFormat(name, tags = []) {
  const n = ` ${String(name).toLowerCase().replace(/[._\-\s()[\]]+/g, ' ')} `;
  const has = (re) => re.test(n);
  const vrTag = tags.some(isVrTag);
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
  findScenes(filter: $filter, scene_filter: $scene_filter) { count scenes { id tags { name } } }
}`;

// HereSphere zeigt nur VR: Stash-Szenen mit mindestens einem VR-Tag, Ordner-Videos mit
// VR-Kennung im Dateinamen (Ordner haben keine Tags). Leere Listen fallen weg.

const hsVrOnly = () => serverSettings.hsVrOnly !== false;
// Mit HereSphere-Passwort hängt an jeder Adresse das Token (Videos/Scripts lädt HereSphere ohne Kopfzeile)
const hsQuery = () => (serverSettings.hsPass ? `?hs=${hsToken()}` : '');

// Die Gesamtliste 60 s merken: HereSphere fragt sie beim Zurückblättern oft erneut an
let hsIndexCache = { key: '', at: 0, data: null };
async function heresphereIndex(req) {
  const key = `${publicBase(req)}|${hsQuery()}|${hsVrOnly()}`;
  if (hsIndexCache.key === key && Date.now() - hsIndexCache.at < 60000) return hsIndexCache.data;
  const data = await heresphereIndexBuild(req);
  hsIndexCache = { key, at: Date.now(), data };
  return data;
}
async function heresphereIndexBuild(req) {
  const base = publicBase(req);
  const library = [];
  const q = hsQuery();
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
        const list = data.findScenes.scenes.filter((s) => !hsVrOnly() || (s.tags || []).some((t) => isVrTag(t.name)))
          .map((s) => `${base}/heresphere/stash/${s.id}${q}`);
        if (list.length) library.push({ name: l.name, list });
      } catch (e) {
        console.warn(`HereSphere: list “${l.name}” skipped: ${e.message}`);
      }
    }
  }
  const items = await libraryItems();
  const roots = new Map();
  for (const it of items) {
    if (hsVrOnly() && vrFormat(path.basename(it.video).replace(/\.[^.]+$/, '')).projection === 'perspective') continue; // kein VR
    const root = it.video.includes('/') ? it.video.split('/')[0] : 'Ordner';
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(`${base}/heresphere/media/${encPath(it.video)}${q}`);
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
  // „nur VR“: andere Szenen gibt es auch über ihre Nummer nicht
  if (hsVrOnly() && !s.tags.some((t) => isVrTag(t.name))) throw Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const q = hsQuery();
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
    thumbnailImage: `${base}/stash/scene/${id}/screenshot${q}`,
    thumbnailVideo: `${base}/stash/scene/${id}/preview${q}`,
    dateReleased: s.date || undefined,
    duration: ms(s.duration),
    ...vrFormat(s.basename || s.title, s.tags.map((t) => t.name)),
    scripts: s.interactive ? [{ name: `${s.title}.funscript`, url: `${base}/stash/scene/${id}/funscript${q}` }] : [],
    tags,
    media: [{
      name: 'Original',
      sources: [{ resolution: s.height, height: s.height, width: s.width, url: `${base}/stash/scene/${id}/stream${q}` }],
    }],
  };
}

// needsSource = false: HereSphere will nur Titel/Vorschau für die Liste -> kein ffprobe (schnelles Blättern)
async function heresphereMedia(req, rel, needsSource = true) {
  const base = publicBase(req);
  const file = safeJoin(MEDIA_DIR, rel);
  if (!file || !VIDEO_EXT.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) throw Object.assign(new Error('Datei nicht gefunden'), { status: 404 });
  const name = path.basename(rel).replace(/\.[^.]+$/, '');
  if (hsVrOnly() && vrFormat(name).projection === 'perspective') throw Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const q = hsQuery();
  const scriptRel = rel.replace(/\.[^.]+$/, '.funscript');
  const info = (await hqProbe('media:' + rel, { cachedOnly: !needsSource }).catch(() => null)) || { width: 0, height: 0, duration: 0 };
  return {
    ...hsCommon(),
    title: cleanTitle(path.basename(rel)),
    description: '',
    duration: Math.round((info.duration || 0) * 1000),
    ...vrFormat(name),
    scripts: fs.existsSync(safeJoin(MEDIA_DIR, scriptRel) || '') ? [{ name: path.basename(scriptRel), url: `${base}/media/${encPath(scriptRel)}${q}` }] : [],
    tags: rel.includes('/') ? [{ name: `Ordner:${rel.split('/')[0]}` }] : [],
    media: [{ name: 'Original', sources: [{ resolution: info.height, height: info.height, width: info.width, url: `${base}/media/${encPath(rel)}${q}` }] }],
  };
}

module.exports = { HS_HEADERS, publicBase, encPath, isVrTag, vrFormat, HS_IDS_QUERY, hsVrOnly, hsQuery, hsIndexCache, heresphereIndex, heresphereIndexBuild, hsCommon, heresphereStash, heresphereMedia };
