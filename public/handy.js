import { modulesReady } from './state.js';
modulesReady.add('handy');

// ---------------------------------------------------------------------------
// The Handy – WLAN über die Handy-Cloud (Connection Key)
//   API v3 (mit Application ID aus ⚙️ → Geräte): kann die Wiedergabegeschwindigkeit
//     mitgeben – die Handy bleibt auch bei 0,5× … 2× im Takt.
//   API v2 (ohne Application ID): wie bisher, nur bei 1×.
//   HAMP (Modus 0): Handy bewegt sich selbst, wir geben nur die Geschwindigkeit vor.
//   HSSP (Modus 1): Ein Script wird als CSV hochgeladen und synchron zur Serverzeit
//                   abgespielt (Video, Patterns, eigene Scripts).
// ---------------------------------------------------------------------------
const HANDY_API = 'https://www.handyfeeling.com/api/handy/v2';
const HANDY_UPLOAD = 'https://www.handyfeeling.com/api/sync/upload?local=true';
const HANDY_API_V3 = 'https://www.handyfeeling.com/api/handy-rest/v3';
const HANDY_UPLOAD_V3 = 'https://www.handyfeeling.com/api/hosting/v2/upload';

class Handy {
  constructor() {
    this.key = '';
    this.appId = '';       // Application ID -> API v3
    this.connected = false;
    this.serverOffset = 0;
    this.mode = null;      // 0 = HAMP, 1 = HSSP
    this.hsspUrl = null;   // aktuell auf der Handy geladenes Script
    this.owner = null;     // 'video' | 'manual' | 'self' | 'pattern' | 'finale'
    this.lat = 0;          // gemittelte Antwortzeit der Handy-Cloud (ms)
    this.uploadCache = new Map(); // CSV -> URL, spart wiederholte Uploads
  }

  get v3() { return !!this.appId; }

  // forceV2: Direkt-Position (HDSP) und Geräte-Infos laufen immer über die bewährte API v2
  async req(method, path, body, forceV2 = false) {
    const v3 = this.v3 && !forceV2;
    const headers = { 'X-Connection-Key': this.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (v3) headers['X-Api-Key'] = this.appId;
    let res;
    const t0 = Date.now();
    try {
      res = await fetch((v3 ? HANDY_API_V3 : HANDY_API) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error('Handy-Cloud nicht erreichbar – Internet?'), { kind: 'net' });
    }
    // Antwortzeit gleitend mitteln – langsame Cloud = Status gelb (app.js)
    const ms = Date.now() - t0;
    if (!path.includes('setup')) this.lat = this.lat ? this.lat * 0.7 + ms * 0.3 : ms; // Script-Laden dauert immer länger
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'limit' : '';
      throw Object.assign(new Error(json.error?.message || `Handy-API${v3 ? ' v3' : ''}: HTTP ${res.status}`), { kind });
    }
    return v3 && json.result !== undefined ? json.result : json; // v3 verpackt Antworten in „result“
  }

  async connect(key, appId = '') {
    this.key = key;
    this.appId = appId;
    this.connected = false;
    this.mode = null;
    this.hsspUrl = null;
    this.uploadCache.clear(); // v2 und v3 nutzen verschiedene Script-Ablagen
    const { connected } = await this.req('GET', '/connected');
    if (!connected) throw Object.assign(new Error('Handy ist nicht online (WLAN-Modus, LED blau?)'), { kind: 'offline' });
    await this.syncTime();
    this.connected = true;
    this.readInfo();
  }

  // Modell und Firmware (für das Höchsttempo). Fehler egal – dann gilt der Standard.
  async readInfo() {
    try {
      const info = await this.req('GET', '/info', null, true);
      this.model = String(info.model || '');
      this.hwVersion = String(info.hwVersion || '');
      this.fwVersion = String(info.fwVersion || '');
    } catch { this.model = ''; }
    this.modelName = handyModelName(this.model, this.hwVersion);
    document.dispatchEvent(new Event('handy-info'));
  }

