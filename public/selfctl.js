'use strict';

// ===========================================================================
// Selbst steuern – für Videos ohne Funscript.
//   Unter dem Video „Aus · Selbst steuern“. Bei „Selbst steuern“ laufen die Handy
//   (Geschwindigkeit, Start/Stopp) und der Satisfyer (eigene Stärke) mit, solange
//   das Video läuft. Pause/Ende hält an, STOPP schaltet die Handy aus.
//   Handy per WLAN: HAMP (Handy bewegt sich selbst). Per Bluetooth/Intiface: über
//   hampLevel() wie die Direktsteuerung (stroker.js). Grenze aus ⚙️ → Sicherheit.
//   Gemerkt werden die Wahl Aus/Selbst steuern und die Regler, nicht „Handy läuft“.
// ===========================================================================
const selfCtl = {
  mode: store.get('selfMode', 'off'),
  handyOn: false,
  speed: store.get('selfSpeed', 40),
  // Hub unten/oben in % des eingestellten Hubs (Hub min/max) – frei wählbar, z. B. nur oben
  lo: store.get('selfLo', null),
  hi: store.get('selfHi', null),
  vibe: store.get('selfVibe', 0),
  sent: 0,       // an die Handy gesendete Geschwindigkeit (0 = steht)
  again: false,  // Änderung kam, während ein Befehl lief
  busy: false,
};

// Bis 1.19.1 gab es nur „Hublänge“ um die Mitte – einmalig in unten/oben umrechnen
if (selfCtl.lo === null || selfCtl.hi === null) {
  const s = store.get('selfStroke', 100);
  selfCtl.lo = Math.round((100 - s) / 2);
  selfCtl.hi = 100 - selfCtl.lo;
}
const SELF_GAP = 10; // kleinster Abstand unten–oben in %

const selfVideoLoaded =() => (remote.on ? !!remote.state?.src : !!nowPlaying);
// Läuft „Selbst steuern“ gerade? (Sync an, Video ohne Script, Video läuft)
function selfActive() {
  // Bewusste Wahl -> gilt in jedem Modus, auch bei „nur schauen“
  return selfCtl.mode === 'self' && !script && selfVideoLoaded() && videoPlaying();
}
const selfSpeed = () => Math.min(selfCtl.speed, Number($('capSpeed').value));

// Für stroker.js (Handy per Bluetooth) über control.js hampLevel()
function selfHampLevel() {
  return selfActive() && selfCtl.handyOn && selfSpeed() > 0 ? selfSpeed() / 100 : null;
}
// Für vibe.js: eigene Stärke statt Script (null = nicht zuständig)
function selfVibeLevel() {
  return selfActive() ? selfCtl.vibe / 100 : null;
}
// Für den STOPP-Knopf / Bildschirm-wach-halten
function selfRunning() {
  return selfActive() && ((selfCtl.handyOn && selfSpeed() > 0) || selfCtl.vibe > 0);
}

function selfUI() {
  // Nur mit verbundenem Gerät – oder wenn „Selbst steuern“ gewählt ist (dann mit Hinweis zum Verbinden).
  // Welche Regler erscheinen, regelt CSS nach den verbundenen Geräten (has-handy / has-vibe).
  $('selfRow').hidden = !selfVideoLoaded() || !!script || document.body.dataset.view !== 'player'
    || !(selfCtl.mode === 'self' || (typeof hasHandy === 'function' && (hasHandy() || hasVibe())));
  document.querySelector('.self-head > span').textContent = typeof suspended !== 'undefined' && suspended ? 'Script angehalten' : 'Kein Funscript';
  document.querySelectorAll('#selfSeg button').forEach((b) => b.classList.toggle('active', b.dataset.self === selfCtl.mode));
  $('selfCtl').hidden = selfCtl.mode !== 'self';
  $('selfSpeed').value = selfCtl.speed;
  $('selfLo').value = selfCtl.lo;
  $('selfHi').value = selfCtl.hi;
  $('selfLoVal').textContent = `${selfCtl.lo} %`;
  $('selfHiVal').textContent = `${selfCtl.hi} %`;
  $('selfSpeedVal').textContent = `${selfSpeed()} %${selfSpeed() < selfCtl.speed ? ' (Grenze)' : ''}`;
  $('selfVibe').value = selfCtl.vibe;
  $('selfVibeVal').textContent = `${selfCtl.vibe} %`;
  $('selfHandy').textContent = selfCtl.handyOn ? '■ Handy' : '▶ Handy';
  $('selfHandy').classList.toggle('running', selfCtl.handyOn);
}

