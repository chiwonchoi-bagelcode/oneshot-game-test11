/*
 * Candidate generator for core A stages.
 *   node tools/cores/a/gen.ts <w> <h> <inks comma list> [count=6] [walls=0..1] [sparse] [seed]
 * Drops random placements (each ink must overlap another for a mix unless they share a colour),
 * derives the picture, makes it unique with clean marks, and prints the best candidates as specs.
 */
import { build, type Spec } from './lib.ts';
import { parseLevel } from '../../../src/core/sim.ts';
import { paint, rng, type Placed } from '../../../src/cores/a/rules.ts';

const [W, H, INKS, COUNT = '6', WALLS = '0', SPARSE = '', SEED = '1', SHOW = ''] = process.argv.slice(2);
const w = +W, h = +H, inks = INKS.split(','), want = +COUNT, wallRate = +WALLS;
const r = rng(+SEED * 7919);

function wallMap(): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array(w).fill('.'));
  if (wallRate > 0) {
    // A few straight wall segments (2..4 long).
    const segs = Math.round(wallRate * 4);
    for (let s = 0; s < segs; s++) {
      const horiz = r() < 0.5, len = 2 + Math.floor(r() * 3);
      const x0 = Math.floor(r() * w), y0 = Math.floor(r() * h);
      for (let k = 0; k < len; k++) {
        const x = horiz ? x0 + k : x0, y = horiz ? y0 : y0 + k;
        if (x < w && y < h) g[y][x] = '#';
      }
    }
  }
  return g.map((row) => row.join(''));
}

const out: { spec: Spec; score: number; report: string }[] = [];
for (let tries = 0; tries < 2500 && out.length < want * 3; tries++) {
  const map = wallMap();
  const L = parseLevel({ id: 'g', map, goal: map.map((x) => x.replace(/./g, '.')), inks, solution: [] });
  const free: number[] = [];
  for (let i = 0; i < w * h; i++) if (!L.wall[i]) free.push(i);
  const drops: Placed[] = [];
  const used = new Set<number>();
  for (let k = 0; k < inks.length; k++) {
    let i = free[Math.floor(r() * free.length)];
    for (let g = 0; g < 30 && used.has(i); g++) i = free[Math.floor(r() * free.length)];
    used.add(i);
    drops.push({ idx: i, k });
  }
  if (drops.some((d) => { const x = d.idx % w, y = Math.floor(d.idx / w); return x === 0 || y === 0 || x === w - 1 || y === h - 1; })) continue;
  {
  }
  const ink = paint(L, drops);
  let painted = 0, mixed = 0, mud = 0;
  for (let i = 0; i < ink.length; i++) {
    if (L.wall[i]) continue;
    if (ink[i]) painted++;
    if (ink[i] && ink[i] !== 1 && ink[i] !== 2 && ink[i] !== 4) mixed++;
    if (ink[i] === 7) mud++;
  }
  if (mud || mixed < 2 || painted > free.length * 0.72) continue;
  // Every ink must show some own cell (not entirely buried under others).
  const plan = map.map((row) => row.split(''));
  for (const d of drops) plan[Math.floor(d.idx / w)][d.idx % w] = String(d.k);
  const spec: Spec = { id: 'g' + tries, plan: plan.map((x) => x.join('')), inks, maxClean: 6 };
  if (SPARSE) { spec.sparse = +SPARSE; spec.seed = tries; }
  if (SHOW) spec.show = 'mix';
  let b;
  try { b = build(spec); } catch { continue; }
  const m = b.metrics;
  if (m.solutions !== 1 || m.fewer || b.report.includes('NOT FOUND') || m.greedy > 0.35) continue;
  const clean = b.def.goal.join('').split('w').length - 1;
  const score = (1 - m.greedy) * 20 + mixed * 0.8 - clean * 1.5 - Math.abs(painted / free.length - 0.5) * 10;
  out.push({ spec, score, report: b.report });
}
out.sort((a, b) => b.score - a.score);
for (const o of out.slice(0, want)) {
  console.log(o.report);
  console.log('  score ' + o.score.toFixed(1));
  console.log('  plan: ' + JSON.stringify(o.spec.plan) + (o.spec.sparse !== undefined ? ` sparse ${o.spec.sparse} seed ${o.spec.seed}` : '') + '\n');
}
