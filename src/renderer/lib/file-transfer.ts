/**
 * P2P 文件传输：
 *  - 控制消息走 JSON 文本（file-start / file-end / file-cancel）
 *  - 数据块走二进制，前 36 字节固定头：32 hex 文件 id + 4 字节 seq (LE)
 */

import type { PeerConnection } from './peer';

const HEADER_BYTES = 36;
const CHUNK_SIZE = 16 * 1024;
const BACKPRESSURE = 256 * 1024;
const ENC = new TextEncoder();

export interface FileStartMeta {
  kind: 'file-start';
  id: string;
  name: string;
  size: number;
  mime: string;
  total: number;
  from: string;
  fromName: string;
}

export interface FileEndMeta {
  kind: 'file-end';
  id: string;
}

export function randomFileId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function encodeHeader(id: string, seq: number): Uint8Array {
  const buf = new Uint8Array(HEADER_BYTES);
  buf.set(ENC.encode(id), 0); // 32 hex chars
  new DataView(buf.buffer).setUint32(32, seq, true);
  return buf;
}

export function decodeHeader(buf: ArrayBuffer): { id: string; seq: number; payload: ArrayBuffer } | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const view = new Uint8Array(buf);
  let id = '';
  for (let i = 0; i < 32; i++) id += String.fromCharCode(view[i]);
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const seq = new DataView(buf, 32, 4).getUint32(0, true);
  return { id, seq, payload: buf.slice(HEADER_BYTES) };
}

/** Send a file to one peer. Returns when complete. */
export async function sendFileToPeer(
  conn: PeerConnection,
  file: File,
  meta: { from: string; fromName: string },
  onProgress: (sent: number, total: number) => void,
) {
  const id = randomFileId();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  const startMeta: FileStartMeta = {
    kind: 'file-start',
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    total,
    from: meta.from,
    fromName: meta.fromName,
  };
  conn.send(startMeta);

  let sent = 0;
  for (let seq = 0; seq < total; seq++) {
    if (conn.bufferedAmount > BACKPRESSURE) await conn.waitDrain(BACKPRESSURE / 2);
    const slice = file.slice(seq * CHUNK_SIZE, (seq + 1) * CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    const out = new Uint8Array(HEADER_BYTES + buf.byteLength);
    out.set(encodeHeader(id, seq), 0);
    out.set(new Uint8Array(buf), HEADER_BYTES);
    conn.sendBinary(out.buffer);
    sent += buf.byteLength;
    onProgress(sent, file.size);
  }

  const endMeta: FileEndMeta = { kind: 'file-end', id };
  conn.send(endMeta);
  return id;
}

/** Receive-side state for one in-flight incoming file */
export interface IncomingFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  total: number;
  from: string;
  fromName: string;
  chunks: ArrayBuffer[];
  received: number;
  startedAt: number;
}

export class FileReceiver {
  private files: Map<string, IncomingFile> = new Map();

  start(meta: FileStartMeta): IncomingFile {
    const f: IncomingFile = {
      id: meta.id,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      total: meta.total,
      from: meta.from,
      fromName: meta.fromName,
      chunks: new Array(meta.total),
      received: 0,
      startedAt: Date.now(),
    };
    this.files.set(meta.id, f);
    return f;
  }

  ingestChunk(id: string, seq: number, payload: ArrayBuffer): IncomingFile | null {
    const f = this.files.get(id);
    if (!f) return null;
    if (f.chunks[seq] !== undefined) return f; // duplicate
    f.chunks[seq] = payload;
    f.received += payload.byteLength;
    return f;
  }

  /** Returns assembled Blob if complete, else null */
  finish(id: string): { file: IncomingFile; blob: Blob } | null {
    const f = this.files.get(id);
    if (!f) return null;
    for (let i = 0; i < f.total; i++) {
      if (!f.chunks[i]) return null;
    }
    const blob = new Blob(f.chunks, { type: f.mime });
    this.files.delete(id);
    return { file: f, blob };
  }

  get(id: string) { return this.files.get(id); }
}
