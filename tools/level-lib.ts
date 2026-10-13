/*
 * Inkbloom level analyzer library (Node only, run with --experimental-strip-types).
 *
 *  - FS: a fast re-implementation of src/core/sim.ts (same rules, same iteration order) used by
 *    the bots, the exhaustive solver and the generator. `crossCheck()` proves it matches Sim.
 *  - Bots: random bot, greedy bot.
 *  - Exhaustive solver: counts canonical solutions (cell x beat) and whether a no-wait solution exists.
 *  - Mechanic usage (`usesOf`), input-model validation, canonical keys, difficulty score.
 *
 * The game itself never imports this file; final verification always goes through runSolution().
 */
import { parseLevel, runSolution, Sim, WHITE, CODE_TO_CHAR, type LevelDef, type Drop, type ParsedLevel, type MechanicKey } from '../src/core/sim.ts';
import { transformLevel } from '../src/core/transform.ts';
import { mulberry32 } from '../src/core/rng.ts';

export type Rng = () => number;
export { mulberry32 };

export const MECHANICS: MechanicKey[] = ['drop', 'walls', 'order', 'mix', 'timing', 'parity', 'three', 'range', 'white', 'seed', 'gate', 'slow'];
export const BASIC_MECHANICS: MechanicKey[] = ['drop', 'walls', 'order', 'mix', 'timing', 'parity'];

/** Input-model limits (see the design brief). */
export const LIMITS = {
  minW: 4, maxW: 8, minH: 4, maxH: 10,
  minInks: 1, maxInks: 5,
  maxWait: 6,
  settleTick: 22,
  minTargets: 3, maxTargets: 18,
};

export const INF_RANGE = 999;

// ---------------------------------------------------------------------------------------------
// Board: static data shared by every FS on one level
// ---------------------------------------------------------------------------------------------

export interface Board {
  L: ParsedLevel;
  w: number;
  h: number;
  n: number;
  wall: Uint8Array;
  slow: Uint8Array;
  gate: Uint8Array;
  seed0: Uint8Array;
  goal: Uint8Array;
  nb: Int32Array;
  inkC: number[];
  inkR: number[];
  targets: number[];
  whites: number[];
  /** Cells a drop can land on at the start (paper, slow paper; not walls, seeds, gates, white goals). */
  open: number[];
}

export function makeBoard(def: LevelDef | ParsedLevel): Board {
  const L = (def as ParsedLevel).wall ? (def as ParsedLevel) : parseLevel(def as LevelDef);
  const w = L.w, h = L.h, n = w * h;
  const nb = new Int32Array(n * 4).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = i % w;
    if (i >= w) nb[i * 4] = i - w;
    if (x < w - 1) nb[i * 4 + 1] = i + 1;
    if (i + w < n) nb[i * 4 + 2] = i + w;
    if (x > 0) nb[i * 4 + 3] = i - 1;
  }
  const open: number[] = [];
  for (let i = 0; i < n; i++) if (!L.wall[i] && !L.seed[i] && !L.gate[i] && L.goal[i] !== WHITE) open.push(i);
  return {
    L, w, h, n, wall: L.wall, slow: L.slow, gate: L.gate, seed0: L.seed, goal: L.goal, nb,
    inkC: L.inks.map((k) => k.c), inkR: L.inks.map((k) => (k.range === Infinity ? INF_RANGE : k.range)),
    targets: L.targets, whites: L.whites, open,
  };
}

/** Same board with a different goal layer (fast: reuses the terrain arrays). */
export function withGoal(b: Board, goal: Uint8Array): Board {
  const targets: number[] = [], whites: number[] = [];
  for (let i = 0; i < b.n; i++) {
    if (goal[i] === WHITE) whites.push(i);
    else if (goal[i]) targets.push(i);
  }
  const open: number[] = [];
  for (let i = 0; i < b.n; i++) if (!b.wall[i] && !b.seed0[i] && !b.gate[i] && goal[i] !== WHITE) open.push(i);
  return { ...b, goal, targets, whites, open };
}

// scratch buffers (boards are at most 8x10, keep room)
const MAXN = 1024;
const S_BITS = new Uint8Array(MAXN);
const S_WB = new Int32Array(MAXN);
const S_CLAIMED = new Int32Array(MAXN);
const S_MARK = new Int32Array(MAXN);
let stampCounter = 1;
const S_CT: number[] = [];
const S_CW: number[] = [];
const S_CD: number[] = [];

function isPrim(c: number): boolean {
  return c === 1 || c === 2 || c === 4;
}

/** Fast simulator with exactly the rules and iteration order of src/core/sim.ts. */
export class FS {
  B: Board;
  ink: Uint8Array;
  seed: Uint8Array;
  /** Bitmask of wave ids that coloured each cell (only when tracking). */
  cw: Int32Array | null;
  /** Per wave id: colour, range, origin tick, kind (0 drop, 1 seed), drop index or seed cell. */
  wc: number[];
  wr: number[];
  wo: number[];
  wk: number[];
  /** Active wave ids in Sim order. */
  act: number[];
  /** Fronts per wave id, flattened [idx, d, wait, ...]. */
  fr: number[][];
  tick: number;
  pi: number;
  lastDrop: number;
  bad: boolean;
  met: number;

  constructor(B: Board, track = false) {
    this.B = B;
    this.ink = new Uint8Array(B.n);
    this.seed = B.seed0;
    this.cw = track ? new Int32Array(B.n) : null;
    this.wc = [];
    this.wr = [];
    this.wo = [];
    this.wk = [];
    this.act = [];
    this.fr = [];
    this.tick = 0;
    this.pi = 0;
    this.lastDrop = -1;
    this.bad = false;
    this.met = 0;
  }

  clone(): FS {
    const s = Object.create(FS.prototype) as FS;
    s.B = this.B;
    s.ink = this.ink.slice();
    s.seed = this.seed === this.B.seed0 ? this.seed : this.seed.slice();
    s.cw = this.cw ? this.cw.slice() : null;
    s.wc = this.wc.slice();
    s.wr = this.wr.slice();
    s.wo = this.wo.slice();
    s.wk = this.wk.slice();
    s.act = this.act.slice();
    s.fr = this.fr.map((f) => (f.length ? f.slice() : f));
    s.tick = this.tick;
    s.pi = this.pi;
    s.lastDrop = this.lastDrop;
    s.bad = this.bad;
    s.met = this.met;
    return s;
  }

  settled(): boolean {
    return this.act.length === 0;
  }

