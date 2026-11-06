
import { modulesReady } from './state.js';
import { lang, setLang, t } from './lang.js';
import { $, freshInstall, log, store } from './handy.js';
import { openDevices, openSettings } from './app.js';
import { folderRoots, lib, librarySources, renderSavedFilters, setBrowse, setSource } from './library.js';
import { bluetoothProblem } from './vibe.js';
import { enh, enhSetPreset } from './enhance.js';
import { HQ_ACCEL_LABEL, hqApply, hqState } from './hq.js';
import { SCRIPT_PRESETS, clearToolCache, processScript } from './tools.js';

// ===========================================================================
// Einstellungen-Seite: HereSphere-Adresse, Bibliothek, System-Infos.
// (Bild & Qualität steuern enhance.js und hq.js, Geräte die rechte Spalte.)
// ===========================================================================

// --- Bildqualität: ein Schalter für alles ----------------------------------------
// „Automatisch“ = Browser-Verbesserung „Auto“ + HQ-Stream „Auto“, „Aus“ = beides aus.
export function setQualityMode(mode) {
  enhSetPreset(mode);
  hqState.preset = mode;
  hqApply();
  renderQualityMode();
}

function renderQualityMode() {
  const mode = enh.settings.preset === 'auto' && hqState.preset === 'auto' ? 'auto'
    : enh.settings.preset === 'off' && hqState.preset === 'off' ? 'off' : 'custom';
  document.querySelectorAll('#qualityMode button').forEach((b) => b.classList.toggle('active', b.dataset.q === mode));
  $('qualityInfo').textContent = mode === 'custom' ? t('settings.img.infoCustom')
    : mode === 'off' ? t('settings.img.infoOff') : t('settings.img.infoAuto');
  if (mode === 'custom') $('qualityAdvanced').open = true;
}

// --- Anzeige im Player -----------------------------------------------------------
// Standard: was man beim normalen Schauen braucht; Tags, Studio/Darsteller, Beschreibung aus.
// 1.19.7: Stash-Aktionen (unter dem Video und in der Leiste) standardmäßig aus – gespeicherte Wahl bleibt
// 1.19.8: auch „Datum, Länge, Aufrufe“ standardmäßig aus
const HUD_DEFAULT = { devices: true, meta: false, script: false, actions: false, baractions: false, people: false, tags: false, markers: true, details: false, quality: true };
let hud;
function applyHud() {
  for (const [k, on] of Object.entries(hud)) document.body.classList.toggle('hud-off-' + k, !on);
}

// --- Erweiterte Einstellungen (pro Gerät): standardmäßig nur das Nötige ------------------------
export function setAdvMode(on) {
  document.body.classList.toggle('adv-on', on);
  $('advMode').checked = on;
  store.set('advMode', on);
  updateAdvHint();
}
// Hinweis, solange die erweiterten Einstellungen ausgeblendet sind (sie gelten trotzdem)
function updateAdvHint() {
  $('advHint').textContent = document.body.classList.contains('adv-on') ? '' : t('settings.advHint');
}

// --- 1.19.7: Willkommen beim ersten Start (Neuinstallation), in ⚙️ → Anzeige wieder aufrufbar ------------
function showWelcome(on = true) { $('welcome').hidden = !on; if (on) $('whatsNew').hidden = true; }

// --- 1.19.8: Als App installieren und „ganze App im Vollbild“ (wie installiert, nur im Browser) ----------
const isInstalledApp = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
let installPrompt = null;
function renderInstall() {
  for (const id of ['installApp', 'welcomeInstall']) $(id).hidden = isInstalledApp();
  $('appFsRow').hidden = isInstalledApp();
}
async function installApp() {
  if (installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') log(t('settings.funscriptPlayerIsBeing'));
    return;
  }
  // Kein Angebot vom Browser: Weg von Hand zeigen
  log(/iPhone|iPad|iPod/.test(navigator.userAgent) ? t('settings.iphoneIpadInSafari')
    : !window.isSecureContext ? t('settings.installingOnlyWorksOver')
      : t('settings.inTheBrowserMenu'));
}

