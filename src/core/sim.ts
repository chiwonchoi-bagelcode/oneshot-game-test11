/*
 * Inkbloom — deterministic ink simulation (shared by the game, the level tools and the tests).
 *
 * Rules
 *  - Tapping an empty paper cell drops the next ink from the queue. The cell is coloured at once.
 *  - Every beat each ink front spreads one cell up/down/left/right into empty paper.
 *  - Two (or three) different inks that reach the SAME empty cell on the SAME beat mix there.
 *    Mixed cells are set: they never spread.
 *  - A cell that already has ink never changes. Fronts that hit it simply stop.
 *  - Walls block. Gates let only their own colour through. Slow paper holds ink for one extra
 *    beat before it spreads on. Sleeping seeds wake when a front reaches them and spread their
 *    own colour from the next beat.
 *  - An ink with a range (e.g. "Y3") spreads at most that many cells from where it was dropped.
 *
 * Colours are bit flags so mixing is a bitwise OR: R=1 Y=2 B=4, O=3 P=5 G=6, K(mud)=7.
 * NOTE: keep this file free of TS-only runtime features (enums, parameter properties) so that
 * Node can run it with --experimental-strip-types.
 */

export const R = 1;
export const Y = 2;
export const B = 4;
export const O = R | Y; // 3
export const P = R | B; // 5
export const G = Y | B; // 6
export const K = 7;
/** Goal code for "keep this cell clean". */
export const WHITE = 8;

export type ColorCode = number;
export type ColorChar = 'R' | 'Y' | 'B' | 'O' | 'P' | 'G' | 'K';

export const CODE_TO_CHAR: Record<number, ColorChar> = { 1: 'R', 2: 'Y', 3: 'O', 4: 'B', 5: 'P', 6: 'G', 7: 'K' };
export const CHAR_TO_CODE: Record<string, number> = { R: 1, Y: 2, O: 3, B: 4, P: 5, G: 6, K: 7 };

export function isPrimary(c: number): boolean {
  return c === R || c === Y || c === B;
}

/** Original-core mechanics; the comparison cores add their own keys (plain strings). */
export type OrigMechanic =
  | 'drop' | 'walls' | 'order' | 'mix' | 'timing' | 'parity' | 'three'
  | 'range' | 'white' | 'seed' | 'gate' | 'slow';
export type MechanicKey = OrigMechanic | (string & {});

/**
 * A move of a solution. t = beat (timing cores; 0 elsewhere).
 * k = index of the ink used (tray ink, well…) when the core lets the player choose; c = colour bit
 * for cores where a move is "pour colour c here" (colouring book).
 */
export interface Drop { x: number; y: number; t: number; k?: number; c?: number }

/** A fixed ink well (core D): the only cells that can release ink. */
export interface Well { x: number; y: number; ink: string }

export interface LevelDef {
  id: string;
  /** Terrain rows. '.' paper  '#' wall  ' ' outside the canvas (lets boards take a shape)
   *  '~' slow paper  'r' 'y' 'b' sleeping seed  'R' 'Y' 'B' colour gate */
  map: string[];
  /** Goal rows. '.' anything  'R' 'Y' 'B' 'O' 'P' 'G' target colour  'w' must stay clean */
  goal: string[];
  /** Ink queue in drop order. 'R' = unlimited spread, 'R3' = spreads at most 3 cells. */
  inks: string[];
  /** A verified solution. t = beat of the drop (first drop is always t=0). */
  solution: Drop[];
  /** Beat length override in ms. */
  tempo?: number;
  /** Mechanic introduced by this level (shows the intro card once). */
  intro?: MechanicKey;
  /** Tutorial level: the solution is shown step by step for free. */
  guided?: boolean;
  /** Pacing tag used by the map and the result screen. */
  tag?: 'light' | 'think' | 'discovery' | 'boss';
  /** Analyzer difficulty score 0..100 (informational). */
  diff?: number;
  /** Core D: ink wells (the only places ink can be released). */
  wells?: Well[];
  /** Core C: picture regions, one letter per cell (same letter = same region; '.' none). */
  regions?: string[];
  /** Core B: solution strokes, each a list of cells starting at its source. */
  strokes?: { x: number; y: number }[][];
  /** Allows 'K' (all three colours) as a goal colour (core C: brown). */
  mud?: boolean;
  /** Short coach line shown at the start (i18n key). */
  coach?: string;
}

