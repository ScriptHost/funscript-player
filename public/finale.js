'use strict';

// ===========================================================================
// 🔥 Finale: auf Knopfdruck ruhiger – zwei Varianten (⚙️ Einstellungen):
//   detach („Komplett lösen“): Handy vom Script gelöst, fährt gleichmäßig mit eigener
//          Geschwindigkeit im eigenen Hub-Bereich; Vibrator mit fester Stärke.
//   soft   („Script weiter, sanfter“): Handy bleibt im Takt des Videos, nur mit
//          kleinerem Hub-Bereich; Vibrator folgt dem Script mit reduzierter Stärke.
// Das Video spielt weiter. Nochmal drücken (oder nach der eingestellten Zeit)
// geht es zurück zum normalen Video-Sync.
// ===========================================================================

const fin = { active: false, timer: null, mode: 'detach', speed: 30, vibe: 50, min: 40, max: 70, time: 0, half: true };
const FIN_KEYS = ['speed', 'vibe', 'min', 'max', 'time'];

// Komplett gelöst? (dann darf der Video-Sync die Handy nicht zurückholen)
const finDetached = () => fin.active && fin.mode === 'detach';

// ---------------------------------------------------------------------------
// Halbes Tempo (wie „FunHalver“): aus je zwei Stößen wird einer. Die Wendepunkte
// des Scripts bleiben auf den Zeitpunkten des Videos – nur jeder zweite wird
// genutzt –, daher bleibt die Bewegung im Takt, aber halb so schnell.
// ---------------------------------------------------------------------------
let halfCache = { src: null, actions: null };
function halveActions(actions) {
  // Wendepunkte (Richtungswechsel) finden
  const ext = [];
  for (let i = 0; i < actions.length; i++) {
    const prev = actions[i - 1], cur = actions[i], next = actions[i + 1];
    if (!prev || !next || (cur.pos - prev.pos) * (next.pos - cur.pos) <= 0) ext.push(cur);
  }
  if (ext.length < 5) return actions;
  // Je zwei Halbbewegungen zusammenfassen: unten/oben im Wechsel, mit den Extremwerten des Abschnitts
  // Erster Punkt bleibt, wie er ist (gleiche Phase wie das Original), dann im Wechsel
  const out = [ext[0]];
  let up = ext[1].pos > ext[0].pos;
  for (let i = 2; i < ext.length; i += 2) {
    const window = ext.slice(Math.max(0, i - 1), i + 2).map((e) => e.pos);
    out.push({ at: ext[i].at, pos: up ? Math.max(...window) : Math.min(...window) });
    up = !up;
  }
  return out;
}

// Welche Aktionen gerade an Handy und Vibrator gehen (normal oder halbes Tempo)
function effectiveActions(actions) {
  if (!(fin.active && fin.mode === 'soft' && fin.half) || !actions) return actions;
  if (halfCache.src !== actions) halfCache = { src: actions, actions: halveActions(actions) };
  return halfCache.actions;
}

function finSave() {
  const { active, timer, ...save } = fin;
  store.set('finale', save);
}

function finLoad() {
  Object.assign(fin, store.get('finale', {}));
  for (const k of FIN_KEYS) $('fin_' + k).value = fin[k];
  finOutputs();
}

function finOutputs() {
  const soft = fin.mode === 'soft';
  $('fin_speedVal').textContent = `${fin.speed} %`;
  $('fin_vibeVal').textContent = soft ? `${fin.vibe} % vom Script` : `${fin.vibe} %`;
  $('fin_minVal').textContent = `${fin.min} %`;
  $('fin_maxVal').textContent = `${fin.max} %`;
  $('fin_timeVal').textContent = fin.time ? `${fin.time} s` : 'nie';
  $('finSpeedRow').hidden = soft;
  $('finHalfRow').hidden = !soft;
  $('fin_half').checked = fin.half;
  $('finVibeLabel').textContent = soft ? 'Vibration (Anteil)' : 'Vibration';
  $('finModeInfo').textContent = soft
    ? 'Die Handy bleibt im Takt des Videos, fährt aber nur im Hub-Bereich unten – kleiner Bereich = sanfter. Der Vibrator folgt dem Script mit dem eingestellten Anteil.'
    : 'Die Handy wird vom Script gelöst und fährt gleichmäßig mit eigener Geschwindigkeit im Hub-Bereich unten. Der Vibrator läuft mit fester Stärke.';
  document.querySelectorAll('#finMode button').forEach((b) => b.classList.toggle('active', b.dataset.fin === fin.mode));
}

