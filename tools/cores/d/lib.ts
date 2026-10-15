/*
 * Core D level tooling: goal picking, bots and metrics (Node only).
 * Everything runs through the game's own Sim and src/cores/d/rules.ts.
 */
import { Sim, parseLevel, CODE_TO_CHAR, WHITE, type LevelDef } from '../../../src/core/sim.ts';
import { enumeratePlans, runPlan, wellSpecs, dropWell, decide, planKey, solutions, type PlanDrop } from '../../../src/cores/d/rules.ts';
import { mulberry32 } from '../../../src/core/rng.ts';

export type Rng = () => number;
export { mulberry32 };

export function blankGoal(map: string[]): string[] {
  return map.map((r) => '.'.repeat(r.length));
}

export function withInks(def: LevelDef): LevelDef {
  return { ...def, inks: (def.wells || []).map((w) => w.ink) };
}

/** Final board of a plan with no goal (all drops made, then settled). */
export function finalBoard(def: LevelDef, plan: PlanDrop[]): Sim {
  const d: LevelDef = { ...withInks(def), goal: blankGoal(def.map) };
  const L = parseLevel(d);
  const specs = wellSpecs(d);
  const sim = new Sim(L);
  const pending = plan.slice().sort((a, b) => a.t - b.t);
  for (let g = 0; g < 200; g++) {
    while (pending.length && pending[0].t <= sim.tick) {
      const p = pending.shift()!;
      if (!dropWell(sim, d, specs, p.k)) throw new Error(def.id + ': plan drop blocked ' + JSON.stringify(p));
    }
    if (!pending.length && sim.settled()) break;
    sim.step();
  }
  return sim;
}

interface Leaf { plan: PlanDrop[]; ink: Uint8Array; key: string; wells: string; allZero: boolean }

/** Every way to play (no goal → no pruning), with its final board. */
export function allLeaves(def: LevelDef, maxT = 8): Leaf[] {
  const d: LevelDef = { ...withInks(def), goal: blankGoal(def.map) };
  const out = new Map<string, Leaf>();
  enumeratePlans(d, (l) => {
    const key = planKey(l.plan);
    if (out.has(key)) return;
    const s = l.sim.clone();
    for (let g = 0; g < 200 && !s.settled(); g++) s.step();
    out.set(key, { plan: l.plan, ink: s.ink, key, wells: l.plan.map((p) => p.k).sort().join(','), allZero: l.plan.every((p) => p.t === 0) });
  }, { maxT, prune: false });
  return [...out.values()];
}

export interface PickSpec {
  /** Wells that must not be part of any solution (decoys). */
  decoyFree?: boolean;
  /** No solution may have every drop on beat 0. */
  needWait?: boolean;
  /** Allow clean-cell goals. */
  whites?: number;
  maxSol?: number;
  minTargets?: number;
  /** Cells that must be targets / must not. */
  mustTargets?: { x: number; y: number }[];
  avoidTargets?: { x: number; y: number }[];
  /** Mixed cells to leave out of the goal (when there are too many). */
  allMixes?: boolean;
}

/**
 * Builds a goal for the intended plan: every mixed cell, the far end of each used colour, then
 * whatever cell (or clean cell) rules out the most other ways to win until only plans with the
 * intended wells (and, if asked, a wait) remain and there are few of them.
 */
