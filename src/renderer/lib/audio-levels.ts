/**
 * 实时音量探测：为多个 MediaStream 计算 RMS 音量，
 * 用于在 UI 上以光环/波纹表现"谁正在说话、音量多大"。
 */
export class AudioLevels {
  private ctx: AudioContext | null = null;
  private sources: Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Uint8Array }> = new Map();

  private ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  attach(id: string, stream: MediaStream) {
    if (this.sources.has(id)) return;
    if (stream.getAudioTracks().length === 0) return;
    const ctx = this.ensureCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    this.sources.set(id, { source, analyser, buf });
  }

  detach(id: string) {
    const e = this.sources.get(id);
    if (!e) return;
    try { e.source.disconnect(); } catch {}
    this.sources.delete(id);
  }

  /** Get current normalized level (0..1) */
  level(id: string): number {
    const e = this.sources.get(id);
    if (!e) return 0;
    e.analyser.getByteTimeDomainData(e.buf as Uint8Array<ArrayBuffer>);
    let sumSq = 0;
    for (const v of e.buf) {
      const x = (v - 128) / 128;
      sumSq += x * x;
    }
    const rms = Math.sqrt(sumSq / e.buf.length);
    // boost — 普通语音 RMS 大概 0.02-0.15
    return Math.min(1, rms * 8);
  }

  /** Get levels for all attached ids */
  all(): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of this.sources.keys()) m.set(id, this.level(id));
    return m;
  }

  ids(): string[] {
    return [...this.sources.keys()];
  }

  close() {
    for (const id of this.sources.keys()) this.detach(id);
    try { this.ctx?.close(); } catch {}
    this.ctx = null;
  }
}
