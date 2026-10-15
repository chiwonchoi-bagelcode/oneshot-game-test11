/* Sketches for tools/cores/e/gen.ts: terrain + ink queue (+ options) per design slot. */
import type { Sketch } from './gen.ts';

export const SKETCHES: Record<string, Sketch> = {
  // 6-7 walls: the countdown already counts the detour
  s06: { maxGoal: 4, minT2: 2, map: ['.......', '.......', '###.###', '.......', '.......'], inks: ['Y', 'B'], threat: false, partners: 1, maxSol: 3 },
  s07: { maxGoal: 4, minT2: 2, map: [' ..... ', '...#...', '...#...', '.......', '...#...', '...#...', ' ..... '], inks: ['B', 'R'], threat: false, partners: 1, maxSol: 2 },
  // 8-9 race: a wrong colour is on its way
  s08: { map: ['......', '......', '......', '......', '......', '......'], inks: ['R', 'B'], threat: true, partners: 1, maxSol: 2, moves: ['meet'] },
  s09: { maxGoal: 4, minT2: 2, map: [' ..... ', '.......', '.......', '...#...', '.......', '.......', ' ..... '], inks: ['B', 'Y'], threat: true, partners: 1, maxSol: 2 },
  // 10 two partners, two beats
  s10: { maxGoal: 4, minT2: 2, map: ['.......', '.......', '...#...', '...#...', '.......', '.......'], inks: ['Y', 'B', 'B'], partners: 2, maxSol: 2 },
  // 11-12 short inks
  s11: { map: ['  ...  ', ' ..... ', '.......', '.......', '.......', ' ..... ', '  ...  '], inks: ['R', 'Y2'], partners: 1, maxSol: 2 },
  s12: { map: [' ..... ', '.......', '.......', '.......', '.......', ' ..... '], inks: ['B', 'R2', 'R2'], partners: 1, maxSol: 2 },
  // 13-14 clean cells
  s13: { map: ['.......', '.......', '.##.##.', '.#...#.', '.#...#.', '.#####.'], inks: ['R', 'B2'], whites: 2, threat: true, maxSol: 2, moves: ['meet', 'race'] },
  s14: { map: ['  ...  ', ' ..... ', '.......', '...#...', '.......', ' ..... ', '  ...  '], inks: ['Y', 'B2', 'B2'], whites: 2, threat: true, maxSol: 2, moves: ['meet', 'race'] },
  // 15-19 three colours
  s15: { map: ['.......', '.......', '.......', '.......', '.......', '.......'], inks: ['R', 'Y', 'B'], partners: 1, maxSol: 2 },
  s16: { map: [' ..... ', '.......', '...#...', '.......', '...#...', '.......', ' ..... '], inks: ['Y', 'R', 'B'], partners: 1, maxSol: 2 },
  s17: { map: [' .. .. ', '.......', '.......', '.......', '.......', ' ..... ', '  ...  '], inks: ['B', 'R', 'Y'], threat: true, maxSol: 2, moves: ['meet', 'race'] },
  s18: { map: ['   .   ', '  ...  ', ' ..... ', '.......', '.......', '.......'], inks: ['R', 'B2', 'Y2'], partners: 1, maxSol: 2 },
  s19: { map: ['.......', '.#...#.', '.#...#.', '.......', '.......', '.......', '.......'], inks: ['Y', 'R', 'B2'], whites: 2, threat: true, maxSol: 2, moves: ['meet', 'race'] },
  // 20-30 combinations
  s20: { map: [' .. .. ', '.......', '.......', ' ..... ', '  ...  ', '   .   '], inks: ['Y', 'B', 'Y'], partners: 1, maxSol: 2 },
  s21: { map: ['.......', '.......', '.......', ' ..... ', '  ...  ', ' ..... '], inks: ['B', 'R', 'B'], partners: 1, maxSol: 2, moves: ['meet', 'race'] },
  s22: { map: ['   .   ', ' . . . ', ' ..... ', '.......', ' ..... ', '  ...  ', '   .   '], inks: ['R', 'Y', 'B'], partners: 1, maxSol: 2 },
  s23: { map: ['..   ..', '... ...', '.......', '  ...  ', '.......', '... ...', '..   ..'], inks: ['Y', 'R', 'B', 'R'], partners: 1, maxSol: 2 },
  s24: { map: ['.......', '.......', '..#.#..', '..#.#..', '.......', '.......'], inks: ['B', 'Y2', 'R'], partners: 1, maxSol: 2, moves: ['meet', 'race'] },
  s25: { map: ['   .   ', '  ...  ', ' ..... ', ' ..... ', ' ..... ', '.......', '   .   '], inks: ['R', 'B', 'Y2'], whites: 2, threat: true, maxSol: 2, moves: ['meet', 'race'] },
  s26: { map: [' ..... ', '...#...', '.......', '.#...#.', '.......', '...#...', ' ..... '], inks: ['Y', 'B', 'R', 'B'], partners: 1, maxSol: 2 },
  s27: { map: ['   .   ', '  ...  ', '.......', '  ...  ', ' ..... ', '.......', '  ...  ', ' ..... '], inks: ['B', 'Y', 'R2', 'Y'], partners: 1, maxSol: 2, moves: ['meet', 'race'] },
  s28: { map: [' .... ', '......', '..  ..', '..  ..', '......', ' .... '], inks: ['R', 'Y', 'B', 'Y'], partners: 1, maxSol: 2 },
  s29: { map: ['  .. .. ', ' .......', '........', '........', ' ...... '].map((r) => r.slice(0, 7)), inks: ['Y', 'R', 'B2', 'R'], whites: 2, threat: true, maxSol: 2, moves: ['meet', 'race'] },
  s30: { map: ['   .   ', '  ...  ', ' ..... ', '.......', '..#.#..', '.......', ' ..... ', '  ...  '], inks: ['B', 'R', 'Y', 'R'], whites: 1, partners: 1, maxSol: 2, moves: ['meet', 'race'] },
  s30b: { map: ['.......', '.......', '..#.#..', '.......', '..#.#..', '.......', '.......'], inks: ['R', 'B', 'Y2', 'B'], partners: 1, maxSol: 2, moves: ['meet', 'race'] },
};
