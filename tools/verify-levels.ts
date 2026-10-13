/*
 * Verifies every campaign and daily level.  npm run levels:verify
 *   node --experimental-strip-types tools/verify-levels.ts [--report] [--workers N]
 * Exits non-zero on any failure. --report rewrites tools/level-report.md from the fresh measurements.
 */
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { LevelDef, MechanicKey } from '../src/core/sim.ts';
import { LEVELS_PER_CHAPTER } from '../src/config/balance.ts';
import { CHAPTER_DEFS } from '../src/levels/chapters.ts';
import { CAMPAIGN } from '../src/levels/data/campaign.ts';
import { DAILY_POOL } from '../src/levels/data/daily.ts';
import {
  basicErrors, usesOf, canonKey, analyzeSolution, makeBoard, dropsToPlan, measure, buildReport, crossCheck,
  MECHANICS, BASIC_MECHANICS, type Metrics, type ReportRow,
} from './level-lib.ts';

/** Same measurement as gen-levels.ts (bots seeded by the level content). */
function measureFinal(def: LevelDef): Metrics {
  return measure(def);
}

if (!isMainThread) {
  parentPort!.on('message', (msg: { idx?: number; def?: LevelDef; stop?: boolean }) => {
    if (msg.stop) process.exit(0);
    parentPort!.postMessage({ idx: msg.idx, metrics: measureFinal(msg.def!) });
  });
}

const RANDOM_CAP: Record<string, number> = { light: 0.06, think: 0.02, boss: 0.01, discovery: 0.03, normal: 0.03 };

