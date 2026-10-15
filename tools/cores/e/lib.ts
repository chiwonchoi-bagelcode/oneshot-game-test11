/*
 * Core E level analysis (Node only): the original rules, but the first ink's spot is given.
 *
 *  - solveFrom(): exhaustive canonical solver (cell x beat) with the first drop forced to the
 *    marked cell on beat 0 (or free, to check that the marked start is the one that works).
 *  - Bots that play *after* the given first drop: random (mindless tapping, random waits) and
 *    greedy (drops each ink on/next to a matching target as soon as it can, never thinks about time).
 *  - Badges: what the arrival countdown shows right after the first drop (the evidence the player
 *    reads to infer the rest).
 *
 * Uses the fast simulator FS from tools/level-lib.ts (proven identical to src/core/sim.ts) for the
 * searches; the verifier always re-checks stored solutions with the real Sim (runSolution).
 */
import { FS, makeBoard, dropsToPlan, mulberry32, LIMITS, type Board, type Plan, type Rng } from '../../level-lib.ts';
import { WHITE, type LevelDef } from '../../../src/core/sim.ts';

export interface SolveOut {
  solutions: number;
  complete: boolean;
  nodes: number;
  examples: Plan[];
  /** Solutions where every drop is on beat 0. */
  t0: number;
  /** First-drop cells used by the solutions (free search). */
  firsts: Map<number, number>;
}

function hopeless(s: FS): boolean {
  const B = s.B;
  let avail = 0;
  for (let q = s.pi; q < B.inkC.length; q++) avail |= B.inkC[q];
  for (const id of s.act) avail |= s.wc[id];
  for (const t of B.targets) {
    if (s.ink[t]) continue;
    if ((B.goal[t] & avail) !== B.goal[t]) return true;
  }
  return false;
}

export interface SolveOpts { first?: number | null; nodeBudget?: number; maxWait?: number; maxTick?: number; keep?: number; maxSolutions?: number }

/**
 * Canonical solutions: one drop per live beat (any number on beat 0), no idle waiting on a settled
 * board, identical consecutive inks on the same beat counted once. first: forced first cell (beat 0);
 * null = any first cell.
 */
export function solveFrom(B: Board, opts: SolveOpts = {}): SolveOut {
  const budget = opts.nodeBudget ?? 4e6;
  const maxWait = opts.maxWait ?? LIMITS.maxWait;
  const maxTick = opts.maxTick ?? 24;
  const keep = opts.keep ?? 0;
  const maxSol = opts.maxSolutions ?? 1e9;
  const K = B.inkC.length;
  const T = B.targets.length;
  const res: SolveOut = { solutions: 0, complete: true, nodes: 0, examples: [], t0: 0, firsts: new Map() };
  const plan: Plan = [];
  const bufs: number[][] = [];
  for (let k = 0; k < 64; k++) bufs.push([]);
  let abort = false;
  const noWhites = B.whites.length === 0;

  function leaf(s: FS) {
    for (;;) {
      if (s.bad) return;
      if (s.met === T && noWhites) break;
      if (s.settled()) break;
      if (hopeless(s)) return;
      s.step();
    }
    if (s.met !== T || s.bad) return;
    res.solutions++;
    if (plan.every((p) => p.t === 0)) res.t0++;
    res.firsts.set(plan[0].i, (res.firsts.get(plan[0].i) || 0) + 1);
    if (res.examples.length < keep) res.examples.push(plan.slice());
    if (res.solutions >= maxSol) abort = true;
  }

  function dfs(s: FS, depth: number) {
    if (abort) return;
    if (++res.nodes > budget) {
      res.complete = false;
      abort = true;
      return;
    }
    if (s.bad) return;
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
      const cells = s.droppable(bufs[depth % 64]).slice();
      for (const i of cells) {
        if (i < minIdx) continue;
        const g = B.goal[i];
        if (g && g !== c) continue;
        plan.push({ i, t: s.tick });
        const s2 = s.clone();
        s2.drop(i);
        dfs(s2, depth + 1);
        plan.pop();
        if (abort) return;
      }
    }
    if (s.pi > 0 && s.tick + 1 <= s.lastDrop + maxWait && s.tick + 1 <= maxTick && !s.settled()) {
      const s2 = s.clone();
      s2.step();
      if (!s2.bad) dfs(s2, depth + 1);
    }
  }

  const s0 = new FS(B);
  if (opts.first !== undefined && opts.first !== null) {
    if (!s0.canDrop(opts.first)) return res;
    plan.push({ i: opts.first, t: 0 });
    s0.drop(opts.first);
    dfs(s0, 1);
  } else dfs(s0, 0);
  return res;
}

