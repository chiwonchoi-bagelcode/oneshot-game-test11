// Prints every Core C picture in colour (finished state) with its region letters: node tools/cores/c/preview.ts [ids…]
import { LEVELS } from '../../../src/cores/c/levels.ts';
import { analyse } from '../../../src/cores/c/picture.ts';

const BG: Record<number, string> = { 1: '41', 2: '43', 4: '44', 3: '48;5;208', 5: '45', 6: '42', 7: '48;5;94', 0: '47' };
const want = process.argv.slice(2);
for (const def of LEVELS) {
  if (want.length && !want.includes(def.id)) continue;
  const p = analyse(def);
  const lines: string[] = [];
  for (let y = 0; y < p.h; y++) {
    let s = '';
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x, r = p.regionOf[i];
      if (r < 0) { s += p.hole[i] ? '  ' : '\x1b[2m··\x1b[0m'; continue; }
      const R = p.regions[r];
      const lab = R.labels.includes(i);
      s += `\x1b[${BG[R.goal]}m\x1b[30m${lab ? '◉' : ' '}${R.key}\x1b[0m`;
    }
    lines.push(s);
  }
  const info = p.regions.map((r) => r.key + ':' + def.paint[r.key] + (r.comps.length > 1 ? 'x' + r.comps.length : '') + (r.secret ? '?' : '')).join(' ');
  console.log(`${def.id} ${def.pic}  ${p.w}x${p.h}  pours=${def.solution.length}  inks=${def.inks.join('')}  ${info}`);
  console.log(lines.join('\n') + '\n');
}
