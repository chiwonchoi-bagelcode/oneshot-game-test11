/*
 * Core D (marked wells) — rules shared by the game and the Node tools (no DOM here).
 *
 *  - Ink can only be released from the wells shown on the board (LevelDef.wells). Each well holds
 *    one drop of its own ink (colour, optional range) and can be opened once.
 *  - A well that another ink spreads over before it was opened is covered and can't be used.
 *  - Spreading and mixing are the original Sim rules (same beat, same cell = mix).
 *  - Not every well has to be used (decoys); the stage is won once the goal is met.
 *
 * A plan is a list of { k: well index, t: beat }. runPlan() replays it exactly like the game's
 * timing core does: drops of a beat happen before that beat's spread, a wrong cell loses at once,
 * and the result is decided as soon as every target is met and nothing can go wrong any more.
 */
import { Sim, parseLevel, parseInk, type LevelDef, type InkSpec, type ParsedLevel, type Drop } from '../../core/sim.ts';

export interface PlanDrop { k: number; t: number }

export function wellSpecs(def: LevelDef): InkSpec[] {
  return (def.wells || []).map((w) => parseInk(w.ink));
}

/** Well index at cell idx (-1 = not a well). */
export function wellIndexAt(def: LevelDef, w: number, idx: number): number {
  const ws = def.wells || [];
  for (let k = 0; k < ws.length; k++) if (ws[k].y * w + ws[k].x === idx) return k;
  return -1;
}

/** Plan → solution drops (x, y, t, k). */
export function planToDrops(def: LevelDef, plan: PlanDrop[]): Drop[] {
  return plan.slice().sort((a, b) => a.t - b.t).map((p) => ({ x: def.wells![p.k].x, y: def.wells![p.k].y, t: p.t, k: p.k }));
}

export function dropsToPlan(drops: Drop[]): PlanDrop[] {
  return drops.map((d) => ({ k: d.k!, t: d.t }));
}

/** Drop well k on sim (false = blocked: used or covered). */
export function dropWell(sim: Sim, def: LevelDef, specs: InkSpec[], k: number): boolean {
  const wl = def.wells![k];
  const idx = sim.idx(wl.x, wl.y);
  if (sim.ink[idx]) return false;
  return sim.drop(idx, specs[k], k);
}

export type Outcome = 'win' | 'lose' | 'open';

/** Game verdict for the current state if nobody drops any more: win (decided), lose (wrong cell) or open. */
export function decide(sim: Sim): Outcome {
  if (sim.wrongCells().length) return 'lose';
  if (sim.allTargetsMet() && sim.forecast().result === 'win') return 'win';
  return 'open';
}

export interface RunResult { result: Outcome | 'invalid'; tick: number; sim: Sim; used: PlanDrop[]; errors: string[] }

/**
 * Replays a plan with the game's rules. 'open' = the plan ran out and the board settled without
 * a win (the game would call it unfinished once no well can change anything).
 */
export function runPlan(def: LevelDef, plan: PlanDrop[], L?: ParsedLevel, maxTicks = 80): RunResult {
  const P = L || parseLevel(def);
  const specs = wellSpecs(def);
  const sim = new Sim(P);
  const pending = plan.slice().sort((a, b) => a.t - b.t);
  const used: PlanDrop[] = [];
  const errors: string[] = [];
  for (;;) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      if (!dropWell(sim, def, specs, d.k)) {
        errors.push('beat ' + d.t + ' well ' + d.k + ' blocked');
        return { result: 'invalid', tick: sim.tick, sim, used, errors };
      }
      used.push(d);
      const v = decide(sim);
      if (v !== 'open') return { result: v, tick: sim.tick, sim, used, errors };
    }
    if (!pending.length && sim.settled()) break;
    if (sim.tick >= maxTicks) break;
    sim.step();
    const v = decide(sim);
    if (v !== 'open') return { result: v, tick: sim.tick, sim, used, errors };
  }
  return { result: 'open', tick: sim.tick, sim, used, errors };
}

export interface EnumOptions {
  /** Last beat a drop may happen on. */
  maxT?: number;
  /** Stop after this many plans (safety). */
  limit?: number;
  /** Prune branches as soon as a target is wrong (needs goals). Default true. */
  prune?: boolean;
}

