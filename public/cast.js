// test13: Auf den TV streamen – Chromecast (Chrome: Remote Playback API) und AirPlay (Safari). Zwei Wege: der Knopf in
// der Player-Leiste und Chromes eigener Cast-Knopf am Video (erscheint von selbst, solange disableRemotePlayback aus ist).
// Der Fernseher lädt das Video selbst und kann sich nicht anmelden: Video-Adressen bekommen darum ein zeitlich
// begrenztes Cast-Token (?cast=…, 24 h, nur für Videos – siehe server.js CAST_PATH). Die Geräte folgen weiter dem
// Video: Chrome/Safari melden die Wiedergabestelle des Fernsehers an das Video-Element zurück.
import { video } from './state.js';
import { $, log } from './handy.js';
import { t } from './lang.js';

let token = '';
// Streamt gerade auf einen Fernseher (Chromecast verbunden oder AirPlay aktiv)?
export const castActive = () => video.remote?.state === 'connected' || !!video.webkitCurrentPlaybackTargetIsWireless;
const CASTABLE = /^\/(media\/|stash\/scene\/\d+\/(stream|stream\.mp4)$|hq\/stream\?)/;

// Adresse mit Cast-Token (nur Video-Adressen des Players; blob: und fremde bleiben, wie sie sind)
export function withCast(url) {
  if (!token || !url || !CASTABLE.test(url) || /[?&]cast=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'cast=' + token;
}

async function loadToken() {
  try {
    const r = await (await fetch('/api/cast/token')).json();
    token = r.token || '';
    // vor Ablauf erneuern (gilt 24 h)
    setTimeout(loadToken, Math.max(60000, (r.exp * 1000 - Date.now()) - 3600000));
  } catch { setTimeout(loadToken, 300000); }
}

// Läuft das Video ohne Token (vor dem ersten Token geladen), an derselben Stelle mit Token neu setzen – synchron,
// damit der Tipp auf 📺 als Nutzer-Aktion gilt (sonst lehnt der Browser die Geräteauswahl ab)
function ensureCastSrc() {
  const cur = video.getAttribute('src') || '';
  const next = withCast(cur);
  if (next === cur) return;
  const at = video.currentTime;
  const playing = !video.paused;
  video.src = next;
  video.addEventListener('loadedmetadata', () => {
    try { video.currentTime = at; } catch { /* egal */ }
    if (playing) video.play().catch(() => {});
  }, { once: true });
}

export function init() {
  const btn = $('ovCast');
  const chrome = 'remote' in HTMLMediaElement.prototype;
  const airplay = !!window.WebKitPlaybackTargetAvailabilityEvent;
  if (!chrome && !airplay) return; // Browser kann nicht streamen (z. B. Firefox) – kein Knopf
  loadToken();
  if (airplay) {
    video.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => { btn.hidden = e.availability !== 'available'; });
  } else {
    video.disableRemotePlayback = false;
    // Knopf nur, wenn ein Fernseher im Netz ist; kann der Browser das nicht melden, Knopf trotzdem zeigen
    video.remote.watchAvailability((on) => { btn.hidden = !on; }).catch(() => { btn.hidden = false; });
    // Beim Verbinden/Trennen Handy neu abgleichen (die Wiedergabestelle kommt jetzt vom Fernseher bzw. wieder lokal)
    video.remote.addEventListener('connect', () => { btn.classList.add('active'); log(t('cast.connected')); video.dispatchEvent(new Event('ratechange')); });
    video.remote.addEventListener('disconnect', () => { btn.classList.remove('active'); log(t('cast.disconnected')); video.dispatchEvent(new Event('ratechange')); });
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!token) return log(t('cast.noToken'), true);
    ensureCastSrc();
    if (airplay) return video.webkitShowPlaybackTargetPicker();
    video.remote.prompt().catch((err) => {
      if (err.name === 'NotFoundError') log(t('cast.none'), true);
      else if (err.name !== 'AbortError') log(t('cast.error', { msg: err.message }), true);
    });
  });
}
