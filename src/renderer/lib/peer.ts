const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type SignalPayload =
  | { kind: 'sdp'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface PeerEvents {
  signal: (data: SignalPayload) => void;
  remoteStream: (stream: MediaStream) => void;
  remoteVideoTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
  remoteVideoTrackEnded: (trackId: string) => void;
  data: (msg: unknown) => void;
  channelOpen: () => void;
  close: () => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private listeners: Partial<{ [K in keyof PeerEvents]: PeerEvents[K] }> = {};
  private makingOffer = false;
  private polite: boolean;

  readonly remoteId: string;

  constructor(remoteId: string, polite: boolean, localStream: MediaStream | null) {
    this.remoteId = remoteId;
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStream) {
      for (const track of localStream.getTracks()) {
        this.pc.addTrack(track, localStream);
      }
    }

    this.pc.ontrack = (e) => {
      const [stream] = e.streams;
      console.log('[peer]', this.remoteId, 'received track:', e.track.kind, 'stream:', stream?.id);
      if (e.track.kind === 'audio') {
        this.listeners.remoteStream?.(stream);
      } else if (e.track.kind === 'video') {
        e.track.addEventListener('unmute', () => {
          console.log('[peer]', this.remoteId, 'video track UNMUTED (frames now flowing)');
        });
        e.track.addEventListener('mute', () => {
          console.log('[peer]', this.remoteId, 'video track muted (no frames)');
        });
        this.listeners.remoteVideoTrack?.(e.track, stream);
        e.track.addEventListener('ended', () => {
          console.log('[peer]', this.remoteId, 'video track ended');
          this.listeners.remoteVideoTrackEnded?.(e.track.id);
        });
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.listeners.signal?.({ kind: 'sdp', sdp: this.pc.localDescription });
        }
      } catch (err) {
        console.error('[peer] negotiation error', err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[peer]', this.remoteId, 'connectionState:', this.pc.connectionState,
        'iceConn:', this.pc.iceConnectionState);
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) {
        if (this.pc.connectionState === 'closed') this.listeners.close?.();
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      console.log('[peer]', this.remoteId, 'iceConnectionState:', this.pc.iceConnectionState);
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate;
        console.log('[peer]', this.remoteId, 'local ICE:', c.type, c.protocol, c.address || c.candidate);
        this.listeners.signal?.({ kind: 'ice', candidate: e.candidate.toJSON() });
      }
    };

    if (!polite) {
      this.dc = this.pc.createDataChannel('app');
      this.setupDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.setupDataChannel(this.dc);
      };
    }
  }

  private setupDataChannel(dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        this.listeners.data?.(msg);
      } catch {
        this.listeners.data?.(e.data);
      }
    };
    dc.onopen = () => this.listeners.channelOpen?.();
    if (dc.readyState === 'open') this.listeners.channelOpen?.();
  }

  on<K extends keyof PeerEvents>(ev: K, cb: PeerEvents[K]) {
    this.listeners[ev] = cb;
  }

  async handleSignal(payload: SignalPayload) {
    try {
      if (payload.kind === 'sdp') {
        const offerCollision = payload.sdp.type === 'offer' &&
          (this.makingOffer || this.pc.signalingState !== 'stable');
        if (offerCollision && !this.polite) return;
        await this.pc.setRemoteDescription(payload.sdp);
        if (payload.sdp.type === 'offer') {
          await this.pc.setLocalDescription();
          if (this.pc.localDescription) {
            this.listeners.signal?.({ kind: 'sdp', sdp: this.pc.localDescription });
          }
        }
      } else {
        try {
          await this.pc.addIceCandidate(payload.candidate);
        } catch (err) {
          if (!this.polite) throw err;
        }
      }
    } catch (err) {
      console.error('[peer] handleSignal error', err);
    }
  }

  send(msg: unknown) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  sendBinary(buf: ArrayBuffer) {
    if (this.dc?.readyState === 'open') this.dc.send(buf);
  }

  close() {
    this.pc.close();
    this.dc?.close();
  }

  get connectionState() {
    return this.pc.connectionState;
  }

  get bufferedAmount() {
    return this.dc?.bufferedAmount ?? 0;
  }

  waitDrain(threshold = 256 * 1024): Promise<void> {
    if (!this.dc) return Promise.resolve();
    if (this.dc.bufferedAmount <= threshold) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const dc = this.dc!;
      const original = dc.bufferedAmountLowThreshold;
      dc.bufferedAmountLowThreshold = threshold;
      const handler = () => {
        dc.removeEventListener('bufferedamountlow', handler);
        dc.bufferedAmountLowThreshold = original;
        resolve();
      };
      dc.addEventListener('bufferedamountlow', handler);
    });
  }

  async restartIce() {
    this.pc.restartIce();
  }

  addStream(stream: MediaStream): Map<MediaStreamTrack, RTCRtpSender> {
    const senders = new Map<MediaStreamTrack, RTCRtpSender>();
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      senders.set(track, sender);
    }
    return senders;
  }

  removeSender(sender: RTCRtpSender) {
    try { this.pc.removeTrack(sender); } catch (e) { console.error('[peer] removeTrack', e); }
  }
}
