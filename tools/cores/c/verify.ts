// Core C verifier: node tools/cores/c/verify.ts
// Checks every stage with the game's own rules (src/cores/c/picture.ts): sizes, legend, stored
// solution, drop limits, intro schedule and teaching order, and prints a difficulty table with a
// "blind play" metric (a player who never reads the colours, see below).
import { LEVELS } from '../../../src/cores/c/levels.ts';
import STR from '../../../src/cores/c/strings.ts';
import { analyse, playSolution, limitsOf, bitsOf, popcount, Board, type CLevel } from '../../../src/cores/c/picture.ts';
import { parseLevel } from '../../../src/core/sim.ts';

const errors: string[] = [];
const err = (id: string, m: string) => errors.push(id + ': ' + m);

const INTRO: Record<string, string> = { c01: 'c_pour', c05: 'c_mix', c10: 'c_white', c12: 'c_brown', c14: 'c_limit', c16: 'c_link', c25: 'c_secret' };
const GUIDED = ['c01', 'c02', 'c05'];
const firstOf = (key: string) => +Object.keys(INTRO).find((k) => INTRO[k] === key)!.slice(1);

if (LEVELS.length !== 30) errors.push('expected 30 stages, got ' + LEVELS.length);
const seenIds = new Set<string>(), seenPics = new Set<string>();

/** Seeded RNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blind play: a player who ignores the faint colours. Each move they pick an unfinished part and pour
 * a random colour it doesn't have yet; if the part can't be right any more they wash it (water).
 * Returns the average number of moves (pours + washes) to finish; compare with the solution length.
 */
function blindMoves(def: CLevel, runs = 300): number {
  const pic = analyse(def);
  const r0 = rng(def.id.length * 7919 + def.id.charCodeAt(2) * 31 + def.id.charCodeAt(1));
  let total = 0;
  for (let k = 0; k < runs; k++) {
    // Unlimited drops for the blind player (limits only block, washing refunds anyway).
    const b = new Board(pic, null);
    let moves = 0;
    while (!b.done() && moves < 5000) {
      const open = pic.colourRegions.filter((r) => !b.regionDone(r));
      const r = open[Math.floor(r0() * open.length)];
      const R = pic.regions[r];
      const at = R.labels[0];
      if (b.state[r] & ~R.goal) { b.apply(at, 0); moves++; continue; }
      const opts = [1, 2, 4].filter((c) => !(b.state[r] & c));
      b.apply(at, opts[Math.floor(r0() * opts.length)]);
      moves++;
    }
    total += moves;
  }
  return total / runs;
}