export interface InkSpec { c: number; range: number }

export interface ParsedLevel {
  def: LevelDef;
  w: number;
  h: number;
  /** 1 for walls and for cells outside the canvas. */
  wall: Uint8Array;
  /** 1 for cells outside the canvas (not drawn). */
  hole: Uint8Array;
  slow: Uint8Array;
  gate: Uint8Array;
  seed: Uint8Array;
  goal: Uint8Array;
  inks: InkSpec[];
  targets: number[]; // goal cells with a colour
  whites: number[];  // goal cells that must stay clean
}

export function parseInk(s: string): InkSpec {
  const m = /^([RYB])(\d*)$/.exec(String(s).trim());
  if (!m) throw new Error('bad ink spec: ' + s);
  return { c: CHAR_TO_CODE[m[1]], range: m[2] ? parseInt(m[2], 10) : Infinity };
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const h = def.map.length;
  const w = def.map[0].length;
  if (def.goal.length !== h) throw new Error(def.id + ': goal height mismatch');
  const n = w * h;
  const wall = new Uint8Array(n), hole = new Uint8Array(n), slow = new Uint8Array(n), gate = new Uint8Array(n), seed = new Uint8Array(n), goal = new Uint8Array(n);
  const targets: number[] = [], whites: number[] = [];
  for (let y = 0; y < h; y++) {
    const row = def.map[y], grow = def.goal[y];
    if (row.length !== w || grow.length !== w) throw new Error(def.id + ': row length mismatch at ' + y);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, ch = row[x], g = grow[x];
      switch (ch) {
        case '.': break;
        case '#': wall[i] = 1; break;
        case ' ': wall[i] = 1; hole[i] = 1; break;
        case '~': slow[i] = 1; break;
        case 'r': seed[i] = R; break;
        case 'y': seed[i] = Y; break;
        case 'b': seed[i] = B; break;
        case 'R': gate[i] = R; break;
        case 'Y': gate[i] = Y; break;
        case 'B': gate[i] = B; break;
        default: throw new Error(def.id + ': unknown map char "' + ch + '"');
      }
      if (g === '.') continue;
      if (g === 'w') { whites.push(i); goal[i] = WHITE; continue; }
      const code = CHAR_TO_CODE[g];
      if (!code || (code === K && !def.mud)) throw new Error(def.id + ': unknown goal char "' + g + '"');
      if (wall[i]) throw new Error(def.id + ': goal on a wall');
      goal[i] = code;
      targets.push(i);
    }
  }
  return { def, w, h, wall, hole, slow, gate, seed, goal, inks: def.inks.map(parseInk), targets, whites };
}

/** How a cell got its ink (for rendering and sound). */
export const SRC_DROP = 1, SRC_SPREAD = 2, SRC_SEED = 3, SRC_MIX = 4;

export type SimEvent =
  | { type: 'drop'; idx: number; c: number }
  | { type: 'fill'; idx: number; c: number; from: number }
  | { type: 'mix'; idx: number; c: number; parts: number }
  | { type: 'seed'; idx: number; c: number }
  | { type: 'touch'; a: number; b: number };

interface Front { idx: number; d: number; wait: number }
interface Wave { c: number; range: number; front: Front[] }

export type DropBlock = null | 'outside' | 'wall' | 'seed' | 'gate' | 'inked' | 'white' | 'noink';

export class Sim {
  readonly L: ParsedLevel;
  readonly w: number;
  readonly h: number;
  ink: Uint8Array;
  mixed: Uint8Array;
  born: Int16Array;
  /** Neighbour index the ink came from (-1 for drops, seeds and mixes). */
  from: Int32Array;
  src: Uint8Array;
  seed: Uint8Array;
  waves: Wave[];
  tick: number;
  pi: number;
  /** Drops made so far (for hints, replays and analytics). */
  drops: Drop[];
  lastEvents: SimEvent[];

