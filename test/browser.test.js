'use strict';

// Browser-Selbsttest (1.19.9): startet den Player mit einem Ordner-Video (mit und ohne Funscript), öffnet
// ?selbsttest in Chrome ohne Bildschirm und erwartet „Selbsttest: n von n ok“. Gesteuert über das
// Chrome DevTools Protocol (WebSocket ist in Node 22 eingebaut) – keine zusätzlichen Pakete.
// Ohne Chrome/Edge wird der Test übersprungen; auf GitHub (CI=true) ist er Pflicht.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startServer, wait, ROOT } = require('./helpers');

const CANDIDATES = [
  process.env.CHROME,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));
const REQUIRED = process.env.CI === 'true';

test('Browser-Selbsttest (?selbsttest) läuft komplett grün', { skip: !BROWSER && !REQUIRED && 'kein Chrome/Edge gefunden', timeout: 90000 }, async () => {
  assert.ok(BROWSER, 'Chrome/Chromium nicht gefunden (Pfad per CHROME=… setzen)');
  const fix = path.join(ROOT, 'test', 'fixtures');
  const srv = await startServer({}, (media) => {
    const dir = path.join(media, 'Filme');
    fs.copyFileSync(path.join(fix, 'test.mp4'), path.join(dir, 'test.mp4'));
    fs.copyFileSync(path.join(fix, 'test.funscript'), path.join(dir, 'test.funscript'));
    fs.copyFileSync(path.join(fix, 'test.mp4'), path.join(dir, 'ohne-script.mp4'));
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox',
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    // Seite des Browsers finden und per DevTools-Protokoll verbinden
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      await wait(250);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* startet noch */ }
    }
    assert.ok(target, 'Chrome startet nicht');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

    await send('Page.navigate', { url: `${srv.base}/?selbsttest` });
    let text = '';
    for (let i = 0; i < 120; i++) {
      await wait(500);
      text = (await evaluate("document.querySelector('.selftest')?.innerText || ''")) || '';
      if (/Selbsttest: \d+ von \d+/.test(text)) break;
    }
    const m = /Selbsttest: (\d+) von (\d+)/.exec(text);
    assert.ok(m, 'Selbsttest lief nicht durch:\n' + text);
    assert.strictEqual(m[1], m[2], 'Fehlgeschlagen:\n' + text.split('\n').filter((l) => l.startsWith('❌')).join('\n'));
  } finally {
    try { ws?.close(); } catch { /* egal */ }
    chrome.kill();
    srv.stop();
    await wait(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
