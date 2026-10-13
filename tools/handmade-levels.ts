/*
 * Hand-authored levels: the first minutes of chapter 1 and every mechanic intro.
 * Each one was checked with the exhaustive solver (see tools/verify-levels.ts for the live checks).
 * Keys are the campaign slot ids; gen-levels.ts merges them into the campaign.
 */
import type { LevelDef } from '../src/core/sim.ts';

export const HANDMADE: Record<string, LevelDef> = {
  // ---------------------------------------------------------------- chapter 1 · pond
  // A lily pad. One red drop anywhere colours everything.
  'c1-01': {
    id: 'c1-01',
    map: [' ... ', '.....', '.....', '.....', ' ... '],
    goal: ['..R..', '.RRR.', 'RRRRR', '.RRR.', '..R..'],
    inks: ['R'],
    solution: [{ x: 2, y: 2, t: 0 }],
    intro: 'drop', guided: true, tag: 'discovery',
  },
  // Two lily pads: ink cannot leave the paper, so each pad needs its own drop.
  'c1-02': {
    id: 'c1-02',
    map: [' ... ', '.....', ' ... ', '     ', ' ... ', '.....', '.....', ' ... '],
    goal: ['..R..', '.R.R.', '.....', '.....', '..R..', '.R.R.', '.....', '..R..'],
    inks: ['R', 'R'],
    solution: [{ x: 2, y: 1, t: 0 }, { x: 2, y: 5, t: 0 }],
    tag: 'light',
  },
  // Walls block ink: a stone wall splits the pond in two.
  'c1-03': {
    id: 'c1-03',
    map: [' ..#.. ', '...#...', '...#...', '...#...', '...#...', ' ..#.. '],
    goal: ['.R...R.', '.......', 'R.....R', '.......', '.R...R.', '.......'],
    inks: ['R', 'R'],
    solution: [{ x: 1, y: 2, t: 0 }, { x: 5, y: 2, t: 0 }],
    intro: 'walls', tag: 'discovery',
  },
  // Three rooms, three drops: one in each room.
  'c1-04': {
    id: 'c1-04',
    map: [' ..#.. ', '...#...', '...#...', '...####', '...#...', '...#...', ' ..#.. '],
    goal: ['.....R.', '.R.....', '......R', '.......', '.......', '.R...R.', '.....R.'],
    inks: ['R', 'R', 'R'],
    solution: [{ x: 1, y: 3, t: 0 }, { x: 5, y: 5, t: 0 }, { x: 5, y: 1, t: 0 }],
    tag: 'light',
  },
  // Order: the queue decides which colour comes next.
  'c1-05': {
    id: 'c1-05',
    map: [' ..... ', '.......', '.......', '#######', '.......', '.......', ' ..... '],
    goal: ['.R...R.', '...R...', '.......', '.......', '.......', '...B...', '.B...B.'],
    inks: ['R', 'B'],
    solution: [{ x: 3, y: 1, t: 0 }, { x: 3, y: 5, t: 0 }],
    intro: 'order', guided: true, tag: 'discovery',
  },
  // Mix: yellow and blue meet in the middle of the leaf and turn green.
  'c1-07': {
    id: 'c1-07',
    map: [' ..... ', '.......', '.......', '.......', ' ..... '],
    goal: ['...G...', '...G...', '.Y.G.B.', '...G...', '...G...'],
    inks: ['Y', 'B'],
    solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 0 }],
    intro: 'mix', guided: true, tag: 'discovery',
  },
  // Timing: on a ring two drops always split it in half... unless you wait before the second.
  'c1-16': {
    id: 'c1-16',
    map: ['.......', '.     .', '.     .', '.     .', '.     .', '.......'],
    goal: ['....G..', '.......', 'Y.....B', '.......', '.......', '....G..'],
    inks: ['Y', 'B'],
    solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 2 }],
    intro: 'timing', guided: true, tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 2 · teahouse
  // Parity: the two green spots are an odd distance apart - only a one-beat wait lets the inks meet on them.
  'c2-01': {
    id: 'c2-01',
    map: ['.....', '.   .', '.   .', '.   .', '.   .', '.   .', '.....'],
    goal: ['..G..', '.....', '.....', 'Y....', '.....', '.....', '...G.'],
    inks: ['Y', 'B'],
    solution: [{ x: 0, y: 3, t: 0 }, { x: 4, y: 2, t: 1 }],
    intro: 'parity', tag: 'discovery',
  },
  // Three primaries on a round tea tray: every pair makes its own colour.
  'c2-12': {
    id: 'c2-12',
    map: [' ..... ', '.......', '..   ..', '..   ..', '..   ..', '.......', ' ..... '],
    goal: ['...R...', 'O.....P', '.O...P.', '.......', '.......', '...G...', '...G...'],
    inks: ['R', 'Y', 'B'],
    solution: [{ x: 3, y: 0, t: 0 }, { x: 0, y: 5, t: 0 }, { x: 6, y: 5, t: 0 }],
    intro: 'three', tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 3 · bamboo
  // Range: R3 spreads three cells - drop it right in the middle of the lantern.
  'c3-01': {
    id: 'c3-01',
    map: ['  .  ', ' ... ', '.....', '.....', '.....', ' ... ', '  .  '],
    goal: ['..R..', '.....', '.....', 'R...R', '.....', '.....', '..R..'],
    inks: ['R3'],
    solution: [{ x: 2, y: 3, t: 0 }],
    intro: 'range', tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 4 · peaks
  // White: keep the snow cap clean.
  'c4-01': {
    id: 'c4-01',
    map: ['   .   ', '  ...  ', ' ..... ', '.......', '.......', '.......'],
    goal: ['...w...', '..www..', '.......', '.......', '.......', 'B..B..B'],
    inks: ['B3'],
    solution: [{ x: 3, y: 5, t: 0 }],
    intro: 'white', tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 5 · harbor
  // Seed: the sleeping blue seed wakes when yellow touches it and paints the hull.
  'c5-01': {
    id: 'c5-01',
    map: ['  .  ', ' ... ', '.....', '##b##', '.....', '.....', ' ... '],
    goal: ['..Y..', '.....', '.Y.Y.', '.....', '.B.B.', '.....', '..B..'],
    inks: ['Y'],
    solution: [{ x: 2, y: 1, t: 0 }],
    intro: 'seed', tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 6 · market
  // Gate: only red passes the red gate; blue stays in the lower stall.
  'c6-01': {
    id: 'c6-01',
    map: [' ..... ', '.......', '.......', '###R###', '.......', '.......', ' ..... '],
    goal: ['.R...R.', '.......', '...R...', '.......', '...B...', '.......', '.B...B.'],
    inks: ['B', 'R'],
    solution: [{ x: 3, y: 5, t: 0 }, { x: 3, y: 1, t: 0 }],
    intro: 'gate', tag: 'discovery',
  },

  // ---------------------------------------------------------------- chapter 7 · valley
  // Slow paper holds ink for one extra beat - here it does the waiting for you.
  'c7-01': {
    id: 'c7-01',
    map: ['~......', '~     .', '.     .', '.     .', '.......'],
    goal: ['..G....', '.......', 'Y.....B', '.......', '...G...'],
    inks: ['Y', 'B'],
    solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 0 }],
    intro: 'slow', tag: 'discovery',
  },
};