  // Schätzt die Abweichung zwischen lokaler Uhr und Handy-Serveruhr.
  async syncTime(rounds = 10) {
    const offsets = [], rtts = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      const r = await this.req('GET', '/servertime');
      const t1 = Date.now();
      offsets.push((this.v3 ? r.server_time : r.serverTime) + (t1 - t0) / 2 - t1);
      rtts.push(t1 - t0);
    }
    offsets.sort((a, b) => a - b);
    const mid = offsets.slice(2, -2);
    this.serverOffset = mid.reduce((s, o) => s + o, 0) / mid.length;
    this.rtt = rtts.sort((a, b) => a - b)[Math.floor(rtts.length / 2)]; // Antwortzeit der Handy-Cloud (Median)
  }

  serverTime() {
    return Math.round(Date.now() + this.serverOffset);
  }

  async setMode(mode) {
    if (this.mode === mode) return;
    await this.req('PUT', '/mode', { mode });
    this.mode = mode;
    this.hsspUrl = null;
  }

  // Schlüssel für die Merkliste auf dem Player-Server: API-Version + SHA-256 des CSV
  async cacheKey(csv) {
    if (!crypto.subtle) return '';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
    return `${this.v3 ? 'v3' : 'v2'}:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  // fresh = Merkliste übergehen (gemerkte Adresse war nicht mehr gültig)
  async upload(csv, fresh = false) {
    const cached = !fresh && this.uploadCache.get(csv);
    if (cached) return cached;
    const k = await this.cacheKey(csv).catch(() => '');
    if (k && !fresh) {
      // Schon einmal hochgeladen (auch auf einem anderen Gerät)? Dann sofort weiter
      const hit = await fetch('/api/handycache?k=' + k).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (hit?.url) { this.uploadCache.set(csv, hit.url); return hit.url; }
    }
    const form = new FormData();
    // Neutraler Dateiname, damit keine Videotitel an Handys Server gehen.
    form.append(this.v3 ? 'file' : 'syncFile', new Blob([csv], { type: 'text/csv' }), 'script.csv');
    const res = await fetch(this.v3 ? HANDY_UPLOAD_V3 : HANDY_UPLOAD, { method: 'POST', body: form }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!json.url) throw Object.assign(new Error('Upload des Scripts fehlgeschlagen'), { kind: res ? '' : 'net' });
    this.uploadCache.set(csv, json.url);
    if (k) fetch('/api/handycache', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, url: json.url }) }).catch(() => {});
    return json.url;
  }

  // Lädt ein Script per HSSP auf die Handy (nur wenn es nicht schon geladen ist).
  async prepare(csv) {
    await this.setMode(1);
    let url = await this.upload(csv);
    if (this.hsspUrl === url) return;
    try {
      await this.req('PUT', '/hssp/setup', { url });
    } catch (e) {
      // Gemerkte Adresse abgelaufen? Einmal frisch hochladen
      if (e.kind === 'net') throw e;
      url = await this.upload(csv, true);
      await this.req('PUT', '/hssp/setup', { url });
    }
    this.hsspUrl = url;
  }

  // Direkt-Position (HDSP, Modus 2): in duration ms auf Position 0–100 (innerhalb von Hub min/max)
  async hdspMove(position, duration) {
    if (this.mode !== 2) {
      await this.req('PUT', '/mode', { mode: 2 }, true);
      this.mode = 2;
      this.hsspUrl = null;
    }
    // Mit Application ID (Firmware/Konto auf API v3) erwartet die Handy die Position als 0–1 –
    // getestet: 0–100 ließ sie ab 1 % ganz nach oben fahren. Ohne Application ID wie dokumentiert 0–100.
    const pos = this.v3 ? Math.round(position) / 100 : Math.round(position);
    await this.req('PUT', '/hdsp/xpt', { stopOnTarget: true, immediateResponse: true, position: pos, duration: Math.round(duration) }, true);
  }

  // rate = Wiedergabegeschwindigkeit des Videos (nur v3)
  play(startTime, rate = 1) {
    if (this.v3) return this.req('PUT', '/hssp/play', { start_time: Math.round(startTime), server_time: this.serverTime(), playback_rate: rate });
    return this.req('PUT', '/hssp/play', { estimatedServerTime: this.serverTime(), startTime: Math.round(startTime) });
  }
  stop() { return this.req('PUT', '/hssp/stop'); }
  slide(min, max) {
    return this.v3 ? this.req('PUT', '/slider/stroke', { min: min / 100, max: max / 100 }) : this.req('PUT', '/slide', { min, max });
  }

  // Geschwindigkeit 0–100 (v3 erwartet 0–1)
  async hampStart(velocity) {
    await this.setMode(0);
    await this.hampVelocity(velocity);
    await this.req('PUT', '/hamp/start');
  }
  hampStop() { return this.req('PUT', '/hamp/stop'); }
  hampVelocity(velocity) { return this.req('PUT', '/hamp/velocity', { velocity: this.v3 ? velocity / 100 : velocity }); }
}

export const handy = new Handy();

// Modell aus den Geräte-Infos (Handy 1 / 2 / 2 Pro); unbekannt = Handy 1
function handyModelKey(model, hw) {
  const s = `${model} ${hw}`.toLowerCase();
  if (/pro/.test(s)) return 'h2pro';
  if (/\b(h0?2|handy ?2|2\.\d)\b/.test(s)) return 'h2';
  return 'h1';
}
function handyModelName(model, hw) {
  if (!model && !hw) return '';
  return { h1: 'Handy 1', h2: 'Handy 2', h2pro: 'Handy 2 Pro' }[handyModelKey(model, hw)] + (model ? ` (${model}${hw ? ' · HW ' + hw : ''})` : '');
}
// Höchsttempo pro Modell (%/s des vollen Hubs). Für Handy 2 / 2 Pro noch keine gemessenen Werte -> wie Handy 1.
const HANDY_MAX_SPEED = { h1: 450, h2: 450, h2pro: 450 };
export function handyMaxSpeed() {
  if (!store.get('handyMaxAuto', true)) return store.get('handyMax', 450);
  return HANDY_MAX_SPEED[handyModelKey(handy.model || '', handy.hwVersion || '')] || 450;
}

// Kurzer Grund für die Status-Anzeige oben (ausführlich steht er im Geräte-Fenster)
export function handyErrText(e) {
  const kind = e?.kind || '';
  // Ohne Gerätenamen – das ↕ davor sagt schon, um welches Gerät es geht
  if (kind === 'net') return 'Cloud nicht erreichbar';
  if (kind === 'offline') return 'offline';
  if (kind === 'auth') return 'Key / App-ID falsch';
  if (kind === 'limit') return 'zu viele Anfragen';
  return /key/i.test(e?.message || '') ? 'Key falsch?' : 'Fehler – antippen';
}

// Wer die Handy gerade benutzt. Die anderen Bereiche hören auf das Event und
// setzen ihre Oberfläche zurück (z. B. pausiert das Video).
export function claimHandy(owner) {
  if (handy.owner === owner) return;
  handy.owner = owner;
  document.dispatchEvent(new CustomEvent('handy-owner', { detail: owner }));
}

// ---------------------------------------------------------------------------
// Gemeinsame Hilfsfunktionen
// ---------------------------------------------------------------------------
export const $ = (id) => document.getElementById(id);
// Einstellungen: im Browser (localStorage) – die gemeinsamen zusätzlich auf dem Server,
// damit alle Geräte dieselben haben. Pro Gerät bleiben Bild/HQ, Kopfzeile, Bildschirmsperre,
// Ton, Bluetooth-Geräte und welche Ansicht gerade offen ist.
const SHARED_PREFS = new Set([
  'key', 'appId', 'autoConnect', 'autoSync', 'invert', 'btLead', 'offset', 'offsets', 'min', 'max',
  'capSpeed', 'stopButton', 'autoStop', 'vibeMin', 'vibeMax', 'vibeFull', 'vibeLead', 'vibeSmooth', 'vibeMap2', 'vibeSource',
  'bleKnownNames', 'scriptTools', 'scriptPreset', 'scenePresets', 'finale', 'hud',
  'selfMode', 'selfSpeed', 'selfVibe', 'sceneDev', 'vibeLeadAuto', 'touchHandy', 'touchVibe', 'touchHold', 'saveScripts', 'savedFilter', 'stashSort', 'onlyScripts',
  'offsetInfo', 'scriptChoice', 'scriptPresetHandy', 'scriptIntensity', 'skipSec', 'selfLo', 'selfHi', 'touchMode', 'tooFast', 'handyMax', 'handyMaxAuto', 'hiddenFilters', 'browseTabs', 'barBtns',
]);
const isSharedPref = (k) => SHARED_PREFS.has(k) || k.startsWith('savedFilter.');
let prefsPending = {}, prefsTimer = null;
export const store = {
  get(k, d) { try { const v = localStorage.getItem('hp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('hp.' + k, JSON.stringify(v)); } catch { /* egal */ }
    if (!isSharedPref(k)) return;
    prefsPending[k] = v === undefined ? null : v;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(flushPrefs, 400);
  },
  // Schlüssel ganz löschen – hier und auf dem Server (prefs.json)
  del(k) {
    try { localStorage.removeItem('hp.' + k); } catch { /* egal */ }
    prefsPending[k] = null;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(flushPrefs, 400);
  },
};
function flushPrefs() {
  const body = JSON.stringify(prefsPending);
  prefsPending = {};
  fetch('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
window.addEventListener('pagehide', () => { if (Object.keys(prefsPending).length) flushPrefs(); });

// Beim Laden: gemeinsame Einstellungen vom Server übernehmen – synchron, weil die anderen
// Skripte sie sofort lesen. Seit 1.19.3 ist der Server (Volume funscript-data, bis 1.19.6 handy-data) maßgeblich: Was er nicht
// hat, löscht der Browser – ein gelöschtes Volume ist ein echter Neuanfang (vorher lud der Browser
// seine alten Kopien, z. B. den Connection Key, wieder hoch).
// 1.19.7: Neuinstallation = dieses Gerät hat nichts gespeichert und der Server auch nicht (Willkommen, settings.js)
export let freshInstall = false;
(function loadSharedPrefs() {
  const freshDevice = !Object.keys(localStorage).some((k) => k.startsWith('hp.'));
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/prefs', false);
    xhr.send();
    if (xhr.status !== 200) return;
    const prefs = JSON.parse(xhr.responseText || '{}');
    freshInstall = freshDevice && !Object.keys(prefs).length;
    Object.keys(localStorage).filter((k) => k.startsWith('hp.') && isSharedPref(k.slice(3)) && !(k.slice(3) in prefs))
      .forEach((k) => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(prefs)) if (isSharedPref(k)) localStorage.setItem('hp.' + k, JSON.stringify(v));
  } catch { /* ohne Server: nur lokal */ }
})();

// 1.19.4: Schlüssel ohne Funktion aus den gemeinsamen Einstellungen löschen – prefs.json bleibt übersichtlich
// (scriptPresetHandy erst in tools.js, selfStroke in selfctl.js – sie werden dort noch einmal umgerechnet)
for (const k of ['presetLink', 'libLinks', 'showContinue', 'scriptPreset', 'scriptPresetVibe', 'fine.common', 'seen1195', 'seen1197', 'seen1198', 'seen1199']) { // 1.19.9: + Reste
  if (store.get(k, undefined) !== undefined) store.del(k);
}

// 1.19.4: JavaScript-Fehler im Browser an den Server melden – stehen dann in „docker logs“ (höchstens 5 je Seite)
let errReports = 0;
function reportError(msg) {
  if (errReports++ >= 5) return;
  fetch('/api/clientcheck', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ fails: [String(msg).slice(0, 200)], ua: navigator.userAgent }),
  }).catch(() => {});
}
window.addEventListener('error', (e) => reportError(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => reportError('Promise: ' + (e.reason?.message || e.reason)));

export function setStatus(state, text) {
  const el = $('status');
  el.className = 'pill ' + state;
  pillText(el, 'Handy', '↕', text);
}

// Status-Chip oben: „Handy: verbunden“ – auf schmalen Bildschirmen nur „↕ verbunden“ (CSS)
export function pillText(el, label, icon, text) {
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = label + ': ';
  const ic = document.createElement('span');
  ic.className = 'ic';
  ic.textContent = icon + ' ';
  el.replaceChildren(ic, lbl, text);
}

// Meldung im Geräte-Fenster und – weil das meist zu ist – kurz als Einblendung unten
let toastTimer;
export function log(msg, isError = false) {
  const el = $('log');
  const text = msg instanceof Error ? msg.message : msg;
  el.textContent = text;
  el.className = 'log' + (isError ? ' err' : '');
  if (isError) console.error(msg);
  // Die Meldungszeile im Geräte-Kasten gibt es nicht mehr (1.18) – Meldungen immer als Einblendung
  const t = $('toast');
  if (!t || !text) return;
  t.textContent = text;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3500);
}


export function toCsv(actions) {
  const invert = $('invert').checked;
  return '#Funscript Player\n' + actions.map((a) => `${a.at},${invert ? 100 - a.pos : a.pos}`).join('\r\n') + '\r\n';
}

export function downloadFunscript(actions, name) {
  const data = { version: '1.0', inverted: false, range: 100, actions: actions.map((a) => ({ at: a.at, pos: a.pos })) };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (name || 'script').replace(/[\\/:*?"<>|]+/g, '_') + '.funscript';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Position (0–100) eines Scripts zu einem Zeitpunkt, linear interpoliert.
export function positionAt(actions, ms) {
  if (!actions.length) return 0;
  if (ms <= actions[0].at) return actions[0].pos;
  let lo = 0, hi = actions.length - 1;
  if (ms >= actions[hi].at) return actions[hi].pos;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].at <= ms) lo = mid; else hi = mid;
  }
  const a = actions[lo], b = actions[hi];
  return a.pos + ((b.pos - a.pos) * (ms - a.at)) / (b.at - a.at);
}

// Demo-Modus (/demo oder Schalter in ⚙️ → Notaus & Privatsphäre): virtuelle Handy – nichts geht an die Handy-Cloud,
// die Anfragen werden nur beantwortet (wie im Selbsttest). Gilt ab dem Laden der Seite.
export const demoMode = location.pathname === '/demo' || store.get('demo', false);
if (demoMode) {
  handy.req = async (method, p) => {
    if (p === '/connected') return { connected: true };
    if (p === '/servertime') return { serverTime: Date.now(), server_time: Date.now() };
    if (p === '/info') return { model: 'H01', hwVersion: '1', fwVersion: 'demo' };
    return {};
  };
  handy.upload = async () => 'https://example.invalid/demo.csv';
}
