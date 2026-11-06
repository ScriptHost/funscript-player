// Navigation 2.0: vier Bereiche (Bibliothek, Player bzw. Steuern, Geräte, Einstellungen) – am Smartphone als
// Daumen-Leiste unten, am PC oben im Kopf (style.css). Geräte = das Geräte-Fenster; „Player“ ohne Video zeigt
// Steuern. Dazu der Anzeige-Schalter „Bewegung“ und der Demo-Modus als Klassen an <body>. main.js ruft init() auf.
import { modulesReady } from './state.js';
import { store } from './handy.js';
import { closeDevices, goLibrary, openDevices, openPlayer, openSettings, setMode } from './app.js';
import { t } from './lang.js';

// Demo-Modus: Videos, Vorschaubilder und Namen unkenntlich (style.css body.demo) und kein Ton – zum Vorführen.
// An über die Adresse /demo (fest) oder den Schalter in ⚙️ → Sicherheit & Privatsphäre (pro Gerät).
const DEMO_URL = location.pathname === '/demo';
export const isDemo = () => document.body.classList.contains('demo');
export function setDemo(on) {
  if (!DEMO_URL) store.set('demo', on);
  document.body.classList.toggle('demo', DEMO_URL || on);
  const v = document.getElementById('video');
  if (v && isDemo()) v.muted = true;
}
setDemo(store.get('demo', false));
// Im Demo-Modus bleibt der Ton aus – auch 🔊, Taste M und Wischen schalten ihn nicht ein
document.getElementById('video')?.addEventListener('volumechange', (e) => { if (isDemo() && !e.target.muted) e.target.muted = true; });

// nach test8: „Steuern“ gehört zum Player – ohne geöffnetes Video zeigt „Player“ direkt Steuern (Direkt, Patterns, Aufnahmen)
const AREAS = ['library', 'player', 'devices', 'settings'];

export function currentArea() {
  if (document.body.classList.contains('dev-open')) return 'devices';
  const v = document.body.dataset.view;
  return v === 'control' ? 'player' : AREAS.includes(v) ? v : 'library';
}

export function goArea(area) {
  if (area !== 'devices') closeDevices();
  if (area === 'library') goLibrary();
  else if (area === 'player') {
    if (document.getElementById('video').getAttribute('src')) openPlayer();
    else setMode('control');
  }
  else if (area === 'settings') openSettings();
  else if (area === 'devices') {
    if (document.body.classList.contains('dev-open')) closeDevices(); else openDevices();
  }
}

// test10: der Leisten-Punkt heißt „Player“, solange ein Video offen ist, sonst „Steuern“
function markPlayer() {
  const hasVideo = !!document.getElementById('video').getAttribute('src');
  document.getElementById('navPlayerTx').textContent = hasVideo ? t('nav.player') : t('nav.control');
  document.getElementById('navPlayerIc').textContent = hasVideo ? '▶︎' : '⇅';
}
function mark() {
  markPlayer();
  const a = currentArea();
  for (const b of document.querySelectorAll('#appNav [data-area]')) {
    if (b.dataset.area === a) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

// Anzeige-Schalter: Bewegung ab Werk aus
export function setMotion(on) { store.set('motion', on); document.body.classList.toggle('motion', on); }

export function init() {
  modulesReady.add('nav');
  // test10: Höhe des Kopfs für die mitlaufende Kopfzeile der Einstellungs-Seiten
  const hdr = document.querySelector('header');
  if (hdr && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px')).observe(hdr);
  document.body.classList.toggle('motion', store.get('motion', false));
  const motion = document.getElementById('motionOn');
  if (motion) { motion.checked = store.get('motion', false); motion.addEventListener('change', () => setMotion(motion.checked)); }
  const demo = document.getElementById('demoOn');
  if (demo) {
    demo.checked = isDemo();
    demo.disabled = DEMO_URL; // über /demo geöffnet: immer an
    document.getElementById('demoUrlHint').hidden = !DEMO_URL;
    // Neu laden: echte Geräte trennen bzw. die virtuellen Demo-Geräte (handy.js, vibe.js) verbinden
    demo.addEventListener('change', () => { setDemo(demo.checked); location.reload(); });
  }

  document.getElementById('appNav')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (b) goArea(b.dataset.area);
  });
  window.addEventListener('hp:view', mark);
  for (const ev of ['loadstart', 'emptied']) document.getElementById('video').addEventListener(ev, markPlayer);
  mark();
}
