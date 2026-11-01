'use strict';

// Fernbedienung (Server-Sent Events)

const { readBody } = require('./util');

// ---------------------------------------------------------------------------
// Fernbedienung: Jede offene Player-Seite hält eine Server-Sent-Events-Verbindung.
// Bildschirme (TV/PC) melden ihren Zustand (Szene, Position, läuft/pausiert), die
// Fernbedienung (Smartphone) schickt Befehle. Der Server reicht nur weiter und merkt
// sich den letzten Zustand je Bildschirm – nichts davon wird gespeichert.
// ---------------------------------------------------------------------------
const rc = { clients: new Map(), states: new Map() };
const RC_ID = /^[a-z0-9]{6,32}$/;

function rcSend(c, event, data) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function rcScreens() {
  return [...rc.clients.values()].filter((c) => c.screen)
    .map((c) => ({ id: c.id, name: c.name, state: rc.states.get(c.id) || null }));
}
function rcAnnounce() {
  const list = rcScreens();
  for (const c of rc.clients.values()) rcSend(c, 'screens', { list, peers: rc.clients.size - 1 });
}

function rcEvents(req, res, params) {
  const id = params.get('id') || '';
  if (!RC_ID.test(id)) throw Object.assign(new Error('Ungültige Geräte-ID'), { status: 400 });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Reverse Proxy soll nicht puffern
  });
  res.write('retry: 2000\n\n');
  rc.clients.get(id)?.res.end(); // gleiche Seite neu verbunden -> alte Verbindung schließen
  const client = { id, res, screen: params.get('screen') === '1', name: String(params.get('name') || 'Gerät').slice(0, 40) };
  rc.clients.set(id, client);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    if (rc.clients.get(id) !== client) return;
    rc.clients.delete(id);
    rc.states.delete(id);
    rcAnnounce();
  });
  rcAnnounce();
}

async function rcPost(req, kind) {
  const body = JSON.parse(await readBody(req, 20000) || '{}');
  if (!RC_ID.test(body.from || '')) throw Object.assign(new Error('Ungültige Geräte-ID'), { status: 400 });
  if (kind === 'state') {
    // Zustand eines Bildschirms an alle anderen Seiten
    rc.states.set(body.from, body.state || null);
    for (const c of rc.clients.values()) if (c.id !== body.from) rcSend(c, 'state', { id: body.from, state: body.state || null });
    return;
  }
  // Befehl der Fernbedienung an einen Bildschirm
  const target = rc.clients.get(body.to);
  const cmd = String(body.cmd || '');
  if (!target || (!target.screen && cmd !== 'kicked')) throw Object.assign(new Error('Bildschirm nicht verbunden'), { status: 404 });
  rcSend(target, 'cmd', { from: body.from, fromName: rc.clients.get(body.from)?.name || 'Fernbedienung', cmd, arg: body.arg ?? null });
}

module.exports = { rc, RC_ID, rcSend, rcScreens, rcAnnounce, rcEvents, rcPost };
