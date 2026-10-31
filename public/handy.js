'use strict';

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
    this.owner = null;     // 'video' | 'manual' | 'self' | 'pattern' | 'sequence' | 'finale'
    this.uploadCache = new Map(); // CSV -> URL, spart wiederholte Uploads
  }

  get v3() { return !!this.appId; }

  async req(method, path, body) {
    const headers = { 'X-Connection-Key': this.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.v3) headers['X-Api-Key'] = this.appId;
    const res = await fetch((this.v3 ? HANDY_API_V3 : HANDY_API) + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error?.message || `Handy-API${this.v3 ? ' v3' : ''}: HTTP ${res.status}`);
    return this.v3 && json.result !== undefined ? json.result : json; // v3 verpackt Antworten in „result“
  }

  async connect(key, appId = '') {
    this.key = key;
    this.appId = appId;
    this.connected = false;
    this.mode = null;
    this.hsspUrl = null;
    this.uploadCache.clear(); // v2 und v3 nutzen verschiedene Script-Ablagen
    const { connected } = await this.req('GET', '/connected');
    if (!connected) throw new Error('Handy ist nicht online (WLAN-Modus, LED blau?)');
    await this.syncTime();
    this.connected = true;
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

  async upload(csv) {
    const cached = this.uploadCache.get(csv);
    if (cached) return cached;
    const form = new FormData();
    // Neutraler Dateiname, damit keine Videotitel an Handys Server gehen.
    form.append(this.v3 ? 'file' : 'syncFile', new Blob([csv], { type: 'text/csv' }), 'script.csv');
    const res = await fetch(this.v3 ? HANDY_UPLOAD_V3 : HANDY_UPLOAD, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!json.url) throw new Error('Upload des Scripts fehlgeschlagen');
    this.uploadCache.set(csv, json.url);
    return json.url;
  }

  // Lädt ein Script per HSSP auf die Handy (nur wenn es nicht schon geladen ist).
  async prepare(csv) {
    await this.setMode(1);
    const url = await this.upload(csv);
    if (this.hsspUrl !== url) {
      await this.req('PUT', '/hssp/setup', { url });
      this.hsspUrl = url;
    }
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

const handy = new Handy();

// Wer die Handy gerade benutzt. Die anderen Bereiche hören auf das Event und
// setzen ihre Oberfläche zurück (z. B. pausiert das Video).
function claimHandy(owner) {
  if (handy.owner === owner) return;
  handy.owner = owner;
  document.dispatchEvent(new CustomEvent('handy-owner', { detail: owner }));
}

// ---------------------------------------------------------------------------
// Gemeinsame Hilfsfunktionen
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
// Einstellungen: im Browser (localStorage) – die gemeinsamen zusätzlich auf dem Server,
// damit alle Geräte dieselben haben. Pro Gerät bleiben Bild/HQ, Kopfzeile, Bildschirmsperre,
// Ton, Fernbedienungs-Name, Bluetooth-Geräte und welche Ansicht gerade offen ist.
const SHARED_PREFS = new Set([
  'key', 'appId', 'autoConnect', 'autoSync', 'invert', 'btLead', 'offset', 'offsets', 'min', 'max',
  'capSpeed', 'stopButton', 'vibeMin', 'vibeMax', 'vibeFull', 'vibeLead', 'vibeSmooth', 'vibeMap2', 'vibeSource',
  'bleKnownNames', 'scriptTools', 'scriptPreset', 'scenePresets', 'finale', 'hud',
  'selfMode', 'selfSpeed', 'selfVibe', 'sceneDev', 'vibeLeadAuto', 'touchHandy', 'touchVibe', 'touchHold', 'touchRecPos', 'saveScripts', 'savedFilter', 'stashSort', 'onlyScripts', 'showContinue',
]);
const isSharedPref = (k) => SHARED_PREFS.has(k) || k.startsWith('savedFilter.');
let prefsPending = {}, prefsTimer = null;
const store = {
  get(k, d) { try { const v = localStorage.getItem('hp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('hp.' + k, JSON.stringify(v)); } catch { /* egal */ }
    if (!isSharedPref(k)) return;
    prefsPending[k] = v === undefined ? null : v;
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
// Skripte sie sofort lesen. Hat der Server noch keine (erstes Gerät nach dem Update),
// schickt dieses Gerät seine bisherigen hoch.
(function loadSharedPrefs() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/prefs', false);
    xhr.send();
    if (xhr.status !== 200) return;
    const prefs = JSON.parse(xhr.responseText || '{}');
    if (Object.keys(prefs).length) {
      for (const [k, v] of Object.entries(prefs)) if (isSharedPref(k)) localStorage.setItem('hp.' + k, JSON.stringify(v));
      return;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i).replace(/^hp\./, '');
      if (isSharedPref(k)) prefsPending[k] = store.get(k);
    }
    if (Object.keys(prefsPending).length) flushPrefs();
  } catch { /* ohne Server: nur lokal */ }
})();

function setStatus(state, text) {
  const el = $('status');
  el.className = 'pill ' + state;
  pillText(el, 'Handy', '↕', text);
}

// Status-Chip oben: „Handy: verbunden“ – auf schmalen Bildschirmen nur „↕ verbunden“ (CSS)
function pillText(el, label, icon, text) {
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
function log(msg, isError = false) {
  const el = $('log');
  const text = msg instanceof Error ? msg.message : msg;
  el.textContent = text;
  el.className = 'log' + (isError ? ' err' : '');
  if (isError) console.error(msg);
  const t = $('toast');
  if (!t || !text || document.body.classList.contains('dev-open')) return;
  t.textContent = text;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3500);
}

function requireHandy() {
  if (handy.connected) return true;
  log('Bitte zuerst rechts die Handy verbinden.', true);
  return false;
}

function toCsv(actions) {
  const invert = $('invert').checked;
  return '#Funscript Player\n' + actions.map((a) => `${a.at},${invert ? 100 - a.pos : a.pos}`).join('\r\n') + '\r\n';
}

function downloadFunscript(actions, name) {
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
function positionAt(actions, ms) {
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
