/*
 * Core A rules ("where, not when") — pure functions shared by the game, the level tools and tests.
 *
 *  - Each ink has an amount n. Dropped on a cell, it covers every cell within n steps
 *    (up/down/left/right) through paper. Walls and the board edge stop it; other ink doesn't.
 *  - A cell's colour is the mix (bitwise OR) of every ink that covers it: two primaries make a
 *    secondary, all three make mud. The board depends only on WHERE the drops are, never on
 *    when or in which order they were placed.
 *  - Goal cells: a colour (must end exactly that colour) or 'w' (must stay clean). Mud is never
 *    allowed anywhere. Unmarked paper may end any colour except mud.
 *  - A drop can go on any paper cell that isn't a clean cell and doesn't already hold a drop
 *    (ink on the cell doesn't matter: stacking two drops is allowed).
 *
 * Keep this file free of TS-only runtime features: Node runs it with type stripping.
 */
import { WHITE, K, type ParsedLevel } from '../../core/sim.ts';

export interface Placed { idx: number; k: number }

export interface Reach {
  /** Cells covered, in BFS order (ring by ring). */
  cells: number[];
  /** Ring (distance) of each covered cell, parallel to cells. */
  dist: number[];
  /** BFS parent of each covered cell (-1 for the source), parallel to cells. */
  parent: number[];
}

const reachCache = new WeakMap<ParsedLevel, Map<number, Reach>>();

/** Cells an ink of amount `range` covers when dropped on idx. */
export function reach(L: ParsedLevel, idx: number, range: number): Reach {
  let m = reachCache.get(L);
  if (!m) { m = new Map(); reachCache.set(L, m); }
  const key = idx * 64 + Math.min(63, range);
  const hit = m.get(key);
  if (hit) return hit;
  const w = L.w, n = L.w * L.h;
  const seen = new Int16Array(n).fill(-1);
  const cells: number[] = [idx], dist: number[] = [0], parent: number[] = [-1];
  seen[idx] = 0;
  for (let q = 0; q < cells.length; q++) {
    const i = cells[q], d = dist[q];
    if (d >= range) continue;
    const x = i % w;
    const nbs = [i >= w ? i - w : -1, x < w - 1 ? i + 1 : -1, i + w < n ? i + w : -1, x > 0 ? i - 1 : -1];
    for (const j of nbs) {
      if (j < 0 || L.wall[j] || seen[j] >= 0) continue;
      seen[j] = d + 1;
      cells.push(j); dist.push(d + 1); parent.push(i);
    }
  }
  const r = { cells, dist, parent };
  m.set(key, r);
  return r;
}

/** Can a drop go on this cell (ignoring which cells already hold drops)? */
export function placeable(L: ParsedLevel, idx: number): boolean {
  return idx >= 0 && idx < L.w * L.h && !L.wall[idx] && L.goal[idx] !== WHITE;
}

/** Colour of every cell for a set of placed drops. */
export function paint(L: ParsedLevel, drops: Placed[]): Uint8Array {
  const ink = new Uint8Array(L.w * L.h);
  for (const d of drops) {
    const spec = L.inks[d.k];
    for (const i of reach(L, d.idx, spec.range).cells) ink[i] |= spec.c;
  }
  return ink;
}

/** A cell can no longer become right whatever is added (ink only ever adds colour). */
export function doomed(L: ParsedLevel, ink: Uint8Array, i: number): boolean {
  const c = ink[i];
  if (!c) return false;
  if (c === K) return true;
  const g = L.goal[i];
  if (g === WHITE) return true;
  if (g && (c & ~g)) return true;
  return false;
}

export function doomedCells(L: ParsedLevel, ink: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < ink.length; i++) if (doomed(L, ink, i)) out.push(i);
  return out;
}

/** Every goal holds and nothing is mud. */
export function solved(L: ParsedLevel, ink: Uint8Array): boolean {
  for (const i of L.targets) if (ink[i] !== L.goal[i]) return false;
  for (const i of L.whites) if (ink[i]) return false;
  for (let i = 0; i < ink.length; i++) if (ink[i] === K) return false;
  return true;
}

