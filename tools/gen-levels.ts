/*
 * Inkbloom level generator.  npm run levels:gen   (node --experimental-strip-types tools/gen-levels.ts)
 *
 * Deterministic: every job has its own seed, jobs run in worker threads, results are merged in job
 * order, so the output does not depend on scheduling. Writes:
 *   src/levels/data/campaign.ts   8 chapters x 30 levels
 *   src/levels/data/daily.ts      daily pool (light / medium / hard)
 *   tools/level-report.md         metrics table
 * Options: --workers N   --quick (fewer candidates, for testing)
 */
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { LevelDef, MechanicKey } from '../src/core/sim.ts';
import { LEVELS_PER_CHAPTER } from '../src/config/balance.ts';
import { makeCandidate, hash32, type Spec, type Candidate, type GenStats, type Timing } from './gen-core.ts';
import { mulberry32, measure, canonKey, terrainKey, usesOf, solutionString, BASIC_MECHANICS, type Metrics } from './level-lib.ts';
import { HANDMADE } from './handmade-levels.ts';
import { buildReport, type ReportRow } from './level-lib.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------------------------
// Mechanic schedule
// ---------------------------------------------------------------------------------------------

/** Campaign slot (chapter 1-based, slot 1-based) where each mechanic is introduced. */
export const INTRO_AT: Record<MechanicKey, [number, number]> = {
  drop: [1, 1], walls: [1, 3], order: [1, 5], mix: [1, 7], timing: [1, 16],
  parity: [2, 1], three: [2, 12], range: [3, 1], white: [4, 1], seed: [5, 1], gate: [6, 1], slow: [7, 1],
};

function knownAt(ch: number, slot: number): MechanicKey[] {
  return (Object.keys(INTRO_AT) as MechanicKey[]).filter((m) => {
    const [c, s] = INTRO_AT[m];
    return c < ch || (c === ch && s <= slot);
  });
}

const CHAPTER_MECH: (MechanicKey | null)[] = [null, 'parity', 'range', 'white', 'seed', 'gate', 'slow', null];

const CHAPTER_SHAPES: string[][] = [
  ['pad5', 'pad6', 'pad7', 'lily6', 'lily7', 'fish', 'cloud', 'lotus8', 'bigpad', 'moonpool', 'oval*', 'round*'],
  ['teacup', 'bowl', 'lantern', 'fan', 'house', 'pagoda', 'pagoda8', 'bigbell', 'bell', 'vase', 'oct*'],
  ['leaf', 'tree', 'pine', 'tower', 'bottle', 'bigtree', 'bigleaf', 'kite', 'rect*', 'round*'],
  ['mountain', 'peaks8', 'diamond', 'star', 'bigstar', 'house', 'arch', 'oct*'],
  ['boat', 'fish', 'bigfish', 'shell', 'bell', 'umbrella', 'cloud', 'oval*'],
  ['lantern', 'biglantern', 'crown', 'fan', 'gourd', 'vase', 'bigvase', 'bowl', 'teacup'],
  ['leaf', 'ginkgo', 'maple', 'butterfly', 'flower', 'bigleaf', 'mountain', 'round*'],
  ['flower', 'butterfly', 'heart', 'lotus8', 'maple', 'star', 'bigstar', 'shell', 'bigtree', 'pagoda8'],
];

const BOSS_SHAPES = ['bigpad', 'bigbell', 'bigtree', 'pagoda8', 'bigstar', 'biglantern', 'bigleaf', 'bigfish', 'bigvase', 'lotus8', 'shell', 'pagoda', 'house', 'oct8x9', 'oct8x10', 'oval8x9', 'oval8x10', 'oval7x9', 'oct7x9'];

type Kind = 'L' | 'N' | 'T' | 'D' | 'B';
interface Slot { kind: Kind; timing: Timing; timed?: [number, number]; newMech?: boolean; extra?: Partial<Spec> }

const T = (kind: Kind, timing: Timing, timed?: [number, number], newMech = false, extra?: Partial<Spec>): Slot => ({ kind, timing, timed, newMech, extra });

