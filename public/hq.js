'use strict';

// ===========================================================================
// HQ-Stream: der Server wandelt das Video live um (Intel Quick Sync / VAAPI):
// entrauschen -> hochskalieren -> Details verstärken -> H.264.
// Spulen startet die Umwandlung an der neuen Stelle neu (wie bei Jellyfin).
//
// „Auto“ (Standard) nimmt immer die sinnvollste Einstellung:
//   - Video kleiner als der Bildschirm -> hochskalieren auf Bildschirmgröße (max. 1440p)
//   - Video so groß wie/größer als der Bildschirm (z. B. 4K) oder VR -> Original, nie herunterrechnen
// ===========================================================================

const hqState = {
  available: false,
  accel: '',
  preset: store.get('hqPreset2', 'auto'),   // 'off' | 'auto' | 'clean' | 'strong'
  height: store.get('hqHeight2', 'auto'),   // 'auto' | 720 | 1080 | 1440
  probes: new Map(),                        // Quelle -> { width, height, duration, codec }
  pending: 0,
  downgraded: new Set(),                    // Videos, bei denen HQ wegen Ruckeln abgeschaltet wurde
};
const HQ_ACCEL_LABEL = { vaapi: 'Intel-Grafik (VAAPI / Quick Sync)', cpu: 'Prozessor (ohne Grafik-Beschleunigung)' };

// Bildschirmhöhe im Querformat in echten Pixeln, auf übliche Stufen gerundet (max. 1440p für die N305)
function screenTarget() {
  const px = Math.min(screen.width, screen.height) * (window.devicePixelRatio || 1);
  return px >= 1300 ? 1440 : px >= 900 ? 1080 : 720;
}

// VR: sehr breites Bild (SBS) oder typische Kennung im Namen bzw. Titel
const VR_NAME = /(^|[\s._\-()[\]])(vr|180|190|200|220|360|lr|sbs|tb|3dh|3dv|fisheye\d*|mkx200|mkx220|vrca220|rf52)($|[\s._\-()[\]])/i;
const isVr = (info) => (info.width && info.height && info.width / info.height >= 1.9)
  || VR_NAME.test(decodeURIComponent(hq.src)) || VR_NAME.test($('videoName').textContent);

// Was soll für dieses Video passieren? -> { use: bool, height, reason }
function hqDecision(info) {
  const target = hqState.height === 'auto' ? screenTarget() : Number(hqState.height);
  if (hqState.preset === 'off') return { use: false, reason: 'aus' };
  if (hqState.downgraded.has(hq.src)) return { use: false, reason: 'wegen Ruckeln abgeschaltet – Original' };
  if (isVr(info)) return { use: false, reason: 'VR-Video – Original (kein Herunterrechnen)' };
  if (info.height >= target * 0.9) {
    // Video ist schon so groß wie der Bildschirm: bei „Auto“ Original, sonst nur entrauschen/schärfen in Originalgröße
    if (hqState.preset === 'auto') return { use: false, reason: `${info.height}p ≥ Bildschirm (${target}p) – Original` };
    return { use: true, height: Math.min(info.height, 2160), reason: `Originalgröße ${info.height}p, nur entrauschen/schärfen` };
  }
  return { use: true, height: target, reason: `${info.height}p → ${target}p` };
}

function hqUrl(start) {
  const preset = hqState.preset === 'auto' ? 'natural' : hqState.preset; // Auto: natürlich, nur hochgerechnet
  return '/hq/stream?' + new URLSearchParams({ src: hq.src, t: start.toFixed(2), preset, h: hq.height || 1080 });
}

async function hqProbe(src) {
  if (hqState.probes.has(src)) return hqState.probes.get(src);
  const res = await fetch('/api/hq/probe?' + new URLSearchParams({ src }));
  if (!res.ok) throw new Error(await res.text());
  const info = await res.json();
  hqState.probes.set(src, info);
  return info;
}

// Aufruf aus loadVideo: true = hq.js setzt die Videoquelle selbst (nach der Prüfung)
function hqMaybeStart() {
  if (!hqState.available || hqState.preset === 'off' || !hq.src) return false;
  const src = hq.src;
  const token = ++hqState.pending;
  hqProbe(src).then((info) => {
    if (hq.src !== src || token !== hqState.pending) return;
    const d = hqDecision(info);
    hqShowInfo(info, d);
    if (d.use) { hq.height = d.height; hq.duration = info.duration; hqStart(0); }
    else video.src = hq.url;
  }).catch(() => { if (hq.src === src) video.src = hq.url; });
  return true;
}

function hqShowInfo(info, d) {
  const via = HQ_ACCEL_LABEL[hqState.accel] || hqState.accel;
  $('hqInfo').textContent = d.use
    ? `HQ aktiv: ${info.width}×${info.height} (${info.codec}) → ${d.height}p über ${via}`
    : `Original: ${d.reason}`;
}

// HQ-Stream ab Sekunde start beginnen
function hqStart(start) {
  hq.active = true;
  hq.offset = start;
  hqState.startedAt = Date.now();
  video.src = hqUrl(start);
  drawHeatmap();
}

