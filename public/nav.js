// Navigation 2.0: vier Bereiche (Bibliothek, Player, Geräte, Einstellungen) – am Smartphone als Daumen-Leiste
// unten, am PC oben im Kopf (style.css). Dazu die Anzeige-Schalter „Leuchten aus“ und „Bewegung“ als Klassen
// an <body>. Neues Modul ohne Arbeit beim Laden: main.js ruft init() auf.
//
// Bis die Bereiche neu gebaut sind (Phasen 4–7), führen die Knöpfe zu den alten Seiten: Geräte = das alte
// Geräte-Fenster, Steuern zählt zu Geräte.
import { modulesReady } from './state.js';
import { store } from './handy.js';
import { closeDevices, goLibrary, openDevices, openPlayer, openSettings } from './app.js';

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

// nach test7: „Steuern“ (Direkt, Patterns, Touch) als eigener Bereich in der Leiste
const AREAS = ['library', 'player', 'control', 'devices', 'settings'];

export function currentArea() {
  if (document.body.classList.contains('dev-open')) return 'devices';
  const v = document.body.dataset.view;
  return AREAS.includes(v) ? v : 'library';
}

export function goArea(area) {
  if (area !== 'devices') closeDevices();
  if (area === 'library') goLibrary();
  else if (area === 'player') openPlayer();
  else if (area === 'settings') openSettings();
  else if (area === 'control') document.querySelector('#devices [data-mode="control"]')?.click();
  else if (area === 'devices') {
    if (document.body.classList.contains('dev-open')) closeDevices(); else openDevices();
  }
}

function mark() {
  const a = currentArea();
  for (const b of document.querySelectorAll('#appNav [data-area]')) {
    if (b.dataset.area === a) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

// Anzeige-Schalter: Leuchten ab Werk an, Bewegung ab Werk aus
export function setGlow(on) { store.set('glow', on); document.body.classList.toggle('no-glow', !on); }
export function setMotion(on) { store.set('motion', on); document.body.classList.toggle('motion', on); }

export function init() {
  modulesReady.add('nav');
  document.body.classList.toggle('no-glow', !store.get('glow', true));
  document.body.classList.toggle('motion', store.get('motion', false));
  const glow = document.getElementById('glowOn'), motion = document.getElementById('motionOn');
  if (glow) { glow.checked = store.get('glow', true); glow.addEventListener('change', () => setGlow(glow.checked)); }
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
  mark();
}
