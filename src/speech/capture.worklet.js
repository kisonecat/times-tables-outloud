// AudioWorklet that batches mic input into ~20 ms mono frames and posts them, tagged
// with the AudioContext time of the frame's first sample, to the main thread.
// Plain JS: it's loaded by URL with audioWorklet.addModule, outside the bundle.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.02);
    this.buf = new Float32Array(this.size);
    this.fill = 0;
    this.startTime = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      if (this.fill === 0) this.startTime = currentTime + i / sampleRate;
      const n = Math.min(ch.length - i, this.size - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.size) {
        const frame = this.buf;
        this.port.postMessage({ frame, time: this.startTime }, [frame.buffer]);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('tt-capture', CaptureProcessor);
