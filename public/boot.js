// Start (2.0: ES-Module). Die Sprachdateien i18n-en.js + i18n.js sind noch klassische Skripte und laufen vorher.
//
// Ladereihenfolge: Die Module rufen sich gegenseitig auf (auch im Kreis). ES-Module laufen erst, wenn ihre
// Importe gelaufen sind – das würde die bewährte Reihenfolge der alten <script>-Dateien durcheinanderbringen
// (z. B. tools.js vor app.js → „Cannot access 'hq' before initialization“). Deshalb lädt jedes Modul als ERSTEN
// Import seinen Vorgänger, und hier wird nur das letzte geladen. So laufen sie genau in dieser Reihenfolge:
//   handy → app → library → control → vibe → fullscreen → gestures → enhance → hq → finale → tools → stroker
//   → selfctl → touchpad → settings
// Neue Module mit dem 2.0-Design bitte ohne Seiteneffekte beim Laden (init()-Funktion) – dann fällt die Kette weg.
import './settings.js';

// Sprache anwenden und für die Entwicklung mit ?selbsttest den Selbsttest nachladen
I18N.start();
if (/[?&]selbsttest\b/.test(location.search)) {
  document.body.append(Object.assign(document.createElement('script'), { type: 'module', src: 'selftest.js' }));
}