// Handy per WLAN nachführen: starten, Tempo ändern, anhalten
// Hub unten/oben: Teilbereich des eingestellten Hubs (Hub min/max); beim Stopp wieder voller Hub
function selfStrokeRange(on = true) {
  const lo = Number($('slideMin').value), hi = Number($('slideMax').value);
  if (!on || (selfCtl.lo <= 0 && selfCtl.hi >= 100)) return [lo, hi];
  return [Math.round(lo + ((hi - lo) * selfCtl.lo) / 100), Math.round(lo + ((hi - lo) * selfCtl.hi) / 100)];
}
function selfApplyStroke(on = true) {
  if (handy.connected) handy.slide(...selfStrokeRange(on)).catch(() => {});
}
async function selfTick() {
  selfUI();
  if (!handy.connected) return;
  // Läuft noch ein Befehl: direkt danach nachsenden statt auf den nächsten Takt zu warten
  if (selfCtl.busy) { selfCtl.again = true; return; }
  const want = selfHampLevel() !== null ? selfSpeed() : 0;
  if (want === selfCtl.sent || touchPosActive()) return; // Touch „Position“ steuert die Handy gerade direkt
  selfCtl.busy = true;
  try {
    if (want && !selfCtl.sent) {
      claimHandy('self');
      selfApplyStroke(true);
      await handy.hampStart(want);
    } else if (want) {
      await handy.hampVelocity(want);
    } else if (handy.owner === 'self') {
      await handy.hampStop();
      selfApplyStroke(false);
    }
    selfCtl.sent = want;
  } catch (e) {
    log(e, true);
  } finally {
    selfCtl.busy = false;
    if (selfCtl.again) { selfCtl.again = false; selfTick(); }
  }
}
setInterval(selfTick, 250);
['play', 'pause', 'ended', 'emptied'].forEach((ev) => video.addEventListener(ev, () => setTimeout(selfTick, 0)));

// Jemand anderes übernimmt die Handy; STOPP (Besitzer „none“) schaltet sie hier aus
document.addEventListener('handy-owner', (e) => {
  if (e.detail === 'self') return;
  selfCtl.sent = 0;
  if (e.detail === 'none') selfCtl.handyOn = false;
  selfUI();
});

document.querySelectorAll('#selfSeg button').forEach((b) => b.addEventListener('click', () => {
  selfCtl.mode = b.dataset.self;
  store.set('selfMode', selfCtl.mode);
  if (selfCtl.mode === 'off') selfCtl.handyOn = false;
  selfTick();
}));
$('selfHandy').addEventListener('click', () => {
  if (!selfCtl.handyOn && !handy.connected && !strokers().length) log('Handy ist nicht verbunden – Satisfyer läuft trotzdem.', true);
  selfCtl.handyOn = !selfCtl.handyOn;
  touchSync('self', selfCtl.handyOn ? selfCtl.speed : null);
  selfTick();
});
const setSelfSpeed = (v) => {
  selfCtl.speed = Number(v);
  store.set('selfSpeed', selfCtl.speed);
  if (selfCtl.handyOn) touchSync('self', selfCtl.speed);
  selfTick();
};
const setSelfVibe = (v) => { selfCtl.vibe = Number(v); store.set('selfVibe', selfCtl.vibe); selfUI(); };
$('selfSpeed').addEventListener('input', () => setSelfSpeed($('selfSpeed').value));
// Unten/oben schieben sich gegenseitig, damit immer ein Hub von mindestens SELF_GAP bleibt
['selfLo', 'selfHi'].forEach((id) => {
  $(id).addEventListener('input', () => {
    const v = Number($(id).value);
    if (id === 'selfLo') { selfCtl.lo = Math.min(v, 100 - SELF_GAP); selfCtl.hi = Math.max(selfCtl.hi, selfCtl.lo + SELF_GAP); }
    else { selfCtl.hi = Math.max(v, SELF_GAP); selfCtl.lo = Math.min(selfCtl.lo, selfCtl.hi - SELF_GAP); }
    selfUI();
  });
  $(id).addEventListener('change', () => {
    store.set('selfLo', selfCtl.lo);
    store.set('selfHi', selfCtl.hi);
    if (selfCtl.sent) selfApplyStroke(true);
  });
});
$('selfVibe').addEventListener('input', () => setSelfVibe($('selfVibe').value));
document.querySelectorAll('#selfChips button').forEach((b) => b.addEventListener('click', () => {
  if (!selfCtl.handyOn) selfCtl.handyOn = true;
  setSelfSpeed(b.dataset.v);
}));
document.querySelectorAll('#selfVibeChips button').forEach((b) => b.addEventListener('click', () => setSelfVibe(b.dataset.v)));
selfUI();

