# 自部署 TURN 服务器（coturn）

## 为什么需要

CatChat 默认 ICE 配置的 STUN（Google）+ TURN（openrelay.metered.ca）在国内大概率被封锁。对称 NAT 跨网络通话**必须有可达的 TURN**作中继。

> 自部署成本：阿里云轻量服务器最低配 ¥24/月，5 人小团队带宽够。

---

## 推荐：阿里云轻量服务器 + coturn

### 1. 买台阿里云轻量服务器
- 地域：选**香港**或**东南亚**节点（避免国内对 P2P 转发的策略限制）
- 配置：1 vCPU / 1 GB RAM / 30 Mbps 带宽
- 系统：Ubuntu 22.04
- 月费约 ¥24

### 2. 安全组开放端口
进入 ECS 控制台 → 安全组 → 入方向添加规则：

| 协议 | 端口范围 | 说明 |
|---|---|---|
| TCP | 3478 | TURN 控制端口 |
| UDP | 3478 | TURN UDP（媒体） |
| TCP | 5349 | TURN TLS |
| UDP | 49152-65535 | RTP 媒体端口范围 |

### 3. SSH 上服务器装 coturn

```bash
# 假设服务器 IP 是 1.2.3.4
ssh root@1.2.3.4

# 装 coturn
apt update && apt install -y coturn

# 启用 coturn 服务
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

### 4. 配置 coturn

```bash
cat > /etc/turnserver.conf << 'EOF'
# 监听端口
listening-port=3478

# 服务器公网 IP（必填）
external-ip=1.2.3.4

# 中继 UDP 端口范围
min-port=49152
max-port=65535

# 长期凭证认证（防止被滥用）
lt-cred-mech
user=catchat:choose-a-strong-password-here

# 域名（用 IP 也可以，但 TLS 需要真实域名）
realm=catchat.local

# 关掉一些不需要的服务
no-cli
no-tlsv1
no-tlsv1_1

# 日志
log-file=/var/log/turnserver.log
pidfile=/var/run/turnserver.pid

# 不开 stun-only（保留 STUN + TURN）
fingerprint
EOF

# 重启
systemctl restart coturn
systemctl enable coturn

# 验证启动
systemctl status coturn
```

### 5. 测试 TURN 可用性

在浏览器打开 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

填入：
- STUN or TURN URI: `turn:1.2.3.4:3478`
- TURN username: `catchat`
- TURN password: 你设的密码

点 "Add Server" 然后 "Gather candidates"。如果能看到 `relay` 类型候选，配置成功。

### 6. 在 CatChat 配置

打开 CatChat → 设置 → "STUN/TURN 服务器（高级）" → 填入：

```json
[
  {"urls": "stun:stun.l.google.com:19302"},
  {"urls": "turn:1.2.3.4:3478", "username": "catchat", "credential": "你的密码"}
]
```

保存。重新发起 / 加入会议即可。

---

## 替代方案

### Cloudflare Calls TURN（免费 1TB/月）
1. 注册 Cloudflare 账号 → Dashboard
2. 左侧 **Realtime** → **TURN**
3. 创建 Application → 获取 token
4. 用代码生成短期凭证（参考 https://developers.cloudflare.com/realtime/turn/）

### Twilio Network Traversal Service
- 付费，按流量计费
- 注册即得 ICE servers REST API

### Metered.ca（境外，国内可能不稳）
- 免费 0.5 GB/月
- https://www.metered.ca/sign-up

---

## 故障排查

### Console 显示没有 `relay` 候选
→ TURN 服务不可达。检查：
1. ECS 安全组是否开 UDP 3478
2. coturn 是否真的在跑：`systemctl status coturn`
3. 服务器公网防火墙：`ufw status`

### TURN 凭证错误
→ Console 会看到 401 Unauthorized。检查用户名/密码拼写。

### relay 工作但还断连
→ ECS 带宽不足。升级到 50 Mbps 或选更高配置。

### 想 TLS 加密 TURN（turns://）
需要 Let's Encrypt 证书：
```bash
apt install -y certbot
certbot certonly --standalone -d your.domain.com
# 在 turnserver.conf 加：
# cert=/etc/letsencrypt/live/your.domain.com/fullchain.pem
# pkey=/etc/letsencrypt/live/your.domain.com/privkey.pem
# tls-listening-port=5349
```

Then in settings: `"urls": "turns:your.domain.com:5349"`