/** Per chapter: slot number -> plan (handmade slots are absent). */
function chapterPlan(ch: number): Record<number, Slot> {
  if (ch === 1) {
    const roomsBase: Partial<Spec> = { allowed: ['drop', 'walls', 'order'], require: ['order'], noCollide: true, minMixed: 0, walls: ['rooms'] };
    return {
      6: T('L', 'none', undefined, false, { ...roomsBase, rooms: [3, 4], inks: [3, 4] }),
      8: T('L', 'none', undefined, false, { require: ['mix'], walls: ['none'], inks: [2, 2], minMixed: 3 }),
      9: T('L', 'none', undefined, false, { require: ['mix'], walls: ['none', 'sym'], inks: [2, 2], minMixed: 3 }),
      10: T('N', 'none', undefined, false, { require: ['mix'], inks: [2, 2], minMixed: 2 }),
      11: T('L', 'none', undefined, false, { require: ['mix', 'walls'], inks: [2, 2], minMixed: 2 }),
      12: T('T', 'none', undefined, false, { require: ['mix'], inks: [2, 3] }),
      13: T('L', 'none', undefined, false, { require: ['mix'], inks: [2, 3] }),
      14: T('N', 'none', undefined, false, { require: ['mix'], inks: [3, 3] }),
      15: T('T', 'none', undefined, false, { require: ['mix'], inks: [3, 3] }),
      17: T('L', 'need', [1, 1], false, { require: ['mix'], inks: [2, 2] }),
      18: T('L', 'opt', [1, 1]),
      19: T('N', 'need', [1, 1]),
      20: T('T', 'need', [1, 2]),
      21: T('L', 'opt', [1, 1]),
      22: T('N', 'opt', [1, 2]),
      23: T('T', 'need', [2, 2]),
      24: T('D', 'need', [1, 2], false, { require: ['walls'], walls: ['bar', 'vbar', 'ring', 'teeth'] }),
      25: T('L', 'opt', [0, 1]),
      26: T('T', 'need', [1, 2]),
      27: T('N', 'opt', [1, 2]),
      28: T('L', 'need', [1, 1]),
      29: T('T', 'need', [2, 2]),
      30: T('B', 'need', [2, 3]),
    };
  }
  if (ch === 2) {
    const three = (k: Kind, t: Timing, tt?: [number, number]) => T(k, t, tt, false, { require: ['three'] });
    return {
      2: T('L', 'need', [1, 1], true),
      3: T('L', 'need', [1, 1], true),
      4: T('N', 'need', [1, 2], true),
      5: T('T', 'need', [1, 2], true),
      6: T('L', 'opt', [1, 1]),
      7: T('N', 'need', [1, 2], true),
      8: T('T', 'need', [2, 2]),
      9: T('L', 'opt', [1, 1]),
      10: T('D', 'need', [1, 2], true, { require: ['walls'], walls: ['bar', 'vbar', 'ring', 'teeth'] }),
      11: T('N', 'opt', [1, 2]),
      13: three('L', 'none'),
      14: three('L', 'opt', [1, 1]),
      15: three('N', 'need', [1, 1]),
      16: T('T', 'need', [1, 2]),
      17: T('L', 'opt', [1, 1]),
      18: three('N', 'need', [1, 2]),
      19: T('T', 'need', [2, 2]),
      20: T('L', 'opt', [1, 1]),
      21: T('N', 'need', [1, 2], true),
      22: three('T', 'need', [1, 2]),
      23: T('D', 'need', [1, 2], false, { require: ['three', 'walls'] }),
      24: T('L', 'opt', [1, 1]),
      25: T('N', 'need', [1, 2], true),
      26: T('T', 'need', [2, 3]),
      27: T('L', 'opt', [1, 1]),
      28: three('N', 'need', [1, 2]),
      29: T('T', 'need', [2, 2], true),
      30: T('B', 'need', [2, 3], false, { require: ['three'] }),
    };
  }
  // chapters 3..8 share a sawtooth; M = chapter mechanic required
  const M = ch <= 7;
  const plan: Record<number, Slot> = {
    2: T('L', 'none', undefined, M),
    3: T('L', 'opt', [1, 1], M),
    4: T('N', 'need', [1, 1], M),
    5: T('T', 'need', [1, 2], M),
    6: T('L', 'opt', [1, 1]),
    7: T('N', 'need', [1, 2], M),
    8: T('T', 'need', [1, 2]),
    9: T('L', 'opt', [1, 1], M),
    10: T('D', 'need', [1, 2], M),
    11: T('N', 'need', [1, 2]),
    12: T('L', 'opt', [1, 1], M),
    13: T('T', 'need', [2, 2], M),
    14: T('N', 'opt', [1, 2]),
    15: T('L', 'need', [1, 1], M),
    16: T('T', 'need', [1, 2]),
    17: T('N', 'opt', [1, 2], M),
    18: T('L', 'opt', [1, 1]),
    19: T('D', 'need', [1, 2], M),
    20: T('T', 'need', [1, 2], M),
    21: T('L', 'opt', [1, 1]),
    22: T('N', 'need', [1, 2], M),
    23: T('T', 'need', [2, 2]),
    24: T('L', 'opt', [1, 1], M),
    25: T('N', 'need', [1, 2]),
    26: T('T', 'need', [1, 3], M),
    27: T('L', 'opt', [1, 1]),
    28: T('N', 'need', [1, 2], M),
    29: T('T', 'need', [2, 2], M),
    30: T('B', 'need', [2, 3], M),
  };
  if (ch === 8) plan[1] = T('D', 'need', [1, 2]);
  // discovery twists per chapter
  const twist: Record<number, Partial<Spec>> = {
    3: { rangeP: 0.8 },
    4: { require: ['white', 'walls'], rangeP: 0 },
    5: { seeds: [2, 3] },
    6: { gates: [2, 2] },
    7: { slowCells: [5, 9], parity: 'allow' },
    8: { require: ['three'] },
  };
  if (twist[ch]) {
    plan[10] = { ...plan[10], extra: { ...(plan[10].extra || {}), ...twist[ch] } };
    plan[19] = { ...plan[19], extra: { ...(plan[19].extra || {}), ...twist[ch] } };
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Spec builder
// ---------------------------------------------------------------------------------------------

interface Dims { w: [number, number]; h: [number, number]; cells: [number, number] }

function dimsFor(ch: number, kind: Kind): Dims {
  if (kind === 'B') return ch === 1 ? { w: [7, 7], h: [7, 9], cells: [28, 52] } : { w: [7, 8], h: [8, 10], cells: [34, 66] };
  if (ch === 1) return kind === 'L' ? { w: [5, 7], h: [5, 7], cells: [14, 34] } : { w: [5, 7], h: [5, 8], cells: [16, 42] };
  if (ch === 2) return kind === 'L' ? { w: [5, 7], h: [5, 8], cells: [16, 38] } : { w: [5, 7], h: [6, 9], cells: [20, 48] };
  if (kind === 'L') return { w: [5, 7], h: [5, 9], cells: [16, 44] };
  return { w: [5, 8], h: [6, 10], cells: [22, 58] };
}

function inksFor(ch: number, kind: Kind): [number, number] {
  const t: Record<Kind, [number, number]>[] = [
    { L: [2, 2], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 3] },
    { L: [2, 3], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [1, 2], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 4], T: [3, 4], D: [3, 4], B: [4, 5] },
  ];
  return t[ch - 1][kind];
}