// ---------------------------------------------------------------------------
// ⏺ Mitschnitt zum Video: zeichnet die Steuerung (Regler, Schnellwahl, Touch) an der
// Video-Zeit auf -> wird ein Funscript zu diesem Video (Tempo der Stöße = Stärke).
// ---------------------------------------------------------------------------
let selfRec = null, selfRecTimer = null, selfRecActions = null, selfRecPos = false;
// Touch „Position“: aufgenommen wird die Finger-Position (wird ein Positions-Script), sonst das Tempo
const selfRecValue = () => {
  if (touchMode() === 'pos') return videoPlaying() && tpos.cur !== null ? tpos.cur : null;
  const v = Math.max(selfCtl.handyOn ? selfSpeed() : 0, selfCtl.vibe);
  return selfActive() && v > 0 ? v : null;
};
$('selfRec').addEventListener('click', () => {
  if (!selfRec) {
    selfRec = [];
    selfRecPos = touchMode() === 'pos';
    selfRecTimer = setInterval(() => { if (videoPlaying()) selfRec.push([Math.round(mediaTime() * 1000), selfRecValue()]); }, 100);
    $('selfRec').textContent = '■ Mitschnitt beenden';
    $('selfRec').classList.add('recording');
    $('selfRecSave').hidden = $('selfRecFile').hidden = $('selfRecSection').hidden = true;
    $('selfRecInfo').textContent = 'läuft – steuere wie gewohnt';
    return;
  }
  clearInterval(selfRecTimer);
  $('selfRec').textContent = '⏺ Mitschnitt zum Video';
  $('selfRec').classList.remove('recording');
  // Spulen: nach Zeit sortieren; Lücken (Pause/Sprung) gelten als losgelassen
  const samples = selfRec.sort((a, b) => a[0] - b[0]);
  selfRec = null;
  const withGaps = [];
  for (let i = 0; i < samples.length; i++) {
    withGaps.push(samples[i]);
    if (samples[i + 1] && samples[i + 1][0] - samples[i][0] > 600) withGaps.push([samples[i][0] + 150, null]);
  }
  if (!withGaps.some((x) => x[1])) { $('selfRecInfo').textContent = 'nichts aufgenommen – Video abspielen und steuern'; return; }
  const start = withGaps[0][0], end = withGaps[withGaps.length - 1][0];
  selfRecActions = selfRecPos ? touchToPositionActions(samples.filter((x) => x[1] !== null)) : touchToTempoActions(withGaps, end, start);
  $('selfRecInfo').textContent = `${Math.round((end - start) / 1000)} s · ${selfRecActions.length} Punkte`;
  $('selfRecSave').hidden = $('selfRecFile').hidden = false;
  // Gibt es schon ein eigenes Script: ganz ersetzen oder nur den aufgenommenen Abschnitt
  $('selfRecSection').hidden = !scriptMeta.hasOwn;
  $('selfRecSave').textContent = scriptMeta.hasOwn ? '💾 Eigenes Script ganz ersetzen' : '💾 Als Script zu diesem Video speichern';
});
$('selfRecSave').addEventListener('click', () => saveScriptToLibrary(selfRecActions, 'all'));
$('selfRecSection').addEventListener('click', () => saveScriptToLibrary(selfRecActions, 'section'));
$('selfRecFile').addEventListener('click', () => downloadFunscript(selfRecActions, nowPlaying?.title || nowPlaying?.name || 'mitschnitt'));
