'use strict';

// ===========================================================================
// DE/EN-Schalter der Vorstellung. Die deutschen Texte stehen im HTML; für Englisch ersetzt das
// Skript sie über die Tabelle EN (Schlüssel = Kurz-Hash des deutschen Texts). Fehlt eine
// Übersetzung, bleibt der deutsche Text stehen. Die animierten Demos bleiben deutsch.
// ===========================================================================
(function () {
  const SEL = 'nav a, .kicker, h1, h2, h3, p, li, summary, .chip, a.btn, label.btn, th, td, .legend div, footer span, svg text, .cmp-tag, .cmp-steps span, .scale span';
  const SKIP = '#syncDemo, #tryDemo, .phone, .sheet-demo, .tiles-demo, .pad-demo, .bar-demo';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const nodes = () => [...document.querySelectorAll(SEL)].filter((el) => !el.closest(SKIP) && !el.querySelector(SEL));
  let originals = null;

  function setLang(lang) {
    const en = window.FSP_EN || {};
    if (!originals) originals = new Map(nodes().map((el) => [el, el.innerHTML]));
    for (const [el, de] of originals) {
      const t = lang === 'en' ? en[hash(norm(de))] : null;
      el.innerHTML = t || de;
    }
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    try { localStorage.setItem('fsp.lang', lang); } catch { /* egal */ }
  }

  // Für Übersetzer: alle Texte mit Schlüssel (in der Konsole: fspTexts())
  window.fspTexts = () => (originals ? [...originals.values()] : nodes().map((el) => el.innerHTML)).map((de) => [hash(norm(de)), norm(de)]);

  const sw = document.createElement('span');
  sw.className = 'lang-switch';
  sw.innerHTML = '<button data-lang="de" title="Deutsch">DE</button><button data-lang="en" title="English">EN</button>';
  sw.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });
  document.querySelector('.top-in')?.append(sw);

  let start = 'de';
  try { start = localStorage.getItem('fsp.lang') || (/^de\b/i.test(navigator.language || 'de') ? 'de' : 'en'); } catch { /* egal */ }
  if (start === 'en') setLang('en'); else sw.querySelector('[data-lang="de"]').classList.add('on');
})();
