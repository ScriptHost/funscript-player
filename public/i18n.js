'use strict';

// ===========================================================================
// Sprache: Englisch ist Standard, Deutsch bei deutschem Gerät; ⚙️ → Anzeige schaltet um (pro Gerät).
// Die deutschen Texte stehen im HTML und im Code. Für Englisch ersetzt i18n.js sie beim Laden und
// – über einen MutationObserver – auch alles, was später per JavaScript gesetzt wird.
//   EN       – feste Texte (Schlüssel = deutscher Text, Leerzeichen zusammengefasst)
//   EN_RX    – Texte mit Zahlen/Namen darin (regulärer Ausdruck -> Ersetzung)
// Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
// ===========================================================================
const I18N = (() => {
  let lang = 'de';
  try {
    lang = localStorage.getItem('hp.lang') ? JSON.parse(localStorage.getItem('hp.lang'))
      : (/^de\b/i.test(navigator.language || '') ? 'de' : 'en');
  } catch { /* Standard */ }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const t = (s) => {
    if (lang !== 'en' || typeof s !== 'string' || !s.trim()) return s;
    const table = window.I18N_EN || {};
    const key = norm(s);
    // Leerzeichen am Rand bleiben genau erhalten (sonst wächst der Text bei jeder Änderung)
    const [, lead, trail] = /^(\s*)[\s\S]*?(\s*)$/.exec(s);
    if (key in table) return lead + table[key].trim() + trail;
    for (const [re, rep] of window.I18N_EN_RX || []) {
      if (re.test(key)) return lead + key.replace(re, rep) + trail;
    }
    return s;
  };
  // Schon übersetzte Textknoten merken: eine Übersetzung löst sonst die nächste aus
  const done = new WeakMap();
  // Elemente, deren Inhalt als Ganzes übersetzt wird (nur Text + Auszeichnung, keine Bedienelemente/IDs)
  const INLINE = new Set(['B', 'I', 'SMALL', 'CODE', 'BR', 'A', 'SPAN', 'KBD', 'EM', 'STRONG']);
  const wholeOk = (el) => [...el.querySelectorAll('*')].every((c) => INLINE.has(c.tagName) && !c.id);
  function translateEl(root) {
    if (lang !== 'en') return;
    const table = window.I18N_EN || {};
    const walk = (el) => {
      if (el.nodeType === 3) {
        if (done.get(el) === el.nodeValue) return;
        const v = t(el.nodeValue);
        done.set(el, v);
        if (v !== el.nodeValue) el.nodeValue = v;
        return;
      }
      if (el.nodeType !== 1 || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      for (const a of ['title', 'placeholder', 'aria-label']) {
        if (el.hasAttribute(a)) { const v = t(el.getAttribute(a)); if (v !== el.getAttribute(a)) el.setAttribute(a, v); }
      }
      if (el.tagName === 'TEMPLATE') return walk(el.content);
      // Ganzer Satz mit <b>/<code> darin: als Ganzes übersetzen
      if (el.children.length && wholeOk(el)) {
        const key = norm(el.innerHTML);
        if (key in table) { el.innerHTML = table[key]; return; }
      }
      for (const c of [...el.childNodes]) walk(c);
    };
    walk(root);
  }
  function start() {
    document.documentElement.lang = lang;
    if (lang !== 'en') return;
    // Rückfragen und Hinweise des Browsers ebenfalls übersetzen
    for (const name of ['confirm', 'alert', 'prompt']) {
      const orig = window[name].bind(window);
      window[name] = (msg, ...rest) => orig(t(msg), ...rest);
    }
    translateEl(document.body);
    // Später gesetzte Texte (Meldungen, Status, Listen) ebenfalls übersetzen
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateEl(m.target);
        else m.addedNodes.forEach((n) => translateEl(n));
      }
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  }
  return { get lang() { return lang; }, t, translateEl, start };
})();
