// Placeholder — replaced by tools/gen-levels.ts output.
import type { LevelDef } from '../../core/sim.ts';
export const CAMPAIGN: LevelDef[][] = [
  [
    { id: 'c1-01', map: ['.....', '.....', '.....', '.....', '.....'], goal: ['.....', '..R..', '.RRR.', '..R..', '.....'], inks: ['R'], solution: [{ x: 2, y: 2, t: 0 }], intro: 'drop', guided: true, tag: 'discovery' },
    { id: 'c1-02', map: ['.......', '.......', '.......', '.......', '.......'], goal: ['.......', '...G...', '...G...', '...G...', '.......'], inks: ['Y', 'B'], solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 0 }], intro: 'mix', guided: true, tag: 'discovery' },
    { id: 'c1-03', map: ['......'], goal: ['...G..'], inks: ['Y', 'B'], solution: [{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 1 }], intro: 'timing', tag: 'discovery' },
  ],
];
