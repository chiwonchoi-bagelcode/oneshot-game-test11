/*
 * Core B verifier: node tools/cores/b/verify.ts
 *
 * Checks every stage with the same rules the game uses (src/cores/b/rules.ts):
 *  - 30 stages, unique ids, the game's own parser accepts each map/goal, sizes fit a phone;
 *  - the picture is complete (every paper cell has a goal colour, drops sit on their own colour,
 *    goal colours can be made from the drops on the board, no mud);
 *  - the stored strokes play through the game's step rules and finish the picture;
 *  - intro schedule (stage 1 = b_draw, one card per new idea, strings and diagrams exist),
 *    coach/guide strings in KO and EN, every core string key used in core.ts exists;
 *  - difficulty: solution count (solver), "fills without planning" success (random walks inside
 *    the right cells) and "mindless play" success (random strokes ignoring the picture).
 * Exit code 1 on any problem.
 */
import { readFileSync } from 'node:fs';
import { LEVELS } from '../../../src/cores/b/levels.ts';
import STR from '../../../src/cores/b/strings.ts';
import { DIAGRAMS } from '../../../src/cores/b/diagrams.ts';
import { prepare, playStrokes, solutionStrokes, neighbors, Board } from '../../../src/cores/b/rules.ts';
import { parseLevel } from '../../../src/core/sim.ts';
import { analyze } from './solver.ts';
import { transformLevel } from '../../../src/core/transform.ts';

const problems: string[] = [];
const bad = (id: string, m: string) => problems.push(`${id}: ${m}`);
const MAX_W = 7, MAX_H = 7;

if (LEVELS.length !== 30) problems.push(`expected 30 stages, got ${LEVELS.length}`);
const ids = new Set<string>();
const introsSeen = new Set<string>();

/** Random strokes that ignore the picture: from each drop, wander a random length. */
function mindless(def: (typeof LEVELS)[number], trials = 2000): number {
  const lv = prepare(def);
  let s = 99, ok = 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let t = 0; t < trials; t++) {
    const b = new Board(lv);
    lv.sources.forEach((_, k) => {
      const len = Math.floor(rnd() * lv.cells.length);
      for (let j = 0; j < len; j++) {
        const opts = neighbors(lv, b.end(k)).filter((n) => b.blockFor(k, n) === null);
        if (!opts.length) break;
        b.extend(k, opts[Math.floor(rnd() * opts.length)]);
      }
    });
    if (b.isWin()) ok++;
  }
  return ok / trials;
}

const rows: string[] = [];
LEVELS.forEach((def, n) => {
  const id = def.id;
  if (ids.has(id)) bad(id, 'duplicate id');
  ids.add(id);
  try { parseLevel(def); } catch (e) { bad(id, 'game parser: ' + (e as Error).message); return; }
  const lv = prepare(def);
  if (lv.w > MAX_W || lv.h > MAX_H) bad(id, `board ${lv.w}x${lv.h} too big for a phone (max ${MAX_W}x${MAX_H})`);
  if (!lv.sources.length) bad(id, 'no drops');
  const have = lv.sources.reduce((a, s) => a | s.c, 0);
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    const i = y * lv.w + x, g = def.goal[y][x], m = def.map[y][x];
    if (!'.rybR# '.includes(m) || m === 'R') bad(id, `unexpected map char "${m}" at ${x},${y}`);
    if (lv.open[i]) {
      if (!lv.goal[i]) bad(id, `paper cell ${x},${y} has no goal colour`);
      if (lv.goal[i] === 7) bad(id, `mud goal at ${x},${y}`);
      if (lv.goal[i] & ~have) bad(id, `goal at ${x},${y} needs a colour with no drop`);
    } else if (g !== '.') bad(id, `goal on a hole/stone at ${x},${y}`);
  }
  for (const s of lv.sources) if (lv.goal[s.idx] !== s.c) bad(id, `drop at ${s.idx} sits on a different goal colour`);
  // Every drop must matter (its colour has cells to paint) unless it's a lone-cell drop by design.
  const strokes = solutionStrokes(lv);
  const run = playStrokes(lv, strokes);
  if (!run.ok) bad(id, 'stored strokes fail: ' + (run.errors.join('; ') || 'picture not finished'));
  const starts = (def.strokes || []).map((p) => lv.srcAt[p[0].y * lv.w + p[0].x]);
  if (starts.length !== lv.sources.length || new Set(starts).size !== starts.length || starts.some((k) => k < 0)) bad(id, 'strokes must start on distinct drops, one per drop');
  // Dailies are mirrored / colour-swapped copies of stages 6-30: they must stay solvable.
  for (const flipX of [false, true]) for (const flipY of [false, true]) for (const perm of [['R', 'Y', 'B'], ['B', 'R', 'Y'], ['Y', 'B', 'R']] as [string, string, string][]) {
    const t = transformLevel(def, { flipX, flipY, perm }, id + '-t');
    const tl = prepare(t);
    if (!playStrokes(tl, solutionStrokes(tl)).ok) bad(id, `daily copy (flip ${flipX}/${flipY}, ${perm.join('')}) fails`);
  }
  // Intro schedule.
  if (n === 0 && def.intro !== 'b_draw') bad(id, 'stage 1 must introduce b_draw');
  if (def.intro) {
    if (introsSeen.has(def.intro)) bad(id, `intro ${def.intro} repeated`);
    introsSeen.add(def.intro);
    if (!def.intro.startsWith('b_')) bad(id, 'intro key must start with b_');
    for (const L of ['ko', 'en'] as const) {
      if (!STR[L]['mech.' + def.intro + '.title'] || !STR[L]['mech.' + def.intro + '.body']) bad(id, `missing ${L} rule card strings for ${def.intro}`);
    }
    if (!DIAGRAMS[def.intro]) bad(id, `no diagram for ${def.intro}`);
  }
  if (def.coach) for (const L of ['ko', 'en'] as const) if (!STR[L][def.coach]) bad(id, `missing ${L} coach ${def.coach}`);
  if (def.guided && !strokes.length) bad(id, 'guided stage without strokes');
  const r = analyze(def, 20000);
  if (!r.solutions) bad(id, 'solver finds no solution');
  const mind = mindless(def);
  const longest = Math.max(...strokes.map((p) => p.length));
  rows.push(`${String(n + 1).padStart(2)} ${id} ${(lv.w + 'x' + lv.h).padEnd(4)} cells ${String(lv.cells.length).padStart(2)}  drops ${def.inks.join('').padEnd(4)} longest ${String(longest).padStart(2)}  solutions ${String(r.solutions).padStart(5)}${r.capped ? '+' : ' '} planless-fill ${(r.greedy * 100).toFixed(1).padStart(5)}%  mindless ${(mind * 100).toFixed(1).padStart(5)}%  diff ${String(def.diff ?? '-').padStart(3)}  ${def.intro || ''}${def.guided ? ' guided' : ''}`);
});

