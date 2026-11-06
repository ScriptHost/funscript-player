// Player 2.0: Geräte-Dock neben bzw. unter dem Video. Ruhige Balken ab Werk:
//   Handy     = eingestellter Hub (Bereich min–max)
//   Satisfyer = Stärke dieser Szene (begrenzt durch „Stärke max“)
// Mit „Bewegung“ (⚙️ → Anzeige, body.motion) folgen die Balken dem, was die Geräte gerade tun.
// Antippen öffnet das Geräte-Fenster beim passenden Gerät. Neues Modul ohne Arbeit beim Laden: main.js ruft init().
import { modulesReady } from './state.js';
import { $, positionAt, store } from './handy.js';
import { mediaTime, openDevices, script, toolActions } from './app.js';
import { vibeLevel } from './vibe.js';
import { mapPos } from './stroker.js';
import { t } from './lang.js';
import { nowKey } from './library.js';

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

// „Als Nächstes“ (PC, breit): die Kacheln nach der laufenden Szene, so wie sie in der Bibliothek stehen
// (gleicher Filter, gleiche Sortierung). Antippen = wie die Kachel antippen, startet also sofort.
// nach test6: Mit Suchbegriff (Feld oben, gleich der Suche der Bibliothek) alle Treffer statt der nächsten Szenen.
function renderNext() {
  const box = $('plNext');
  const on = store.get('nextCol', true);
  const tiles = [...document.querySelectorAll('#sceneGrid > .tile:not([hidden])')];
  const i = tiles.findIndex((x) => x.dataset.src === nowKey());
  const q = $('search').value.trim();
  const next = q ? tiles.slice(0, 40) : (i >= 0 ? [...tiles.slice(i + 1), ...tiles.slice(0, i)] : tiles).slice(0, 30);
  box.hidden = !on;
  $('plNextSearch').value = q;
  if (box.hidden) return;
  $('plNextList').replaceChildren(...next.map((tile) => {
    const img = tile.querySelector('.thumb img');
    const it = document.createElement('button');
    it.className = 'pl-next-it';
    const th = document.createElement('span');
    th.className = 'th';
    if (img) th.append(Object.assign(document.createElement('img'), { src: img.src, alt: '', loading: 'lazy' }));
    const strip = tile.querySelector('.heatstrip.on');
    if (strip) { const heat = Object.assign(document.createElement('i'), { className: 'heat' }); heat.style.background = strip.style.background; th.append(heat); }
    const tx = document.createElement('span');
    tx.className = 'tx';
    tx.append(Object.assign(document.createElement('b'), { textContent: tile.querySelector('.tile-title')?.textContent || '' }),
      Object.assign(document.createElement('small'), { textContent: tile.querySelector('.tile-sub')?.textContent || '' }));
    it.append(th, tx);
    it.addEventListener('click', () => tile.click());
    return it;
  }));
}

export function init() {
  modulesReady.add('player');
  $('dockHandy').addEventListener('click', () => openDevices('handy'));
  $('dockVibe').addEventListener('click', () => openDevices('vibe'));
  $('dockConnect').addEventListener('click', () => openDevices());
  window.addEventListener('hp:view', loop);
  window.addEventListener('hp:view', () => { if (document.body.dataset.view === 'player') renderNext(); });
  $('video').addEventListener('loadstart', () => setTimeout(renderNext, 0));
  $('plNextClose').addEventListener('click', () => { store.set('nextCol', false); $('nextOn').checked = false; renderNext(); });
  // nach test6: Liste folgt der Bibliothek (lädt sie nach dem Start nach, erschien „Als Nächstes“ erst nach Aus/An)
  let queued = false;
  new MutationObserver(() => {
    if (queued || document.body.dataset.view !== 'player') return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderNext(); });
  }).observe($('sceneGrid'), { childList: true });
  // Suche rechts = Suche der Bibliothek (lädt bei Stash alle Treffer vom Server); die Liste folgt dem Raster
  $('plNextSearch').addEventListener('input', () => {
    $('search').value = $('plNextSearch').value;
    $('search').dispatchEvent(new Event('input'));
  });
  $('nextOn').checked = store.get('nextCol', true);
  $('nextOn').addEventListener('change', () => { store.set('nextCol', $('nextOn').checked); renderNext(); });
  document.addEventListener('visibilitychange', loop);
  loop();
}