  constructor(level: ParsedLevel | LevelDef) {
    const L = (level as ParsedLevel).wall ? (level as ParsedLevel) : parseLevel(level as LevelDef);
    this.L = L;
    this.w = L.w;
    this.h = L.h;
    const n = L.w * L.h;
    this.ink = new Uint8Array(n);
    this.mixed = new Uint8Array(n);
    this.born = new Int16Array(n);
    this.from = new Int32Array(n).fill(-1);
    this.src = new Uint8Array(n);
    this.seed = L.seed.slice();
    this.waves = [];
    this.tick = 0;
    this.pi = 0;
    this.drops = [];
    this.lastEvents = [];
  }

  clone(): Sim {
    const s = Object.create(Sim.prototype) as Sim;
    (s as { L: ParsedLevel }).L = this.L;
    (s as { w: number }).w = this.w;
    (s as { h: number }).h = this.h;
    s.ink = this.ink.slice();
    s.mixed = this.mixed.slice();
    s.born = this.born.slice();
    s.from = this.from.slice();
    s.src = this.src.slice();
    s.seed = this.seed.slice();
    s.waves = this.waves.map((wv) => ({ c: wv.c, range: wv.range, front: wv.front.map((f) => ({ idx: f.idx, d: f.d, wait: f.wait })) }));
    s.tick = this.tick;
    s.pi = this.pi;
    s.drops = this.drops.slice();
    s.lastEvents = [];
    return s;
  }