export function pickGoal(def: LevelDef, plan: PlanDrop[], spec: PickSpec, leaves?: Leaf[]): { goal: string[]; log: string[] } {
  const L0 = parseLevel({ ...withInks(def), goal: blankGoal(def.map) });
  const w = L0.w, h = L0.h, n = w * h;
  const F = finalBoard(def, plan);
  const fin = F.ink;
  const all = leaves || allLeaves(def);
  const wellCells = new Set((def.wells || []).map((wl) => wl.y * w + wl.x));
  const intendedWells = plan.map((p) => p.k).sort().join(',');
  const goal = new Uint8Array(n); // 0 none, colour, or WHITE
  const log: string[] = [];
  const must = new Set((spec.mustTargets || []).map((p) => p.y * w + p.x));
  const avoid = new Set((spec.avoidTargets || []).map((p) => p.y * w + p.x));
  for (const i of must) goal[i] = fin[i] || WHITE;
  if (spec.allMixes !== false) for (let i = 0; i < n; i++) if (F.mixed[i] && fin[i] !== 7 && !wellCells.has(i) && !avoid.has(i)) goal[i] = fin[i];
  // Far end of each used colour (distance in beats from the drop).
  const usedColours = new Set<number>();
  for (const p of plan) usedColours.add(wellSpecs(def)[p.k].c);
  for (const c of usedColours) {
    let best = -1, bt = -1;
    for (let i = 0; i < n; i++) if (fin[i] === c && !wellCells.has(i) && !avoid.has(i) && !goal[i]) {
      const t = F.born[i];
      if (t > bt) { bt = t; best = i; }
    }
    if (best >= 0 && ![...Array(n).keys()].some((i) => goal[i] === c)) goal[best] = c;
  }
  const solves = (lf: Leaf) => {
    for (let i = 0; i < n; i++) {
      const g = goal[i];
      if (!g) continue;
      if (g === WHITE) { if (lf.ink[i]) return false; }
      else if (lf.ink[i] !== g) return false;
    }
    return true;
  };
  const bad = (lf: Leaf) => (spec.decoyFree !== false && lf.wells !== intendedWells) || (spec.needWait && lf.allZero);
  const maxSol = spec.maxSol ?? 4;
  const minT = spec.minTargets ?? 3;
  let whitesLeft = spec.whites || 0;
  for (let guard = 0; guard < 60; guard++) {
    const sol = all.filter(solves);
    const nBad = sol.filter(bad).length;
    const boards = new Set(sol.map((lf) => lf.ink.join(''))).size;
    const nT = goal.reduce((a, g) => a + (g && g !== WHITE ? 1 : 0), 0);
    if (nBad === 0 && boards <= maxSol && nT >= minT && whitesLeft <= 0) break;
    // Candidate cells: coloured in the intended board, or clean (whites).
    let best = -1, bestScore = -1, bestVal = 0, bestElim = 0, anyWhite = false;
    for (let i = 0; i < n; i++) {
      if (goal[i] || wellCells.has(i) || avoid.has(i) || L0.wall[i]) continue;
      const val = fin[i] && fin[i] !== 7 ? fin[i] : !fin[i] && whitesLeft > 0 ? WHITE : 0;
      if (!val) continue;
      if (val === WHITE) anyWhite = true;
      let elimBad = 0, elim = 0;
      for (const lf of sol) {
        const ok = val === WHITE ? !lf.ink[i] : lf.ink[i] === val;
        if (!ok) { elim++; if (bad(lf)) elimBad++; }
      }
      // Bad plans first, then any plan; clean cells when asked; prefer late cells (far from the wells).
      const score = elimBad * 1e6 + (boards > maxSol ? elim * 1e3 : 0) + (val === WHITE ? (whitesLeft > 0 ? 500 + elim * 10 : 0) : 0) + (F.born[i] || 0) * 3 + (fin[i] ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; bestVal = val; bestElim = elim; }
    }
    if (whitesLeft > 0 && !anyWhite) { whitesLeft = 0; log.push('no clean cell left'); continue; }
    if (best < 0) { log.push('no more candidates'); break; }
    if (bestElim === 0 && bestVal !== WHITE && nT >= minT) { if (nBad || boards > maxSol) log.push('ambiguous: ' + nBad + ' other-well wins, ' + boards + ' pictures'); break; }
    goal[best] = bestVal;
    if (bestVal === WHITE) whitesLeft--;
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const g = goal[y * w + x];
      r += !g ? '.' : g === WHITE ? 'w' : CODE_TO_CHAR[g];
    }
    rows.push(r);
  }
  return { goal: rows, log };
}

// ------------------------------------------------------------------ bots