function enterAppFs() {
  if (isInstalledApp() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

// --- Knöpfe in der Player-Leiste: ein-/ausblenden und Reihenfolge (−/+ bleibt vorn) ----------
const BAR_BTNS = [
  ['mute', t('settings.soundOnOff'), ['ovMute']],
  ['finale', '🔥 Finale', ['ovFinale']],
  ['vibe', t('settings.vibPauseDevices'), ['ovVibe']],
  ['fit', t('settings.fitFillFullscreenOn'), ['ovFit']],
  ['pip', t('settings.pictureInPicture'), ['ovPip']],
];
let barCfg; // neue Knöpfe hinten
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
    const up = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '↑', title: t('settings.moveLeft') });
    const down = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '↓', title: t('settings.moveRight') });
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

// --- Reiter der Stash-Bibliothek (Tags / Darsteller / Studios) ------------------------------
let browseTabs;
function applyBrowseTabs() {
  document.querySelectorAll('#browseTabs button[data-browse]').forEach((b) => b.classList.toggle('tab-off', browseTabs[b.dataset.browse] === false));
  // Ausgeblendeter Reiter offen -> zurück zu den Szenen
  if (modulesReady.has('library') && browseTabs[lib.browse] === false && modulesReady.has('library')) setBrowse('scenes');
}

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

// Gilt auf dem Server für alle Geräte (HERESPHERE=off / INTIFACE_LAN_ONLY in Docker sperren fest)
let hsHasPass = false;
function showServerSettings(s) {
  $('hsOn').checked = s.heresphere;
  $('hsOn').disabled = !!s.heresphereLocked;
  $('hsBox').hidden = !s.heresphere;
  $('hsOffHint').hidden = s.heresphere;
  $('hsOffHint').textContent = s.heresphereLocked ? t('settings.vr.locked') : t('settings.vr.offHint');
  $('hsRedirect').checked = s.hsRedirect !== false;
  $('hsVrOnly').checked = s.hsVrOnly !== false;
  hsHasPass = !!s.hsPassword;
  renderPassMode(hsHasPass);
  $('hsPassInfo').textContent = s.hsPassword ? t('settings.vr.passSet') : t('settings.vr.passNone');
  // Anmeldung im Player an: HereSphere kommt nur mit eigenem Passwort hinein (es kann keine Browser-Anmeldung)
  $('hsLoginHint').hidden = !(s.login && !s.hsPassword);
  $('hsLoginHint').textContent = t('settings.vr.loginHint');
  $('setSubVr').textContent = !s.heresphere ? t('settings.vr.subOff')
    : s.hsPassword ? t('settings.vr.subPass') : t('settings.vr.subOn');
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
  } catch (e) { log(t('settings.notSaved', { error: e.message }), true); }
}
// nach test2: Umschalter ohne/mit Passwort. „Ohne“ löscht ein gesetztes Passwort sofort und sperrt das Feld;
// „Mit“ gibt das Feld frei – gilt erst, wenn ein Passwort gespeichert ist.
function renderPassMode(on) {
  document.querySelectorAll('#hsPassMode button').forEach((b) => b.classList.toggle('active', (b.dataset.pw === 'on') === on));
  $('hsPass').disabled = !on;
  $('hsPassSave').disabled = !on;
  if (!on) $('hsPass').value = '';
}

function renderLibrarySettings() {
  const sel = $('setStartSource');
  sel.replaceChildren(...librarySources().map((s) => new Option(s.label.replace('📁 ', t('settings.lib.folderPrefix')), s.id)));
  sel.value = store.get('libSource', sel.options[0]?.value || '');

  const ul = $('setFolders');
  ul.replaceChildren();
  const roots = folderRoots();
  if (!roots.length) {
    ul.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: t('settings.lib.noFolders') }));
  }
  for (const r of roots) {
    const items = lib.folder.filter((it) => it.root === r);
    const withScript = items.filter((it) => it.script).length;
    const li = document.createElement('li');
    li.textContent = t('settings.lib.folderLine', { path: r ? '/media/' + r : '/media', n: items.length, scripts: withScript });
    ul.append(li);
  }
}

