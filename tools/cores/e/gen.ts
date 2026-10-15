/*
 * Core E stage generator (design helper):  node tools/cores/e/gen.ts <sketch> [--n 3000] [--seed 1] [--top 5]
 *
 * Reverse design around the given first drop:
 *   1. a sketch fixes the terrain, the ink queue and (optionally) the first drop
 *   2. every later ink is placed to *answer something the board already shows*: it meets a front
 *      that is on its way (a mix on a cell the badges count down to), beats a front to a cell, or
 *      plugs a front heading for a clean cell — on a beat >= 1 so the player can read the spread
 *   3. goal = the cells those answers create (mixes, raced cells, clean cells) + a few plain cells
 *      chosen greedily until only a handful of (cell, beat) answers remain from the marked start
 *   4. score: few answers, random/greedy play fails, every drop is signposted by a badge it
 *      resolves, the marked start is the only start that works
 * Prints the best candidates as LevelDef lines (pasted into src/cores/e/levels.ts, then verified).
 */
import { Sim, WHITE, isPrimary, CODE_TO_CHAR, type LevelDef, type Drop } from '../../../src/core/sim.ts';
import { arrivalBadges } from '../../../src/cores/e/badges.ts';
import { solveFrom, randomAfterFirst, greedyAfterFirst, boardOf, mulberry32 } from './lib.ts';
import { FS, type Plan } from '../../level-lib.ts';

type Rng = () => number;
export interface Sketch {
  map: string[];
  inks: string[];
  first?: [number, number];
  /** Cells marked clean when nothing reaches them ('w' goals). */
  whites?: number;
  /** Max forced solutions accepted. */
  maxSol?: number;
  /** Max goal cells. */
  maxGoal?: number;
  /** Want at least this many mixed targets. */
  minMix?: number;
  /** Earliest beat for the second drop. */
  minT2?: number;
  /** Ways later inks answer the board: meet (mix), race (claim cells first), plug (short ink before a clean cell). */
  moves?: ('meet' | 'race')[];
  /** Badges right after the first drop: true = must warn somewhere (race / clean cell), false = no warnings. */
  threat?: boolean;
  /** Min partner badges right after the first drop. */
  partners?: number;
}


const ri = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

/** Shortest path lengths over cells that are empty paper now (walls/ink block). */
function dist(sim: Sim, from: number): Int32Array {
  const n = sim.ink.length, d = new Int32Array(n).fill(-1);
  const q = [from];
  d[from] = 0;
  const w = sim.w;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % w;
    const nb = [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1];
    for (const m of nb) {
      if (m < 0 || m >= n || d[m] >= 0 || sim.L.wall[m] || sim.ink[m]) continue;
      d[m] = d[i] + 1;
      q.push(m);
    }
  }
  return d;
}

/** Arrival beat + colour of the current fronts at every empty cell. */
function arrivals(sim: Sim): { beat: Int32Array; col: Uint8Array } {
  const n = sim.ink.length, beat = new Int32Array(n).fill(-1), col = new Uint8Array(n);
  const f = sim.clone();
  for (let k = 0; k < 40 && !f.settled(); k++) {
    f.step();
    for (let i = 0; i < n; i++) if (beat[i] < 0 && f.ink[i] && !sim.ink[i]) { beat[i] = f.tick; col[i] = f.ink[i]; }
  }
  return { beat, col };
}

function stepTo(sim: Sim, t: number) {
  while (sim.tick < t) sim.step();
}

interface Cand { def: LevelDef; sol: number; rnd: number; gre: number; sign: number; share: string; score: number; note: string }

function makePlan(rng: Rng, base: LevelDef, sk: Sketch): Drop[] | null {
  const sim = new Sim(base);
  const open: number[] = [];
  for (let i = 0; i < sim.ink.length; i++) if (sim.canDrop(i)) open.push(i);
  const first = sk.first ? sk.first[1] * sim.w + sk.first[0] : open[Math.floor(rng() * open.length)];
  sim.drop(first);
  const drops: Drop[] = [{ x: first % sim.w, y: Math.floor(first / sim.w), t: 0 }];
  const minT2 = sk.minT2 ?? 2;
  for (let k = 1; k < base.inks.length; k++) {
    const spec = sim.L.inks[k];
    const prevT = drops[drops.length - 1].t;
    const minT = k === 1 ? minT2 : prevT + 1;
    const arr = arrivals(sim);
    const mode = sk.moves ? sk.moves[Math.floor(rng() * sk.moves.length)] : 'meet';
    let done = false;
    for (let tries = 0; tries < 40 && !done; tries++) {
      // Meeting cell: reached by a different primary colour later than minT.
      const cells: number[] = [];
      for (let i = 0; i < arr.beat.length; i++) {
        const a = arr.beat[i];
        if (a <= minT) continue;
        const c = arr.col[i];
        if (mode === 'meet' && (!isPrimary(c) || c === spec.c)) continue;
        if (mode === 'race' && (c === spec.c || !c)) continue;
        cells.push(i);
      }
      if (!cells.length) break;
      const X = cells[Math.floor(rng() * cells.length)];
      const a = arr.beat[X];
      const trial = sim.clone();
      // pick the drop beat, then a cell at the right distance (computed on the board at that beat)
      const b = mode === 'meet' ? ri(rng, minT, a - 1) : ri(rng, minT, Math.max(minT, a - 1));
      stepTo(trial, b);
      if (trial.ink[X]) continue;
      const d = dist(trial, X);
      const need = mode === 'meet' ? a - b : -1;
      const opts: number[] = [];
      for (let i = 0; i < d.length; i++) {
        if (d[i] < 0 || !trial.canDrop(i)) continue;
        if (mode === 'meet' && d[i] !== need) continue;
        if (mode === 'race' && !(d[i] < a - b && d[i] >= 0)) continue;
        if (d[i] > spec.range) continue;
        opts.push(i);
      }
      if (!opts.length) continue;
      const p = opts[Math.floor(rng() * opts.length)];
      trial.drop(p);
      const fc = trial.forecast().sim;
      if (mode === 'meet' && !(fc.mixed[X] && fc.ink[X] === (arr.col[X] | spec.c))) continue;
      if (mode === 'race' && fc.ink[X] !== spec.c) continue;
      // commit
      stepTo(sim, b);
      sim.drop(p);
      drops.push({ x: p % sim.w, y: Math.floor(p / sim.w), t: b });
      done = true;
    }
    if (!done) return null;
  }
  return drops;
}

