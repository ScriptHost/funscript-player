'use strict';

// ===========================================================================
// Bibliothek: Stash (Szenen, Tags, Darsteller, Studios) und lokaler Ordner.
// Kachelraster mit endlosem Scrollen, Filter als Chips, Szenen-Infos im Player.
// ===========================================================================

const lib = {
  source: 'folder',          // 'stash' | 'folder'
  browse: 'scenes',          // 'scenes' | 'tags' | 'performers' | 'studios'
  filters: { tags: [], performers: [], studios: [] },
  items: [], count: 0, page: 0, loading: false, seed: 1, token: 0, error: '',
  facets: null,              // { tags, performers, studios } aus Stash
  facetShown: 0,
  folder: [],                // Videos aus dem Bibliotheksordner
  stashOk: false,
  saved: '',                 // ID des gewählten gespeicherten Stash-Filters
  savedList: [],
};

const fmtDuration = (s) => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const mediaUrl = (rel) => '/media/' + rel.split('/').map(encodeURIComponent).join('/');
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
};
// „nur mit Funscript“ gilt nur im Sync-Modus – beim Streamen werden immer alle Videos gezeigt
const onlyScripts = () => appMode !== 'stream' && $('onlyScripts').checked;
const KIND_LABEL = { tags: 'Tag', performers: 'Darsteller', studios: 'Studio' };
const KIND_PATH = { tags: 'tag', performers: 'performer', studios: 'studio' };

// ---------------------------------------------------------------------------
// Quelle, Ansicht und Filter
// ---------------------------------------------------------------------------
// Quellen: „stash“ und je eingebundenem Ordner „folder:<Name>“ (Unterordner von /media)
function folderRoots() {
  const roots = [...new Set(lib.folder.map((it) => it.root))];
  return roots.sort((a, b) => a.localeCompare(b, 'de'));
}
const rootLabel = (root) => root || 'Ordner';

function librarySources() {
  const list = lib.stashOk ? [{ id: 'stash', label: 'Stash' }] : [];
  for (const r of folderRoots()) list.push({ id: 'folder:' + r, label: '📁 ' + rootLabel(r) });
  if (!list.length) list.push({ id: 'folder:', label: '📁 Ordner' });
  return list;
}

function renderSources() {
  const seg = $('libSource');
  const list = librarySources();
  seg.hidden = list.length < 2;
  seg.replaceChildren(...list.map((s) => {
    const b = el('button', { className: s.id === lib.source ? 'active' : '' }, s.label);
    b.addEventListener('click', () => setSource(s.id));
    return b;
  }));
}

function setSource(src) {
  if (!librarySources().some((s) => s.id === src)) src = librarySources()[0].id;
  lib.source = src;
  store.set('libSource', src);
  renderSources();
  const stash = src === 'stash';
  $('browseTabs').hidden = !stash;
  $('stashSort').hidden = !stash;
  $('stashRandom').hidden = !stash;
  renderSavedFilters();
  setBrowse(stash ? lib.browse : 'scenes');
}

function setBrowse(browse) {
  lib.browse = browse;
  document.querySelectorAll('#browseTabs button').forEach((b) => b.classList.toggle('active', b.dataset.browse === browse));
  $('sceneGrid').hidden = browse !== 'scenes';
  $('facetGrid').hidden = browse === 'scenes';
  $('search').placeholder = browse === 'scenes' ? 'Szenen, Titel, Dateien suchen …' : `${KIND_LABEL[browse]} suchen …`;
  refresh();
}

function refresh() {
  renderFilterChips();
  renderContinue();
  if (lib.browse !== 'scenes') return renderFacets(true);
  if (lib.source === 'stash') fetchScenes(true);
  else renderFolder();
}

function addFilter(kind, item) {
  if (!lib.filters[kind].some((x) => x.id === item.id)) lib.filters[kind].push({ id: item.id, name: item.name });
  $('search').value = '';
  if (lib.source !== 'stash') setSource('stash');
  setBrowse('scenes');
}

