'use strict';

// Übersetzung (1.19.9): Jeder deutsche Text der Oberfläche (index.html) braucht eine englische Fassung in
// public/i18n-en.js – sonst bleibt er bei Englisch stillschweigend deutsch. Geprüft wird wie in i18n.js:
// Textknoten und title/placeholder/aria-label einzeln; ein Absatz nur aus Text + <b>/<code>/… auch als Ganzes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/i18n-en.js'), 'utf8'), ctx);
const TABLE = ctx.window.I18N_EN;
const RX = ctx.window.I18N_EN_RX;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Textknoten sieht der Browser entschlüsselt (&amp; -> &)
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const known = (s) => norm(s) in TABLE || RX.some(([re]) => re.test(norm(s)));

// Deutsch erkennen: Umlaute/ß oder typische kurze Wörter (Englisch, Zahlen, Symbole und Namen bleiben außen vor)
const GERMAN = /[äöüßÄÖÜ]|\b(und|oder|der|die|das|den|dem|mit|nicht|für|ein|eine|ist|auf|bei|nur|wenn|zum|zur|von|aus|alle|Gerät|Szene|einstellen|zeigen|wählen)\b/;
// Kein Deutsch, obwohl es so aussieht (Gerätenamen, Formate …)
const IGNORE = new Set(['The Handy', 'Satisfyer', 'Intiface Central', 'HereSphere', 'Stash', 'Funscript Player', 'Original']);

const INLINE = new Set(['b', 'i', 'small', 'code', 'br', 'a', 'span', 'kbd', 'em', 'strong']);
const VOID = new Set(['br', 'input', 'img', 'meta', 'link', 'hr', 'source', 'canvas']);

// Kleiner HTML-Leser: Elemente mit ihrem inneren HTML, Textknoten mit ihren Vorfahren
function parse(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  const root = { tag: '#root', children: [], attrs: '', start: 0 };
  const stack = [root];
  const texts = [];
  const attrs = [];
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) { if (m[3].trim()) texts.push({ text: decode(m[3]), parents: [...stack] }); continue; }
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack[i].inner = html.slice(stack[i].start, m.index); stack.length = i; break; }
      }
      continue;
    }
    for (const a of m[2].matchAll(/\b(title|placeholder|aria-label)="([^"]*)"/g)) attrs.push(decode(a[2]));
    const el = { tag, attrs: m[2], children: [], start: re.lastIndex };
    top.children.push(el);
    if (!VOID.has(tag) && !m[0].endsWith('/>')) stack.push(el);
  }
  return { texts, attrs };
}

// Ganzer Absatz (nur Text + Auszeichnung ohne id) übersetzt? – wie wholeOk() in i18n.js
const wholeOk = (el) => el.children.every((c) => INLINE.has(c.tag) && !/\bid=/.test(c.attrs) && wholeOk(c));

test('Übersetzung: jeder deutsche Text der Oberfläche hat eine englische Fassung', () => {
  const { texts, attrs } = parse(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const missing = new Set();
  for (const { text, parents } of texts) {
    const t = norm(text);
    if (!GERMAN.test(t) || IGNORE.has(t) || known(t)) continue;
    // Teil eines als Ganzes übersetzten Absatzes?
    const whole = parents.slice(1).reverse().some((p) => p.children.length && wholeOk(p) && p.inner !== undefined && norm(p.inner) in TABLE);
    if (!whole) missing.add(t);
  }
  for (const a of attrs) if (GERMAN.test(a) && !known(a)) missing.add(a);
  assert.deepStrictEqual([...missing], [], `Ohne englische Fassung (public/i18n-en.js ergänzen):\n${[...missing].join('\n')}`);
});
