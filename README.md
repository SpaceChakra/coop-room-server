# Co-op Room Server

The smallest thing that gets two browsers playing together:

- **Host** and get a 4-letter room code to read out to a friend (no `0/O` or `1/I` mix-ups)
- **Join** by typing the code
- **Quick match**: get paired with whoever else is searching

Once paired, every message is **relayed straight to the partner**, JSON or binary. The server never runs game logic, so it fits any 2-player game. The usual model: the host simulates the shared world (enemies, pickups, score) and streams snapshots, and each side owns and streams its own player.

One file, one dependency (`ws`). It also serves `public/`, so `npm start` is the whole stack. Includes a heartbeat that cleans up dead connections and a 64 KB message cap.

From **Anarcontra** (SpaceChakra).

## Run the demo

```bash
npm install
npm start            # http://localhost:3000
```

Open it in two tabs (or on two machines on your network), host in one and join in the other. Each player moves a dot, and both collect the same coins. The host owns the coins and the score.

## Use it in your game

```js
import { NetClient, Smoothed, r2 } from './net.js';

const net = new NetClient();                 // defaults to the page's own host
await net.connect();
net.onHosted = (code) => showCode(code);
net.onPeerJoined = (role) => startGame(role === 'host');
net.onPeerLeft = () => backToLobby();
net.onMessage = (msg) => { if (msg.type === 'me') them.x.push(msg.x); };

net.host();   // or net.join('ABCD') / net.quick()

// every frame
net.sendThrottled('me', { x: r2(me.x), y: r2(me.y) }, dt, 20);   // 20 Hz
net.send('boom', { x, y });                                        // one-off event

// remote values arrive at 20 Hz; Smoothed eases them to your frame rate
const them = { x: new Smoothed(0) };
draw(them.x.get(dt));
```

## Deploy

Any Node host with WebSockets works (Render, Fly.io, Railway, a VPS). Set `PORT` if your host needs it. Behind HTTPS the client switches to `wss://` automatically.

## License

MIT. Made by [SpaceChakra](https://patreon.com/spacechakra).
