/*
 * One-shot sound design. Every pitched SFX is drawn from the current chapter's pentatonic (or the
 * current chord), so effects always sit inside the music. Small random detune / gain / round-robin
 * choices keep repeated sounds from feeling mechanical.
 */
import type { Core, Pan, PlayOpts } from './core.ts';
import { rng } from './dsp.ts';
import { deg, placePc, type Chord, type Palette } from './theory.ts';

export type InkColor = number;

export interface BeatInfo {
  tick: number;
  fills: InkColor[];
  mixes: InkColor[];
  seeds: InkColor[];
  touches: number;
  progress: number;
}

/** Ink colour → pentatonic degree (R root, Y, B …; secondaries in between). */
const COLOR_DEG: Record<number, number> = { 1: 0, 2: 2, 4: 4, 3: 1, 5: 3, 6: 5 };
/** Ink colour → chord-tone slot / octave for board notes. */
const COLOR_SLOT: Record<number, [number, number]> = { 1: [0, 0], 2: [1, 0], 4: [2, 0], 3: [3, 0], 5: [0, 12], 6: [1, 12], 7: [2, -12] };
const COLOR_PAN: Record<number, Pan> = { 1: -1, 2: 0, 4: 1, 3: -1, 5: 1, 6: 0, 7: 0 };

export interface SfxContext {
  pal(): Palette;
  chord(): Chord;
}

export class Sfx {
  private r: () => number;
  private rr = 0;
  private lastDrop = -1;
  private lastDropT = -1;

  constructor(private core: Core, private cx: SfxContext, seed: number) {
    this.r = rng(seed);
  }

  private p(name: string, midi: number, t: number, o: PlayOpts = {}): void {
    o.bus = 'sfx';
    this.core.play(name, midi, t, o);
  }
  /** ±3 cents of random detune. */
  private det(): number {
    return 1 + (this.r() - 0.5) * 0.0035;
  }
  private vg(g: number): number {
    return g * (0.92 + this.r() * 0.16);
  }

  // ---------------------------------------------------------------- UI
  uiTap(t: number): void {
    const P = this.cx.pal();
    const d = [7, 9, 8, 7, 10][this.rr++ % 5];
    this.p('marimba', deg(P, d), t, { gain: this.vg(0.5), rate: this.det(), maxDur: 0.34 });
    this.p('woodHi', 0, t, { gain: 0.09, rate: 1 + (this.r() - 0.5) * 0.06 });
  }

  uiBack(t: number): void {
    const P = this.cx.pal();
    this.p('marimba', deg(P, 7), t, { gain: this.vg(0.4), maxDur: 0.3 });
    this.p('marimba', deg(P, 5), t + 0.065, { gain: this.vg(0.38), maxDur: 0.34 });
    this.p('woodHi', 0, t, { gain: 0.06, rate: 0.85 });
  }

  popupOpen(t: number): void {
    const P = this.cx.pal();
    this.p('swish', 0, t, { gain: 0.32, rate: this.det() });
    this.p('kalimba', deg(P, 7), t + 0.07, { gain: this.vg(0.3), maxDur: 0.9, wet: 1, pan: -1 });
    this.p('kalimba', deg(P, 9), t + 0.14, { gain: this.vg(0.3), maxDur: 1.1, wet: 1, pan: 1 });
  }

  popupClose(t: number): void {
    const P = this.cx.pal();
    this.p('swishDown', 0, t, { gain: 0.3, rate: this.det() });
    this.p('kalimba', deg(P, 6), t + 0.04, { gain: this.vg(0.28), maxDur: 0.7, wet: 1 });
  }

  toggle(on: boolean, t: number): void {
    const P = this.cx.pal();
    if (on) {
      this.p('tok', 0, t, { gain: 0.32, rate: 1.25 });
      this.p('marimba', deg(P, 9), t + 0.045, { gain: 0.36, maxDur: 0.4 });
    } else {
      this.p('tok', 0, t, { gain: 0.3, rate: 0.95 });
      this.p('marimba', deg(P, 5), t + 0.045, { gain: 0.32, maxDur: 0.35, lp: 2500 });
    }
  }