function removeFilter(kind, id) {
  lib.filters[kind] = lib.filters[kind].filter((x) => x.id !== id);
  refresh();
}

function renderFilterChips() {
  const box = $('activeFilters');
  box.replaceChildren();
  const all = Object.entries(lib.filters).flatMap(([kind, list]) => list.map((f) => ({ kind, ...f })));
  for (const f of all) {
    const chip = el('button', { className: 'chip active', title: 'Filter entfernen' }, `${KIND_LABEL[f.kind]}: ${f.name} ✕`);
    chip.addEventListener('click', () => removeFilter(f.kind, f.id));
    box.append(chip);
  }
  if (all.length > 1) {
    const clear = el('button', { className: 'chip' }, 'Alle Filter löschen');
    clear.addEventListener('click', () => { lib.filters = { tags: [], performers: [], studios: [] }; refresh(); });
    box.append(clear);
  }
}

// ---------------------------------------------------------------------------
// Stash-Szenen (seitenweise, endloses Scrollen)
// ---------------------------------------------------------------------------
function stashParams(extra = {}) {
  return new URLSearchParams({
    q: lib.browse === 'scenes' ? $('search').value.trim() : '',
    sort: $('stashSort').value,
    seed: lib.seed,
    interactive: onlyScripts() ? '1' : '0',
    tag: lib.filters.tags.map((x) => x.id).join(','),
    performer: lib.filters.performers.map((x) => x.id).join(','),
    studio: lib.filters.studios.map((x) => x.id).join(','),
    saved: lib.saved,
    per_page: 40,
    ...extra,
  });
}

async function fetchScenes(reset) {
  if (reset) {
    lib.items = [];
    lib.page = 0;
    lib.count = 0;
    lib.seed = Math.floor(Math.random() * 1e8);
    $('sceneGrid').replaceChildren();
  }
  const token = ++lib.token;
  lib.loading = true;
  updateLibInfo();
  try {
    const res = await fetch('/api/stash/scenes?' + stashParams({ page: lib.page + 1 }));
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (token !== lib.token) return;
    lib.error = '';
    lib.ignored = data.ignored || [];
    lib.items.push(...data.scenes);
    lib.count = data.count;
    lib.page++;
    data.scenes.forEach((s) => $('sceneGrid').append(sceneCard(s)));
  } catch (e) {
    if (token === lib.token) {
      lib.error = e.message || String(e);
      log(lib.error, true);
    }
  } finally {
    if (token === lib.token) {
      lib.loading = false;
      updateLibInfo();
      checkSentinel();
    }
  }
}

function updateLibInfo() {
  let text = '';
  if (lib.browse === 'scenes' && lib.source === 'stash') {
    text = lib.loading && !lib.items.length ? 'Lade …'
      : lib.error && !lib.items.length ? lib.error
        : lib.count ? `${lib.count} Szenen` : 'Keine Szenen gefunden';
    if (lib.ignored?.length) text += ` · Filterbedingung ignoriert (von Stash nicht unterstützt): ${lib.ignored.join(', ')}`;
  }
  $('libInfo').textContent = text;
}

function sceneCard(s) {
  const img = el('img', { src: `/stash/scene/${s.id}/screenshot`, loading: 'lazy', alt: '' });
  const thumb = el('div', { className: 'thumb' }, img,
    s.duration ? el('span', { className: 'dur' }, fmtDuration(s.duration)) : null,
    s.interactive ? el('span', { className: 'badge', title: 'Mit Funscript' }, '⚡') : null);
  const sub = [s.studio?.name, s.date, s.performers?.slice(0, 2).map((p) => p.name).join(', ')].filter(Boolean).join(' · ');
  const card = el('div', { className: 'tile', tabIndex: 0 }, thumb, el('div', { className: 'tile-title' }, s.title), el('div', { className: 'tile-sub' }, sub));
  card.addEventListener('click', () => openStashScene(s));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openStashScene(s); });
  // Vorschauvideo beim Drüberfahren mit der Maus
  card.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || !store.get('hoverPreview', true)) return;
    const pv = el('video', { src: `/stash/scene/${s.id}/preview`, muted: true, loop: true, autoplay: true, playsInline: true, className: 'preview' });
    pv.addEventListener('error', () => pv.remove());
    thumb.append(pv);
  });
  card.addEventListener('pointerleave', () => thumb.querySelector('video.preview')?.remove());
  return card;
}

