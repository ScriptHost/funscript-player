'use strict';

// Sprache 2.0 (public/lang.js): Texte über Schlüssel, Englisch in public/lang/en.js, Deutsch in public/lang/de.js.
// Geprüft: beide Sprachen haben dieselben Schlüssel und Platzhalter, jeder benutzte Schlüssel existiert, und es
// gibt keine verwaisten Schlüssel. Benutzt = data-i18n…="key" in index.html oder t('key') in public/**/*.js
// (Schlüssel bitte immer als festen Text schreiben, nicht zusammengesetzt).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public');
// lang/*.js sind ES-Module mit „export default { … }“ – als reines Objekt lesen
const load = (l) => vm.runInNewContext(`(${fs.readFileSync(path.join(PUB, 'lang', `${l}.js`), 'utf8')
  .replace(/^\s*export default\s*/m, '').replace(/;\s*$/, '')})`);
const en = load('en');
const de = load('de');

const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
  ? jsFiles(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const used = new Set();
for (const m of fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').matchAll(/\bdata-i18n(?:-[\w-]+)?="([^"]+)"/g)) used.add(m[1]);
for (const f of jsFiles(PUB)) {
  const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''); // Kommentarzeilen (Beispiele) nicht mitzählen
  for (const m of src.matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bdata-i18n(?:-[\w-]+)?="([^"]+)"/g)) used.add(m[1]);
}
const vars = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) || [])].sort();

test('Sprache: Englisch und Deutsch haben dieselben Schlüssel und Platzhalter', () => {
  assert.deepStrictEqual(Object.keys(de).filter((k) => !(k in en)), [], 'nur in de.js');
  assert.deepStrictEqual(Object.keys(en).filter((k) => !(k in de)), [], 'nur in en.js – deutschen Text ergänzen');
  for (const k of Object.keys(en)) {
    assert.ok(JSON.stringify(en[k]).length > 2 && JSON.stringify(de[k]).length > 2, `leerer Text: ${k}`);
    assert.deepStrictEqual(vars(de[k]), vars(en[k]), `Platzhalter unterschiedlich: ${k}`);
  }
});

test('Sprache: jeder benutzte Schlüssel existiert, keiner ist verwaist', () => {
  assert.ok(used.size > 0);
  assert.deepStrictEqual([...used].filter((k) => !(k in en)), [], 'benutzt, aber nicht in lang/en.js');
  assert.deepStrictEqual(Object.keys(en).filter((k) => !used.has(k)), [], 'in lang/en.js, aber nirgends benutzt');
});