const rows: string[] = [];
LEVELS.forEach((def, i) => {
  const n = i + 1, id = def.id;
  if (id !== 'c' + String(n).padStart(2, '0')) err(id, 'id out of order');
  if (seenIds.has(id)) err(id, 'duplicate id');
  seenIds.add(id);
  const h = def.map.length, w = def.map[0].length;
  if (w > 8 || h > 10) err(id, `too big ${w}x${h}`);
  if (!def.regions || def.regions.length !== h || def.regions.some((r) => r.length !== w)) err(id, 'regions shape');
  try { parseLevel(def); } catch (e) { err(id, 'parseLevel: ' + (e as Error).message); }
  const pic = analyse(def);
  const sig = def.regions!.join('/') + JSON.stringify(def.paint);
  if (seenPics.has(sig)) err(id, 'same picture as an earlier stage');
  seenPics.add(sig);
  // Legend ⇄ goal rows.
  let hasK = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = def.regions![y][x];
    if (ch === '.') { if (def.goal[y][x] !== '.') err(id, 'goal on paper at ' + x + ',' + y); continue; }
    const p = def.paint[ch];
    if (p === 'K') hasK = true;
    const want = p === 'w' || (def.secret || '').includes(ch) ? '.' : p;
    if (def.goal[y][x] !== want) err(id, `goal mismatch at ${x},${y}`);
  }
  if (!!def.mud !== hasK) err(id, 'mud flag');
  for (const k of Object.keys(def.paint)) if (!pic.regions.some((r) => r.key === k)) err(id, 'unused legend letter ' + k);
  // Teaching order.
  const goals = pic.colourRegions.map((r) => pic.regions[r].goal);
  const mixes = goals.filter((g) => popcount(g) === 2).length, browns = goals.filter((g) => g === 7).length;
  const whites = pic.regions.filter((r) => r.white).length;
  const linked = pic.regions.filter((r) => r.comps.length > 1 && !r.white);
  const limits = limitsOf(def);
  const secret = pic.regions.filter((r) => r.secret);
  if (mixes && n < firstOf('c_mix')) err(id, 'mix before it is taught');
  if (browns && n < firstOf('c_brown')) err(id, 'brown before it is taught');
  if (whites && n < firstOf('c_white')) err(id, 'white part before it is taught');
  if (limits && n < firstOf('c_limit')) err(id, 'limits before they are taught');
  if (linked.length && n < firstOf('c_link')) err(id, 'linked parts before they are taught');
  if (secret.length && n < firstOf('c_secret')) err(id, 'secret before it is taught');
  if (secret.length && !limits) err(id, 'secret part needs counted drops (its colour is the leftover)');
  const links = ((def as CLevel & { links?: string }).links || '');
  for (const r of pic.regions) if (r.comps.length > 1 && !r.white && !links.includes(r.key)) err(id, `region ${r.key} is split in ${r.comps.length} parts (not declared as linked)`);
  for (const k of links) { const r = pic.regions.find((q) => q.key === k); if (!r || r.comps.length < 2) err(id, `declared link ${k} is not split`); }
  // Intro / guided schedule.
  if ((def.intro || '') !== (INTRO[id] || '')) err(id, `intro ${def.intro} (expected ${INTRO[id] || 'none'})`);
  if (!!def.guided !== GUIDED.includes(id)) err(id, 'guided flag');
  for (const lang of ['ko', 'en'] as const) {
    if (def.intro && (!STR[lang]['mech.' + def.intro + '.title'] || !STR[lang]['mech.' + def.intro + '.body'])) err(id, lang + ' rule card text missing');
    if (def.coach && !STR[lang][def.coach]) err(id, lang + ' coach text missing');
  }
  // Labels inside their parts.
  for (const r of pic.regions) r.labels.forEach((l, k) => { if (!r.comps[k].includes(l)) err(id, 'label outside part ' + r.key); });
  // Stored solution through the game rules.
  const res = playSolution(def);
  if (!res.ok) err(id, 'solution fails: ' + res.errors.join('; '));
  if (def.solution.some((d) => d.t !== 0 || !d.c)) err(id, 'solution drops need t=0 and a colour');
  if (limits) {
    const used: Record<number, number> = { 1: 0, 2: 0, 4: 0 };
    for (const d of def.solution) used[d.c!]++;
    for (const c of [1, 2, 4]) if (used[c] > limits[c]) err(id, 'limits too small for colour ' + c);
    const spare = [1, 2, 4].reduce((s, c) => s + limits[c] - used[c], 0);
    if (spare && secret.length) err(id, 'spare drops on a secret stage make the leftover ambiguous');
  }
  // Secret parts: once every other part is right, the leftover drops are exactly the secret colour.
  for (const R of secret) {
    const need = bitsOf(R.goal).length;
    if (!limits) continue;
    const others = def.solution.filter((d) => pic.regionOf[d.y * w + d.x] !== pic.regions.indexOf(R));
    const left = { ...limits };
    for (const d of others) left[d.c!]--;
    const bits = [1, 2, 4].filter((c) => left[c] > 0);
    if (bits.reduce((a, b) => a | b, 0) !== R.goal || bits.length !== need) err(id, 'secret leftover does not spell its colour');
  }
  const pours = def.solution.length;
  const blind = blindMoves(def);
  const ideas = [def.intro ? 'NEW ' + def.intro : '', def.guided ? 'guided' : '', mixes ? mixes + ' mix' : '', browns ? browns + ' brown' : '', whites ? whites + ' white' : '', linked.length ? linked.map((r) => r.key + '×' + r.comps.length).join(',') + ' linked' : '', limits ? 'drops R' + limits[1] + ' Y' + limits[2] + ' B' + limits[4] : '', secret.length ? 'secret' : ''].filter(Boolean).join(', ');
  rows.push(`${String(n).padStart(2)} ${id} ${String(def.pic).padEnd(12)} ${w}x${h} parts ${String(pic.colourRegions.length).padStart(2)} pours ${String(pours).padStart(2)} blind ${blind.toFixed(1).padStart(5)} (x${(blind / pours).toFixed(1)})  ${def.tag || ''}  ${ideas}`);
});

console.log(rows.join('\n'));
const keys = new Set<string>();
for (const lang of ['ko', 'en'] as const) for (const k of Object.keys(STR[lang])) keys.add(k);
for (const k of keys) if (!STR.ko[k] || !STR.en[k]) errors.push('string missing in one language: ' + k);
for (const lang of ['ko', 'en'] as const) for (const [k, v] of Object.entries(STR[lang])) {
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v)) errors.push('emoji in ' + lang + ' ' + k);
}
if (errors.length) {
  console.log('\nFAIL (' + errors.length + ')\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nOK: 30 stages verified (rules, solutions, limits, teaching order, strings)');
