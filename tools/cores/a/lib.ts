/*
 * Core A level tooling: turns a design spec (map with the intended drops marked as digits) into a
 * LevelDef whose goal is the picture those drops paint, adds the fewest clean cells needed to make
 * that the only solution, and measures the level.
 */
import { parseLevel, CODE_TO_CHAR, WHITE, type LevelDef, type Drop } from '../../../src/core/sim.ts';
import { paint, solve, mindless, rng, greedy, solvableWithFewer, safeCells, placeable, reach, type Placed } from '../../../src/cores/a/rules.ts';

export interface Spec {
  id: string;
  /** Map rows: '.' paper, '#' wall, ' ' outside, digit k = ink k of the solution is dropped here. */
  plan: string[];
  inks: string[];
  /**
   * Optional goal mask rows: '?' = this cell is not a target even if painted ('.' in the goal),
   * 'w' = must stay clean, 'x' = never add a clean mark here, '!' = always keep as a target,
   * anything else = automatic.
   */
  mask?: string[];
  /** Clean marks: 'auto' adds the fewest needed for a unique answer (default), 'none' adds none. */
  clean?: 'auto' | 'none';
  intro?: string;
  guided?: boolean;
  tag?: LevelDef['tag'];
  coach?: string;
  /** Accept this many distinct solutions (default 1). */
  allow?: number;
  /** Keep about this fraction of the painted cells as targets (hiding the rest), if still unique. */
  sparse?: number;
  seed?: number;
  /** 'mix' = only mixed cells (and '!' cells) are targets. */
  show?: 'mix';
  /** Most clean marks allowed (default unlimited). */
  maxClean?: number;
  /** Extra solution drops [k, x, y] (e.g. a drop stacked on another drop's cell). */
  extra?: [number, number, number][];
}

export interface Built {
  def: LevelDef;
  report: string;
  metrics: { greedy: number; fits: number[]; solutions: number; random: number; safe: number; fewer: boolean; branch: number; cells: number; nodes: number };
}

function planToMap(plan: string[]): { map: string[]; drops: { x: number; y: number; k: number }[] } {
  const drops: { x: number; y: number; k: number }[] = [];
  const map = plan.map((row, y) => row.split('').map((ch, x) => {
    if (/[0-9]/.test(ch)) { drops.push({ x, y, k: +ch }); return '.'; }
    return ch;
  }).join(''));
  drops.sort((a, b) => a.k - b.k);
  return { map, drops };
}

