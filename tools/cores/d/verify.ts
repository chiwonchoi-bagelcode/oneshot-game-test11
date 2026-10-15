/*
 * Core D verifier: checks every stage with the game's own rules (src/core/sim.ts +
 * src/cores/d/rules.ts, the same code the core plays).
 *   node tools/cores/d/verify.ts            exits non-zero on any error
 *
 * Checks: 30 stages, ids, sizes, wells (on paper, unique, inks match), solutions (well drops,
 * beat 0 first, at most one drop per running beat, wins under the game's rules), the intro
 * schedule (every rule taught before it is used, every intro key has a card text in KO/EN and a
 * diagram), each intro stage really needs its idea, re-skinned daily copies still solve, and the
 * difficulty table (solutions, mindless random play, random play + hold preview).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseLevel, parseInk, WHITE, type LevelDef } from '../../../src/core/sim.ts';
import { transformLevel } from '../../../src/core/transform.ts';
import { LEVELS } from '../../../src/cores/d/levels.ts';
import STR from '../../../src/cores/d/strings.ts';
import { runPlan, dropsToPlan, solutions, wellSpecs } from '../../../src/cores/d/rules.ts';
import { measureD, finalBoard } from './lib.ts';

const errors: string[] = [];
const warns: string[] = [];
const err = (id: string, m: string) => errors.push(id + ': ' + m);
const warn = (id: string, m: string) => warns.push(id + ': ' + m);

const ROOT = new URL('../../../', import.meta.url);
const coreSrc = readFileSync(new URL('src/cores/d/core.ts', ROOT), 'utf8');
const diagSrc = readFileSync(new URL('src/cores/d/diagrams.ts', ROOT), 'utf8');

if (LEVELS.length !== 30) err('pack', LEVELS.length + ' stages, expected 30');
const learned = new Set<string>();
const introAt = new Map<string, number>();
const rows: string[] = [];

LEVELS.forEach((def, i) => {
  const n = i + 1;
  const id = def.id;
  if (id !== 'd' + String(n).padStart(2, '0')) err(id, 'id should be d' + String(n).padStart(2, '0'));
  let L;
  try { L = parseLevel(def); } catch (e) { err(id, 'parse: ' + (e as Error).message); return; }
  if (L.w > 8 || L.h > 9 || L.w < 3 || L.h < 3) err(id, `size ${L.w}x${L.h} outside 3..8 x 3..9`);
  const wells = def.wells || [];
  if (!wells.length) err(id, 'no wells');
  const seen = new Set<number>();
  wells.forEach((w, k) => {
    const idx = w.y * L.w + w.x;
    if (w.x < 0 || w.y < 0 || w.x >= L.w || w.y >= L.h) return err(id, 'well ' + k + ' outside');
    if (L.wall[idx] || L.seed[idx] || L.gate[idx]) err(id, 'well ' + k + ' not on paper');
    if (L.goal[idx] === WHITE) err(id, 'well ' + k + ' on a clean cell');
    if (L.goal[idx]) warn(id, 'well ' + k + ' sits on a goal cell');
    if (seen.has(idx)) err(id, 'two wells on one cell');
    seen.add(idx);
    try { parseInk(w.ink); } catch { err(id, 'well ' + k + ' bad ink ' + w.ink); }
  });
  if (def.inks.join() !== wells.map((w) => w.ink).join()) err(id, 'inks must list the wells (one drop each)');
  if (L.targets.length < 1) err(id, 'no targets');

  // Solution: drops from wells, beat 0 first, one drop per running beat, wins.
  const sol = def.solution;
  if (!sol.length) err(id, 'no solution');
  if (sol[0] && sol[0].t !== 0) err(id, 'first drop must be on beat 0');
  const beats = new Map<number, number>();
  for (const d of sol) {
    if (d.k === undefined || !wells[d.k] || wells[d.k].x !== d.x || wells[d.k].y !== d.y) err(id, 'drop ' + JSON.stringify(d) + ' is not a well');
    if (d.t > 0) beats.set(d.t, (beats.get(d.t) || 0) + 1);
  }
  for (const [t, c] of beats) if (c > 1) err(id, c + ' drops on running beat ' + t + ' (one per beat)');
  const ts = sol.map((d) => d.t);
  for (let j = 1; j < ts.length; j++) if (ts[j] < ts[j - 1]) err(id, 'solution not in beat order');
  if (Math.max(...ts) > 5) warn(id, 'a drop waits ' + Math.max(...ts) + ' beats');
  const r = runPlan(def, dropsToPlan(sol));
  if (r.result !== 'win') err(id, 'stored solution does not win: ' + r.result + ' ' + r.errors.join('; '));
  else if (r.used.length !== sol.length) err(id, 'stored solution wins before its last drop');

  // Rules used by this stage.
  const specs = wellSpecs(def);
  const uses = new Set<string>();
  if (ts.some((t) => t > 0)) uses.add('d_wait');
  if (wells.length > sol.length) uses.add('d_decoy');
  if (specs.some((s) => isFinite(s.range))) uses.add('d_range');
  if (L.whites.length) uses.add('d_white');
  if (L.slow.some((v) => v)) uses.add('d_slow');
  if (new Set(sol.map((d) => specs[d.k!].c)).size >= 3) uses.add('d_three');
  const F = finalBoard(def, dropsToPlan(sol));
  if (F.mixed.some((v) => v)) uses.add('d_mix');
  if (def.intro) {
    if (introAt.has(def.intro)) err(id, 'intro ' + def.intro + ' already taught at ' + introAt.get(def.intro));
    introAt.set(def.intro, n);
    learned.add(def.intro);
    for (const lang of ['ko', 'en'] as const) for (const part of ['title', 'body']) if (!STR[lang]['mech.' + def.intro + '.' + part]) err(id, `missing ${lang} mech.${def.intro}.${part}`);
    if (n > 1 && !diagSrc.includes(def.intro + ':')) err(id, 'no diagram for ' + def.intro);
    // The intro stage must really need its idea.
    const need: Record<string, boolean> = {
      d_well: true, d_mix: uses.has('d_mix'), d_wait: uses.has('d_wait') && !solutions(def).some((p) => p.every((d) => d.t === 0)),
      d_touch: uses.has('d_wait') && !solutions(def).some((p) => p.every((d) => d.t === 0)), d_decoy: uses.has('d_decoy'), d_range: uses.has('d_range'),
      d_three: uses.has('d_three'), d_white: uses.has('d_white'), d_slow: uses.has('d_slow'), d_cover: coversIfLate(def),
    };
    if (need[def.intro] === undefined) err(id, 'unknown intro ' + def.intro);
    else if (!need[def.intro]) err(id, 'intro stage does not need ' + def.intro);
  }
  learned.add('d_well');
  for (const u of uses) {
    const key = u === 'd_wait' && !learned.has('d_wait') ? 'd_wait' : u;
    if (!learned.has(key) && u !== 'd_mix') err(id, 'uses ' + u + ' before it is taught');
    if (u === 'd_mix' && !learned.has('d_mix') && n > 3) err(id, 'mixes before d_mix');
  }
  if (def.coach) for (const lang of ['ko', 'en'] as const) if (!STR[lang][def.coach]) err(id, 'missing coach string ' + def.coach + ' (' + lang + ')');

  // Daily copies (mirrored, colours swapped) must still solve with the same plan.
  if (n >= 6) {
    const perms: [string, string, string][] = [['B', 'R', 'Y'], ['Y', 'B', 'R']];
    for (const [fx, fy, perm] of [[true, false, perms[0]], [false, true, perms[1]], [true, true, perms[0]]] as [boolean, boolean, [string, string, string]][]) {
      const t = transformLevel(def, { flipX: fx, flipY: fy, perm }, id + '-t');
      const rr = runPlan(t, dropsToPlan(t.solution));
      if (rr.result !== 'win') err(id, 'daily copy fails (' + fx + ',' + fy + ',' + perm.join('') + ')');
    }
  }

  const m = measureD(def);
  if (m.solutions < 1) err(id, 'solver finds no solution');
  if (n > 3 && m.random > 0.6) warn(id, 'mindless random play wins ' + (m.random * 100).toFixed(0) + '%');
  rows.push(`| ${n} | ${def.intro || ''}${def.guided ? ' (guided)' : ''} | ${L.w}x${L.h} | ${wells.length} | ${sol.length} | ${sol.map((d) => d.t).join(',')} | ${L.targets.length}${L.whites.length ? '+' + L.whites.length + 'w' : ''} | ${m.solutions} | ${(m.random * 100).toFixed(1)}% | ${(m.preview * 100).toFixed(1)}% | ${[...uses].filter((u) => u !== 'd_mix').map((u) => u.slice(2)).join(' ')} |`);
});

/** A well in the solution would be covered by other ink if it were opened later than planned. */
function coversIfLate(def: LevelDef): boolean {
  for (const d of def.solution) {
    for (let late = d.t + 1; late <= d.t + 8; late++) {
      const plan = dropsToPlan(def.solution).map((p) => (p.k === d.k ? { k: p.k, t: late } : p));
      try { finalBoard(def, plan); } catch { return true; }
    }
  }
  return false;
}