const TAG_OF: Record<Kind, 'light' | 'think' | 'discovery' | 'boss' | undefined> = { L: 'light', N: undefined, T: 'think', D: 'discovery', B: 'boss' };
export const RANDOM_CAP: Record<string, number> = { light: 0.06, think: 0.02, boss: 0.01, discovery: 0.03, normal: 0.03 };

function baseSpec(key: string, known: MechanicKey[], kind: Kind, dims: Dims, inks: [number, number], timing: Timing, timed: [number, number], ch: number): Spec {
  const tag = TAG_OF[kind] || 'normal';
  const light = kind === 'L';
  return {
    key,
    allowed: known.slice(),
    require: ['order'],
    timing: known.includes('timing') ? timing : 'none',
    timed: known.includes('timing') ? timed : [0, 0],
    parity: known.includes('parity') ? 'allow' : 'forbid',
    inks,
    w: dims.w,
    h: dims.h,
    cells: dims.cells,
    walls: known.includes('walls') ? ['none', 'none', 'sym', 'sym', 'pillars', 'bar', 'vbar', 'ring', 'teeth'] : ['none'],
    tag: kind === 'B' ? 'boss' : light ? 'light' : kind === 'T' ? 'think' : 'normal',
    minTargets: kind === 'B' ? 7 : light ? 6 : 5,
    maxTargets: kind === 'B' ? 16 : light ? 10 : kind === 'T' ? 12 : 11,
    pin: kind === 'B' ? 0.9 : light ? 0.35 : kind === 'T' ? 0.85 : 0.6,
    coverTol: light ? 0.01 : 0,
    minCoverage: 0.9,
    minMixed: known.includes('mix') ? 1 : 0,
    maxSettle: kind === 'B' ? LIMITS_SETTLE : light ? 16 : 20,
    maxRandom: RANDOM_CAP[tag === 'discovery' ? 'discovery' : tag],
    maxGreedy: ch >= 2 && !light ? 0.25 : ch === 1 && kind === 'T' ? 0.35 : 1,
    shapes: kind === 'B' ? BOSS_SHAPES : CHAPTER_SHAPES[ch - 1],
    shapeP: kind === 'B' ? 0.85 : 0.6,
  };
}
const LIMITS_SETTLE = 22;

