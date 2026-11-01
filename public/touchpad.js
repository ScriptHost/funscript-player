'use strict';

// ===========================================================================
// Touch-Steuerung – wie in der Satisfyer-App.
//   Eine Finger-Fläche unter 🎮 Steuern und bei „Selbst steuern“ am Video:
//   Finger oben = stark/schnell, unten = schwach/langsam. Loslassen = aus,
//   wahlweise „beim Loslassen halten“. Pro Fläche: ↕ Handy und/oder 〰 Satisfyer
//   (nur verbundene Geräte werden angeboten). Grenzen aus ⚙️ → Sicherheit gelten,
//   STOPP setzt zurück.
//   ⏺ Aufnehmen: Finger-Verlauf -> Pattern, .funscript oder neben das Video.
//   Umschalter an der Fläche: Tempo (Finger-Höhe = Tempo der Stöße) oder 🧪 Position (Beta:
//   die Handy folgt dem Finger, live und in der Aufnahme).
// ===========================================================================
const touch = { vibe: null }; // Satisfyer-Stärke aus der Fläche unter 🎮 Steuern (0–1) oder null

// Für vibe.js: nur auf der Seite 🎮 Steuern (bei „Selbst steuern“ läuft es über selfctl.js)
function touchVibeLevel() {
  return document.body.dataset.view === 'control' ? touch.vibe : null;
}

// Regler, Schnellwahl und Start/Stopp melden ihren Wert, damit die Fläche dasselbe zeigt
const touchSync = (pad, v) => document.dispatchEvent(new CustomEvent('tp-value', { detail: { pad, v } }));

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

// ---------------------------------------------------------------------------
// Modus „Position“ (Beta): die Handy folgt dem Finger direkt (WLAN: Direkt-Position HDSP,
// Bluetooth/Intiface: Positionsbefehle). Höchstens alle 100 ms ein Befehl, immer der neueste Wert.
// ---------------------------------------------------------------------------
const tpos = { active: false, pending: null, last: null, timer: null, owner: null };
const touchMode = () => store.get('touchMode', 'tempo');
function touchPosActive() { return tpos.active; }

function touchPosSend(v, owner) {
  tpos.active = true;
  tpos.pending = v;
  tpos.owner = owner;
  if (strokers().length) moveAll(mapPos(v), 100);
  if (!handy.connected || tpos.timer) return;
  const flush = async () => {
    const want = tpos.pending;
    if (want === null || !tpos.active) { tpos.timer = null; return; }
    tpos.pending = null;
    if (handy.owner !== tpos.owner) claimHandy(tpos.owner);
    const pos = $('invert').checked ? 100 - want : want;
    // Dauer passend zum Weg, nicht schneller als die Handy kann
    const dur = Math.max(100, Math.min(800, (Math.abs(pos - (tpos.last ?? pos)) / handyMaxSpeed()) * 1000));
    tpos.last = pos;
    try { await handy.hdspMove(pos, dur); } catch (e) { log(e, true); }
    tpos.timer = setTimeout(flush, 100);
  };
  tpos.timer = setTimeout(flush, 0);
}
function touchPosEnd() {
  tpos.active = false;
  tpos.pending = null;
}

// ---------------------------------------------------------------------------
// Aufnahme -> Funscript-Aktionen
// ---------------------------------------------------------------------------
// samples: [[ms, wert 0–100 | null (losgelassen)]] im Abstand von ~50 ms
function touchToTempoActions(samples, end, start = 0) {
  const valueAt = (t) => { let v = null; for (const [ts, x] of samples) { if (ts > t) break; v = x; } return v; };
  const out = [{ at: start, pos: 10 }];
  let t = start, up = true;
  while (t < end) {
    const v = valueAt(t);
    if (!v) { t += 100; continue; }                // losgelassen/0 = Pause, Position bleibt
    t += Math.round(900 - v * 7.5);                // 0 % = 900 ms je Halbstoß … 100 % = 150 ms
    out.push({ at: t, pos: up ? 90 : 10 });
    up = !up;
  }
  return out;
}
function touchToPositionActions(samples) {
  const out = [];
  let last = 50;
  for (const [t, v] of samples) {
    const pos = v ?? last;
    if (!out.length || Math.abs(pos - out[out.length - 1].pos) >= 2 || t - out[out.length - 1].at >= 500) out.push({ at: t, pos });
    last = pos;
  }
  return out;
}

