/*
 * Core D stage specs: board, wells and the intended plan ({ k: well, t: beat }).
 * gen.ts picks each goal from the intended plan's final board (see lib.ts pickGoal).
 * One new idea at a time; ideas are practised before they are combined.
 */
import type { Well } from '../../../src/core/sim.ts';
import type { PlanDrop } from '../../../src/cores/d/rules.ts';
import type { PickSpec } from './lib.ts';

export interface StageSpec {
  map: string[];
  wells: Well[];
  plan: PlanDrop[];
  intro?: string;
  guided?: boolean;
  tag?: 'light' | 'think' | 'discovery' | 'boss';
  coach?: string;
  pick?: PickSpec;
  goal?: string[];
}

const W = (x: number, y: number, ink: string): Well => ({ x, y, ink });

export const STAGES: StageSpec[] = [
  // 1 · One well. Tap it and watch the ink spread over the lily pad.
  {
    map: [' ... ', '.....', '.....', '.....', ' ... '],
    wells: [W(2, 2, 'R')],
    plan: [{ k: 0, t: 0 }],
    intro: 'd_well', guided: true, tag: 'discovery', coach: 'd.coach.1',
    goal: ['.RRR.', 'RRRRR', 'RR.RR', 'RRRRR', '.RRR.'],
  },
  // 2 · Two rooms, two wells: open both.
  {
    map: [' ..#.. ', '...#...', '...#...', '...#...', ' ..#.. '],
    wells: [W(1, 2, 'R'), W(5, 2, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 0 }],
    tag: 'light', coach: 'd.coach.2',
  },
  // 3 · First mix: yellow and blue meet in the middle of the leaf on the same beat.
  {
    map: [' ..... ', '.......', '.......', '.......', ' ..... '],
    wells: [W(0, 2, 'Y'), W(6, 2, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 0 }],
    intro: 'd_mix', guided: true, tag: 'discovery',
  },
  // 4 · Waiting moves the meeting: blue waits two beats so green lands right of centre.
  {
    map: [' ..... ', '.......', ' ..... '],
    wells: [W(0, 1, 'Y'), W(6, 1, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }],
    intro: 'd_wait', guided: true, tag: 'discovery', pick: { needWait: true },
  },
  // 5 · Odd distance: on the same beat they only touch; one beat later they mix on a cell.
  {
    map: [' ... ', '.....', '.....', '.....', '.....', ' ... '],
    wells: [W(2, 0, 'Y'), W(2, 5, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }],
    intro: 'd_touch', tag: 'discovery', pick: { needWait: true },
  },
  // 6 · A ring: the closer well waits.
  {
    map: ['.......', '.     .', '.     .', '.     .', '.     .', '.......'],
    wells: [W(0, 2, 'Y'), W(6, 2, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 7 · Three colours: yellow and blue first, red a beat later in the middle (orange and purple).
  {
    map: ['.......', '.......', '  ...  ', '.......', '.......'],
    wells: [W(0, 0, 'Y'), W(3, 2, 'R'), W(6, 4, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 0 }, { k: 1, t: 1 }],
    intro: 'd_three', tag: 'discovery', pick: { needWait: true },
  },
  // 8 · Decoy: more wells than you need.
  {
    map: [' ..... ', '.......', '.......', '.......', '.......', ' ..... '],
    wells: [W(0, 2, 'Y'), W(6, 2, 'B'), W(5, 5, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 0 }],
    intro: 'd_decoy', tag: 'discovery',
  },
  // 9 · Decoy + waiting.
  {
    map: ['......', '......', '......', '......', '......', '......'],
    wells: [W(0, 0, 'R'), W(5, 0, 'B'), W(5, 5, 'B'), W(0, 5, 'R')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 10 · Covered wells: open blue before the yellow reaches it.
  {
    map: [' ..... ', '.......', ' ..... '],
    wells: [W(0, 1, 'Y'), W(3, 1, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }],
    intro: 'd_cover', tag: 'discovery', pick: { needWait: true },
  },
  // 11 · Walls: the ink snakes through the garden; blue waits so green lands on all three bends.
  {
    map: ['.......', '.#####.', '.......', '.#####.', '.......'],
    wells: [W(0, 2, 'Y'), W(6, 0, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 12 · Short wells: the yellow flower stops after two cells and red flows around it.
  {
    map: ['  ...  ', ' ..... ', '.......', '.......', '.......', ' ..... ', '  ...  '],
    wells: [W(3, 0, 'R'), W(3, 3, 'Y2')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }],
    intro: 'd_range', tag: 'discovery',
  },
  // 13 · Short wells + waiting: two meetings, and blue must not reach too far.
  {
    map: [' ..... ', '.......', '.......', '.......', ' ..... '],
    wells: [W(0, 2, 'Y'), W(6, 2, 'B3'), W(3, 0, 'R2')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 1 }, { k: 1, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 14 · Three colours fan out: orange, purple and green from one lantern.
  {
    map: ['  ...  ', ' ..... ', '.......', '.......', '.......', ' ..... ', '  ...  '],
    wells: [W(3, 0, 'R'), W(0, 3, 'Y'), W(6, 3, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 0 }, { k: 2, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 15 · Three colours around a stone: red first, then yellow, then blue.
  {
    map: ['.......', '.......', '..###..', '.......', '.......'],
    wells: [W(0, 0, 'R'), W(6, 0, 'Y'), W(3, 4, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }, { k: 2, t: 3 }],
    tag: 'think', pick: { needWait: true },
  },
  // 16 · Clean cells: blue plugs the gap so red can't reach the clean corners.
  {
    map: ['..#....', '..#....', '.......', '..#....', '..#....'],
    wells: [W(0, 2, 'R'), W(4, 2, 'B2')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }],
    intro: 'd_white', tag: 'discovery', pick: { whites: 2, needWait: true },
  },
  // 17 · Clean cells + timing: green must plug the gap before yellow floods the clean room.
  {
    map: ['...#...', '...#...', '.......', '...#...', '...#...'],
    wells: [W(0, 2, 'Y'), W(4, 0, 'B2'), W(6, 4, 'R1')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }],
    tag: 'think', pick: { whites: 2, needWait: true },
  },
  // 18 · Spare wells + three colours: one red well is too many.
  {
    map: [' ..... ', '.......', '.......', '.......', '.......', '.......', ' ..... '],
    wells: [W(0, 1, 'R'), W(6, 1, 'Y'), W(0, 5, 'B'), W(6, 5, 'R')],
    plan: [{ k: 1, t: 0 }, { k: 2, t: 0 }, { k: 0, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 19 · Covered wells: the blue well in the middle must open before the others reach it.
  {
    map: ['...... ', '.......', '.......', '.......', ' ......'],
    wells: [W(0, 0, 'R'), W(3, 2, 'B'), W(6, 4, 'Y')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 2 }, { k: 1, t: 3 }],
    tag: 'think', pick: { needWait: true },
  },
  // 20 · Four wells, four corners.
  {
    map: ['..#.#..', '.......', '#.....#', '.......', '..#.#..'],
    wells: [W(0, 0, 'R'), W(6, 0, 'Y'), W(0, 4, 'B'), W(6, 4, 'Y')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 0 }, { k: 1, t: 2 }, { k: 3, t: 3 }],
    tag: 'boss', pick: { needWait: true },
  },
  // 21 · Thick paper holds ink a beat: on the same beat they only touch.
  {
    map: ['..~....', '..~....', '..~....'],
    wells: [W(0, 1, 'Y'), W(6, 1, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }],
    intro: 'd_slow', tag: 'discovery', pick: { needWait: true },
  },
  // 22 · Thick paper + three colours.
  {
    map: [' ..... ', '..~~~..', '.......', '..~~~..', ' ..... '],
    wells: [W(0, 2, 'R'), W(6, 2, 'B'), W(3, 0, 'Y')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 2 }, { k: 2, t: 3 }],
    tag: 'think', pick: { needWait: true },
  },
  // 23 · Thick paper behind walls.
  {
    map: ['...#...', '.~.#.~.', '.......', '.~.#.~.', '...#...'],
    wells: [W(0, 0, 'R'), W(6, 0, 'B'), W(3, 2, 'Y')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 1 }, { k: 1, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 24 · Short wells, three colours, one spare.
  {
    map: ['.......', '.......', '.......', '.......', '.......', '.......'],
    wells: [W(1, 1, 'R2'), W(5, 1, 'Y'), W(1, 4, 'B'), W(5, 4, 'B2')],
    plan: [{ k: 1, t: 0 }, { k: 2, t: 1 }, { k: 0, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 25 · Clean cells and a spare well: the blue well would stain the clean corner.
  {
    map: [' ...... ', '........', '........', '........', ' ...... '],
    wells: [W(0, 2, 'Y3'), W(7, 2, 'B3'), W(3, 0, 'R2')],
    plan: [{ k: 0, t: 0 }, { k: 2, t: 1 }],
    tag: 'think', pick: { whites: 2, needWait: true },
  },
  // 26 · Thick paper and a covered well.
  {
    map: ['~......', '.......', '...~...', '.......', '......~'],
    wells: [W(0, 2, 'R'), W(3, 0, 'B'), W(6, 2, 'Y'), W(3, 4, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }, { k: 2, t: 2 }],
    tag: 'think', pick: { needWait: true },
  },
  // 27 · The mountain: one short well is a spare.
  {
    map: ['   .   ', '  ...  ', ' ..... ', '.......', '.......', '.......', '.......'],
    wells: [W(3, 0, 'Y'), W(0, 6, 'R'), W(6, 6, 'B'), W(3, 4, 'R2')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }, { k: 2, t: 3 }],
    tag: 'think', pick: { needWait: true },
  },
  // 28 · Four wells around four stones.
  {
    map: ['......', '.#..#.', '......', '......', '.#..#.', '......'],
    wells: [W(0, 0, 'B'), W(5, 0, 'R'), W(0, 5, 'Y'), W(5, 5, 'B')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }, { k: 2, t: 3 }],
    tag: 'think', pick: { needWait: true },
  },
  // 29 · Five wells, short ones too.
  {
    map: ['......', '.#.#..', '......', '..#.#.', '......', '......'],
    wells: [W(0, 0, 'Y'), W(5, 2, 'R'), W(0, 5, 'B'), W(5, 5, 'Y2'), W(3, 3, 'B1')],
    plan: [{ k: 0, t: 0 }, { k: 1, t: 1 }, { k: 2, t: 3 }],
    tag: 'boss', pick: { needWait: true },
  },
  // 30 · The last picture: five wells, a stone in the middle.
  {
    map: ['  ...  ', ' ..... ', '.......', '...#...', '.......', ' ..... ', '  ...  '],
    wells: [W(3, 0, 'R'), W(0, 3, 'Y'), W(6, 3, 'B'), W(3, 6, 'Y'), W(1, 1, 'B2')],
    plan: [{ k: 0, t: 0 }, { k: 4, t: 1 }, { k: 1, t: 2 }],
    tag: 'boss', pick: { needWait: true },
  },
];
