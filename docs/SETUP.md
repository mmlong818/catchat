# CatChat 完整部署指南

> 从零开始把 CatChat 部署到可用状态，包括所有依赖服务。
> **预计耗时**：1.5 小时（其中阿里云轻量服务器购买约 15 分钟）
> **预计成本**：~¥30/月（阿里云轻量服务器）+ 阿里云 ASR 流量（按时长，普通使用 < ¥5/月）

---

## 整体架构

CatChat 是一个 P2P 桌面会议应用，**默认架构需要 3 个外部服务**：

```
                ┌──────────────────────┐
                │ 1. 信令中转服务      │
                │   Render.com (免费)  │
                └──────────┬───────────┘
                           │ WSS（轻量信令）
              ┌────────────┼────────────┐
              │            │            │
          ┌───▼──┐     ┌───▼──┐     ┌───▼──┐
          │ App1 │     │ App2 │     │ App3 │ ← CatChat 客户端
          └──┬───┘     └──┬───┘     └──┬───┘
             │            │            │
             └──── P2P 媒体（音频/屏幕/数据） ────┘
                          ↑
              ┌───────────┴───────────┐
              │ 2. TURN 中继           │ 跨网络对称 NAT 必需
              │   coturn / 阿里云轻量 │
              └────────────────────────┘

         3. 阿里云 DashScope ASR ← 实时语音转写
```

| 服务 | 作用 | 成本 |
|---|---|---|
| 信令服务 | 房间路由 + WebRTC 协商 | Render 免费层（15 分钟休眠） |
| TURN 服务 | 严格 NAT 跨网络中继 | 阿里云轻量 ¥24/月 |
| 阿里云 ASR | 实时语音转写 | 按时长付费，¥3/小时 |

---

## 第 1 步：申请阿里云百炼 API Key（ASR）

### 1.1 注册阿里云账号
- 访问 https://www.aliyun.com/
- 注册并完成**实名认证**（必需）

### 1.2 开通百炼 + 申请 Key
1. 登录后访问 **百炼控制台**：https://bailian.console.aliyun.com/
2. 同意服务协议、开通服务（新用户有免费额度）
3. 左侧菜单 → **模型广场** → 搜索 `fun-asr-realtime` → 点击进入 → 同意调用
4. 左侧菜单 → **API-KEY 管理** → **创建我的 API-KEY**
5. 复制以 `sk-` 开头的密钥（**只显示一次，立即保存**）

> ✅ 保留这个 Key，第 4 步配置 CatChat 时要填。

---

## 第 2 步：部署信令服务（Render 免费）

### 2.1 准备 GitHub 仓库
1. 在 GitHub 注册账号（如果没有）
2. Fork 本仓库 `mmlong818/catchat` 到你自己的账号
   - 或者只 fork `signaling-server/` 目录到新仓库
3. 也可以直接用 mmlong818 已经部署好的公共信令 `wss://catchat-signal.onrender.com`（默认值就是这个），跳过 2.2/2.3

### 2.2 在 Render 创建 Web Service
1. 注册 https://render.com/（用 GitHub 账号最快）
2. Dashboard → **New +** → **Web Service**
3. **Build and deploy from a Git repository** → Connect GitHub → 选你 fork 的仓库

### 2.3 配置部署
| 字段 | 填入 |
|---|---|
| **Name** | `catchat-signal`（随意） |
| **Language** | Node |
| **Branch** | main |
| **Region** | Singapore（亚洲）或 Oregon（北美） |
| **Root Directory** | `signaling-server`（如果整个仓库 fork）；留空（如果只 fork 了 signaling-server） |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

点 **Deploy Web Service**，等 2-3 分钟构建。

### 2.4 获取地址
构建完成后 Render 给你一个域名，例如 `https://catchat-signal-xxxx.onrender.com`。

把 `https://` 改成 `wss://` 就是你的信令 URL：`wss://catchat-signal-xxxx.onrender.com`

### 2.5 验证
浏览器打开 `https://catchat-signal-xxxx.onrender.com/health`，应看到：
```json
{"ok":true,"rooms":0,"peers":0,"uptime":12.3}
```

