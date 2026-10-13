/*
 * The audio graph for one (Offline)AudioContext: buses, reverb, master limiter, voice pool.
 * Everything takes explicit audio-clock times so the same code renders offline in tests.
 *
 *   voice: BufferSource → [lowpass] → Gain ─┐
 *                                          ├→ channel(pan L/C/R × dry/wet) ─→ bus.duck → bus.vol ─┐
 *                                          │                               └→ send → bus.sendVol ─┼→ reverb ─┐
 *                                                                                                 └──────────┴→ master → compressor → trim → soft-clip → out
 */
import { Bank } from './bank.ts';
import { impulse } from './dsp.ts';

export type BusName = 'sfx' | 'music';
export type Pan = -1 | 0 | 1;

export interface PlayOpts {
  gain?: number;
  pan?: Pan;
  /** 0 = mostly dry, 1 = wet (more reverb). */
  wet?: 0 | 1;
  bus?: BusName;
  /** Extra playbackRate multiplier (detune / unpitched pitch). */
  rate?: number;
  /** Start offset into the buffer (seconds of buffer time). */
  offset?: number;
  /** Play only the last `tail` seconds (real time) of the buffer — for reversed swells. */
  tail?: number;
  /** Cut the voice after this many seconds (short fade). */
  maxDur?: number;
  /** Optional lowpass cutoff (adds a filter node). */
  lp?: number;
  /** Vibrato depth in semitones (gayageum-style 농현), starts after the attack. */
  vib?: number;
  /** Slide into the note from this many semitones below. */
  slide?: number;
  /** Voice group for release()/cancel. */
  group?: string;
  /** Long sustained voice (pads/bass): stolen last. */
  sustain?: boolean;
}

interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
  f: BiquadFilterNode | null;
  start: number;
  end: number;
  group: string;
  sustain: boolean;
  dead: boolean;
}

interface BusNodes {
  ch: AudioNode[]; // index (pan+1)*2 + wet
  duck: GainNode;
  vol: GainNode;
  sendVol: GainNode;
  level: number;
}

/** Maps the page's performance.now() clock onto the audio clock: audio = ms/1000 + offset. */
export interface Clock {
  offset: number;
}

export interface CoreStats {
  voicesCreated: number;
  voicesStolen: number;
  maxActive: number;
  skippedSilent: number;
}

export interface CoreOptions {
  lowPower?: boolean;
  clock?: Clock;
  /** Reverb tail length (s). */
  reverb?: number;
}

const PANS = [-0.55, 0, 0.55];

export class Core {
  readonly ctx: BaseAudioContext;
  readonly bank: Bank;
  readonly clock: Clock;
  readonly maxVoices: number;
  /** When set (offline harness), replaces ctx.currentTime as "now". */
  virtualNow: number | null = null;
  readonly stats: CoreStats = { voicesCreated: 0, voicesStolen: 0, maxActive: 0, skippedSilent: 0 };
  /** Audio time at which the last scheduled voice ends (for idle-suspend). */
  lastSoundEnd = 0;

  private voices: Voice[] = [];
  private master: GainNode;
  private trim: GainNode;
  private buses: Record<BusName, BusNodes>;
  private canPan: boolean;
  private nodes: AudioNode[] = [];