/** Cells that are wrong on a finished board (all inks placed). */
export function wrongCells(L: ParsedLevel, ink: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < ink.length; i++) {
    if (L.wall[i]) continue;
    const g = L.goal[i];
    if (g === WHITE) { if (ink[i]) out.push(i); }
    else if (g) { if (ink[i] !== g) out.push(i); }
    else if (ink[i] === K) out.push(i);
  }
  return out;
}

export type WrongKind = 'clean' | 'mud' | 'needMix' | 'tooMuch' | 'otherColor' | 'missing';

/** Why a wrong cell is wrong (for the coach line). */
export function wrongKind(L: ParsedLevel, ink: Uint8Array, i: number): WrongKind {
  const g = L.goal[i], c = ink[i];
  if (g === WHITE) return 'clean';
  if (c === K) return 'mud';
  if (!c) return 'missing';
  if ((c & g) === c) return 'needMix'; // a part of the goal colour is there, the rest is missing
  if ((c & g) === g) return 'tooMuch'; // the goal colour plus another one
  return 'otherColor';
}

// ---------------------------------------------------------------- solver (tools + verifier)

export interface SolveResult {
  /** Distinct solutions (identical inks interchangeable), capped at `cap`. */
  count: number;
  solutions: Placed[][];
  /** Search nodes (effort). */
  nodes: number;
}