  // ---------------------------------------------------------------- board
  drop(c: InkColor, t: number): void {
    const P = this.cx.pal();
    if (c === 7 || COLOR_DEG[c] == null) {
      // mud: low, muffled plop
      this.p('marimba', deg(P, -3), t, { gain: 0.6, lp: 650, maxDur: 0.5 });
      this.p('plip', deg(P, 0), t, { gain: 0.3, rate: 0.75, lp: 1400 });
      return;
    }
    let d = COLOR_DEG[c] + 5;
    // same colour dropped in quick succession → alternate octave so it doesn't machine-gun
    if (c === this.lastDrop && t - this.lastDropT < 1.2) d += this.rr++ % 2 ? 5 : 0;
    this.lastDrop = c;
    this.lastDropT = t;
    const m = deg(P, d);
    const pan = COLOR_PAN[c] || 0;
    this.p('plip', m + 12, t, { gain: this.vg(0.2), rate: this.det(), pan });
    this.p('kalimba', m, t + 0.012, { gain: this.vg(0.36), rate: this.det(), maxDur: 1.3, pan, wet: 1 });
    if (P.pluck !== 'kalimba') this.p(P.pluck, m - 12, t + 0.012, { gain: this.vg(0.14), maxDur: 0.9, pan });
  }

  reject(t: number): void {
    this.p('tok', 0, t, { gain: 0.4, rate: 0.72, lp: 1500 });
    this.p('tok', 0, t + 0.075, { gain: 0.26, rate: 0.64, lp: 1200 });
  }

  rewind(t: number): void {
    const P = this.cx.pal();
    const c = this.core;
    // reversed chimes swell into the "now", tape-ish downward bend at the end
    const pre = 0.75;
    this.p('bellRev', deg(P, 10), t, { gain: 0.22, tail: pre, wet: 1, pan: -1 });
    this.p('bellRev', deg(P, 12), t + 0.02, { gain: 0.18, tail: pre, wet: 1, pan: 1 });
    this.p('swell', 0, t, { gain: 0.24, tail: pre });
    this.p('kalimba', deg(P, 5), t + pre, { gain: 0.3, maxDur: 0.8, wet: 1 });
    c.duck(t, 0.6, pre + 0.3);
  }

  hint(t: number): void {
    const P = this.cx.pal();
    const ds = [7, 8, 9, 10, 12];
    ds.forEach((d, i) => this.p('bell', deg(P, d), t + i * 0.075, { gain: 0.15 + i * 0.02, wet: 1, pan: ((i % 3) - 1) as Pan, maxDur: 1.8 }));
    this.p('flute', deg(P, 7), t, { gain: 0.14, maxDur: 1.0, wet: 1 });
    this.p('swell', 0, t, { gain: 0.1, tail: 0.4 });
    this.core.duck(t, 0.75, 0.9);
  }

  targetMet(progress: number, t: number): void {
    const P = this.cx.pal();
    const pr = Math.max(0, Math.min(1, progress || 0));
    const d = 7 + Math.round(pr * 7);
    this.p('bell', deg(P, d), t, { gain: this.vg(0.26), wet: 1, maxDur: 1.6, rate: this.det() });
    this.p('coin', deg(P, d + 5), t + 0.035, { gain: 0.07, wet: 1, pan: 1 });
    this.p('kalimba', deg(P, d - 5), t, { gain: 0.16, maxDur: 0.6 });
  }

  wrong(t: number): void {
    const P = this.cx.pal();
    const c = this.core;
    // gentle falling sigh: three soft felt-piano notes over a low tok and a fading pad
    this.p('piano', deg(P, 7), t, { gain: 0.36, maxDur: 1.0, wet: 1 });
    this.p('piano', deg(P, 6), t + 0.17, { gain: 0.32, maxDur: 1.0, wet: 1 });
    this.p('piano', deg(P, 4), t + 0.34, { gain: 0.36, maxDur: 1.6, wet: 1 });
    this.p('piano', deg(P, -1), t + 0.34, { gain: 0.2, maxDur: 1.6, wet: 1 });
    this.p('tok', 0, t, { gain: 0.18, rate: 0.6, lp: 900 });
    this.p('pad', deg(P, 1), t, { gain: 0.06, maxDur: 1.8, wet: 1 });
    c.duck(t, 0.55, 1.4);
  }