  constructor(ctx: BaseAudioContext, bank: Bank, opts: CoreOptions = {}) {
    this.ctx = ctx;
    this.bank = bank;
    this.clock = opts.clock || { offset: 0 };
    this.maxVoices = opts.lowPower ? 16 : 24;
    this.canPan = typeof (ctx as AudioContext).createStereoPanner === 'function';

    // master: compressor (glue + safety) → trim → soft clip (hard ceiling just under -1 dBFS)
    const master = (this.master = this.gain(1));
    const comp = this.track(ctx.createDynamicsCompressor());
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const trim = (this.trim = this.gain(0.72));
    const clip = this.track(ctx.createWaveShaper());
    clip.curve = softClipCurve();
    master.connect(comp);
    comp.connect(trim);
    trim.connect(clip);
    clip.connect(ctx.destination);

    // reverb send/return
    const rIn = this.gain(1);
    const conv = this.track(ctx.createConvolver());
    conv.normalize = false;
    const secs = opts.reverb || (opts.lowPower ? 1.2 : 1.8);
    const L = impulse(ctx.sampleRate, secs, 0);
    const R = impulse(ctx.sampleRate, secs, 1);
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    setChannel(ir, 0, L);
    setChannel(ir, 1, R);
    conv.buffer = ir;
    const rOut = this.gain(0.9);
    rIn.connect(conv);
    conv.connect(rOut);
    rOut.connect(master);

    this.buses = {
      sfx: this.makeBus(master, rIn, 0.1, 0.3),
      music: this.makeBus(master, rIn, 0.18, 0.42),
    };
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private gain(v: number): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  private makeBus(master: AudioNode, rIn: AudioNode, sendLo: number, sendHi: number): BusNodes {
    const vol = this.gain(1);
    const duck = this.gain(1);
    duck.connect(vol);
    vol.connect(master);
    const sendVol = this.gain(1);
    sendVol.connect(rIn);
    const sLo = this.gain(sendLo);
    const sHi = this.gain(sendHi);
    sLo.connect(sendVol);
    sHi.connect(sendVol);
    const ch: AudioNode[] = [];
    for (const p of PANS) {
      for (let w = 0; w < 2; w++) {
        let n: AudioNode;
        if (this.canPan && p !== 0) {
          const sp = this.track((this.ctx as AudioContext).createStereoPanner());
          sp.pan.value = p;
          n = sp;
        } else n = this.gain(1);
        n.connect(duck);
        n.connect(w ? sHi : sLo);
        ch.push(n);
      }
    }
    return { ch, duck, vol, sendVol, level: 1 };
  }

  now(): number {
    return this.virtualNow != null ? this.virtualNow : this.ctx.currentTime;
  }

  perfToAudio(ms: number): number {
    return ms / 1000 + this.clock.offset;
  }

  audioToPerf(t: number): number {
    return (t - this.clock.offset) * 1000;
  }

  /** Volumes 0..1 (slider position); perceptual curve applied here. */
  setBusLevel(bus: BusName, v: number): void {
    const b = this.buses[bus];
    const lv = v <= 0 ? 0 : Math.min(1, v * v);
    b.level = lv;
    const t = this.now();
    for (const p of [b.vol.gain, b.sendVol.gain]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(lv, t, 0.03);
    }
  }

  busLevel(bus: BusName): number {
    return this.buses[bus].level;
  }

  /** Master fade (visibility changes). */
  fadeMaster(target: number, tau: number): void {
    const t = this.now();
    const p = this.master.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(target, t, tau);
  }

  /** Dip the music under a big moment. */
  duck(t: number, depth: number, hold: number): void {
    const p = this.buses.music.duck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(depth, t, 0.05);
    p.setTargetAtTime(1, t + hold, 0.45);
  }

  get activeVoices(): number {
    this.prune(this.now());
    return this.voices.length;
  }

  /** Voices sounding (or scheduled) at audio time t. */
  voicesAt(t: number): number {
    let n = 0;
    for (const v of this.voices) if (!v.dead && v.start <= t && v.end > t) n++;
    return n;
  }

  private prune(t: number): void {
    if (!this.voices.length) return;
    this.voices = this.voices.filter((v) => !v.dead && v.end > t);
  }

  private kill(v: Voice, t: number, tau: number): void {
    if (v.dead) return;
    try {
      if (v.start >= t) {
        v.src.stop(t);
        v.end = t;
      } else {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setTargetAtTime(0, t, tau);
        const stopAt = t + tau * 7;
        if (stopAt < v.end) {
          v.src.stop(stopAt);
          v.end = stopAt;
        }
      }
    } catch {
      /* already stopped */
    }
  }

  /** Fade out (or cancel, if not started yet) every voice in `group`. */
  release(group: string, t: number, tau = 0.3): void {
    for (const v of this.voices) if (v.group === group && !v.dead && v.end > t) this.kill(v, t, tau);
  }

  /** Cancel voices of `group` that have not started by time t (sounding ones finish). */
  cancelFuture(group: string, t: number): void {
    for (const v of this.voices) if (v.group === group && !v.dead && v.start > t) this.kill(v, t, 0.01);
  }

  /** Release every group starting with `prefix`. */
  releasePrefix(prefix: string, t: number, tau = 0.3): void {
    for (const v of this.voices) if (!v.dead && v.end > t && v.group.lastIndexOf(prefix, 0) === 0) this.kill(v, t, tau);
  }

  private reserve(t: number, sustain: boolean): void {
    this.prune(Math.min(t, this.now()));
    let live = 0;
    for (const v of this.voices) if (v.end > t) live++;
    while (live >= this.maxVoices) {
      // steal: oldest non-sustain voice already sounding; otherwise oldest of any kind
      let pick: Voice | null = null;
      for (const v of this.voices) {
        if (v.dead || v.end <= t) continue;
        if (!pick) { pick = v; continue; }
        const pv = pick.sustain && !sustain ? 1 : 0;
        const vv = v.sustain && !sustain ? 1 : 0;
        if (vv < pv || (vv === pv && v.start < pick.start)) pick = v;
      }
      if (!pick) break;
      this.kill(pick, Math.max(t, pick.start), 0.01);
      pick.dead = true;
      this.stats.voicesStolen++;
      live--;
    }
  }

  /** Play instrument `name` at MIDI `midi` at audio time `t`. Returns false if skipped. */
  play(name: string, midi: number, t: number, o: PlayOpts = {}): boolean {
    const bus = this.buses[o.bus || 'sfx'];
    const gain = (o.gain == null ? 0.5 : o.gain);
    if (bus.level <= 0 || gain <= 0) {
      this.stats.skippedSilent++;
      return false;
    }
    const s = this.bank.get(name, midi);
    if (!s) return false;
    const ctx = this.ctx;
    const now = this.now();
    if (t < now) t = now;
    const rate = s.rate * (o.rate || 1);
    const off0 = o.tail ? s.buf.duration - o.tail * rate : o.offset || 0;
    const off = Math.max(0, Math.min(off0, s.buf.duration - 0.01));
    let dur = (s.buf.duration - off) / rate;
    let fade = 0;
    if (o.maxDur && o.maxDur < dur) {
      dur = o.maxDur;
      fade = Math.min(0.12, dur * 0.35);
    }
    this.reserve(t, !!o.sustain);

    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    const pr = src.playbackRate;
    pr.value = rate;
    let rateEnd = t;
    if (o.slide) {
      pr.setValueAtTime(rate * Math.pow(2, -o.slide / 12), t);
      pr.exponentialRampToValueAtTime(rate, t + 0.09);
      rateEnd = t + 0.09;
    }
    if (o.vib && dur > 0.6) {
      const v0 = Math.max(rateEnd + 0.01, t + 0.22);
      const vlen = Math.min(1.4, t + dur - v0 - 0.05);
      if (vlen > 0.2) {
        const n = Math.max(8, Math.ceil(vlen * 60));
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * vlen;
          const env = Math.min(1, x / 0.35);
          curve[i] = rate * Math.pow(2, (o.vib * env * Math.sin(2 * Math.PI * 4.6 * x)) / 12);
        }
        try {
          pr.setValueCurveAtTime(curve, v0, vlen);
        } catch {
          /* overlapping automation on old engines: skip vibrato */
        }
      }
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    if (fade > 0) {
      g.gain.setValueAtTime(gain, t + dur - fade);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
    let f: BiquadFilterNode | null = null;
    if (o.lp) {
      f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = 0.5;
      src.connect(f);
      f.connect(g);
    } else src.connect(g);
    const pan = (o.pan || 0) + 1;
    g.connect(bus.ch[pan * 2 + (o.wet ? 1 : 0)]);
    src.start(t, off);
    src.stop(t + dur + 0.005);

    const v: Voice = { src, g, f, start: t, end: t + dur + 0.005, group: o.group || '', sustain: !!o.sustain, dead: false };
    this.voices.push(v);
    src.onended = () => {
      v.dead = true;
      try {
        g.disconnect();
        if (f) f.disconnect();
      } catch {
        /* */
      }
    };
    this.stats.voicesCreated++;
    if (v.end > this.lastSoundEnd) this.lastSoundEnd = v.end;
    const live = this.voicesAt(t);
    if (live > this.stats.maxActive) this.stats.maxActive = live;
    return true;
  }

  /** Disconnect the static graph (context is being closed / replaced). */
  dispose(): void {
    for (const v of this.voices) {
      try { v.src.stop(); } catch { /* */ }
    }
    this.voices = [];
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* */ }
    }
    this.nodes = [];
  }
}

function setChannel(b: AudioBuffer, ch: number, data: Float32Array): void {
  if (typeof b.copyToChannel === 'function') b.copyToChannel(data, ch);
  else b.getChannelData(ch).set(data);
}

/** Linear to ±0.7, then a smooth knee that never exceeds 0.89 (-1 dBFS). */
function softClipCurve(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  const knee = 0.7, ceil = 0.89;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

/** AudioBuffer factory bound to a context (falls back for old WebKit). */
export function bufferFactory(ctx: BaseAudioContext): (data: Float32Array, sr: number) => AudioBuffer {
  return (data, sr) => {
    let b: AudioBuffer;
    try {
      b = ctx.createBuffer(1, data.length, sr);
    } catch {
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    }
    setChannel(b, 0, data);
    return b;
  };
}