export function build(spec: Spec): Built {
  const { map, drops } = planToMap(spec.plan);
  for (const [k, x, y] of spec.extra || []) drops.push({ x, y, k });
  drops.sort((a, b) => a.k - b.k);
  const h = map.length, w = map[0].length;
  for (const r of map) if (r.length !== w) throw new Error(spec.id + ': ragged map');
  if (drops.length !== spec.inks.length) throw new Error(spec.id + ': ' + drops.length + ' drops for ' + spec.inks.length + ' inks');
  const blank = map.map((r) => r.replace(/./g, '.'));
  const L0 = parseLevel({ id: spec.id, map, goal: blank, inks: spec.inks, solution: [] });
  const placed: Placed[] = drops.map((d) => ({ idx: d.y * w + d.x, k: d.k }));
  const ink = paint(L0, placed);
  const goal: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const i = y * w + x, m = spec.mask?.[y]?.[x] ?? '.';
      if (L0.wall[i]) { row.push('.'); continue; }
      if (m === 'w') { row.push('w'); continue; }
      const pure = ink[i] === 1 || ink[i] === 2 || ink[i] === 4;
      if (ink[i] && m !== '?' && !(spec.show === 'mix' && pure && m !== '!')) row.push(CODE_TO_CHAR[ink[i]]);
      else row.push('.');
    }
    goal.push(row);
  }
  const mkDef = (): LevelDef => ({
    id: spec.id,
    map,
    goal: goal.map((r) => r.join('')),
    inks: spec.inks,
    solution: drops.map((d) => ({ x: d.x, y: d.y, t: 0, k: d.k })),
    ...(spec.intro ? { intro: spec.intro } : {}),
    ...(spec.guided ? { guided: true } : {}),
    ...(spec.tag ? { tag: spec.tag } : {}),
    ...(spec.coach ? { coach: spec.coach } : {}),
  });
  const allow = spec.allow ?? 1;
  const maxClean = spec.maxClean ?? 99;
  let def = mkDef();
  let L = parseLevel(def);
  let res = solve(L, 400);
  const countClean = () => goal.reduce((n, r) => n + r.filter((c) => c === 'w').length, 0);
  /** Greedy: add the clean marks that rule out the most other answers. */
  const uniquify = (reveal = !!spec.show): boolean => {
    for (let guard = 0; guard < 40 && res.count > allow; guard++) {
      if (spec.clean === 'none') return false;
      const alts = allSolutions(L).map((sol) => paint(L, sol));
      let best = -1, bestKill = 0, bestReveal = false;
      for (let i = 0; i < w * h; i++) {
        const x = i % w, y = (i - x) / w;
        const m = spec.mask?.[y]?.[x];
        if (L.wall[i] || goal[y][x] !== '.' || m === 'x') continue;
        if (!ink[i]) {
          if (countClean() >= maxClean) continue;
          let kill = 0;
          for (const a of alts) if (a[i]) kill++;
          if (kill > bestKill) { bestKill = kill; best = i; bestReveal = false; }
        } else if (reveal && m !== '?') {
          let kill = 0;
          for (const a of alts) if (a[i] !== ink[i]) kill++;
          if (kill > bestKill + 1) { bestKill = kill; best = i; bestReveal = true; }
        }
      }
      if (best < 0) return false;
      const bx = best % w;
      goal[(best - bx) / w][bx] = bestReveal ? CODE_TO_CHAR[ink[best]] : 'w';
      def = mkDef();
      L = parseLevel(def);
      res = solve(L, 400);
    }
    return res.count <= allow;
  };
  uniquify();
  if (spec.sparse !== undefined) {
    // Hide targets (keep about `sparse` of them) while the answer stays unique.
    const r = rng(spec.seed ?? 1);
    const tg = L.targets.slice();
    for (let i = tg.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [tg[i], tg[j]] = [tg[j], tg[i]]; }
    const keep = Math.ceil(tg.length * spec.sparse);
    let shown = tg.length;
    for (const t of tg) {
      if (shown <= keep) break;
      const x = t % w, y = (t - x) / w;
      if (spec.mask?.[y]?.[x] === '!') continue;
      const before = goal.map((row) => row.slice());
      goal[y][x] = '.';
      def = mkDef(); L = parseLevel(def); res = solve(L, 400);
      if (uniquify()) shown--;
      else {
        for (let yy = 0; yy < h; yy++) goal[yy] = before[yy];
        def = mkDef(); L = parseLevel(def); res = solve(L, 400);
      }
    }
  }
  const intended = paint(L, placed);
  const ok = res.solutions.some((s) => same(paint(L, s), intended));
  const mm = mindless(L, 6000);
  const gr = greedy(L, 120);
  const fewer = solvableWithFewer(L);
  const branch = L.inks.map((_, k) => safeCells(L, k).length);
  // Useful fits: safe spots that also paint at least one target needing this colour.
  const fits = L.inks.map((spec, k) => safeCells(L, k).filter((i) => reach(L, i, spec.range).cells.some((j) => L.goal[j] && L.goal[j] !== WHITE && (L.goal[j] & spec.c))).length);
  const cells = L.targets.length;
  const lines: string[] = [];
  lines.push(`${spec.id}  ${w}x${h}  inks ${spec.inks.join(' ')}  targets ${cells} clean ${L.whites.length}`);
  lines.push(`  solutions ${res.count}${res.count > allow ? '  <-- NOT UNIQUE' : ''}${ok ? '' : '  <-- INTENDED NOT FOUND'}  fewer-inks ${fewer ? 'YES <-- an ink is not needed' : 'no'}`);
  lines.push(`  greedy ${(gr * 100).toFixed(0)}%  random ${(mm.random * 100).toFixed(2)}%  safe ${(mm.safe * 100).toFixed(1)}%  fits ${fits.join('/')}  nodes ${res.nodes}`);
  for (let y = 0; y < h; y++) {
    let a = '', b = '';
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      a += L.hole[i] ? ' ' : L.wall[i] ? '#' : spec.plan[y][x].match(/[0-9]/) ? spec.plan[y][x] : '.';
      b += L.hole[i] ? ' ' : L.wall[i] ? '#' : def.goal[y][x];
    }
    lines.push('   ' + a + '   ' + b);
  }
  if (res.count > 1) {
    for (const s of res.solutions.slice(0, 3)) {
      lines.push('   alt: ' + s.map((p) => L.inks[p.k] && `${spec.inks[p.k]}@${p.idx % w},${Math.floor(p.idx / w)}`).join(' '));
    }
  }
  return { def, report: lines.join('\n'), metrics: { greedy: gr, fits, solutions: res.count, random: mm.random, safe: mm.safe, fewer, branch: branch.reduce((a, b) => a * b, 1), cells, nodes: res.nodes } };
}

function allSolutions(L: ReturnType<typeof parseLevel>): Placed[][] {
  // solve() keeps only 12 samples; collect more for the greedy clean-cell choice.
  const out: Placed[][] = [];
  const res = solveAll(L, 400, out);
  void res;
  return out;
}

function solveAll(L: ReturnType<typeof parseLevel>, cap: number, out: Placed[][]): number {
  const ks = L.inks.map((_, k) => k);
  const sig = (k: number) => L.inks[k].c * 100 + L.inks[k].range;
  const order = ks.slice().sort((a, b) => sig(a) - sig(b) || a - b);
  const cand = order.map((k) => safeCells(L, k));
  const n = L.w * L.h;
  const ink = new Uint8Array(n), used = new Uint8Array(n);
  const cur: Placed[] = [];
  const rec = (p: number, minCell: number): void => {
    if (out.length >= cap) return;
    if (p === order.length) {
      let ok = true;
      for (const i of L.targets) if (ink[i] !== L.goal[i]) { ok = false; break; }
      if (ok) for (const i of L.whites) if (ink[i]) { ok = false; break; }
      if (ok) for (let i = 0; i < n; i++) if (ink[i] === 7) { ok = false; break; }
      if (ok) out.push(cur.slice());
      return;
    }
    const k = order[p], spec = L.inks[k];
    const sameSig = p > 0 && sig(order[p - 1]) === sig(k);
    for (const i of cand[p]) {
      if (used[i] || (sameSig && i <= minCell)) continue;
      const cells = reach(L, i, spec.range).cells;
      const saved = cells.map((j) => ink[j]);
      let bad = false;
      for (const j of cells) { ink[j] |= spec.c; if (ink[j] === 7) bad = true; }
      if (!bad) { used[i] = 1; cur.push({ idx: i, k }); rec(p + 1, i); cur.pop(); used[i] = 0; }
      cells.forEach((j, q) => (ink[j] = saved[q]));
    }
  };
  rec(0, -1);
  return out.length;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function toDrops(def: LevelDef): Placed[] {
  const w = def.map[0].length;
  return def.solution.map((d: Drop, i) => ({ idx: d.y * w + d.x, k: d.k ?? i }));
}

export { placeable, WHITE };