  canDrop(i: number): boolean {
    const B = this.B;
    return i >= 0 && i < B.n && !B.wall[i] && !this.seed[i] && !B.gate[i] && !this.ink[i] && B.goal[i] !== WHITE && this.pi < B.inkC.length;
  }

  /** Droppable cells right now. */
  droppable(out: number[] = []): number[] {
    out.length = 0;
    const B = this.B;
    if (this.pi >= B.inkC.length) return out;
    for (let i = 0; i < B.n; i++) if (!B.wall[i] && !this.seed[i] && !B.gate[i] && !this.ink[i] && B.goal[i] !== WHITE) out.push(i);
    return out;
  }

  private mark(i: number, c: number) {
    const g = this.B.goal[i];
    if (!g) return;
    if (g === WHITE) this.bad = true;
    else if (g === c) this.met++;
    else this.bad = true;
  }

  private canGrow(idx: number, d: number, c: number, r: number): boolean {
    if (d >= r) return false;
    const B = this.B, nb = B.nb, base = idx * 4;
    for (let k = 0; k < 4; k++) {
      const m = nb[base + k];
      if (m < 0 || B.wall[m]) continue;
      if (this.seed[m]) return true;
      if (this.ink[m]) continue;
      const g = B.gate[m];
      if (g && g !== c) continue;
      return true;
    }
    return false;
  }

  drop(i: number): void {
    const B = this.B;
    const c = B.inkC[this.pi], r = B.inkR[this.pi];
    const id = this.wc.length;
    this.wc.push(c);
    this.wr.push(r);
    this.wo.push(this.tick);
    this.wk.push(0);
    this.pi++;
    this.ink[i] = c;
    if (this.cw) this.cw[i] = id < 31 ? 1 << id : 0;
    this.mark(i, c);
    this.lastDrop = this.tick;
    const wait = B.slow[i] ? 1 : 0;
    if (wait || this.canGrow(i, 0, c, r)) {
      this.fr.push([i, 0, wait]);
      this.act.push(id);
    } else this.fr.push([]);
  }

  step(): void {
    const B = this.B, nb = B.nb, wall = B.wall, gate = B.gate, slow = B.slow;
    const ink = this.ink;
    let seed = this.seed;
    const tNext = this.tick + 1;
    const bits = S_BITS, claimed = S_CLAIMED, wb = S_WB;
    const cT = S_CT, cW = S_CW, cD = S_CD;
    const track = this.cw !== null;
    let nc = 0, nq = 0;
    let wake: number[] | null = null;
    const act = this.act;
    for (let a = 0; a < act.length; a++) {
      const id = act[a];
      const c = this.wc[id], r = this.wr[id];
      const f = this.fr[id];
      for (let j = 0; j < f.length; j += 3) {
        const idx = f[j], d = f[j + 1];
        if (f[j + 2] > 0 || d >= r) continue;
        const base = idx * 4;
        for (let k = 0; k < 4; k++) {
          const m = nb[base + k];
          if (m < 0 || wall[m]) continue;
          if (seed[m]) {
            if (!wake) wake = [m];
            else if (wake.indexOf(m) < 0) wake.push(m);
            continue;
          }
          if (ink[m]) continue;
          const g = gate[m];
          if (g && g !== c) continue;
          if (!bits[m]) claimed[nc++] = m;
          bits[m] |= c;
          if (track && id < 31) wb[m] |= 1 << id;
          cT[nq] = m;
          cW[nq] = a;
          cD[nq] = d + 1;
          nq++;
        }
      }
    }
    // waiting items stay
    const next: number[][] = new Array(act.length);
    for (let a = 0; a < act.length; a++) {
      const f = this.fr[act[a]];
      const list: number[] = [];
      for (let j = 0; j < f.length; j += 3) if (f[j + 2] > 0) list.push(f[j], f[j + 1], f[j + 2] - 1);
      next[a] = list;
    }
    // resolve claims
    for (let q = 0; q < nc; q++) {
      const m = claimed[q];
      const b = bits[m];
      bits[m] = 0;
      ink[m] = b;
      if (track) {
        this.cw![m] = wb[m];
        wb[m] = 0;
      }
      this.mark(m, b);
    }
    if (stampCounter > 1e9) {
      S_MARK.fill(0);
      stampCounter = 1;
    }
    const stamp0 = stampCounter;
    stampCounter += act.length + 1;
    const mk = S_MARK;
    for (let q = 0; q < nq; q++) {
      const m = cT[q];
      const im = ink[m];
      if (im !== 1 && im !== 2 && im !== 4) continue;
      const a = cW[q];
      const st = stamp0 + a;
      if (mk[m] === st) continue;
      mk[m] = st;
      next[a].push(m, cD[q], slow[m] ? 1 : 0);
    }
    // wake seeds
    const newIds: number[] = [];
    if (wake) {
      if (seed === this.B.seed0) seed = this.seed = seed.slice(); // copy on write
      for (const s of wake) {
        const c = seed[s];
        seed[s] = 0;
        ink[s] = c;
        const id = this.wc.length;
        this.wc.push(c);
        this.wr.push(INF_RANGE);
        this.wo.push(tNext);
        this.wk.push(1);
        if (this.cw) this.cw[s] = id < 31 ? 1 << id : 0;
        this.mark(s, c);
        this.fr.push([s, 0, slow[s] ? 1 : 0]);
        newIds.push(id);
      }
    }
    // keep fronts that can still grow (filter in place)
    const alive: number[] = [];
    for (let a = 0; a < act.length; a++) {
      const id = act[a];
      const c = this.wc[id], r = this.wr[id];
      const list = next[a];
      let o = 0;
      for (let j = 0; j < list.length; j += 3) {
        if (list[j + 2] > 0 || this.canGrow(list[j], list[j + 1], c, r)) {
          if (o !== j) {
            list[o] = list[j];
            list[o + 1] = list[j + 1];
            list[o + 2] = list[j + 2];
          }
          o += 3;
        }
      }
      list.length = o;
      this.fr[id] = list;
      if (o) alive.push(id);
    }
    for (const id of newIds) {
      const f = this.fr[id];
      if (f[2] > 0 || this.canGrow(f[0], f[1], this.wc[id], this.wr[id])) alive.push(id);
      else this.fr[id] = [];
    }
    this.act = alive;
    this.tick = tNext;
  }

  won(): boolean {
    return !this.bad && this.met === this.B.targets.length;
  }