for (const k of FIN_KEYS) {
  $('fin_' + k).addEventListener('input', async () => {
    fin[k] = Number($('fin_' + k).value);
    if (fin.min >= fin.max) { // Bereich gültig halten
      if (k === 'min') fin.max = Math.min(100, fin.min + 5); else fin.min = Math.max(0, fin.max - 5);
      $('fin_min').value = fin.min;
      $('fin_max').value = fin.max;
    }
    finOutputs();
    finSave();
    // Während Finale läuft: Änderungen sofort übernehmen
    if (fin.active && handy.connected) {
      try {
        if (k === 'speed' && finDetached()) await handy.hampVelocity(Math.min(fin.speed, Number($('capSpeed').value)));
        if (k === 'min' || k === 'max') await handy.slide(fin.min, fin.max);
      } catch (e) { log(e, true); }
    }
  });
}

$('fin_half').addEventListener('change', () => {
  fin.half = $('fin_half').checked;
  finSave();
  if (fin.active && fin.mode === 'soft') resync(); // neues Script sofort übertragen
});

document.querySelectorAll('#finMode button').forEach((b) => b.addEventListener('click', async () => {
  if (fin.mode === b.dataset.fin) return;
  const wasActive = fin.active;
  if (wasActive) await finaleStop(true); // laufendes Finale im neuen Modus neu starten
  fin.mode = b.dataset.fin;
  finSave();
  finOutputs();
  finUI();
  if (wasActive) finaleStart();
}));

function finUI() {
  for (const id of ['ovFinale', 'finaleBtn']) $(id).classList.toggle('running', fin.active);
  const name = fin.mode === 'soft' ? 'sanfter' : 'gelöst';
  $('finaleBtn').textContent = fin.active ? `🔥 Finale (${name}) beenden – zurück zum Sync` : `🔥 Finale (${name})`;
}

async function finaleStart() {
  if (!handy.connected && !allVibes().length) return log('Bitte zuerst die Handy oder einen Vibrator verbinden.', true);
  fin.active = true;
  finUI();
  if (fin.mode === 'detach') {
    claimHandy('finale');
    if (handy.connected) {
      try {
        await handy.slide(fin.min, fin.max);
        await handy.hampStart(Math.min(fin.speed, Number($('capSpeed').value)));
        setStatus('on', 'Finale');
      } catch (e) { log(e, true); }
    }
    log('🔥 Finale – Script entkoppelt.');
  } else {
    // Sanfter: Script läuft weiter, kleinerer Hub-Bereich, optional halbes Tempo
    if (handy.connected) {
      try {
        await handy.slide(fin.min, fin.max);
        setStatus('on', 'Finale (sanfter)');
      } catch (e) { log(e, true); }
    }
    if (fin.half) resync(); // halbiertes Script an der aktuellen Stelle übernehmen
    log(`🔥 Finale – Script läuft sanfter weiter${fin.half ? ' (halbes Tempo)' : ''}.`);
  }
  clearTimeout(fin.timer);
  if (fin.time) fin.timer = setTimeout(() => finaleStop(), fin.time * 1000);
}

async function finaleStop(quiet = false) {
  if (!fin.active) return;
  const wasDetached = finDetached();
  fin.active = false;
  clearTimeout(fin.timer);
  finUI();
  if (handy.connected) {
    try {
      if (wasDetached && handy.owner === 'finale') {
        await handy.hampStop();
        handy.owner = null;
      }
      await applySlide(); // eigenen Hub wiederherstellen
      setStatus('on', 'verbunden');
    } catch (e) { log(e, true); }
  }
  resync(); // läuft das Video, übernimmt der normale Sync wieder
  if (!quiet) log('Finale beendet – zurück zum normalen Sync.');
}

const finaleToggle = () => (fin.active ? finaleStop() : finaleStart());
$('ovFinale').addEventListener('click', () => { finaleToggle(); showOverlay(); });
$('finaleBtn').addEventListener('click', finaleToggle);
document.addEventListener('keydown', (e) => {
  if (e.key === 'o' && !e.target.closest('input, select, textarea')) finaleToggle();
});

// Not-Aus oder ein anderer Bereich (Pattern, Direktsteuerung) übernimmt: Finale ist vorbei
document.addEventListener('handy-owner', (e) => {
  if (!fin.active || e.detail === 'finale' || e.detail === 'video') return;
  fin.active = false;
  clearTimeout(fin.timer);
  finUI();
  if (handy.connected) applySlide().catch(() => {});
});

finLoad();
finUI();
