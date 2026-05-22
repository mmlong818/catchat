export interface InviteLink {
  roomId: string;
  token: string;
  /** Optional override of signaling server URL (omitted for default public server) */
  signal?: string;
}

export interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  isHost: boolean;
  avatar?: { kind: 'preset' | 'letter' | 'image'; value: string; bg?: string };
  micMuted?: boolean;
}

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  text: string;
  ts: number;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  speakerName: string;
  text: string;
  ts: number;
  isFinal: boolean;
}

export type SignalingMessage =
  | { type: 'join'; peer: Peer; token: string; roomId: string }
  | { type: 'welcome'; you: Peer; peers: Peer[] }
  | { type: 'peer-joined'; peer: Peer }
  | { type: 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; to: string; data: unknown }
  | { type: 'host-transfer'; newHostId: string }
  | { type: 'meeting-ended'; reason?: string }
  | { type: 'error'; message: string };