// Strings used by the core exist in both languages.
for (const m of coreSrc.matchAll(/t\('(d\.[\w.]+)'/g)) for (const lang of ['ko', 'en'] as const) if (!STR[lang][m[1]]) err('strings', `missing ${lang} ${m[1]}`);
for (const k of Object.keys(STR.ko)) if (!(k in STR.en)) err('strings', 'en missing ' + k);
for (const k of Object.keys(STR.en)) if (!(k in STR.ko)) err('strings', 'ko missing ' + k);
// No emoji in copy.
for (const lang of ['ko', 'en'] as const) for (const [k, v] of Object.entries(STR[lang])) if (/\p{Extended_Pictographic}/u.test(v)) err('strings', 'emoji in ' + lang + ' ' + k);
// Guided lessons where the brief puts them.
const guided = LEVELS.map((l, i) => (l.guided ? i + 1 : 0)).filter(Boolean);
if (guided.join() !== '1,3,4') warn('pack', 'guided stages: ' + guided.join(','));

const table = ['| # | intro | size | wells | drops | beats | targets | solutions | random | random+preview | uses |', '|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
console.log(table);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/verify-table.md', import.meta.url), table + '\n');
if (warns.length) console.log('\nwarnings:\n  ' + warns.join('\n  '));
if (errors.length) {
  console.log('\nERRORS:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\nall ' + LEVELS.length + ' stages ok');