export interface EnumLeaf { plan: PlanDrop[]; result: Outcome; sim: Sim }

/**
 * Every distinct way to play the stage under the input model: any set of wells on beat 0, then at
 * most one well per later beat (a person can't make two drops inside one running beat). Waiting
 * while nothing moves is collapsed (it can't change anything). Each leaf is a finished game: won
 * (decided), lost, or open (settled with no drop left that the player chose to make).
 */
export function enumeratePlans(def: LevelDef, cb: (leaf: EnumLeaf) => void, opts: EnumOptions = {}): number {
  const L = parseLevel(def);
  const specs = wellSpecs(def);
  const n = (def.wells || []).length;
  const maxT = opts.maxT ?? 8;
  const limit = opts.limit ?? 2_000_000;
  const prune = opts.prune !== false;
  let count = 0;
  const leaf = (plan: PlanDrop[], result: Outcome, sim: Sim) => {
    count++;
    cb({ plan, result, sim });
  };
  /** sim is at tick t, drops of this tick still allowed (one, or any number at t=0 handled outside). */
  const settleOut = (sim: Sim, plan: PlanDrop[]) => {
    // No more drops: run to the end.
    const s = sim.clone();
    for (let g = 0; g < 200 && !s.settled(); g++) {
      s.step();
      if (prune && s.wrongCells().length) return leaf(plan, 'lose', s);
    }
    leaf(plan, decide(s) === 'win' ? 'win' : s.wrongCells().length ? 'lose' : 'open', s);
  };
  const free = (sim: Sim, usedMask: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) if (!(usedMask & (1 << k))) {
      const wl = def.wells![k];
      if (!sim.ink[sim.idx(wl.x, wl.y)]) out.push(k);
    }
    return out;
  };
  // After the drops of tick t: check, then step to t+1 and branch.
  const advance = (sim: Sim, usedMask: number, plan: PlanDrop[]) => {
    if (count >= limit) return;
    if (prune) {
      const v = decide(sim);
      if (v !== 'open') return leaf(plan, v, sim);
    }
    // Stop here (no more drops) is one option.
    settleOut(sim, plan);
    let s = sim;
    // Walk forward beat by beat; at each later beat, one well may be opened.
    for (;;) {
      if (s.tick >= maxT && !s.settled()) return;
      s = s.clone();
      s.step();
      if (prune && s.wrongCells().length) return;
      if (prune && decide(s) === 'win') return; // decided without further drops (covered by settleOut)
      for (const k of free(s, usedMask)) branch(s, usedMask, plan, k);
      // Nothing moves any more: opening a well later is the same as opening it now.
      if (s.settled()) return;
    }
  };
  const branch = (s: Sim, usedMask: number, plan: PlanDrop[], k: number) => {
    const s2 = s.clone();
    if (!dropWell(s2, def, specs, k)) return;
    advance(s2, usedMask | (1 << k), plan.concat([{ k, t: s2.tick }]));
  };
  // Beat 0: every non-empty subset of wells.
  for (let mask = 1; mask < 1 << n; mask++) {
    const sim = new Sim(L);
    const plan: PlanDrop[] = [];
    let ok = true;
    let early = false;
    for (let k = 0; k < n && ok; k++) if (mask & (1 << k)) {
      if (early) { ok = false; break; } // the game would already be decided before this drop
      ok = dropWell(sim, def, specs, k);
      plan.push({ k, t: 0 });
      if (prune && decide(sim) === 'win') early = true;
    }
    if (!ok) continue;
    advance(sim, mask, plan);
  }
  return count;
}

export function planKey(plan: PlanDrop[]): string {
  return plan.slice().sort((a, b) => a.t - b.t || a.k - b.k).map((p) => p.k + '@' + p.t).join(' ');
}

/** Winning plans (distinct). */
export function solutions(def: LevelDef, opts: EnumOptions = {}): PlanDrop[][] {
  const out = new Map<string, PlanDrop[]>();
  enumeratePlans(def, (l) => {
    if (l.result === 'win') out.set(planKey(l.plan), l.plan);
  }, opts);
  return [...out.values()];
}
