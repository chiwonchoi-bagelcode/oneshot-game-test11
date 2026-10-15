// Prints designs with their pictures and solver metrics: node tools/cores/b/view.ts [id ...]
import { STAGES } from './stages.ts';
import { build } from './gen.ts';
import { analyze } from './solver.ts';
const want = process.argv.slice(2);
STAGES.forEach((d, n) => {
  if (want.length && !want.includes(d.id)) return;
  try {
    const def = build(d);
    const r = analyze(def);
    console.log(`#${n + 1} ${d.id} ${d.name} ${r.w}x${r.h} cells=${r.cells} sol=${r.solutions}${r.capped ? '+' : ''} greedy=${(r.greedy * 100).toFixed(1)}% ` + r.colors.map((c) => `[c${c.c} n=${c.cells} s=${c.sources} sol=${c.count}${c.capped ? '+' : ''} g=${(c.greedy * 100).toFixed(0)}%]`).join(''));
    def.map.forEach((m, y) => console.log('   ' + m.replace(/ /g, '·') + '   ' + def.goal[y].replace(/\./g, '·')));
  } catch (e) { console.log(`#${n + 1} ${d.id} ERROR ${(e as Error).message}`); }
});