// ---------------------------------------------------------------------------
// Selbstregelung: Stockt der HQ-Stream mehrmals (Server oder Netz kommen nicht
// hinterher), wird automatisch eine Stufe zurückgeschaltet:
// 1440p -> 1080p -> 720p -> Original. Kurz nach Start/Spulen wird nicht gezählt.
// ---------------------------------------------------------------------------
const HQ_STEPS = [1440, 1080, 720];
let hqStalls = [];
video.addEventListener('waiting', () => {
  if (!hq.active || video.paused || Date.now() - (hqState.startedAt || 0) < 4000) return;
  const now = Date.now();
  hqStalls = hqStalls.filter((t) => now - t < 60000).concat(now);
  if (hqStalls.length < 3) return;
  hqStalls = [];
  const lower = HQ_STEPS.find((h) => h < hq.height);
  if (lower && hq.height > 720) {
    log(`Ruckeln erkannt – HQ von ${hq.height}p auf ${lower}p reduziert.`);
    hq.height = lower;
    hqRestart(mediaTime());
  } else {
    log('Ruckeln erkannt – HQ für dieses Video aus, spiele das Original.');
    hqState.downgraded.add(hq.src);
    hqToOriginal();
  }
  $('hqInfo').textContent = `Automatisch angepasst: ${hq.active ? hq.height + 'p' : 'Original'}`;
});

// Spulen im HQ-Stream: Umwandlung an neuer Stelle neu starten
function hqRestart(at) {
  const wasPlaying = !video.paused;
  hqStart(at);
  if (wasPlaying) video.play().catch(() => {});
}

// Zurück zum Originalvideo an der aktuellen Stelle
function hqToOriginal() {
  const at = mediaTime();
  const wasPlaying = !video.paused;
  hq.active = false;
  hq.offset = 0;
  video.src = hq.url;
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = at;
    if (wasPlaying) video.play().catch(() => {});
  }, { once: true });
}

const HQ_LABEL = { off: 'Aus', auto: 'Auto', clean: 'Sauber', strong: 'Stark' };
function hqShowSelection() {
  document.querySelectorAll('#hqPresets button').forEach((b) => b.classList.toggle('active', b.dataset.hq === hqState.preset));
  $('hqHeight').value = String(hqState.height);
  $('hqLabel').textContent = hqState.available ? HQ_LABEL[hqState.preset] : '–';
}

// Einstellung geändert: laufendes Video sofort neu entscheiden
async function hqApply() {
  store.set('hqPreset2', hqState.preset);
  store.set('hqHeight2', hqState.height);
  hqShowSelection();
  if (!video.src || !hq.src || !hqState.available) return;
  const info = await hqProbe(hq.src).catch(() => null);
  if (!info) return;
  const d = hqDecision(info);
  hqShowInfo(info, d);
  if (d.use) {
    hq.height = d.height;
    hq.duration = info.duration;
    hqRestart(mediaTime());
  } else if (hq.active) {
    hqToOriginal();
  }
}

document.querySelectorAll('#hqPresets button').forEach((b) => b.addEventListener('click', () => {
  hqState.preset = b.dataset.hq;
  hqApply();
}));
$('hqHeight').addEventListener('change', () => {
  const v = $('hqHeight').value;
  hqState.height = v === 'auto' ? 'auto' : Number(v);
  hqApply();
});

// Fehler im HQ-Stream -> automatisch zurück zum Original
video.addEventListener('error', () => {
  if (!hq.active) return;
  log('HQ-Stream fehlgeschlagen – spiele das Original ab.', true);
  hqToOriginal();
});

// Leistungstest: wie viel schneller als Echtzeit schafft der Server die Umwandlung?
$('hqBench').addEventListener('click', async () => {
  if (!hq.src) return log('Bitte zuerst ein Video aus der Bibliothek öffnen (nicht per Datei).', true);
  const btn = $('hqBench');
  btn.disabled = true;
  btn.textContent = 'Teste 20 Sekunden …';
  try {
    const info = await hqProbe(hq.src);
    const d = hqDecision({ ...info, height: Math.min(info.height, 719) }); // Test immer mit Hochskalieren
    const res = await fetch('/api/hq/bench?' + new URLSearchParams({
      src: hq.src, preset: ['clean', 'strong'].includes(hqState.preset) ? hqState.preset : 'clean', h: d.height || screenTarget(),
    }));
    if (!res.ok) throw new Error(await res.text());
    const r = await res.json();
    const verdict = r.speed >= 1.5 ? '✅ flüssig' : r.speed >= 1.05 ? '⚠️ knapp, kann bei Spitzen ruckeln' : '❌ zu langsam für Echtzeit – niedrigere Auflösung wählen';
    $('hqInfo').textContent = `${HQ_ACCEL_LABEL[r.accel] || r.accel}: ${r.speed.toFixed(1)}× Echtzeit (${Math.round(r.fps)} Bilder/s), `
      + `${r.source.width}×${r.source.height} → ${r.target.w}×${r.target.h} – ${verdict}`;
  } catch (e) {
    $('hqInfo').textContent = 'Test fehlgeschlagen: ' + (e.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Leistung testen';
  }
});

// Start: Ist ffmpeg auf dem Server verfügbar?
(async () => {
  try {
    const s = await (await fetch('/api/hq/status')).json();
    hqState.available = s.available;
    hqState.accel = s.accel || '';
    $('hqBox').hidden = !s.available;
    $('hqInfo').textContent = s.available
      ? `Umwandlung über ${HQ_ACCEL_LABEL[s.accel] || s.accel}. Auto-Ziel für dieses Gerät: ${screenTarget()}p.`
      : '';
  } catch { /* ohne HQ */ }
  hqState.checked = true;
  hqShowSelection();
  document.dispatchEvent(new Event('hq-ready'));
})();