> ⚠️ Render 免费层在 15 分钟无连接后会休眠，**首次访问需要 30 秒唤醒**。这是正常的，唤醒后正常使用。

---

## 第 3 步：部署 TURN 中继服务（**跨网络必需**）

> 如果只在同一 WiFi 内使用 CatChat，可以**跳过这步**，但跨网络会议必须配 TURN。

### 3.1 购买阿里云轻量服务器
1. 访问 https://www.aliyun.com/product/swas
2. 选择：
   - **地域**：香港（避开国内 P2P 限制，国内外都能访问）
   - **套餐**：1 vCPU / 1 GB / 30 Mbps / 50 GB 流量
   - **镜像**：Ubuntu 22.04 或 24.04
   - **时长**：按月 ¥24
3. 下单 → 完成支付

### 3.2 配置防火墙（关键！）
进入 https://swas.console.aliyun.com/ → 你的实例 → 左侧 **「防火墙」** → 添加规则：

| 协议 | 端口范围 | 来源 IP |
|---|---|---|
| TCP | `3478` | `0.0.0.0/0` |
| UDP | `3478` | `0.0.0.0/0` |
| UDP | `49152/65535` | `0.0.0.0/0` |

⚠️ 端口范围语法是 `49152/65535`（斜杠分隔），不是 `-`。

### 3.3 登录服务器
方式 A（推荐）：阿里云控制台 → 实例详情 → 右上角 **「远程连接」** → 网页终端

方式 B：本地终端 SSH（先在控制台 → 重置密码 设个 root 密码）：
```bash
ssh root@你的IP
```

### 3.4 切换 root + 安装 coturn

如果是网页终端登入的普通用户，先切换 root：
```bash
sudo -i
```

然后**安装 coturn**（一次性粘贴整段）：
```bash
apt update && apt install -y coturn
```

### 3.5 写配置文件
**修改下面命令里的 IP 和密码再粘贴**：
```bash
printf 'listening-port=3478\nexternal-ip=你的服务器公网IP\nmin-port=49152\nmax-port=65535\nlt-cred-mech\nuser=catchat:你的TURN密码\nrealm=catchat\nno-cli\nno-tlsv1\nno-tlsv1_1\nfingerprint\nlog-file=/var/log/turnserver.log\n' > /etc/turnserver.conf
```

> 例子：`external-ip=1.2.3.4`、`user=catchat:REDACTED`
> 密码不要用特殊字符（避免 `& $ ! \` " /`）

### 3.6 启动 + 设为开机自启
```bash
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn && \
systemctl restart coturn && systemctl enable coturn && \
ss -ulnp | grep 3478
```

最后一行应该输出包含 `turnserver` 的行，说明 coturn 在监听 3478。

### 3.7 测试 TURN 可达
浏览器打开 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

填：
- **URI**: `turn:你的IP:3478`
- **username**: `catchat`
- **password**: 你设的密码

点 **Add Server** → **Gather candidates**。**看到 `relay` 类型候选 = 成功** ✓

> ❌ 如果只有 `host` 和 `srflx`，没有 `relay`：检查阿里云防火墙端口（最常见原因）。

---

## 第 4 步：配置 CatChat

### 4.1 下载安装
- 从 https://github.com/mmlong818/catchat/releases 下载最新的 `CatChat Setup x.x.x.exe`
- 双击安装（Windows SmartScreen 拦截就点 "更多信息 → 仍要运行"）
- 安装完启动 CatChat

### 4.2 填入设置
启动后大厅会自动弹出设置（如果没填过 API Key）。或点右上角 ⚙️ 手动打开：

| 字段 | 值 |
|---|---|
| **语音识别模式** | 阿里云 FunASR |
| **阿里云百炼 API Key** | 第 1 步获取的 `sk-...` |
| **阿里云 FunASR 模型** | `fun-asr-realtime`（默认即可） |
| **阿里云 FunASR WebSocket** | `wss://dashscope.aliyuncs.com/api-ws/v1/inference`（默认即可） |
| **信令服务地址** | 第 2 步的 `wss://catchat-signal-xxxx.onrender.com`（或用默认公共服务） |
| **STUN/TURN 服务器（高级）** | 见下方 JSON |

