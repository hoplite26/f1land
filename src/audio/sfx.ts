/**
 * Procedural UI sound effects (WebAudio). No audio files; everything is
 * synthesised on demand. Muted by default until the user interacts and the
 * setting is on.
 */
let ctx: AudioContext | null = null;
let enabled = true;
let master: GainNode | null = null;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.4, delay = 0, slideTo?: number): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain = 0.2, delay = 0, filterFreq = 1200): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  tap: () => tone(1800, 0.04, 'square', 0.05),
  select: () => {
    tone(880, 0.06, 'triangle', 0.12);
    tone(1320, 0.08, 'triangle', 0.08, 0.04);
  },
  nav: () => tone(520, 0.12, 'sawtooth', 0.05, 0, 980),
  light: () => tone(660, 0.18, 'sine', 0.22),
  lightsOut: () => {
    noise(0.6, 0.12, 0, 500);
    tone(110, 0.9, 'sawtooth', 0.12, 0, 420);
  },
  confirm: () => {
    tone(600, 0.08, 'triangle', 0.15);
    tone(900, 0.08, 'triangle', 0.15, 0.07);
    tone(1350, 0.16, 'triangle', 0.15, 0.14);
  },
  lock: () => tone(300, 0.15, 'square', 0.06, 0, 200),
  overtake: () => {
    tone(220, 0.35, 'sawtooth', 0.06, 0, 660);
    noise(0.25, 0.05, 0.05, 2500);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.18, i * 0.09));
    tone(1568, 0.5, 'sine', 0.12, 0.38);
  },
  lose: () => {
    tone(392, 0.2, 'triangle', 0.12);
    tone(311, 0.32, 'triangle', 0.12, 0.16);
  },
  warn: () => {
    tone(740, 0.12, 'square', 0.08);
    tone(740, 0.12, 'square', 0.08, 0.2);
  },
};