/** A player who opens random wells on random beats (mindless play). */
export function randomTrial(def: LevelDef, rng: Rng): boolean {
  const L = parseLevel(def);
  const specs = wellSpecs(def);
  const n = def.wells!.length;
  const sim = new Sim(L);
  const freeWells = () => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) { const wl = def.wells![k]; if (!sim.ink[sim.idx(wl.x, wl.y)]) out.push(k); }
    return out;
  };
  const first = 1 + Math.floor(rng() * Math.min(2, n));
  for (let j = 0; j < first; j++) {
    const fr = freeWells();
    if (!fr.length) break;
    dropWell(sim, def, specs, fr[Math.floor(rng() * fr.length)]);
    const v = decide(sim);
    if (v !== 'open') return v === 'win';
  }
  for (let g = 0; g < 40; g++) {
    sim.step();
    let v = decide(sim);
    if (v !== 'open') return v === 'win';
    const fr = freeWells();
    if (fr.length && (rng() < 0.35 || sim.settled())) {
      dropWell(sim, def, specs, fr[Math.floor(rng() * fr.length)]);
      v = decide(sim);
      if (v !== 'open') return v === 'win';
    }
    if (sim.settled() && !freeWells().length) return false;
  }
  return false;
}

export function randomRate(def: LevelDef, trials = 3000, seed = 1): number {
  const rng = mulberry32(seed);
  let won = 0;
  for (let i = 0; i < trials; i++) if (randomTrial(def, rng)) won++;
  return won / trials;
}


/**
 * Random play, except that before every drop the player holds the well and only lets go if the
 * preview shows a finished picture (otherwise a random well, like randomTrial). Measures how much
 * the hold-preview alone gives away.
 */
export function previewTrial(def: LevelDef, rng: Rng): boolean {
  const L = parseLevel(def);
  const specs = wellSpecs(def);
  const n = def.wells!.length;
  const sim = new Sim(L);
  const freeWells = () => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) { const wl = def.wells![k]; if (!sim.ink[sim.idx(wl.x, wl.y)]) out.push(k); }
    return out;
  };
  const winner = (): number => {
    for (const k of freeWells()) {
      const s = sim.clone();
      if (dropWell(s, def, specs, k) && decide(s) === 'win') return k;
    }
    return -1;
  };
  const first = 1 + Math.floor(rng() * Math.min(2, n));
  for (let j = 0; j < first; j++) {
    const fr = freeWells();
    if (!fr.length) break;
    const wk = winner();
    dropWell(sim, def, specs, wk >= 0 ? wk : fr[Math.floor(rng() * fr.length)]);
    const v = decide(sim);
    if (v !== 'open') return v === 'win';
  }
  for (let g = 0; g < 40; g++) {
    sim.step();
    let v = decide(sim);
    if (v !== 'open') return v === 'win';
    const fr = freeWells();
    const wk = winner();
    if (wk >= 0 || (fr.length && (rng() < 0.35 || sim.settled()))) {
      dropWell(sim, def, specs, wk >= 0 ? wk : fr[Math.floor(rng() * fr.length)]);
      v = decide(sim);
      if (v !== 'open') return v === 'win';
    }
    if (sim.settled() && !freeWells().length) return false;
  }
  return false;
}

export function previewRate(def: LevelDef, trials = 1000, seed = 2): number {
  const rng = mulberry32(seed);
  let won = 0;
  for (let i = 0; i < trials; i++) if (previewTrial(def, rng)) won++;
  return won / trials;
}

export interface DMetrics { solutions: number; wellSets: number; random: number; preview: number; allAtZero: boolean; maxT: number; drops: number; wells: number }

export function measureD(def: LevelDef): DMetrics {
  const sol = solutions(def, { maxT: 8 });
  const sets = new Set(sol.map((p) => p.map((d) => d.k).sort().join(',')));
  const n = def.wells!.length;
  return {
    solutions: sol.length,
    wellSets: sets.size,
    random: randomRate(def),
    preview: previewRate(def),
    allAtZero: sol.some((p) => p.every((d) => d.t === 0)),
    maxT: Math.max(...def.solution.map((d) => d.t)),
    drops: def.solution.length,
    wells: n,
  };
}
