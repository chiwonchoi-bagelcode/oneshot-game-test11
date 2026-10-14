/*
 * Daily puzzles: three a day (light / medium / hard), picked from DAILY_POOL so they only use
 * rules the player already knows, re-skinned (mirror + colour swap) per date, plus the streak,
 * the all-three bonus and streak milestones. The play screen starts a daily with
 * go('play', { daily: tier }) and reports the clear through recordDailyClear().
 */
import { V } from '../variants/index.ts';
import { DAILY, type Reward } from '../config/balance.ts';
import { DAILY_POOL, ALL_LEVELS, mechanicsKnown, type DailyDef } from '../levels/pack.ts';
import type { LevelDef, MechanicKey } from '../core/sim.ts';
import { transformLevel } from '../core/transform.ts';
import { mulberry32, hashString } from '../core/rng.ts';
import { store, today, addDays } from './store.ts';
import { clearedCount, clearedUpTo } from './progress.ts';
import { grant } from './economy.ts';

export type DailyTierIndex = 0 | 1 | 2;

export interface DailyPuzzle {
  tier: DailyTierIndex;
  def: LevelDef;
  reward: Reward;
  done: boolean;
}

export interface DailyClearResult {
  /** Tier reward (empty when this tier was already cleared today). Already granted. */
  reward: Reward;
  streak: number;
  /** First daily clear of the day: the streak went up (or restarted at 1). */
  streakUp: boolean;
  allDoneBonus: Reward | null;
  milestone: { days: number; reward: Reward } | null;
}

export interface Milestone {
  days: number;
  reward: Reward;
  /** Generated from DAILY.repeatEvery after the last listed milestone. */
  repeat?: boolean;
}

/** Days of history to look back at when avoiding repeats. */
const HISTORY_DAYS = 60;

export function dailyUnlocked(): boolean {
  if (!V.daily) return false;
  return clearedCount() >= DAILY.unlockAfterLevel;
}

let cache: { key: string; defs: LevelDef[] } | null = null;

function tierId(tier: number): string {
  return DAILY.tiers[tier].id;
}

function rendezvous(day: string, tier: number, id: string): number {
  return hashString(day + '|' + tier + '|' + id);
}

function unknownCount(d: DailyDef, known: Set<MechanicKey>): number {
  let n = 0;
  for (const m of d.uses || []) if (!known.has(m)) n++;
  return n;
}

/** Pool id → days since it was last offered (only ids seen in the last HISTORY_DAYS). */
function lastUsed(day: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = HISTORY_DAYS; i >= 1; i--) {
    const rec = store.data.daily.days[addDays(day, -i)];
    if (rec && rec.ids) for (const id of rec.ids) out.set(id, i);
  }
  return out;
}

/**
 * Chooses a pool puzzle for a tier: known rules only (fallback: fewest unknown), the one offered
 * longest ago (never offered first), ties broken by a stable per-day hash.
 */
function pickFromPool(day: string, tier: number, known: Set<MechanicKey>, used: Map<string, number>, taken: Set<string>): DailyDef | null {
  let cands = DAILY_POOL.filter((d) => d.tier === tierId(tier) && !taken.has(d.id));
  if (!cands.length) cands = DAILY_POOL.filter((d) => !taken.has(d.id));
  if (!cands.length) return null;
  let best = Infinity;
  for (const d of cands) best = Math.min(best, unknownCount(d, known));
  cands = cands.filter((d) => unknownCount(d, known) === best);
  let pick = cands[0], age = -1, score = Infinity;
  for (const d of cands) {
    const a = used.get(d.id) ?? Infinity;
    const sc = rendezvous(day, tier, d.id);
    if (a > age || (a === age && sc < score)) {
      age = a;
      score = sc;
      pick = d;
    }
  }
  return pick;
}

/** Fallback when the daily pool is empty: replay a campaign level the player has already cleared. */
function pickFromCampaign(day: string, tier: number): LevelDef | null {
  const upTo = Math.max(0, clearedUpTo());
  const n = Math.min(ALL_LEVELS.length, upTo + 1);
  if (!n) return null;
  const lo = Math.floor((n * tier) / 3), hi = Math.max(lo + 1, Math.floor((n * (tier + 1)) / 3));
  const idx = lo + (rendezvous(day, tier, 'campaign') % (hi - lo));
  return ALL_LEVELS[Math.min(n - 1, idx)] || null;
}

function reskin(def: LevelDef, day: string, tier: number): LevelDef {
  const rnd = mulberry32(hashString('daily:' + day + ':' + tier));
  const perm: [string, string, string] = ['R', 'Y', 'B'];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  const flipX = rnd() < 0.5, flipY = rnd() < 0.5;
  const out = transformLevel(def, { flipX, flipY, perm }, 'daily-' + day + '-' + tier);
  // A daily is never a lesson: no intro card, no guided steps.
  delete out.intro;
  delete out.guided;
  return out;
}

