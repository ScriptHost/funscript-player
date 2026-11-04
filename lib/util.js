'use strict';

// Kleine Helfer: sichere Pfade, Anfrage-Inhalt lesen, Dateien mit Range ausliefern, Titel aus Dateinamen
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { MIME } = require('./config');

// Verhindert Pfade außerhalb des Basisordners (../ usw.)
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

// Lesbarer Titel aus einem Dateinamen, wenn in Stash keiner gepflegt ist:
// „Studio_Szene.Name_1080p_60fps.mp4“ -> „Studio Szene Name“
function cleanTitle(basename) {
  if (!basename) return '';
  let t = basename.replace(/\.[a-z0-9]{2,4}$/i, '');
  t = t.replace(/[[(][^\])]*(\d{3,4}p|\dk|fps|x26[45]|h\.?26[45]|hevc|web|hd|uhd)[^\])]*[\])]/gi, ' ');
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/\b(\d{3,4}p|[2-8]k|uhd|fhd|hd|\d{2,3}fps|x26[45]|h ?26[45]|hevc|avc|aac|web(rip|dl)?|mp4|180|360|lr|sbs|tb|3dh|3dv|vr|mkx\d+|fisheye\d*)\b/gi, ' ');
  t = t.replace(/\s*-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return t || basename;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Zu groß'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function sendFile(req, res, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    res.writeHead(404);
    return res.end('Nicht gefunden');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');

  if (range && (range[1] || range[2])) {
    let start, end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    } else {
      start = Math.max(stat.size - Number(range[2]), 0);
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// 1.19.10: Text für „docker logs“ – keine Zeilenumbrüche oder Steuerzeichen (sonst ließen sich Logzeilen fälschen)
const logSafe = (s) => String(s).replace(/[\n\r]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');

module.exports = { safeJoin, cleanTitle, readBody, sendFile, logSafe };
