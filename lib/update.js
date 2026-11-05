'use strict';

// „Update verfügbar“: neuestes Release auf GitHub (höchstens alle 6 Stunden gefragt).
// Ohne Internet oder bei Fehlern einfach kein Hinweis.
const https = require('https');
const { VERSION } = require('./config');

const REPO = 'ScriptHost/funscript-player';
const TTL = 6 * 3600 * 1000;
let cache = { at: 0, data: null };
// 2.0: UPDATE_CHECK=off – GitHub wird nie gefragt
const UPDATE_OFF = /^(0|off|false|nein)$/i.test(process.env.UPDATE_CHECK || '');

// "1.19.10" > "1.19.9"
function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'funscript-player', Accept: 'application/vnd.github+json' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub: HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('keine Antwort')));
    req.on('error', reject);
  });
}

async function updateInfo() {
  if (UPDATE_OFF) return { current: VERSION, latest: '', url: '', available: false, off: true };
  if (Date.now() - cache.at > TTL) {
    cache.at = Date.now();
    try {
      const r = await fetchLatest();
      cache.data = { latest: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url || `https://github.com/${REPO}/releases/latest` };
    } catch { cache.data = null; }
  }
  const latest = cache.data?.latest || '';
  return { current: VERSION, latest, url: cache.data?.url || '', available: !!latest && newer(latest, VERSION) };
}

module.exports = { UPDATE_OFF, updateInfo, newer };