// „Weiterschauen“: angefangene Stash-Szenen, nur in der ungefilterten Startansicht
async function renderContinue() {
  const box = $('continueRow');
  const plain = store.get('showContinue', false) // in den Einstellungen einschaltbar, standardmäßig aus
    && lib.source === 'stash' && lib.browse === 'scenes' && !lib.saved && !$('search').value.trim()
    && !Object.values(lib.filters).some((l) => l.length);
  if (!plain || !lib.stashStatus?.ok) { box.hidden = true; return; }
  try {
    const res = await fetch('/api/stash/scenes?' + new URLSearchParams({ continue: '1', per_page: 12, page: 1 }));
    if (!res.ok) throw new Error();
    const { scenes } = await res.json();
    box.hidden = !scenes.length;
    box.querySelector('.continue-list').replaceChildren(...scenes.map(sceneCard));
  } catch { box.hidden = true; }
}

// ---------------------------------------------------------------------------
// Gespeicherte Filter aus Stash (z. B. „2D“, „VR Script“) als Leiste
// ---------------------------------------------------------------------------
async function loadSavedFilters() {
  try {
    const res = await fetch('/api/stash/saved-filters');
    if (!res.ok) return;
    lib.savedList = await res.json();
  } catch { return; }
  if (!lib.savedList.some((f) => f.id === lib.saved)) lib.saved = '';
  renderSavedFilters();
}

function renderSavedFilters() {
  const bar = $('savedFilters');
  bar.hidden = !lib.savedList.length || lib.source !== 'stash';
  bar.replaceChildren(el('span', { className: 'label' }, 'Filter:'));
  for (const f of [{ id: '', name: 'Alle' }, ...lib.savedList]) {
    const b = el('button', { className: f.id === lib.saved ? 'active' : '' }, f.name);
    b.addEventListener('click', () => selectSavedFilter(f.id));
    bar.append(b);
  }
}

function selectSavedFilter(id) {
  lib.saved = id;
  store.set('savedFilter', id);
  // Die Stash-Filter regeln selbst, ob mit Script („2D“ vs. „2D Script“)
  if (id && $('onlyScripts').checked) {
    $('onlyScripts').checked = false;
    store.set('onlyScripts', false);
  }
  // Mit Filter: dessen Sortierung aus Stash übernehmen; ohne: wieder „Neueste“
  $('stashSort').value = id ? 'saved' : (store.get('stashSort', 'new') === 'saved' ? 'new' : store.get('stashSort', 'new'));
  renderSavedFilters();
  if (lib.browse !== 'scenes') setBrowse('scenes'); else refresh();
}

// ---------------------------------------------------------------------------
// Tags / Darsteller / Studios
// ---------------------------------------------------------------------------
async function loadFacets() {
  if (lib.facets) return lib.facets;
  const res = await fetch('/api/stash/filters');
  if (!res.ok) throw new Error(await res.text());
  lib.facets = await res.json();
  return lib.facets;
}

