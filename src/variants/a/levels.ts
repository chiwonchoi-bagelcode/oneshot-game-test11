/* Variant A: the 30 stages (placeholder until designed). */
import type { LevelDef } from '../../core/sim.ts';

export const LEVELS: LevelDef[] = [
  { id: 'a-01', map: ['.....', '.....', '.....', '.....', '.....'], goal: ['.....', '..R..', '.RRR.', '..R..', '.....'], inks: ['R'], solution: [{ x: 2, y: 2, t: 0 }], guided: true },
];