/** Cells where ink k alone breaks nothing (no clean cell, no foreign colour on a target). */
export function safeCells(L: ParsedLevel, k: number): number[] {
  const out: number[] = [];
  const spec = L.inks[k];
  for (let i = 0; i < L.w * L.h; i++) {
    if (!placeable(L, i)) continue;
    let ok = true;
    for (const j of reach(L, i, spec.range).cells) {
      const g = L.goal[j];
      if (g === WHITE || (g && (spec.c & ~g))) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** All solutions that use every ink (identical inks counted once). */
export function solve(L: ParsedLevel, cap = 50, inkSubset?: number[]): SolveResult {
  const ks = inkSubset || L.inks.map((_, k) => k);
  // Identical inks: force increasing cells to skip permutations.
  const sig = (k: number) => L.inks[k].c * 100 + L.inks[k].range;
  const order = ks.slice().sort((a, b) => sig(a) - sig(b) || a - b);
  const cand = order.map((k) => safeCells(L, k));
  const n = L.w * L.h;
  const ink = new Uint8Array(n);
  const used = new Uint8Array(n);
  const res: SolveResult = { count: 0, solutions: [], nodes: 0 };
  const cur: Placed[] = [];
  // Remaining colour each target still needs, checked at the leaf.
  const rec = (p: number, minCell: number): void => {
    if (res.count >= cap) return;
    res.nodes++;
    if (p === order.length) {
      if (solved(L, ink)) {
        res.count++;
        if (res.solutions.length < 12) res.solutions.push(cur.slice());
      }
      return;
    }
    const k = order[p];
    const spec = L.inks[k];
    const same = p > 0 && sig(order[p - 1]) === sig(k);
    for (const i of cand[p]) {
      if (used[i] || (same && i <= minCell)) continue;
      const cells = reach(L, i, spec.range).cells;
      const saved: number[] = [];
      let bad = false;
      for (const j of cells) {
        saved.push(ink[j]);
        ink[j] |= spec.c;
        if (ink[j] === K) bad = true;
      }
      if (!bad) {
        used[i] = 1;
        cur.push({ idx: i, k });
        rec(p + 1, i);
        cur.pop();
        used[i] = 0;
      }
      for (let q = 0; q < cells.length; q++) ink[cells[q]] = saved[q];
    }
  };
  rec(0, -1);
  return res;
}

/** Smallest number of inks that can solve the level (to check that every ink is needed). */
export function solvableWithFewer(L: ParsedLevel): boolean {
  const all = L.inks.map((_, k) => k);
  for (let drop = 0; drop < all.length; drop++) {
    const sub = all.filter((k) => k !== drop);
    if (solveSubset(L, sub)) return true;
  }
  return false;
}

/** Solutions using only some of the inks (goals hold, mud forbidden). */
function solveSubset(L: ParsedLevel, ks: number[]): boolean {
  return solve(L, 1, ks).count > 0;
}

/** Deterministic PRNG for the metrics. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Mindless-play success rates (Monte Carlo):
 *  random — every ink on a random legal cell.
 *  safe   — every ink, in tray order, on a random cell where it doesn't visibly break anything
 *           given what is already on the board (what a player could do by trial with the
 *           instant red marks, without thinking about the picture).
 */
export function mindless(L: ParsedLevel, trials = 4000, seed = 7): { random: number; safe: number } {
  const r = rng(seed);
  const n = L.w * L.h;
  const legal: number[] = [];
  for (let i = 0; i < n; i++) if (placeable(L, i)) legal.push(i);
  let winR = 0, winS = 0;
  for (let t = 0; t < trials; t++) {
    // random
    const used = new Set<number>();
    const drops: Placed[] = [];
    for (let k = 0; k < L.inks.length; k++) {
      let i = legal[Math.floor(r() * legal.length)];
      for (let g = 0; g < 50 && used.has(i); g++) i = legal[Math.floor(r() * legal.length)];
      used.add(i);
      drops.push({ idx: i, k });
    }
    if (solved(L, paint(L, drops))) winR++;
    // safe
    const ink = new Uint8Array(n);
    const used2 = new Uint8Array(n);
    let ok = true;
    for (let k = 0; k < L.inks.length && ok; k++) {
      const spec = L.inks[k];
      const opts: number[] = [];
      for (const i of legal) {
        if (used2[i]) continue;
        let fine = true;
        for (const j of reach(L, i, spec.range).cells) {
          const c = ink[j] | spec.c, g = L.goal[j];
          if (c === K || g === WHITE || (g && (c & ~g))) { fine = false; break; }
        }
        if (fine) opts.push(i);
      }
      if (!opts.length) { ok = false; break; }
      const i = opts[Math.floor(r() * opts.length)];
      used2[i] = 1;
      for (const j of reach(L, i, spec.range).cells) ink[j] |= spec.c;
    }
    if (ok && solved(L, ink)) winS++;
  }
  return { random: winR / trials, safe: winS / trials };
}

/**
 * Greedy play success (Monte Carlo): at each step the player makes the single move (any ink left,
 * any cell) that fills the most still-needed target colour without breaking anything; ties are
 * random. A high rate means the level falls to matching shapes one ink at a time, without thinking
 * about how the drops interact.
 */
export function greedy(L: ParsedLevel, trials = 200, seed = 5): number {
  const r = rng(seed);
  const n = L.w * L.h;
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    const ink = new Uint8Array(n), used = new Uint8Array(n);
    const left = L.inks.map((_, k) => k);
    while (left.length) {
      let best: [number, number][] = [], bestScore = -1e9;
      const seen = new Set<string>();
      for (const k of left) {
        const spec = L.inks[k];
        const key = spec.c + ':' + spec.range;
        if (seen.has(key)) continue;
        seen.add(key);
        for (let i = 0; i < n; i++) {
          if (!placeable(L, i) || used[i]) continue;
          let sc = 0;
          for (const j of reach(L, i, spec.range).cells) {
            const g = L.goal[j], c = ink[j] | spec.c;
            if (c === K || g === WHITE || (g && (c & ~g))) sc -= 100;
            else if (g && !(ink[j] & spec.c)) sc += 1;
          }
          if (sc > bestScore) { bestScore = sc; best = [[k, i]]; } else if (sc === bestScore) best.push([k, i]);
        }
      }
      const [k, i] = best[Math.floor(r() * best.length)];
      left.splice(left.indexOf(k), 1);
      used[i] = 1;
      for (const j of reach(L, i, L.inks[k].range).cells) ink[j] |= L.inks[k].c;
    }
    if (solved(L, ink)) wins++;
  }
  return wins / trials;
}
