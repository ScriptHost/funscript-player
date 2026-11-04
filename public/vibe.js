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
    this.motorMode = store.get('motorMode.' + this.name, 'same'); // zwei Motoren: 'same' | 'split' (Motor 2 nach Tempo)
    this.level = -1;
    this.jitter = 0;
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
    // Akkustand – nur wenn das Gerät den Standard-Akkudienst anbietet (sonst einfach ohne)
    try {
      const ch = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
      this.battery = (await ch.readValue()).getUint8(0);
      ch.addEventListener('characteristicvaluechanged', (e) => { this.battery = e.target.value.getUint8(0); renderVibe(); });
      await ch.startNotifications().catch(() => {});
    } catch { this.battery = null; }
    // Verzögerung messen: Laufzeit eines bestätigten Schreibvorgangs, alle 5 s
    this.measure = setInterval(() => this.measureLatency(), 5000);
    this.measureLatency();
    // Satisfyer schalten ab, wenn nicht regelmäßig ein Befehl kommt
    this.keepalive = setInterval(() => { if (this.packet) { this.dirty = true; this.flush(); } }, 500);
  }

  // Stärke 0–1 -> pro Motor 4 Bytes mit Wert 0–100; level2 = zweiter Motor (Standard: wie der erste)
  setLevel(level, level2 = level) {
    this.packet = new Uint8Array(4 * this.motors).fill(Math.round(level * 100));
    if (this.motors === 2) this.packet.fill(Math.round(level2 * 100), 4);
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

  async measureLatency() {
    if (!this.tx || this.writing || !this.tx.writeValueWithResponse) return;
    this.writing = true;
    const t0 = performance.now();
    try {
      await this.tx.writeValueWithResponse(this.packet || new Uint8Array(4 * this.motors));
      const ms = performance.now() - t0;
      // Schwankung mitführen: große Sprünge = Empfang schlecht (Sync-Anzeige)
      this.jitter = this.rtt ? this.jitter * 0.7 + Math.abs(ms - this.rtt) * 0.3 : 0;
      this.rtt = this.rtt ? this.rtt * 0.7 + ms * 0.3 : ms;
    } catch { /* nächstes Mal */ } finally { this.writing = false; }
  }

  disconnect() {
    clearInterval(this.keepalive);
    clearInterval(this.measure);
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

// Suchfilter: übliche Satisfyer-Namen, Satisfyer-Dienst und alle einmal gewählten Gerätenamen
function bleFilters() {
  return [
    { namePrefix: 'SF' }, { namePrefix: 'Satisfyer' }, { namePrefix: 'Power Masturbator' }, { services: [SF_SERVICE] },
    ...store.get('bleKnownNames', []).map((name) => ({ name })),
  ];
}

async function addBluetoothDevice(all = false) {
  const problem = await bluetoothProblem();
  if (problem) {
    $('vibeBleHint').textContent = problem;
    $('vibeBleHint').classList.add('warn');
    return log(problem, true);
  }
  try {
    // Standard: nur Satisfyer („SF …“). Mit „Alle Bluetooth-Geräte anzeigen“, falls er anders heißt.
    $('vibeBleAll').hidden = true;
    const device = await navigator.bluetooth.requestDevice(all === true || $('vibeAll').checked
      ? { acceptAllDevices: true, optionalServices: [SF_SERVICE, 'battery_service'] }
      : { filters: bleFilters(), optionalServices: [SF_SERVICE, 'battery_service'] });
    if (bleDevices.some((d) => d.device.id === device.id)) return log(`${device.name} ist schon verbunden.`);
    await attachBleDevice(device);
    // Namen merken: beim nächsten Mal findet die normale Suche das Gerät auch ohne „Alle Geräte“
    if (device.name) store.set('bleKnownNames', [...new Set([...store.get('bleKnownNames', []), device.name])]);
  } catch (e) {
    if (e.name === 'NotFoundError') {
      // Nichts gewählt: neue/ungekoppelte Satisfyer melden oft noch keinen Namen -> alle Geräte anbieten
      $('vibeBleAll').hidden = false;
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
async function attachBleDevice(device, quiet = false) {
  {
    const dev = new SatisfyerBle(device);
    if (!quiet) log(`Verbinde mit ${dev.name} …`);
    await dev.connect();
    bleDevices.push(dev);
    // Bricht Bluetooth ab, bis zu 5× neu verbinden, bevor das Gerät entfernt wird.
    // Android trennt bei Bildschirmsperre/App-Wechsel; im Hintergrund scheitert jeder Versuch –
    // deshalb erst neu verbinden, wenn die Seite wieder sichtbar ist (sonst musste man neu koppeln).
    const recover = async () => {
      clearInterval(dev.keepalive);
      dev.tx = null;
      if (dev.closed) return;
      if (typeof deviceLost === 'function') deviceLost(dev.name);
      if (document.hidden) {
        await new Promise((resolve) => {
          const back = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', back); resolve(); } };
          document.addEventListener('visibilitychange', back);
        });
      }
      for (let attempt = 1; attempt <= 5; attempt++) {
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
      log(`${dev.name} nicht erreichbar – der Player versucht es im Hintergrund weiter.`);
      renderVibe();
      // Weiter still versuchen (z. B. Satisfyer kurz außer Reichweite oder aus) – ohne neu koppeln
      for (let n = 0; n < 40 && !dev.closed; n++) {
        await new Promise((r) => setTimeout(r, 15000));
        if (document.hidden || dev.closed || bleDevices.includes(dev)) continue;
        try {
          await dev.connect();
          dev.level = -1;
          bleDevices.push(dev);
          log(`${dev.name} wieder verbunden.`);
          renderVibe();
          return;
        } catch { /* weiter warten */ }
      }
    };
    // 1.19.9: auch der Health Check (checkVibes) stößt das an – nie zwei Wiederverbindungen gleichzeitig
    dev.lost = () => {
      if (dev.recovering) return;
      dev.recovering = true;
      recover().finally(() => { dev.recovering = false; });
    };
    device.addEventListener('gattserverdisconnected', dev.lost);
    if (!quiet) log(`${dev.name} verbunden.`);
  }
  renderVibe();
}

// 1.19.9: Health Check (app.js) – Android meldet eine abgerissene Verbindung im Hintergrund nicht immer
function checkVibes() {
  for (const dev of bleDevices) if (dev.device?.gatt && !dev.device.gatt.connected && dev.lost) dev.lost();
}

// Beim Start: schon einmal erlaubte Satisfyer wieder verbinden (Chrome kennt sie über getDevices)
async function autoConnectBluetooth() {
  if (!store.get('autoConnect', true) || !navigator.bluetooth?.getDevices || (await bluetoothProblem())) return;
  try {
    for (const device of await navigator.bluetooth.getDevices()) {
      if (bleDevices.some((d) => d.device.id === device.id)) continue;
      attachBleDevice(device, true).catch(() => { /* nicht in Reichweite – still ignorieren */ });
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
          const info = await this.send('RequestServerInfo', { ClientName: 'Funscript Player', MessageVersion: 3 });
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
    // Bewegungsgeräte (z. B. The Handy per Bluetooth): „fahre in x ms auf Position y“
    const linear = (d.DeviceMessages?.LinearCmd || []).map((_, i) => ({ index: i }));
    const name = d.DeviceDisplayName || d.DeviceName;
    const dev = {
      index: d.DeviceIndex,
      name,
      kind: linear.length ? 'Intiface ↕ Bewegung' : 'Intiface',
      scalars,
      linear,
      enabled: !store.get('vibeOff', []).includes(name),
      level: -1,
      motors: Math.min(2, scalars.length || 1),
      motorMode: store.get('motorMode.' + name, 'same'),
      // level2 = zweiter Motor (falls vorhanden)
      setLevel: (level, level2 = level) => (scalars.length
        ? this.send('ScalarCmd', { DeviceIndex: d.DeviceIndex, Scalars: scalars.map((s, i) => ({ Index: s.index, Scalar: i === 1 ? level2 : level, ActuatorType: s.type })) })
        : Promise.resolve()),
      // pos 0–1, duration in ms
      move: (pos, duration) => this.send('LinearCmd', {
        DeviceIndex: d.DeviceIndex,
        Vectors: linear.map((l) => ({ Index: l.index, Duration: Math.max(20, Math.round(duration)), Position: Math.max(0, Math.min(1, pos)) })),
      }),
      stop: () => this.send('StopDeviceCmd', { DeviceIndex: d.DeviceIndex }),
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
  pillText(el, 'Satisfyer', '〰', text);
}

$('vibeBle').addEventListener('click', () => addBluetoothDevice());
$('vibeBleAll').addEventListener('click', () => addBluetoothDevice(true));
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
  const bat = devices.map((d) => d.battery).filter((b) => Number.isFinite(b));
  // 1.19.9: Akku knapp – einmal je Gerät melden
  for (const d of devices) {
    if (Number.isFinite(d.battery) && d.battery < 15 && !d.batWarned) { d.batWarned = true; log(`${d.name}: Akku ${d.battery} % – bald laden.`, true); }
  }
  setVibeStatus(devices.length ? 'on' : 'off', devices.length ? `${devices.length} Gerät(e)${bat.length ? ` · 🔋 ${Math.min(...bat)} %` : ''}` : 'getrennt');

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
    small.textContent = ` ${dev.kind}${Number.isFinite(dev.battery) ? ` · 🔋 ${dev.battery} %` : ''}`;
    // Sync-Anzeige (1.19.4): Bluetooth-Laufzeit dieses Geräts, gelb wenn sie stark schwankt
    const sync = Object.assign(document.createElement('small'), { className: 'dev-sync' });
    dev.syncEl = sync;
    label.append(cb, dev.name, small, sync);
    li.append(label);

    // Stärke je Gerät (mehrere Satisfyer: z. B. einer kräftiger, einer dezenter)
    const gain = Object.assign(document.createElement('input'), { type: 'range', min: 10, max: 100, step: 5, value: Math.round(devGain(dev) * 100) });
    const gainOut = Object.assign(document.createElement('output'), { textContent: `${gain.value} %` });
    gain.addEventListener('input', () => { store.set('vibeGain.' + dev.name, Number(gain.value) / 100); gainOut.textContent = `${gain.value} %`; });
    const gainRow = Object.assign(document.createElement('label'), { className: 'dev-gain' });
    gainRow.append('Stärke dieses Geräts ', gainOut, gain);
    li.append(gainRow);

    const row = document.createElement('div');
    row.className = 'devrow';
    if (dev instanceof SatisfyerBle) {
      // Geräte mit zwei Motoren (z. B. Auflieger + Vibrator) brauchen 2 × 4 Bytes
      const motors = document.createElement('select');
      motors.append(new Option('1 Motor', 1), new Option('2 Motoren', 2));
      motors.value = dev.motors;
      motors.title = 'Anzahl Motoren';
      motors.addEventListener('change', () => { dev.motors = Number(motors.value); store.set('motors.' + dev.name, dev.motors); dev.level = -1; renderVibe(); });
      row.append(motors);
    }
    if (dev.motors === 2) {
      // Zweiter Motor: wie der erste oder nach dem Tempo des Scripts (der erste pulsiert im Rhythmus)
      const mode = document.createElement('select');
      mode.append(new Option('Motor 2 wie Motor 1', 'same'), new Option('Motor 2 nach Tempo', 'split'));
      mode.value = dev.motorMode;
      mode.title = 'Was der zweite Motor macht';
      mode.addEventListener('change', () => { dev.motorMode = mode.value; store.set('motorMode.' + dev.name, mode.value); dev.level = -1; });
      row.append(mode);
    }
    if (dev instanceof SatisfyerBle) {
      const off = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: 'Trennen' });
      off.addEventListener('click', () => {
        dev.closed = true;
        dev.setLevel(0).finally(() => dev.disconnect());
        bleDevices.splice(bleDevices.indexOf(dev), 1);
        renderVibe();
      });
      row.append(off);
    }
    if (row.children.length) li.append(row);
    ul.append(li);
  }
  $('vibeBle').textContent = bleDevices.length ? '＋ Weiteren Satisfyer verbinden' : '＋ Satisfyer per Bluetooth verbinden';
  showVibeSync();
}
const devGain = (dev) => store.get('vibeGain.' + dev.name, 1);
vibe.onchange = renderVibe;

// ---------------------------------------------------------------------------
// Script -> Vibration
// ---------------------------------------------------------------------------
['vibeMin', 'vibeMax', 'vibeFull', 'vibeLead', 'vibeLevel', 'vibeSmooth'].forEach((id) => {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('input', () => { store.set(id, Number($(id).value)); updateVibeOutputs(); });
});
$('vibeSource').value = store.get('vibeSource', 'script');
// Neuer Schlüssel ab 1.1: alle starten mit „Rhythmus“
$('vibeMap').value = store.get('vibeMap2', 'rhythm');
$('vibeSource').addEventListener('change', () => { store.set('vibeSource', $('vibeSource').value); updateVibeOutputs(); });
$('vibeMap').addEventListener('change', () => store.set('vibeMap2', $('vibeMap').value));

// 1.19.7: Übersetzung und Stärke min/max auch am Video (Feineinstellung Satisfyer) – gespiegelt zu ⚙️ → Geräte
$('dvMap').replaceChildren(...[...$('vibeMap').options].map((o) => new Option(o.text.split(':')[0], o.value)));
mirrorField('dvMap', 'vibeMap');
mirrorField('dvMin', 'vibeMin');
mirrorField('dvMax', 'vibeMax');
['dvMin', 'dvMax'].forEach((id) => $(id).addEventListener('input', updateVibeOutputs));

function updateVibeOutputs() {
  $('vibeMinVal').textContent = $('dvMinVal').textContent = `${$('vibeMin').value} %`;
  $('vibeMaxVal').textContent = $('dvMaxVal').textContent = `${$('vibeMax').value} %`;
  $('vibeSummary').textContent = `· ${$('vibeMin').value}–${$('vibeMax').value} %`;
  $('vibeFullVal').textContent = `${$('vibeFull').value} %/s`;
  $('vibeLeadVal').textContent = `${$('vibeLead').value} ms`;
  $('vibeLevelVal').textContent = `${$('vibeLevel').value} %`;
  $('vibeSmoothVal').textContent = Number($('vibeSmooth').value) ? `${$('vibeSmooth').value} %` : 'aus';
  $('vibeLevelRow').hidden = $('vibeSource').value !== 'manual';
}
updateVibeOutputs();

let vibePaused = false;
function setVibePaused(paused) {
  vibePaused = paused;
  $('vibePause').textContent = paused ? '▶ Fortsetzen' : '❚❚ Pausieren';
  $('ovVibe').textContent = paused ? 'Vib ▶' : 'Vib ❚❚';
  $('ovVibe').classList.toggle('off', paused);
  $('ovVibe').title = paused ? 'Geräte pausiert – antippen zum Fortsetzen' : 'Vibration pausieren';
  if (typeof resync === 'function') resync(); // Handy hält mit an bzw. läuft wieder
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
function scriptIntensity(actions, ms, mode = $('vibeMap').value) {
  let pos = positionAt(actions, ms);
  if ($('invert').checked) pos = 100 - pos;
  if (mode === 'pos') return 1 - pos / 100;
  if (mode === 'posInv') return pos / 100;
  const tempo = Math.min(1, speedAt(actions, ms) / Number($('vibeFull').value));
  if (mode === 'speed') return tempo;
  if (tempo === 0) return 0;
  // 1.19: kräftiger und deutlicher pulsierend (vorher 0,12 / 0,35 + 0,65 – wirkte zu gleichmäßig)
  const depth = Math.pow(1 - pos / 100, 0.7);
  return Math.max(0.15, depth) * (0.55 + 0.45 * tempo);
}

// „Probe“: nach einer Änderung an der Übersetzung 2 s spürbar machen (Beispiel-Stöße, 300 ms)
const PROBE_ACTIONS = Array.from({ length: 16 }, (_, i) => ({ at: i * 300, pos: i % 2 ? 100 : 0 }));
let probe = { until: 0, start: 0 };
function vibeProbe() {
  if (!allVibes().length || scriptSource()) return;
  probe = { start: performance.now(), until: performance.now() + 2000 };
}
['vibeMap', 'vibeMin', 'vibeMax', 'vibeFull', 'vibeScene', 'vibeSmooth'].forEach((id) => $(id).addEventListener('change', vibeProbe));
// lead = Vorlauf dieses Geräts (ms), map = Übersetzung (zweiter Motor: 'speed')
function targetLevel(lead = vibeLeadMs(), map = $('vibeMap').value) {
  if (vibePaused) return 0;
  if (performance.now() < probe.until) {
    const raw = scriptIntensity(PROBE_ACTIONS, performance.now() - probe.start + 150, map);
    const min = Number($('vibeMin').value) / 100, max = Number($('vibeMax').value) / 100;
    return raw > 0.01 ? (min + (max - min) * raw) * Number($('vibeScene').value) / 100 : 0;
  }
  if (typeof finDetached === 'function' && finDetached()) return Math.min(fin.vibe, Number($('vibeMax').value)) / 100;
  // Touch-Fläche unter 🎮 Steuern: Finger-Höhe = Stärke, „Maximum“ gilt
  const touched = typeof touchVibeLevel === 'function' ? touchVibeLevel() : null;
  if (touched !== null) return Math.min(touched * 100, Number($('vibeMax').value)) / 100;
  // „Selbst steuern“ am Video (ohne Funscript): eigene Stärke, „Maximum“ gilt auch hier
  const own = typeof selfVibeLevel === 'function' ? selfVibeLevel() : null;
  if (own !== null) return Math.min(own * 100, Number($('vibeMax').value)) / 100;
  // „Maximum“ ist auch die Sicherheitsgrenze für die manuelle Stärke
  if ($('vibeSource').value === 'manual') return Math.min(Number($('vibeLevel').value), Number($('vibeMax').value)) / 100;

  let raw = null;
  const src = scriptSource();
  // Video-Script: derselbe Offset wie bei der Handy; Vorlauf gleicht Bluetooth aus
  if (src) {
    raw = scriptIntensity(src.actions, src.ms + lead + (src.video ? Number($('offset').value) : 0), map);
    // Video-Script: Sanft schwächer, Intensiv stärker (⚙️ → Script / Auswahl am Video)
    if (src.video && raw && typeof presetVibeShape === 'function') raw = presetVibeShape(raw);
  }
  else if (typeof hampLevel === 'function' && hampLevel() !== null) {
    // Direktsteuerung: im Rhythmus-Modus Stöße nachbilden (schneller bei höherer Geschwindigkeit)
    const speed = hampLevel();
    if (map === 'rhythm' && speed > 0) {
      const hz = 0.5 + speed * 3;
      raw = speed * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * hz * 2 * Math.PI)));
    } else raw = speed;
  }
  if (!raw || raw < 0.01) return 0;
  const min = Number($('vibeMin').value) / 100;
  const max = Number($('vibeMax').value) / 100;
  const level = min + (max - min) * raw;
  // Finale „sanfter“: Script läuft weiter, Vibration mit eingestelltem Anteil
  const scene = src?.video ? Number($('vibeScene').value) / 100 : 1; // „Stärke für diese Szene“
  return (typeof fin !== 'undefined' && fin.active && fin.mode === 'soft' ? level * fin.vibe / 100 : level) * scene;
}

// ~16× pro Sekunde abgleichen; nur senden, wenn sich etwas ändert.
// Im Rhythmus-Modus ungeglättet, damit jeder Stoß spürbar bleibt – außer „Gleichmäßigkeit“
// ist eingestellt: dann folgt die Stärke mit Verzögerung (bis 1,5 s), Spitzen werden flacher.
// 1.19.4: je Gerät gerechnet – eigener Vorlauf (gemessene Bluetooth-Laufzeit), eigene Stärke,
// Sanftanlauf nach einer Ruhe (Start, Pause, STOPP) und bei zwei Motoren wahlweise Motor 2 nach Tempo.
let vibeLevel = 0; // stärkstes Gerät (Anzeige, STOPP-Knopf)
let vibeSending = false;
const RAMP_MS = 500, RAMP_AFTER_MS = 1500;
setInterval(async () => {
  // Regler oder Script-Preset (z. B. „Sanft“) – das Ruhigere gilt; Patterns/Steuern nur der Regler
  const fromPreset = typeof presetVibeEven === 'function' && !(typeof controlScriptSource === 'function' && controlScriptSource()) ? presetVibeEven() : 0;
  const even = Math.max(Number($('vibeSmooth').value) / 100, fromPreset);
  const smooth = Math.max($('vibeMap').value === 'rhythm' ? 0 : 0.35, even ? Math.exp(-0.06 / (even * 1.5)) : 0);
  const hasSource = !!scriptSource();
  const now = performance.now();
  const devs = allVibes();
  let top = 0;
  for (const dev of devs) {
    const lead = devLeadMs(dev);
    const split = dev.motors === 2 && dev.motorMode === 'split';
    let t1 = targetLevel(lead) * devGain(dev);
    let t2 = split ? targetLevel(lead, 'speed') * devGain(dev) : t1;
    // Sanftanlauf: nach mehr als 1,5 s Ruhe in 0,5 s hochfahren statt schlagartig
    if (!t1 && !t2) dev.quietSince ??= now;
    else {
      if (dev.quietSince === undefined || (dev.quietSince !== null && now - dev.quietSince > RAMP_AFTER_MS)) dev.rampAt = now;
      dev.quietSince = null;
    }
    const ramp = dev.rampAt ? Math.min(1, (now - dev.rampAt) / RAMP_MS) : 1;
    t1 *= ramp;
    t2 *= ramp;
    // Not-Aus / ❚❚: sofort aus. 1.19.9: Pause, Spulen, Videoende (keine Quelle mehr) weich in ≈ 0,5 s aus.
    const stopNow = !t1 && !t2 && (vibePaused || (hasSource && !even));
    const fadeOut = !t1 && !t2 && !hasSource && !vibePaused;
    dev.cur = stopNow ? 0 : fadeOut ? (dev.cur || 0) * 0.6 : (dev.cur || 0) * smooth + t1 * (1 - smooth);
    dev.cur2 = !split ? dev.cur : stopNow ? 0 : fadeOut ? (dev.cur2 || 0) * 0.6 : (dev.cur2 || 0) * 0.6 + t2 * 0.4; // Tempo ruhiger
    if (dev.cur < 0.01) dev.cur = 0;
    if (dev.cur2 < 0.01) dev.cur2 = 0;
    if (dev.enabled) top = Math.max(top, dev.cur, dev.cur2);
  }
  vibeLevel = devs.length ? top : 0;
  $('vibeMeter').style.width = `${Math.round(vibeLevel * 100)}%`;
  if (vibeSending) return;
  vibeSending = true;
  try {
    for (const dev of devs) {
      const level = dev.enabled ? Math.round(dev.cur * 100) / 100 : 0;
      const level2 = dev.enabled ? Math.round(dev.cur2 * 100) / 100 : 0;
      if (Math.abs(level - dev.level) < 0.02 && Math.abs(level2 - (dev.level2 ?? level)) < 0.02
        && !(level === 0 && dev.level !== 0)) continue;
      // Höchstens 1 s warten – eine hängende Übertragung darf die Vibration nicht dauerhaft blockieren
      await Promise.race([dev.setLevel(level, level2), new Promise((r) => setTimeout(r, 1000))]);
      dev.level = level;
      dev.level2 = level2;
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

// ---------------------------------------------------------------------------
// Vorlauf: automatisch aus der gemessenen Bluetooth-Laufzeit oder von Hand (⚙️ → Geräte)
// ---------------------------------------------------------------------------
function measuredLead() {
  const rtts = bleDevices.map((d) => d.rtt).filter(Number.isFinite);
  return rtts.length ? Math.round(Math.max(...rtts) * 0.6 + 40) : null;
}
function vibeLeadMs() {
  const m = $('vibeLeadAuto').checked ? measuredLead() : null;
  return m ?? Number($('vibeLead').value);
}
// Vorlauf je Gerät (1.19.4): jeder Satisfyer mit seiner eigenen Laufzeit – mehrere bleiben so gemeinsam im Takt
function devLeadMs(dev) {
  return $('vibeLeadAuto').checked && Number.isFinite(dev.rtt) ? Math.round(dev.rtt * 0.6 + 40) : vibeLeadMs();
}
// Sync-Anzeige: Bluetooth schwankt stark oder ist sehr langsam -> Status gelb (app.js), Hinweis je Gerät
const VIBE_SLOW_MS = 250, VIBE_JITTER_MS = 80;
const vibeDevSlow = (d) => Number.isFinite(d.rtt) && (d.rtt > VIBE_SLOW_MS || d.jitter > VIBE_JITTER_MS);
function vibeSlow() { return bleDevices.some(vibeDevSlow); }
function showVibeSync() {
  for (const d of allVibes()) {
    if (!d.syncEl) continue;
    d.syncEl.textContent = Number.isFinite(d.rtt) ? ` · ⏱ ${Math.round(d.rtt)} ms${d.jitter > VIBE_JITTER_MS ? ` ±${Math.round(d.jitter)}` : ''}` : '';
    d.syncEl.classList.toggle('slow', vibeDevSlow(d));
    d.syncEl.title = vibeDevSlow(d) ? 'Bluetooth schwankt – näher ans Gerät oder Hindernisse entfernen' : 'Bluetooth-Laufzeit – wird mit Vorlauf ausgeglichen, im Takt';
  }
}
$('vibeLeadAuto').checked = store.get('vibeLeadAuto', true);
$('vibeLeadAuto').addEventListener('change', () => store.set('vibeLeadAuto', $('vibeLeadAuto').checked));
setInterval(() => {
  const m = measuredLead();
  const rtt = bleDevices.map((d) => d.rtt).filter(Number.isFinite);
  $('vibeLat').textContent = !rtt.length ? ''
    : vibeSlow() ? `⚠ Bluetooth schwankt (bis ${Math.round(Math.max(...rtt))} ms) – Vibration kann leicht daneben liegen. Näher ans Gerät gehen.`
      : `✓ Im Takt – Bluetooth-Laufzeit ${Math.round(Math.max(...rtt))} ms, ${$('vibeLeadAuto').checked ? 'je Gerät automatisch ausgeglichen' : `Vorlauf ${vibeLeadMs()} ms`}`;
  showVibeSync();
  $('vibeLeadAutoInfo').textContent = m !== null ? `gemessen: ${m} ms` : 'misst, sobald ein Satisfyer per Bluetooth verbunden ist';
  $('vibeLead').disabled = $('vibeLeadAuto').checked && m !== null;
  // Nur den Status-Text auffrischen (Akku), nicht die Geräteliste – sonst klappt eine offene Auswahl zu
  const devices = allVibes();
  const bat = devices.map((d) => d.battery).filter((b) => Number.isFinite(b));
  if (devices.length) setVibeStatus('on', `${devices.length} Gerät(e)${bat.length ? ` · 🔋 ${Math.min(...bat)} %` : ''}`);
}, 3000);