  idx(x: number, y: number): number { return y * this.w + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  nextInk(): InkSpec | null { return this.pi < this.L.inks.length ? this.L.inks[this.pi] : null; }
  inksLeft(): number { return this.L.inks.length - this.pi; }
  started(): boolean { return this.pi > 0; }
  /** No ink front can change the board any more. */
  settled(): boolean { return this.waves.length === 0; }

  dropBlock(idx: number): DropBlock {
    if (idx < 0 || idx >= this.ink.length) return 'outside';
    if (this.L.wall[idx]) return 'wall';
    if (this.seed[idx]) return 'seed';
    if (this.L.gate[idx]) return 'gate';
    if (this.ink[idx]) return 'inked';
    if (this.L.goal[idx] === WHITE) return 'white';
    if (this.pi >= this.L.inks.length) return 'noink';
    return null;
  }

  canDrop(idx: number): boolean { return this.dropBlock(idx) === null; }

  /**
   * Drops the next queued ink at idx. A core that lets the player pick the ink (wells) passes
   * `spec` (and its index `k`); the queue position still advances so inksLeft() counts drops.
   */
  drop(idx: number, spec?: InkSpec, k?: number): boolean {
    if (!this.canDrop(idx)) return false;
    const ink = spec || this.L.inks[this.pi];
    this.pi++;
    this.ink[idx] = ink.c;
    this.born[idx] = this.tick;
    this.from[idx] = -1;
    this.src[idx] = SRC_DROP;
    const x = idx % this.w;
    this.drops.push(k === undefined ? { x, y: (idx - x) / this.w, t: this.tick } : { x, y: (idx - x) / this.w, t: this.tick, k });
    const f: Front = { idx, d: 0, wait: this.L.slow[idx] ? 1 : 0 };
    if (f.wait || this.canGrow(f, ink.c, ink.range)) this.waves.push({ c: ink.c, range: ink.range, front: [f] });
    this.lastEvents = [{ type: 'drop', idx, c: ink.c }];
    return true;
  }

  private neighbors(idx: number, out: number[]): number {
    const w = this.w, x = idx % w;
    let k = 0;
    if (idx >= w) out[k++] = idx - w;
    if (x < w - 1) out[k++] = idx + 1;
    if (idx + w < this.ink.length) out[k++] = idx + w;
    if (x > 0) out[k++] = idx - 1;
    return k;
  }

  /** True if this front item could still claim or wake something. */
  private canGrow(f: Front, c: number, range: number): boolean {
    if (f.d >= range) return false;
    const nb = NB;
    const k = this.neighbors(f.idx, nb);
    for (let j = 0; j < k; j++) {
      const n = nb[j];
      if (this.L.wall[n]) continue;
      if (this.seed[n]) return true;
      if (this.ink[n]) continue;
      const g = this.L.gate[n];
      if (g && g !== c) continue;
      return true;
    }
    return false;
  }

  /** Advance one beat. Returns the events of this beat. */
  step(): SimEvent[] {
    const events: SimEvent[] = [];
    const tNext = this.tick + 1;
    const n0 = this.ink.length;
    if (CLAIM_BITS.length < n0) { CLAIM_BITS = new Uint8Array(n0 * 2); CLAIM_FROM = new Int32Array(n0 * 2); }
    const claimBits = CLAIM_BITS, claimFirst = CLAIM_FROM;
    const claimed: number[] = [];
    // Parallel lists, one entry per (wave, target) claim.
    const cT: number[] = [], cW: number[] = [], cD: number[] = [];
    const wake: number[] = [];
    const nb = NB2;
    const wall = this.L.wall, gate = this.L.gate, ink = this.ink, seed = this.seed;

    for (let wi = 0; wi < this.waves.length; wi++) {
      const wv = this.waves[wi];
      for (const f of wv.front) {
        if (f.wait > 0 || f.d >= wv.range) continue;
        const k = this.neighbors(f.idx, nb);
        for (let j = 0; j < k; j++) {
          const n = nb[j];
          if (wall[n]) continue;
          if (seed[n]) { if (wake.indexOf(n) < 0) wake.push(n); continue; }
          if (ink[n]) continue;
          const g = gate[n];
          if (g && g !== wv.c) continue;
          if (!claimBits[n]) { claimed.push(n); claimFirst[n] = f.idx; }
          claimBits[n] |= wv.c;
          cT.push(n); cW.push(wi); cD.push(f.d + 1);
        }
      }
    }

    // Items still soaking on slow paper stay where they are.
    const nextFront: Front[][] = [];
    for (let wi = 0; wi < this.waves.length; wi++) {
      const list: Front[] = [];
      for (const f of this.waves[wi].front) if (f.wait > 0) list.push({ idx: f.idx, d: f.d, wait: f.wait - 1 });
      nextFront.push(list);
    }

    // Resolve claims: one colour fills, several colours mix.
    for (const n of claimed) {
      const bits = claimBits[n];
      claimBits[n] = 0;
      this.born[n] = tNext;
      ink[n] = bits;
      if (isPrimary(bits)) {
        this.from[n] = claimFirst[n];
        this.src[n] = SRC_SPREAD;
        events.push({ type: 'fill', idx: n, c: bits, from: claimFirst[n] });
      } else {
        this.mixed[n] = 1;
        this.from[n] = -1;
        this.src[n] = SRC_MIX;
        events.push({ type: 'mix', idx: n, c: bits, parts: bits });
      }
    }
    // Two plain inks that arrived side by side on this beat met on an edge: they touch, no mix.
    for (const n of claimed) {
      if (this.mixed[n]) continue;
      const k = this.neighbors(n, nb);
      for (let j = 0; j < k; j++) {
        const m = nb[j];
        if (m > n && ink[m] && ink[m] !== ink[n] && !this.mixed[m] && this.born[m] === tNext && this.src[m] === SRC_SPREAD) {
          events.push({ type: 'touch', a: n, b: m });
        }
      }
    }
    for (let q = 0; q < cT.length; q++) {
      const n = cT[q];
      if (this.mixed[n]) continue;
      const list = nextFront[cW[q]];
      let dup = false;
      for (let e = 0; e < list.length; e++) if (list[e].idx === n) { dup = true; break; }
      if (!dup) list.push({ idx: n, d: cD[q], wait: this.L.slow[n] ? 1 : 0 });
    }

    // Wake seeds (they start spreading on the next beat).
    const newWaves: Wave[] = [];
    for (const s of wake) {
      const c = seed[s];
      seed[s] = 0;
      ink[s] = c;
      this.born[s] = tNext;
      this.from[s] = -1;
      this.src[s] = SRC_SEED;
      events.push({ type: 'seed', idx: s, c });
      newWaves.push({ c, range: Infinity, front: [{ idx: s, d: 0, wait: this.L.slow[s] ? 1 : 0 }] });
    }

    // Keep only fronts that can still do something.
    const alive: Wave[] = [];
    for (let wi = 0; wi < this.waves.length; wi++) {
      const wv = this.waves[wi];
      const fr = nextFront[wi].filter((f) => f.wait > 0 || this.canGrow(f, wv.c, wv.range));
      if (fr.length) { wv.front = fr; alive.push(wv); }
    }
    for (const nw of newWaves) {
      const fr = nw.front.filter((f) => f.wait > 0 || this.canGrow(f, nw.c, nw.range));
      if (fr.length) { nw.front = fr; alive.push(nw); }
    }
    this.waves = alive;
    this.tick = tNext;
    this.lastEvents = events;
    return events;
  }

  /** Goal cells that can no longer be satisfied (wrong colour, or ink on a clean cell). */
  wrongCells(): number[] {
    const out: number[] = [];
    for (const i of this.L.targets) if (this.ink[i] && this.ink[i] !== this.L.goal[i]) out.push(i);
    for (const i of this.L.whites) if (this.ink[i]) out.push(i);
    return out;
  }

  metCount(): number {
    let n = 0;
    for (const i of this.L.targets) if (this.ink[i] === this.L.goal[i]) n++;
    return n;
  }

  allTargetsMet(): boolean {
    for (const i of this.L.targets) if (this.ink[i] !== this.L.goal[i]) return false;
    return true;
  }

  /**
   * Final verdict if nobody drops any more ink from now on.
   * Returns 'win' | 'lose'. Does not modify this sim.
   */
  forecast(maxTicks = 200): { result: 'win' | 'lose'; ticks: number; sim: Sim } {
    const s = this.clone();
    let n = 0;
    while (!s.settled() && n < maxTicks) {
      s.step();
      n++;
      if (s.wrongCells().length) return { result: 'lose', ticks: n, sim: s };
    }
    return { result: s.allTargetsMet() && !s.wrongCells().length ? 'win' : 'lose', ticks: n, sim: s };
  }

  /** ASCII dump (lower case = plain ink, upper case = mixed). */
  ascii(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let r = '';
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.L.hole[i]) r += ' ';
        else if (this.L.wall[i]) r += '#';
        else if (this.seed[i]) r += '*';
        else if (this.ink[i]) {
          const ch = CODE_TO_CHAR[this.ink[i]];
          r += this.mixed[i] ? ch : ch.toLowerCase();
        } else r += this.L.goal[i] === WHITE ? 'w' : '.';
      }
      rows.push(r);
    }
    return rows.join('\n');
  }
}

