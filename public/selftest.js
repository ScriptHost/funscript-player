import { video } from './state.js';
import { $, handy } from './handy.js';
import { backToLibrary, closeDevices, nowPlaying, openDevices, updateDevClasses } from './app.js';
import { currentPreset } from './tools.js';
import { selfCtl, selfStrokeRange } from './selfctl.js';

// ===========================================================================
// Selbsttest für die Entwicklung: Adresse mit ?selbsttest öffnen (seit 1.19.3 ohne Knopf in der Oberfläche –
// der Container prüft sich beim Start selbst, siehe lib/selfcheck.js). Spielt typische Abläufe mit einer
// SIMULIERTEN Handy durch (es geht nichts an die Handy-Cloud) und zeigt das Ergebnis als Liste. Braucht in der
// Bibliothek mindestens ein Ordner-Video mit und eins ohne Funscript.
// ===========================================================================
(async function selfTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info });
  const calls = [];
  // Handy simulieren: Anfragen werden mitgeschrieben statt gesendet
  handy.req = async (method, p, body, v2) => {
    calls.push({ method, p, body, v2 });
    if (p === '/connected') return { connected: true };
    if (p === '/servertime') return { serverTime: Date.now(), server_time: Date.now() };
    if (p === '/info') return { model: 'H01', hwVersion: '1' };
    return {};
  };
  handy.upload = async () => 'https://example.invalid/selbsttest.csv';
  const tile = (pred) => [...document.querySelectorAll('#sceneGrid .tile')].find(pred);

  try {
    await wait(1500);
    await handy.connect('selbsttest', 'app-id');
    updateDevClasses();
    check('Handy verbinden (simuliert)', handy.connected && /Verbunden|Connected/.test($('connect').textContent), $('connect').textContent);

    // Video ohne Funscript: Geräte-Regler weg, „Selbst steuern“ zeigt nur die Handy
    if ($('onlyScripts').checked) { $('onlyScripts').click(); await wait(800); }
    const plain = tile((t) => !t.querySelector('.badge'));
    if (plain) {
      plain.click();
      await wait(1500);
      document.querySelector('#selfSeg [data-self="off"]').click();
      await wait(700);
      check('Ohne Script + „Keine Steuerung“: Geräte-Regler ausgeblendet', document.body.classList.contains('dev-idle'));
      document.querySelector('#selfSeg [data-self="self"]').click();
      await wait(700);
      check('„Selbst steuern“: nur verbundene Geräte', getComputedStyle(document.querySelector('.self-vibe')).display === 'none'
        && getComputedStyle(document.querySelector('.self-handy')).display !== 'none');
      // Touch „Position“ mit Application ID -> Position 0–1
      video.muted = true;
      await video.play().catch(() => {});
      document.querySelector('#selfRow .tp-mode [data-tpm="pos"]').click();
      const area = document.querySelector('#selfRow .tp-area');
      const r = area.getBoundingClientRect();
      area.setPointerCapture = () => {};
      calls.length = 0;
      area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: r.left + 10, clientY: r.top + r.height / 2 }));
      await wait(300);
      area.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      const xpt = calls.find((c) => c.p === '/hdsp/xpt');
      check('Touch „Position“: Handy fährt auf halbe Höhe (0–1 mit App-ID)', xpt && Math.abs(xpt.body.position - 0.5) < 0.06, JSON.stringify(xpt?.body || null));
      document.querySelector('#selfRow .tp-mode [data-tpm="tempo"]').click();
      // Schnellwahl -> Fläche zeigt denselben Wert
      document.querySelector('#selfChips [data-v="90"]').click();
      await wait(200);
      check('Schnellwahl 90 -> Touch-Fläche zeigt 90 %', document.querySelector('#selfRow .tp-val').textContent.trim() === '90 %', document.querySelector('#selfRow .tp-val').textContent);
      // Hub unten/oben (1.19.2): Teilbereich des eingestellten Hubs – Werte danach wiederherstellen
      const keep = [selfCtl.lo, selfCtl.hi];
      selfCtl.lo = 50; selfCtl.hi = 100;
      const rng = selfStrokeRange(true);
      selfCtl.lo = keep[0]; selfCtl.hi = keep[1];
      const full = [Number($('slideMin').value), Number($('slideMax').value)];
      check('Hub unten 50 / oben 100 -> obere Hälfte des Hubs', rng[0] === Math.round(full[0] + (full[1] - full[0]) / 2) && rng[1] === full[1], `${rng.join('–')} von ${full.join('–')}`);
      $('selfHandy').click();
      video.pause();
    } else check('Video ohne Funscript vorhanden', false, 'in /media fehlt ein Video ohne .funscript');

    // Video mit Funscript: Script-Bereich, Standards je Gerät
    backToLibrary();
    await wait(600);
    const withScript = tile((t) => t.querySelector('.badge')?.textContent.includes('⚡'));
    if (withScript) {
      withScript.click();
      await wait(1800);
      check('Script-Bereich am Video sichtbar', !$('scriptBox').hidden, $('sbName').textContent);
      const activeInt = document.querySelector('#scriptBox [data-preset-scene] button.active')?.dataset.preset;
      check('Script-Intensität: Wahl der Szene aktiv, vier Knöpfe', activeInt === currentPreset() && document.querySelectorAll('#scriptBox [data-preset-scene] button').length === 4, activeInt);
      document.body.click();
      // 2.0: Script-Karte, Finale und Pause am Video (nicht im Geräte-Fenster); Hub und ⟳ im Geräte-Fenster
      check('Script, Finale, Pause am Video – nicht im Geräte-Fenster', ['scriptBox', 'finaleBtn', 'vibePause'].every((id) => $(id).closest('.pl-side') && !$('devices').contains($(id))));
      check('Geräte-Fenster ist zu, solange der Player läuft (dockt nicht mehr an)', getComputedStyle($('devices')).display === 'none');
      check('Hub und ⟳ im Geräte-Fenster', (() => {
        openDevices('handy');
        const ok = !!document.querySelector('.dev-fine[data-fine="handy"]').getClientRects().length || !document.body.classList.contains('has-handy');
        const v = ok && $('devices').contains($('resyncBtn')) && !$('ovSync'); closeDevices(); return v;
      })());
      // Mini-Player schließen
      video.muted = true;
      await video.play().catch(() => {});
      backToLibrary();
      await wait(900);
      const miniWasOn = document.body.classList.contains('mini-on');
      $('miniClose').click();
      await wait(600);
      check('Mini-Player ✕ schließt das Video', miniWasOn && !document.body.classList.contains('mini-on') && !nowPlaying);
    } else check('Video mit Funscript vorhanden', false, 'in /media fehlt ein Video mit .funscript');
  } catch (e) {
    check('Selbsttest lief ohne Fehler', false, e.message);
  }

  // Ergebnis anzeigen
  const box = document.createElement('div');
  box.className = 'selftest';
  const ok = results.filter((r) => r.ok).length;
  box.innerHTML = `<h3>Selbsttest: ${ok} von ${results.length} ok</h3>`;
  const ul = document.createElement('ul');
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = `${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ' – ' + r.info : ''}`;
    ul.append(li);
  }
  const close = Object.assign(document.createElement('button'), { className: 'small', textContent: 'Schließen (Seite neu laden)' });
  close.addEventListener('click', () => { location.href = location.pathname; });
  // Bericht zum Weitergeben (Version, Browser, Ergebnis)
  const dl = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '⬇ Bericht herunterladen' });
  dl.addEventListener('click', async () => {
    const version = await fetch('/api/version').then((r) => r.json()).then((v) => v.version).catch(() => '?');
    const text = [`Funscript Player ${version} – Selbsttest ${new Date().toLocaleString('de-DE')}`, navigator.userAgent, '',
      ...results.map((r) => `${r.ok ? 'OK ' : 'FEHLER'} ${r.name}${r.info ? ' – ' + r.info : ''}`)].join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'selbsttest.txt' });
    document.body.append(a);
    a.click();
    a.remove();
  });
  box.append(ul, close, ' ', dl);
  document.body.append(box);
  window.selfTestResults = results;
})();
