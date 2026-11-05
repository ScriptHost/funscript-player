'use strict';

// 2.0: Bremse gegen Durchprobieren von Passwörtern (Anmeldung im Browser und HereSphere-Login).
// Pro Absender höchstens FAIL_MAX Fehlversuche je Minute; danach wird bis zum Ende der Minute jede Anmeldung
// abgelehnt – auch eine richtige. Hinter einem Proxy zählen alle Anfragen gemeinsam (X-Forwarded-For lässt sich fälschen).
const FAIL_MAX = 10;
const WINDOW = 60 * 1000;
const fails = new Map();

const who = (req) => String(req.socket?.remoteAddress || '?');

function entry(req) {
  const k = who(req);
  let e = fails.get(k);
  if (!e || Date.now() - e.at > WINDOW) {
    e = { at: Date.now(), n: 0 };
    if (fails.size > 10000) fails.clear();
    fails.set(k, e);
  }
  return e;
}

const loginBlocked = (req) => entry(req).n >= FAIL_MAX;
function loginFailed(req) { entry(req).n++; }

module.exports = { FAIL_MAX, loginBlocked, loginFailed };