/** Adds optional / required mechanic features to a spec. */
function withMechanics(spec: Spec, require: MechanicKey[], rng: () => number, optP: number): Spec {
  const s: Spec = { ...spec, require: Array.from(new Set([...spec.require, ...require])) };
  const has = (m: MechanicKey) => s.allowed.includes(m);
  const want = (m: MechanicKey) => s.require.includes(m) || (has(m) && rng() < optP);
  if (!has('mix')) s.minMixed = 0;
  if (has('range') && want('range')) {
    s.rangeP = s.rangeP ?? 0.45;
    if (!s.require.includes('range') && rng() < 0.5) s.rangeP = 0.25;
  } else s.rangeP = 0;
  if (has('white') && want('white')) {
    if (!s.require.includes('white')) s.require.push('white');
    s.minCoverage = 0.5;
  } else s.allowed = s.allowed.filter((m) => m !== 'white');
  if (has('seed') && want('seed')) {
    s.seeds = s.seeds || [1, 2];
    if (!s.require.includes('seed')) s.require.push('seed');
  }
  if (has('gate') && want('gate')) {
    s.gates = s.gates || [1, 2];
    if (!s.require.includes('gate')) s.require.push('gate');
  }
  if (has('slow') && want('slow')) {
    s.slowCells = s.slowCells || [2, 7];
    if (!s.require.includes('slow')) s.require.push('slow');
  }
  if (!has('range')) s.rangeP = 0;
  if (s.require.includes('range')) s.rangeP = Math.max(s.rangeP || 0, 0.45);
  if (s.require.includes('white') && s.rangeP === 0 && !s.walls.includes('rooms')) s.walls = ['sym', 'pillars', 'bar', 'ring', 'teeth'];
  if (!has('three')) s.palette = undefined;
  if (s.require.includes('parity')) s.parity = 'need';
  return s;
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

interface Job { idx: number; key: string; spec: Spec; seed: number; want: number; maxAttempts: number }
interface JobResult { idx: number; cands: Candidate[]; stats: GenStats; ms: number }

interface SlotJob { id: string; ch: number; slot: number; kind: Kind; slot0: Slot; jobs: number[]; target: number; spec: Spec }
interface DailyJob { tier: 'light' | 'medium' | 'hard'; jobs: number[] }

function diffTarget(ch: number, slot: number, kind: Kind): number {
  const base = [22, 32, 40, 46, 52, 58, 63, 68][ch - 1];
  const ramp = (8 * (slot - 1)) / 29;
  const off: Record<Kind, number> = { L: -9, N: 0, T: 8, D: 3, B: 14 };
  return base + ramp + off[kind];
}

export function buildJobs(quick: boolean): { jobs: Job[]; slots: SlotJob[]; dailies: DailyJob[] } {
  const jobs: Job[] = [];
  const slots: SlotJob[] = [];
  const add = (key: string, spec: Spec, want: number, maxAttempts: number): number => {
    const idx = jobs.length;
    jobs.push({ idx, key, spec, seed: hash32('inkbloom-v1|' + key), want, maxAttempts });
    return idx;
  };
  for (let ch = 1; ch <= 8; ch++) {
    const plan = chapterPlan(ch);
    for (let s = 1; s <= LEVELS_PER_CHAPTER; s++) {
      const id = 'c' + ch + '-' + String(s).padStart(2, '0');
      if (HANDMADE[id]) continue;
      const sl = plan[s];
      if (!sl) throw new Error('no plan for ' + id);
      const known = knownAt(ch, s);
      const dims = dimsFor(ch, sl.kind);
      const inks = (sl.extra && sl.extra.inks) || inksFor(ch, sl.kind);
      const timed = sl.timed || [0, 0];
      const rng = mulberry32(hash32('spec|' + id));
      let spec = baseSpec(id, known, sl.kind, dims, inks, sl.timing, timed, ch);
      if (sl.extra) spec = { ...spec, ...sl.extra, require: spec.require };
      const req: MechanicKey[] = [...((sl.extra && sl.extra.require) || [])];
      const cm = CHAPTER_MECH[ch - 1];
      if (sl.newMech && cm) req.push(cm);
      if (ch >= 2 && !req.includes('mix') && known.includes('mix') && rng() < 0.85) req.push('mix');
      spec = withMechanics(spec, req, rng, ch === 8 ? 0.45 : 0.25);
      if (sl.extra && sl.extra.allowed) spec.allowed = sl.extra.allowed.slice();
      if (sl.extra && sl.extra.require) spec.require = Array.from(new Set([...spec.require.filter((m) => spec.allowed.includes(m)), ...sl.extra.require]));
      const want = quick ? 2 : sl.kind === 'B' ? 6 : 5;
      const maxA = quick ? 60 : sl.kind === 'B' ? 700 : 450;
      const j1 = add(id + '#a', spec, want, maxA);
      slots.push({ id, ch, slot: s, kind: sl.kind, slot0: sl, jobs: [j1], target: diffTarget(ch, s, sl.kind), spec });
    }
  }
  // ---- daily pool
  const dailies: DailyJob[] = [];
  const tiers: ('light' | 'medium' | 'hard')[] = ['light', 'medium', 'hard'];
  for (const tier of tiers) {
    const dj: DailyJob = { tier, jobs: [] };
    const groups = quick ? 6 : 40;
    for (let g = 0; g < groups; g++) {
      const key = 'daily-' + tier + '-' + g;
      const rng = mulberry32(hash32('spec|' + key));
      const basicOnly = tier === 'light' ? g % 10 < 7 : tier === 'medium' ? g % 10 < 4 : g % 10 < 4;
      const ch = tier === 'light' ? (g % 3 === 0 ? 1 : 2) : tier === 'medium' ? 3 + (g % 3) : 6 + (g % 3);
      let known: MechanicKey[];
      if (basicOnly) known = BASIC_MECHANICS.slice();
      else if (tier === 'light') known = [...BASIC_MECHANICS, 'three'];
      else known = knownAt(ch, 30);
      const kinds: Kind[] = tier === 'light' ? ['L', 'L', 'N'] : tier === 'medium' ? ['N', 'T', 'N'] : ['T', 'T', 'N'];
      const kind = kinds[g % 3];
      const timingOpts: Timing[] = tier === 'light' ? ['none', 'opt', 'need', 'need'] : ['opt', 'need', 'need', 'need'];
      const timing = timingOpts[g % 4];
      const timed: [number, number] = tier === 'hard' ? [1, 3] : tier === 'medium' ? [1, 2] : [1, 1];
      const dims = tier === 'hard' && g % 5 === 0 ? dimsFor(ch, 'B') : dimsFor(ch, kind === 'L' ? 'L' : 'N');
      const inks: [number, number] = tier === 'light' ? [2, 3] : tier === 'medium' ? [2, 3] : [2, 4];
      let spec = baseSpec(key, known, kind, dims, inks, timing, timed, ch);
      spec.shapes = CHAPTER_SHAPES[(g * 7 + tiers.indexOf(tier)) % 8];
      spec.maxRandom = tier === 'light' ? 0.06 : tier === 'medium' ? 0.02 : 0.01;
      spec.maxGreedy = tier === 'light' ? 1 : 0.25;
      const req: MechanicKey[] = [];
      if (!basicOnly) {
        const cm = tier === 'light' ? 'three' : CHAPTER_MECH[ch - 1];
        if (cm) req.push(cm);
      }
      if (known.includes('mix') && rng() < 0.85) req.push('mix');
      spec = withMechanics(spec, req, rng, tier === 'hard' ? 0.35 : 0.2);
      const want = quick ? 2 : 6;
      dj.jobs.push(add(key, spec, want, quick ? 40 : 320));
    }
    dailies.push(dj);
  }
  return { jobs, slots, dailies };
}

// ---------------------------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------------------------

export function runJob(job: Job): JobResult {
  const t0 = Date.now();
  const rng = mulberry32(job.seed);
  const st: GenStats = { attempts: 0, terrain: 0, plan: 0, filter: 0, cover: 0, measure: 0, ok: 0 };
  const cands: Candidate[] = [];
  for (let a = 0; a < job.maxAttempts && cands.length < job.want; a++) {
    const c = makeCandidate(rng, job.spec, job.key + '~' + a, st);
    if (c) cands.push(c);
  }
  return { idx: job.idx, cands, stats: st, ms: Date.now() - t0 };
}

interface MeasureTask { idx: number; def: LevelDef }
interface MeasureResult { idx: number; metrics: Metrics }

if (!isMainThread) {
  const wd = workerData as { mode: string };
  parentPort!.on('message', (msg: { job?: Job; measure?: MeasureTask; stop?: boolean }) => {
    if (msg.stop) process.exit(0);
    if (msg.job) parentPort!.postMessage({ result: runJob(msg.job) });
    if (msg.measure) parentPort!.postMessage({ measured: { idx: msg.measure.idx, metrics: measureFinal(msg.measure.def) } as MeasureResult });
  });
  void wd;
}

/** Final measurement (content-seeded, identical to what verify-levels.ts computes). */
export function measureFinal(def: LevelDef): Metrics {
  return measure(def);
}

// ---------------------------------------------------------------------------------------------
// Main side
// ---------------------------------------------------------------------------------------------

async function runPool<T, R>(tasks: T[], nWorkers: number, wrap: (t: T) => object, unwrap: (m: any) => R | undefined, onDone?: (n: number) => void): Promise<R[]> {
  const results: R[] = [];
  let next = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    if (!tasks.length) return resolve();
    const workers: Worker[] = [];
    const n = Math.min(nWorkers, tasks.length);
    for (let w = 0; w < n; w++) {
      const wk = new Worker(new URL(import.meta.url), { workerData: { mode: 'gen' } });
      workers.push(wk);
      wk.on('error', reject);
      wk.on('message', (m: any) => {
        const r = unwrap(m);
        if (r !== undefined) {
          results.push(r);
          done++;
          if (onDone) onDone(done);
        }
        if (next < tasks.length) wk.postMessage(wrap(tasks[next++]));
        else wk.postMessage({ stop: true });
        if (done === tasks.length) resolve();
      });
      wk.postMessage(wrap(tasks[next++]));
    }
  });
  return results;
}

