/*
 * Core E verifier:  node tools/cores/e/verify.ts [--stage N] [--md]
 *
 * Checks every stage of src/cores/e/levels.ts with the game's own rules (src/core/sim.ts):
 *  - the stored solution wins in the real Sim, starts on the marked spot at beat 0, and is
 *    human-playable (never two drops in one live beat; waits <= 6 beats)
 *  - sizes, ink counts, ids, intro schedule (one new idea at a time, guided teaching stages,
 *    rule-card strings in KO+EN, diagrams for core-specific rules), coach-line strings
 *  - the marked first drop is *required*: every solution of the free puzzle starts there
 *    (or, at the very least, the marked start is valid and cuts the search down)
 *  - "mindless play" after the given first drop: random tapping and a greedy bot (drops on/next to
 *    matching targets as soon as it can) - both must mostly fail once the tutorial is over
 *  - evidence: the arrival badges the first drop shows (what the player reads), and that the
 *    stage is not a chain-watching stage (later drops are needed)
 * Exit code 1 on any error. --md prints the stage table as Markdown.
 */
import { LEVELS } from '../../../src/cores/e/levels.ts';
import STR from '../../../src/cores/e/strings.ts';
import PLAY from '../../../src/i18n/strings/play.ts';
import { E_DIAGRAMS } from '../../../src/cores/e/diagram-data.ts';
import { runSolution, Sim, parseLevel, type LevelDef } from '../../../src/core/sim.ts';
import { planInputErrors } from '../../level-lib.ts';
import { solveFrom, randomAfterFirst, greedyAfterFirst, badgesOf, firstIdx, boardOf, dropsToPlan, mulberry32, planStr } from './lib.ts';

const args = process.argv.slice(2);
const only = args.includes('--stage') ? parseInt(args[args.indexOf('--stage') + 1], 10) : 0;
const md = args.includes('--md');
const ORIG_KEYS = new Set(['drop', 'walls', 'order', 'mix', 'timing', 'parity', 'three', 'range', 'white', 'seed', 'gate', 'slow']);

const errors: string[] = [];
const warns: string[] = [];
const err = (n: number, m: string) => errors.push(`#${n} ${m}`);
const warn = (n: number, m: string) => warns.push(`#${n} ${m}`);
const str = (lang: 'ko' | 'en', k: string) => (STR as any)[lang][k] ?? (PLAY as any)[lang][k];

if (LEVELS.length !== 30) errors.push('expected 30 stages, got ' + LEVELS.length);
const ids = new Set<string>();
const maps = new Map<string, number>();
const introSeen = new Set<string>();
const rows: string[][] = [];