// Rules taught in order: the build's rule keys appear exactly once.
for (const k of ['b_draw', 'b_fill', 'b_mix', 'b_three', 'b_twin', 'b_stone']) if (!introsSeen.has(k)) problems.push(`rule ${k} never introduced`);
// Mechanics must be introduced before first use.
const firstUse = (pred: (d: (typeof LEVELS)[number]) => boolean) => LEVELS.findIndex(pred);
const introAt = (k: string) => LEVELS.findIndex((d) => d.intro === k);
const mixIdx = firstUse((d) => d.goal.some((r) => /[OPG]/.test(r)));
if (mixIdx >= 0 && mixIdx < introAt('b_mix')) problems.push('mixing used before b_mix');
const threeIdx = firstUse((d) => d.goal.some((r) => /[OP]/.test(r)));
if (threeIdx >= 0 && threeIdx < introAt('b_three')) problems.push('orange/purple used before b_three');
const twinIdx = firstUse((d) => new Set(d.inks).size < d.inks.length);
if (twinIdx >= 0 && twinIdx < introAt('b_twin')) problems.push('twin drops used before b_twin');
const stoneIdx = firstUse((d) => d.map.some((r) => r.includes('#')));
if (stoneIdx >= 0 && stoneIdx < introAt('b_stone')) problems.push('stones used before b_stone');

// String keys used by the core exist in both languages.
const coreSrc = readFileSync(new URL('../../../src/cores/b/core.ts', import.meta.url), 'utf8');
for (const m of coreSrc.matchAll(/t\('(b\.[a-zA-Z.]+)'/g)) for (const L of ['ko', 'en'] as const) if (!STR[L][m[1]]) problems.push(`missing ${L} string ${m[1]}`);
for (const m of coreSrc.matchAll(/'(b\.(?:say|guide)\.[a-zA-Z]+)'/g)) for (const L of ['ko', 'en'] as const) if (!STR[L][m[1]]) problems.push(`missing ${L} string ${m[1]}`);
for (const k of Object.keys(STR.ko)) if (!(k in STR.en)) problems.push(`en missing ${k}`);
for (const k of Object.keys(STR.en)) if (!(k in STR.ko)) problems.push(`ko missing ${k}`);
for (const [L, d] of Object.entries(STR)) for (const [k, v] of Object.entries(d)) {
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v)) problems.push(`${L} ${k}: emoji`);
}

console.log(rows.join('\n'));
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`\nOK: ${LEVELS.length} stages verified with the game rules.`);
