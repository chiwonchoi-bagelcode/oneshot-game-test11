/*
 * Arrival countdown badges (pure; shared by the core and the level tools).
 */
import { WHITE, isPrimary, type Sim } from '../../core/sim.ts';

export type BadgeKind = 'partner' | 'promise' | 'threat';
export interface Badge { idx: number; kind: BadgeKind; beat: number; c: number }

/**
 * Forecast of the goal cells the ink already on the board will reach (no further drops).
 * Shared with the level tools (tools/cores/e/lib.ts mirrors it for the verifier).
 */
export function arrivalBadges(sim: Sim): Badge[] {
  const L = sim.L;
  const out: Badge[] = [];
  const watch: number[] = [];
  for (const i of L.targets) if (!sim.ink[i]) watch.push(i);
  for (const i of L.whites) if (!sim.ink[i]) watch.push(i);
  if (!watch.length || sim.settled()) return out;
  let left = 0;
  for (let q = sim.pi; q < L.inks.length; q++) left |= L.inks[q].c;
  const f = sim.clone();
  const seen = new Uint8Array(sim.ink.length);
  for (let n = 0; n < 60 && !f.settled(); n++) {
    f.step();
    for (const i of watch) {
      if (seen[i] || !f.ink[i]) continue;
      seen[i] = 1;
      const a = f.ink[i], g = L.goal[i], beat = f.tick;
      if (g === WHITE) out.push({ idx: i, kind: 'threat', beat, c: a });
      else if (a === g) { if (!isPrimary(g)) out.push({ idx: i, kind: 'promise', beat, c: a }); }
      else if (!isPrimary(g) && isPrimary(a) && (a & g) === a && left & (g & ~a)) out.push({ idx: i, kind: 'partner', beat, c: a });
      else out.push({ idx: i, kind: 'threat', beat, c: a });
    }
  }
  return out;
}
