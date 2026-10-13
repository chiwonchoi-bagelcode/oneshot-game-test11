/*
 * Pure-JS instrument synthesis. Every function renders one note into a mono Float32Array that is
 * later wrapped in an AudioBuffer and played back with playbackRate for nearby pitches. Nothing
 * here touches WebAudio, so it runs identically for the live context, an OfflineAudioContext
 * harness, or a worker.
 *
 * Cost notes: partials are produced with damped "rotation" oscillators (4 mul + 2 add per sample,
 * decay folded into the rotation), so a full note costs a few ms at most.
 */

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** mulberry32 — deterministic noise so renders (and the test harness) are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds an exponentially decaying sine (tau = seconds to 1/e). tau <= 0 means undamped. */
function damped(out: Float32Array, sr: number, f: number, amp: number, tau: number, phase = 0, start = 0): void {
  if (f <= 0 || f >= sr * 0.46 || amp === 0) return;
  const w = (TAU * f) / sr;
  const r = tau > 0 ? Math.exp(-1 / (tau * sr)) : 1;
  const c = r * Math.cos(w);
  const s = r * Math.sin(w);
  let x = amp * Math.cos(phase);
  let y = amp * Math.sin(phase);
  const end = Math.min(out.length, tau > 0 ? start + Math.ceil(tau * sr * 10) : out.length);
  for (let i = start; i < end; i++) {
    out[i] += y;
    const nx = x * c - y * s;
    y = x * s + y * c;
    x = nx;
  }
}

/** RBJ biquad, transposed direct form II. */
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  constructor(private sr: number) {}
  bp(f: number, q: number): this {
    const w = (TAU * clamp(f, 10, this.sr * 0.45)) / this.sr;
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  lp(f: number, q = 0.707): this {
    const w = (TAU * clamp(f, 10, this.sr * 0.45)) / this.sr;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  hp(f: number, q = 0.707): this {
    const w = (TAU * clamp(f, 10, this.sr * 0.45)) / this.sr;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Adds a filtered noise burst with a (1 - t/len)^pow envelope. */
function noiseBurst(out: Float32Array, sr: number, seed: number, len: number, amp: number, filt: Biquad, pow = 2, start = 0): void {
  const r = rng(seed);
  const n = Math.min(out.length - start, Math.floor(len * sr));
  for (let i = 0; i < n; i++) {
    const e = Math.pow(1 - i / n, pow);
    out[start + i] += filt.run(r() * 2 - 1) * amp * e;
  }
}

/** DC-block, attack ramp, trim trailing silence (−80 dB), end fade, normalise peak to 1. */
function finish(buf: Float32Array, sr: number, attack = 0, fadeOut = 0.02): Float32Array {
  // DC blocker at ~10 Hz.
  const R = 1 - (TAU * 10) / sr;
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = x - x1 + R * y1;
    x1 = x; y1 = y;
    buf[i] = y;
  }
  if (attack > 0) {
    const n = Math.min(buf.length, Math.floor(attack * sr));
    for (let i = 0; i < n; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
  }
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  if (peak < 1e-9) return new Float32Array(Math.max(1, Math.floor(sr * 0.01)));
  const thr = peak * 1e-4;
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]) < thr) end--;
  const fo = Math.floor(fadeOut * sr);
  end = Math.min(buf.length, end + fo);
  const out = buf.length === end ? buf : buf.slice(0, end);
  const g = 1 / peak;
  const fs = Math.max(0, end - fo);
  for (let i = 0; i < end; i++) {
    let v = out[i] * g;
    if (i >= fs) v *= 0.5 + 0.5 * Math.cos((Math.PI * (i - fs)) / Math.max(1, fo));
    out[i] = v;
  }
  return out;
}

export function reverse(b: Float32Array): Float32Array {
  const o = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b[b.length - 1 - i];
  // reversed decays end abruptly at the strike: soften the last 4 ms
  const n = Math.min(o.length, 200);
  for (let i = 0; i < n; i++) o[o.length - 1 - i] *= i / n;
  return o;
}