  ascii(): string {
    const B = this.B, rows: string[] = [];
    for (let y = 0; y < B.h; y++) {
      let r = '';
      for (let x = 0; x < B.w; x++) {
        const i = y * B.w + x;
        if (B.L.hole[i]) r += ' ';
        else if (B.wall[i]) r += '#';
        else if (this.seed[i]) r += '*';
        else if (this.ink[i]) {
          const ch = CODE_TO_CHAR[this.ink[i]];
          r += isPrim(this.ink[i]) ? ch.toLowerCase() : ch;
        } else r += B.goal[i] === WHITE ? 'w' : '.';
      }
      rows.push(r);
    }
    return rows.join('\n');
  }
}

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

/** A drop plan in queue order: cell index + beat. */
export interface PlanDrop { i: number; t: number }
export type Plan = PlanDrop[];

export function planToDrops(B: Board, plan: Plan): Drop[] {
  return plan.map((p) => ({ x: p.i % B.w, y: Math.floor(p.i / B.w), t: p.t }));
}
export function dropsToPlan(B: Board, drops: Drop[]): Plan {
  return drops.map((d) => ({ i: d.y * B.w + d.x, t: d.t }));
}

export interface PlayResult { valid: boolean; won: boolean; bad: boolean; tick: number; sim: FS }

/**
 * Plays a plan like runSolution does. stopOnBad: stop at the first wrong cell (faster).
 * valid=false when a drop is blocked.
 */
export function play(B: Board, plan: Plan, stopOnBad = true, track = false): PlayResult {
  const s = new FS(B, track);
  let p = 0;
  for (;;) {
    while (p < plan.length && plan[p].t <= s.tick) {
      if (!s.canDrop(plan[p].i)) return { valid: false, won: false, bad: true, tick: s.tick, sim: s };
      s.drop(plan[p].i);
      p++;
    }
    if (stopOnBad && s.bad) break;
    if (p >= plan.length && s.settled()) break;
    if (s.tick > 300) break;
    s.step();
  }
  return { valid: true, won: s.won() && p >= plan.length, bad: s.bad, tick: s.tick, sim: s };
}