function finalOf(def: LevelDef, drops: Drop[]): Sim {
  const sim = new Sim(def);
  const pending = drops.slice();
  for (let g = 0; g < 200; g++) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      sim.drop(sim.idx(d.x, d.y));
    }
    if (!pending.length && sim.settled()) break;
    sim.step();
  }
  return sim;
}

function goalRows(base: LevelDef, goal: Map<number, number>): string[] {
  const w = base.map[0].length;
  return base.map.map((row, y) => [...row].map((_, x) => {
    const g = goal.get(y * w + x);
    if (!g) return '.';
    return g === WHITE ? 'w' : CODE_TO_CHAR[g];
  }).join(''));
}

/** Badge-signposting: each later drop resolves a partner/threat badge that was showing before it. */
function signposted(def: LevelDef): number {
  const sim = new Sim(def);
  const pending = def.solution.slice();
  let ok = 0;
  for (let g = 0; g < 200 && pending.length; g++) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      const before = sim.drops.length ? arrivalBadges(sim).filter((b) => b.kind !== 'promise') : [];
      sim.drop(sim.idx(d.x, d.y));
      if (sim.drops.length > 1) {
        const after = arrivalBadges(sim);
        if (before.some((b) => !after.some((a) => a.idx === b.idx && a.kind !== 'promise'))) ok++;
      }
    }
    sim.step();
  }
  return def.solution.length > 1 ? ok / (def.solution.length - 1) : 1;
}

export function evaluate(def: LevelDef, rng: Rng, freeBudget = 2e6): Omit<Cand, 'score' | 'note'> {
  const B = boardOf(def);
  const first = def.solution[0].y * B.w + def.solution[0].x;
  const forced = solveFrom(B, { first, nodeBudget: 1.5e6 });
  const sol = forced.complete ? forced.solutions : 9999;
  const rnd = randomAfterFirst(B, first, 1500, rng);
  const gre = greedyAfterFirst(B, first, 300, rng);
  let share = '?';
  if (freeBudget > 0) {
    const free = solveFrom(B, { first: null, nodeBudget: freeBudget });
    if (free.complete) share = free.solutions === (free.firsts.get(first) || 0) ? 'only' : Math.round(((free.firsts.get(first) || 0) / free.solutions) * 100) + '%';
  }
  return { def, sol, rnd, gre, sign: signposted(def), share };
}

