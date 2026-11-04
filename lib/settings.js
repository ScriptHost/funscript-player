'use strict';

// Server-Einstellungen aus der Oberfläche (data/settings.json): HereSphere, Passwort, Intiface.
// HERESPHERE=off in der Umgebung schaltet HereSphere fest ab – dann lässt es sich in der Oberfläche nicht einschalten.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { readBody } = require('./util');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HS_LOCKED_OFF = /^(0|off|false|nein)$/i.test(process.env.HERESPHERE || '');
// INTIFACE_LAN_ONLY=1: Intiface-Weiterleitung fest nur ins Heimnetz (192.168.x / 10.x)
const LAN_LOCKED = /^(1|on|true|ja)$/i.test(process.env.INTIFACE_LAN_ONLY || '');
// hsVrOnly: HereSphere zeigt nur VR-Videos; hsPass: Salz + Hash des optionalen HereSphere-Passworts;
// hsSecret: Schlüssel, mit dem die HereSphere-Tokens unterschrieben werden; v: Stand der Einstellungen
let serverSettings = { heresphere: true, hsVrOnly: true, hsPass: null, intifaceLan: true, hsSecret: '', v: 2 };
let loaded = false;
try { Object.assign(serverSettings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); loaded = true; } catch { /* Standard */ }
// 1.19.5: Intiface-Weiterleitung standardmäßig nur noch ins Heimnetz (vorher alle privaten Adressen inkl. Docker-Netze)
if (loaded && (serverSettings.v || 1) < 2) {
  serverSettings.intifaceLan = true;
  serverSettings.v = 2;
  save().catch(() => {});
}
const heresphereOn = () => !HS_LOCKED_OFF && serverSettings.heresphere !== false;
const intifaceLanOnly = () => LAN_LOCKED || !!serverSettings.intifaceLan;

// HereSphere-Passwort (1.19.5): scrypt statt einfachem SHA-256 – Durchprobieren wird teuer.
// Ältere Einträge (ohne kdf) werden beim nächsten richtigen Login auf scrypt umgestellt.
const scrypt = (salt, pw) => crypto.scryptSync(String(pw).slice(0, 200), salt, 32).toString('hex');
const legacyHash = (salt, pw) => crypto.createHash('sha256').update(`${salt}:${pw}`).digest('hex');
function newPass(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: scrypt(salt, pw), kdf: 'scrypt' };
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function hsCheckPassword(pw) {
  const p = serverSettings.hsPass;
  if (!p) return true;
  if (p.kdf === 'scrypt') return same(scrypt(p.salt, pw), p.hash);
  if (!same(legacyHash(p.salt, String(pw).slice(0, 200)), p.hash)) return false;
  serverSettings.hsPass = newPass(pw);
  save().catch(() => {});
  return true;
}

// Token für HereSphere (1.19.5): unterschrieben und 30 Tage gültig – „<Ablauf>.<Signatur>“. Die Signatur hängt am
// Passwort-Hash: neues Passwort = alle alten Tokens ungültig. Vorher war das Token dauerhaft gleich.
const TOKEN_DAYS = 30;
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
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  return `${exp}.${sign(exp)}`;
}
function hsAuthorized(req, url) {
  if (!serverSettings.hsPass) return true;
  const given = String(req.headers['auth-token'] || url.searchParams.get('hs') || '');
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(given);
  return !!m && Number(m[1]) > Date.now() / 1000 && same(m[2], sign(Number(m[1])));
}

function publicSettings() {
  return {
    heresphere: heresphereOn(), heresphereLocked: HS_LOCKED_OFF, hsVrOnly: serverSettings.hsVrOnly !== false,
    hsPassword: !!serverSettings.hsPass, intifaceLan: intifaceLanOnly(), intifaceLanLocked: LAN_LOCKED,
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
  if (typeof body.intifaceLan === 'boolean') serverSettings.intifaceLan = body.intifaceLan;
  // Leer = Passwort entfernen; gespeichert wird nur Salz + Hash
  if (typeof body.hsPassword === 'string') serverSettings.hsPass = body.hsPassword ? newPass(body.hsPassword) : null;
  await save();
}

module.exports = { SETTINGS_FILE, HS_LOCKED_OFF, LAN_LOCKED, serverSettings, heresphereOn, intifaceLanOnly, hsCheckPassword, hsToken, hsAuthorized, publicSettings, writeSettings };