const len = (sr: number, sec: number): Float32Array => new Float32Array(Math.ceil(sr * sec));

// ---------------------------------------------------------------------------------------------
// Pitched instruments
// ---------------------------------------------------------------------------------------------

/** Kalimba: metal tine — strong fundamental, inharmonic tine partials, a soft thumb tick. */
export function kalimba(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 1.9);
  const tau = clamp(1.05 * Math.pow(440 / f, 0.35), 0.4, 1.7);
  const r = rng(midi * 31 + 7);
  damped(out, sr, f, 1, tau, r() * TAU);
  damped(out, sr, f * 1.0021, 0.18, tau * 0.8, r() * TAU); // box coupling → slow shimmer
  damped(out, sr, f * 2.0, 0.05, tau * 0.3, r() * TAU);
  damped(out, sr, f * 5.93, 0.2, 0.075, r() * TAU);
  damped(out, sr, f * 13.4, 0.05, 0.022, r() * TAU);
  noiseBurst(out, sr, midi * 3 + 1, 0.006, 0.25, new Biquad(sr).bp(Math.min(f * 3.2, 6000), 1.4));
  return finish(out, sr, 0.0015);
}

/** Marimba: rosewood bar, tuned 4th partial, felt mallet. Warm and short. */
export function marimba(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 1.4);
  const tau = clamp(0.55 * Math.pow(330 / f, 0.45), 0.22, 1.2);
  const r = rng(midi * 17 + 3);
  damped(out, sr, f, 1, tau, r() * TAU);
  damped(out, sr, f * 3.99, 0.26, tau * 0.22, r() * TAU);
  damped(out, sr, f * 9.2, 0.05, 0.02, r() * TAU);
  damped(out, sr, f * 0.5 + 0.3, 0.04, tau * 0.6, r() * TAU); // resonator bloom
  noiseBurst(out, sr, midi * 5 + 2, 0.008, 0.07, new Biquad(sr).lp(1600));
  return finish(out, sr, 0.0028);
}

/** Felt piano: soft hammer, slightly inharmonic strings, two detuned strings, double decay. */
export function piano(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 2.8);
  const nP = Math.min(9, Math.floor((0.42 * sr) / f));
  const B = 0.00012;
  const tau1 = clamp(1.5 * Math.pow(262 / f, 0.5), 0.55, 3.2);
  const r = rng(midi * 13 + 5);
  for (let n = 1; n <= nP; n++) {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    const amp = (1 / Math.pow(n, 1.6)) * (n <= 2 ? 1 : Math.exp(-(n - 2) * 0.32));
    const tau = tau1 / (1 + 0.38 * Math.pow(n - 1, 1.25));
    damped(out, sr, fn, amp * 0.6, tau, r() * TAU);
    if (n <= 3) damped(out, sr, fn * 1.0007, amp * 0.4, tau, r() * TAU);
    if (n <= 2) damped(out, sr, fn, amp * 0.1, tau * 3.2, r() * TAU);
  }
  noiseBurst(out, sr, midi * 7 + 9, 0.016, 0.05, new Biquad(sr).lp(900), 3);
  return finish(out, sr, 0.004);
}

/** Chime / bell: free-bar inharmonic modes, beating twin, FM strike sparkle. */
export function bell(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 3.4);
  const k = Math.pow(523 / f, 0.3);
  const r = rng(midi * 19 + 11);
  damped(out, sr, f, 1, 2.4 * k, r() * TAU);
  damped(out, sr, f + 0.85, 0.42, 2.0 * k, r() * TAU);
  damped(out, sr, f * 2.756, 0.32, 0.8 * k, r() * TAU);
  damped(out, sr, f * 5.404, 0.12, 0.3 * k, r() * TAU);
  damped(out, sr, f * 8.933, 0.04, 0.12 * k, r() * TAU);
  // FM strike: brief bright inharmonic transient
  const n = Math.min(out.length, Math.floor(0.3 * sr));
  const w = (TAU * f) / sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = 2.2 * Math.exp(-t / 0.04);
    out[i] += 0.16 * Math.exp(-t / 0.07) * Math.sin(w * i + idx * Math.sin(w * 3.51 * i));
  }
  return finish(out, sr, 0.0008);
}