function buildGoal(rng: Rng, base: LevelDef, drops: Drop[], sk: Sketch): LevelDef | null {
  const fin = finalOf(base, drops);
  if (fin.wrongCells().length) return null;
  const goal = new Map<number, number>();
  const n = fin.ink.length;
  for (let i = 0; i < n; i++) if (fin.ink[i] === 7) return null;
  for (let i = 0; i < n; i++) if (fin.mixed[i]) goal.set(i, fin.ink[i]);
  if (goal.size < (sk.minMix ?? 1)) return null;
  // thin out long mixed lines: keep at most 4 mixed targets
  const mixed = [...goal.keys()];
  while (goal.size > 4) goal.delete(mixed.splice(Math.floor(rng() * mixed.length), 1)[0]);
  // clean cells: some never-inked paper
  if (sk.whites) {
    const blank: number[] = [];
    for (let i = 0; i < n; i++) if (!base.map[Math.floor(i / fin.w)][i % fin.w].match(/[# ]/) && !fin.ink[i]) blank.push(i);
    for (let k = 0; k < sk.whites && blank.length; k++) goal.set(blank.splice(Math.floor(rng() * blank.length), 1)[0], WHITE);
    if (!blank.length && goal.size === 0) return null;
  }
  const maxSol = sk.maxSol ?? 4, maxGoal = sk.maxGoal ?? 9;
  for (let round = 0; round < 12; round++) {
    const def: LevelDef = { ...base, goal: goalRows(base, goal), solution: drops };
    const B = boardOf(def);
    const first = drops[0].y * B.w + drops[0].x;
    const res = solveFrom(B, { first, nodeBudget: 6e5, keep: 300 });
    if (!res.complete) return null;
    if (res.solutions <= maxSol) return def;
    if (goal.size >= maxGoal) return null;
    // add the plain cell that rules out the most alternatives
    const finals = res.examples.map((p) => finalOf(base, p.map((q) => ({ x: q.i % B.w, y: Math.floor(q.i / B.w), t: q.t }))).ink);
    let best = -1, bestKill = 0;
    for (let i = 0; i < n; i++) {
      if (goal.has(i) || !fin.ink[i] || fin.mixed[i]) continue;
      let kill = 0;
      for (const f of finals) if (f[i] !== fin.ink[i]) kill++;
      if (kill > bestKill || (kill === bestKill && kill > 0 && rng() < 0.3)) { best = i; bestKill = kill; }
    }
    if (best < 0) return null;
    goal.set(best, fin.ink[best]);
  }
  return null;
}

function score(c: Omit<Cand, 'score' | 'note'>): number {
  let s = 0;
  s += c.sign * 3;
  s -= Math.log2(Math.max(1, c.sol)) * 0.6;
  s -= c.rnd * 30;
  s -= c.gre * 4;
  if (c.share === 'only') s += 1.5;
  const goalN = c.def.goal.join('').replace(/\./g, '').length;
  s -= Math.max(0, goalN - 7) * 0.25;
  s -= Math.max(0, 3 - goalN) * 0.4;
  const ts = c.def.solution.map((d) => d.t);
  for (let k = 1; k < ts.length; k++) s -= Math.max(0, ts[k] - ts[k - 1] - 4) * 0.5;
  if (c.share !== '?' && c.share !== 'only') s += (parseInt(c.share, 10) / 100) * 1.2;
  return s;
}

export function generate(name: string, sk: Sketch, nTry: number, seed: number, top: number): Cand[] {
  const rng = mulberry32(seed);
  const base: LevelDef = { id: 'e-' + name, map: sk.map, goal: sk.map.map((r) => '.'.repeat(r.length)), inks: sk.inks, solution: [] };
  const out: Cand[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < nTry; k++) {
    const drops = makePlan(rng, base, sk);
    if (!drops) continue;
    const def = buildGoal(rng, base, drops, sk);
    if (!def) continue;
    const key = def.goal.join('/') + JSON.stringify(def.solution);
    if (seen.has(key)) continue;
    seen.add(key);
    const s0 = new Sim(def);
    s0.drop(s0.idx(def.solution[0].x, def.solution[0].y));
    const b0 = arrivalBadges(s0);
    const th = b0.some((b) => b.kind === 'threat');
    if (sk.threat !== undefined && th !== sk.threat) continue;
    if (b0.filter((b) => b.kind === 'partner').length < (sk.partners ?? 0)) continue;
    const ev = evaluate(def, rng, 0);
    if (ev.sol < 1 || ev.rnd > 0.08) continue;
    out.push({ ...ev, score: score(ev), note: '' });
  }
  out.sort((a, b) => b.score - a.score);
  const best = out.slice(0, top * 3);
  for (const c of best) {
    const ev = evaluate(c.def, rng, 3e6);
    c.share = ev.share;
    c.score = score(c);
  }
  best.sort((a, b) => b.score - a.score);
  return best.slice(0, top);
}

export function show(c: Cand) {
  const d = c.def;
  const r = finalOf(d, d.solution);
  console.log(`score ${c.score.toFixed(2)} sols ${c.sol} rnd ${(c.rnd * 100).toFixed(1)}% greedy ${(c.gre * 100).toFixed(0)}% sign ${c.sign.toFixed(2)} start ${c.share}`);
  const g = d.goal;
  const a = r.ascii().split('\n');
  for (let y = 0; y < d.map.length; y++) console.log('   ' + d.map[y].replace(/ /g, '_') + '   ' + g[y] + '   ' + a[y]);
  console.log(`  { id: '${d.id}', map: ${JSON.stringify(d.map)}, goal: ${JSON.stringify(d.goal)}, inks: ${JSON.stringify(d.inks)}, solution: [${d.solution.map((s) => `{ x: ${s.x}, y: ${s.y}, t: ${s.t} }`).join(', ')}] },`);
}

// ------------------------------------------------------------------------------------------- CLI
import { SKETCHES as SK } from './sketches.ts';

if (process.argv[1] && process.argv[1].endsWith('gen.ts')) {
  const args = process.argv.slice(2);
  const name = args[0];
  const opt = (k: string, d: number) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
  if (!name || !SK[name]) {
    console.log('sketches:', Object.keys(SK).join(' '));
    process.exit(name ? 1 : 0);
  }
  const res = generate(name, SK[name], opt('--n', 3000), opt('--seed', 1), opt('--top', 5));
  for (const c of res) show(c);
  if (!res.length) console.log('no candidates');
}
void FS;
export type { Plan };
