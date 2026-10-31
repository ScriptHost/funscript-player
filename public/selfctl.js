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
  vibe: store.get('selfVibe', 0),
  sent: 0,       // an die Handy gesendete Geschwindigkeit (0 = steht)
  busy: false,
};

const selfVideoLoaded = () => (remote.on ? !!remote.state?.src : !!nowPlaying);
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
  $('selfRow').hidden = !selfVideoLoaded() || !!script || document.body.dataset.view !== 'player'
    || !(typeof hasHandy === 'function' && (hasHandy() || hasVibe())); // nur mit verbundenem Gerät
  document.querySelectorAll('#selfSeg button').forEach((b) => b.classList.toggle('active', b.dataset.self === selfCtl.mode));
  $('selfCtl').hidden = selfCtl.mode !== 'self';
  $('selfSpeed').value = selfCtl.speed;
  $('selfSpeedVal').textContent = `${selfSpeed()} %${selfSpeed() < selfCtl.speed ? ' (Grenze)' : ''}`;
  $('selfVibe').value = selfCtl.vibe;
  $('selfVibeVal').textContent = `${selfCtl.vibe} %`;
  $('selfHandy').textContent = selfCtl.handyOn ? '■ Handy' : '▶ Handy';
  $('selfHandy').classList.toggle('running', selfCtl.handyOn);
}

// Handy per WLAN nachführen: starten, Tempo ändern, anhalten
async function selfTick() {
  selfUI();
  if (!handy.connected || selfCtl.busy) return;
  const want = selfHampLevel() !== null ? selfSpeed() : 0;
  if (want === selfCtl.sent) return;
  selfCtl.busy = true;
  try {
    if (want && !selfCtl.sent) {
      claimHandy('self');
      await handy.hampStart(want);
    } else if (want) {
      await handy.hampVelocity(want);
    } else if (handy.owner === 'self') {
      await handy.hampStop();
    }
    selfCtl.sent = want;
  } catch (e) {
    log(e, true);
  } finally {
    selfCtl.busy = false;
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
  selfTick();
});
const setSelfSpeed = (v) => { selfCtl.speed = Number(v); store.set('selfSpeed', selfCtl.speed); selfTick(); };
const setSelfVibe = (v) => { selfCtl.vibe = Number(v); store.set('selfVibe', selfCtl.vibe); selfUI(); };
$('selfSpeed').addEventListener('input', () => setSelfSpeed($('selfSpeed').value));
$('selfVibe').addEventListener('input', () => setSelfVibe($('selfVibe').value));
document.querySelectorAll('#selfChips button').forEach((b) => b.addEventListener('click', () => {
  setSelfSpeed(b.dataset.v);
  if (!selfCtl.handyOn) { selfCtl.handyOn = true; selfTick(); }
}));
document.querySelectorAll('#selfVibeChips button').forEach((b) => b.addEventListener('click', () => setSelfVibe(b.dataset.v)));
selfUI();

// ---------------------------------------------------------------------------
// ⏺ Mitschnitt zum Video: zeichnet die Steuerung (Regler, Schnellwahl, Touch) an der
// Video-Zeit auf -> wird ein Funscript zu diesem Video (Tempo der Stöße = Stärke).
// ---------------------------------------------------------------------------
let selfRec = null, selfRecTimer = null, selfRecActions = null;
const selfRecValue = () => {
  const v = Math.max(selfCtl.handyOn ? selfSpeed() : 0, selfCtl.vibe);
  return selfActive() && v > 0 ? v : null;
};
$('selfRec').addEventListener('click', () => {
  if (!selfRec) {
    selfRec = [];
    selfRecTimer = setInterval(() => { if (videoPlaying()) selfRec.push([Math.round(mediaTime() * 1000), selfRecValue()]); }, 100);
    $('selfRec').textContent = '■ Mitschnitt beenden';
    $('selfRec').classList.add('recording');
    $('selfRecSave').hidden = $('selfRecFile').hidden = true;
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
  selfRecActions = touchToTempoActions(withGaps, end, start);
  $('selfRecInfo').textContent = `${Math.round((end - start) / 1000)} s · ${selfRecActions.length} Punkte`;
  $('selfRecSave').hidden = $('selfRecFile').hidden = false;
});
$('selfRecSave').addEventListener('click', () => saveScriptToLibrary(selfRecActions));
$('selfRecFile').addEventListener('click', () => downloadFunscript(selfRecActions, nowPlaying?.title || nowPlaying?.name || 'mitschnitt'));