/** Temple bell (범종-like): deep hum, slow beating (맥놀이), long bloom. Low register only. */
export function gong(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 5.5);
  const r = rng(midi * 23 + 1);
  const modes: [number, number, number][] = [
    [0.5, 0.55, 5.5], [1, 1, 4.2], [2.0, 0.45, 2.4], [2.76, 0.28, 1.5], [3.42, 0.16, 1.0], [4.1, 0.08, 0.6], [5.4, 0.04, 0.35],
  ];
  for (const [ratio, a, tau] of modes) {
    damped(out, sr, f * ratio, a, tau, r() * TAU);
    if (ratio <= 1) damped(out, sr, f * ratio + 0.7, a * 0.6, tau * 0.9, r() * TAU);
  }
  noiseBurst(out, sr, midi + 99, 0.03, 0.12, new Biquad(sr).lp(1800), 2);
  return finish(out, sr, 0.003, 0.2);
}

/** Gayageum-like plucked silk string — Karplus–Strong with tuned fractional delay + wooden body. */
export function gayageum(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 2.6);
  const N = sr / f;
  const L = Math.max(2, Math.floor(N - 0.5 - 0.1));
  const frac = N - 0.5 - L;
  const apC = (1 - frac) / (1 + frac);
  const t60 = clamp(3.0 * Math.pow(150 / f, 0.5), 0.9, 4);
  const rho = Math.min(0.99995, Math.pow(10, -3 / (t60 * f)) / Math.cos((Math.PI * f) / sr));
  // excitation: soft finger pluck — lowpassed noise with pluck-position comb, zero mean
  const r = rng(midi * 29 + 13);
  const buf = new Float64Array(L);
  const lp = new Biquad(sr).lp(Math.min(f * 7, sr * 0.4), 0.6);
  for (let i = 0; i < L; i++) buf[i] = lp.run(r() * 2 - 1);
  const pp = Math.max(1, Math.floor(L * 0.14));
  const tmp = Float64Array.from(buf);
  for (let i = 0; i < L; i++) buf[i] = tmp[i] - 0.8 * tmp[(i + pp) % L];
  let mean = 0;
  for (let i = 0; i < L; i++) mean += buf[i];
  mean /= L;
  for (let i = 0; i < L; i++) buf[i] -= mean;
  let idx = 0, apx = 0, apy = 0;
  for (let i = 0; i < out.length; i++) {
    const a0 = buf[idx];
    const nx = idx + 1 === L ? 0 : idx + 1;
    const s = rho * 0.5 * (a0 + buf[nx]);
    const y = apC * s + apx - apC * apy;
    apx = s; apy = y;
    out[i] = a0;
    buf[idx] = y;
    idx = nx;
  }
  // wooden body: two resonances mixed under the string
  const b1 = new Biquad(sr).bp(230, 2.2);
  const b2 = new Biquad(sr).bp(1050, 1.6);
  const tone = new Biquad(sr).lp(5200, 0.6);
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    out[i] = tone.run(x + 0.6 * b1.run(x) + 0.35 * b2.run(x));
  }
  return finish(out, sr, 0.0012);
}