async function renderFacets(reset) {
  const grid = $('facetGrid');
  const kind = lib.browse;
  if (reset) {
    grid.replaceChildren();
    lib.facetShown = 0;
    $('libInfo').textContent = 'Lade …';
  }
  let facets;
  try {
    facets = await loadFacets();
  } catch (e) {
    $('libInfo').textContent = e.message;
    return;
  }
  if (kind !== lib.browse) return;
  const q = $('search').value.trim().toLowerCase();
  const list = facets[kind].filter((x) => !q || x.name.toLowerCase().includes(q));
  $('libInfo').textContent = `${list.length} ${KIND_LABEL[kind] === 'Tag' ? 'Tags' : KIND_LABEL[kind] === 'Studio' ? 'Studios' : 'Darsteller'}`;
  const next = list.slice(lib.facetShown, lib.facetShown + 120);
  for (const item of next) {
    const img = el('img', { src: `/stash/${KIND_PATH[kind]}/${item.id}/image`, loading: 'lazy', alt: '' });
    img.addEventListener('error', () => img.replaceWith(el('div', { className: 'noimg' }, item.name.slice(0, 1).toUpperCase())));
    const tile = el('div', { className: `tile facet ${kind}`, tabIndex: 0 },
      el('div', { className: 'thumb' }, img),
      el('div', { className: 'tile-title' }, item.name),
      el('div', { className: 'tile-sub' }, `${item.count} Szenen`));
    tile.addEventListener('click', () => addFilter(kind, item));
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFilter(kind, item); });
    grid.append(tile);
  }
  lib.facetShown += next.length;
  lib.facetTotal = list.length;
}

// Endloses Scrollen: kommt das Ende der Liste in Sicht, wird nachgeladen
function checkSentinel() {
  const r = $('libSentinel').getBoundingClientRect();
  if (r.top > window.innerHeight + 600 || $('view-library').hidden) return;
  if (lib.browse === 'scenes') {
    if (lib.source === 'stash' && !lib.loading && lib.items.length < lib.count) fetchScenes(false);
  } else if (lib.facetShown < (lib.facetTotal || 0)) {
    renderFacets(false);
  }
}
new IntersectionObserver(checkSentinel, { rootMargin: '600px' }).observe($('libSentinel'));

// ---------------------------------------------------------------------------
// Lokaler Bibliotheksordner
// ---------------------------------------------------------------------------
async function loadFolder() {
  try {
    lib.folder = await (await fetch('/api/library')).json();
  } catch {
    lib.folder = [];
  }
}

function renderFolder() {
  const grid = $('sceneGrid');
  grid.replaceChildren();
  const root = lib.source.startsWith('folder:') ? lib.source.slice(7) : '';
  const q = $('search').value.trim().toLowerCase();
  const items = lib.folder
    .filter((it) => it.root === root && (!onlyScripts() || it.script) && (!q || it.video.toLowerCase().includes(q)))
    .sort((a, b) => b.mtime - a.mtime); // neueste zuerst
  const total = lib.folder.filter((it) => it.root === root).length;
  $('libInfo').textContent = total
    ? `${items.length} Videos in „${rootLabel(root)}“${items.length < total ? ` (${total - items.length} ohne Funscript ausgeblendet)` : ''}`
    : 'Ordner ist leer – Videos mit gleichnamiger .funscript hineinlegen oder „📂 Datei“ nutzen.';
  const weekAgo = Date.now() - 7 * 864e5;
  for (const it of items) {
    const thumb = el('div', { className: 'thumb' }, el('div', { className: 'noimg' }, '🎬'),
      it.script ? el('span', { className: 'badge' }, '⚡') : null,
      it.mtime > weekAgo ? el('span', { className: 'new' }, 'Neu') : null);
    const sub = [it.folder.split('/').slice(1).join('/'), it.mtime ? new Date(it.mtime).toLocaleDateString('de-DE') : ''].filter(Boolean).join(' · ');
    const tile = el('div', { className: 'tile', tabIndex: 0 }, thumb, el('div', { className: 'tile-title' }, it.name), el('div', { className: 'tile-sub' }, sub));
    tile.addEventListener('click', () => openFolderItem(it));
    grid.append(tile);
  }
}

