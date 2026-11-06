'use strict';

// Server-Einstellungen aus der Oberfläche (data/settings.json): HereSphere, Passwort, Intiface, Anmeldung, Stash.
// HERESPHERE=off in der Umgebung schaltet HereSphere fest ab – dann lässt es sich in der Oberfläche nicht einschalten.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { AUTH_PASS, AUTH_USER, DATA_DIR, EXAMPLE_PASS, LOGIN_OFF, STASH_API_KEY, STASH_OFF, STASH_URL } = require('./config');
const { readBody } = require('./util');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HS_LOCKED_OFF = /^(0|off|false|nein)$/i.test(process.env.HERESPHERE || '');
// INTIFACE_LAN_ONLY=1: Intiface-Weiterleitung fest nur ins Heimnetz (192.168.x / 10.x)
const LAN_LOCKED = /^(1|on|true|ja)$/i.test(process.env.INTIFACE_LAN_ONLY || '');
// hsVrOnly: HereSphere zeigt nur VR-Videos; hsPass: Salz + Hash des optionalen HereSphere-Passworts;
// hsSecret: Schlüssel, mit dem die HereSphere-Tokens unterschrieben werden; v: Stand der Einstellungen
// 2.0: HereSphere ab Werk AUS (vorher an) – erst bewusst einschalten
// hsRedirect: HereSphere (am User-Agent erkannt) wird von / auf /heresphere weitergeleitet
let serverSettings = { heresphere: false, hsVrOnly: true, hsRedirect: true, hsPass: null, intifaceLan: true, hsSecret: '', v: 3 };
let loaded = null;
try { loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); Object.assign(serverSettings, loaded); } catch { /* Standard */ }
if (loaded) {
  const v = loaded.v || 1;
  // 1.19.5: Intiface-Weiterleitung standardmäßig nur noch ins Heimnetz (vorher alle privaten Adressen inkl. Docker-Netze)
  if (v < 2) serverSettings.intifaceLan = true;
  // 2.0: bestehende Installationen behalten HereSphere so, wie es war (früher war „nicht gespeichert“ = an)
  if (v < 3 && typeof loaded.heresphere !== 'boolean') serverSettings.heresphere = true;
  if (v < 3) {
    serverSettings.v = 3;
    save().catch(() => {});
  }
}
const heresphereOn = () => !HS_LOCKED_OFF && serverSettings.heresphere !== false;
const hsRedirectOn = () => heresphereOn() && serverSettings.hsRedirect !== false;
const intifaceLanOnly = () => LAN_LOCKED || !!serverSettings.intifaceLan;

// HereSphere-Passwort (1.19.5): scrypt statt einfachem SHA-256 – Durchprobieren wird teuer.
// 1.19.10: Einträge von vor 1.19.5 (SHA-256, ohne kdf) gelten nicht mehr – Passwort in ⚙️ → VR neu setzen.
const scrypt = (salt, pw) => crypto.scryptSync(String(pw).slice(0, 200), salt, 32).toString('hex');
function newPass(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: scrypt(salt, pw), kdf: 'scrypt' };
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function hsCheckPassword(pw) {
  const p = serverSettings.hsPass;
  if (!p) return true;
  return p.kdf === 'scrypt' && same(scrypt(p.salt, pw), p.hash);
}

// Token für HereSphere: einmal anmelden, gilt dauerhaft (1.19.6, in 1.19.5 lief es nach 30 Tagen ab). Unterschrieben mit
// einem Server-Geheimnis und am Passwort-Hash hängend: neues Passwort = alle alten Tokens ungültig.
// Tokens aus 1.19.5 („<Ablauf>.<Signatur>“) gelten weiter, der Ablauf zählt nicht mehr.
function hsSecret() {
  if (!serverSettings.hsSecret) {
    serverSettings.hsSecret = crypto.randomBytes(32).toString('hex');
    save().catch(() => {});
  }
  return serverSettings.hsSecret;
}
const sign = (exp) => crypto.createHmac('sha256', hsSecret()).update(`${exp}:${serverSettings.hsPass?.hash || ''}`).digest('hex');
function hsToken() {
  if (!serverSettings.hsPass) return '';
  return sign('hs');
}
function hsAuthorized(req, url) {
  if (!serverSettings.hsPass) return true;
  const given = String(req.headers['auth-token'] || url.searchParams.get('hs') || '');
  if (/^[0-9a-f]{64}$/.test(given)) return same(given, sign('hs'));
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(given);
  return !!m && same(m[2], sign(Number(m[1])));
}

