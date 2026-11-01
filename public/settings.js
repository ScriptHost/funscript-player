'use strict';

// ===========================================================================
// Einstellungen-Seite: HereSphere-Adresse, Bibliothek, System-Infos.
// (Bild & Qualität steuern enhance.js und hq.js, Geräte die rechte Spalte.)
// ===========================================================================

// --- Bildqualität: ein Schalter für alles ----------------------------------------
// „Automatisch“ = Browser-Verbesserung „Auto“ + HQ-Stream „Auto“, „Aus“ = beides aus.
function setQualityMode(mode) {
  enhSetPreset(mode);
  hqState.preset = mode;
  hqApply();
  renderQualityMode();
}

function renderQualityMode() {
  const mode = enh.settings.preset === 'auto' && hqState.preset === 'auto' ? 'auto'
    : enh.settings.preset === 'off' && hqState.preset === 'off' ? 'off' : 'custom';
  document.querySelectorAll('#qualityMode button').forEach((b) => b.classList.toggle('active', b.dataset.q === mode));
  $('qualityInfo').textContent = mode === 'custom'
    ? 'Eigene Einstellungen aktiv (siehe „Erweitert“). „Automatisch“ stellt wieder alles auf das beste Bild.'
    : mode === 'off' ? 'Original ohne jede Bearbeitung.' : QUALITY_AUTO_TEXT;
  if (mode === 'custom') $('qualityAdvanced').open = true;
}
const QUALITY_AUTO_TEXT = $('qualityInfo').textContent;
document.querySelectorAll('#qualityMode button').forEach((b) => b.addEventListener('click', () => setQualityMode(b.dataset.q)));
// Änderungen unter „Erweitert“ spiegeln
$('imageSettings').addEventListener('click', () => setTimeout(renderQualityMode, 50));
document.addEventListener('hq-ready', renderQualityMode);

// --- Anzeige im Player -----------------------------------------------------------
// Standard: was man beim normalen Schauen braucht; Tags, Studio/Darsteller, Beschreibung aus.
const HUD_DEFAULT = { devices: true, meta: true, script: false, actions: true, baractions: true, people: false, tags: false, markers: true, details: false, quality: true };
const hud = Object.assign({}, HUD_DEFAULT, store.get('hud', {}));
function applyHud() {
  for (const [k, on] of Object.entries(hud)) document.body.classList.toggle('hud-off-' + k, !on);
}
document.querySelectorAll('#hudOptions input').forEach((cb) => {
  cb.checked = hud[cb.dataset.hud];
  cb.addEventListener('change', () => { hud[cb.dataset.hud] = cb.checked; store.set('hud', hud); applyHud(); });
});
applyHud();

// --- Sprache (pro Gerät): Englisch / Deutsch – Standard nach Gerätesprache, Wechsel lädt neu ---------
$('langSel').value = I18N.lang;
$('langSel').addEventListener('change', () => { store.set('lang', $('langSel').value); location.reload(); });

// --- Demo-Modus (pro Gerät) ------------------------------------------------------------------
$('demoMode').checked = store.get('demoMode', false);
const applyDemo = () => document.body.classList.toggle('demo-mode', $('demoMode').checked);
$('demoMode').addEventListener('change', () => { store.set('demoMode', $('demoMode').checked); applyDemo(); });
applyDemo();

// --- Erweiterte Einstellungen (pro Gerät): standardmäßig nur das Nötige ------------------------
function setAdvMode(on) {
  document.body.classList.toggle('adv-on', on);
  $('advMode').checked = on;
  store.set('advMode', on);
  updateAdvHint();
}
// Hinweis, solange die erweiterten Einstellungen ausgeblendet sind (sie gelten trotzdem)
function updateAdvHint() {
  $('advHint').textContent = document.body.classList.contains('adv-on') ? ''
    : 'Ausgeblendet: Feinheiten zu Handy, Satisfyer, Bild, Finale, Anzeige – sie gelten trotzdem.';
}
$('advMode').addEventListener('change', () => setAdvMode($('advMode').checked));
setAdvMode(store.get('advMode', false));

