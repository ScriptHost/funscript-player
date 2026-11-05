// Navigation 2.0: vier Bereiche (Bibliothek, Player, Geräte, Einstellungen) – am Smartphone als Daumen-Leiste
// unten, am PC oben im Kopf (design.css). Dazu die Anzeige-Schalter „Leuchten aus“ und „Bewegung“ als Klassen
// an <body>. Neues Modul ohne Arbeit beim Laden: boot.js ruft init() auf.
//
// Bis die Bereiche neu gebaut sind (Phasen 4–7), führen die Knöpfe zu den alten Seiten: Geräte = das alte
// Geräte-Fenster, Steuern zählt zu Geräte.
import { modulesReady } from './state.js';
import { store } from './handy.js';
import { closeDevices, goLibrary, openDevices, openPlayer, openSettings } from './app.js';

// Demo-Modus (/demo): Videos, Vorschaubilder und Namen unkenntlich (design.css body.demo) – zum Vorführen
if (location.pathname === '/demo') document.body.classList.add('demo');

const AREAS = ['library', 'player', 'devices', 'settings'];

export function currentArea() {
  if (document.body.classList.contains('dev-open')) return 'devices';
  const v = document.body.dataset.view;
  return v === 'control' ? 'devices' : AREAS.includes(v) ? v : 'library';
}

export function goArea(area) {
  if (area !== 'devices') closeDevices();
  if (area === 'library') goLibrary();
  else if (area === 'player') openPlayer();
  else if (area === 'settings') openSettings();
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

  document.getElementById('appNav')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (b) goArea(b.dataset.area);
  });
  window.addEventListener('hp:view', mark);
  mark();
}