/** Bamboo flute (대금-ish breathy): sine-rich tone, breath noise, chiff, delayed vibrato. */
export function flute(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const dur = 2.2;
  const out = len(sr, dur);
  const r = rng(midi * 37 + 17);
  const breath = new Biquad(sr).bp(Math.min(2200, sr * 0.4), 0.7);
  const chiff = new Biquad(sr).bp(Math.min(f * 3, sr * 0.4), 1.5);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = t < 0.09 ? Math.sin((t / 0.09) * Math.PI * 0.5) : t < 1.5 ? 1 - 0.18 * ((t - 0.09) / 1.41) : 0.82 * (0.5 + 0.5 * Math.cos((Math.PI * (t - 1.5)) / (dur - 1.5)));
    const vd = clamp((t - 0.3) / 0.45, 0, 1) * 0.0075;
    ph += (TAU * f * (1 + vd * Math.sin(TAU * 5.1 * t))) / sr;
    const tone = Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.07 * Math.sin(3 * ph) + 0.02 * Math.sin(4 * ph);
    const nz = r() * 2 - 1;
    let v = tone * env + breath.run(nz) * 0.09 * env;
    if (t < 0.06) v += chiff.run(nz) * 0.5 * (1 - t / 0.06) * (1 - t / 0.06);
    out[i] = v;
  }
  return finish(out, sr, 0.004, 0.05);
}

/** Warm breathy pad: three detuned soft-harmonic voices, slow swell, long release. */
export function pad(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const dur = 7.5;
  const out = len(sr, dur);
  const r = rng(midi * 41 + 19);
  const det = [-0.0046, 0, 0.004];
  const amps = [1, 0.42, 0.22, 0.1, 0.05];
  for (let v = 0; v < det.length; v++) {
    for (let h = 0; h < amps.length; h++) damped(out, sr, f * (h + 1) * (1 + det[v]), amps[h] / 3, 0, r() * TAU);
  }
  const breath = new Biquad(sr).bp(Math.min(f * 3, sr * 0.4), 2);
  const A = 1.6, R0 = 4.8;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let e = t < A ? Math.pow(Math.sin((t / A) * Math.PI * 0.5), 2) : 1;
    if (t > R0) e *= Math.pow(Math.cos(((t - R0) / (dur - R0)) * Math.PI * 0.5), 2);
    e *= 1 + 0.08 * Math.sin(TAU * 0.17 * t + 1.3);
    out[i] = out[i] * e + breath.run(r() * 2 - 1) * 0.05 * e;
  }
  return finish(out, sr, 0, 0.05);
}

/** Sub bass pad: sine with a touch of 2nd/3rd harmonic so it reads on phone speakers. */
export function sub(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const dur = 6;
  const out = len(sr, dur);
  damped(out, sr, f, 1, 0);
  damped(out, sr, f * 2, 0.22, 0, 0.7);
  damped(out, sr, f * 3, 0.08, 0, 1.9);
  damped(out, sr, f * 4, 0.03, 0, 0.3);
  const A = 0.5, R0 = 3.8;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let e = t < A ? Math.sin((t / A) * Math.PI * 0.5) : 1;
    if (t > R0) e *= Math.pow(Math.cos(((t - R0) / (dur - R0)) * Math.PI * 0.5), 2);
    out[i] *= e;
  }
  return finish(out, sr, 0, 0.05);
}

/** Water droplet "plip": rising sine chirp (Minnaert bubble) + tiny splash. */
export function plip(sr: number, midi: number): Float32Array {
  const f0 = mtof(midi);
  const out = len(sr, 0.22);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = f0 * (1 + 0.85 * (1 - Math.exp(-t / 0.016)));
    ph += (TAU * f) / sr;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.038);
  }
  noiseBurst(out, sr, midi + 5, 0.01, 0.06, new Biquad(sr).hp(3500));
  return finish(out, sr, 0.0012);
}

/** Small coin / glass tick. */
export function coin(sr: number, midi: number): Float32Array {
  const f = mtof(midi);
  const out = len(sr, 0.6);
  const r = rng(midi + 77);
  damped(out, sr, f, 1, 0.18, r() * TAU);
  damped(out, sr, f + 4, 0.5, 0.15, r() * TAU);
  damped(out, sr, f * 2.76, 0.4, 0.06, r() * TAU);
  damped(out, sr, f * 5.4, 0.18, 0.025, r() * TAU);
  noiseBurst(out, sr, midi + 3, 0.003, 0.25, new Biquad(sr).hp(5000));
  return finish(out, sr, 0.0005);
}

