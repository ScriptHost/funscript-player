
import { video } from './state.js';
import { $, log, store } from './handy.js';
import { stage } from './fullscreen.js';

// ===========================================================================
// Bildverbesserung in Echtzeit (WebGL, läuft auf der Grafik des Abspielgeräts)
//   Pass 1: Skalieren auf Bildschirmgröße – Catmull-Rom (bikubisch) beim
//           Vergrößern, 4-fach-Mittelung beim Verkleinern (kein Flimmern).
//   Pass 2: AMD FidelityFX CAS (Contrast Adaptive Sharpening), danach
//           Helligkeit/Kontrast/Sättigung und Dithering gegen Farbtreppen.
// Das Video bleibt darunter und spielt normal; gezeichnet wird auf ein Canvas.
// ===========================================================================

const ENH_PRESETS = {
  off: null,
  natural: { sharp: 35, contrast: 3, saturation: 6, brightness: 0, deband: true },
  sharp: { sharp: 65, contrast: 6, saturation: 10, brightness: 1, deband: true },
  max: { sharp: 95, contrast: 10, saturation: 16, brightness: 2, deband: true },
};
const ENH_LABEL = { auto: 'Auto', off: 'Aus', natural: 'Natürlich', sharp: 'Schärfer', max: 'Maximal', custom: 'Eigene' };

// „Auto“ (seit 1.19.3 natürlicher): nur dezent nachschärfen, je nach Vergrößerungsfaktor (Anzeigehöhe /
// Videohöhe) höchstens 25 %. Kontrast, Farbe und Helligkeit bleiben wie im Original; Farbtreppen glätten bleibt.
function enhAutoValues() {
  const f = enh.zoom || 1;
  const sharp = f >= 2 ? 25 : f >= 1.4 ? 18 : f > 1.05 ? 12 : 6;
  return { sharp, contrast: 0, saturation: 0, brightness: 0, deband: true };
}
const presetValues = (s) => (s.preset === 'custom' ? s : s.preset === 'auto' ? enhAutoValues() : ENH_PRESETS[s.preset] || ENH_PRESETS.natural);

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Pass 1: Skalieren
const FRAG_SCALE = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_size;   // Videogröße in Pixeln
uniform vec2 u_out;    // Ausgabegröße in Pixeln
uniform float u_down;  // 1 = verkleinern

