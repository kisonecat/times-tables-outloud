let ctx: AudioContext | null = null;

/** Short feedback tone: a rising two-note blip for right, a soft low slide for a miss. */
export function blip(ok: boolean) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = 'sine';
    if (ok) {
      o.frequency.setValueAtTime(660, t);
      o.frequency.setValueAtTime(990, t + 0.09);
    } else {
      o.frequency.setValueAtTime(260, t);
      o.frequency.linearRampToValueAtTime(180, t + 0.28);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.34);
  } catch {
    // no audio output; feedback is visual anyway
  }
}

/** A short rising arpeggio for streak milestones. */
export function chime() {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      const t = t0 + i * 0.07;
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.42);
    });
  } catch {
    // no audio output
  }
}