// ---------------------------------------------------------------------------------------------
// Unpitched: percussion, foley, textures (midi argument ignored)
// ---------------------------------------------------------------------------------------------

function modal(sr: number, seed: number, dur: number, modes: [number, number, number][], click: number, clickF: number, attack: number): Float32Array {
  const out = len(sr, dur);
  const r = rng(seed);
  for (const [f, a, tau] of modes) damped(out, sr, f, a, tau, r() * TAU);
  noiseBurst(out, sr, seed + 1, 0.004, click, new Biquad(sr).bp(clickF, 0.9), 2);
  return finish(out, sr, attack);
}

/** High woodblock (UI clicks). */
export const woodHi = (sr: number): Float32Array =>
  modal(sr, 101, 0.25, [[1250, 1, 0.034], [1960, 0.45, 0.02], [3150, 0.16, 0.01]], 0.35, 3000, 0.0008);
/** Low woodblock / moktak (tension pulse). */
export const woodLo = (sr: number): Float32Array =>
  modal(sr, 202, 0.3, [[520, 1, 0.055], [835, 0.42, 0.034], [1430, 0.13, 0.016]], 0.18, 1600, 0.0015);
/** Hollow "tok" (touches, reject, toggles, bamboo knocks). */
export const tok = (sr: number): Float32Array =>
  modal(sr, 303, 0.25, [[380, 1, 0.045], [1020, 0.3, 0.018], [1650, 0.08, 0.008]], 0.12, 1200, 0.0018);

function shakerGen(sr: number, seed: number): Float32Array {
  const out = len(sr, 0.16);
  const r = rng(seed);
  const hp = new Biquad(sr).hp(3800, 0.7);
  const bp = new Biquad(sr).bp(Math.min(7000, sr * 0.4), 0.8);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const e = t < 0.014 ? (t / 0.014) * (t / 0.014) : Math.exp(-(t - 0.014) / 0.03);
    out[i] = bp.run(hp.run(r() * 2 - 1)) * e;
  }
  return finish(out, sr, 0, 0.01);
}
export const shakerA = (sr: number): Float32Array => shakerGen(sr, 404);
export const shakerB = (sr: number): Float32Array => shakerGen(sr, 405);

/** Soft brush swirl. */
export function brush(sr: number): Float32Array {
  const out = len(sr, 0.42);
  const r = rng(505);
  const bp = new Biquad(sr).bp(2600, 0.5);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const e = t < 0.045 ? t / 0.045 : Math.exp(-(t - 0.045) / 0.1);
    out[i] = bp.run(r() * 2 - 1) * e;
  }
  return finish(out, sr, 0, 0.02);
}

/** Paper crunch: decaying cloud of tiny noise grains. */
export function paper(sr: number): Float32Array {
  const dur = 0.32;
  const out = len(sr, dur);
  const r = rng(606);
  for (let g = 0; g < 46; g++) {
    const t0 = dur * 0.8 * Math.pow(r(), 1.9);
    const tau = 0.0012 + r() * 0.004;
    const a = (0.3 + r() * 0.7) * (1 - t0 / dur);
    const s0 = Math.floor(t0 * sr);
    const n = Math.min(out.length - s0, Math.floor(tau * 6 * sr));
    for (let i = 0; i < n; i++) out[s0 + i] += (r() * 2 - 1) * a * Math.exp(-i / (tau * sr));
  }
  const bp = new Biquad(sr).bp(2600, 0.6);
  const hp = new Biquad(sr).hp(700);
  for (let i = 0; i < out.length; i++) out[i] = bp.run(hp.run(out[i]));
  return finish(out, sr, 0.0005, 0.02);
}