async function openFolderItem(it) {
  openPlayer();
  loadVideo(mediaUrl(it.video), it.name, 'media:' + it.video);
  $('sceneMeta').textContent = it.folder ? `Ordner: ${it.folder}` : 'Bibliotheksordner';
  if (!it.script) return clearScript();
  try {
    const res = await fetch(mediaUrl(it.script));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadScript(await res.text(), it.script.split('/').pop());
  } catch (e) {
    log('Script konnte nicht geladen werden: ' + e.message, true);
  }
}

// ---------------------------------------------------------------------------
// Stash-Szene öffnen + Infos im Player
// ---------------------------------------------------------------------------
async function openStashScene(s) {
  openPlayer();
  loadVideo(`/stash/scene/${s.id}/stream`, s.title, 'stash:' + s.id);
  const session = { id: s.id, markers: [], resume: 0, played: 0, lastSave: Date.now(), counted: false };
  stashSession = session;

  fetch(`/api/stash/scene/${s.id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || stashSession !== session) return;
      session.markers = d.markers;
      loadSprites(session);
      session.resume = d.resume;
      showSceneInfo(d);
      drawHeatmap();
      resumeIfWanted(session);
    })
    .catch(() => {});

  if (s.interactive === false) return clearScript();
  try {
    const res = await fetch(`/stash/scene/${s.id}/funscript`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadScript(await res.text(), 'Funscript');
  } catch (e) {
    clearScript();
    if (s.interactive) log('Funscript konnte nicht geladen werden: ' + e.message, true);
  }
}

// --- Zurückschreiben in Stash: Sterne, Favorit, O-Zähler, Marker ---------------
async function stashAction(action, body) {
  if (!stashSession) return null;
  try {
    const res = await fetch(`/api/stash/scene/${stashSession.id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (e) {
    log('Stash: ' + (e.message || e), true);
    return null;
  }
}

function showActions(d) {
  $('sceneActions').hidden = false;
  const stars = Math.round((d.rating100 || 0) / 20);
  document.querySelectorAll('#stars button').forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= stars));
  $('favBtn').classList.toggle('active', !!d.favorite);
  $('favBtn').textContent = d.favorite ? '♥ Favorit' : '♡ Favorit';
  $('oCount').textContent = d.oCounter || 0;
  stashSession.info = d;
}

document.querySelectorAll('#stars button').forEach((b) => b.addEventListener('click', async () => {
  const info = stashSession?.info;
  if (!info) return;
  const stars = Number(b.dataset.star);
  // Gleichen Stern nochmal = Bewertung entfernen
  const rating100 = Math.round((info.rating100 || 0) / 20) === stars ? 0 : stars * 20;
  const r = await stashAction('rating', { rating100 });
  if (r) { showActions({ ...info, rating100: r.rating100 }); log(rating100 ? `Bewertung: ${stars} ★` : 'Bewertung entfernt.'); }
}));
$('favBtn').addEventListener('click', async () => {
  const info = stashSession?.info;
  if (!info) return;
  const r = await stashAction('favorite', { favorite: !info.favorite });
  if (r) { showActions({ ...info, favorite: r.favorite }); log(r.favorite ? 'Als Favorit markiert.' : 'Favorit entfernt.'); }
});
$('oBtn').addEventListener('click', async () => {
  const info = stashSession?.info;
  if (!info) return;
  const r = await stashAction('o');
  if (r) { showActions({ ...info, oCounter: r.oCounter }); log(`O-Zähler: ${r.oCounter}`); }
});
$('oUndo').addEventListener('click', async () => {
  const info = stashSession?.info;
  if (!info || !info.oCounter) return;
  const r = await stashAction('o-undo');
  if (r) { showActions({ ...info, oCounter: r.oCounter }); log(`O-Zähler: ${r.oCounter}`); }
});

