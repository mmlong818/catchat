// CatChat 公共信令中转服务
// - 仅负责房间内消息路由（媒体仍走 P2P）
// - 房间按 roomId 隔离，token 防伪
// - 房间无人后自动清理

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_ROOM_AGE_MS = 6 * 60 * 60 * 1000; // 6 小时无活动清理
const MAX_PEERS_PER_ROOM = 12;

// roomId -> { token, peers: Map<peerId, { ws, peer }>, createdAt, lastActivity }
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      peers: [...rooms.values()].reduce((s, r) => s + r.peers.size, 0),
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('CatChat signaling server\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  let roomId = null;
  let peerId = null;
  const remoteAddr = req.socket.remoteAddress;
  console.log(`[+] conn ${remoteAddr}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      if (!msg.peer?.id || !msg.token || !msg.roomId) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid join payload' }));
        ws.close();
        return;
      }
      roomId = String(msg.roomId);
      peerId = msg.peer.id;

      let room = rooms.get(roomId);
      if (!room) {
        // First joiner creates the room with their token
        room = { token: msg.token, peers: new Map(), createdAt: Date.now(), lastActivity: Date.now() };
        rooms.set(roomId, room);
        console.log(`[room] created ${roomId} by ${peerId} (token=${String(msg.token).slice(0, 6)}...)`);
      } else if (room.token !== msg.token) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid token' }));
        ws.close();
        return;
      }

      if (room.peers.size >= MAX_PEERS_PER_ROOM) {
        ws.send(JSON.stringify({ type: 'error', message: '会议人数已满' }));
        ws.close();
        return;
      }

      const existingPeers = [...room.peers.values()].map((p) => p.peer);
      room.peers.set(peerId, { ws, peer: msg.peer });
      room.lastActivity = Date.now();

      ws.send(JSON.stringify({ type: 'welcome', you: msg.peer, peers: existingPeers }));
      broadcast(roomId, { type: 'peer-joined', peer: msg.peer }, peerId);
      console.log(`[room] ${roomId} peer ${peerId} joined (${room.peers.size}/${MAX_PEERS_PER_ROOM})`);
      return;
    }

    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.lastActivity = Date.now();

    if (msg.type === 'signal' || msg.type === 'transfer-init' || msg.type === 'transfer-ready') {
      const target = room.peers.get(msg.to);
      if (target) target.ws.send(JSON.stringify(msg));
    } else if (msg.type === 'host-transfer' || msg.type === 'meeting-ended') {
      broadcast(roomId, msg);
    }
  });

  ws.on('close', () => {
    console.log(`[-] conn ${remoteAddr}`);
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.peers.delete(peerId);
    if (room.peers.size === 0) {
      rooms.delete(roomId);
      console.log(`[room] ${roomId} closed (empty)`);
    } else {
      broadcast(roomId, { type: 'peer-left', peerId });
    }
  });
});

function broadcast(roomId, msg, except) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const [id, { ws }] of room.peers) {
    if (id === except) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Periodic cleanup: stale rooms
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.lastActivity > MAX_ROOM_AGE_MS) {
      for (const { ws } of room.peers.values()) try { ws.close(); } catch {}
      rooms.delete(id);
      console.log(`[room] ${id} cleaned up (stale)`);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`CatChat signaling server listening on :${PORT}`);
});
