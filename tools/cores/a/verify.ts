/*
 * Core A level verifier:  node tools/cores/a/verify.ts
 * Checks every stage with the game's own rules (src/cores/a/rules.ts):
 *  - exactly 30 stages, unique ids, board ≤ 7×9, 1..5 inks (tray fits at 360 px), amounts 1..12
 *  - the stored solution is legal (paper cells, not clean, one drop per cell) and paints the picture
 *  - the answer is unique (identical inks interchangeable) and every ink is needed
 *  - no goal asks for mud; every intro key has a rule card (strings) and a diagram; ≤ 1 new idea
 *    per stage; stage 1 is guided; coach keys exist in KO and EN
 *  - "mindless play" success: random placement and "safe" placement (avoid visibly breaking
 *    anything) Monte Carlo rates, reported per stage; after the tutorial (stage 4+) the safe rate
 *    must stay under 10%.
 */
import { parseLevel, WHITE } from '../../../src/core/sim.ts';
import { LEVELS } from '../../../src/cores/a/levels.ts';
import STR from '../../../src/cores/a/strings.ts';
import { paint, solved, solve, solvableWithFewer, mindless, placeable, greedy } from '../../../src/cores/a/rules.ts';
import { readFileSync } from 'node:fs';

const diagSrc = readFileSync(new URL('../../../src/cores/a/diagrams.ts', import.meta.url), 'utf8');
const errors: string[] = [];
const err = (m: string) => errors.push(m);
const rows: string[] = [];
let lateThinkers = 0;

if (LEVELS.length !== 30) err(`expected 30 stages, got ${LEVELS.length}`);
const ids = new Set<string>();
const seenIntro = new Set<string>();
LEVELS.forEach((def, n) => {
  const no = n + 1;
  const tag = `#${no} ${def.id}`;
  if (ids.has(def.id)) err(`${tag}: duplicate id`);
  ids.add(def.id);
  let L;
  try { L = parseLevel(def); } catch (e) { err(`${tag}: ${(e as Error).message}`); return; }
  if (L.w > 7 || L.h > 9 || L.w < 4 || L.h < 4) err(`${tag}: size ${L.w}x${L.h}`);
  if (L.inks.length < 1 || L.inks.length > 5) err(`${tag}: ${L.inks.length} inks`);
  for (const ink of L.inks) if (!(ink.range >= 1 && ink.range <= 12)) err(`${tag}: bad amount ${ink.range}`);
  if (def.mud) err(`${tag}: mud goals are not allowed in core A`);
  if (!L.targets.length) err(`${tag}: no targets`);
  // Solution legality + result.
  const used = new Set<number>();
  const ks = new Set<number>();
  const drops = def.solution.map((d, i) => {
    const idx = d.y * L.w + d.x, k = d.k ?? i;
    if (!placeable(L, idx)) err(`${tag}: solution drop on a non-paper or clean cell (${d.x},${d.y})`);
    if (used.has(idx)) err(`${tag}: two drops on (${d.x},${d.y})`);
    if (ks.has(k)) err(`${tag}: ink ${k} used twice`);
    used.add(idx); ks.add(k);
    return { idx, k };
  });
  if (drops.length !== L.inks.length) err(`${tag}: solution uses ${drops.length} of ${L.inks.length} inks`);
  const ink = paint(L, drops);
  if (!solved(L, ink)) err(`${tag}: stored solution does not solve it`);
  // Clean cells must not be painted by the answer, and no target may be unreachable paper.
  for (const i of L.whites) if (ink[i]) err(`${tag}: clean cell painted`);
  const res = solve(L, 20);
  if (res.count !== 1) err(`${tag}: ${res.count} distinct answers`);
  if (solvableWithFewer(L)) err(`${tag}: solvable without one of its inks`);
  const mm = mindless(L, 4000, 11 + n);
  const gr = greedy(L, 300, 3 + n);
  if (no >= 22 && gr < 0.5) lateThinkers++;
  if (no >= 4 && mm.safe > 0.1) err(`${tag}: mindless "safe" play wins ${(mm.safe * 100).toFixed(1)}%`);
  // Intro schedule.
  if (def.intro) {
    if (seenIntro.has(def.intro)) err(`${tag}: intro ${def.intro} repeated`);
    seenIntro.add(def.intro);
    for (const lang of ['ko', 'en'] as const) {
      if (!STR[lang]['mech.' + def.intro + '.title'] || !STR[lang]['mech.' + def.intro + '.body']) err(`${tag}: missing ${lang} rule card for ${def.intro}`);
    }
    if (!diagSrc.includes(`registerDiagram('${def.intro}'`)) err(`${tag}: no diagram for ${def.intro}`);
    if (!def.intro.startsWith('a_')) err(`${tag}: intro key must start with a_`);
  }
  if (def.coach) for (const lang of ['ko', 'en'] as const) if (!STR[lang][def.coach]) err(`${tag}: missing ${lang} coach ${def.coach}`);
  if (no === 1 && !def.guided) err(`${tag}: stage 1 must be guided`);
  if (no === 1 && !def.intro) err(`${tag}: stage 1 needs an intro key (rules book)`);
  if (no > 6 && def.guided) err(`${tag}: guided after the tutorial`);
  const mixed = L.targets.filter((i) => [3, 5, 6].includes(L.goal[i])).length;
  const colors = new Set(L.inks.map((s) => s.c)).size;
  rows.push(`${String(no).padStart(2)} ${def.id} ${L.w}x${L.h} ${def.inks.join(' ').padEnd(16)} tgt ${String(L.targets.length).padStart(2)} mix ${String(mixed).padStart(2)} clean ${L.whites.length} colors ${colors}  random ${(mm.random * 100).toFixed(2).padStart(5)}%  safe ${(mm.safe * 100).toFixed(1).padStart(4)}%  greedy ${(gr * 100).toFixed(0).padStart(3)}%  ${def.intro ? 'NEW ' + def.intro : ''}${def.guided ? ' (guided)' : ''}`);
  void WHITE;
});
if (lateThinkers < 5) err(`only ${lateThinkers} of stages 22-30 resist one-ink-at-a-time shape matching (need 5)`);
// Every key in KO exists in EN and vice versa.
for (const k of Object.keys(STR.ko)) if (!(k in STR.en)) err(`strings: ${k} missing in en`);
for (const k of Object.keys(STR.en)) if (!(k in STR.ko)) err(`strings: ${k} missing in ko`);
// No emoji in copy.
for (const lang of ['ko', 'en'] as const) for (const [k, v] of Object.entries(STR[lang])) if (/\p{Extended_Pictographic}/u.test(v)) err(`strings: emoji in ${lang} ${k}`);

console.log(rows.join('\n'));
if (errors.length) {
  console.log('\nFAIL\n' + errors.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
console.log(`\nOK: ${LEVELS.length} stages verified`);
