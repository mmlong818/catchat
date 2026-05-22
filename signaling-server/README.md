# CatChat 信令服务

P2P 语音会议的信令中转。**只转发信令消息，不转发音视频媒体**（媒体走 WebRTC P2P）。

## 本地运行

```bash
npm install
npm start
# 默认监听 :8080
```

测试：`curl http://localhost:8080/health`

## 部署

### Render.com（免费层）

1. 创建 Web Service，连接此 repo（或上传代码）
2. Build Command: `npm install`
3. Start Command: `npm start`
4. 实例自动获得 https 公网域名（如 `catchat-signal.onrender.com`）
5. WebSocket URL: `wss://catchat-signal.onrender.com`
6. 在 CatChat 设置里填入

⚠️ Render 免费层会在 15 分钟无活动后休眠，首次连接需 30+ 秒唤醒。生产环境建议付费层或选 Fly.io。

### Fly.io

```bash
fly launch
fly deploy
```

### Docker

```bash
docker build -t catchat-signal .
docker run -p 8080:8080 catchat-signal
```

### 自有 VPS

```bash
git clone <repo>
cd signaling-server
npm install
PORT=8080 node server.js
```

配合 Nginx + Let's Encrypt 提供 wss://。

## 流量估算

- 单个信令包 < 1 KB
- 一场 5 人会议约 50-100 个包/分钟
- **5 人会议 1 小时 ≈ 5 MB 信令流量**
- 100 场并发会议日活 → 月流量 ~15 GB（任何免费层都够）

## 协议

服务无状态，按 `roomId` 隔离房间。客户端消息：

```json
{ "type": "join", "roomId": "abc123", "token": "...", "peer": {...} }
{ "type": "signal", "from": "...", "to": "...", "data": {...} }
{ "type": "host-transfer", "newHostId": "..." }
{ "type": "meeting-ended", "reason": "..." }
```

详见 `server.js`。
