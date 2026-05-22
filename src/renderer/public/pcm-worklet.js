// AudioWorklet: downsample from sampleRate (usu. 48000) to 16000 Hz, output Int16 PCM
// Emits a Int16Array buffer per ~40ms chunk

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.chunkMs = 40;
    this.chunkSize = Math.round((this.targetSampleRate * this.chunkMs) / 1000); // samples per chunk @16k
    this.buffer = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0) return true;

    // append incoming float samples (still at native sampleRate) to buffer
    const next = new Float32Array(this.buffer.length + ch0.length);
    next.set(this.buffer, 0);
    next.set(ch0, this.buffer.length);
    this.buffer = next;

    // resample: pick every `ratio`-th sample (linear interp for non-integer ratio)
    const neededInputForChunk = Math.ceil(this.chunkSize * this.ratio);
    while (this.buffer.length >= neededInputForChunk) {
      const out = new Int16Array(this.chunkSize);
      for (let i = 0; i < this.chunkSize; i++) {
        const srcIdx = i * this.ratio;
        const i0 = Math.floor(srcIdx);
        const i1 = Math.min(i0 + 1, this.buffer.length - 1);
        const frac = srcIdx - i0;
        const sample = this.buffer[i0] * (1 - frac) + this.buffer[i1] * frac;
        const s = Math.max(-1, Math.min(1, sample));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      // drop consumed input samples (keep tail for next chunk continuity)
      this.buffer = this.buffer.slice(neededInputForChunk);
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