### 4.3 STUN/TURN JSON
**改成你自己的 IP 和密码**：
```json
[
  {"urls": "stun:stun.l.google.com:19302"},
  {"urls": "turn:你的IP:3478?transport=udp", "username": "catchat", "credential": "你的密码"},
  {"urls": "turn:你的IP:3478?transport=tcp", "username": "catchat", "credential": "你的密码"}
]
```

例子：
```json
[
  {"urls": "stun:stun.l.google.com:19302"},
  {"urls": "turn:1.2.3.4:3478?transport=udp", "username": "catchat", "credential": "REDACTED"},
  {"urls": "turn:1.2.3.4:3478?transport=tcp", "username": "catchat", "credential": "REDACTED"}
]
```

点 **保存设置** → 关闭弹窗。

### 4.4 验证全套
1. 输入昵称（任意），选个头像
2. 点 **发起会议** → 麦克风权限点 **允许**
3. 进会议后点 **复制邀请链接**
4. 把链接发给另一台电脑（异地、4G 都行）
5. 对方安装同样的 CatChat 0.2.27+，填入**同样**的设置（除昵称外都一致）
6. 粘贴链接到「邀请链接」框 → 加入会议
7. 双方应该听到对方说话、看到转写、能共享屏幕

按 **F12** 打开 Console 看日志，正常应该看到：
```
[peer] xxx local ICE: relay udp 你的TURN-IP
[peer] xxx iceConnectionState: connected
[peer] xxx connectionState: connected
```

---

## 常见问题

### 转写错误："连接 DashScope 超时"
- 检查 API Key 是否正确（`sk-` 开头，无空格）
- 检查 ASR 模型字段是否是 `fun-asr-realtime`
- 阿里云账号有余额或免费额度（控制台查）

### 屏幕共享对方看不到（黑屏 / 卡帧）
- 大概率是 NAT 穿透失败（TURN 没配 / 没生效）
- F12 Console 看是否有 `local ICE: relay ...` 这条 — 没有就是 TURN 没工作
- 重新跑 trickle-ice 测试验证 TURN

### 邀请链接无效
- 链接格式应是 `aimeet://join?room=xxx&token=yyy`
- 双方的 **信令地址必须一致**（在设置里）

### Render 信令服务一开始很慢
- 免费层 15 分钟休眠机制，首次访问要 30 秒唤醒
- 唤醒后正常使用直到下次空闲

### 想清空 API Key / 数据
- 设置里有 **清空** 按钮
- 或删除 `C:\Users\<用户名>\AppData\Roaming\CatChat\` 整个目录

---

## 进阶

### 把你的服务做成默认（让安装包零配置）
修改 `src/main/settings.ts` 的 `DEFAULTS`：
```ts
const DEFAULTS: AppSettings = {
  signalingUrl: 'wss://your-signal.onrender.com',
  iceServersJson: JSON.stringify([
    {"urls": "stun:stun.l.google.com:19302"},
    {"urls": "turn:your.turn.ip:3478", "username": "user", "credential": "pass"},
  ]),
  // ...
};
```
然后 `npm run package` 重新打包，分发出去的安装包就**零配置**直接能用。

### 自部署信令服务（不用 Render）
信令服务的 Docker 镜像现成的：
```bash
cd signaling-server
docker build -t catchat-signal .
docker run -d -p 8080:8080 --name signal --restart unless-stopped catchat-signal
```
再配 nginx 反代 + Let's Encrypt 拿到 `wss://`。

### 升级 coturn 配置（TLS）
裸 UDP TURN 在有些公司防火墙下会被拦截。配 TURN over TLS：
1. 给服务器配个域名 + Let's Encrypt 证书
2. coturn 配置加：
   ```
   cert=/etc/letsencrypt/live/your.domain/fullchain.pem
   pkey=/etc/letsencrypt/live/your.domain/privkey.pem
   tls-listening-port=5349
   ```
3. CatChat 设置里加 `turns:your.domain:5349` 服务器

---

## 反馈

- Issue: https://github.com/mmlong818/catchat/issues
- 部署遇到问题先看 Console 日志（F12）+ 服务器 `journalctl -u coturn -n 50`