async function measureAll(defs: LevelDef[], nW: number): Promise<Metrics[]> {
  const out: Metrics[] = new Array(defs.length);
  let next = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    const n = Math.min(nW, defs.length);
    for (let w = 0; w < n; w++) {
      const wk = new Worker(new URL(import.meta.url));
      wk.on('error', reject);
      wk.on('message', (m: { idx: number; metrics: Metrics }) => {
        out[m.idx] = m.metrics;
        done++;
        if (next < defs.length) wk.postMessage({ idx: next, def: defs[next++] });
        else wk.postMessage({ stop: true });
        if (done === defs.length) resolve();
      });
      wk.postMessage({ idx: next, def: defs[next++] });
    }
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const wi = args.indexOf('--workers');
  const nW = wi >= 0 ? +args[wi + 1] : Math.max(1, Math.min(8, cpus().length));
  const t0 = Date.now();
  const errors: string[] = [];
  const warns: string[] = [];
  const err = (id: string, msg: string) => errors.push(id + ': ' + msg);

  // ---------------------------------------------------------------- structure
  if (CAMPAIGN.length !== CHAPTER_DEFS.length) err('campaign', CAMPAIGN.length + ' chapters, expected ' + CHAPTER_DEFS.length);
  CAMPAIGN.forEach((ch, c) => {
    if (ch.length !== LEVELS_PER_CHAPTER) err('chapter ' + (c + 1), ch.length + ' levels, expected ' + LEVELS_PER_CHAPTER);
    ch.forEach((l, s) => {
      const want = 'c' + (c + 1) + '-' + String(s + 1).padStart(2, '0');
      if (l.id !== want) err(l.id, 'id should be ' + want);
    });
  });
  const campaign = CAMPAIGN.flat();
  const all: LevelDef[] = [...campaign, ...DAILY_POOL];
  const ids = new Set<string>();
  for (const l of all) {
    if (ids.has(l.id)) err(l.id, 'duplicate id');
    ids.add(l.id);
  }
  const canon = new Map<string, string>();
  for (const l of all) {
    const k = canonKey(l);
    if (canon.has(k)) err(l.id, 'identical to ' + canon.get(k) + ' (after mirror / colour permutation)');
    else canon.set(k, l.id);
  }
  for (const l of all) for (const e of basicErrors(l)) err(l.id, e);

  // ---------------------------------------------------------------- mechanic schedule
  const known = new Set<MechanicKey>();
  const introAt = new Map<MechanicKey, string>();
  const usesById = new Map<string, MechanicKey[]>();
  for (const l of campaign) {
    if (l.intro) {
      if (introAt.has(l.intro)) err(l.id, 'second intro for ' + l.intro + ' (first: ' + introAt.get(l.intro) + ')');
      introAt.set(l.intro, l.id);
      known.add(l.intro);
    }
    const B = makeBoard(l);
    const info = analyzeSolution(B, dropsToPlan(B, l.solution));
    const uses = usesOf(l, info);
    usesById.set(l.id, uses);
    for (const u of uses) if (!known.has(u)) err(l.id, 'uses "' + u + '" before its intro');
    if (l.intro && !uses.includes(l.intro)) err(l.id, 'intro level does not use ' + l.intro);
    if (!known.has('mix') && info.collisions) err(l.id, 'different inks touch before mix is introduced');
    if (!known.has('timing') && l.solution.some((d) => d.t > 0)) err(l.id, 'timed drop before timing is introduced');
    if (info.mud) warns.push(l.id + ': solution makes mud');
  }
  for (const m of MECHANICS) if (!introAt.has(m)) err('schedule', 'no intro level for ' + m);
  for (const m of ['drop', 'order', 'mix', 'timing'] as MechanicKey[]) {
    const id = introAt.get(m);
    const l = campaign.find((x) => x.id === id);
    if (l && !l.guided) err(id!, 'intro for ' + m + ' should be guided');
  }
  // chapter teaches
  CHAPTER_DEFS.forEach((cd, c) => {
    for (const m of cd.teaches) {
      const id = introAt.get(m);
      if (id && !id.startsWith('c' + (c + 1) + '-')) err(id, m + ' should be introduced in chapter ' + (c + 1));
    }
  });
  const three = campaign.find((l) => l.intro === 'three');
  if (three) {
    const sec = new Set(three.goal.join('').replace(/[^OPG]/g, '').split(''));
    if (sec.size < 3) err(three.id, 'three intro should target O, P and G');
  }
  const mixIntro = campaign.find((l) => l.intro === 'mix');
  if (mixIntro && mixIntro.goal.join('').replace(/[^OPG]/g, '').length < 3) err(mixIntro.id, 'first mix level should show several mixed cells');

  // ---------------------------------------------------------------- daily uses
  const tierCount: Record<string, number> = { light: 0, medium: 0, hard: 0 };
  const tierBasic: Record<string, number> = { light: 0, medium: 0, hard: 0 };
  for (const d of DAILY_POOL) {
    tierCount[d.tier] = (tierCount[d.tier] || 0) + 1;
    if (!/^d-(light|medium|hard)-\d{3}$/.test(d.id) || !d.id.startsWith('d-' + d.tier + '-')) err(d.id, 'bad daily id');
    const u = usesOf(d);
    const a = [...u].sort().join(','), b = [...d.uses].sort().join(',');
    if (a !== b) err(d.id, 'uses [' + b + '] but relies on [' + a + ']');
    if (u.every((m) => BASIC_MECHANICS.includes(m))) tierBasic[d.tier]++;
  }
  for (const t of ['light', 'medium', 'hard']) {
    if ((tierCount[t] || 0) < 120) err('daily', t + ' tier has ' + (tierCount[t] || 0) + ' puzzles (< 120)');
    if (tierBasic[t] < 30) err('daily', t + ' tier has only ' + tierBasic[t] + ' puzzles using basic mechanics only');
  }

  // ---------------------------------------------------------------- bots + exhaustive
  console.log('measuring ' + all.length + ' levels with ' + nW + ' workers...');
  const metrics = await measureAll(all, nW);
  const M = new Map<string, Metrics>();
  all.forEach((l, i) => M.set(l.id, metrics[i]));
  for (const l of all) {
    const m = M.get(l.id)!;
    if (l.diff === undefined || l.diff !== m.diff) err(l.id, 'diff ' + l.diff + ' but measured ' + m.diff);
  }

  // campaign quality bars
  const timingIdx = campaign.findIndex((l) => l.intro === 'timing');
  let prevHigh = false;
  campaign.forEach((l, i) => {
    const m = M.get(l.id)!;
    const ch = +l.id.slice(1, l.id.indexOf('-'));
    const slot = +l.id.slice(l.id.indexOf('-') + 1);
    if (l.intro || i < 4) {
      prevHigh = false;
      return;
    }
    const tag = l.tag || 'normal';
    const cap = RANDOM_CAP[tag];
    if (m.random >= cap) err(l.id, 'random-bot success ' + (m.random * 100).toFixed(2) + '% >= ' + cap * 100 + '% (' + tag + ')');
    const high = m.random >= 0.03;
    if (high && prevHigh) err(l.id, 'two consecutive levels with random-bot success >= 3%');
    prevHigh = high;
    if (ch >= 2 && tag !== 'light' && m.greedy >= 0.25) err(l.id, 'greedy-bot success ' + (m.greedy * 100).toFixed(1) + '% >= 25%');
    if (slot === 30 && l.tag !== 'boss') err(l.id, 'level 30 should be a boss');
    if (i < timingIdx && m.needsTiming === true) err(l.id, 'needs waiting before timing is introduced');
  });
  // per chapter stats
  const chapterAvg: number[] = [];
  const lines: string[] = [];
  let postTiming = 0, postNeed = 0, postTwo = 0;
  CAMPAIGN.forEach((list, c) => {
    const ms = list.map((l) => M.get(l.id)!);
    const avg = ms.reduce((a, m) => a + m.diff, 0) / ms.length;
    chapterAvg.push(avg);
    const after = list.filter((l) => campaign.indexOf(l) > timingIdx);
    const need = after.filter((l) => M.get(l.id)!.needsTiming === true).length;
    const two = after.filter((l) => l.solution.filter((d) => d.t > 0).length >= 2).length;
    postTiming += after.length;
    postNeed += need;
    postTwo += two;
    if (after.length && need / after.length < 0.4) err('chapter ' + (c + 1), 'only ' + need + '/' + after.length + ' levels need waiting (< 40%)');
    if (after.length >= 10 && two / after.length < 0.2) err('chapter ' + (c + 1), 'only ' + two + '/' + after.length + ' levels have >= 2 timed drops (< 20%)');
    const nonIntro = list.filter((l, s) => !l.intro && !(c === 0 && s < 4));
    const rnd = nonIntro.map((l) => M.get(l.id)!.random), grd = nonIntro.map((l) => M.get(l.id)!.greedy);
    // think cadence
    let gap = 0, maxGap = 0;
    list.forEach((l, s) => {
      if (l.tag === 'think' || l.tag === 'boss') gap = 0;
      else if (s >= 4) gap++;
      maxGap = Math.max(maxGap, gap);
    });
    if (maxGap > 6) err('chapter ' + (c + 1), 'no think level for ' + maxGap + ' levels in a row');
    lines.push(
      '  ' + CHAPTER_DEFS[c].id.padEnd(9) + ' avg diff ' + avg.toFixed(1).padStart(5) +
      '  need-wait ' + (after.length ? Math.round((need * 100) / after.length) + '%' : '-').padStart(4) +
      '  2+ timed ' + (after.length ? Math.round((two * 100) / after.length) + '%' : '-').padStart(4) +
      '  random ' + (Math.min(...rnd) * 100).toFixed(2) + '–' + (Math.max(...rnd) * 100).toFixed(2) + '%' +
      '  greedy ' + (Math.min(...grd) * 100).toFixed(1) + '–' + (Math.max(...grd) * 100).toFixed(1) + '%' +
      '  inks ≤' + Math.max(...list.map((l) => l.inks.length)) +
      '  board ≤' + Math.max(...list.map((l) => l.map[0].length)) + '×' + Math.max(...list.map((l) => l.map.length)),
    );
  });
  for (let c = 1; c < chapterAvg.length; c++) if (!(chapterAvg[c] > chapterAvg[c - 1])) err('chapter ' + (c + 1), 'average difficulty ' + chapterAvg[c].toFixed(1) + ' is not above chapter ' + c + ' (' + chapterAvg[c - 1].toFixed(1) + ')');
  if (postTwo / postTiming < 0.25) err('campaign', 'only ' + Math.round((postTwo * 100) / postTiming) + '% of levels after the timing intro have >= 2 timed drops');

  // daily quality bars
  const DAILY_CAP: Record<string, number> = { light: 0.06, medium: 0.02, hard: 0.01 };
  const dl: string[] = [];
  for (const t of ['light', 'medium', 'hard']) {
    const ds = DAILY_POOL.filter((d) => d.tier === t);
    for (const d of ds) {
      const m = M.get(d.id)!;
      if (m.random >= DAILY_CAP[t]) err(d.id, 'random-bot success ' + (m.random * 100).toFixed(2) + '% >= ' + DAILY_CAP[t] * 100 + '%');
      if (t !== 'light' && m.greedy >= 0.25) err(d.id, 'greedy-bot success ' + (m.greedy * 100).toFixed(1) + '% >= 25%');
    }
    if (!ds.length) continue;
    const ms = ds.map((d) => M.get(d.id)!);
    const avg = ms.reduce((a, m) => a + m.diff, 0) / ms.length;
    const need = ms.filter((m) => m.needsTiming === true).length;
    dl.push('  ' + t.padEnd(9) + ' ' + ds.length + ' puzzles  avg diff ' + avg.toFixed(1) + '  basic-only ' + tierBasic[t] + '  need-wait ' + Math.round((need * 100) / ds.length) + '%  random ≤' + (Math.max(...ms.map((m) => m.random)) * 100).toFixed(2) + '%  greedy ≤' + (Math.max(...ms.map((m) => m.greedy)) * 100).toFixed(1) + '%');
  }

  // simulator cross-check (fast sim used by the tools vs. the game's Sim)
  const xc = crossCheck(all.slice(0, 120), 25, 11);
  if (xc) err('tools', 'fast simulator disagrees with Sim on ' + xc + ' plays');

  if (args.includes('--report')) {
    const rows: ReportRow[] = all.map((def) => ({ def, metrics: M.get(def.id)!, uses: usesById.get(def.id) || usesOf(def) }));
    writeFileSync(fileURLToPath(new URL('./level-report.md', import.meta.url)), buildReport(rows));
  }

  console.log('');
  console.log('Campaign: ' + campaign.length + ' levels in ' + CAMPAIGN.length + ' chapters');
  console.log(lines.join('\n'));
  console.log('  after the timing intro: ' + Math.round((postNeed * 100) / postTiming) + '% need waiting, ' + Math.round((postTwo * 100) / postTiming) + '% have 2+ timed drops');
  console.log('  intros: ' + MECHANICS.map((m) => m + '=' + (introAt.get(m) || '?')).join(' '));
  console.log('Daily pool: ' + DAILY_POOL.length);
  console.log(dl.join('\n'));
  for (const w of warns) console.log('warn  ' + w);
  console.log('');
  if (errors.length) {
    for (const e of errors.slice(0, 200)) console.log('FAIL  ' + e);
    if (errors.length > 200) console.log('... and ' + (errors.length - 200) + ' more');
    console.log('\n' + errors.length + ' problem(s). (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
    process.exit(1);
  }
  console.log('All ' + all.length + ' levels verified OK (' + ((Date.now() - t0) / 1000).toFixed(0) + 's).');
}

if (isMainThread) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
