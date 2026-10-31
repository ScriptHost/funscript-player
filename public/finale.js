'use strict';

// ===========================================================================
// 🔥 Finale: löst die Handy vom Script und fährt gleichmäßig in einem eigenen
// Bereich (Standard: langsam, flacher Hub), der Vibrator läuft mit fester Stärke.
// Das Video spielt weiter. Nochmal drücken (oder nach der eingestellten Zeit)
// geht es zurück zum normalen Video-Sync. Werte in ⚙️ Einstellungen.
// ===========================================================================

const fin = { active: false, timer: null, speed: 30, vibe: 50, min: 40, max: 70, time: 0 };
const FIN_KEYS = ['speed', 'vibe', 'min', 'max', 'time'];

function finLoad() {
  Object.assign(fin, store.get('finale', {}));
  for (const k of FIN_KEYS) $('fin_' + k).value = fin[k];
  finOutputs();
}
function finOutputs() {
  $('fin_speedVal').textContent = `${fin.speed} %`;
  $('fin_vibeVal').textContent = `${fin.vibe} %`;
  $('fin_minVal').textContent = `${fin.min} %`;
  $('fin_maxVal').textContent = `${fin.max} %`;
  $('fin_timeVal').textContent = fin.time ? `${fin.time} s` : 'nie';
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
    const { active, timer, ...save } = fin;
    store.set('finale', save);
    // Während Finale läuft: Änderungen sofort übernehmen
    if (fin.active && handy.connected) {
      try {
        if (k === 'speed') await handy.hampVelocity(Math.min(fin.speed, Number($('capSpeed').value)));
        if (k === 'min' || k === 'max') await handy.slide(fin.min, fin.max);
      } catch (e) { log(e, true); }
    }
  });
}

function finUI() {
  for (const id of ['ovFinale', 'finaleBtn']) $(id).classList.toggle('running', fin.active);
  $('finaleBtn').textContent = fin.active ? '🔥 Finale beenden – zurück zum Sync' : '🔥 Finale';
}

async function finaleStart() {
  if (!handy.connected && !allVibes().length) return log('Bitte zuerst die Handy oder einen Vibrator verbinden.', true);
  fin.active = true;
  finUI();
  claimHandy('finale');
  if (handy.connected) {
    try {
      await handy.slide(fin.min, fin.max);
      await handy.hampStart(Math.min(fin.speed, Number($('capSpeed').value)));
      setStatus('on', 'Finale');
    } catch (e) { log(e, true); }
  }
  clearTimeout(fin.timer);
  if (fin.time) fin.timer = setTimeout(() => finaleStop(), fin.time * 1000);
  log('🔥 Finale – Script entkoppelt.');
}

async function finaleStop() {
  if (!fin.active) return;
  fin.active = false;
  clearTimeout(fin.timer);
  finUI();
  if (handy.connected && handy.owner === 'finale') {
    try {
      await handy.hampStop();
      await applySlide(); // eigenen Hub wiederherstellen
    } catch (e) { log(e, true); }
    handy.owner = null;
    setStatus('on', 'verbunden');
  }
  resync(); // läuft das Video, übernimmt der Sync wieder
  log('Finale beendet – zurück zum Video-Sync.');
}

const finaleToggle = () => (fin.active ? finaleStop() : finaleStart());
$('ovFinale').addEventListener('click', () => { finaleToggle(); showOverlay(); });
$('finaleBtn').addEventListener('click', finaleToggle);
document.addEventListener('keydown', (e) => {
  if (e.key === 'o' && !e.target.closest('input, select, textarea')) finaleToggle();
});

// Not-Aus oder ein anderer Bereich übernimmt: Finale ist vorbei
document.addEventListener('handy-owner', (e) => {
  if (fin.active && e.detail !== 'finale') {
    fin.active = false;
    clearTimeout(fin.timer);
    finUI();
  }
});

finLoad();
finUI();
