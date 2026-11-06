// Sprache (2.0): Texte über feste Schlüssel. Englisch ist die Ausgangssprache (lang/en.js), Deutsch die
// Übersetzung (lang/de.js). Fehlt ein deutscher Text, gilt der englische; fehlt auch der, steht der Schlüssel da.
//
//   t('nav.library')                 -> Text
//   t('lib.count', { n: 3 })          -> Platzhalter {n}; Wert als { one, other } = Einzahl/Mehrzahl nach n
//   <span data-i18n="menu.library">   -> Text (nur reiner Text, keine Kind-Elemente)
//   data-i18n-html="key"              -> innerHTML (nur für Texte aus lang/*.js mit <b>/<code>)
//   data-i18n-title / -placeholder / -aria-label="key" -> Attribut
import en from './lang/en.js';
import de from './lang/de.js';

const TEXTS = { en, de };
export const LANGS = Object.keys(TEXTS);

function detect() {
  try {
    const saved = JSON.parse(localStorage.getItem('hp.lang'));
    if (LANGS.includes(saved)) return saved;
  } catch { /* nichts gespeichert */ }
  return /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
}
export const lang = detect();

export function t(key, vars = {}) {
  let s = TEXTS[lang][key] ?? en[key];
  if (s === undefined) return key;
  if (typeof s === 'object') s = s[new Intl.PluralRules(lang).select(Number(vars.n))] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
export function applyLang(root = document) {
  if (root === document) document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const a of ATTRS) for (const el of root.querySelectorAll(`[data-i18n-${a}]`)) el.setAttribute(a, t(el.getAttribute(`data-i18n-${a}`)));
}

// Umschalten (⚙️): gilt pro Gerät, Seite lädt neu
export function setLang(l) {
  localStorage.setItem('hp.lang', JSON.stringify(l));
  location.reload();
}
