/* Core E rule-card diagrams as plain data (played through the real Sim by diagrams.ts; checked by tools/cores/e/verify.ts). */
export interface DiagramBoard { map: string[]; goal?: string[]; inks: string[]; drops: { x: number; y: number; t: number }[] }

/** The diagrams (plain data, also checked by tools/cores/e/verify.ts). */
export const E_DIAGRAMS: Record<string, DiagramBoard[]> = {
  // The marked spot: the first ink lands there and spreads.
  e_first: [{ map: ['.......', '.......', '.......'], inks: ['R'], drops: [{ x: 2, y: 1, t: 0 }] }],
  // Two colours reach one cell on the same beat and mix.
  e_mix: [{ map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 0 }] }],
  // Wait two beats: blue starts closer, so both still land on the same cell together.
  e_count: [
    { map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 0 }] },
    { map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 2 }] },
  ],
  // Blue gets to its cells before red does.
  e_race: [{ map: ['.......'], inks: ['R', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 4, y: 0, t: 1 }] }],
};
