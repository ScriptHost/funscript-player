'use strict';

// ===========================================================================
// Bewegungsgeräte über Intiface – z. B. The Handy per Bluetooth als Offline-Weg,
// wenn kein Internet da ist (die normale Handy-Steuerung läuft über die Handy-Cloud).
// Intiface bekommt Befehle „fahre in x ms auf Position y“ (Buttplug LinearCmd).
// Quelle wie beim Vibrator: Video-Script / Pattern / Script-Baukasten, Direktsteuerung
// und Finale „Komplett lösen“ als gleichmäßige Bewegung. Hub-Begrenzung, Umkehren und
// Offset gelten wie bei der WLAN-Handy.
// ===========================================================================

const bt = { lastIdx: -1, lastMs: 0, flipAt: 0, up: false, moving: false, halted: false };
const strokers = () => [...vibe.devices.values()].filter((d) => d.linear?.length && d.enabled);

$('btLead').value = store.get('btLead', 80);
const btLeadOut = () => { $('btLeadVal').textContent = `${$('btLead').value} ms`; };
btLeadOut();
$('btLead').addEventListener('input', () => { store.set('btLead', Number($('btLead').value)); btLeadOut(); });

// Hub-Bereich: im Finale dessen Bereich, sonst Hub min/max aus der Handy-Karte
function strokeRange() {
  if (typeof fin !== 'undefined' && fin.active) return [fin.min, fin.max];
  if (typeof selfHampLevel === 'function' && selfHampLevel() !== null) return selfStrokeRange(true); // „Selbst steuern“ mit Hublänge
  return [Number($('slideMin').value), Number($('slideMax').value)];
}
function mapPos(pos) {
  if ($('invert').checked) pos = 100 - pos;
  const [lo, hi] = strokeRange();
  return (lo + ((hi - lo) * pos) / 100) / 100;
}

function moveAll(pos01, duration) {
  for (const d of strokers()) d.move(pos01, duration).catch(() => {});
  bt.moving = true;
}
function stopAll() {
  for (const d of strokers()) d.stop().catch(() => {});
  bt.moving = false;
  bt.lastIdx = -1;
}

// Gleichmäßig hin und her: Geschwindigkeit 0–1 -> 0,3 bis 3 Stöße pro Sekunde
function oscillate(speed) {
  const now = performance.now();
  if (now < bt.flipAt) return;
  const half = 1000 / (2 * (0.3 + speed * 2.7));
  bt.up = !bt.up;
  const [lo, hi] = strokeRange();
  moveAll((bt.up ? hi : lo) / 100, half);
  bt.flipAt = now + half;
  bt.lastIdx = -1;
}

setInterval(() => {
  const list = strokers();
  if (!list.length || touchPosActive()) return; // Touch „Position“ bewegt die Geräte gerade selbst

  let src = null, isVideo = false, osc = null;
  if (typeof finDetached === 'function' && finDetached()) osc = fin.speed / 100;
  else if (hampOn) osc = Number($('speed').value) / 100;
  else {
    src = controlScriptSource();
    if (!src) { src = videoScriptSource(); isVideo = !!src; }
  }

  if (bt.halted || (!src && osc === null)) {
    if (bt.moving) stopAll();
    return;
  }
  if (osc !== null) return oscillate(osc);

  // Script folgen: beim Erreichen jedes Punkts den nächsten anfahren
  const ms = src.ms + Number($('btLead').value) + (isVideo ? Number($('offset').value) : 0);
  const a = src.actions;
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].at <= ms) lo = mid + 1; else hi = mid; }
  if (lo >= a.length) return;
  const jumped = Math.abs(ms - bt.lastMs) > 400; // gespult oder Pause beendet
  bt.lastMs = ms;
  if (lo === bt.lastIdx && !jumped) return;
  bt.lastIdx = lo;
  moveAll(mapPos(a[lo].pos), a[lo].at - ms);
}, 20);

// Not-Aus: sofort anhalten; erst wieder bewegen, wenn etwas Neues startet
document.addEventListener('handy-owner', (e) => {
  bt.halted = e.detail === 'none';
  if (bt.halted && bt.moving) stopAll();
});
video.addEventListener('play', () => { bt.halted = false; });
$('hampToggle').addEventListener('click', () => { bt.halted = false; });

// Status: ohne WLAN-Verbindung, aber mit Bluetooth-Handy über Intiface
setInterval(() => {
  if (handy.connected) return;
  const n = strokers().length;
  if (n) setStatus('on', `Bluetooth (Intiface)${n > 1 ? ` ×${n}` : ''}`);
}, 1000);
