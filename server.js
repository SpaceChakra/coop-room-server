// Co-op Room Server — from Anarcontra (SpaceChakra). MIT licensed.
//
// The smallest thing that gets two browsers playing together:
//   · HOST   → get a 4-letter room code to read out to a friend
//   · JOIN   → type the code
//   · QUICK  → get paired with whoever else is searching
// Once paired, every other message is relayed straight to the partner. The
// server never runs game logic, so it fits any 2-player game: one side
// (usually the host) simulates the shared world and streams snapshots, each
// side owns its own player.
//
// Also serves ./public as static files, so `npm start` is the whole stack.
//
//   npm install && npm start      →  http://localhost:3000 (open two tabs)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

// ---- static files ------------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }   // no ../ escapes
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// ---- rooms -------------------------------------------------------------------
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();   // code -> { host, guest }
let quickQueue = null;     // the one socket waiting for a quick match

// No 0/O or 1/I: codes get read aloud.
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function send(ws, type, data = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
}

function pair(hostWs, guestWs, code) {
  hostWs.peer = guestWs; guestWs.peer = hostWs;
  hostWs.room = code; guestWs.room = code;
  send(hostWs, 'peer-joined', { role: 'host', code });
  send(guestWs, 'peer-joined', { role: 'guest', code });
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (raw, isBinary) => {
    // Paired sockets get a straight relay, binary included (send whatever you like).
    if (ws.peer) {
      if (isBinary) { if (ws.peer.readyState === 1) ws.peer.send(raw, { binary: true }); return; }
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'host': {
        if (ws.room) return;                       // already hosting or paired
        const code = makeCode();
        rooms.set(code, { host: ws, guest: null });
        ws.room = code;
        send(ws, 'hosted', { code });
        break;
      }
      case 'join': {
        if (ws.room) return;
        const code = String(msg.code || '').toUpperCase().slice(0, 8);
        const room = rooms.get(code);
        if (!room || room.guest || room.host === ws) {
          send(ws, 'join-failed', { reason: room ? 'Room is full' : 'Room not found' });
          break;
        }
        room.guest = ws;
        pair(room.host, ws, code);
        break;
      }
      case 'quick': {
        if (ws.room) return;
        if (quickQueue && quickQueue !== ws && quickQueue.readyState === 1) {
          const code = makeCode();
          rooms.set(code, { host: quickQueue, guest: ws });
          pair(quickQueue, ws, code);
          quickQueue = null;
        } else {
          quickQueue = ws;
          send(ws, 'queued');
        }
        break;
      }
      case 'cancel-quick': {
        if (quickQueue === ws) quickQueue = null;
        break;
      }
      default: {
        // Gameplay message: relay to the partner untouched.
        if (ws.peer && ws.peer.readyState === 1) ws.peer.send(raw.toString());
      }
    }
  });

  ws.on('close', () => {
    if (quickQueue === ws) quickQueue = null;
    if (ws.room) rooms.delete(ws.room);
    if (ws.peer) { send(ws.peer, 'peer-left'); ws.peer.peer = null; ws.peer.room = null; ws.peer = null; }
  });
});

// Drop sockets that vanished without a close (sleeping laptops, dead wifi),
// so their rooms and the quick-match slot free up.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Co-op room server: http://localhost:${PORT}`));
