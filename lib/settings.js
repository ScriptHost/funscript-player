'use strict';

// Server-Einstellungen aus der Oberfläche (data/settings.json): HereSphere, Passwort, Intiface.
// HERESPHERE=off in der Umgebung schaltet HereSphere fest ab – dann lässt es sich in der Oberfläche nicht einschalten.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { AUTH_PASS, AUTH_USER, DATA_DIR, EXAMPLE_PASS, LOGIN_OFF } = require('./config');
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

// --- test10: eigenes Player-Passwort (statt AUTH_PASS aus der .env) -------------------------------------------
// loginPass = { salt, hash, kdf, env } – env = SHA-256 des AUTH_PASS beim Setzen. Ändert jemand AUTH_PASS in der
// .env, gilt das eigene Passwort nicht mehr (Rettungsweg, falls es vergessen ist).
const envMark = () => crypto.createHash('sha256').update(String(AUTH_PASS)).digest('hex');
const loginOwnActive = () => !!AUTH_USER && !!serverSettings.loginPass && serverSettings.loginPass.env === envMark();
let loginOk = new Set(); // geprüfte Anmeldungen (SHA-256 des Headers) – scrypt nicht bei jeder Anfrage
function loginCheckPassword(pw) {
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
async function setLoginPassword(current, next) {
  if (!AUTH_USER) return { status: 400, msg: 'noEnvLogin' };
  if (!loginCheckPassword(String(current || ''))) return { status: 403, msg: 'wrongCurrent' };
  if (next === null) {
    serverSettings.loginPass = null;
  } else {
    next = String(next || '');
    if (next.length < 8) return { status: 400, msg: 'tooShort' };
    if (next === EXAMPLE_PASS) return { status: 400, msg: 'example' };
    serverSettings.loginPass = { ...newPass(next), env: envMark() };
  }
  loginOk = new Set();
  await save();
  return { status: 200 };
}

function publicSettings() {
  return {
    heresphere: heresphereOn(), heresphereLocked: HS_LOCKED_OFF, hsVrOnly: serverSettings.hsVrOnly !== false, hsRedirect: serverSettings.hsRedirect !== false,
    hsPassword: !!serverSettings.hsPass, login: !LOGIN_OFF, loginOwn: loginOwnActive(), loginChangeable: !!AUTH_USER,
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

module.exports = { serverSettings, heresphereOn, hsRedirectOn, intifaceLanOnly, hsCheckPassword, hsToken, hsAuthorized, publicSettings, writeSettings, loginCheckHeader, loginOwnActive, setLoginPassword };
