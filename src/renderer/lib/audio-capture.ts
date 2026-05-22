export class AudioCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start(stream: MediaStream, onPcmChunk: (buf: ArrayBuffer) => void) {
    this.ctx = new AudioContext();
    // Use relative URL so it works under both vite dev (http://localhost:5173/)
    // and packaged Electron (file:// where '/' would resolve to filesystem root)
    await this.ctx.audioWorklet.addModule(new URL('pcm-worklet.js', window.location.href).toString());
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler');
    this.node.port.onmessage = (e) => onPcmChunk(e.data as ArrayBuffer);
    this.source.connect(this.node);
  }

  async stop() {
    this.node?.disconnect();
    this.source?.disconnect();
    await this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.source = null;
  }
}