vec4 catmullRom(vec2 uv) {
  vec2 p = uv * u_size;
  vec2 t1 = floor(p - 0.5) + 0.5;
  vec2 f = p - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / u_size;
  vec2 t3 = (t1 + 2.0) / u_size;
  vec2 t12 = (t1 + w2 / w12) / u_size;
  vec4 c = texture2D(u_tex, vec2(t0.x, t0.y)) * w0.x * w0.y
         + texture2D(u_tex, vec2(t12.x, t0.y)) * w12.x * w0.y
         + texture2D(u_tex, vec2(t3.x, t0.y)) * w3.x * w0.y
         + texture2D(u_tex, vec2(t0.x, t12.y)) * w0.x * w12.y
         + texture2D(u_tex, vec2(t12.x, t12.y)) * w12.x * w12.y
         + texture2D(u_tex, vec2(t3.x, t12.y)) * w3.x * w12.y
         + texture2D(u_tex, vec2(t0.x, t3.y)) * w0.x * w3.y
         + texture2D(u_tex, vec2(t12.x, t3.y)) * w12.x * w3.y
         + texture2D(u_tex, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return c;
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  if (u_down > 0.5) {
    vec2 o = 0.25 / u_out;
    gl_FragColor = 0.25 * (texture2D(u_tex, uv + vec2(-o.x, -o.y)) + texture2D(u_tex, uv + vec2(o.x, -o.y))
                         + texture2D(u_tex, uv + vec2(-o.x, o.y)) + texture2D(u_tex, uv + vec2(o.x, o.y)));
  } else {
    gl_FragColor = vec4(clamp(catmullRom(uv).rgb, 0.0, 1.0), 1.0);
  }
}`;

// Pass 2: Schärfen (CAS) + Farbe + Dithering, optional Vorher/Nachher
const FRAG_SHARP = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;    // skaliertes Bild
uniform sampler2D u_orig;   // Originalvideo (für den Vergleich)
uniform vec2 u_px;          // 1 / Größe
uniform float u_sharp;      // 0..1
uniform float u_contrast;   // z. B. 1.06
uniform float u_sat;        // z. B. 1.10
uniform float u_bright;     // z. B. 0.01
uniform float u_deband;     // 0/1
uniform float u_split;      // 0 = aus, sonst x-Position der Trennlinie
uniform float u_frame;

vec3 tex(vec2 o) { return texture2D(u_tex, v_uv + o * u_px).rgb; }

void main() {
  if (u_split > 0.0 && v_uv.x < u_split) {
    gl_FragColor = vec4(texture2D(u_orig, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0);
    if (abs(v_uv.x - u_split) < u_px.x * 1.5) gl_FragColor = vec4(1.0);
    return;
  }
  vec3 a = tex(vec2(-1.0, -1.0)), b = tex(vec2(0.0, -1.0)), c = tex(vec2(1.0, -1.0));
  vec3 d = tex(vec2(-1.0, 0.0)),  e = tex(vec2(0.0, 0.0)),  f = tex(vec2(1.0, 0.0));
  vec3 g = tex(vec2(-1.0, 1.0)),  h = tex(vec2(0.0, 1.0)),  i = tex(vec2(1.0, 1.0));

  vec3 col = e;
  if (u_sharp > 0.0) {
    vec3 mn = min(min(min(d, e), min(f, b)), h);
    vec3 mn2 = min(mn, min(min(a, c), min(g, i)));
    mn += mn2;
    vec3 mx = max(max(max(d, e), max(f, b)), h);
    vec3 mx2 = max(mx, max(max(a, c), max(g, i)));
    mx += mx2;
    vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
    vec3 w = amp * (-1.0 / mix(8.0, 5.0, u_sharp));
    col = clamp(((b + d + f + h) * w + e) / (1.0 + 4.0 * w), 0.0, 1.0);
  }

  col += u_bright;
  col = (col - 0.5) * u_contrast + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, u_sat);

  if (u_deband > 0.5) {
    // Dreiecksverteiltes Rauschen von ±1 Stufe überdeckt Farbtreppen in Verläufen
    vec2 p = gl_FragCoord.xy + u_frame * vec2(17.0, 31.0);
    float n1 = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    float n2 = fract(sin(dot(p, vec2(39.3468, 11.135))) * 24634.6345);
    col += (n1 - n2) / 255.0;
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const enh = {
  canvas: $('enh'),
  gl: null,
  ok: false,
  settings: { preset: 'auto', sharp: 35, contrast: 3, saturation: 6, brightness: 0, deband: true, compare: false },
  lastTime: -1,
  frame: 0,
  dirty: true,
};

function enhSetup() {
  const gl = enh.canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return false;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (frag) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const name = gl.getActiveUniform(p, k).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u, pos: gl.getAttribLocation(p, 'a_pos') };
  };
  const texture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  enh.gl = gl;
  enh.scale = program(FRAG_SCALE);
  enh.sharpen = program(FRAG_SHARP);
  enh.videoTex = texture();
  enh.midTex = texture();
  enh.fbo = gl.createFramebuffer();
  enh.quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, enh.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  enh.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); enh.ok = false; });
  enh.canvas.addEventListener('webglcontextrestored', () => { enh.ok = enhInit(); });
  return true;
}

function enhInit() {
  try {
    return enhSetup();
  } catch (e) {
    console.warn('Bildverbesserung nicht verfügbar:', e);
    return false;
  }
}

// Im Hintergrund und im kleinen Fenster (Bild-in-Bild) nie: Der Browser zeichnet dann nicht weiter,
// das kleine Fenster bliebe schwarz – dort läuft das Video selbst.
const enhBackground = () => document.hidden || !!document.pictureInPictureElement;
// Beim Videowechsel: Zeichenfläche schwarz, bis das neue Video sein erstes Bild hat
export function enhClear() {
  if (!enh.ok || !enh.gl) return;
  const gl = enh.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  enh.lastTime = -1;
  enh.dirty = true;
}
function enhActive() {
  return enh.ok && enh.settings.preset !== 'off' && video.videoWidth > 0 && !video.dataset.noEnhance && !enhBackground();
}

function enhParams() {
  const s = enh.settings;
  const p = presetValues(s);
  return {
    sharp: p.sharp / 100,
    contrast: 1 + p.contrast / 100,
    sat: 1 + p.saturation / 100,
    bright: p.brightness / 100,
    deband: p.deband ? 1 : 0,
  };
}

// Wo das Video im Canvas liegt: „Einpassen“ (Balken) oder „Füllen“ (Zoom) wie object-fit
function enhRect(cw, ch) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cover = stage.classList.contains('fs') && stage.dataset.fit === 'cover';
  const scale = cover ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  return { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w, h };
}

function enhDraw() {
  const gl = enh.gl;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(enh.canvas.clientWidth * dpr), ch = Math.round(enh.canvas.clientHeight * dpr);
  if (!cw || !ch) return;
  if (enh.canvas.width !== cw || enh.canvas.height !== ch) { enh.canvas.width = cw; enh.canvas.height = ch; }
  const r = enhRect(cw, ch);
  const newScale = r.h / video.videoHeight;
  // Vergrößerungsfaktor (eigener Name – enh.scale ist das Shader-Programm)
  if (Math.abs(newScale - (enh.zoom || 0)) > 0.05) { enh.zoom = newScale; if (enh.settings.preset === 'auto') setTimeout(enhApply); }
  // Zwischenbild höchstens so groß wie der sichtbare Teil (spart Leistung bei „Füllen“)
  const mw = Math.min(r.w, cw * 1.5 | 0), mh = Math.min(r.h, ch * 1.5 | 0);

  try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, enh.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  } catch (e) {
    // z. B. Video von fremder Adresse ohne Freigabe – dann ohne Verbesserung
    video.dataset.noEnhance = '1';
    log('Bildverbesserung für dieses Video nicht möglich.', true);
    return;
  }

  // Pass 1: skalieren in ein Zwischenbild
  if (enh.midW !== mw || enh.midH !== mh) {
    gl.bindTexture(gl.TEXTURE_2D, enh.midTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, mw, mh, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, enh.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, enh.midTex, 0);
    enh.midW = mw;
    enh.midH = mh;
  }
  const quad = (prog) => {
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, enh.quad);
    gl.enableVertexAttribArray(prog.pos);
    gl.vertexAttribPointer(prog.pos, 2, gl.FLOAT, false, 0, 0);
  };
  gl.bindFramebuffer(gl.FRAMEBUFFER, enh.fbo);
  gl.viewport(0, 0, mw, mh);
  quad(enh.scale);
  gl.bindTexture(gl.TEXTURE_2D, enh.videoTex);
  gl.uniform1i(enh.scale.u.u_tex, 0);
  gl.uniform2f(enh.scale.u.u_size, video.videoWidth, video.videoHeight);
  gl.uniform2f(enh.scale.u.u_out, mw, mh);
  gl.uniform1f(enh.scale.u.u_down, video.videoWidth > mw * 1.25 ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2: schärfen + Farbe auf den Bildschirm
  const p = enhParams();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cw, ch);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.viewport(r.x, ch - r.y - r.h, r.w, r.h);
  quad(enh.sharpen);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, enh.midTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, enh.videoTex);
  const u = enh.sharpen.u;
  gl.uniform1i(u.u_tex, 0);
  gl.uniform1i(u.u_orig, 1);
  gl.uniform2f(u.u_px, 1 / mw, 1 / mh);
  gl.uniform1f(u.u_sharp, p.sharp);
  gl.uniform1f(u.u_contrast, p.contrast);
  gl.uniform1f(u.u_sat, p.sat);
  gl.uniform1f(u.u_bright, p.bright);
  gl.uniform1f(u.u_deband, p.deband);
  gl.uniform1f(u.u_split, enh.settings.compare ? 0.5 : 0);
  gl.uniform1f(u.u_frame, enh.frame++ % 64);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.activeTexture(gl.TEXTURE0);
  if (enh.checkDue) { enh.checkDue = false; enhBlackCheck(gl, r, ch); }
}

// Schutz gegen schwarzes Bild: Manche Android-Browser liefern nach dem Wechsel Vollbild <-> Mini-Player
// nur noch schwarze Bilder an WebGL, obwohl das Video läuft. Alle 2 s wird verglichen: Video hell,
// Ausgabe schwarz -> Bildverbesserung neu aufbauen; klappt das wiederholt nicht, normales Videobild.
const enhProbe = document.createElement('canvas');
function enhBlackCheck(gl, r, ch) {
  try {
    const px = new Uint8Array(4);
    gl.readPixels(r.x + (r.w >> 1), ch - r.y - (r.h >> 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = px[0] + px[1] + px[2];
    const c = enhProbe.getContext('2d', { willReadFrequently: true });
    c.drawImage(video, 0, 0, 8, 8);
    const d = c.getImageData(0, 0, 8, 8).data;
    let src = 0;
    for (let i = 0; i < d.length; i += 4) src += d[i] + d[i + 1] + d[i + 2];
    src /= 64;
    enh.blackHits = src > 60 && out < 6 ? (enh.blackHits || 0) + 1 : 0;
    if (enh.blackHits >= 2) enhRebuild();
  } catch { /* fremde Quelle o. Ä. – nichts prüfen */ }
}
function enhRebuild() {
  enh.blackHits = 0;
  enh.rebuilds = (enh.rebuilds || 0) + 1;
  if (enh.rebuilds > 2) {
    video.dataset.noEnhance = '1'; // dieses Video ohne Verbesserung, Bild bleibt sichtbar
    log('Bildverbesserung lieferte ein schwarzes Bild – für dieses Video aus.', true);
    return;
  }
  // Neues Canvas = neuer WebGL-Kontext
  const fresh = enh.canvas.cloneNode(false);
  enh.canvas.replaceWith(fresh);
  enh.canvas = fresh;
  enh.midW = enh.midH = 0;
  enh.ok = enhInit();
  enh.dirty = true;
}
// nach test2: auch beim Wechsel Player <-> Mini-Player (Ansichtswechsel) neu zeichnen und auf Schwarzbild prüfen
const enhRecheck = () => { enh.dirty = true; setTimeout(() => { enh.checkDue = true; }, 800); setTimeout(() => { enh.checkDue = true; }, 2500); };

// Neu zeichnen, sobald ein neues Videobild da ist (oder sich etwas geändert hat)
function enhLoop() {
  const on = enhActive();
  stage.classList.toggle('enhanced', on);
  if (on && video.readyState >= 2 && (video.currentTime !== enh.lastTime || enh.dirty || !video.paused)) {
    enh.lastTime = video.currentTime;
    enh.dirty = false;
    enhDraw();
  }
  requestAnimationFrame(enhLoop);
}

// ---------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------
function enhApply() {
  const s = enh.settings;
  store.set('enhance', s);
  document.querySelectorAll('#enhPresets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === s.preset));
  const values = presetValues(s);
  for (const k of ['sharp', 'contrast', 'saturation', 'brightness']) {
    $('enh_' + k).value = values[k];
    $('enh_' + k + 'Val').textContent = `${values[k] > 0 && k !== 'sharp' ? '+' : ''}${values[k]}${k === 'sharp' ? ' %' : ''}`;
  }
  $('enh_deband').checked = values.deband;
  $('enh_compare').checked = s.compare;
  $('enhSliders').classList.toggle('dim', s.preset === 'off');
  $('enhState').textContent = !enh.ok ? 'Nicht verfügbar (kein WebGL)' : ENH_LABEL[s.preset];
  enh.dirty = true;
}

export function enhSetPreset(preset) {
  // Eigene Werte starten mit der gerade gewählten Stufe
  if (preset === 'custom' && enh.settings.preset !== 'custom') {
    Object.assign(enh.settings, presetValues(enh.settings));
  }
  enh.settings.preset = preset;
  enhApply();
}

// Start (main.js ruft die Module in fester Reihenfolge auf): alles, was beim Laden der Seite einmal läuft
export function init() {
  // Sofort umschalten (die Zeichen-Schleife läuft im Hintergrund nicht mehr)
  ['visibilitychange', 'enterpictureinpicture', 'leavepictureinpicture'].forEach((ev) => (ev === 'visibilitychange' ? document : video)
    .addEventListener(ev, () => { stage.classList.toggle('enhanced', enhActive()); enh.dirty = true; }));
  enhProbe.width = enhProbe.height = 8;
  setInterval(() => { if (enhActive() && !video.paused) enh.checkDue = true; }, 2000);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, enhRecheck));
  window.addEventListener('hp:view', enhRecheck);
  document.querySelectorAll('#enhPresets button').forEach((b) => b.addEventListener('click', () => enhSetPreset(b.dataset.preset)));
  for (const k of ['sharp', 'contrast', 'saturation', 'brightness']) {
    $('enh_' + k).addEventListener('input', () => {
      if (enh.settings.preset !== 'custom') enhSetPreset('custom');
      enh.settings[k] = Number($('enh_' + k).value);
      enhApply();
    });
  }
  $('enh_deband').addEventListener('change', () => {
    if (enh.settings.preset !== 'custom') enhSetPreset('custom');
    enh.settings.deband = $('enh_deband').checked;
    enhApply();
  });
  $('enh_compare').addEventListener('change', () => { enh.settings.compare = $('enh_compare').checked; enhApply(); });
  video.addEventListener('loadstart', () => { delete video.dataset.noEnhance; enh.dirty = true; enh.rebuilds = 0; });
  ['seeked', 'loadeddata', 'resize'].forEach((ev) => video.addEventListener(ev, () => { enh.dirty = true; }));
  window.addEventListener('resize', () => { enh.dirty = true; });
  Object.assign(enh.settings, store.get('enhance', {}));
  // 1.19.7: einmalig auf „Auto“ – ältere Versionen hatten „Natürlich“ als Standard gespeichert (eigene Werte bleiben)
  if (!store.get('enhAuto1197', false)) {
    if (enh.settings.preset !== 'custom') enh.settings.preset = 'auto';
    if (store.get('hqPreset2', 'auto') !== 'off') store.set('hqPreset2', 'auto');
    store.set('enhAuto1197', true);
  }
  enh.ok = enhInit();
  enhApply();
  requestAnimationFrame(enhLoop);
}