function buildDefs(day: string): LevelDef[] {
  const known = mechanicsKnown(clearedUpTo());
  const rec = store.data.daily.days[day];
  const byId = new Map(DAILY_POOL.map((d) => [d.id, d]));
  const saved = rec && rec.ids && rec.ids.length === DAILY.tiers.length && rec.ids.every((id) => byId.has(id)) ? rec.ids : null;
  const used = lastUsed(day);
  const taken = new Set<string>();
  const ids: string[] = [];
  const defs: LevelDef[] = [];
  for (let tier = 0; tier < DAILY.tiers.length; tier++) {
    let base: LevelDef | null = saved ? byId.get(saved[tier])! : pickFromPool(day, tier, known, used, taken);
    if (base) {
      ids.push(base.id);
      taken.add(base.id);
    } else base = pickFromCampaign(day, tier);
    if (!base) return [];
    defs.push(reskin(base, day, tier));
  }
  // Remember the picks so the set never changes during the day (even after learning a new rule).
  if (!saved && ids.length === DAILY.tiers.length && dailyUnlocked()) {
    const r = store.data.daily.days[day] || (store.data.daily.days[day] = { done: [] });
    r.ids = ids;
  }
  return defs;
}

/** Today's three puzzles (deterministic per day; cached). */
export function todaySet(): DailyPuzzle[] {
  const day = today();
  // Once today's picks are saved they never change; before that they follow the known rules.
  const keyOf = () => {
    const r = store.data.daily.days[day];
    return day + (r && r.ids ? ':saved' : ':' + clearedUpTo());
  };
  if (!cache || cache.key !== keyOf()) {
    const defs = buildDefs(day);
    cache = { key: keyOf(), defs };
  }
  const rec = store.data.daily.days[day];
  const done = (rec && rec.done) || [];
  return cache.defs.map((def, i) => ({
    tier: i as DailyTierIndex,
    def,
    reward: DAILY.tiers[i].reward,
    done: done.includes(i),
  }));
}

/** Current streak; 0 when the last counted day is before yesterday. */
export function effectiveStreak(): number {
  const d = store.data.daily;
  if (!d.last) return 0;
  const day = today();
  return d.last === day || d.last === addDays(day, -1) ? d.streak : 0;
}

/** True when today already counts for the streak. */
export function streakCountedToday(): boolean {
  return store.data.daily.last === today();
}

/** Milestones (listed ones, then repeats) with days <= upTo, plus the first one beyond it. */
export function milestonesThrough(upTo: number): Milestone[] {
  const out: Milestone[] = DAILY.streakMilestones.map((m) => ({ days: m.days, reward: m.reward }));
  const last = out.length ? out[out.length - 1].days : 0;
  if (DAILY.repeatEvery > 0) {
    for (let days = last + DAILY.repeatEvery; ; days += DAILY.repeatEvery) {
      out.push({ days, reward: DAILY.repeatReward, repeat: true });
      if (days > upTo) break;
    }
  }
  return out;
}

/** Reward actually given for a milestone (an already-owned cosmetic turns into the repeat reward). */
export function milestoneReward(m: { reward: Reward }): Reward {
  const c = m.reward.cosmetic;
  if (c && store.data.cosmetics.owned.includes(c)) return { ...DAILY.repeatReward };
  return { ...m.reward };
}

export function milestoneClaimed(days: number): boolean {
  return store.data.daily.claimed.includes(days);
}

/** The next milestone the player can still earn (claims are lifetime, so skip claimed ones). */
export function nextMilestone(): Milestone | null {
  const streak = effectiveStreak();
  const limit = Math.max(streak, store.data.daily.best) + DAILY.repeatEvery + 1;
  for (const m of milestonesThrough(limit)) if (m.days > streak && !milestoneClaimed(m.days)) return m;
  return null;
}

export function recordDailyClear(tier: DailyTierIndex): DailyClearResult {
  const d = store.data.daily;
  const day = today();
  const rec = d.days[day] || (d.days[day] = { done: [] });

  let reward: Reward = {};
  if (!rec.done.includes(tier)) {
    rec.done.push(tier);
    rec.done.sort((a, b) => a - b);
    reward = { ...DAILY.tiers[tier].reward };
    grant(reward);
  }

  let streakUp = false;
  if (d.last !== day) {
    d.streak = d.last === addDays(day, -1) ? d.streak + 1 : 1;
    d.last = day;
    if (d.streak > d.best) d.best = d.streak;
    streakUp = true;
  }

  let allDoneBonus: Reward | null = null;
  if (!rec.bonus && DAILY.tiers.every((_, i) => rec.done.includes(i))) {
    rec.bonus = 1;
    allDoneBonus = { ...DAILY.allDoneBonus };
    grant(allDoneBonus);
  }

  let milestone: DailyClearResult['milestone'] = null;
  if (streakUp) {
    for (const m of milestonesThrough(d.streak)) {
      if (m.days > d.streak || d.claimed.includes(m.days)) continue;
      d.claimed.push(m.days);
      const r = milestoneReward(m);
      grant(r);
      milestone = { days: m.days, reward: r };
    }
  }

  store.commit('daily');
  return { reward, streak: d.streak, streakUp, allDoneBonus, milestone };
}

/** Tab badge: daily is open and today still has an unfinished puzzle. */
export function dailyBadge(): boolean {
  if (!dailyUnlocked()) return false;
  return todaySet().some((p) => !p.done);
}