// Marker an der aktuellen Stelle (Taste P); erscheint sofort in Zeitleiste und Liste
async function setMarkerHere() {
  if (!stashSession?.info) return;
  const at = mediaTime();
  const title = `${MARKER_TITLE} ${fmtDuration(at) || '0:00'}`;
  const r = await stashAction('marker', { seconds: at, title });
  if (!r) return;
  stashSession.markers = [...stashSession.markers, { seconds: at, title }].sort((a, b) => a.seconds - b.seconds);
  showSceneInfo({ ...stashSession.info, markers: stashSession.markers });
  drawHeatmap();
  log(`📍 Marker bei ${fmtDuration(at) || '0:00'} in Stash gespeichert.`);
}
const MARKER_TITLE = 'Lieblingsstelle';
$('markBtn').addEventListener('click', setMarkerHere);
document.addEventListener('keydown', (e) => {
  if (e.key === 'p' && document.body.dataset.view === 'player' && !e.target.closest('input, select, textarea')) setMarkerHere();
});

function showSceneInfo(d) {
  showActions(d);
  $('videoName').textContent = $('ovTitle').textContent = d.title;
  $('sceneMeta').textContent = [d.date, fmtDuration(d.duration), d.playCount ? `${d.playCount}× gesehen` : ''].filter(Boolean).join(' · ');
  $('sceneDetails').textContent = d.details || '';

  // Darsteller und Studio: Klick zeigt alle Szenen damit
  const people = $('scenePeople');
  people.replaceChildren();
  const link = (kind, item, icon) => {
    const b = el('button', { className: 'chip ' + kind }, `${icon} ${item.name}`);
    b.addEventListener('click', () => { lib.filters = { tags: [], performers: [], studios: [] }; addFilter(kind, item); backToLibrary(); });
    return b;
  };
  if (d.studio) people.append(link('studios', d.studio, '🏢'));
  d.performers.forEach((p) => people.append(link('performers', p, '👤')));

  const tags = $('sceneTags');
  tags.replaceChildren();
  d.tags.forEach((t) => tags.append(link('tags', t, '#')));

  // Marker als Sprungliste
  const markers = $('sceneMarkers');
  markers.replaceChildren();
  d.markers.forEach((m) => {
    const b = el('button', { className: 'marker' }, el('span', { className: 'mtime' }, fmtDuration(m.seconds) || '0:00'), m.title);
    b.addEventListener('click', () => { seekTo(m.seconds); video.play().catch(() => {}); });
    markers.append(b);
  });
}

// Kann der Browser das Originalformat nicht abspielen (z. B. MKV/HEVC), wandelt Stash um.
video.addEventListener('error', () => {
  const m = /\/stash\/scene\/(\d+)\/stream$/.exec(new URL(video.src, location.href).pathname);
  if (!m) return;
  log('Format nicht direkt abspielbar – Stash wandelt um (Spulen kann langsamer sein).');
  video.src = `/stash/scene/${m[1]}/stream.mp4`;
  video.play().catch(() => {});
});

// --- Vorschaubilder fürs Spulen (Sprites, die Stash beim Generieren erzeugt) ---
// Die VTT-Datei sagt, welcher Bildausschnitt im Sprite zu welcher Zeit gehört.
async function loadSprites(session) {
  try {
    const res = await fetch(`/stash/scene/${session.id}/vtt/thumbs`);
    if (!res.ok) return;
    const cues = [];
    const toSec = (t) => t.split(':').reduce((s, v) => s * 60 + Number(v), 0);
    const lines = (await res.text()).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /([\d:.]+)\s*-->\s*([\d:.]+)/.exec(lines[i]);
      const xy = m && /#xywh=(\d+),(\d+),(\d+),(\d+)/.exec(lines[i + 1] || '');
      if (xy) cues.push({ start: toSec(m[1]), end: toSec(m[2]), x: +xy[1], y: +xy[2], w: +xy[3], h: +xy[4] });
    }

    if (cues.length && stashSession === session) {
      session.sprites = { url: `/stash/scene/${session.id}/vtt/sprite`, cues };
      new Image().src = session.sprites.url; // vorladen
    }
  } catch { /* ohne Vorschaubilder */ }
}

