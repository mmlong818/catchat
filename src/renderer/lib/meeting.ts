import type { Peer, SignalingMessage, InviteLink, TranscriptEntry } from '../../shared/types';
import { PeerConnection, type SignalPayload } from './peer';
import { decodeHeader, FileReceiver, sendFileToPeer, type FileStartMeta, type FileEndMeta } from './file-transfer';

export type DataChannelMessage =
  | { kind: 'chat'; from: string; fromName: string; text: string; ts: number }
  | { kind: 'transcript'; entry: TranscriptEntry }
  | { kind: 'transcript-history'; entries: TranscriptEntry[] }
  | { kind: 'mic-state'; from: string; muted: boolean }
  | FileStartMeta
  | FileEndMeta;

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  text: string;
  ts: number;
}

export interface FileTransferUpdate {
  id: string;
  name: string;
  size: number;
  progress: number;
  direction: 'in' | 'out';
  from: string;
  fromName: string;
  state: 'progress' | 'done' | 'error';
  blob?: Blob;
}

export interface MeetingEvents {
  peersChanged: (peers: Peer[]) => void;
  remoteStream: (peerId: string, stream: MediaStream) => void;
  remoteStreamRemoved: (peerId: string) => void;
  remoteScreenTrack: (peerId: string, track: MediaStreamTrack, stream: MediaStream) => void;
  remoteScreenEnded: (peerId: string) => void;
  data: (peerId: string, payload: DataChannelMessage) => void;
  status: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void;
  meetingEnded: (reason?: string) => void;
  chat: (msg: ChatMessage) => void;
  fileTransfer: (update: FileTransferUpdate) => void;
  screenShareChanged: (sharing: boolean) => void;
  peerReady: (peerId: string) => void;
}

export interface MeetingOptions {
  invite: InviteLink;
  name: string;
  isHost: boolean;
  avatar?: Peer['avatar'];
  signalingUrl: string;
}

