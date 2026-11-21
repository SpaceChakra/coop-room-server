// Co-op room client — from Anarcontra (SpaceChakra). MIT licensed.
//
// Thin WebSocket client for host/join, quick match, and gameplay sync.
// Model: the host is authoritative for the shared world (enemies, pickups,
// score) and streams snapshots; each side owns its own player and streams
// its transform. Simple, browser-friendly, and good enough for co-op.
//
//   const net = new NetClient();
//   await net.connect();
//   net.onHosted = (code) => show(code);
//   net.onPeerJoined = (role) => startGame(role === 'host');
//   net.onMessage = (msg) => { ... };    // anything your partner sent
//   net.host();  /  net.join('ABCD');  /  net.quick();
//   // every frame:
//   net.sendThrottled('me', { x, y, a }, dt, 20);   // 20 Hz
//   net.send('boom', { x, y });                       // one-off event

export class NetClient {
  constructor(url) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = url || `${proto}://${location.host}`;
    this.ws = null;
    this.role = null;          // 'host' | 'guest'
    this.code = null;
    this.connected = false;
    this.paired = false;
    this.onHosted = null;      // (code)
    this.onQueued = null;      // ()
    this.onJoinFailed = null;  // (reason)
    this.onPeerJoined = null;  // (role, code)
    this.onPeerLeft = null;    // ()
    this.onMessage = null;     // (msg) — any gameplay message from the partner
    this.onClose = null;       // ()
    this._throttle = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { this.connected = true; resolve(); };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => { this.connected = this.paired = false; this.onClose?.(); };
      this.ws.onmessage = (ev) => this._onMessage(ev.data);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'hosted': this.code = msg.code; this.onHosted?.(msg.code); break;
      case 'queued': this.onQueued?.(); break;
      case 'join-failed': this.onJoinFailed?.(msg.reason); break;
      case 'peer-joined':
        this.role = msg.role; this.code = msg.code; this.paired = true;
        this.onPeerJoined?.(msg.role, msg.code); break;
      case 'peer-left': this.paired = false; this.onPeerLeft?.(); break;
      default: this.onMessage?.(msg);
    }
  }

  _raw(obj) { if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  host() { this._raw({ type: 'host' }); }
  join(code) { this._raw({ type: 'join', code }); }
  quick() { this._raw({ type: 'quick' }); }
  cancelQuick() { this._raw({ type: 'cancel-quick' }); }

  /** Send a gameplay message to the partner. `type` must not be a lobby word. */
  send(type, data = {}) { if (this.paired) this._raw({ ...data, type }); }

  /** Send at most `hz` times a second per `type` — for transforms and snapshots. */
  sendThrottled(type, data, dt, hz = 20) {
    const cd = (this._throttle.get(type) ?? 0) - dt;
    if (cd > 0) { this._throttle.set(type, cd); return; }
    this._throttle.set(type, 1 / hz);
    this.send(type, data);
  }

  close() { this.ws?.close(); }
}

/** Round to 2 decimals before sending: halves the JSON, invisible on screen. */
export const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Smooth a remote value that arrives at ~20 Hz into a 60+ fps one.
 * Call `push(v)` when a packet lands and `get(dt)` every frame.
 */
export class Smoothed {
  constructor(v = 0, rate = 14) { this.v = v; this.target = v; this.rate = rate; }
  push(v) { this.target = v; }
  get(dt) { this.v += (this.target - this.v) * (1 - Math.exp(-this.rate * dt)); return this.v; }
}
