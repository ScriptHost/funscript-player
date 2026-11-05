// Player 2.0: Geräte-Dock neben bzw. unter dem Video. Ruhige Balken ab Werk:
//   Handy     = eingestellter Hub (Bereich min–max)
//   Satisfyer = Stärke dieser Szene (begrenzt durch „Stärke max“)
// Mit „Bewegung“ (⚙️ → Anzeige, body.motion) folgen die Balken dem, was die Geräte gerade tun.
// Antippen öffnet das Geräte-Fenster beim passenden Gerät. Neues Modul ohne Arbeit beim Laden: boot.js ruft init().
import { modulesReady } from './state.js';
import { $, positionAt } from './handy.js';
import { mediaTime, openDevices, script, toolActions } from './app.js';
import { vibeLevel } from './vibe.js';
import { mapPos } from './stroker.js';
import { t } from './lang.js';

let timer = null;

function setBar(bar, left, width) {
  const i = bar.firstElementChild;
  i.style.marginLeft = `${Math.max(0, left)}%`;
  i.style.setProperty('--v', `${Math.max(0, Math.min(100 - left, width))}%`);
}

function update() {
  const motion = document.body.classList.contains('motion');
  const playing = !!script && !$('video').paused;
  // Handy
  const lo = Number($('slideMin').value), hi = Number($('slideMax').value);
  const hBar = document.querySelector('#dockHandy .ui-bar');
  if (motion && playing) {
    const pos = Math.round(mapPos(positionAt(toolActions('handy'), mediaTime() * 1000)) * 100);
    setBar(hBar, 0, pos);
    $('dockHandyVal').textContent = `${pos} %`;
  } else {
    setBar(hBar, lo, hi - lo);
    $('dockHandyVal').textContent = t('player.hub', { lo, hi });
  }
  // Satisfyer
  const vBar = document.querySelector('#dockVibe .ui-bar');
  const level = motion && playing ? Math.round(vibeLevel * 100)
    : Math.round(Number($('vibeScene').value) * Number($('vibeMax').value) / 100);
  setBar(vBar, 0, level);
  $('dockVibeVal').textContent = t('player.strength', { n: level });
}

function loop() {
  const on = document.body.dataset.view === 'player' && !document.hidden;
  if (on && !timer) { update(); timer = setInterval(update, 120); }
  if (!on && timer) { clearInterval(timer); timer = null; }
}

export function init() {
  modulesReady.add('player');
  $('dockHandy').addEventListener('click', () => openDevices('handy'));
  $('dockVibe').addEventListener('click', () => openDevices('vibe'));
  $('dockConnect').addEventListener('click', () => openDevices());
  window.addEventListener('hp:view', loop);
  document.addEventListener('visibilitychange', loop);
  loop();
}
