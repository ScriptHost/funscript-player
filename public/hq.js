'use strict';

// ===========================================================================
// HQ-Stream: der Server wandelt das Video live um (Intel Quick Sync / VAAPI):
// entrauschen -> hochskalieren -> Details verstärken -> H.264.
// Spulen startet die Umwandlung an der neuen Stelle neu (wie bei Jellyfin).
// ===========================================================================

const hqState = {
  available: false,
  accel: '',
  preset: store.get('hqPreset', 'off'),   // 'off' | 'clean' | 'strong'
  height: store.get('hqHeight', 1080),
  probes: new Map(),                      // Quelle -> Dauer usw.
};
const HQ_ACCEL_LABEL = { vaapi: 'Intel-Grafik (VAAPI / Quick Sync)', cpu: 'Prozessor (ohne Grafik-Beschleunigung)' };

function hqWanted() {
  return hqState.available && hqState.preset !== 'off' && !!hq.src;
}

function hqUrl(start) {
  return '/hq/stream?' + new URLSearchParams({ src: hq.src, t: start.toFixed(2), preset: hqState.preset, h: hqState.height });
}

async function hqProbe(src) {
  if (hqState.probes.has(src)) return hqState.probes.get(src);
  const res = await fetch('/api/hq/probe?' + new URLSearchParams({ src }));
  if (!res.ok) throw new Error(await res.text());
  const info = await res.json();
  hqState.probes.set(src, info);
  return info;
}

// HQ-Stream ab Sekunde start beginnen
function hqStart(start) {
  hq.active = true;
  hq.offset = start;
  video.src = hqUrl(start);
  const src = hq.src;
  hqProbe(src).then((info) => {
    if (hq.src !== src) return;
    hq.duration = info.duration;
    $('hqInfo').textContent = `Quelle ${info.width}×${info.height} (${info.codec}) → ${hqState.height}p über ${HQ_ACCEL_LABEL[hqState.accel] || hqState.accel}`;
    drawHeatmap();
  }).catch(() => {});
}

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

// Einstellung geändert: laufendes Video sofort umschalten
function hqApply() {
  store.set('hqPreset', hqState.preset);
  store.set('hqHeight', hqState.height);
  document.querySelectorAll('#hqPresets button').forEach((b) => b.classList.toggle('active', b.dataset.hq === hqState.preset));
  $('hqHeight').value = hqState.height;
  if (!video.src || !hq.src) return;
  if (hqWanted()) hqRestart(mediaTime());
  else if (hq.active) hqToOriginal();
}

document.querySelectorAll('#hqPresets button').forEach((b) => b.addEventListener('click', () => {
  hqState.preset = b.dataset.hq;
  hqApply();
}));
$('hqHeight').addEventListener('change', () => { hqState.height = Number($('hqHeight').value); hqApply(); });

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
    const res = await fetch('/api/hq/bench?' + new URLSearchParams({
      src: hq.src, preset: hqState.preset === 'off' ? 'clean' : hqState.preset, h: hqState.height,
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
    $('hqInfo').textContent = s.available ? `Umwandlung über ${HQ_ACCEL_LABEL[s.accel] || s.accel}.` : '';
  } catch { /* ohne HQ */ }
  hqApply();
})();
