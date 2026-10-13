/*
 * Sample bank: renders instrument notes once (pure JS, see dsp.ts) and hands out AudioBuffers plus
 * the playbackRate needed for the requested pitch. Rendering happens lazily (synchronously the
 * first time a sound is needed) and in small background slices so the first tap never waits for
 * the whole bank. Buffers are context-independent and survive an AudioContext re-creation.
 */
import * as D from './dsp.ts';

/** Renders one note. `raw` gives access to other (already rendered) instruments for derived sounds. */
type Gen = (sr: number, midi: number, raw: (name: string, midi: number) => Float32Array) => D.Job | Float32Array;
/** hi = context rate (bright), mid = 32 kHz (plucks/bells), lo = 22.05 kHz (pads, bass, textures). */
type Quality = 'hi' | 'mid' | 'lo';

interface InstDef {
  gen: Gen;
  /** MIDI notes that get their own rendering; others are pitched from the nearest root. null = unpitched. */
  roots: number[] | null;
  q: Quality;
  /** Seamless loop: the voice supplies the envelope. */
  loop?: boolean;
}

export const INSTRUMENTS: Record<string, InstDef> = {
  kalimba: { gen: D.kalimba, roots: [57, 64, 71, 78, 85], q: 'mid' },
  marimba: { gen: D.marimba, roots: [43, 51, 59, 67, 75, 83], q: 'mid' },
  piano: { gen: D.piano, roots: [48, 56, 64, 72, 80], q: 'mid' },
  bell: { gen: D.bell, roots: [74, 81, 88], q: 'mid' },
  gong: { gen: D.gong, roots: [41], q: 'lo' },
  gayageum: { gen: D.gayageum, roots: [52, 61, 70, 79], q: 'mid' },
  flute: { gen: D.flute, roots: [66, 75, 84], q: 'lo' },
  pad: { gen: D.pad, roots: [50, 58, 66], q: 'lo', loop: true },
  sub: { gen: D.sub, roots: [33, 41], q: 'lo', loop: true },
  plip: { gen: D.plip, roots: [74, 84, 94], q: 'hi' },
  coin: { gen: D.coin, roots: [93], q: 'hi' },
  // reversed chime: derived from the rendered bell (first second, reversed) — no extra synthesis
  bellRev: { gen: (sr, _m, raw) => D.reverse(raw('bell', 81).slice(0, Math.floor(sr * 1.0))), roots: [81], q: 'mid' },
  woodHi: { gen: D.woodHi, roots: null, q: 'hi' },
  woodLo: { gen: D.woodLo, roots: null, q: 'mid' },
  tok: { gen: D.tok, roots: null, q: 'mid' },
  shakerA: { gen: D.shakerA, roots: null, q: 'hi' },
  shakerB: { gen: D.shakerB, roots: null, q: 'hi' },
  brush: { gen: D.brush, roots: null, q: 'mid' },
  paper: { gen: D.paper, roots: null, q: 'hi' },
  thud: { gen: D.thud, roots: null, q: 'lo' },
  swish: { gen: D.swish, roots: null, q: 'hi' },
  swishDown: { gen: (sr, _m, raw) => D.reverse(raw('swish', 0)), roots: null, q: 'hi' },
  swell: { gen: D.swell, roots: null, q: 'hi' },
  air: { gen: D.air, roots: null, q: 'lo' },
};

export type InstName = keyof typeof INSTRUMENTS;

export interface Sample {
  buf: AudioBuffer;
  rate: number;
  loop: boolean;
}

export type BufferFactory = (data: Float32Array, sampleRate: number) => AudioBuffer;

export class Bank {
  private bufs = new Map<string, AudioBuffer>();
  private queue: string[] = [];
  /** Background job in progress (resumable generator). */
  private job: { key: string; sr: number; it: D.Job } | null = null;
  /** Longest single uninterrupted slice of synthesis work (ms) — jank indicator. */
  maxSliceMs = 0;
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

  private store(key: string, data: Float32Array, sr: number): AudioBuffer {
    this.renderedSamples += data.length;
    const b = this.make(data, sr);
    this.bufs.set(key, b);
    return b;
  }

  /** Synchronous render (a sound is needed right now). Finishes an in-flight job for the same note. */
  private render(name: string, root: number): AudioBuffer {
    const key = name + ':' + root;
    const b = this.bufs.get(key);
    if (b) return b;
    const def = INSTRUMENTS[name];
    const t0 = now();
    let data: Float32Array;
    let sr: number;
    if (this.job && this.job.key === key) {
      sr = this.job.sr;
      const it = this.job.it;
      this.job = null;
      data = D.drain(it);
    } else {
      sr = this.rateOf(def.q);
      data = D.drain(def.gen(sr, root, this.raw));
    }
    const dt = now() - t0;
    this.renderMs += dt;
    if (dt > this.maxSliceMs) this.maxSliceMs = dt;
    const qi = this.queue.indexOf(key);
    if (qi >= 0) this.queue.splice(qi, 1);
    return this.store(key, data, sr);
  }

  private raw = (name: string, midi: number): Float32Array => {
    const t0 = now();
    const b = this.get(name, midi);
    this.renderMs -= now() - t0; // counted by the nested render already
    return b ? b.buf.getChannelData(0) : new Float32Array(1);
  };

  /** Buffer + playbackRate for `midi` (ignored for unpitched instruments). */
  get(name: string, midi = 60): Sample | null {
    const def = INSTRUMENTS[name];
    if (!def) return null;
    const root = this.nearestRoot(def, midi);
    const buf = this.render(name, root);
    return { buf, rate: def.roots ? Math.pow(2, (midi - root) / 12) : 1, loop: !!def.loop };
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
    return this.queue.length + (this.job ? 1 : 0);
  }

  /**
   * Background rendering for about `budgetMs`: advances resumable jobs in small steps (each a few
   * thousand samples or one partial), so a slice never blocks the main thread for long.
   */
  step(budgetMs: number): boolean {
    const t0 = now();
    let last = t0;
    while (now() - t0 < budgetMs) {
      if (!this.job) {
        const k = this.queue.shift();
        if (k == null) break;
        if (this.bufs.has(k)) continue;
        const i = k.lastIndexOf(':');
        const name = k.slice(0, i);
        const def = INSTRUMENTS[name];
        const sr = this.rateOf(def.q);
        const g = def.gen(sr, +k.slice(i + 1), this.raw);
        if (g instanceof Float32Array) {
          this.store(k, g, sr);
          continue;
        }
        this.job = { key: k, sr, it: g };
      }
      const j = this.job;
      const r = j.it.next();
      if (r.done) {
        this.job = null;
        this.store(j.key, r.value, j.sr);
      }
      const n = now();
      if (n - last > this.maxSliceMs) this.maxSliceMs = n - last;
      last = n;
    }
    this.renderMs += now() - t0;
    return this.pending === 0;
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
