'use strict';

// ===========================================================================
// 🧪 Beta: Touch-Steuerung (⚙️ → Geräte, Standard aus) – wie in der Satisfyer-App.
//   Eine Finger-Fläche unter 🎮 Steuern und bei „Selbst steuern“ am Video:
//   Finger oben = stark/schnell, unten = schwach/langsam. Loslassen = aus,
//   wahlweise „beim Loslassen halten“. Pro Fläche wählbar: ↕ Handy und/oder 〰 Satisfyer.
//   Grenzen aus ⚙️ → Sicherheit gelten (setSpeed / selfSpeed / vibeMax), STOPP setzt zurück.
// ===========================================================================
const touch = { vibe: null }; // Satisfyer-Stärke aus der Fläche unter 🎮 Steuern (0–1) oder null

// Für vibe.js: nur auf der Seite 🎮 Steuern (bei „Selbst steuern“ läuft es über selfctl.js)
function touchVibeLevel() {
  return document.body.dataset.view === 'control' ? touch.vibe : null;
}

// Was die Flächen mit dem Wert (0–100) machen
const TOUCH_TARGETS = {
  control: {
    handy(v) {
      setSpeed(v);
      if (!hampOn && !touch.starting) { touch.starting = true; toggleHamp().finally(() => { touch.starting = false; }); }
    },
    handyOff() { if (hampOn) toggleHamp(); },
    vibe(v) { touch.vibe = v / 100; },
    vibeOff() { touch.vibe = null; },
  },
  self: {
    handy(v) { selfCtl.speed = v; selfCtl.handyOn = true; selfUI(); },
    handyOff() { selfCtl.handyOn = false; selfUI(); },
    vibe(v) { selfCtl.vibe = v; selfUI(); },
    vibeOff() { selfCtl.vibe = 0; selfUI(); },
  },
};

function setupTouchPad(pad) {
  const target = TOUCH_TARGETS[pad.dataset.touch];
  const area = pad.querySelector('.tp-area');
  const opt = (cls) => pad.querySelector(cls).checked;
  let down = false;

  const show = (v) => {
    pad.querySelector('.tp-fill').style.height = v === null ? '0' : `${v}%`;
    pad.querySelector('.tp-val').textContent = v === null ? '–' : `${v} %`;
  };
  const apply = (e) => {
    const r = area.getBoundingClientRect();
    const v = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) * 100);
    if (opt('.tp-handy')) target.handy(v);
    if (opt('.tp-vibe')) target.vibe(v);
    show(v);
  };
  const release = () => {
    if (opt('.tp-hold')) return;
    target.handyOff();
    target.vibeOff();
    show(null);
  };

  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = true;
    area.setPointerCapture(e.pointerId);
    setVibePaused(false); // neue Berührung nach STOPP = bewusst wieder an
    apply(e);
  });
  area.addEventListener('pointermove', (e) => { if (down) apply(e); });
  ['pointerup', 'pointercancel'].forEach((ev) => area.addEventListener(ev, () => { if (down) { down = false; release(); } }));

  // Geräte-Auswahl und „halten“ merken (für alle Geräte gleich); Abwählen schaltet ab
  for (const [cls, key, def] of [['.tp-handy', 'touchHandy', true], ['.tp-vibe', 'touchVibe', true], ['.tp-hold', 'touchHold', false]]) {
    const cb = pad.querySelector(cls);
    cb.checked = store.get(key, def);
    cb.addEventListener('change', () => {
      store.set(key, cb.checked);
      document.querySelectorAll(`.touchpad ${cls}`).forEach((x) => { x.checked = cb.checked; });
      if (cls === '.tp-handy' && !cb.checked) target.handyOff();
      if (cls === '.tp-vibe' && !cb.checked) target.vibeOff();
      if (cls === '.tp-hold' && !cb.checked && !down) release();
    });
  }
  // STOPP: Fläche zurücksetzen (die Geräte hält emergencyStop selbst an)
  document.addEventListener('handy-owner', (e) => { if (e.detail === 'none') { touch.vibe = null; show(null); } });
  show(null);
}

document.querySelectorAll('.touchpad').forEach(setupTouchPad);

// Beta-Schalter
const applyTouchBeta = () => document.body.classList.toggle('beta-touch', $('betaTouch').checked);
$('betaTouch').checked = store.get('betaTouch', false);
$('betaTouch').addEventListener('change', () => {
  store.set('betaTouch', $('betaTouch').checked);
  if (!$('betaTouch').checked) { touch.vibe = null; document.querySelectorAll('.touchpad .tp-fill').forEach((f) => { f.style.height = '0'; }); }
  applyTouchBeta();
});
applyTouchBeta();