// --- Sicherung: Server-Daten (Einstellungen, Patterns, eigene Scripts …) + Einstellungen dieses Geräts ----
$('backupGet').addEventListener('click', async () => {
  try {
    const data = await (await fetch('/api/backup')).json();
    data.local = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('hp.') && !isSharedPref(k.slice(3))) data.local[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `funscript-player-sicherung-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    log(`⬇ Sicherung erstellt (${Object.keys(data.scripts || {}).length} eigene Scripts).`);
  } catch (e) { log('Sicherung: ' + e.message, true); }
});
$('backupPut').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !confirm('Sicherung einspielen? Einstellungen, Patterns und eigene Scripts werden durch die aus der Datei ersetzt.')) return;
  try {
    const data = JSON.parse(await file.text());
    const res = await fetch('/api/backup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await res.text());
    for (const [k, v] of Object.entries(data.local || {})) if (k.startsWith('hp.')) localStorage.setItem(k, v);
    alert('Sicherung eingespielt – der Player lädt neu.');
    location.reload();
  } catch (err) { log('Sicherung einspielen: ' + err.message, true); }
});

// --- Selbsttest (lädt die Seite mit ?selbsttest neu) --------------------------------------------
$('selfTestRun').addEventListener('click', () => { location.href = location.pathname + '?selbsttest'; });

// --- Einmal nach dem Update auf 1.18: Hinweis auf geänderte Standards --------------------------
if (!store.get('seen118', false)) {
  $('whatsNew').hidden = false;
  const done = () => { $('whatsNew').hidden = true; store.set('seen118', true); };
  $('whatsNewOk').addEventListener('click', done);
  $('whatsNewSet').addEventListener('click', () => { done(); openSettings('setScript'); });
}

// --- Knöpfe in der Player-Leiste: ein-/ausblenden und Reihenfolge (−/+ bleibt vorn) ----------
const BAR_BTNS = [
  ['skip', '−/+ Sekunden springen', ['ovBack', 'ovFwd']],
  ['mute', '🔊 Ton an/aus', ['ovMute']],
  ['sync', '⟳ Handy neu synchronisieren', ['ovSync']],
  ['finale', '🔥 Finale', ['ovFinale']],
  ['vibe', 'Vib ❚❚ Geräte pausieren', ['ovVibe']],
  ['enh', '✨ Bild (Verbesserung an/aus)', ['ovEnh']],
  ['fit', 'Einpassen / Füllen (im Vollbild)', ['ovFit']],
  ['pip', '⧉ Bild-in-Bild', ['ovPip']],
];
const barCfg = Object.assign({ order: BAR_BTNS.map((b) => b[0]), off: [] }, store.get('barBtns', {}));
for (const [k] of BAR_BTNS) if (!barCfg.order.includes(k)) barCfg.order.push(k); // neue Knöpfe hinten
function applyBar() {
  for (const k of barCfg.order) {
    const def = BAR_BTNS.find((b) => b[0] === k);
    if (!def) continue;
    for (const id of def[2]) {
      $(id).classList.toggle('bar-off', barCfg.off.includes(k));
      if (k !== 'skip') $('ovFs').before($(id)); // Reihenfolge; ⛶ bleibt ganz rechts
    }
  }
}
function renderBarOptions() {
  const ul = $('barOptions');
  ul.replaceChildren();
  barCfg.order.forEach((k, i) => {
    const def = BAR_BTNS.find((b) => b[0] === k);
    if (!def) return;
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !barCfg.off.includes(k) });
    cb.addEventListener('change', () => {
      barCfg.off = cb.checked ? barCfg.off.filter((x) => x !== k) : [...barCfg.off, k];
      saveBar();
    });
    const label = Object.assign(document.createElement('label'), { className: 'check' });
    label.append(cb, ' ' + def[1]);
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= barCfg.order.length) return;
      [barCfg.order[i], barCfg.order[j]] = [barCfg.order[j], barCfg.order[i]];
      saveBar();
    };
    const up = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '↑', title: 'Weiter nach links' });
    const down = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '↓', title: 'Weiter nach rechts' });
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    up.disabled = k === 'skip' || i === 0 || barCfg.order[i - 1] === 'skip';
    down.disabled = k === 'skip' || i === barCfg.order.length - 1;
    const li = document.createElement('li');
    li.append(label, up, down);
    ul.append(li);
  });
}
function saveBar() { store.set('barBtns', barCfg); applyBar(); renderBarOptions(); }
applyBar();
renderBarOptions();

// --- Knöpfe der Bibliothek: vorhandene ein/aus, eigene Links (für alle Geräte) -----------------
const libLinks = Object.assign({ hide: [], custom: [] }, store.get('libLinks', {}));
function applyLibLinks() {
  document.querySelectorAll('[data-libbtn]').forEach((b) => b.classList.toggle('tab-off', libLinks.hide.includes(b.dataset.libbtn)));
  $('libCustomLinks').replaceChildren(...libLinks.custom.map((l) => Object.assign(document.createElement('a'), {
    className: 'small secondary btn', href: l.url, target: '_blank', rel: 'noopener noreferrer', textContent: l.name + ' ↗',
  })));
  $('libLinkList').replaceChildren(...libLinks.custom.map((l, i) => {
    const li = document.createElement('li');
    const del = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '✕', title: 'Entfernen' });
    del.addEventListener('click', () => { libLinks.custom.splice(i, 1); saveLibLinks(); });
    li.append(Object.assign(document.createElement('span'), { className: 'check', textContent: `${l.name} – ${l.url}` }), del);
    return li;
  }));
}
function saveLibLinks() { store.set('libLinks', libLinks); applyLibLinks(); }
document.querySelectorAll('#libBtnOptions input').forEach((cb) => {
  cb.checked = !libLinks.hide.includes(cb.dataset.libopt);
  cb.addEventListener('change', () => {
    libLinks.hide = cb.checked ? libLinks.hide.filter((x) => x !== cb.dataset.libopt) : [...libLinks.hide, cb.dataset.libopt];
    saveLibLinks();
  });
});
$('libLinkAdd').addEventListener('click', () => {
  const name = $('libLinkName').value.trim(), url = $('libLinkUrl').value.trim();
  if (!name || !/^https?:\/\//i.test(url)) return log('Bitte Name und eine Adresse mit https:// eingeben.', true);
  libLinks.custom.push({ name: name.slice(0, 30), url });
  $('libLinkName').value = $('libLinkUrl').value = '';
  saveLibLinks();
});
applyLibLinks();

// --- Reiter der Stash-Bibliothek (Tags / Darsteller / Studios) ------------------------------
const browseTabs = Object.assign({ tags: true, performers: true, studios: false }, store.get('browseTabs', {}));
function applyBrowseTabs() {
  document.querySelectorAll('#browseTabs button[data-browse]').forEach((b) => b.classList.toggle('tab-off', browseTabs[b.dataset.browse] === false));
  // Ausgeblendeter Reiter offen -> zurück zu den Szenen
  if (typeof lib !== 'undefined' && browseTabs[lib.browse] === false && typeof setBrowse === 'function') setBrowse('scenes');
}
document.querySelectorAll('#browseOptions input').forEach((cb) => {
  cb.checked = browseTabs[cb.dataset.browseOpt] !== false;
  cb.addEventListener('change', () => { browseTabs[cb.dataset.browseOpt] = cb.checked; store.set('browseTabs', browseTabs); applyBrowseTabs(); });
});
applyBrowseTabs();

// --- Gespeicherte Stash-Filter: welche in der Leiste erscheinen --------------------------------
function renderSavedFilterOptions() {
  const box = $('setSavedFilters');
  if (!lib.savedList?.length) return;
  const hidden = store.get('hiddenFilters', []);
  box.replaceChildren(...lib.savedList.map((f) => {
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !hidden.includes(f.id) });
    cb.addEventListener('change', () => {
      const now = store.get('hiddenFilters', []).filter((x) => x !== f.id);
      store.set('hiddenFilters', cb.checked ? now : [...now, f.id]);
      renderSavedFilters();
    });
    const label = Object.assign(document.createElement('label'), { className: 'check' });
    label.append(cb, ' ' + f.name);
    return label;
  }));
}

// --- Server-Einstellungen: HereSphere, Intiface --------------------------------------------
$('hsUrl').value = `${location.origin}/heresphere`;

// Gilt auf dem Server für alle Geräte (HERESPHERE=off / INTIFACE_LAN_ONLY in Docker sperren fest)
function showServerSettings(s) {
  $('hsOn').checked = s.heresphere;
  $('hsOn').disabled = !!s.heresphereLocked;
  $('hsBox').hidden = !s.heresphere;
  $('hsOffHint').hidden = s.heresphere;
  if (s.heresphereLocked) $('hsOffHint').textContent = 'Abgeschaltet über HERESPHERE=off in der docker-compose.yml.';
  $('hsVrOnly').checked = s.hsVrOnly !== false;
  $('hsPassClear').hidden = !s.hsPassword;
  $('hsPassInfo').textContent = s.hsPassword ? '🔒 Passwort gesetzt – HereSphere fragt beim ersten Öffnen danach.' : 'Kein Passwort – frei erreichbar.';
  $('intifaceLan').checked = !!s.intifaceLan;
  $('intifaceLan').disabled = !!s.intifaceLanLocked;
  $('intifaceLanHint').hidden = !s.intifaceLanLocked;
}
async function putSettings(patch, msg) {
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) throw new Error(await res.text());
    showServerSettings(await res.json());
    if (msg) log(msg);
  } catch (e) { log('Einstellung nicht gespeichert: ' + e.message, true); }
}
fetch('/api/settings').then((r) => r.json()).then(showServerSettings).catch(() => {});
$('hsOn').addEventListener('change', () => putSettings({ heresphere: $('hsOn').checked }, $('hsOn').checked ? 'HereSphere eingeschaltet.' : 'HereSphere abgeschaltet.'));
$('hsVrOnly').addEventListener('change', () => putSettings({ hsVrOnly: $('hsVrOnly').checked }, $('hsVrOnly').checked ? 'HereSphere: nur VR-Videos.' : 'HereSphere: alle Videos.'));
$('hsPassSave').addEventListener('click', () => {
  const pw = $('hsPass').value;
  if (!pw) return log('Bitte ein Passwort eingeben – oder „Entfernen“.', true);
  $('hsPass').value = '';
  putSettings({ hsPassword: pw }, 'HereSphere-Passwort gespeichert.');
});
$('hsPassClear').addEventListener('click', () => putSettings({ hsPassword: '' }, 'HereSphere-Passwort entfernt – frei erreichbar.'));
$('intifaceLan').addEventListener('change', () => putSettings({ intifaceLan: $('intifaceLan').checked }, $('intifaceLan').checked ? 'Intiface: nur Heimnetz-Adressen.' : 'Intiface: alle privaten Adressen.'));
$('hsCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('hsUrl').value);
    $('hsCopy').textContent = 'Kopiert ✓';
  } catch {
    $('hsUrl').select();
    $('hsCopy').textContent = 'Markiert – Strg+C';
  }
  setTimeout(() => { $('hsCopy').textContent = 'Kopieren'; }, 2000);
});

// --- Bibliothek --------------------------------------------------------------
$('setHoverPreview').checked = store.get('hoverPreview', true);
$('setHoverPreview').addEventListener('change', () => store.set('hoverPreview', $('setHoverPreview').checked));
$('setShowContinue').checked = store.get('showContinue', false);
$('setShowContinue').addEventListener('change', () => {
  store.set('showContinue', $('setShowContinue').checked);
  renderContinue();
});

function renderLibrarySettings() {
  const sel = $('setStartSource');
  sel.replaceChildren(...librarySources().map((s) => new Option(s.label.replace('📁 ', 'Ordner: '), s.id)));
  sel.value = store.get('libSource', sel.options[0]?.value || '');

  const ul = $('setFolders');
  ul.replaceChildren();
  const roots = folderRoots();
  if (!roots.length) {
    ul.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Keine Videos in /media gefunden.' }));
  }
  for (const r of roots) {
    const items = lib.folder.filter((it) => it.root === r);
    const withScript = items.filter((it) => it.script).length;
    const li = document.createElement('li');
    li.textContent = `📁 ${r ? '/media/' + r : '/media'} – ${items.length} Videos, ${withScript} mit Funscript`;
    ul.append(li);
  }
}
$('setStartSource').addEventListener('change', () => setSource($('setStartSource').value));
document.addEventListener('library-ready', renderLibrarySettings);
document.addEventListener('hq-ready', () => { if (!$('view-settings').hidden) renderSysInfo(); });

// --- System ------------------------------------------------------------------
async function renderSysInfo() {
  const dl = $('sysInfo');
  const rows = [];
  const add = (k, v) => rows.push([k, v]);
  try { add('Version', 'v' + (await (await fetch('/api/version')).json()).version); } catch { add('Version', '?'); }
  const st = lib.stashStatus || {};
  add('Stash', !st.configured ? 'nicht eingerichtet' : st.ok ? `verbunden (${st.version || 'ok'})` : `Fehler: ${st.error}`);
  add('HQ-Stream', !hqState.checked ? 'wird geprüft …'
    : hqState.available ? (HQ_ACCEL_LABEL[hqState.accel] || hqState.accel) : 'nicht verfügbar (kein ffmpeg)');
  add('Bildverbesserung', enh.ok ? 'WebGL verfügbar' : 'nicht verfügbar');
  add('Bluetooth', (await bluetoothProblem()) || 'verfügbar');
  add('HereSphere', `${location.origin}/heresphere`);
  dl.replaceChildren(...rows.flatMap(([k, v]) => [
    Object.assign(document.createElement('dt'), { textContent: k }),
    Object.assign(document.createElement('dd'), { textContent: v }),
  ]));
}

$('resetLocal').addEventListener('click', () => {
  if (!confirm('Alle Einstellungen auf diesem Gerät zurücksetzen (Connection Key, Bild, Satisfyer, Ansicht)?\nPatterns und Scripts auf dem Server bleiben erhalten.')) return;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('hp.')).forEach((k) => localStorage.removeItem(k));
  } catch { /* egal */ }
  location.reload();
});

// Infos frisch laden, sobald die Seite geöffnet wird
new MutationObserver(() => {
  if (!$('view-settings').hidden) { renderSysInfo(); renderLibrarySettings(); renderSavedFilterOptions(); updateAdvHint(); }
}).observe($('view-settings'), { attributes: true, attributeFilter: ['hidden'] });