// --- System ------------------------------------------------------------------
async function renderSysInfo() {
  const dl = $('sysInfo');
  const rows = [];
  const add = (k, v) => rows.push([k, v]);
  try { add(t('settings.sys.version'), 'v' + (await (await fetch('/api/version')).json()).version); } catch { add(t('settings.sys.version'), '?'); }
  showUpdate();
  const st = lib.stashStatus || {};
  add('Stash', !st.configured ? t('settings.sys.stashNone') : st.ok ? t('settings.sys.stashOk', { version: st.version || 'ok' }) : t('settings.sys.stashErr', { error: st.error }));
  add(t('settings.sys.hq'), !hqState.checked ? t('settings.sys.checking')
    : hqState.available ? (HQ_ACCEL_LABEL[hqState.accel] || hqState.accel) : t('settings.sys.hqNone'));
  add(t('settings.sys.gpu'), gpuText());
  add(t('settings.sys.enh'), enh.ok ? t('settings.sys.webgl') : t('settings.sys.unavailable'));
  add('Bluetooth', (await bluetoothProblem()) || t('settings.sys.available'));
  add('HereSphere', `${location.origin}/heresphere`);
  dl.replaceChildren(...rows.flatMap(([k, v]) => [
    Object.assign(document.createElement('dt'), { textContent: k }),
    Object.assign(document.createElement('dd'), { textContent: v }),
  ]));
  // Intel-Grafik eingebunden, aber Problem: Hinweis, was zu tun ist
  const hint = { noaccess: 'settings.sys.gpuHintNoaccess', driver: 'settings.sys.gpuHintDriver' }[hqState.gpu];
  $('gpuHint').hidden = !hint;
  if (hint) $('gpuHint').textContent = hint === 'settings.sys.gpuHintNoaccess' ? t('settings.sys.gpuHintNoaccess') : t('settings.sys.gpuHintDriver');
  renderSystemSub();
}

// Intel-Grafik (Quick Sync) für den HQ-Stream – Zustand aus /api/hq/status
function gpuText() {
  if (!hqState.checked) return t('settings.sys.checking');
  if (!hqState.available) return '–';
  return hqState.gpu === 'ok' ? t('settings.sys.gpuOk') : hqState.gpu === 'noaccess' ? t('settings.sys.gpuNoaccess')
    : hqState.gpu === 'driver' ? t('settings.sys.gpuDriver') : t('settings.sys.gpuMissing');
}
// Untertitel in der Startliste: Version · Intel-Grafik
let appVer = '';
function renderSystemSub() {
  const gpu = !hqState.checked || !hqState.available ? '' : hqState.gpu === 'ok' ? t('settings.sys.subGpuOk') : t('settings.sys.subGpuOff');
  $('setSubSystem').textContent = [appVer && 'v' + appVer, gpu].filter(Boolean).join(' · ') || t('settings.sys.sub');
}

// „Update verfügbar“ (neuestes GitHub-Release, der Server fragt höchstens alle 6 h) – auch als Punkt an der Version oben
async function showUpdate() {
  try {
    const u = await (await fetch('/api/update')).json();
    $('updateBox').hidden = !u.available;
    $('appVersion').classList.toggle('has-update', !!u.available);
    if (!u.available) return;
    $('updateText').textContent = t('settings.sys.updateText', { latest: u.latest, current: u.current });
    $('updateLink').href = u.url;
  } catch { $('updateBox').hidden = true; }
}