// --- Weiterschauen + Play-Count an Stash -------------------------------------
function resumeIfWanted(session) {
  const apply = () => {
    const dur = duration() / 1000;
    if (session.resume > 10 && (!dur || session.resume < dur - 30) && mediaTime() < 1) {
      seekTo(session.resume);
      log(`Weiter bei ${fmtDuration(session.resume)} (zuletzt gesehen).`);
    }
  };
  if (video.readyState >= 1) apply(); else video.addEventListener('loadedmetadata', apply, { once: true });
}

let lastTick = null;
video.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (stashSession && !video.paused && lastTick !== null) stashSession.played += Math.min(1, (now - lastTick) / 1000);
  lastTick = video.paused ? null : now;
  if (stashSession && Date.now() - stashSession.lastSave > 15000) saveStashActivity();
});
video.addEventListener('playing', () => {
  if (!stashSession || stashSession.counted) return;
  stashSession.counted = true;
  fetch(`/api/stash/scene/${stashSession.id}/play`, { method: 'POST' }).catch(() => {});
});
video.addEventListener('pause', () => { lastTick = null; saveStashActivity(); });
window.addEventListener('pagehide', () => saveStashActivity(true));

function saveStashActivity(beacon = false) {
  const s = stashSession;
  if (!s || !mediaTime()) return;
  const body = JSON.stringify({ resume: mediaTime(), played: s.played });
  s.played = 0;
  s.lastSave = Date.now();
  const url = `/api/stash/scene/${s.id}/activity`;
  if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  else fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Bedienelemente
// ---------------------------------------------------------------------------
document.querySelectorAll('#browseTabs button').forEach((b) => b.addEventListener('click', () => { $('search').value = ''; setBrowse(b.dataset.browse); }));
$('stashSort').addEventListener('change', () => { store.set('stashSort', $('stashSort').value); refresh(); });
$('onlyScripts').addEventListener('change', () => { store.set('onlyScripts', $('onlyScripts').checked); refresh(); });

let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => (lib.browse === 'scenes' ? refresh() : renderFacets(true)), 300);
});

// Zufällige Szene mit den aktuellen Filtern sofort abspielen
$('stashRandom').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/stash/scenes?' + stashParams({ sort: 'random', seed: Math.floor(Math.random() * 1e8), per_page: 1, page: 1 }));
    if (!res.ok) throw new Error(await res.text());
    const { scenes } = await res.json();
    if (!scenes.length) return log('Keine passende Szene gefunden.', true);
    await openStashScene(scenes[0]);
    video.play().catch(() => {});
  } catch (e) {
    log(e.message || e, true);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  $('stashSort').value = store.get('stashSort', 'new');
  $('onlyScripts').checked = store.get('onlyScripts', true);
  await loadFolder();
  let status = { configured: false };
  try { status = await (await fetch('/api/stash/status')).json(); } catch { /* ohne Stash */ }
  lib.stashOk = status.configured;
  lib.stashStatus = status;
  if (status.configured) {
    if (!status.ok) {
      log(status.error, true);
      lib.error = status.error;
    }
    // Zuletzt gewählter gespeicherter Filter (wie „Als Voreinstellung“ in Stash)
    lib.saved = store.get('savedFilter', '');
    if (status.ok) await loadSavedFilters();
    if (lib.saved) $('stashSort').value = 'saved';
    setSource(store.get('libSource', 'stash'));
  } else {
    setSource(store.get('libSource', ''));
  }
  document.dispatchEvent(new Event('library-ready'));

  // Direktlink: …/?stash=123 öffnet die Szene sofort
  const id = new URLSearchParams(location.search).get('stash');
  if (status.configured && /^\d+$/.test(id || '')) openStashScene({ id, title: `Stash-Szene ${id}`, interactive: null });
})();
