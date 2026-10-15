// Quick analyzer for a design: node tools/cores/b/try.ts  (edit DESIGNS below)
import { analyze } from './solver.ts';
import type { LevelDef } from '../../../src/core/sim.ts';
const D: [string, string[], string[]][] = JSON.parse(process.argv[2] || '[]');
for (const [id, map, goal] of D) {
  const def: LevelDef = { id, map, goal, inks: [], solution: [] };
  const r = analyze(def);
  console.log(id, `${r.w}x${r.h} cells=${r.cells} sol=${r.solutions}${r.capped ? '+' : ''} greedy=${(r.greedy * 100).toFixed(1)}%`, r.colors.map((c) => `[c${c.c} n=${c.cells} src=${c.sources} sol=${c.count}${c.capped ? '+' : ''} g=${(c.greedy * 100).toFixed(0)}% dead=${c.deadEnds}]`).join(' '));
}
