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
const HUD_DEFAULT = { meta: true, actions: true, baractions: true, people: false, tags: false, markers: true, details: false, quality: true };
const hud = Object.assign({}, HUD_DEFAULT, store.get('hud', {}));
function applyHud() {
  for (const [k, on] of Object.entries(hud)) document.body.classList.toggle('hud-off-' + k, !on);
}
document.querySelectorAll('#hudOptions input').forEach((cb) => {
  cb.checked = hud[cb.dataset.hud];
  cb.addEventListener('change', () => { hud[cb.dataset.hud] = cb.checked; store.set('hud', hud); applyHud(); });
});
applyHud();

// --- HereSphere --------------------------------------------------------------
$('hsUrl').value = `${location.origin}/heresphere`;
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
  if (!confirm('Alle Einstellungen auf diesem Gerät zurücksetzen (Connection Key, Bild, Vibrator, Ansicht)?\nPatterns und Scripts auf dem Server bleiben erhalten.')) return;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('hp.')).forEach((k) => localStorage.removeItem(k));
  } catch { /* egal */ }
  location.reload();
});

// Infos frisch laden, sobald die Seite geöffnet wird
new MutationObserver(() => {
  if (!$('view-settings').hidden) { renderSysInfo(); renderLibrarySettings(); }
}).observe($('view-settings'), { attributes: true, attributeFilter: ['hidden'] });