function setupTouchPad(pad) {
  const target = TOUCH_TARGETS[pad.dataset.touch];
  const area = pad.querySelector('.tp-area');
  const q = (cls) => pad.querySelector(cls);
  const on = (cls) => q(cls).checked && getComputedStyle(q(cls).closest('label')).display !== 'none';
  let down = false, cur = null, rec = null, recTimer = null, lastActions = null;

  const show = (v) => {
    q('.tp-fill').style.height = v === null ? '0' : `${v}%`;
    q('.tp-val').textContent = v === null ? '–' : `${v} %`;
  };
  const isSelf = pad.dataset.touch === 'self';
  const apply = (e) => {
    const r = area.getBoundingClientRect();
    const v = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) * 100);
    if (on('.tp-handy')) {
      if (touchMode() === 'pos') {
        // Am Video nur, solange es läuft (wie „Selbst steuern“ sonst auch)
        if (isSelf) { selfCtl.handyOn = false; selfCtl.sent = 0; selfUI(); }
        if (!isSelf || videoPlaying()) touchPosSend(v, isSelf ? 'self' : 'manual');
      } else target.handy(v);
    }
    if (on('.tp-vibe')) target.vibe(v);
    cur = v;
    show(v);
  };
  const release = () => {
    touchPosEnd(); // Position: Handy bleibt, wo sie ist
    if (q('.tp-hold').checked) return;
    if (touchMode() !== 'pos') target.handyOff();
    target.vibeOff();
    cur = null;
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
    const cb = q(cls);
    cb.checked = store.get(key, def);
    cb.addEventListener('change', () => {
      store.set(key, cb.checked);
      document.querySelectorAll(`.touchpad ${cls}`).forEach((x) => { x.checked = cb.checked; });
      if (cls === '.tp-handy' && !cb.checked) target.handyOff();
      if (cls === '.tp-vibe' && !cb.checked) target.vibeOff();
      if (cls === '.tp-hold' && !cb.checked && !down) release();
    });
  }

  // ⏺ Aufnahme
  q('.tp-rec').addEventListener('click', () => {
    if (!rec) {
      rec = { t0: performance.now(), samples: [] };
      recTimer = setInterval(() => rec.samples.push([Math.round(performance.now() - rec.t0), cur]), 50);
      q('.tp-rec').textContent = '■ Aufnahme beenden';
      q('.tp-rec').classList.add('recording');
      q('.tp-recout').hidden = true;
      return;
    }
    clearInterval(recTimer);
    const end = Math.round(performance.now() - rec.t0);
    const asPos = touchMode() === 'pos';
    lastActions = asPos ? touchToPositionActions(rec.samples) : touchToTempoActions(rec.samples, end);
    rec = null;
    q('.tp-rec').textContent = '⏺ Aufnehmen';
    q('.tp-rec').classList.remove('recording');
    if (lastActions.length < 3) return log('Aufnahme zu kurz – Finger auflegen, während ⏺ läuft.', true);
    q('.tp-recinfo').textContent = `Aufnahme ${Math.round(end / 1000)} s · ${lastActions.length} Punkte (${asPos ? 'Position' : 'Tempo'})`;
    // „Neben dem Video speichern“ nur bei Videos aus dem Ordner und wenn erlaubt
    q('.tp-save-lib').hidden = !(pad.dataset.touch === 'self' && nowKey() && store.get('saveScripts', true));
    q('.tp-recout').hidden = false;
  });
  q('.tp-save-pattern').addEventListener('click', () => {
    const len = lastActions[lastActions.length - 1].at || 1;
    const name = `Touch-Aufnahme ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    saveRecordingAsPattern(name, len, lastActions);
    log(`🎮 Als Pattern „${name}“ gespeichert (🎮 Steuern → Patterns).`);
  });
  q('.tp-save-file').addEventListener('click', () => downloadFunscript(lastActions, 'touch-aufnahme'));
  q('.tp-save-lib').addEventListener('click', () => saveScriptToLibrary(lastActions));

  // Regler/Schnellwahl geändert -> Fläche zeigt denselben Wert (nur Tempo; null = Handy steht)
  document.addEventListener('tp-value', (e) => {
    if (e.detail.pad !== pad.dataset.touch || down || touchMode() !== 'tempo') return;
    cur = e.detail.v;
    show(cur);
  });

  // STOPP: Fläche zurücksetzen (die Geräte hält emergencyStop selbst an)
  document.addEventListener('handy-owner', (e) => { if (e.detail === 'none') { touch.vibe = null; cur = null; show(null); } });
  show(null);
}

document.querySelectorAll('.touchpad').forEach(setupTouchPad);

// Umschalter Tempo | Position (gilt für alle Flächen und auch für ⏺ Aufnahmen)
function showTouchMode() {
  document.querySelectorAll('.tp-mode button').forEach((b) => b.classList.toggle('active', b.dataset.tpm === touchMode()));
  document.querySelectorAll('.tp-hint').forEach((h) => {
    h.textContent = touchMode() === 'pos' ? 'Finger auflegen – die Handy folgt dem Finger' : 'Finger auflegen – oben stark, unten schwach';
  });
}
document.querySelectorAll('.tp-mode button').forEach((b) => b.addEventListener('click', () => {
  if (touchMode() === b.dataset.tpm) return;
  store.set('touchMode', b.dataset.tpm);
  touchPosEnd();
  // Wechsel: laufende Bewegung beenden, damit nichts im alten Modus weiterläuft
  if (hampOn) toggleHamp();
  selfCtl.handyOn = false;
  selfUI();
  showTouchMode();
  if (b.dataset.tpm === 'pos') log('🧪 Position: Die Handy folgt deinem Finger. Hub min/max gelten.');
}));
showTouchMode();