function fmtLevel(def: LevelDef, extra: Record<string, unknown> = {}): string {
  const o: Record<string, unknown> = {
    id: def.id, map: def.map, goal: def.goal, inks: def.inks, solution: def.solution,
  };
  if (def.tempo) o.tempo = def.tempo;
  if (def.intro) o.intro = def.intro;
  if (def.guided) o.guided = true;
  if (def.tag) o.tag = def.tag;
  if (def.diff !== undefined) o.diff = def.diff;
  Object.assign(o, extra);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'solution') parts.push(k + ': [' + (v as { x: number; y: number; t: number }[]).map((d) => '{ x: ' + d.x + ', y: ' + d.y + ', t: ' + d.t + ' }').join(', ') + ']');
    else parts.push(k + ': ' + JSON.stringify(v).replace(/","/g, "', '").replace(/\["/g, "['").replace(/"\]/g, "']").replace(/^"(.*)"$/, "'$1'"));
  }
  return '{ ' + parts.join(', ') + ' }';
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const wi = args.indexOf('--workers');
  const nW = wi >= 0 ? +args[wi + 1] : Math.max(1, Math.min(8, cpus().length));
  const t0 = Date.now();
  const { jobs, slots, dailies } = buildJobs(quick);
  // optional dev cache (--cache file): keyed by job spec + a hash of the generator/simulator sources
  const ci = args.indexOf('--cache');
  const cacheFile = ci >= 0 ? args[ci + 1] : '';
  const codeHash = hash32(['tools/gen-core.ts', 'tools/level-lib.ts', 'src/core/sim.ts'].map((f) => readFileSync(ROOT + f, 'utf8')).join('\n'));
  const sig = (j: Job) => String(hash32(JSON.stringify(j.spec) + '|' + j.seed + '|' + j.want + '|' + j.maxAttempts + '|' + codeHash));
  const cache: Record<string, { sig: string; result: JobResult }> = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const cached: JobResult[] = [];
  const todoJobs = jobs.filter((j) => {
    const c = cache[j.key];
    if (c && c.sig === sig(j)) {
      cached.push({ ...c.result, idx: j.idx });
      return false;
    }
    return true;
  });
  console.log('jobs: ' + jobs.length + (cached.length ? ' (' + cached.length + ' cached)' : '') + '  workers: ' + nW + (quick ? '  (quick)' : ''));
  let lastPct = -1;
  const res = await runPool<Job, JobResult>(todoJobs, nW, (j) => ({ job: j }), (m) => m.result, (d) => {
    const pct = Math.floor((d * 20) / jobs.length) * 5;
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(pct + '% ');
    }
  });
  console.log('\ngenerated in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (cacheFile) {
    for (const r of res) cache[jobs[r.idx].key] = { sig: sig(jobs[r.idx]), result: r };
  }
  res.push(...cached);
  const byIdx = new Map<number, JobResult>();
  for (const r of res) byIdx.set(r.idx, r);
  // phase 2: relaxed specs for slots that found nothing usable
  const extra: Job[] = [];
  for (const sj of slots) {
    const pool = byIdx.get(sj.jobs[0])!.cands;
    if (pool.filter((c) => okFor(c, sj, 0)).length >= 2) continue;
    const sp = sj.spec;
    const relaxed: Spec = { ...sp, key: sp.key + '-relaxed', pin: Math.max(0.3, sp.pin - 0.3), maxTargets: Math.min(18, sp.maxTargets + 3), w: [Math.max(4, sp.w[0] - 1), sp.w[1]], cells: [Math.max(12, sp.cells[0] - 4), sp.cells[1] + 4], inks: [sp.inks[0], Math.min(5, sp.inks[1] + (sp.inks[1] < 3 ? 1 : 0))] };
    const idx = jobs.length + extra.length;
    extra.push({ idx, key: sj.id + '#b', spec: relaxed, seed: hash32('inkbloom-v1|' + sj.id + '#b'), want: quick ? 2 : 4, maxAttempts: quick ? 60 : 900 });
    sj.jobs.push(idx);
  }
  if (extra.length) {
    console.log('phase 2: ' + extra.length + ' relaxed jobs (' + slots.filter((s) => s.jobs.length > 1).map((s) => s.id).join(' ') + ')');
    const run2: Job[] = [];
    for (const j of extra) {
      const c = cache[j.key];
      if (c && c.sig === sig(j)) byIdx.set(j.idx, { ...c.result, idx: j.idx });
      else run2.push(j);
    }
    const res2 = await runPool<Job, JobResult>(run2, nW, (j) => ({ job: j }), (m) => m.result);
    const exByIdx = new Map(extra.map((j) => [j.idx, j]));
    for (const r of res2) {
      byIdx.set(r.idx, r);
      if (cacheFile) cache[exByIdx.get(r.idx)!.key] = { sig: sig(exByIdx.get(r.idx)!), result: r };
    }
    res.push(...res2);
  }
  if (cacheFile) writeFileSync(cacheFile, JSON.stringify(cache));
  const tot: GenStats = { attempts: 0, terrain: 0, plan: 0, filter: 0, cover: 0, measure: 0, ok: 0 };
  for (const r of res) for (const k of Object.keys(tot) as (keyof GenStats)[]) tot[k] += r.stats[k];
  console.log('attempts ' + JSON.stringify(tot));

  // ---------------- selection (per chapter; raise a chapter's targets until its average beats the previous one)
  const metricsOf = new Map<string, Metrics>();
  let usedCanon = new Set<string>();
  let terrainUse = new Map<string, number>();
  const campaign: LevelDef[][] = [];
  for (const hm of Object.values(HANDMADE)) usedCanon.add(canonKey(hm));
  const problems: string[] = [];
  const pickChapter = (ch: number, offset: number) => {
    const used = new Set(usedCanon);
    const tUse = new Map(terrainUse);
    const list: LevelDef[] = [];
    const mets = new Map<string, Metrics>();
    const probs: string[] = [];
    let prevRandom = 0;
    let sum = 0;
    for (let s = 1; s <= LEVELS_PER_CHAPTER; s++) {
      const id = 'c' + ch + '-' + String(s).padStart(2, '0');
      if (HANDMADE[id]) {
        list.push({ ...HANDMADE[id] });
        prevRandom = 0;
        sum += handDiff.get(id)!;
        continue;
      }
      const sj = slots.find((x) => x.id === id)!;
      const pool: Candidate[] = [];
      for (const j of sj.jobs) pool.push(...byIdx.get(j)!.cands);
      const usable = pool.filter((c) => okFor(c, sj, prevRandom) && !used.has(canonKey(c.def)));
      if (!usable.length) {
        probs.push(id + ': no usable candidate (' + pool.length + ' generated)');
        continue;
      }
      const target = sj.target + offset;
      usable.sort((a, b) => score(a, sj, tUse, target) - score(b, sj, tUse, target));
      const c = usable[0];
      const def: LevelDef = { ...c.def, id };
      const tag = TAG_OF[sj.kind];
      if (tag) def.tag = tag;
      used.add(canonKey(def));
      const tk = terrainKey(def);
      tUse.set(tk, (tUse.get(tk) || 0) + 1);
      prevRandom = c.metrics.random;
      mets.set(id, c.metrics);
      list.push(def);
      sum += c.metrics.diff;
    }
    return { list, mets, used, tUse, probs, avg: sum / LEVELS_PER_CHAPTER };
  };
  // handmade levels are measured up front (their diff counts toward the chapter average)
  const handDefs = Object.values(HANDMADE);
  const handMeas = await runPool<MeasureTask, MeasureResult>(handDefs.map((def, idx) => ({ idx, def })), nW, (t) => ({ measure: t }), (m) => m.measured);
  const handDiff = new Map<string, number>();
  for (const m of handMeas) {
    handDiff.set(handDefs[m.idx].id, m.metrics.diff);
    metricsOf.set(handDefs[m.idx].id, m.metrics);
  }
  let prevAvg = -1;
  for (let ch = 1; ch <= 8; ch++) {
    let offset = 0;
    let r = pickChapter(ch, offset);
    while (ch > 1 && r.avg <= prevAvg + 1.5 && offset < 40) {
      offset += 2;
      r = pickChapter(ch, offset);
    }
    console.log('chapter ' + ch + ': avg diff ' + r.avg.toFixed(1) + (offset ? ' (targets +' + offset + ')' : ''));
    prevAvg = r.avg;
    usedCanon = r.used;
    terrainUse = r.tUse;
    problems.push(...r.probs);
    for (const [k, v] of r.mets) metricsOf.set(k, v);
    campaign.push(r.list);
  }
  // ---------------- daily pool
  const daily: (LevelDef & { tier: string; uses: MechanicKey[] })[] = [];
  const PER_TIER = quick ? 20 : 140;
  for (const dj of dailies) {
    const all: Candidate[] = [];
    for (const j of dj.jobs) all.push(...byIdx.get(j)!.cands);
    // round-robin over groups for variety
    const perGroup = dj.jobs.map((j) => byIdx.get(j)!.cands.slice().sort((a, b) => b.metrics.diff - a.metrics.diff));
    let n = 0, round = 0;
    while (n < PER_TIER && round < 20) {
      for (const g of perGroup) {
        if (n >= PER_TIER) break;
        const c = g[round];
        if (!c) continue;
        const ck = canonKey(c.def);
        if (usedCanon.has(ck)) continue;
        const tk = terrainKey(c.def);
        if ((terrainUse.get(tk) || 0) >= 3) continue;
        usedCanon.add(ck);
        terrainUse.set(tk, (terrainUse.get(tk) || 0) + 1);
        n++;
        const id = 'd-' + dj.tier + '-' + String(n).padStart(3, '0');
        metricsOf.set(id, c.metrics);
        daily.push({ ...c.def, id, tag: dj.tier === 'light' ? 'light' : 'think', tier: dj.tier, uses: c.uses });
      }
      round++;
    }
    if (n < PER_TIER) problems.push('daily ' + dj.tier + ': only ' + n);
  }
  if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));

  // ---------------- measure the handmade levels (generated ones carry their metrics) -> diff + report
  const flat: LevelDef[] = [...campaign.flat(), ...daily];
  const todo = flat.filter((d) => !metricsOf.has(d.id));
  const meas = await runPool<MeasureTask, MeasureResult>(todo.map((def, idx) => ({ idx, def })), nW, (t) => ({ measure: t }), (m) => m.measured);
  for (const m of meas) metricsOf.set(todo[m.idx].id, m.metrics);
  for (const def of flat) def.diff = metricsOf.get(def.id)!.diff;

  // ---------------- write files
  const campLines: string[] = [];
  campLines.push('// Generated by tools/gen-levels.ts — do not edit by hand (npm run levels:gen).');
  campLines.push("import type { LevelDef } from '../../core/sim.ts';");
  campLines.push('');
  campLines.push('export const CAMPAIGN: LevelDef[][] = [');
  for (const list of campaign) {
    campLines.push('  [');
    for (const def of list) campLines.push('    ' + fmtLevel(def) + ',');
    campLines.push('  ],');
  }
  campLines.push('];');
  writeFileSync(ROOT + 'src/levels/data/campaign.ts', campLines.join('\n') + '\n');
  const dLines: string[] = [];
  dLines.push('// Generated by tools/gen-levels.ts — do not edit by hand (npm run levels:gen).');
  dLines.push("import type { DailyDef } from '../pack.ts';");
  dLines.push('');
  dLines.push('export const DAILY_POOL: DailyDef[] = [');
  for (const def of daily) {
    const { tier, uses, ...rest } = def;
    dLines.push('  ' + fmtLevel(rest as LevelDef, { tier, uses }) + ',');
  }
  dLines.push('];');
  writeFileSync(ROOT + 'src/levels/data/daily.ts', dLines.join('\n') + '\n');
  const rows: ReportRow[] = flat.map((def) => ({ def, metrics: metricsOf.get(def.id)!, uses: usesOf(def) }));
  writeFileSync(ROOT + 'tools/level-report.md', buildReport(rows));
  console.log('wrote campaign (' + campaign.flat().length + '), daily (' + daily.length + '), report. total ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (problems.length) process.exitCode = 1;
}

function okFor(c: Candidate, sj: SlotJob, prevRandom: number): boolean {
  const tag = TAG_OF[sj.kind] || 'normal';
  const cap = RANDOM_CAP[tag];
  if (c.metrics.random >= cap) return false;
  if (prevRandom >= 0.03 && c.metrics.random >= 0.03) return false;
  if (sj.slot0.timing === 'need' && c.metrics.needsTiming !== true) return false;
  if (sj.ch >= 2 && sj.kind !== 'L' && c.metrics.greedy >= 0.25) return false;
  return true;
}

function score(c: Candidate, sj: SlotJob, terrainUse: Map<string, number>, target: number): number {
  let s = Math.abs(c.metrics.diff - target);
  // timing is the core skill: where the slot allows it, prefer two or more timed drops
  if (sj.slot0.timed && sj.slot0.timed[1] >= 2 && c.metrics.timedDrops >= 2) s -= 5;
  s += (terrainUse.get(terrainKey(c.def)) || 0) * 12;
  s -= c.info.coverage * 3;
  if (c.metrics.settleTick > 16) s += (c.metrics.settleTick - 16) * 0.8;
  return s;
}

if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { solutionString };
