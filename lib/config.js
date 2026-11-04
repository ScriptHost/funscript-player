'use strict';

// Einstellungen aus der Umgebung (docker-compose.yml) und feste Werte
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || '/media');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MAX_STORE_BYTES = 5 * 1024 * 1024;
const STASH_URL = (process.env.STASH_URL || '').replace(/\/+$/, '');
const STASH_API_KEY = process.env.STASH_API_KEY || '';
const STASH_INSECURE = process.env.STASH_INSECURE === '1'; // selbstsigniertes Zertifikat bei Stash akzeptieren
// HQ-Stream: ffmpeg mit Intel-Grafik (VAAPI = Quick-Sync-Hardware) oder notfalls CPU
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const HQ_DEVICE = process.env.HQ_DEVICE || '/dev/dri/renderD128';
const HQ_MAX = Number(process.env.HQ_MAX) || 2; // gleichzeitige Umwandlungen (1.19.4: 2 – schont RAM/CPU kleiner Server)
const VERSION = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.funscript': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
};

module.exports = { PORT, HOST, MEDIA_DIR, PUBLIC_DIR, DATA_DIR, STORE_FILE, MAX_STORE_BYTES, STASH_URL, STASH_API_KEY, STASH_INSECURE, FFMPEG, FFPROBE, HQ_DEVICE, HQ_MAX, VERSION, AUTH_USER, AUTH_PASS, VIDEO_EXT, MIME };
