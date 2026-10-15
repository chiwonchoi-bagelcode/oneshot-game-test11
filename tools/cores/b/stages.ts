/*
 * Core B stage designs. Each stage is drawn as its intended strokes: [drop colour, x, y, moves]
 * with moves U/D/L/R. The picture is whatever those strokes paint (tools/cores/b/gen.ts).
 */
export interface StageDesign {
  id: string;
  /** Short English name (reports). */
  name: string;
  /** What the stage teaches / why it's there (reports). */
  idea: string;
  strokes: [string, number, number, string][];
  /** Alternative: the picture itself (map + goal); the solver finds the stored strokes. */
  pic?: { map: string[]; goal: string[] };
  stones?: [number, number][];
  w?: number;
  h?: number;
  intro?: string;
  guided?: boolean;
  coach?: string;
  tag?: 'light' | 'think' | 'discovery' | 'boss';
}

export const STAGES: StageDesign[] = [
  {
    id: 'b01', name: 'First stroke', idea: 'Drag from the drop: paint follows the finger (guided)',
    intro: 'b_draw', guided: true, tag: 'light',
    strokes: [['r', 0, 0, 'RRRR']],
  },
  {
    id: 'b02', name: 'Turns', idea: 'Turn the finger at corners; the path is the picture',
    coach: 'b.c.turn', tag: 'light',
    strokes: [['b', 0, 0, 'RRRDDLLLDDRRR']],
  },
  {
    id: 'b03', name: 'Fill the square', idea: 'Cover every cell with one stroke that never crosses itself; slide back to erase',
    intro: 'b_fill', coach: 'b.c.back', tag: 'discovery',
    strokes: [['r', 0, 0, 'RRDLLDRR']],
  },
  {
    id: 'b04', name: 'Two colours', idea: 'Each colour has its own drop and its own stroke',
    coach: 'b.c.two', tag: 'light',
    strokes: [['r', 0, 2, 'UURRR'], ['b', 3, 2, 'LLURR']],
  },
  {
    id: 'b05', name: 'Green', idea: 'Crossing strokes mix: yellow + blue = green (guided)',
    intro: 'b_mix', guided: true, tag: 'discovery',
    strokes: [['y', 2, 0, 'DDDD'], ['b', 0, 2, 'RRRR']],
  },
  {
    id: 'b06', name: 'Shared row', idea: 'Green cells need both strokes: both colours run along the middle row',
    coach: 'b.c.share', tag: 'think',
    strokes: [['y', 0, 0, 'RRRRDLLLL'], ['b', 4, 2, 'LLLLURRRR']],
  },
  {
    id: 'b07', name: 'Magnet', idea: 'One stroke can cross another twice',
    tag: 'light',
    strokes: [['y', 1, 0, 'DDDRRUUU'], ['b', 0, 1, 'RRRR']],
  },
  {
    id: 'b08', name: 'Through the block', idea: 'Snake yellow through a block while blue passes straight through it',
    tag: 'think',
    strokes: [['y', 2, 0, 'RRDLLDRR'], ['b', 0, 1, 'RRRRRR']],
  },
  {
    id: 'b09', name: 'Garden gate', idea: 'Blue must enter the yellow fence through its one green gate, then fill the inside',
    tag: 'think',
    strokes: [['y', 0, 0, 'RRRRDDDDLLLLUUU'], ['b', 1, 5, 'UURRULLURR']],
  },
  {
    id: 'b10', name: 'Lily pad', idea: 'First picture: a long blue stroke around a green pad',
    tag: 'boss',
    strokes: [['y', 3, 3, 'LULUR'], ['b', 0, 0, 'RRRRDLLLLDRRRRDDLLLLURR']],
  },
  {
    id: 'b11', name: 'Orange and purple', idea: 'Red + yellow = orange, red + blue = purple',
    intro: 'b_three', tag: 'discovery',
    strokes: [['y', 1, 0, 'DDDD'], ['b', 5, 0, 'DDDD'], ['r', 0, 2, 'RRRRRR']],
  },
  {
    id: 'b12', name: 'Plum', idea: 'Two snaking strokes overlap on a purple square',
    tag: 'think',
    strokes: [['r', 0, 0, 'RRDLLDRR'], ['b', 3, 3, 'LLURRULL']],
  },
  {
    id: 'b13', name: 'Colour chart', idea: 'One red stroke runs under yellow and blue: orange on one side, purple on the other',
    tag: 'think',
    strokes: [['y', 0, 0, 'RRDLL'], ['b', 5, 0, 'LLDRR'], ['r', 0, 2, 'RRRRRULLLLL']],
  },
  {
    id: 'b14', name: 'Colour wheel', idea: 'All three pairs overlap: orange, green and purple in one picture',
    tag: 'think',
    strokes: [['r', 0, 0, 'RRDLDLU'], ['y', 4, 0, 'LLDRDRU'], ['b', 0, 3, 'RRRRULLLL']],
  },
  {
    id: 'b15', name: 'Window', idea: 'Start in the middle: yellow must spiral out and end on the top bar',
    tag: 'think',
    strokes: [['y', 2, 2, 'URDDLLUUURRR'], ['b', 0, 0, 'DDDDRRRRUUUULLL']],
  },
  {
    id: 'b16', name: 'Sunset', idea: 'Picture: red sun spirals out, yellow sky wraps around it, blue sea below',
    tag: 'boss',
    strokes: [['r', 2, 2, 'URDRDLDLULU'], ['y', 0, 2, 'RULURRDRURRDLDR'], ['b', 0, 5, 'RRRRRULLLLLURRRRR']],
  },
  {
    id: 'b17', name: 'River', idea: 'Two drops of one colour share the cells',
    intro: 'b_twin', coach: 'b.c.twin', tag: 'discovery',
    strokes: [['b', 0, 0, 'RRRRDDLLLL'], ['b', 4, 4, 'LLLLU']],
  },
  {
    id: 'b18', name: 'Signpost', idea: 'Twin yellows split a band; blue crosses it once',
    tag: 'light',
    strokes: [['y', 0, 0, 'DRURDRU'], ['y', 6, 0, 'DLULD'], ['b', 3, 4, 'UUUU']],
  },
  {
    id: 'b19', name: 'Fair share', idea: 'Where the twins split matters: a drop on a middle edge can only take an even block',
    tag: 'think',
    strokes: [['b', 0, 1, 'URDDL'], ['b', 5, 1, 'DLLLUURDRUR']],
  },
  {
    id: 'b20', name: 'Crossroads', idea: 'Twins in both colours meet in a green square',
    tag: 'think',
    strokes: [['y', 0, 2, 'RRRDLLL'], ['y', 6, 3, 'ULDLU'], ['b', 3, 0, 'RDLDRDL'], ['b', 4, 6, 'LURUL']],
  },
  {
    id: 'b21', name: 'Cherries', idea: 'Picture: twin red cherries; yellow and blue both run along the stems',
    tag: 'light',
    strokes: [['y', 0, 2, 'RUURRDD'], ['b', 4, 2, 'LUULLDD'], ['r', 0, 3, 'RDL'], ['r', 4, 3, 'LDR']],
  },
  {
    id: 'b22', name: 'Stones', idea: 'Stones can’t be painted; the drop sits where the only route starts',
    intro: 'b_stone', coach: 'b.c.stone', tag: 'discovery',
    strokes: [['y', 1, 0, 'LDDRRUURRDDL']], stones: [[1, 1], [3, 1]],
  },
  {
    id: 'b23', name: 'Stepping stones', idea: 'Yellow and blue route around stones and share the middle row',
    tag: 'think',
    strokes: [['y', 0, 0, 'RRRRDDLULDLLU'], ['b', 0, 4, 'RRRRUULLDLLUR']], stones: [[1, 1], [3, 3]],
  },
  {
    id: 'b24', name: 'Purple stripe', idea: 'Twin blues share a stony field; a short red stroke turns a stripe purple',
    tag: 'think',
    strokes: [['b', 0, 0, 'DDDRUUURRD'], ['b', 5, 3, 'UUULDDDLLU'], ['r', 6, 1, 'LLL']], stones: [[2, 1], [3, 2]],
  },
  {
    id: 'b25', name: 'Rock pool', idea: 'Three colours frame a rock: orange, green and purple corners',
    tag: 'boss',
    strokes: [['y', 0, 0, 'RRRRRDLLLLL'], ['r', 0, 5, 'UUUURDDDD'], ['b', 5, 5, 'LLLLURRRRULURUL']], stones: [[2, 2], [3, 2], [2, 3], [3, 3]],
  },
  {
    id: 'b26', name: 'Goldfish', idea: 'Picture: orange fish with a yellow tail in a blue pond',
    tag: 'boss',
    strokes: [['r', 0, 2, 'RDRRULUR'], ['y', 1, 1, 'RRDLLDRRRRUUL'], ['b', 0, 0, 'RRRRRRDDDDLLLLLL']],
  },
  {
    id: 'b27', name: 'Snail', idea: 'Picture: a red spiral under yellow makes an orange shell',
    tag: 'think',
    strokes: [['r', 1, 1, 'DRUULLDDDRRRUUU'], ['y', 6, 2, 'DDLLLLLLURRRUUULLLDDRRU'], ['b', 0, 5, 'RRRRRRULLLLLL']],
  },
  {
    id: 'b28', name: 'Rainbow', idea: 'Picture: five bands from three strokes',
    tag: 'boss',
    strokes: [['r', 1, 0, 'RRRRRDLLLLL'], ['y', 0, 2, 'RURRRRRDDLULDLULDL'], ['b', 1, 4, 'RRRRRULLLLL']],
  },
  {
    id: 'b29', name: 'Tree', idea: 'Picture: green crown from two overlapping snakes; twin reds paint trunk and earth',
    tag: 'think',
    strokes: [], pic: {
      map: ['y. .b', '.....', '.....', '.....', '  r  ', '  .  ', 'r....'],
      goal: ['YY.BB', 'YGGGB', 'YGGGB', 'YGGGB', '..R..', '..R..', 'RRRRR'],
    },
  },
  {
    id: 'b30', name: 'Dawn pond', idea: 'Finale picture: sun and sky, the sun’s purple reflection, a lily pad on the pond',
    tag: 'boss',
    strokes: [], pic: {
      map: ['y.r....', '.......', '.......', '.......', '.......', '.......', 'b......'],
      goal: ['YYRRYYY', 'YYOOYYY', 'YYOYYYY', 'BBPBBGG', 'BBPBBGG', 'BBPBBBB', 'BBBBBBB'],
    },
  },
];
