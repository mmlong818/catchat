# CatChat 🐱

> 基于 Electron + WebRTC 的 P2P 跨网络语音会议系统，自带阿里云实时语音转写

[![Version](https://img.shields.io/github/package-json/v/mmlong818/catchat?color=ff6b4a&label=version)](https://github.com/mmlong818/catchat/releases)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
[![License](https://img.shields.io/badge/License-AGPLv3-blue)](LICENSE)

**[👉 下载最新安装包](https://github.com/mmlong818/catchat/releases/latest)** · **[问题反馈](https://github.com/mmlong818/catchat/issues)**

## ✨ 功能

- 🎙️ **多人语音通话** — WebRTC P2P mesh，2-12 人会议
- 🌐 **跨网络可用** — 公共信令中转，不依赖局域网
- 📝 **实时语音转写** — 阿里云 `fun-asr-realtime`，会议纪要可导出为 Markdown
- 🖥️ **屏幕共享** — 可选共享系统音频
- ✂️ **系统级截图** — 调用 Win+Shift+S，截图自动入聊天框预览
- 💬 **文字聊天 + emoji**
- 📎 **文件传输** — DataChannel 直接 P2P 传送，自动保存到桌面
- 👑 **房主转移** — 按加入顺序自动接班
- 🔁 **断线重连** — ICE restart 自愈
- 🎨 **音量光环** — 当前说话人头像呼吸光晕，自动置顶
- 🔗 **自定义协议邀请** — `aimeet://join?room=...&token=...` 一键加入

## 📋 系统要求与已知限制

| | |
|---|---|
| **平台** | Windows 10/11（macOS / Linux 理论可编译但未测试） |
| **网络** | 任意网络（同 WiFi / 异地 / 4G 均可，无需端口转发） |
| **依赖外部服务** | 阿里云 DashScope（转写）+ 公共信令中转（媒体不依赖） |
| **会议人数** | 2-12 人（mesh 拓扑，过多人时房主上行带宽吃紧） |
| **首次连接** | 公共信令是 Render 免费层，休眠后唤醒约 30 秒，可自部署回避 |
| **NAT 穿透** | STUN 已配置，~70% 用户直连可用；对称 NAT 需 TURN（暂未集成） |

## 🏗️ 架构

```
                  ┌────────────────────┐
                  │  公共信令中转服务   │
                  │  Render/Fly.io/VPS  │
                  └─────────┬──────────┘
                            │ WSS 信令（小流量）
              ┌─────────────┼─────────────┐
              │             │             │
         ┌────▼───┐    ┌────▼───┐   ┌────▼───┐
         │ Peer A │◄══►│ Peer B │◄═►│ Peer C │
         └────────┘    └────────┘   └────────┘
              ◄═════ WebRTC P2P 媒体（音频/视频/数据） ═════►
```

- **信令**：独立中转服务，只转发房间内信令消息（< 1KB/包）
- **媒体**：WebRTC P2P mesh，音视频完全点对点直传，**无服务器中转**
- **STT**：渲染层把 16kHz PCM 流式上传到阿里云，主进程代理 API Key

## 📥 下载使用

### 普通用户

直接下载 [Releases](../../releases) 里的 `CatChat Setup x.x.x.exe`：

1. 双击安装（Windows SmartScreen 拦截就点 "更多信息 → 仍要运行"）
2. 首次启动会弹出设置 → 填入你的 **阿里云百炼 API Key**（见下方）→ 保存
3. 输入昵称 → 发起会议或粘贴邀请链接加入

### 申请阿里云百炼 API Key（免费额度够用）

**为什么需要**：CatChat 的实时语音转写功能调用阿里云 DashScope 的 `fun-asr-realtime` 模型。

1. 访问 **阿里云百炼控制台**：https://bailian.console.aliyun.com/
2. 用阿里云账号登录（没有就注册，需要实名认证）
3. 左侧菜单 → **模型广场** → 搜索 "fun-asr-realtime" → 点击进入
4. 同意服务协议、开通服务（**新用户有免费额度**，可参考[计费说明](https://help.aliyun.com/zh/dashscope/billing-for-isi-models)）
5. 左侧菜单 → **API-KEY 管理** → **创建我的 API-KEY**
6. 复制以 `sk-` 开头的密钥
7. 打开 CatChat → 设置 → "阿里云百炼 API Key" 字段粘贴 → 保存

**密钥安全**：CatChat 用 Electron `safeStorage`（Windows DPAPI / macOS Keychain）加密存储到本地，**不会上传任何服务器**。

---

## 🛠️ 开发

### 依赖
- Node.js 18+
- Windows / macOS / Linux

### 本地运行

```bash
git clone https://github.com/mmlong818/catchat.git
cd catchat
npm install
npm run dev
```

第一次启动会弹设置面板，填入你的阿里云 API Key 即可。

### 打包

```bash
npm run package
# 产出在 release/CatChat Setup x.x.x.exe
```

### 项目结构

```
catchat/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts       # 入口 + IPC
│   │   ├── settings.ts    # safeStorage 加密设置
│   │   └── asr-proxy.ts   # 阿里云 ASR WebSocket 代理
│   ├── preload/           # IPC 桥接
│   ├── renderer/          # React UI
│   │   ├── App.tsx
│   │   ├── components/    # Lobby / Room / ChatPanel / ...
│   │   └── lib/           # MeetingClient / PeerConnection / Avatars ...
│   └── shared/types.ts    # 共享类型
├── signaling-server/      # 公共信令中转（独立部署）
└── package.json
```

## ☁️ 部署信令服务到 Render（免费）

CatChat 默认连接公共信令 `wss://catchat-signal.onrender.com`。如果你想自建：

### 1. Fork 或克隆信令服务代码

信令服务的源码在仓库的 `signaling-server/` 目录，**独立的 Node.js + ws 服务**，约 100 行。

把 `signaling-server/` 单独 push 到一个 GitHub 仓库（Render 部署需要 git 源）：

```bash
cd signaling-server
git init
git add .
git commit -m "init signaling"
gh repo create my-catchat-signal --public --source=. --push
# 或者手动在 github.com/new 建仓 → git remote add → git push
```

### 2. 在 Render 创建 Web Service

1. 注册 https://render.com（用 GitHub 账号最快）
2. Dashboard → **New +** → **Web Service**
3. 选 **Build and deploy from a Git repository** → Connect GitHub → 选 `my-catchat-signal` 仓库
4. 填表：

   | 字段 | 填入 |
   |---|---|
   | **Name** | `my-catchat-signal` |
   | **Language** | `Node` |
   | **Branch** | `main` |
   | **Region** | `Singapore` / `Oregon`（按用户所在地选） |
   | **Root Directory** | 留空 |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | **Free** |

5. **Deploy Web Service** → 等待 2-3 分钟构建完成

### 3. 获取你的信令 URL

构建完成后，页面顶部会显示一个域名，例如：
```
https://my-catchat-signal-xxxx.onrender.com
```

把 `https://` 改成 `wss://` 就是你的信令地址：
```
wss://my-catchat-signal-xxxx.onrender.com
```

### 4. 验证可用性

浏览器打开 `https://my-catchat-signal-xxxx.onrender.com/health`，应看到：
```json
{"ok":true,"rooms":0,"peers":0,"uptime":12.3}
```

### 5. 在 CatChat 里使用你的信令地址

打开 CatChat → 大厅右上角 ⚙️ → **信令服务地址** 改成你的 wss URL → 保存。

或者修改源码 `src/main/settings.ts` 里的 `signalingUrl` 默认值，重新打包，**让安装包默认就连你的服务**。

### Render 免费层注意事项

| 限制 | 影响 | 应对 |
|---|---|---|
| 15 分钟无连接自动休眠 | 首次连接需 ~30 秒唤醒 | 房主先开会议，第一个加入者多等一会 |
| 每月 750 小时实例时间 | 单实例满月跑也够 | — |
| 出向带宽 100GB/月 | 信令包很小，5000+ 场会议都够 | 媒体走 P2P 不占这个 |

如果嫌 30 秒唤醒慢：升级 Render 付费层（$7/月）或换 Fly.io（小实例免费常在线）。

### 其他部署方式

- **Docker**：`signaling-server/Dockerfile` 已就绪，`docker build -t catchat-signal . && docker run -p 8080:8080 catchat-signal`
- **VPS**：`node server.js` + Nginx 反代 + Let's Encrypt 证书

详见 [`signaling-server/README.md`](signaling-server/README.md)。

## 🔐 安全与隐私

- **API Key 不上链**：`safeStorage` OS 级加密，仅本地
- **媒体不经服务器**：音频/视频/文件全部 P2P，信令服务只看到房间路由元数据
- **Token 防伪**：每场会议 128-bit 随机 token，无法被穷举
- **会议纪要本地存**：转写只在参会者机器之间同步，不上传任何服务器（除阿里云做 STT）

## 📜 版本历史

| 版本 | 关键改动 |
|---|---|
| **0.2.4** | License → AGPL-3.0；设置面板居中修复 |
| **0.2.3** | 屏幕共享黑屏修复（切到 Electron 现代 `setDisplayMediaRequestHandler` API） |
| **0.2.2** | 转写 23 秒超时修复（打包后 AudioWorklet 路径解析问题） |
| **0.2.1** | 邀请链接解析容错；安装包从 1.2GB 缩到 75MB |
| **0.2.0** | **架构重做** — 公共信令中转替代局域网内嵌服务器，跨网络可用 |
| 0.1.0 | 局域网版（已废弃） |

## 🗺️ 路线图

- [ ] TURN 服务集成（解决对称 NAT 跨网络问题）
- [ ] macOS / Linux 构建测试
- [ ] 应用图标 + 代码签名（去掉 SmartScreen 拦截）
- [ ] 转写润色（DashScope `qwen-plus` 后处理，已预留接口）
- [ ] 自动更新（electron-updater）
- [ ] 暗色主题
- [ ] 可拖出的浮动控件
- [ ] 端到端加密（媒体已 SRTP；信令也加 E2EE）

## 🤝 贡献

欢迎 PR / Issue。开发约定：
- 文件 < 800 行，函数 < 50 行
- 不引入冗余抽象（"3 行相似代码优于过早抽象"）
- UI 文案中文，代码标识符英文

## 📜 License

[AGPL-3.0](LICENSE) © 2026 mmlong818

**重要**：AGPL 是强 copyleft 协议。如果你修改 CatChat 并通过网络提供服务（如部署成 SaaS），必须公开完整源代码。任何衍生作品也必须以 AGPL 发布。