// Start (main.js ruft die Module in fester Reihenfolge auf): alles, was beim Laden der Seite einmal läuft
export function init() {
  document.querySelectorAll('#qualityMode button').forEach((b) => b.addEventListener('click', () => setQualityMode(b.dataset.q)));
  // Änderungen unter „Erweitert“ spiegeln
  $('imageSettings').addEventListener('click', () => setTimeout(renderQualityMode, 50));
  document.addEventListener('hq-ready', renderQualityMode);
  hud = Object.assign({}, HUD_DEFAULT, store.get('hud', {}));
  document.querySelectorAll('#hudOptions input').forEach((cb) => {
    cb.checked = hud[cb.dataset.hud];
    cb.addEventListener('change', () => { hud[cb.dataset.hud] = cb.checked; store.set('hud', hud); applyHud(); });
  });
  applyHud();
  // --- Sprache (pro Gerät): Englisch / Deutsch – Standard nach Gerätesprache, Wechsel lädt neu ---------
  $('langSel').value = lang;
  $('langSel').addEventListener('change', () => setLang($('langSel').value));
  // --- Erklärtexte hinter ⓘ (1.19.3) – aufeinanderfolgende landen unter einem ⓘ ---------------------
  // (2.0: Bereiche sind eigene Seiten statt Aufklapper – settings.js / showSetPage in app.js)
  document.querySelectorAll('#view-settings p.hint-text:not([id]), #view-settings ul.preset-help').forEach((p) => {
    if (p.closest('details.more-info, .hud-options, .set-quick')) return;
    const prev = p.previousElementSibling;
    const adv = p.classList.contains('adv');
    if (prev?.matches('details.more-info') && prev.classList.contains('adv') === adv) { prev.append(p); p.classList.remove('adv'); return; }
    const d = Object.assign(document.createElement('details'), { className: 'more-info' + (adv ? ' adv' : '') });
    d.append(Object.assign(document.createElement('summary'), { textContent: t('settings.explain') }));
    p.replaceWith(d);
    d.append(p);
    p.classList.remove('adv');
  });
  $('advMode').addEventListener('change', () => setAdvMode($('advMode').checked));
  setAdvMode(store.get('advMode', false));
  $('welcomeOk').addEventListener('click', () => { showWelcome(false); store.set('seenWelcome', true); });
  $('welcomeConnect').addEventListener('click', () => { showWelcome(false); store.set('seenWelcome', true); openDevices(); });
  $('welcomeAgain').addEventListener('click', () => showWelcome());
  if (freshInstall && !store.get('seenWelcome', false)) {
    store.set('seen200', true); // statt „Neu in …“
    showWelcome();
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
  $('installApp').addEventListener('click', installApp);
  $('welcomeInstall').addEventListener('click', installApp);
  renderInstall();
  $('appFs').checked = store.get('appFs', false);
  $('appFs').addEventListener('change', () => {
    store.set('appFs', $('appFs').checked);
    if ($('appFs').checked) enterAppFs();
    else if (document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
  });
  // Der Browser verlangt für Vollbild ein Antippen: das nächste Antippen startet es (nicht das ⛶ des Videos)
  document.addEventListener('click', (e) => {
    if ($('appFs').checked && !e.target.closest('#ovFs, #ovHit, video, #ovPip, #appFs')) enterAppFs();
  }, true);
  // --- Einmal nach dem Update auf 1.19.11: was neu ist ------------------------
  if (!store.get('seen200', false)) {
    $('whatsNew').hidden = false;
    const done = () => { $('whatsNew').hidden = true; store.set('seen200', true); };
    $('whatsNewOk').addEventListener('click', done);
    $('whatsNewSet').addEventListener('click', () => { done(); openSettings('setLook'); });
  }
  barCfg = Object.assign({ order: BAR_BTNS.map((b) => b[0]), off: [] }, store.get('barBtns', {}));
  barCfg.order = barCfg.order.filter((k) => BAR_BTNS.some((b) => b[0] === k));
   // 1.19.7: 🎚, ✨ und ⟳ entfallen, 1.19.8: −/+
  for (const [k] of BAR_BTNS) if (!barCfg.order.includes(k)) barCfg.order.push(k);
  applyBar();
  renderBarOptions();
  browseTabs = Object.assign({ tags: true, performers: true, studios: false }, store.get('browseTabs', {}));
  document.querySelectorAll('#browseOptions input').forEach((cb) => {
    cb.checked = browseTabs[cb.dataset.browseOpt] !== false;
    cb.addEventListener('change', () => { browseTabs[cb.dataset.browseOpt] = cb.checked; store.set('browseTabs', browseTabs); applyBrowseTabs(); });
  });
  applyBrowseTabs();
  // --- Server-Einstellungen: HereSphere, Intiface --------------------------------------------
  $('hsUrl').value = `${location.origin}/heresphere`;
  fetch('/api/settings').then((r) => r.json()).then(showServerSettings).catch(() => {});
  $('hsOn').addEventListener('change', () => putSettings({ heresphere: $('hsOn').checked }, $('hsOn').checked ? t('settings.vr.logOn') : t('settings.vr.logOff')));
  $('hsRedirect').addEventListener('change', () => putSettings({ hsRedirect: $('hsRedirect').checked }, $('hsRedirect').checked ? t('settings.vr.logRedirectOn') : t('settings.vr.logRedirectOff')));
  $('hsVrOnly').addEventListener('change', () => putSettings({ hsVrOnly: $('hsVrOnly').checked }, $('hsVrOnly').checked ? t('settings.vr.logVrOnly') : t('settings.vr.logAll')));
  $('hsPassSave').addEventListener('click', () => {
    const pw = $('hsPass').value;
    if (!pw) return log(t('settings.vr.passEmpty'), true);
    $('hsPass').value = '';
    putSettings({ hsPassword: pw }, t('settings.vr.logPassSaved'));
  });
  document.querySelectorAll('#hsPassMode button').forEach((b) => b.addEventListener('click', () => {
    const on = b.dataset.pw === 'on';
    renderPassMode(on);
    if (on) $('hsPass').focus();
    else if (hsHasPass) putSettings({ hsPassword: '' }, t('settings.vr.logPassRemoved'));
  }));
  $('intifaceLan').addEventListener('change', () => putSettings({ intifaceLan: $('intifaceLan').checked }, $('intifaceLan').checked ? t('settings.intifaceHomeNetworkAddresses') : t('settings.intifaceAllPrivateAddresses')));
  $('hsCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('hsUrl').value);
      $('hsCopy').textContent = t('settings.vr.copied');
    } catch {
      $('hsUrl').select();
      $('hsCopy').textContent = t('settings.vr.selected');
    }
    setTimeout(() => { $('hsCopy').textContent = t('settings.vr.copy'); }, 2000);
  });
  // --- Bibliothek --------------------------------------------------------------
  $('setHoverPreview').checked = store.get('hoverPreview', true);
  $('setHoverPreview').addEventListener('change', () => store.set('hoverPreview', $('setHoverPreview').checked));
  $('setStartSource').addEventListener('change', () => setSource($('setStartSource').value));
  document.addEventListener('library-ready', renderLibrarySettings);
  document.addEventListener('hq-ready', () => { if (!$('view-settings').hidden) renderSysInfo(); });
  fetch('/api/version').then((r) => r.json()).then((v) => { appVer = v.version; renderSystemSub(); }).catch(() => {});
  document.addEventListener('hq-ready', renderSystemSub);
  setTimeout(showUpdate, 4000);
  $('appVersion').addEventListener('click', (e) => { if ($('appVersion').classList.contains('has-update')) { e.stopPropagation(); openSettings('setSystem'); } });
  // Stiller Selbsttest beim Laden (statt Knopf): Rechnet die Script-Intensität einmal durch und prüft die
  // Bedienelemente. Nur Fehler gehen an den Server (stehen dann in „docker logs“), sichtbar wird nichts.
  setTimeout(() => {
    const fails = [];
    try {
      const a = Array.from({ length: 40 }, (_, i) => ({ at: i * 300, pos: i % 2 ? 80 : 20 }));
      for (const p of Object.keys(SCRIPT_PRESETS)) {
        const r = processScript(a, 'handy', p);
        if (!Array.isArray(r) || !r.length || r.some((x) => !(x.pos >= 0 && x.pos <= 100))) fails.push(`${t('settings.intensity')} ` + p);
      }
      clearToolCache();
    } catch (e) { fails.push(t('settings.intensityFail', { msg: e.message })); }
    for (const id of ['video', 'heatmap', 'devices', 'stopAll', 'fabStop', 'scriptBox']) if (!$(id)) fails.push('fehlt: #' + id);
    if (fails.length) fetch('/api/clientcheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fails, ua: navigator.userAgent }) }).catch(() => {});
  }, 5000);
  $('resetLocal').addEventListener('click', () => {
    if (!confirm(t('settings.sys.resetConfirm'))) return;
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('hp.')).forEach((k) => localStorage.removeItem(k));
    } catch { /* egal */ }
    location.reload();
  });
  // Infos frisch laden, sobald eine Einstellungs-Seite geöffnet wird (Ereignis aus app.js showSetPage)
  window.addEventListener('hp:setpage', () => {
    const page = document.body.dataset.setPage;
    if (page === 'system') renderSysInfo();
    else if (page === 'library') { renderLibrarySettings(); renderSavedFilterOptions(); }
    else if (!page) updateAdvHint();
  });
}
