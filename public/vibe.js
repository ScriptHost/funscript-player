'use strict';

// ===========================================================================
// Vibratoren (Satisfyer u. a.)
//   1. Direkt per Web Bluetooth aus dem Browser (wie XToys) – Chrome auf
//      Android/PC/Mac, auf dem iPhone die App „Bluefy“. Keine Extra-App nötig.
//   2. Alternativ über Intiface Central (Buttplug-Protokoll v3 per WebSocket).
//      Ist die Seite per HTTPS geöffnet, läuft das über den Server (/intiface).
// Alle Geräte haben dieselbe Schnittstelle: { name, enabled, level, setLevel(0–1) }.
// ===========================================================================

// ---------------------------------------------------------------------------
// Satisfyer direkt per Bluetooth (Protokoll laut Buttplug.io)
// ---------------------------------------------------------------------------
const SF_SERVICE = '51361500-c5e7-47c7-8a6e-47ebc99d80e8';
const SF_COMMAND = '51361501-c5e7-47c7-8a6e-47ebc99d80e8';
const SF_TX = '51361502-c5e7-47c7-8a6e-47ebc99d80e8';

class SatisfyerBle {
  constructor(device) {
    this.device = device;
    this.name = device.name || 'Satisfyer';
    this.kind = 'Bluetooth';
    this.enabled = !store.get('vibeOff', []).includes(this.name);
    this.motors = store.get('motors.' + this.name, 1);
    this.level = -1;
    this.tx = null;
    this.packet = null;
    this.dirty = false;
    this.writing = false;
    this.keepalive = null;
  }

  async connect() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SF_SERVICE);
    const command = await service.getCharacteristic(SF_COMMAND);
    this.tx = await service.getCharacteristic(SF_TX);
    await command.writeValueWithResponse(new Uint8Array([0x01]));
    // Satisfyer schalten ab, wenn nicht regelmäßig ein Befehl kommt
    this.keepalive = setInterval(() => { if (this.packet) { this.dirty = true; this.flush(); } }, 500);
  }

  // Stärke 0–1 -> pro Motor 4 Bytes mit Wert 0–100
  setLevel(level) {
    this.packet = new Uint8Array(4 * this.motors).fill(Math.round(level * 100));
    this.dirty = true;
    return this.flush();
  }

  // Bluetooth erlaubt nur einen Schreibvorgang gleichzeitig
  async flush() {
    if (this.writing || !this.tx) return;
    this.writing = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        await (this.tx.writeValueWithoutResponse ? this.tx.writeValueWithoutResponse(this.packet) : this.tx.writeValue(this.packet));
      }
    } finally {
      this.writing = false;
    }
  }

  disconnect() {
    clearInterval(this.keepalive);
    this.tx = null;
    try { this.device.gatt.disconnect(); } catch { /* schon getrennt */ }
  }
}

const bleDevices = [];

// Warum Bluetooth nicht geht – in Klartext
async function bluetoothProblem() {
  if (!window.isSecureContext) {
    return 'Bluetooth ist gesperrt, weil die Seite nicht als sicher gilt. Nötig ist HTTPS mit gültigem Zertifikat '
      + '(z. B. über deinen Reverse Proxy mit Let’s Encrypt). http:// oder ein selbstsigniertes Zertifikat reichen nicht.';
  }
  if (!navigator.bluetooth) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return ios
      ? 'Safari auf dem iPhone kann kein Bluetooth. Bitte die App „Bluefy“ als Browser nutzen – oder Intiface.'
      : 'Dieser Browser kann kein Web Bluetooth (z. B. Firefox, Samsung Internet). Bitte Chrome oder Edge nutzen.';
  }
  try {
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) {
      return 'Bluetooth ist am Gerät ausgeschaltet oder Chrome fehlt die Berechtigung „Geräte in der Nähe“/Standort.';
    }
  } catch { /* nicht prüfbar */ }
  return '';
}