// --- Anmeldung -------------------------------------------------------------------------------------------------
// Es gibt immer genau EINE Anmeldung. Rangfolge (test11): .env (AUTH_USER/AUTH_PASS) > in ⚙️ eingerichtet
// (uiLogin = { user, salt, hash, kdf }) > LOGIN=off > nichts eingerichtet (Einrichtungsseite).
// LOGIN_RESET=1 beim Start löscht, was in ⚙️ gesetzt wurde (eingerichtete Anmeldung und geändertes Passwort).
const ENV_LOGIN = !!(AUTH_USER && AUTH_PASS) && AUTH_PASS !== EXAMPLE_PASS;
const LOGIN_RESET = /^(1|on|true|ja|yes)$/i.test(process.env.LOGIN_RESET || '');
const LOGIN_RESET_DONE = LOGIN_RESET && !!(serverSettings.uiLogin || serverSettings.loginPass);
if (LOGIN_RESET_DONE) {
  serverSettings.uiLogin = null;
  serverSettings.loginPass = null;
  save().catch(() => {});
}
const loginSource = () => (ENV_LOGIN ? 'env' : serverSettings.uiLogin ? 'ui' : LOGIN_OFF ? 'off' : 'missing');
const loginUser = () => (ENV_LOGIN ? AUTH_USER : serverSettings.uiLogin?.user || '');
const loginMissing = () => loginSource() === 'missing';

// test10: eigenes Player-Passwort (statt AUTH_PASS aus der .env)
// loginPass = { salt, hash, kdf, env } – env = SHA-256 des AUTH_PASS beim Setzen. Ändert jemand AUTH_PASS in der
// .env, gilt das eigene Passwort nicht mehr (Rettungsweg, falls es vergessen ist).
const envMark = () => crypto.createHash('sha256').update(String(AUTH_PASS)).digest('hex');
const loginOwnActive = () => ENV_LOGIN && !!serverSettings.loginPass && serverSettings.loginPass.env === envMark();
let loginOk = new Set(); // geprüfte Anmeldungen (SHA-256 des Headers) – scrypt nicht bei jeder Anfrage
function loginCheckPassword(pw) {
  if (loginSource() === 'ui') {
    const p = serverSettings.uiLogin;
    return same(scrypt(p.salt, pw), p.hash);
  }
  if (loginOwnActive()) {
    const p = serverSettings.loginPass;
    return same(scrypt(p.salt, pw), p.hash);
  }
  const a = crypto.createHash('sha256').update(String(pw)).digest();
  const b = crypto.createHash('sha256').update(String(AUTH_PASS)).digest();
  return crypto.timingSafeEqual(a, b);
}
function loginCheckHeader(header, pw) {
  const k = crypto.createHash('sha256').update(header).digest('hex');
  if (loginOk.has(k)) return true;
  if (!loginCheckPassword(pw)) return false;
  if (loginOk.size > 200) loginOk = new Set();
  loginOk.add(k);
  return true;
}
// Fehler als { status, msg } – msg ist ein Sprachschlüssel für die Oberfläche
const passProblem = (pw) => (pw.length < 8 ? 'tooShort' : pw === EXAMPLE_PASS ? 'example' : '');
async function setLoginPassword(current, next) {
  const src = loginSource();
  if (src !== 'env' && src !== 'ui') return { status: 400, msg: 'noLogin' };
  if (!loginCheckPassword(String(current || ''))) return { status: 403, msg: 'wrongCurrent' };
  if (next === null) {
    if (src !== 'env') return { status: 400, msg: 'noLogin' };
    serverSettings.loginPass = null;
  } else {
    next = String(next || '');
    const bad = passProblem(next);
    if (bad) return { status: 400, msg: bad };
    if (src === 'ui') serverSettings.uiLogin = { user: serverSettings.uiLogin.user, ...newPass(next) };
    else serverSettings.loginPass = { ...newPass(next), env: envMark() };
  }
  loginOk = new Set();
  await save();
  return { status: 200 };
}

// test11: Anmeldung in der Oberfläche einrichten – nur solange es keine gibt (LOGIN=off oder nichts eingerichtet)
async function setupLogin(user, pw) {
  if (loginUser()) return { status: 409, msg: 'exists' };
  user = String(user || '').trim();
  pw = String(pw || '');
  if (!user || user.length > 64 || /[:\x00-\x1f]/.test(user)) return { status: 400, msg: 'badUser' };
  const bad = passProblem(pw);
  if (bad) return { status: 400, msg: bad };
  serverSettings.uiLogin = { user, ...newPass(pw) };
  loginOk = new Set();
  await save();
  return { status: 200 };
}
// test11: in der Oberfläche eingerichtete Anmeldung wieder entfernen (aktuelles Passwort nötig)
async function removeLogin(current) {
  if (loginSource() !== 'ui') return { status: 400, msg: 'notUi' };
  if (!loginCheckPassword(String(current || ''))) return { status: 403, msg: 'wrongCurrent' };
  serverSettings.uiLogin = null;
  loginOk = new Set();
  await save();
  return { status: 200 };
}