  win(perfect: boolean, t: number): void {
    const P = this.cx.pal();
    const c = this.core;
    const n = perfect ? 8 : 6;
    for (let i = 0; i < n; i++) {
      this.p('kalimba', deg(P, 5 + i), t + i * 0.07, { gain: 0.3 + i * 0.012, wet: 1, pan: ((i % 3) - 1) as Pan, maxDur: 1.4 });
    }
    const top = t + n * 0.07;
    this.p('bell', deg(P, 10), top, { gain: 0.28, wet: 1, maxDur: 2.4 });
    this.p('bell', deg(P, 12), top + 0.03, { gain: 0.18, wet: 1, pan: 1, maxDur: 2.4 });
    this.p('marimba', deg(P, 0), t, { gain: 0.32, maxDur: 1.0 });
    this.p('pad', deg(P, 2), t, { gain: 0.07, wet: 1, maxDur: 1.8 });
    this.p('pad', deg(P, 4), t, { gain: 0.06, wet: 1, maxDur: 1.8, pan: 1 });
    this.p('shakerA', 0, t, { gain: 0.08 });
    this.p('shakerB', 0, top, { gain: 0.09 });
    if (perfect) {
      for (let i = 0; i < 8; i++) this.p('gayageum', deg(P, 3 + i), t + 0.02 + i * 0.045, { gain: 0.16, pan: -1, maxDur: 1.2 });
      [12, 14, 15].forEach((d, i) => this.p('bell', deg(P, d), top + 0.22 + i * 0.12, { gain: 0.14, wet: 1, pan: ((i % 3) - 1) as Pan, maxDur: 2 }));
      this.p('coin', deg(P, 15), top + 0.5, { gain: 0.09, wet: 1 });
      this.p('gong', deg(P, -5), t, { gain: 0.12, wet: 1, maxDur: 2.6 });
    }
    c.duck(t, 0.5, perfect ? 2.0 : 1.4);
  }

  stamp(t: number): void {
    this.p('thud', 0, t, { gain: 0.6 });
    this.p('woodLo', 0, t, { gain: 0.28, rate: 0.78 });
    this.p('paper', 0, t + 0.004, { gain: 0.34, rate: this.det() });
    this.core.duck(t, 0.75, 0.35);
  }

  coins(count: number, t: number): void {
    const P = this.cx.pal();
    const n = Math.max(1, Math.min(14, Math.round(2 + Math.log2(Math.max(1, count)) * 2.2)));
    const total = Math.min(1.2, 0.085 * n);
    const gap = n > 1 ? total / n : 0;
    for (let i = 0; i < n; i++) {
      const at = t + i * gap * (1 - i * 0.012);
      this.p('coin', deg(P, 10 + (i % 5) + Math.floor(i / 5)), at, { gain: this.vg(0.15 + 0.06 * (i / n)), pan: (i % 2 ? -1 : 1) as Pan });
    }
    this.p('bell', deg(P, 12), t + total + 0.02, { gain: 0.22, wet: 1, maxDur: 1.4 });
    this.p('kalimba', deg(P, 7), t + total + 0.02, { gain: 0.18, maxDur: 0.8 });
  }

  reward(t: number): void {
    const P = this.cx.pal();
    const c = this.core;
    const hit = t + 0.5;
    this.p('swell', 0, t, { gain: 0.26, tail: 0.5 });
    this.p('woodLo', 0, hit, { gain: 0.22, rate: 0.85 });
    [10, 12, 14].forEach((d, i) => this.p('bell', deg(P, d), hit + i * 0.02, { gain: 0.2 - i * 0.03, wet: 1, pan: ((i % 3) - 1) as Pan, maxDur: 2.2 }));
    [7, 8, 9, 10].forEach((d, i) => this.p('kalimba', deg(P, d + 5), hit + 0.12 + i * 0.06, { gain: 0.2, wet: 1, maxDur: 1, pan: (i % 2 ? 1 : -1) as Pan }));
    this.p('pad', deg(P, 0), hit, { gain: 0.07, wet: 1, maxDur: 1.6 });
    this.p('shakerA', 0, hit, { gain: 0.08 });
    c.duck(t, 0.55, 1.6);
  }

  purchase(t: number): void {
    const P = this.cx.pal();
    this.p('coin', deg(P, 12), t, { gain: 0.2 });
    this.p('bell', deg(P, 9), t + 0.05, { gain: 0.26, wet: 1, maxDur: 1.2 });
    this.p('bell', deg(P, 12), t + 0.17, { gain: 0.28, wet: 1, maxDur: 1.6 });
    this.p('marimba', deg(P, 0), t + 0.05, { gain: 0.28, maxDur: 0.8 });
    this.core.duck(t, 0.65, 0.9);
  }

