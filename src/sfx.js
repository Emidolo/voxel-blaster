// Tiny synthesized sound effects (WebAudio, no asset files).
let ctx, muted = false, lastPop = 0;
try { muted = localStorage.getItem('muted') === '1'; } catch {}

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 1, delay = 0) {
  if (muted) return;
  ctx ??= new AudioContext();
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('muted', muted ? '1' : '0'); } catch {} return muted; },
  pick: () => tone(520, 0.12, 'triangle', 0.2, 1.6),
  full: () => tone(160, 0.18, 'square', 0.08, 0.7),
  pop() { // throttled: dozens of blocks break per second
    const now = performance.now();
    if (now - lastPop < 35) return;
    lastPop = now;
    tone(700 + Math.random() * 500, 0.06, 'sine', 0.06, 0.5);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, 1, i * 0.12)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.07, 0.95, i * 0.15)),
};
