/*
 * Sample bank: renders instrument notes once (pure JS, see dsp.ts) and hands out AudioBuffers plus
 * the playbackRate needed for the requested pitch. Rendering happens lazily (synchronously the
 * first time a sound is needed) and in small background slices so the first tap never waits for
 * the whole bank. Buffers are context-independent and survive an AudioContext re-creation.
 */
import * as D from './dsp.ts';

type Gen = (sr: number, midi: number) => Float32Array;
/** hi = context rate (bright), mid = 32 kHz (plucks), lo = 22.05 kHz (pads, bass, textures). */
type Quality = 'hi' | 'mid' | 'lo';

interface InstDef {
  gen: Gen;
  /** MIDI notes that get their own rendering; others are pitched from the nearest root. null = unpitched. */
  roots: number[] | null;
  q: Quality;
}

const rev = (g: Gen, m: number): Gen => (sr) => D.reverse(g(sr, m));

export const INSTRUMENTS: Record<string, InstDef> = {
  kalimba: { gen: D.kalimba, roots: [55, 62, 69, 76, 83, 90], q: 'mid' },
  marimba: { gen: D.marimba, roots: [43, 50, 57, 64, 71, 78, 85], q: 'mid' },
  piano: { gen: D.piano, roots: [45, 52, 59, 66, 73, 80], q: 'mid' },
  bell: { gen: D.bell, roots: [72, 79, 86, 93], q: 'hi' },
  gong: { gen: D.gong, roots: [41], q: 'lo' },
  gayageum: { gen: D.gayageum, roots: [50, 57, 64, 71, 78, 85], q: 'mid' },
  flute: { gen: D.flute, roots: [64, 71, 78, 85], q: 'lo' },
  pad: { gen: D.pad, roots: [50, 57, 64, 71], q: 'lo' },
  sub: { gen: D.sub, roots: [33, 42], q: 'lo' },
  plip: { gen: D.plip, roots: [74, 86], q: 'hi' },
  coin: { gen: D.coin, roots: [93], q: 'hi' },
  bellRev: { gen: rev(D.bell, 79), roots: [79], q: 'hi' },
  woodHi: { gen: D.woodHi, roots: null, q: 'hi' },
  woodLo: { gen: D.woodLo, roots: null, q: 'mid' },
  tok: { gen: D.tok, roots: null, q: 'mid' },
  shakerA: { gen: D.shakerA, roots: null, q: 'hi' },
  shakerB: { gen: D.shakerB, roots: null, q: 'hi' },
  brush: { gen: D.brush, roots: null, q: 'mid' },
  paper: { gen: D.paper, roots: null, q: 'hi' },
  thud: { gen: D.thud, roots: null, q: 'lo' },
  swish: { gen: D.swish, roots: null, q: 'hi' },
  swishDown: { gen: (sr) => D.reverse(D.swish(sr)), roots: null, q: 'hi' },
  swell: { gen: D.swell, roots: null, q: 'hi' },
  air: { gen: D.air, roots: null, q: 'lo' },
};

export type InstName = keyof typeof INSTRUMENTS;

export interface Sample {
  buf: AudioBuffer;
  rate: number;
}

export type BufferFactory = (data: Float32Array, sampleRate: number) => AudioBuffer;

export class Bank {
  private bufs = new Map<string, AudioBuffer>();
  private queue: string[] = [];
  /** Total ms spent synthesising (for diagnostics / the harness). */
  renderMs = 0;
  renderedSamples = 0;
  private hiRate: number;

  constructor(ctxRate: number, private make: BufferFactory) {
    this.hiRate = Math.min(48000, Math.max(22050, ctxRate || 44100));
  }

  /** Point a re-created context at the same bank (buffers are reusable across contexts). */
  setFactory(make: BufferFactory): void {
    this.make = make;
  }

  private rateOf(q: Quality): number {
    return q === 'hi' ? this.hiRate : q === 'mid' ? Math.min(this.hiRate, 32000) : 22050;
  }

  private nearestRoot(def: InstDef, midi: number): number {
    const roots = def.roots;
    if (!roots) return 0;
    let best = roots[0];
    for (const r of roots) if (Math.abs(r - midi) < Math.abs(best - midi)) best = r;
    return best;
  }

  private render(name: string, root: number): AudioBuffer {
    const key = name + ':' + root;
    let b = this.bufs.get(key);
    if (b) return b;
    const def = INSTRUMENTS[name];
    const sr = this.rateOf(def.q);
    const t0 = now();
    const data = def.gen(sr, root);
    this.renderMs += now() - t0;
    this.renderedSamples += data.length;
    b = this.make(data, sr);
    this.bufs.set(key, b);
    return b;
  }

  /** Buffer + playbackRate for `midi` (ignored for unpitched instruments). */
  get(name: string, midi = 60): Sample | null {
    const def = INSTRUMENTS[name];
    if (!def) return null;
    const root = this.nearestRoot(def, midi);
    const buf = this.render(name, root);
    return { buf, rate: def.roots ? Math.pow(2, (midi - root) / 12) : 1 };
  }

  has(name: string, midi = 60): boolean {
    const def = INSTRUMENTS[name];
    return !!def && this.bufs.has(name + ':' + this.nearestRoot(def, midi));
  }

  /** Queue background rendering; names earlier in the list render first. */
  prefetch(names: string[]): void {
    for (const n of names) {
      const def = INSTRUMENTS[n];
      if (!def) continue;
      for (const r of def.roots || [0]) {
        const k = n + ':' + r;
        if (!this.bufs.has(k) && this.queue.indexOf(k) < 0) this.queue.push(k);
      }
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Render queued notes for up to `budgetMs`. Returns true when the queue is empty. */
  step(budgetMs: number): boolean {
    const t0 = now();
    while (this.queue.length) {
      const k = this.queue.shift() as string;
      const i = k.lastIndexOf(':');
      this.render(k.slice(0, i), +k.slice(i + 1));
      if (now() - t0 >= budgetMs) break;
    }
    return this.queue.length === 0;
  }

  get count(): number {
    return this.bufs.size;
  }

  static allNames(): string[] {
    return Object.keys(INSTRUMENTS);
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
