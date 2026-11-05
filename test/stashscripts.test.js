'use strict';

// 2.0: Varianten zu Stash-Szenen im eingebundenen Ordner finden
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-stash-'));
process.env.MEDIA_DIR = media;
const { localVideo, stashVariants } = require('../lib/stashscripts');

test('Stash-Pfad → eingebundener Ordner, Varianten daneben', async () => {
  const dir = path.join(media, 'Stash', 'Studio');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clip.mp4'), '12345');
  for (const f of ['clip.funscript', 'clip.soft.funscript', 'clip.roll.funscript']) fs.writeFileSync(path.join(dir, f), '{}');
  fs.mkdirSync(path.join(media, 'Andere'));
  fs.writeFileSync(path.join(media, 'Andere', 'clip.mp4'), 'anders groß');
  assert.strictEqual(await localVideo('/data/videos/Studio/clip.mp4', 5), path.join(dir, 'clip.mp4'));
  assert.deepStrictEqual(await stashVariants('/data/videos/Studio/clip.mp4', 5), [{ name: 'soft', script: 'Stash/Studio/clip.soft.funscript' }]);
  assert.strictEqual(await localVideo('/data/videos/Studio/clip.mp4', 999), null, 'andere Größe: kein Treffer');
  assert.deepStrictEqual(await stashVariants('', 0), []);
  fs.rmSync(media, { recursive: true, force: true });
});