async function addBluetoothDevice() {
  const problem = await bluetoothProblem();
  if (problem) {
    $('vibeBleHint').textContent = problem;
    $('vibeBleHint').classList.add('warn');
    return log(problem, true);
  }
  try {
    // Standard: nur Satisfyer („SF …“). Mit „Alle Bluetooth-Geräte anzeigen“, falls er anders heißt.
    const device = await navigator.bluetooth.requestDevice($('vibeAll').checked
      ? { acceptAllDevices: true, optionalServices: [SF_SERVICE] }
      : { filters: [{ namePrefix: 'SF ' }, { services: [SF_SERVICE] }], optionalServices: [SF_SERVICE] });
    if (bleDevices.some((d) => d.device.id === device.id)) return log(`${device.name} ist schon verbunden.`);
    await attachBleDevice(device);
  } catch (e) {
    if (e.name === 'NotFoundError') {
      log('Kein Gerät gewählt. Tipp: Satisfyer einschalten, Satisfyer-App schließen (nur eine Verbindung möglich), '
        + 'ggf. „Alle Bluetooth-Geräte anzeigen“ aktivieren.');
    } else if (e.name === 'NetworkError' || /GATT|service/i.test(e.message)) {
      log(`Bluetooth: ${e.message}. Ist das Gerät noch mit der Satisfyer-App oder einem anderen Handy verbunden?`, true);
    } else if (e.name === 'SecurityError') {
      log('Bluetooth wurde vom Browser blockiert – HTTPS mit gültigem Zertifikat nötig.', true);
    } else {
      log('Bluetooth: ' + e.message, true);
    }
  }
  renderVibe();
}

// Gerät verbinden und bei kurzen Abbrüchen automatisch wieder verbinden
async function attachBleDevice(device) {
  {
    const dev = new SatisfyerBle(device);
    log(`Verbinde mit ${dev.name} …`);
    await dev.connect();
    bleDevices.push(dev);
    // Bricht Bluetooth kurz ab, bis zu 3× neu verbinden, bevor das Gerät entfernt wird
    device.addEventListener('gattserverdisconnected', async () => {
      clearInterval(dev.keepalive);
      dev.tx = null;
      if (dev.closed) return;
      for (let attempt = 1; attempt <= 3; attempt++) {
        log(`${dev.name}: Verbindung verloren – neuer Versuch ${attempt}/3 …`, true);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        if (dev.closed) return;
        try {
          await dev.connect();
          dev.level = -1;
          log(`${dev.name} wieder verbunden.`);
          renderVibe();
          return;
        } catch { /* nächster Versuch */ }
      }
      const i = bleDevices.indexOf(dev);
      if (i >= 0) bleDevices.splice(i, 1);
      log(`${dev.name}: Verbindung verloren. Bitte neu verbinden.`, true);
      renderVibe();
    });
    log(`${dev.name} verbunden.`);
  }
  renderVibe();
}

// Beim Start: schon einmal erlaubte Satisfyer wieder verbinden (Chrome kennt sie über getDevices)
async function autoConnectBluetooth() {
  if (!store.get('autoConnect', true) || !navigator.bluetooth?.getDevices || (await bluetoothProblem())) return;
  try {
    for (const device of await navigator.bluetooth.getDevices()) {
      if (bleDevices.some((d) => d.device.id === device.id)) continue;
      attachBleDevice(device).catch(() => { /* nicht in Reichweite – still ignorieren */ });
    }
  } catch { /* nicht unterstützt */ }
}

