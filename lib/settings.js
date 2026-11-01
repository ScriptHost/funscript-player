'use strict';

// Server-Einstellungen (data/settings.json): HereSphere, Passwort, Intiface
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { readBody } = require('./util');

// Patterns und Sequenzen aus dem Steuerungs-Reiter (eine JSON-Datei)
// Server-Einstellungen aus der Oberfläche (data/settings.json). HERESPHERE=off in der
// Umgebung schaltet HereSphere fest ab – dann lässt es sich in der Oberfläche nicht einschalten.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HS_LOCKED_OFF = /^(0|off|false|nein)$/i.test(process.env.HERESPHERE || '');
// INTIFACE_LAN_ONLY=1: Intiface-Weiterleitung fest nur ins Heimnetz (192.168.x / 10.x)
const LAN_LOCKED = /^(1|on|true|ja)$/i.test(process.env.INTIFACE_LAN_ONLY || '');
// hsVrOnly: HereSphere zeigt nur VR-Videos; hsPass: Salz + Hash des optionalen HereSphere-Passworts
let serverSettings = { heresphere: true, hsVrOnly: true, hsPass: null, intifaceLan: false };
try { Object.assign(serverSettings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch { /* Standard */ }
const heresphereOn = () => !HS_LOCKED_OFF && serverSettings.heresphere !== false;
const intifaceLanOnly = () => LAN_LOCKED || !!serverSettings.intifaceLan;

const hsHash = (salt, pw) => crypto.createHash('sha256').update(`${salt}:${pw}`).digest('hex');
// Anmelde-Token für HereSphere: hängt nur vom Passwort ab (übersteht Neustarts, neues Passwort = neues Token)
const hsToken = () => (serverSettings.hsPass ? crypto.createHash('sha256').update('token:' + serverSettings.hsPass.hash).digest('hex') : '');
function hsAuthorized(req, url) {
  if (!serverSettings.hsPass) return true;
  const given = String(req.headers['auth-token'] || url.searchParams.get('hs') || '');
  const want = hsToken();
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
function publicSettings() {
  return {
    heresphere: heresphereOn(), heresphereLocked: HS_LOCKED_OFF, hsVrOnly: serverSettings.hsVrOnly !== false,
    hsPassword: !!serverSettings.hsPass, intifaceLan: intifaceLanOnly(), intifaceLanLocked: LAN_LOCKED,
  };
}

async function writeSettings(req) {
  const body = JSON.parse(await readBody(req, 10000) || '{}');
  if (typeof body.heresphere === 'boolean') serverSettings.heresphere = body.heresphere;
  if (typeof body.hsVrOnly === 'boolean') serverSettings.hsVrOnly = body.hsVrOnly;
  if (typeof body.intifaceLan === 'boolean') serverSettings.intifaceLan = body.intifaceLan;
  if (typeof body.hsPassword === 'string') {
    // Leer = Passwort entfernen; gespeichert wird nur der Hash
    const salt = crypto.randomBytes(16).toString('hex');
    serverSettings.hsPass = body.hsPassword ? { salt, hash: hsHash(salt, body.hsPassword.slice(0, 200)) } : null;
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(serverSettings));
}

module.exports = { SETTINGS_FILE, HS_LOCKED_OFF, LAN_LOCKED, serverSettings, heresphereOn, intifaceLanOnly, hsHash, hsToken, hsAuthorized, publicSettings, writeSettings };