/** Random tapping after the given first drop: random cells, random waits (1-5 beats), sometimes on beat 0. */
export function randomAfterFirst(B: Board, first: number, trials: number, rng: Rng): number {
  let wins = 0;
  const buf: number[] = [];
  const K = B.inkC.length;
  for (let n = 0; n < trials; n++) {
    const s = new FS(B);
    s.drop(first);
    let ok = !s.bad;
    for (let q = 1; q < K && ok; q++) {
      const waits = q === 1 && rng() < 0.25 ? 0 : 1 + Math.floor(rng() * 5);
      for (let k = 0; k < waits && ok; k++) {
        s.step();
        if (s.bad) ok = false;
      }
      if (!ok) break;
      const cells = s.droppable(buf);
      if (!cells.length) { ok = false; break; }
      s.drop(cells[Math.floor(rng() * cells.length)]);
      if (s.bad) ok = false;
    }
    while (ok && !s.settled()) {
      s.step();
      if (s.bad) ok = false;
    }
    if (ok && s.won()) wins++;
  }
  return wins / trials;
}

/** Greedy after the given first drop: each ink on (or next to) a matching target, one per beat, no timing thought. */
export function greedyAfterFirst(B: Board, first: number, trials: number, rng: Rng): number {
  let wins = 0;
  const buf: number[] = [];
  const K = B.inkC.length;
  for (let n = 0; n < trials; n++) {
    const s = new FS(B);
    s.drop(first);
    let ok = !s.bad;
    for (let q = 1; q < K && ok; q++) {
      const waits = rng() < 0.3 ? 0 : 1 + Math.floor(rng() * 2);
      for (let k = 0; k < Math.max(waits, s.tick > 0 || q > 1 ? 1 : 0) && ok; k++) {
        s.step();
        if (s.bad) ok = false;
      }
      if (!ok) break;
      const c = B.inkC[q];
      const open = s.droppable(buf).slice();
      const cells: number[] = [], wts: number[] = [];
      for (const i of open) {
        const g = B.goal[i];
        if (g && g !== c) continue;
        let w = g === c ? 4 : 0;
        for (let k = 0; k < 4; k++) {
          const m = B.nb[i * 4 + k];
          if (m < 0) continue;
          const gm = B.goal[m];
          if (!gm || gm === WHITE) continue;
          if (gm === c) w = Math.max(w, 2);
          else if (gm & c) w = Math.max(w, 1);
        }
        if (w) { cells.push(i); wts.push(w); }
      }
      let pick: number;
      if (cells.length) {
        let tot = 0;
        for (const x of wts) tot += x;
        let r = rng() * tot, j = 0;
        while (j < cells.length - 1 && r >= wts[j]) { r -= wts[j]; j++; }
        pick = cells[j];
      } else {
        const o = open.filter((x) => !B.goal[x] || B.goal[x] === c);
        if (!o.length) { ok = false; break; }
        pick = o[Math.floor(rng() * o.length)];
      }
      s.drop(pick);
      if (s.bad) ok = false;
    }
    while (ok && !s.settled()) {
      s.step();
      if (s.bad) ok = false;
    }
    if (ok && s.won()) wins++;
  }
  return wins / trials;
}

export { arrivalBadges as badgesOf } from '../../../src/cores/e/badges.ts';

export function firstIdx(def: LevelDef): number {
  const w = def.map[0].length;
  return def.solution[0].y * w + def.solution[0].x;
}

export function boardOf(def: LevelDef): Board {
  return makeBoard(def);
}

export { dropsToPlan, mulberry32 };

export function planStr(B: Board, p: Plan, inks: string[]): string {
  return p.map((d, k) => inks[k] + '@' + (d.i % B.w) + ',' + Math.floor(d.i / B.w) + 't' + d.t).join(' ');
}
