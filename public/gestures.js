import './fullscreen.js'; // Ladereihenfolge wie bisher – siehe boot.js
import { modulesReady, video } from './state.js';
import { $, store } from './handy.js';
import { endHold, isFs, stage } from './fullscreen.js';
modulesReady.add('gestures');

// ===========================================================================
// Wischen im Vollbild (1.19.8): linke und rechte Bildhälfte hoch/runter.
//   Was jede Hälfte tut, steht in ⚙️ → Anzeige (pro Gerät): aus, Lautstärke, Stärke Satisfyer
//   („Stärke für diese Szene“), Hub der Handy (Hub max) oder beide Geräte. Ganze Bildhöhe = 100 %.
//   Gilt im echten Vollbild des Videos (Bedienleiste des Browsers) und im eigenen Vollbild (iPhone).
//   Zieht der Finger eher seitlich, bleibt alles wie bisher (Tippen, Doppeltippen, Halten).
// ===========================================================================
const SWIPE_ACTIONS = ['off', 'volume', 'vibe', 'handy', 'both'];
// 1.19.9: Standard links Hub Handy, rechts Stärke Satisfyer (Lautstärke nur noch auf Wunsch)
const swipeCfg = { left: store.get('swipeLeft', 'handy'), right: store.get('swipeRight', 'vibe') };
// 1.19.11: einmalig weg von den Standards aus 1.19.8 (links Lautstärke, rechts beide Geräte)
if (!store.get('swipe1911', false)) {
  if (swipeCfg.left === 'volume') { swipeCfg.left = 'handy'; store.set('swipeLeft', 'handy'); }
  if (swipeCfg.right === 'both') { swipeCfg.right = 'vibe'; store.set('swipeRight', 'vibe'); }
  store.set('swipe1911', true);
}
for (const side of ['left', 'right']) {
  const sel = $(side === 'left' ? 'swipeLeft' : 'swipeRight');
  if (!SWIPE_ACTIONS.includes(swipeCfg[side])) swipeCfg[side] = 'off';
  sel.value = swipeCfg[side];
  sel.addEventListener('change', () => { swipeCfg[side] = sel.value; store.set(sel.id, sel.value); });
}

const swipeInFs = () => document.fullscreenElement === video || isFs();
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let swipe = null, swipeEndedAt = 0;

function swipeStart(e) {
  if (!swipeInFs() || e.pointerType === 'mouse' || !e.isPrimary) return;
  const r = (document.fullscreenElement === video ? video : stage).getBoundingClientRect();
  const action = swipeCfg[e.clientX < r.left + r.width / 2 ? 'left' : 'right'];
  if (action === 'off') return;
  swipe = {
    action, x: e.clientX, y: e.clientY, h: r.height || 1, on: false,
    vol: video.muted ? 0 : Math.round(video.volume * 100),
    vibe: Number($('vibeScene').value),
    hub: Number($('slideMax').value),
  };
}

function swipeSet(id, v) {
  if (Number($(id).value) === v) return;
  $(id).value = v;
  $(id).dispatchEvent(new Event('input'));
}

function swipeMove(e) {
  if (!swipe || !e.isPrimary) return;
  const dy = swipe.y - e.clientY, dx = e.clientX - swipe.x;
  if (!swipe.on) {
    // Erst ab 24 px und deutlich senkrecht – sonst ist es Tippen/Halten/Seitwärts
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) { swipe = null; return; }
    if (Math.abs(dy) < 24 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    swipe.on = true;
    if (modulesReady.has('fullscreen')) endHold(); // „Gedrückt halten = 2×“ nicht nebenbei auslösen
  }
  const d = Math.round((dy / swipe.h) * 100);
  const a = swipe.action;
  let msg = '';
  if (a === 'volume') {
    const v = clampN(swipe.vol + d, 0, 100);
    video.muted = v === 0;
    video.volume = v / 100;
    msg = `🔊 ${v} %`;
  }
  if (a === 'vibe' || a === 'both') {
    const v = clampN(Math.round((swipe.vibe + d) / 5) * 5, 10, 100);
    swipeSet('vibeScene', v);
    msg = `〰 ${v} %`;
  }
  if (a === 'handy' || a === 'both') {
    const v = clampN(Math.round((swipe.hub + d) / 5) * 5, Number($('slideMin').value) + 10, 100);
    swipeSet('slideMax', v);
    msg = a === 'both' ? `〰 ${$('vibeScene').value} % · ↕ Hub ${v} %` : `↕ Hub ${v} %`;
  }
  if (msg) swipeShow(msg);
  if (e.cancelable) e.preventDefault();
}

// Wert mitten im Bild zeigen (im Vollbild ist nur der Player sichtbar, keine Einblendung)
let swipeHudTimer = null;
function swipeShow(msg) {
  $('swipeHud').textContent = msg;
  $('swipeHud').hidden = false;
  clearTimeout(swipeHudTimer);
  swipeHudTimer = setTimeout(() => { $('swipeHud').hidden = true; }, 900);
}

function swipeEnd() {
  if (!swipe) return;
  if (swipe.on) {
    swipeEndedAt = Date.now();
    // „change“ einmal am Ende: Hub an die Handy schicken, Stärke für diese Szene speichern
    if (swipe.action === 'vibe' || swipe.action === 'both') $('vibeScene').dispatchEvent(new Event('change'));
    if (swipe.action === 'handy' || swipe.action === 'both') $('slideMax').dispatchEvent(new Event('change'));
    if (swipe.action === 'volume') store.set('muted', video.muted);
  }
  swipe = null;
}

for (const el of [video, $('ovHit')]) {
  el.addEventListener('pointerdown', swipeStart);
  el.addEventListener('pointermove', swipeMove, { passive: false });
  ['pointerup', 'pointercancel'].forEach((ev) => el.addEventListener(ev, swipeEnd));
  // Nach dem Wischen kein „Tippen“ hinterher (Bedienung ein/aus, Play/Pause)
  el.addEventListener('click', (e) => { if (Date.now() - swipeEndedAt < 400) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
