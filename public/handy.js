'use strict';

// ---------------------------------------------------------------------------
// The Handy – API v2 (WLAN, Connection Key)
//   HAMP (Modus 0): Handy bewegt sich selbst, wir geben nur die Geschwindigkeit vor.
//   HSSP (Modus 1): Ein Script wird als CSV auf Handys Script-Hosting geladen und
//                   synchron zur Serverzeit abgespielt (Video, Patterns, eigene Scripts).
// ---------------------------------------------------------------------------
const HANDY_API = 'https://www.handyfeeling.com/api/handy/v2';
const HANDY_UPLOAD = 'https://www.handyfeeling.com/api/sync/upload?local=true';

class Handy {
  constructor() {
    this.key = '';
    this.connected = false;
    this.serverOffset = 0;
    this.mode = null;      // 0 = HAMP, 1 = HSSP
    this.hsspUrl = null;   // aktuell auf der Handy geladenes Script
    this.owner = null;     // 'video' | 'manual' | 'pattern' | 'sequence'
    this.uploadCache = new Map(); // CSV -> URL, spart wiederholte Uploads
  }

  async req(method, path, body) {
    const res = await fetch(HANDY_API + path, {
      method,
      headers: { 'X-Connection-Key': this.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error?.message || `Handy-API: HTTP ${res.status}`);
    return json;
  }

  async connect(key) {
    this.key = key;
    this.connected = false;
    this.mode = null;
    this.hsspUrl = null;
    const { connected } = await this.req('GET', '/connected');
    if (!connected) throw new Error('Handy ist nicht online (WLAN-Modus, LED blau?)');
    await this.syncTime();
    this.connected = true;
  }

  // Schätzt die Abweichung zwischen lokaler Uhr und Handy-Serveruhr.
  async syncTime(rounds = 10) {
    const offsets = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      const { serverTime } = await this.req('GET', '/servertime');
      const t1 = Date.now();
      offsets.push(serverTime + (t1 - t0) / 2 - t1);
    }
    offsets.sort((a, b) => a - b);
    const mid = offsets.slice(2, -2);
    this.serverOffset = mid.reduce((s, o) => s + o, 0) / mid.length;
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
    form.append('syncFile', new Blob([csv], { type: 'text/csv' }), 'script.csv');
    const res = await fetch(HANDY_UPLOAD, { method: 'POST', body: form });
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

  play(startTime) { return this.req('PUT', '/hssp/play', { estimatedServerTime: this.serverTime(), startTime: Math.round(startTime) }); }
  stop() { return this.req('PUT', '/hssp/stop'); }
  slide(min, max) { return this.req('PUT', '/slide', { min, max }); }

  async hampStart(velocity) {
    await this.setMode(0);
    await this.req('PUT', '/hamp/velocity', { velocity });
    await this.req('PUT', '/hamp/start');
  }
  hampStop() { return this.req('PUT', '/hamp/stop'); }
  hampVelocity(velocity) { return this.req('PUT', '/hamp/velocity', { velocity }); }
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
const store = {
  get(k, d) { try { const v = localStorage.getItem('hp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hp.' + k, JSON.stringify(v)); } catch { /* egal */ } },
};

function setStatus(state, text) {
  const el = $('status');
  el.className = 'pill ' + state;
  el.textContent = 'Handy: ' + text;
}

function log(msg, isError = false) {
  const el = $('log');
  el.textContent = msg instanceof Error ? msg.message : msg;
  el.className = 'log' + (isError ? ' err' : '');
  if (isError) console.error(msg);
}

function requireHandy() {
  if (handy.connected) return true;
  log('Bitte zuerst rechts die Handy verbinden.', true);
  return false;
}

function toCsv(actions) {
  const invert = $('invert').checked;
  return '#Handy Player\n' + actions.map((a) => `${a.at},${invert ? 100 - a.pos : a.pos}`).join('\r\n') + '\r\n';
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