/** Seal stamp thud: pitch-dropping sine body + low noise. */
export function thud(sr: number): Float32Array {
  const out = len(sr, 0.45);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (TAU * (52 + 105 * Math.exp(-t / 0.028))) / sr;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.1);
  }
  noiseBurst(out, sr, 707, 0.03, 0.35, new Biquad(sr).lp(420), 2);
  return finish(out, sr, 0.0015, 0.03);
}

/** Short noise swish rising in pitch (popup open). */
export function swish(sr: number): Float32Array {
  const dur = 0.24;
  const out = len(sr, dur);
  const r = rng(808);
  const bp = new Biquad(sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.bp(700 * Math.pow(7, t / dur), 1.3);
    const e = t < 0.14 ? Math.pow(t / 0.14, 2) : Math.exp(-(t - 0.14) / 0.03);
    out[i] = bp.run(r() * 2 - 1) * e;
  }
  return finish(out, sr, 0, 0.01);
}

/** Long rising noise swell (reward / rewind). */
export function swell(sr: number): Float32Array {
  const dur = 0.95;
  const out = len(sr, dur);
  const r = rng(909);
  const bp = new Biquad(sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.bp(280 * Math.pow(20, t / dur), 1.1);
    const e = Math.pow(t / dur, 2.4) * (t > dur - 0.02 ? (dur - t) / 0.02 : 1);
    out[i] = bp.run(r() * 2 - 1) * e;
  }
  return finish(out, sr, 0, 0.002);
}

/** Air: 6 s of slowly moving band-passed noise (wind / waves / mist). */
export function air(sr: number): Float32Array {
  const dur = 6;
  const out = len(sr, dur);
  const r = rng(1001);
  const bp = new Biquad(sr);
  const lp = new Biquad(sr).lp(2500);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) bp.bp(520 + 330 * Math.sin(TAU * 0.13 * t + 0.6) + 120 * Math.sin(TAU * 0.41 * t), 0.9);
    let e = t < 2 ? Math.pow(Math.sin((t / 2) * Math.PI * 0.5), 2) : 1;
    if (t > 3.4) e *= Math.pow(Math.cos(((t - 3.4) / (dur - 3.4)) * Math.PI * 0.5), 2);
    e *= 0.75 + 0.25 * Math.sin(TAU * 0.31 * t);
    out[i] = lp.run(bp.run(r() * 2 - 1)) * e;
  }
  return finish(out, sr, 0, 0.05);
}

/** Reverb impulse response: pre-delay, sparse early reflections, dense tail with HF damping. */
export function impulse(sr: number, seconds: number, ch: number): Float32Array {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const r = rng(4242 + ch * 7);
  const pre = Math.floor(0.012 * sr);
  // early reflections
  const er = [0.007, 0.013, 0.019, 0.027, 0.036, 0.047];
  for (let k = 0; k < er.length; k++) {
    const i = pre + Math.floor((er[k] + (ch ? 0.0017 * k : 0)) * sr);
    if (i < n) out[i] += (r() < 0.5 ? -1 : 1) * 0.5 * Math.pow(0.78, k);
  }
  // tail: exponential decay (RT60 = seconds), damping that darkens over time, LF cleaned up
  const k60 = 6.91 / seconds;
  let lpState = 0;
  const hp = new Biquad(sr).hp(170, 0.6);
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sr;
    const fc = 9000 * Math.exp(-t * 1.6) + 1400;
    const a = Math.exp((-TAU * fc) / sr);
    const x = (r() * 2 - 1) * Math.exp(-k60 * t) * Math.min(1, t / 0.02 + 0.15);
    lpState = (1 - a) * x + a * lpState;
    out[i] += hp.run(lpState) * 0.9;
  }
  // unit energy so the send gain is the wet level
  let e = 0;
  for (let i = 0; i < n; i++) e += out[i] * out[i];
  const g = 1 / Math.sqrt(Math.max(e, 1e-9));
  for (let i = 0; i < n; i++) out[i] *= g;
  // fade the last 50 ms
  const fo = Math.floor(0.05 * sr);
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return out;
}