let peerCounter = 0;
function genPeerId(): string {
  peerCounter++;
  return `${Date.now().toString(36)}-${peerCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export class MeetingClient {
  private ws: WebSocket | null = null;
  private peers: Map<string, Peer> = new Map();
  private connections: Map<string, PeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private listeners: Partial<MeetingEvents> = {};
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private fileReceiver = new FileReceiver();
  private screenStream: MediaStream | null = null;
  private screenSenders: Map<string, RTCRtpSender[]> = new Map();

  self: Peer;
  invite: InviteLink;
  isHost: boolean;

  constructor(opts: MeetingOptions) {
    this.invite = opts.invite;
    this.isHost = opts.isHost;
    this.signalingUrl = opts.signalingUrl;
    this.self = {
      id: genPeerId(),
      name: opts.name,
      joinedAt: Date.now(),
      isHost: opts.isHost,
      avatar: opts.avatar,
    };
  }

  on<K extends keyof MeetingEvents>(ev: K, cb: MeetingEvents[K]) {
    this.listeners[ev] = cb;
  }

  async start() {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    // Enter muted by default — user explicitly toggles to unmute
    for (const t of this.localStream.getAudioTracks()) t.enabled = false;
    this.self.micMuted = true;
    this.connectSignaling();
  }

  private signalingUrl = '';
  setSignalingUrl(url: string) { this.signalingUrl = url; }

  private connectSignaling() {
    this.listeners.status?.(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    const url = this.invite.signal || this.signalingUrl;
    if (!url) {
      this.listeners.status?.('disconnected');
      console.error('[meeting] no signaling URL configured');
      return;
    }
    const ws = new WebSocket(url);
    this.ws = ws;

    const wasReconnect = this.reconnectAttempts > 0;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.listeners.status?.('connected');
      this.sendSignaling({ type: 'join', peer: this.self, token: this.invite.token, roomId: this.invite.roomId });
      if (wasReconnect) {
        // Ask each existing peer connection to renegotiate via ICE restart
        for (const pc of this.connections.values()) {
          if (pc.connectionState !== 'closed') pc.restartIce().catch(() => {});
        }
      }
    };

    ws.onmessage = (e) => this.handleSignaling(JSON.parse(e.data));

    ws.onclose = () => {
      this.listeners.status?.('disconnected');
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[meeting] ws error', err);
    };
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 8) {
      this.listeners.meetingEnded?.('与房主的连接已断开，无法恢复');
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    setTimeout(() => {
      if (!this.intentionalClose) this.connectSignaling();
    }, delay);
  }

  private sendSignaling(msg: SignalingMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleSignaling(msg: SignalingMessage) {
    switch (msg.type) {
      case 'welcome':
        for (const p of msg.peers) {
          this.peers.set(p.id, p);
          this.createConnection(p.id, /*polite*/ false);
        }
        this.peers.set(this.self.id, this.self);
        this.emitPeers();
        break;
      case 'peer-joined':
        this.peers.set(msg.peer.id, msg.peer);
        this.createConnection(msg.peer.id, /*polite*/ true);
        this.emitPeers();
        break;
      case 'peer-left':
        this.peers.delete(msg.peerId);
        this.connections.get(msg.peerId)?.close();
        this.connections.delete(msg.peerId);
        this.listeners.remoteStreamRemoved?.(msg.peerId);
        this.emitPeers();
        break;
      case 'signal':
        if (msg.to !== this.self.id) return;
        this.connections.get(msg.from)?.handleSignal(msg.data as SignalPayload);
        break;
      case 'meeting-ended':
        this.listeners.meetingEnded?.(msg.reason);
        break;
      case 'host-transfer':
        this.handleHostTransfer(msg.newHostId);
        break;
      case 'error':
        console.error('[meeting] signaling error:', msg.message);
        break;
    }
  }

  private handleHostTransfer(newHostId: string) {
    // Centralized signaling: nobody runs a server, host is just a role flag.
    for (const p of this.peers.values()) p.isHost = (p.id === newHostId);
    if (this.self.id === newHostId) {
      this.isHost = true;
      this.self.isHost = true;
    } else if (this.self.isHost) {
      this.isHost = false;
      this.self.isHost = false;
    }
    this.emitPeers();
  }

  /** Host-only: transfer role to next-earliest peer, then leave. */
  async transferHostAndLeave(): Promise<void> {
    if (!this.isHost) return;
    const next = [...this.peers.values()]
      .filter((p) => p.id !== this.self.id)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) {
      this.endMeeting('房主离开，无人继承');
      return;
    }
    this.sendSignaling({ type: 'host-transfer', newHostId: next.id });
  }

  async startScreenShare(stream: MediaStream) {
    this.stopScreenShare();
    this.screenStream = stream;
    console.log('[meeting] startScreenShare to', this.connections.size, 'peers, tracks:',
      stream.getTracks().map((t) => `${t.kind}(${t.id.slice(0, 6)})`).join(','));
    for (const [peerId, pc] of this.connections) {
      const senderMap = pc.addStream(stream);
      this.screenSenders.set(peerId, [...senderMap.values()]);
      console.log('[meeting] added screen tracks to peer', peerId, 'senders:', senderMap.size);
      // Force encoder to maintain bitrate / framerate so receiver doesn't see "muted" track
      for (const sender of senderMap.values()) {
        if (sender.track?.kind !== 'video') continue;
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 2_500_000;
          await sender.setParameters(params);
          console.log('[meeting] set encoder params on', peerId);
        } catch (e) {
          console.error('[meeting] setParameters failed', e);
        }
      }
    }
    // Auto-stop when user clicks browser's "stop sharing" overlay
    for (const t of stream.getTracks()) {
      t.addEventListener('ended', () => this.stopScreenShare());
    }
    this.listeners.screenShareChanged?.(true);
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    for (const t of this.screenStream.getTracks()) t.stop();
    for (const [peerId, senders] of this.screenSenders) {
      const pc = this.connections.get(peerId);
      if (!pc) continue;
      for (const s of senders) pc.removeSender(s);
    }
    this.screenSenders.clear();
    this.screenStream = null;
    this.listeners.screenShareChanged?.(false);
  }

  isScreenSharing() {
    return this.screenStream !== null;
  }

  getScreenStream() {
    return this.screenStream;
  }

  endMeeting(reason = '房主已结束会议') {
    if (!this.isHost) return;
    this.sendSignaling({ type: 'meeting-ended', reason });
  }

  private createConnection(remoteId: string, polite: boolean) {
    if (this.connections.has(remoteId)) return;
    const pc = new PeerConnection(remoteId, polite, this.localStream);
    pc.on('signal', (data) => {
      this.sendSignaling({ type: 'signal', from: this.self.id, to: remoteId, data });
    });
    pc.on('remoteStream', (stream) => {
      this.listeners.remoteStream?.(remoteId, stream);
    });
    pc.on('remoteVideoTrack', (track, stream) => {
      this.listeners.remoteScreenTrack?.(remoteId, track, stream);
    });
    pc.on('remoteVideoTrackEnded', () => {
      this.listeners.remoteScreenEnded?.(remoteId);
    });
    pc.on('data', (msg) => {
      // Send our mic state once DC opens — detect by first message being a hint? Better: send on remote-stream
      this.handleData(remoteId, msg);
    });
    // Periodically (or on first data) sync mic state. Simple: setTimeout 1s after creation.
    setTimeout(() => {
      pc.send({ kind: 'mic-state', from: this.self.id, muted: this.self.micMuted ?? false });
    }, 1000);
    pc.on('channelOpen', () => {
      this.listeners.peerReady?.(remoteId);
    });
    pc.on('close', () => {
      this.listeners.remoteStreamRemoved?.(remoteId);
    });
    this.connections.set(remoteId, pc);
  }

  private handleData(remoteId: string, raw: unknown) {
    // Binary payload → file chunk
    if (raw instanceof ArrayBuffer) {
      const decoded = decodeHeader(raw);
      if (!decoded) return;
      const f = this.fileReceiver.ingestChunk(decoded.id, decoded.seq, decoded.payload);
      if (f) {
        this.listeners.fileTransfer?.({
          id: f.id,
          name: f.name,
          size: f.size,
          progress: f.received / f.size,
          direction: 'in',
          from: f.from,
          fromName: f.fromName,
          state: 'progress',
        });
      }
      return;
    }
    const msg = raw as DataChannelMessage;
    this.listeners.data?.(remoteId, msg);

    if (msg.kind === 'transcript-history') {
      // forward — Room will ingest into its store
      this.listeners.data?.(remoteId, msg);
      return;
    }
    if (msg.kind === 'mic-state') {
      const p = this.peers.get(msg.from);
      if (p) {
        p.micMuted = msg.muted;
        this.emitPeers();
      }
      return;
    }
    if (msg.kind === 'chat') {
      this.listeners.chat?.({
        id: `${msg.from}-${msg.ts}`,
        from: msg.from,
        fromName: msg.fromName,
        text: msg.text,
        ts: msg.ts,
      });
    } else if (msg.kind === 'file-start') {
      const f = this.fileReceiver.start(msg);
      this.listeners.fileTransfer?.({
        id: f.id, name: f.name, size: f.size, progress: 0,
        direction: 'in', from: f.from, fromName: f.fromName, state: 'progress',
      });
    } else if (msg.kind === 'file-end') {
      const done = this.fileReceiver.finish(msg.id);
      if (done) {
        this.listeners.fileTransfer?.({
          id: done.file.id, name: done.file.name, size: done.file.size, progress: 1,
          direction: 'in', from: done.file.from, fromName: done.file.fromName,
          state: 'done', blob: done.blob,
        });
      }
    }
  }

  sendChat(text: string) {
    const msg: DataChannelMessage = {
      kind: 'chat',
      from: this.self.id,
      fromName: this.self.name,
      text,
      ts: Date.now(),
    };
    this.broadcast(msg);
    this.listeners.chat?.({
      id: `${this.self.id}-${msg.ts}`,
      from: this.self.id,
      fromName: this.self.name,
      text,
      ts: msg.ts,
    });
  }

  async sendFile(file: File) {
    const fileId = file.name + '|' + file.lastModified + '|' + Math.random().toString(36).slice(2, 6);
    const conns = [...this.connections.values()];

    // Build local Blob URL so sender sees their own image immediately
    const localBlob = new Blob([await file.arrayBuffer()], { type: file.type });

    // Emit a "done" event for local UI right away (so sender always sees the file/image)
    this.listeners.fileTransfer?.({
      id: fileId,
      name: file.name,
      size: file.size,
      progress: 1,
      direction: 'out',
      from: this.self.id,
      fromName: this.self.name,
      state: 'done',
      blob: localBlob,
    });

    if (conns.length === 0) return;

    // Send to each peer in parallel; we don't re-emit progress for sender since it's already "done" locally
    await Promise.all(conns.map((c) =>
      sendFileToPeer(c, file, { from: this.self.id, fromName: this.self.name }, () => {}),
    ));
  }

  private emitPeers() {
    this.listeners.peersChanged?.([...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt));
  }

  broadcast(msg: unknown) {
    for (const pc of this.connections.values()) pc.send(msg);
  }

  sendTo(peerId: string, msg: unknown) {
    this.connections.get(peerId)?.send(msg);
  }

  getLocalStream() {
    return this.localStream;
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !muted;
    this.self.micMuted = muted;
    this.broadcast({ kind: 'mic-state', from: this.self.id, muted });
    this.peers.set(this.self.id, this.self);
    this.emitPeers();
  }

  async leave() {
    this.intentionalClose = true;
    for (const pc of this.connections.values()) pc.close();
    this.connections.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.ws?.close();
    this.ws = null;
  }
}
