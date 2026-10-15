/*
 * Core B solver: counts every way to draw a level (per colour, strokes are independent: each
 * colour's sources must cover exactly the cells whose goal contains that colour, one simple path
 * per source starting on it), finds an example solution, and measures how forgiving a level is.
 *
 *   import { analyze } from './solver.ts';
 */
import { prepare, neighbors, type BLevel } from '../../../src/cores/b/rules.ts';
import type { LevelDef } from '../../../src/core/sim.ts';

export interface ColorReport {
  c: number;
  sources: number;
  cells: number;
  count: number;
  capped: boolean;
  example: number[][] | null;
  /** Share of random "fill without planning" walks (inside the right cells) that succeed. */
  greedy: number;
  /** Dead-end cells (one neighbour in the region) that aren't sources: forced stroke ends. */
  deadEnds: number;
}

export interface LevelReport {
  id: string;
  w: number;
  h: number;
  cells: number;
  colors: ColorReport[];
  /** Product of per-colour solution counts (capped counts give a lower bound). */
  solutions: number;
  capped: boolean;
  /** Probability that random in-region greedy play solves every colour. */
  greedy: number;
  /** Strokes of one full solution, in source order. */
  example: number[][] | null;
}

export function colorRegion(lv: BLevel, c: number): number[] {
  return lv.cells.filter((i) => lv.goal[i] & c);
}

export function countCovers(lv: BLevel, c: number, cap = 100000, nodeCap = 4e6): { count: number; capped: boolean; example: number[][] | null } {
  const region = new Uint8Array(lv.n);
  for (const i of colorRegion(lv, c)) region[i] = 1;
  const srcs = lv.sources.map((s, k) => ({ ...s, k })).filter((s) => s.c === c);
  const visited = new Uint8Array(lv.n);
  let remaining = 0;
  for (let i = 0; i < lv.n; i++) if (region[i]) remaining++;
  for (const s of srcs) {
    if (!region[s.idx]) return { count: 0, capped: false, example: null };
    visited[s.idx] = 1;
    remaining--;
  }
  const NB = lv.cells.map(() => [] as number[]);
  const nbOf: number[][] = [];
  for (let i = 0; i < lv.n; i++) nbOf[i] = region[i] ? neighbors(lv, i).filter((j) => region[j]) : [];
  void NB;
  let count = 0, nodes = 0, capped = false;
  let example: number[][] | null = null;
  const paths: number[][] = srcs.map((s) => [s.idx]);
  const isFutureSrc = new Uint8Array(lv.n);

  const prune = (k: number, head: number): boolean => {
    // Every unvisited cell must still be reachable and the forced ends must fit.
    for (let j = k + 1; j < srcs.length; j++) isFutureSrc[srcs[j].idx] = 1;
    let ends = 0, bad = false;
    for (let i = 0; i < lv.n && !bad; i++) {
      if (!region[i] || visited[i]) continue;
      let d = 0;
      for (const j of nbOf[i]) if (!visited[j] || j === head || isFutureSrc[j]) d++;
      if (d === 0) bad = true;
      else if (d === 1) ends++;
    }
    if (!bad && ends > srcs.length - k) bad = true;
    if (!bad && remaining > 0) {
      // Connectivity: flood from the head and the future sources.
      const seen = new Uint8Array(lv.n);
      const q: number[] = [head];
      seen[head] = 1;
      for (let j = k + 1; j < srcs.length; j++) { q.push(srcs[j].idx); seen[srcs[j].idx] = 1; }
      let got = 0;
      while (q.length) {
        const i = q.pop()!;
        for (const j of nbOf[i]) {
          if (seen[j] || visited[j]) continue;
          seen[j] = 1;
          got++;
          q.push(j);
        }
      }
      if (got < remaining) bad = true;
    }
    for (let j = k + 1; j < srcs.length; j++) isFutureSrc[srcs[j].idx] = 0;
    return bad;
  };

  const dfs = (k: number): void => {
    if (capped) return;
    if (++nodes > nodeCap) { capped = true; return; }
    const p = paths[k], head = p[p.length - 1];
    if (prune(k, head)) return;
    // End this stroke here.
    if (k === srcs.length - 1) {
      if (remaining === 0) {
        count++;
        if (!example) example = paths.map((q) => q.slice());
        if (count >= cap) capped = true;
      }
    } else dfs(k + 1);
    if (remaining === 0) return;
    for (const j of nbOf[head]) {
      if (visited[j]) continue;
      visited[j] = 1; remaining--; p.push(j);
      dfs(k);
      p.pop(); remaining++; visited[j] = 0;
      if (capped) return;
    }
  };
  if (srcs.length) dfs(0);
  else if (remaining === 0) count = 1;
  return { count, capped, example };
}

/** Random play that knows which cells need the colour but doesn't plan: wander until stuck. */
export function greedyRate(lv: BLevel, c: number, trials = 3000, seed = 7): number {
  const region = new Uint8Array(lv.n);
  for (const i of colorRegion(lv, c)) region[i] = 1;
  const srcs = lv.sources.filter((s) => s.c === c);
  const total = colorRegion(lv, c).length;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let ok = 0;
  const visited = new Uint8Array(lv.n);
  for (let t = 0; t < trials; t++) {
    visited.fill(0);
    let cnt = 0;
    for (const sr of srcs) { visited[sr.idx] = 1; cnt++; }
    srcs.forEach((sr, k) => {
      let head = sr.idx;
      // With several sources of one colour, each one stops at a random moment (or when stuck).
      for (;;) {
        const opts = neighbors(lv, head).filter((j) => region[j] && !visited[j]);
        if (!opts.length) break;
        if (k < srcs.length - 1 && rnd() < 0.2) break;
        head = opts[Math.floor(rnd() * opts.length)];
        visited[head] = 1;
        cnt++;
      }
    });
    if (cnt === total) ok++;
  }
  return ok / trials;
}

export function analyze(def: LevelDef, cap = 100000): LevelReport {
  const lv = prepare(def);
  const colorsUsed = [1, 2, 4].filter((c) => lv.sources.some((s) => s.c === c) || lv.cells.some((i) => lv.goal[i] & c));
  const colors: ColorReport[] = [];
  let solutions = 1, capped = false, greedy = 1;
  const example: number[][] = lv.sources.map((s) => [s.idx]);
  let haveExample = true;
  for (const c of colorsUsed) {
    const region = colorRegion(lv, c);
    const r = countCovers(lv, c, cap);
    const g = greedyRate(lv, c);
    const srcs = lv.sources.map((s, k) => ({ ...s, k })).filter((s) => s.c === c);
    const inR = new Set(region);
    const deadEnds = region.filter((i) => lv.srcAt[i] < 0 && neighbors(lv, i).filter((j) => inR.has(j)).length === 1).length;
    colors.push({ c, sources: srcs.length, cells: region.length, count: r.count, capped: r.capped, example: r.example, greedy: g, deadEnds });
    solutions *= r.count;
    capped = capped || r.capped;
    greedy *= g;
    if (r.example) r.example.forEach((p, j) => { example[srcs[j].k] = p; });
    else haveExample = false;
  }
  return { id: def.id, w: lv.w, h: lv.h, cells: lv.cells.length, colors, solutions, capped, greedy, example: haveExample ? example : null };
}