// --- test11: Stash-Verbindung aus der Oberfläche ------------------------------------------------------------
// stash = { url, key } überschreibt STASH_URL/STASH_API_KEY aus der .env, null = Werte aus der .env.
// STASH=off in der .env gewinnt immer (wie HERESPHERE=off).
function stashConf() {
  if (STASH_OFF) return { url: '', key: '', source: 'off' };
  const o = serverSettings.stash;
  if (o) return { url: o.url || '', key: o.key || '', source: 'ui' };
  return { url: STASH_URL, key: STASH_API_KEY, source: 'env' };
}
// body: { url, key, clearKey } – key leer = bisherigen Key behalten; reset = wieder die Werte aus der .env
async function setStashConf(body, reset) {
  if (STASH_OFF) return { status: 400, msg: 'locked' };
  if (reset) {
    serverSettings.stash = null;
  } else {
    let url = String(body.url ?? '').trim().replace(/\/+$/, '');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) return { status: 400, msg: 'badUrl' };
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    if (url) {
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('bad');
      } catch { return { status: 400, msg: 'badUrl' }; }
    }
    const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : body.clearKey ? '' : stashConf().key;
    // Code-Check beta1: keine Steuerzeichen – der Key landet auch als Kopfzeile bei ffmpeg (HQ-Stream)
    if (key.length > 500 || /[\s\u0000-\u001f\u007f]/.test(key)) return { status: 400, msg: 'badKey' };
    serverSettings.stash = { url, key };
  }
  await save();
  return { status: 200 };
}

// test13: Cast-Token für den Fernseher (Chromecast/AirPlay laden das Video selbst, ohne Browser-Anmeldung).
// Gilt 24 h und nur für Video-Adressen (server.js CAST_PATH). Unterschrieben mit eigenem Server-Geheimnis.
function castSecret() {
  if (!serverSettings.castSecret) {
    serverSettings.castSecret = crypto.randomBytes(32).toString('hex');
    save().catch(() => {});
  }
  return serverSettings.castSecret;
}
const castSign = (exp) => crypto.createHmac('sha256', castSecret()).update(`cast:${exp}`).digest('hex');
function castToken() {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return { token: `${exp}.${castSign(exp)}`, exp };
}
function castValid(tok) {
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(String(tok || ''));
  return !!m && Number(m[1]) * 1000 > Date.now() && same(m[2], castSign(Number(m[1])));
}

function publicSettings() {
  return {
    heresphere: heresphereOn(), heresphereLocked: HS_LOCKED_OFF, hsVrOnly: serverSettings.hsVrOnly !== false, hsRedirect: serverSettings.hsRedirect !== false,
    hsPassword: !!serverSettings.hsPass, login: !!loginUser(), loginSource: loginSource(), loginUser: loginUser(), loginOwn: loginOwnActive(),
    loginChangeable: !!loginUser(), loginOffEnv: LOGIN_OFF,
    stash: (({ url, key, source }) => ({ url, hasKey: !!key, source, envUrl: STASH_URL }))(stashConf()),
    intifaceLan: intifaceLanOnly(), intifaceLanLocked: LAN_LOCKED,
  };
}

async function save() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(serverSettings));
}
async function writeSettings(req) {
  const body = JSON.parse(await readBody(req, 10000) || '{}');
  if (typeof body.heresphere === 'boolean') serverSettings.heresphere = body.heresphere;
  if (typeof body.hsVrOnly === 'boolean') serverSettings.hsVrOnly = body.hsVrOnly;
  if (typeof body.hsRedirect === 'boolean') serverSettings.hsRedirect = body.hsRedirect;
  if (typeof body.intifaceLan === 'boolean') serverSettings.intifaceLan = body.intifaceLan;
  // Leer = Passwort entfernen; gespeichert wird nur Salz + Hash
  if (typeof body.hsPassword === 'string') serverSettings.hsPass = body.hsPassword ? newPass(body.hsPassword) : null;
  await save();
}

module.exports = { castToken, castValid, ENV_LOGIN, LOGIN_RESET, LOGIN_RESET_DONE, loginSource, loginUser, loginMissing, setupLogin, removeLogin, stashConf, setStashConf, serverSettings, heresphereOn, hsRedirectOn, intifaceLanOnly, hsCheckPassword, hsToken, hsAuthorized, publicSettings, writeSettings, loginCheckHeader, loginOwnActive, setLoginPassword };