// ---------------------------------------------------------------------------
// Intiface Central (Buttplug-Protokoll v3)
// ---------------------------------------------------------------------------
class Buttplug {
  constructor() {
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
    this.devices = new Map();
    this.scanning = false;
    this.pingTimer = null;
    this.onchange = () => {};
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error('Zeitüberschreitung – läuft der Server in Intiface?')); }, 8000);
      ws.onopen = async () => {
        clearTimeout(timer);
        try {
          const info = await this.send('RequestServerInfo', { ClientName: 'Handy Player', MessageVersion: 3 });
          if (info.MaxPingTime > 0) this.pingTimer = setInterval(() => this.send('Ping', {}).catch(() => {}), info.MaxPingTime / 2);
          const list = await this.send('RequestDeviceList', {});
          (list.Devices || []).forEach((d) => this.addDevice(d));
          resolve(info);
        } catch (e) {
          reject(e);
        }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Verbindung zu Intiface fehlgeschlagen')); };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        this.devices.clear();
        this.scanning = false;
        this.pending.forEach((p) => p.reject(new Error('Verbindung getrennt')));
        this.pending.clear();
        if (this.ws === ws) this.ws = null;
        this.onchange();
      };
      ws.onmessage = (e) => this.receive(e.data);
    });
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }

  send(type, fields) {
    if (!this.connected) return Promise.reject(new Error('Nicht mit Intiface verbunden'));
    const Id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(Id, { resolve, reject });
      this.ws.send(JSON.stringify([{ [type]: { Id, ...fields } }]));
      setTimeout(() => { if (this.pending.delete(Id)) reject(new Error(`${type}: keine Antwort`)); }, 5000);
    });
  }

  receive(data) {
    let msgs;
    try { msgs = JSON.parse(data); } catch { return; }
    for (const msg of msgs) {
      const [type, body] = Object.entries(msg)[0];
      const p = body.Id ? this.pending.get(body.Id) : null;
      if (p) {
        this.pending.delete(body.Id);
        if (type === 'Error') p.reject(new Error(body.ErrorMessage));
        else p.resolve(body);
      } else if (type === 'DeviceAdded') {
        this.addDevice(body);
      } else if (type === 'DeviceRemoved') {
        this.devices.delete(body.DeviceIndex);
        this.onchange();
      } else if (type === 'ScanningFinished') {
        this.scanning = false;
        this.onchange();
      }
    }
  }

  addDevice(d) {
    const scalars = (d.DeviceMessages?.ScalarCmd || []).map((s, i) => ({ index: i, type: s.ActuatorType }));
    const name = d.DeviceDisplayName || d.DeviceName;
    const dev = {
      index: d.DeviceIndex,
      name,
      kind: 'Intiface',
      scalars,
      enabled: !store.get('vibeOff', []).includes(name),
      level: -1,
      setLevel: (level) => (scalars.length
        ? this.send('ScalarCmd', { DeviceIndex: d.DeviceIndex, Scalars: scalars.map((s) => ({ Index: s.index, Scalar: level, ActuatorType: s.type })) })
        : Promise.resolve()),
    };
    this.devices.set(d.DeviceIndex, dev);
    this.onchange();
  }

  async scan() {
    this.scanning = true;
    this.onchange();
    await this.send('StartScanning', {});
    // Nach 20 s automatisch beenden, um den Akku des Smartphones zu schonen
    setTimeout(() => {
      if (this.scanning) this.send('StopScanning', {}).catch(() => {}).finally(() => { this.scanning = false; this.onchange(); });
    }, 20000);
  }
}

const vibe = new Buttplug();
const allVibes = () => [...bleDevices, ...vibe.devices.values()];

function intifaceUrl(addr) {
  addr = addr.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
  if (!/:\d+$/.test(addr)) addr += ':12345';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol === 'https:' && !local) {
    return `wss://${location.host}/intiface?target=${encodeURIComponent(addr)}`;
  }
  return `ws://${addr}`;
}

// ---------------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------------
function setVibeStatus(state, text) {
  const el = $('vibeStatus');
  el.className = 'pill ' + state;
  el.textContent = 'Vibrator: ' + text;
}

$('vibeBle').addEventListener('click', addBluetoothDevice);
// Schon beim Laden anzeigen, wenn Bluetooth hier nicht gehen kann
bluetoothProblem().then((problem) => {
  if (!problem) return;
  $('vibeBleHint').textContent = problem;
  $('vibeBleHint').classList.add('warn');
});

$('vibeAddr').value = store.get('vibeAddr', '');
$('vibeConnect').addEventListener('click', async () => {
  if (vibe.connected) return vibe.disconnect();
  const addr = $('vibeAddr').value.trim();
  if (!addr) return log('Bitte die IP-Adresse des Smartphones mit Intiface eintragen.', true);
  store.set('vibeAddr', addr);
  $('vibeConnect').disabled = true;
  setVibeStatus('busy', 'verbinde …');
  try {
    const info = await vibe.connect(intifaceUrl(addr));
    log(`Mit ${info.ServerName || 'Intiface'} verbunden.`);
    if (!vibe.devices.size) await vibe.scan();
  } catch (e) {
    log(e, true);
  } finally {
    $('vibeConnect').disabled = false;
    renderVibe();
  }
});
$('vibeScan').addEventListener('click', () => vibe.scan().catch((e) => log(e, true)));