  chapterComplete(t: number): void {
    const P = this.cx.pal();
    const c = this.core;
    this.p('gong', deg(P, -5), t, { gain: 0.3, wet: 1 });
    [0, 2, 4].forEach((d, i) => this.p('pad', deg(P, d), t, { gain: 0.08, wet: 1, maxDur: 3.4, pan: ((i % 3) - 1) as Pan }));
    for (let i = 0; i < 10; i++) this.p('gayageum', deg(P, i), t + 0.15 + i * 0.05, { gain: 0.2, pan: -1, maxDur: 1.6 });
    [7, 8, 10].forEach((d, i) => this.p('flute', deg(P, d), t + 0.85 + i * 0.36, { gain: 0.2, wet: 1, maxDur: i === 2 ? 1.6 : 0.5 }));
    const sp = t + 1.95;
    [10, 12, 13, 14, 15].forEach((d, i) => this.p('bell', deg(P, d), sp + i * 0.08, { gain: 0.16, wet: 1, pan: ((i % 3) - 1) as Pan, maxDur: 2 }));
    this.p('kalimba', deg(P, 5), sp, { gain: 0.26, wet: 1, maxDur: 1.4 });
    this.p('marimba', deg(P, 0), sp, { gain: 0.26, maxDur: 1.2 });
    this.p('coin', deg(P, 17), sp + 0.45, { gain: 0.08, wet: 1 });
    c.duck(t, 0.3, 3.2);
  }

  streak(t: number): void {
    const P = this.cx.pal();
    [5, 7, 9].forEach((d, i) => this.p('kalimba', deg(P, d), t + i * 0.08, { gain: 0.32, wet: 1, maxDur: 0.9, pan: ((i % 3) - 1) as Pan }));
    this.p('bell', deg(P, 10), t + 0.24, { gain: 0.24, wet: 1, maxDur: 1.4 });
    this.p('coin', deg(P, 14), t + 0.26, { gain: 0.07 });
    this.core.duck(t, 0.7, 0.7);
  }

  unlock(t: number): void {
    const P = this.cx.pal();
    const pre = 0.45;
    this.p('bellRev', deg(P, 7), t, { gain: 0.2, tail: pre, wet: 1 });
    this.p('bell', deg(P, 8), t + pre, { gain: 0.26, wet: 1, maxDur: 1.8 });
    this.p('bell', deg(P, 10), t + pre + 0.09, { gain: 0.22, wet: 1, maxDur: 1.8, pan: 1 });
    this.p('kalimba', deg(P, 5), t + pre, { gain: 0.24, maxDur: 0.9 });
    this.p('plip', deg(P, 12), t + pre, { gain: 0.1 });
    this.core.duck(t, 0.65, 1.0);
  }

  // ---------------------------------------------------------------- beat sonification
  beat(info: BeatInfo, t: number): void {
    const P = this.cx.pal();
    const ch = this.cx.chord();
    const pr = Math.max(0, Math.min(1, info.progress || 0));
    const vel = 0.55 + 0.45 * pr;
    let budget = 4;
    const uniq = (a: InkColor[] | undefined): InkColor[] => {
      const o: InkColor[] = [];
      if (a) for (const c of a) if (o.indexOf(c) < 0) o.push(c);
      return o;
    };
    const tone = (c: InkColor, base: number): number => {
      const [slot, oct] = COLOR_SLOT[c] || [0, 0];
      const pc = ch.t[slot % ch.t.length];
      return placePc(P, pc, base) + oct;
    };
    const mixes = uniq(info.mixes);
    if (mixes.length) {
      this.p('bell', tone(mixes[0], P.key + 19), t, { gain: (0.12 + 0.08 * pr) * vel, wet: 1, maxDur: 1.8, pan: COLOR_PAN[mixes[0]] || 0 });
      budget--;
      if (mixes.length > 1) {
        this.p('bell', tone(mixes[1], P.key + 19), t + 0.035, { gain: 0.08 * vel, wet: 1, maxDur: 1.5, pan: COLOR_PAN[mixes[1]] || 0 });
        budget--;
      }
    }
    const seeds = uniq(info.seeds);
    if (seeds.length && budget >= 2) {
      const m = tone(seeds[0], P.key + 12);
      this.p('kalimba', m - 2, t, { gain: 0.1 * vel, maxDur: 0.25 });
      this.p('kalimba', m, t + 0.055, { gain: 0.2 * vel, maxDur: 1, wet: 1 });
      budget -= 2;
    }
    const fills = uniq(info.fills);
    const pluckG = P.pluck === 'gayageum' ? 0.2 : P.pluck === 'marimba' ? 0.19 : 0.17;
    for (const c of fills) {
      if (budget <= (info.touches > 0 ? 1 : 0)) break;
      this.p(P.pluck, tone(c, P.key + 5), t, { gain: pluckG * vel * (0.9 + this.r() * 0.2), maxDur: 1.1, pan: COLOR_PAN[c] || 0, rate: this.det() });
      budget--;
    }
    if (info.touches > 0 && budget > 0) {
      this.p('tok', 0, t, { gain: (0.12 + 0.06 * pr), rate: 1.1 + (info.tick % 2) * 0.08 });
    }
  }
}