/** Plan respects the input model: sorted, first drop t=0, distinct timed beats, waits <= maxWait. */
export function planInputErrors(plan: Plan, maxWait = LIMITS.maxWait): string[] {
  const errs: string[] = [];
  if (!plan.length) return ['empty solution'];
  if (plan[0].t !== 0) errs.push('first drop not at t=0');
  for (let k = 1; k < plan.length; k++) {
    const a = plan[k - 1].t, b = plan[k].t;
    if (b < a) errs.push('drops not sorted by t');
    if (b > 0 && b === a) errs.push('two drops in live beat ' + b);
    if (b - a > maxWait) errs.push('wait of ' + (b - a) + ' beats > ' + maxWait);
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------------------------

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** One random-bot game. Returns the plan it played and whether it won. */
export function randomTrial(B: Board, rng: Rng, buf: number[] = []): { won: boolean; plan: Plan } {
  const s = new FS(B);
  const k = B.inkC.length;
  const n0 = 1 + Math.floor(rng() * k);
  const plan: Plan = [];
  for (let q = 0; q < k; q++) {
    if (q >= n0) {
      const steps = 1 + Math.floor(rng() * 5);
      for (let st = 0; st < steps; st++) {
        s.step();
        if (s.bad) return { won: false, plan };
      }
    }
    const cells = s.droppable(buf);
    if (!cells.length) return { won: false, plan };
    const i = pick(rng, cells);
    plan.push({ i, t: s.tick });
    s.drop(i);
    if (s.bad) return { won: false, plan };
  }
  while (!s.settled()) {
    s.step();
    if (s.bad) return { won: false, plan };
  }
  return { won: s.won(), plan };
}

export function randomBot(B: Board, trials: number, rng: Rng): number {
  let wins = 0;
  const buf: number[] = [];
  for (let t = 0; t < trials; t++) if (randomTrial(B, rng, buf).won) wins++;
  return wins / trials;
}

/** Cells the greedy bot likes for colour c, with weights. */
function greedyChoices(s: FS, c: number, buf: number[]): { cells: number[]; wts: number[] } {
  const B = s.B, goal = B.goal, nb = B.nb;
  const cells: number[] = [], wts: number[] = [];
  const open = s.droppable(buf);
  for (const i of open) {
    const g = goal[i];
    if (g && g !== c) continue; // would be wrong at once
    let wgt = 0;
    if (g === c) wgt = 4;
    for (let k = 0; k < 4; k++) {
      const m = nb[i * 4 + k];
      if (m < 0) continue;
      const gm = goal[m];
      if (!gm || gm === WHITE) continue;
      if (gm === c) wgt = Math.max(wgt, 2);
      else if (gm & c) wgt = Math.max(wgt, 1);
    }
    if (wgt) {
      cells.push(i);
      wts.push(wgt);
    }
  }
  return { cells, wts };
}

/** One greedy-bot game: drop each ink on/near a matching target, ASAP, with small random waits. */
export function greedyTrial(B: Board, rng: Rng, buf: number[] = []): { won: boolean; plan: Plan } {
  const s = new FS(B);
  const k = B.inkC.length;
  const plan: Plan = [];
  let started = false;
  for (let q = 0; q < k; q++) {
    // small random variation: sometimes wait a beat or two first
    let waits = 0;
    if (q > 0 && rng() < 0.22) waits = 1 + Math.floor(rng() * 2);
    if (started && waits === 0) waits = 1; // after the clock started, one drop per beat
    for (let st = 0; st < waits; st++) {
      s.step();
      started = true;
      if (s.bad) return { won: false, plan };
    }
    const c = B.inkC[q];
    const ch = greedyChoices(s, c, buf);
    let i: number;
    if (ch.cells.length) {
      let tot = 0;
      for (const x of ch.wts) tot += x;
      let r = rng() * tot;
      let j = 0;
      while (j < ch.cells.length - 1 && r >= ch.wts[j]) {
        r -= ch.wts[j];
        j++;
      }
      i = ch.cells[j];
    } else {
      const open = s.droppable(buf).filter((x) => !B.goal[x] || B.goal[x] === c);
      if (!open.length) return { won: false, plan };
      i = pick(rng, open);
    }
    plan.push({ i, t: s.tick });
    s.drop(i);
    if (s.bad) return { won: false, plan };
  }
  while (!s.settled()) {
    s.step();
    if (s.bad) return { won: false, plan };
  }
  return { won: s.won(), plan };
}

export function greedyBot(B: Board, trials: number, rng: Rng): number {
  let wins = 0;
  const buf: number[] = [];
  for (let t = 0; t < trials; t++) if (greedyTrial(B, rng, buf).won) wins++;
  return wins / trials;
}

// ---------------------------------------------------------------------------------------------
// Fast all-t=0 flood (boards without slow paper)
// ---------------------------------------------------------------------------------------------

const FL_CC = new Uint8Array(MAXN);
const FL_CM = new Int32Array(MAXN);
const FL_MASK = new Int32Array(MAXN);
const FL_SEED = new Uint8Array(MAXN);
const FL_INK = new Uint8Array(MAXN);

export function hasSlow(B: Board): boolean {
  for (let i = 0; i < B.n; i++) if (B.slow[i]) return true;
  return false;
}

/**
 * Plays an all-t=0 plan (cells in queue order) on a board WITHOUT slow paper. With every drop on
 * beat 0 a front's distance equals the beat, so the game reduces to a layered flood. Exactly the
 * same result as Sim/FS (see crossCheckFlood). Returns 1 when every target is met and nothing is
 * wrong; fills `out` with the final inks when given (then it never stops early).
 */
export function floodT0(B: Board, cells: number[], out?: Uint8Array): number {
  const n = B.n, nb = B.nb, wall = B.wall, gate = B.gate, goal = B.goal;
  const ink = out || FL_INK;
  ink.fill(0, 0, n);
  const mask = FL_MASK, cc = FL_CC, cm = FL_CM, seed = FL_SEED;
  mask.fill(0, 0, n);
  for (let i = 0; i < n; i++) seed[i] = B.seed0[i];
  const T = B.targets.length;
  const early = !out;
  const noWhites = B.whites.length === 0;
  const waveR: number[] = [];
  let met = 0, bad = false;
  let frontier: number[] = [];
  for (let q = 0; q < cells.length; q++) {
    const i = cells[q], c = B.inkC[q];
    waveR.push(B.inkR[q]);
    if (ink[i]) return 0; // two drops on one cell: invalid
    ink[i] = c;
    mask[i] = 1 << q;
    const g = goal[i];
    if (g) {
      if (g === c) met++;
      else bad = true;
    }
    frontier.push(i);
  }
  if (early && bad) return 0;
  let t = 0;
  while (frontier.length) {
    const fresh: number[] = [];
    let wakes: number[] | null = null;
    for (const f of frontier) {
      const m = mask[f];
      let prop = 0;
      for (let w = 0; w < waveR.length; w++) if (m & (1 << w) && waveR[w] > t) prop |= 1 << w;
      if (!prop) continue;
      const c = ink[f];
      const base = f * 4;
      for (let k = 0; k < 4; k++) {
        const j = nb[base + k];
        if (j < 0 || wall[j]) continue;
        if (seed[j]) {
          if (!wakes) wakes = [j];
          else if (wakes.indexOf(j) < 0) wakes.push(j);
          continue;
        }
        if (ink[j]) continue;
        const gt = gate[j];
        if (gt && gt !== c) continue;
        if (!cc[j]) fresh.push(j);
        cc[j] |= c;
        cm[j] |= prop;
      }
    }
    t++;
    const next: number[] = [];
    for (const j of fresh) {
      const b = cc[j];
      ink[j] = b;
      mask[j] = cm[j];
      cc[j] = 0;
      cm[j] = 0;
      const g = goal[j];
      if (g) {
        if (g === b) met++;
        else bad = true;
      }
      if (b === 1 || b === 2 || b === 4) next.push(j);
    }
    if (wakes) {
      for (const sc of wakes) {
        const c = seed[sc];
        seed[sc] = 0;
        ink[sc] = c;
        mask[sc] = waveR.length < 31 ? 1 << waveR.length : 0;
        waveR.push(INF_RANGE);
        const g = goal[sc];
        if (g) {
          if (g === c) met++;
          else bad = true;
        }
        next.push(sc);
      }
    }
    if (early) {
      if (bad) return 0;
      if (met === T && noWhites) return 1;
    }
    frontier = next;
  }
  return !bad && met === T ? 1 : 0;
}

/** floodT0 vs FS on random boards without slow paper; returns mismatches. */
export function crossCheckFlood(trials: number, seed = 3): number {
  const rng = mulberry32(seed);
  let bad = 0;
  for (let k = 0; k < trials; k++) {
    const w = 4 + Math.floor(rng() * 5), h = 4 + Math.floor(rng() * 7);
    const map: string[] = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const q = rng();
        r += q < 0.6 ? '.' : q < 0.7 ? '#' : q < 0.74 ? ' ' : q < 0.84 ? 'ryb'[Math.floor(rng() * 3)] : q < 0.9 ? 'RYB'[Math.floor(rng() * 3)] : '.';
      }
      map.push(r);
    }
    const nk = 1 + Math.floor(rng() * 5);
    const inks: string[] = [];
    for (let i = 0; i < nk; i++) inks.push('RYB'[Math.floor(rng() * 3)] + (rng() < 0.4 ? String(1 + Math.floor(rng() * 4)) : ''));
    let B: Board;
    try {
      B = makeBoard({ id: 'f', map, goal: map.map((r) => '.'.repeat(r.length)), inks, solution: [] });
    } catch {
      continue;
    }
    const open = B.open.slice();
    if (open.length < nk) continue;
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tt = open[i];
      open[i] = open[j];
      open[j] = tt;
    }
    const cells = open.slice(0, nk);
    const out = new Uint8Array(B.n);
    floodT0(B, cells, out);
    const r = play(B, cells.map((i) => ({ i, t: 0 })), false);
    for (let i = 0; i < B.n; i++) if (out[i] !== r.sim.ink[i]) {
      bad++;
      break;
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Exhaustive solver
// ---------------------------------------------------------------------------------------------

export interface SolveOptions {
  /** Stop after this many solutions (default 1e9). */
  maxSolutions?: number;
  /** Abort after this many search nodes (default 3e6). */
  nodeBudget?: number;
  maxWait?: number;
  /** No drop later than this beat. */
  maxTick?: number;
  /** Only all-t=0 plans. */
  onlyT0?: boolean;
  /** Keep up to this many example solutions. */
  keep?: number;
}

export interface SolveResult {
  /** Canonical solutions found (identical inks dropped on the same beat counted once; no idle waits on a settled board). */
  solutions: number;
  /** Some solution drops everything at t=0. */
  noWait: boolean;
  /** Search finished within budget (counts are exact). */
  complete: boolean;
  nodes: number;
  examples: Plan[];
  /** Solutions by number of timed drops. */
  byTimed: number[];
}

/** Can the empty region around an unmet target still receive the colours it needs? (cheap dead-end test) */
function hopeless(s: FS): boolean {
  const B = s.B;
  // colours that can still arrive anywhere: remaining inks, live fronts, sleeping seeds
  let avail = 0;
  for (let q = s.pi; q < B.inkC.length; q++) avail |= B.inkC[q];
  for (const id of s.act) avail |= s.wc[id];
  for (let i = 0; i < B.n; i++) if (s.seed[i]) avail |= s.seed[i];
  for (const t of B.targets) {
    if (s.ink[t]) continue;
    if ((B.goal[t] & avail) !== B.goal[t]) return true;
  }
  return false;
}

export function solve(B: Board, opts: SolveOptions = {}): SolveResult {
  const maxSol = opts.maxSolutions ?? 1e9;
  const budget = opts.nodeBudget ?? 3e6;
  const maxWait = opts.maxWait ?? LIMITS.maxWait;
  const maxTick = opts.maxTick ?? 24;
  const keep = opts.keep ?? 0;
  const K = B.inkC.length;
  const T = B.targets.length;
  const res: SolveResult = { solutions: 0, noWait: false, complete: true, nodes: 0, examples: [], byTimed: [0, 0, 0, 0, 0, 0] };
  const plan: Plan = [];
  const buf: number[][] = [];
  for (let k = 0; k <= K + 2; k++) buf.push([]);
  let abort = false;
  // All-t=0 parity prune (exact): without slow paper or seeds every wave reaches a cell only on beats
  // with the parity of (drop -> cell) distance, so a mixed target needs drops of both colours on the
  // same checkerboard colour.
  let paritySafe = true;
  for (let i = 0; i < B.n && paritySafe; i++) if (B.slow[i] || B.seed0[i]) paritySafe = false;
  const fastT0 = !hasSlow(B);
  const t0cells: number[] = [];
  const mixPairs: [number, number][] = [];
  if (paritySafe) {
    const seen = new Set<number>();
    for (const t of B.targets) {
      const g = B.goal[t];
      if (g === 3 || g === 5 || g === 6) seen.add(g);
    }
    for (const g of seen) {
      const a = g & 1 ? 1 : 2, c = g & 4 ? 4 : 2;
      mixPairs.push([a, g & ~a]);
      void c;
    }
  }
  // remaining-colour suffix masks
  const restCols: number[] = new Array(K + 1).fill(0);
  for (let q = K - 1; q >= 0; q--) restCols[q] = restCols[q + 1] | B.inkC[q];
  function parityDead(): boolean {
    const placed = plan.length;
    for (const [c1, c2] of mixPairs) {
      if (restCols[placed] & (c1 | c2)) continue; // still to come
      let p1 = 0, p2 = 0;
      for (let q = 0; q < placed; q++) {
        const i = plan[q].i;
        const par = 1 << (((i % B.w) + Math.floor(i / B.w)) & 1);
        if (B.inkC[q] === c1) p1 |= par;
        else if (B.inkC[q] === c2) p2 |= par;
      }
      if (!(p1 & p2)) return true;
    }
    return false;
  }

  const noWhites = B.whites.length === 0;
  function leaf(s: FS) {
    for (;;) {
      if (s.bad) return;
      if (s.met === T && noWhites) break; // targets never change once inked
      if (s.settled()) break;
      if (hopeless(s)) return;
      s.step();
    }
    if (s.met !== T) return;
    res.solutions++;
    let timed = 0;
    for (const p of plan) if (p.t > 0) timed++;
    res.byTimed[Math.min(5, timed)]++;
    if (!timed) res.noWait = true;
    if (res.examples.length < keep) res.examples.push(plan.slice());
    if (res.solutions >= maxSol) abort = true;
  }

  // fast path: all-t=0 enumeration with the layered flood
  if (opts.onlyT0 && !hasSlow(B)) {
    const cells: number[] = [];
    const used = new Uint8Array(B.n);
    const open = B.open;
    const rec = (q: number) => {
      if (abort) return;
      if (++res.nodes > budget) {
        res.complete = false;
        abort = true;
        return;
      }
      if (q === K) {
        if (floodT0(B, cells)) {
          res.solutions++;
          res.byTimed[0]++;
          res.noWait = true;
          if (res.examples.length < keep) res.examples.push(cells.map((i) => ({ i, t: 0 })));
          if (res.solutions >= maxSol) abort = true;
        }
        return;
      }
      const c = B.inkC[q];
      const minIdx = q > 0 && B.inkC[q - 1] === c && B.inkR[q - 1] === B.inkR[q] ? cells[q - 1] + 1 : 0;
      for (const i of open) {
        if (i < minIdx || used[i]) continue;
        const g = B.goal[i];
        if (g && g !== c) continue;
        cells.push(i);
        plan.push({ i, t: 0 });
        used[i] = 1;
        if (!(mixPairs.length && parityDead())) rec(q + 1);
        used[i] = 0;
        cells.pop();
        plan.pop();
        if (abort) return;
      }
    };
    rec(0);
    return res;
  }

  function dfs(s: FS, depth: number) {
    if (abort) return;
    if (++res.nodes > budget) {
      res.complete = false;
      abort = true;
      return;
    }
    if (s.pi === K) {
      leaf(s);
      return;
    }
    if (hopeless(s)) return;
    const canNow = s.tick === 0 || s.lastDrop < s.tick;
    if (canNow) {
      const c = B.inkC[s.pi];
      let minIdx = 0;
      if (s.pi > 0 && plan[s.pi - 1].t === s.tick && B.inkC[s.pi - 1] === c && B.inkR[s.pi - 1] === B.inkR[s.pi]) minIdx = plan[s.pi - 1].i + 1;
      const cells = s.droppable(buf[depth]).slice();
      const allT0 = s.tick === 0;
      for (const i of cells) {
        if (i < minIdx) continue;
        const g = B.goal[i];
        if (g && g !== c) continue;
        plan.push({ i, t: s.tick });
        if (allT0 && mixPairs.length && parityDead()) {
          plan.pop();
          continue;
        }
        if (allT0 && fastT0 && s.pi === K - 1) {
          // last ink, everything on beat 0: exact layered flood
          if (++res.nodes > budget) {
            res.complete = false;
            abort = true;
            plan.pop();
            return;
          }
          t0cells.length = 0;
          for (const p of plan) t0cells.push(p.i);
          if (floodT0(B, t0cells)) {
            res.solutions++;
            res.byTimed[0]++;
            res.noWait = true;
            if (res.examples.length < keep) res.examples.push(plan.slice());
            if (res.solutions >= maxSol) abort = true;
          }
          plan.pop();
          if (abort) return;
          continue;
        }
        const s2 = s.clone();
        s2.drop(i);
        dfs(s2, depth + 1);
        plan.pop();
        if (abort) return;
      }
    }
    if (!opts.onlyT0 && s.pi > 0 && s.tick + 1 <= s.lastDrop + maxWait && s.tick + 1 <= maxTick && !s.settled()) {
      const s2 = s.clone();
      s2.step();
      if (!s2.bad) dfs(s2, depth + 1);
    }
  }
  dfs(new FS(B), 0);
  return res;
}

/** Number of all-t=0 plans (upper bound) - used to decide whether the exhaustive t=0 check is affordable. */
export function t0Space(B: Board): number {
  let open = 0;
  for (const i of B.open) if (!B.goal[i] || B.goal[i] !== WHITE) open++;
  let n = 1;
  for (let k = 0; k < B.inkC.length; k++) n *= open;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Analysis of a level + solution
// ---------------------------------------------------------------------------------------------

export interface SolutionInfo {
  ok: boolean;
  settleTick: number;
  final: Uint8Array;
  mixedCells: number[];
  /** Mixed cells whose contributing waves started on beats of odd difference, one being a timed drop. */
  parityCells: number[];
  /** Adjacent cells with different plain inks, or any mix. */
  collisions: number;
  coverage: number;
  timedDrops: number;
  /** Cells coloured by each drop wave (plain or mixed). */
  territory: number[];
  seedsWoken: number;
  gatesInked: number;
  mud: number;
}

export function analyzeSolution(B: Board, plan: Plan): SolutionInfo {
  const r = play(B, plan, false, true);
  const s = r.sim;
  const n = B.n;
  const mixedCells: number[] = [], parityCells: number[] = [];
  let mud = 0;
  const K = B.inkC.length;
  const territory = new Array(K).fill(0);
  let paper = 0, inked = 0, gatesInked = 0;
  for (let i = 0; i < n; i++) {
    if (B.wall[i]) continue;
    paper++;
    if (s.ink[i]) inked++;
    if (B.gate[i] && s.ink[i]) gatesInked++;
    const m = s.cw ? s.cw[i] : 0;
    for (let id = 0; id < Math.min(31, s.wc.length); id++) {
      if (!(m & (1 << id))) continue;
      if (s.wk[id] === 0) {
        // drop wave: which drop? drop waves are created in queue order among drops
        let q = 0;
        for (let j = 0; j < id; j++) if (s.wk[j] === 0) q++;
        territory[q]++;
      }
    }
    if (s.ink[i] && !isPrim(s.ink[i])) {
      mixedCells.push(i);
      if (s.ink[i] === 7) mud++;
      const ids: number[] = [];
      for (let id = 0; id < Math.min(31, s.wc.length); id++) if (m & (1 << id)) ids.push(id);
      let par = false;
      for (let a = 0; a < ids.length; a++)
        for (let b = a + 1; b < ids.length; b++) {
          const ia = ids[a], ib = ids[b];
          const timed = (s.wk[ia] === 0 && s.wo[ia] > 0) || (s.wk[ib] === 0 && s.wo[ib] > 0);
          if (timed && Math.abs(s.wo[ia] - s.wo[ib]) % 2 === 1) par = true;
        }
      if (par) parityCells.push(i);
    }
  }
  let collisions = mixedCells.length;
  for (let i = 0; i < n; i++) {
    if (!s.ink[i]) continue;
    for (const m of [i + 1, i + B.w]) {
      if (m >= n || (m === i + 1 && (i + 1) % B.w === 0)) continue;
      if (s.ink[m] && s.ink[m] !== s.ink[i]) collisions++;
    }
  }
  let timedDrops = 0;
  for (const p of plan) if (p.t > 0) timedDrops++;
  let seedsWoken = 0;
  for (let i = 0; i < n; i++) if (B.seed0[i] && !s.seed[i]) seedsWoken++;
  return {
    ok: r.valid && r.won,
    settleTick: s.tick,
    final: s.ink.slice(),
    mixedCells,
    parityCells,
    collisions,
    coverage: paper ? inked / paper : 0,
    timedDrops,
    territory,
    seedsWoken,
    gatesInked,
    mud,
  };
}

/** Every mechanic the level relies on (definitions from the design brief). */
export function usesOf(def: LevelDef, info?: SolutionInfo): MechanicKey[] {
  const u = new Set<MechanicKey>(['drop']);
  const map = def.map.join('');
  const goal = def.goal.join('');
  if (map.includes('#')) u.add('walls');
  const cols = new Set(def.inks.map((s) => s[0]));
  if (cols.size >= 2) u.add('order');
  if (/[OPG]/.test(goal)) u.add('mix');
  if (def.solution.some((d) => d.t >= 1)) u.add('timing');
  const B = makeBoard(def);
  const inf = info || analyzeSolution(B, dropsToPlan(B, def.solution));
  if (inf.parityCells.length) {
    u.add('parity');
    u.add('timing');
  }
  let prim = 0;
  for (const s of def.inks) prim |= s[0] === 'R' ? 1 : s[0] === 'Y' ? 2 : 4;
  if (map.includes('r')) prim |= 1;
  if (map.includes('y')) prim |= 2;
  if (map.includes('b')) prim |= 4;
  if (prim === 7) u.add('three');
  if (def.inks.some((s) => /\d/.test(s))) u.add('range');
  if (goal.includes('w')) u.add('white');
  if (/[ryb]/.test(map)) u.add('seed');
  if (/[RYB]/.test(map)) u.add('gate');
  if (map.includes('~')) u.add('slow');
  return MECHANICS.filter((m) => u.has(m));
}

// ---------------------------------------------------------------------------------------------
// Canonical key (mirror + colour permutation)
// ---------------------------------------------------------------------------------------------

const PERMS: [string, string, string][] = [['R', 'Y', 'B'], ['R', 'B', 'Y'], ['Y', 'R', 'B'], ['Y', 'B', 'R'], ['B', 'R', 'Y'], ['B', 'Y', 'R']];

export function canonKey(def: LevelDef): string {
  let best = '';
  for (const fx of [false, true])
    for (const fy of [false, true])
      for (const perm of PERMS) {
        const t = transformLevel(def, { flipX: fx, flipY: fy, perm });
        const k = t.map.join('/') + '|' + t.goal.join('/') + '|' + t.inks.join(',');
        if (!best || k < best) best = k;
      }
  return best;
}

/** Terrain-only key (to limit how often the same board is reused). */
export function terrainKey(def: LevelDef): string {
  let best = '';
  for (const fx of [false, true])
    for (const fy of [false, true]) {
      const t = transformLevel(def, { flipX: fx, flipY: fy });
      const k = t.map.join('/').replace(/[ryb]/g, 's').replace(/[RYB]/g, 'g');
      if (!best || k < best) best = k;
    }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Metrics + difficulty
// ---------------------------------------------------------------------------------------------

export interface Metrics {
  random: number;
  greedy: number;
  /** Exhaustive result when tractable. */
  solutions: number | null;
  complete: boolean;
  /** true: proven no all-t=0 solution; false: one exists; null: unknown. */
  needsTiming: boolean | null;
  timedDrops: number;
  settleTick: number;
  targets: number;
  inks: number;
  cells: number;
  diff: number;
}

export interface DiffInput {
  random: number;
  greedy: number;
  solutions: number | null;
  needsTiming: boolean | null;
  timedDrops: number;
  inks: number;
  cells: number;
  /** Number of mechanics used (including drop). */
  mechCount: number;
  targets: number;
}

/**
 * Difficulty 0..100 from the measurements:
 *  - search bits: log2(plays) - log2(solutions)  (how much the goals narrow things down)
 *  - timing: waiting proven necessary, number of timed drops
 *  - rules in play, ink count, bot failure rates, and how few goal cells guide the player.
 */
export function difficultyScore(m: DiffInput): number {
  const planBits = m.inks * Math.log2(Math.max(2, m.cells)) + (m.inks - 1) * Math.log2(7);
  let solBits: number;
  if (m.solutions !== null && m.solutions > 0) solBits = Math.log2(m.solutions);
  else if (m.random > 0) solBits = Math.max(0, planBits + Math.log2(m.random));
  else solBits = 2;
  const bitsTerm = Math.min(1, Math.max(0, (planBits - solBits - 6) / 26));
  let tTerm = m.needsTiming === true ? 0.55 : m.timedDrops > 0 ? 0.25 : 0;
  if (m.timedDrops > 1) tTerm += 0.2 * Math.min(2, m.timedDrops - 1);
  tTerm = Math.min(1, tTerm);
  const mechTerm = Math.min(1, Math.max(0, (m.mechCount - 1) / 9));
  const inkTerm = Math.min(1, (m.inks - 1) / 4);
  const gTerm = 1 - Math.min(1, m.greedy / 0.5);
  const rTerm = Math.min(1, -Math.log10(Math.max(m.random, 1 / 4000)) / 3.6);
  const infoTerm = 1 - Math.min(1, m.targets / Math.max(1, m.cells * 0.45));
  const v = 0.25 * bitsTerm + 0.18 * tTerm + 0.15 * mechTerm + 0.12 * inkTerm + 0.1 * gTerm + 0.1 * rTerm + 0.1 * infoTerm;
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

export interface MeasureOptions {
  randomTrials?: number;
  greedyTrials?: number;
  /** Bot seed; defaults to a hash of the level content (map, goal, inks) so the numbers never depend on the id. */
  seed?: number;
  /** Node budget of the full (timed) exhaustive search that counts solutions. */
  nodeBudget?: number;
  /** Node budget of the all-t=0 search that decides needsTiming. */
  t0Budget?: number;
  /** Already proven by the caller (generator): skip the all-t=0 search. */
  needsTimingHint?: boolean | null;
}

export function contentSeed(def: LevelDef): number {
  const s = def.map.join('/') + '|' + def.goal.join('/') + '|' + def.inks.join(',');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Budgets used everywhere (generator and verifier) so metrics are identical. */
export const MEASURE_BUDGET = { random: 2000, greedy: 300, node: 300000, t0: 1500000 };

/** Full measurement of a level (bots + exhaustive searches). Deterministic. */
export function measure(def: LevelDef, opts: MeasureOptions = {}): Metrics {
  const B = makeBoard(def);
  const rng = mulberry32((opts.seed ?? contentSeed(def)) ^ 0x9e3779b9);
  const random = randomBot(B, opts.randomTrials ?? MEASURE_BUDGET.random, rng);
  const greedy = greedyBot(B, opts.greedyTrials ?? MEASURE_BUDGET.greedy, rng);
  const plan = dropsToPlan(B, def.solution);
  const info = analyzeSolution(B, plan);
  let needsTiming: boolean | null = null;
  if (opts.needsTimingHint !== undefined && opts.needsTimingHint !== null) needsTiming = opts.needsTimingHint;
  else {
    const t0 = solve(B, { onlyT0: true, nodeBudget: opts.t0Budget ?? MEASURE_BUDGET.t0, maxSolutions: 1 });
    if (t0.noWait) needsTiming = false;
    else if (t0.complete) needsTiming = true;
  }
  let solutions: number | null = null;
  let complete = false;
  const sr = solve(B, { nodeBudget: opts.nodeBudget ?? MEASURE_BUDGET.node, maxSolutions: 5000 });
  if (sr.complete) {
    solutions = sr.solutions;
    complete = true;
  }
  const mech = usesOf(def, info).length;
  let cells = 0;
  for (let i = 0; i < B.n; i++) if (!B.wall[i]) cells++;
  const m: Metrics = {
    random, greedy, solutions, complete, needsTiming,
    timedDrops: info.timedDrops, settleTick: info.settleTick, targets: B.targets.length + B.whites.length,
    inks: B.inkC.length, cells, diff: 0,
  };
  m.diff = difficultyScore({ random, greedy, solutions, needsTiming, timedDrops: info.timedDrops, inks: m.inks, cells, mechCount: mech, targets: m.targets });
  return m;
}

// ---------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------

export function solutionString(def: LevelDef): string {
  return def.solution.map((d, k) => def.inks[k] + '@' + d.x + ',' + d.y + (d.t ? ' t' + d.t : '')).join(' ');
}

/** Structural checks that do not depend on campaign position. */
export function basicErrors(def: LevelDef, limits = LIMITS): string[] {
  const errs: string[] = [];
  let L: ParsedLevel;
  try {
    L = parseLevel(def);
  } catch (e) {
    return ['parse: ' + (e as Error).message];
  }
  if (L.w < limits.minW || L.w > limits.maxW) errs.push('width ' + L.w);
  if (L.h < limits.minH || L.h > limits.maxH) errs.push('height ' + L.h);
  if (def.inks.length < limits.minInks || def.inks.length > limits.maxInks) errs.push('inks ' + def.inks.length);
  if (def.solution.length !== def.inks.length) errs.push('solution uses ' + def.solution.length + ' of ' + def.inks.length + ' inks');
  const nt = L.targets.length + L.whites.length;
  if (nt < limits.minTargets || nt > limits.maxTargets) errs.push('goal cells ' + nt);
  const B = makeBoard(L);
  errs.push(...planInputErrors(dropsToPlan(B, def.solution)));
  const r = runSolution(def, def.solution);
  if (!r.ok) errs.push('runSolution failed: ' + (r.errors.join('; ') || 'fail tick ' + r.failTick) + '\n' + r.sim.ascii());
  if (r.ticks > limits.settleTick) errs.push('settles at tick ' + r.ticks + ' > ' + limits.settleTick);
  return errs;
}

/** FS vs Sim on random plans; returns number of mismatches. */
export function crossCheck(defs: LevelDef[], plansPer: number, seed = 7): number {
  const rng = mulberry32(seed);
  let bad = 0;
  for (const def of defs) {
    const B = makeBoard(def);
    for (let k = 0; k < plansPer; k++) {
      const { plan } = randomTrial({ ...B, goal: new Uint8Array(B.n), targets: [], whites: [] } as Board, rng);
      if (plan.length < B.inkC.length) continue;
      const a = play({ ...B, goal: new Uint8Array(B.n), targets: [], whites: [] } as Board, plan, false);
      const sim = new Sim({ ...def, goal: def.goal.map((r) => r.replace(/[^ ]/g, '.').replace(/ /g, '.')) });
      const pend = plan.slice();
      while (true) {
        while (pend.length && pend[0].t <= sim.tick) sim.drop(pend.shift()!.i);
        if (!pend.length && sim.settled()) break;
        if (sim.tick > 300) break;
        sim.step();
      }
      let same = sim.tick === a.sim.tick;
      for (let i = 0; i < B.n && same; i++) if (sim.ink[i] !== a.sim.ink[i] || sim.seed[i] !== a.sim.seed[i]) same = false;
      if (!same) {
        bad++;
        if (bad < 4) console.log('MISMATCH', def.id, JSON.stringify(plan), '\n' + sim.ascii() + '\n--\n' + a.sim.ascii());
      }
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export interface ReportRow { def: LevelDef & { tier?: string }; metrics: Metrics; uses: MechanicKey[] }

const pct = (x: number) => (x * 100).toFixed(x < 0.1 ? 2 : 1);

export function buildReport(rows: ReportRow[]): string {
  const out: string[] = [];
  out.push('# Inkbloom level report');
  out.push('');
  out.push('Generated by `tools/gen-levels.ts` / `tools/verify-levels.ts`. Bots: random bot 2000 trials, greedy bot 300 trials (seeded by the level content).');
  out.push('`needs timing`: yes = proven that no all-t=0 solution exists (exhaustive), no = a no-wait solution exists, ? = search too large.');
  out.push('`solutions`: canonical solutions found by the exhaustive solver (cell x beat; "-" = search too large).');
  out.push('');
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const g = r.def.tier ? 'Daily · ' + r.def.tier : 'Chapter ' + r.def.id.slice(1, r.def.id.indexOf('-'));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  out.push('## Summary');
  out.push('');
  out.push('Bot ranges leave out the intro levels and the c1-01..c1-04 tutorial (they are meant to be easy).');
  out.push('');
  out.push('| group | levels | avg diff | needs timing | ≥2 timed drops | random % (min–max) | greedy % (min–max) | max inks | max board |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const [g, rs] of groups) {
    const avg = rs.reduce((a, r) => a + r.metrics.diff, 0) / rs.length;
    const nt = rs.filter((r) => r.metrics.needsTiming === true).length;
    const t2 = rs.filter((r) => r.metrics.timedDrops >= 2).length;
    const graded = rs.filter((r) => !r.def.intro && !/^c1-0[1-4]$/.test(r.def.id));
    const rnd = graded.map((r) => r.metrics.random), grd = graded.map((r) => r.metrics.greedy);
    const mi = Math.max(...rs.map((r) => r.metrics.inks));
    const mb = rs.reduce((b, r) => (r.def.map[0].length * r.def.map.length > b[0] * b[1] ? [r.def.map[0].length, r.def.map.length] : b), [0, 0]);
    out.push('| ' + g + ' | ' + rs.length + ' | ' + avg.toFixed(1) + ' | ' + nt + ' (' + Math.round((nt * 100) / rs.length) + '%) | ' + t2 + ' (' + Math.round((t2 * 100) / rs.length) + '%) | ' + pct(Math.min(...rnd)) + '–' + pct(Math.max(...rnd)) + ' | ' + pct(Math.min(...grd)) + '–' + pct(Math.max(...grd)) + ' | ' + mi + ' | ' + mb[0] + '×' + mb[1] + ' |');
  }
  for (const [g, rs] of groups) {
    out.push('');
    out.push('## ' + g);
    out.push('');
    out.push('| id | size | inks | tag | intro | diff | random % | greedy % | needs timing | timed | solutions | uses | solution |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rs) {
      const d = r.def, m = r.metrics;
      const nt = m.needsTiming === true ? 'yes' : m.needsTiming === false ? 'no' : '?';
      out.push('| ' + d.id + ' | ' + d.map[0].length + '×' + d.map.length + ' | ' + d.inks.join(' ') + ' | ' + (d.tag || '') + ' | ' + (d.intro || '') + (d.guided ? ' (guided)' : '') + ' | ' + m.diff + ' | ' + pct(m.random) + ' | ' + pct(m.greedy) + ' | ' + nt + ' | ' + m.timedDrops + ' | ' + (m.solutions === null ? '-' : m.solutions >= 5000 ? '5000+' : m.solutions) + ' | ' + r.uses.filter((u) => u !== 'drop').join(' ') + ' | `' + solutionString(d) + '` |');
    }
  }
  out.push('');
  return out.join('\n');
}