function renderVibe() {
  const devices = allVibes();
  $('vibeConnect').textContent = vibe.connected ? 'Intiface trennen' : 'Mit Intiface verbinden';
  $('vibeScan').hidden = !vibe.connected;
  $('vibeScan').textContent = vibe.scanning ? 'Suche läuft …' : 'In Intiface nach Geräten suchen';
  $('vibeScan').disabled = vibe.scanning;
  setVibeStatus(devices.length ? 'on' : 'off', devices.length ? `${devices.length} Gerät(e)` : 'getrennt');

  const ul = $('vibeDevices');
  ul.replaceChildren();
  if (!devices.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch kein Gerät verbunden.';
    ul.append(li);
  }
  for (const dev of devices) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'check';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: dev.enabled });
    cb.addEventListener('change', () => {
      dev.enabled = cb.checked;
      const off = new Set(store.get('vibeOff', []));
      cb.checked ? off.delete(dev.name) : off.add(dev.name);
      store.set('vibeOff', [...off]);
    });
    const small = document.createElement('small');
    small.textContent = ` ${dev.kind}`;
    label.append(cb, dev.name, small);
    li.append(label);

    if (dev instanceof SatisfyerBle) {
      // Geräte mit zwei Motoren (z. B. Auflieger + Vibrator) brauchen 2 × 4 Bytes
      const motors = document.createElement('select');
      motors.append(new Option('1 Motor', 1), new Option('2 Motoren', 2));
      motors.value = dev.motors;
      motors.title = 'Anzahl Motoren';
      motors.addEventListener('change', () => { dev.motors = Number(motors.value); store.set('motors.' + dev.name, dev.motors); dev.level = -1; });
      const off = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: 'Trennen' });
      off.addEventListener('click', () => {
        dev.closed = true;
        dev.setLevel(0).finally(() => dev.disconnect());
        bleDevices.splice(bleDevices.indexOf(dev), 1);
        renderVibe();
      });
      const row = document.createElement('div');
      row.className = 'devrow';
      row.append(motors, off);
      li.append(row);
    }
    ul.append(li);
  }
}
vibe.onchange = renderVibe;

// ---------------------------------------------------------------------------
// Script -> Vibration
// ---------------------------------------------------------------------------
['vibeMin', 'vibeMax', 'vibeFull', 'vibeLead', 'vibeLevel'].forEach((id) => {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('input', () => { store.set(id, Number($(id).value)); updateVibeOutputs(); });
});
$('vibeSource').value = store.get('vibeSource', 'script');
// Neuer Schlüssel ab 1.1: alle starten mit „Rhythmus“
$('vibeMap').value = store.get('vibeMap2', 'rhythm');
$('vibeSource').addEventListener('change', () => { store.set('vibeSource', $('vibeSource').value); updateVibeOutputs(); });
$('vibeMap').addEventListener('change', () => store.set('vibeMap2', $('vibeMap').value));

function updateVibeOutputs() {
  $('vibeMinVal').textContent = `${$('vibeMin').value} %`;
  $('vibeMaxVal').textContent = `${$('vibeMax').value} %`;
  $('vibeFullVal').textContent = `${$('vibeFull').value} %/s`;
  $('vibeLeadVal').textContent = `${$('vibeLead').value} ms`;
  $('vibeLevelVal').textContent = `${$('vibeLevel').value} %`;
  $('vibeLevelRow').hidden = $('vibeSource').value !== 'manual';
}
updateVibeOutputs();

let vibePaused = false;
function setVibePaused(paused) {
  vibePaused = paused;
  $('vibePause').textContent = paused ? '▶ Vibration fortsetzen' : '❚❚ Vibration pausieren';
}
$('vibePause').addEventListener('click', () => setVibePaused(!vibePaused));
// Nach „Alles stoppen“ läuft die Vibration wieder mit, sobald etwas Neues startet
document.addEventListener('handy-owner', (e) => { if (e.detail && e.detail !== 'none') setVibePaused(false); });
$('video').addEventListener('play', () => setVibePaused(false));

