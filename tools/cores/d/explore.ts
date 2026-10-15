/*
 * Core D design helper: lists the most interesting ways to play a board (map + wells), so a
 * stage can be built around one of them.
 *   node tools/cores/d/explore.ts '<json {map, wells}>' [--top 8] [--min-drops 2] [--wait] [--decoy]
 * Score favours: mixes on the board, several colours, a wait that matters, unused wells (decoys).
 */
import type { LevelDef } from '../../../src/core/sim.ts';
import { allLeaves, finalBoard, pickGoal, withInks, measureD } from './lib.ts';
import { planToDrops, type PlanDrop } from '../../../src/cores/d/rules.ts';

const args = process.argv.slice(2);
const spec = JSON.parse(args[0]);
const opt = (f: string, d: number) => (args.includes(f) ? +args[args.indexOf(f) + 1] : d);
const TOP = opt('--top', 8);
const MIN_DROPS = opt('--min-drops', 2);
const WANT_WAIT = args.includes('--wait');
const WANT_DECOY = args.includes('--decoy');
const MIN_MIX = opt('--min-mix', 1);

const base: LevelDef = withInks({ id: 'x', map: spec.map, goal: spec.map.map((r: string) => '.'.repeat(r.length)), inks: [], wells: spec.wells, solution: [] });
const leaves = allLeaves(base, opt('--max-t', 7));
console.log('plans:', leaves.length);
const n = spec.wells.length;
interface Cand { plan: PlanDrop[]; score: number; mixes: number; colours: number; maxT: number; sum: number }
const cands: Cand[] = [];
for (const lf of leaves) {
  if (lf.plan.length < MIN_DROPS) continue;
  const F = finalBoard(base, lf.plan);
  let mixes = 0;
  const cols = new Set<number>();
  let mud = 0;
  for (let i = 0; i < F.ink.length; i++) { if (F.mixed[i]) mixes++; if (F.ink[i]) cols.add(F.ink[i]); if (F.ink[i] === 7) mud++; }
  if (mud && !args.includes('--mud')) continue;
  let empty = 0;
  for (let i = 0; i < F.ink.length; i++) if (!F.ink[i] && !F.L.wall[i]) empty++;
  if (empty < opt('--empty', 0)) continue;
  if (mixes < MIN_MIX) continue;
  const maxT = Math.max(...lf.plan.map((p) => p.t));
  const sum = lf.plan.reduce((a, p) => a + p.t, 0);
  if (WANT_WAIT && maxT === 0) continue;
  if (args.includes('--zero') && maxT > 0) continue;
  if (maxT > opt('--maxwait', 9)) continue;
  if (WANT_DECOY && lf.plan.length === n) continue;
  // dead wells: plan leaves a well that got covered? fine.
  const score = Math.min(mixes, 8) * 2 + cols.size * 3 + (maxT > 0 ? 4 : 0) + Math.min(maxT, 3) + (n - lf.plan.length) * 2 - (maxT > 4 ? 6 : 0);
  cands.push({ plan: lf.plan, score, mixes, colours: cols.size, maxT, sum });
}
cands.sort((a, b) => b.score - a.score);
// Show the best few with distinct final boards.
const seen = new Set<string>();
let shown = 0;
for (const c of cands) {
  const F = finalBoard(base, c.plan);
  const key = F.ink.join('');
  if (seen.has(key)) continue;
  seen.add(key);
  const { goal } = pickGoal(base, c.plan, { needWait: c.maxT > 0 && WANT_WAIT, decoyFree: true, whites: opt('--whites', 0) }, leaves);
  const def: LevelDef = { ...base, goal, solution: planToDrops(base, c.plan) };
  const m = measureD(def);
  console.log(`\n#${shown + 1} plan ${JSON.stringify(c.plan)} score ${c.score} mixes ${c.mixes} colours ${c.colours} | sols ${m.solutions} random ${(m.random * 100).toFixed(1)}% preview ${(m.preview * 100).toFixed(0)}%`);
  const a = F.ascii().split('\n');
  for (let y = 0; y < a.length; y++) console.log('  ' + a[y] + '   ' + goal[y]);
  if (++shown >= TOP) break;
}