const NB = [0, 0, 0, 0];
const NB2 = [0, 0, 0, 0];
let CLAIM_BITS = new Uint8Array(256);
let CLAIM_FROM = new Int32Array(256);

export interface RunResult { ok: boolean; sim: Sim; ticks: number; errors: string[]; failTick: number }

/**
 * Plays a drop list (t = beat) against a level, exactly as the game would.
 * Stops early on the first wrong cell. ok = every target met and every clean cell clean.
 */
export function runSolution(level: ParsedLevel | LevelDef, drops: Drop[], maxTicks = 300): RunResult {
  const sim = new Sim(level);
  const pending = drops.slice().sort((a, b) => a.t - b.t);
  const errors: string[] = [];
  let failTick = -1;
  while (sim.tick <= maxTicks) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      const i = sim.idx(d.x, d.y);
      if (!sim.inBounds(d.x, d.y) || !sim.drop(i)) errors.push('t' + d.t + ' (' + d.x + ',' + d.y + ') blocked: ' + sim.dropBlock(i));
    }
    if (sim.wrongCells().length) { failTick = sim.tick; break; }
    if (!pending.length && sim.settled()) break;
    sim.step();
  }
  const ok = !errors.length && failTick < 0 && sim.allTargetsMet() && !sim.wrongCells().length;
  return { ok, sim, ticks: sim.tick, errors, failTick };
}