// Welches Script gerade läuft: Pattern/Script aus der Steuerung oder das Video.
function scriptSource() {
  return (typeof controlScriptSource === 'function' && controlScriptSource())
    || (typeof videoScriptSource === 'function' && videoScriptSource())
    || null;
}

// Geschwindigkeit (Positionseinheiten/s) des Script-Abschnitts an Stelle ms, 0 in Pausen
function speedAt(actions, ms) {
  if (!actions.length || ms < actions[0].at || ms >= actions[actions.length - 1].at) return 0;
  let lo = 0, hi = actions.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].at <= ms) lo = mid; else hi = mid;
  }
  const a = actions[lo], b = actions[hi];
  return (Math.abs(b.pos - a.pos) / Math.max(1, b.at - a.at)) * 1000;
}

// Rohwert 0–1 aus dem Script an Stelle ms
//   rhythm: pulsiert mit jedem Stoß (tief = stark), Tempo bestimmt die Gesamtstärke
//   speed:  nur das Tempo (gleichmäßige Stöße = gleichmäßige Vibration)
//   pos/posInv: nur die Position
function scriptIntensity(actions, ms) {
  const mode = $('vibeMap').value;
  let pos = positionAt(actions, ms);
  if ($('invert').checked) pos = 100 - pos;
  if (mode === 'pos') return 1 - pos / 100;
  if (mode === 'posInv') return pos / 100;
  const tempo = Math.min(1, speedAt(actions, ms) / Number($('vibeFull').value));
  if (mode === 'speed') return tempo;
  if (tempo === 0) return 0;
  const depth = 1 - pos / 100;
  return Math.max(0.12, depth) * (0.35 + 0.65 * tempo);
}

function targetLevel() {
  if (vibePaused) return 0;
  if (typeof fin !== 'undefined' && fin.active) return Math.min(fin.vibe, Number($('vibeMax').value)) / 100;
  // „Maximum“ ist auch die Sicherheitsgrenze für die manuelle Stärke
  if ($('vibeSource').value === 'manual') return Math.min(Number($('vibeLevel').value), Number($('vibeMax').value)) / 100;

  let raw = null;
  const src = scriptSource();
  if (src) raw = scriptIntensity(src.actions, src.ms + Number($('vibeLead').value));
  else if (typeof hampLevel === 'function' && hampLevel() !== null) {
    // Direktsteuerung: im Rhythmus-Modus Stöße nachbilden (schneller bei höherer Geschwindigkeit)
    const speed = hampLevel();
    if ($('vibeMap').value === 'rhythm' && speed > 0) {
      const hz = 0.5 + speed * 3;
      raw = speed * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * hz * 2 * Math.PI)));
    } else raw = speed;
  }
  if (!raw || raw < 0.01) return 0;
  const min = Number($('vibeMin').value) / 100;
  const max = Number($('vibeMax').value) / 100;
  return min + (max - min) * raw;
}

// ~16× pro Sekunde abgleichen; nur senden, wenn sich etwas ändert.
// Im Rhythmus-Modus ungeglättet, damit jeder Stoß spürbar bleibt.
let vibeLevel = 0;
let vibeSending = false;
setInterval(async () => {
  const target = targetLevel();
  const smooth = $('vibeMap').value === 'rhythm' ? 0 : 0.35;
  vibeLevel = target === 0 ? 0 : vibeLevel * smooth + target * (1 - smooth);
  $('vibeMeter').style.width = `${Math.round(vibeLevel * 100)}%`;
  if (vibeSending) return;
  vibeSending = true;
  try {
    for (const dev of allVibes()) {
      const level = dev.enabled ? Math.round(vibeLevel * 100) / 100 : 0;
      if (Math.abs(level - dev.level) < 0.02 && !(level === 0 && dev.level !== 0)) continue;
      await dev.setLevel(level);
      dev.level = level;
    }
  } catch (e) {
    log(e, true);
  } finally {
    vibeSending = false;
  }
}, 60);

// Beim Schließen der Seite Vibratoren aus
window.addEventListener('pagehide', () => {
  for (const dev of allVibes()) Promise.resolve(dev.setLevel(0)).catch(() => {});
});

renderVibe();
autoConnectBluetooth();
