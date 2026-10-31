'use strict';

// ===========================================================================
// Einstellungen-Seite: HereSphere-Adresse, Bibliothek, System-Infos.
// (Bild & Qualität steuern enhance.js und hq.js, Geräte die rechte Spalte.)
// ===========================================================================

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