function seedOf(def: LevelDef): number {
  let h = 2166136261 >>> 0;
  const s = def.map.join('/') + '|' + def.goal.join('/') + '|' + def.inks.join(',');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

LEVELS.forEach((def, k) => {
  const n = k + 1;
  if (only && n !== only) {
    if (def.intro) introSeen.add(def.intro);
    return;
  }
  if (ids.has(def.id)) err(n, 'duplicate id ' + def.id);
  ids.add(def.id);
  const mk = def.map.join('/');
  if (maps.has(mk)) err(n, 'same board as stage ' + maps.get(mk) + ' (no padding)');
  maps.set(mk, n);
  let L;
  try {
    L = parseLevel(def);
  } catch (e) {
    err(n, 'parse: ' + (e as Error).message);
    return;
  }
  if (L.w < 4 || L.w > 7) err(n, 'width ' + L.w + ' (4..7 so cells stay big on a 360px phone)');
  if (L.h < 3 || L.h > 9) err(n, 'height ' + L.h);
  if (def.solution.length !== def.inks.length) err(n, 'solution has ' + def.solution.length + ' drops for ' + def.inks.length + ' inks');
  if (def.solution[0]?.t !== 0) err(n, 'first drop not on beat 0');
  if (n > 1 && def.inks.length < 2) err(n, 'one ink only: a chain-watching stage');
  const B = boardOf(def);
  const plan = dropsToPlan(B, def.solution);
  for (const e of planInputErrors(plan)) err(n, 'input: ' + e);
  const r = runSolution(def, def.solution);
  if (!r.ok) err(n, 'stored solution fails in Sim: ' + (r.errors.join('; ') || 'fail tick ' + r.failTick) + '\n' + r.sim.ascii());
  if (r.ticks > 24) warn(n, 'settles late (beat ' + r.ticks + ')');

  // Intro schedule
  if (def.intro) {
    if (introSeen.has(def.intro)) err(n, 'intro ' + def.intro + ' introduced twice');
    introSeen.add(def.intro);
    for (const lang of ['ko', 'en'] as const) {
      for (const f of ['title', 'body']) if (!str(lang, 'mech.' + def.intro + '.' + f)) err(n, `missing ${lang} mech.${def.intro}.${f}`);
    }
    if (!ORIG_KEYS.has(def.intro)) {
      if (!def.intro.startsWith('e_')) err(n, 'core key not prefixed e_: ' + def.intro);
      if (!E_DIAGRAMS[def.intro]) err(n, 'no diagram for ' + def.intro);
    }
  }
  if (def.coach) {
    let any = false;
    for (const m of ['start', 'first', 'due']) {
      const key = 'e.coach.' + def.coach + '.' + m;
      const ko = (STR as any).ko[key], en = (STR as any).en[key];
      if (!!ko !== !!en) err(n, 'coach line only in one language: ' + key);
      if (ko) any = true;
      if (m === 'due' && ko && !def.guided) err(n, 'due line on a stage that is not guided');
    }
    if (!any) err(n, 'coach key without lines: ' + def.coach);
  }
  if (n <= 3 && !def.guided) err(n, 'the first three stages teach (guided)');
  if (n > 5 && def.guided) warn(n, 'guided late');

  // Solutions with the marked start, and free ones.
  const first = firstIdx(def);
  const forced = solveFrom(B, { first, keep: only ? 12 : 0 });
  const free = solveFrom(B, { first: null, nodeBudget: 6e6 });
  if (!forced.complete) warn(n, 'forced search incomplete');
  if (forced.solutions < 1) err(n, 'no solution found from the marked start');
  let share = '-';
  if (free.complete) {
    const other = free.solutions - (free.firsts.get(first) || 0);
    share = other === 0 ? 'only' : Math.round(((free.firsts.get(first) || 0) / free.solutions) * 100) + '%';
    if (other > 0 && n > 1) {
      const cells = [...free.firsts.keys()].filter((c) => c !== first).map((c) => (c % B.w) + ',' + Math.floor(c / B.w));
      warn(n, 'other first-drop spots also work: ' + cells.join(' '));
    }
  }
  const timing = forced.t0 === 0 ? (forced.solutions ? 'need' : '-') : 'opt';
  const rng = mulberry32(seedOf(def));
  const rnd = randomAfterFirst(B, first, 4000, rng);
  const gre = greedyAfterFirst(B, first, 600, rng);
  if (n >= 6 && rnd > 0.05) warn(n, 'random play wins ' + (rnd * 100).toFixed(1) + '% after the first drop');
  if (n >= 8 && gre > 0.25) warn(n, 'greedy play wins ' + (gre * 100).toFixed(0) + '%');

  // Evidence from the first drop.
  const s0 = new Sim(def);
  s0.drop(first);
  const bad0 = s0.forecast().result;
  const bs = badgesOf(s0);
  const nb = { partner: 0, threat: 0, promise: 0 };
  for (const b of bs) nb[b.kind]++;
  if (n > 1 && !bs.length) warn(n, 'the first drop shows no badge (no visible evidence)');
  if (n > 1 && bad0 === 'win') err(n, 'the first drop alone wins (chain-watching)');
  const t2 = def.solution[1]?.t ?? 0;
  if (n > 3 && def.solution.length > 1 && t2 < 1) warn(n, 'second drop due on beat 0 (no time to read the spread)');
  const tags = [def.intro ? def.intro : '', def.guided ? 'G' : '', def.tag || ''].filter(Boolean).join(' ');
  rows.push([String(n), def.id, tags, def.inks.join(''), L.w + 'x' + L.h, String(L.targets.length + L.whites.length), String(forced.solutions) + (forced.complete ? '' : '+'), free.complete ? String(free.solutions) : '?', share, timing, (rnd * 100).toFixed(1), (gre * 100).toFixed(0), `${nb.partner}/${nb.threat}/${nb.promise}`, def.solution.map((d) => d.t).join(','), String(r.ticks)]);

  if (only) {
    console.log(def.id, def.inks.join(' '), 'first', first % B.w + ',' + Math.floor(first / B.w));
    console.log(r.sim.ascii());
    console.log('badges after first drop:', bs.map((b) => `${b.kind}@${b.idx % B.w},${Math.floor(b.idx / B.w)} c${b.c} in ${b.beat}`).join('  '));
    console.log('forced solutions', forced.solutions, forced.complete ? '' : '(incomplete)', 'nodes', forced.nodes);
    for (const p of forced.examples) console.log('   ', planStr(B, p, def.inks));
    console.log('free solutions', free.solutions, free.complete ? '' : '(incomplete)', 'firsts', [...free.firsts.entries()].map(([c, m]) => `${c % B.w},${Math.floor(c / B.w)}:${m}`).join(' '));
  }
});

const head = ['#', 'id', 'intro/tag', 'inks', 'size', 'goal', 'sols', 'free', 'start', 'timing', 'rnd%', 'greedy%', 'badges p/t/m', 'beats', 'settle'];
if (md) {
  console.log('| ' + head.join(' | ') + ' |');
  console.log('|' + head.map(() => '---').join('|') + '|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
} else {
  const wds = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(wds[i])).join('  ');
  console.log(line(head));
  for (const r of rows) console.log(line(r));
}
if (warns.length) console.log('\nWarnings:\n  ' + warns.join('\n  '));
if (errors.length) {
  console.log('\nERRORS:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\nOK: ' + rows.length + ' stage(s) verified.');
