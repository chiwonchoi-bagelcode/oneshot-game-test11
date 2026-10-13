/* Campaign progress: unlocks, clears, seals and chapter rewards. */
import { store } from './store.ts';
import { grant, addRewards } from './economy.ts';
import { CHAPTERS, ALL_LEVELS, levelInfo } from '../levels/pack.ts';
import { LEVEL_REWARD, CHAPTER_REWARD, COSMETICS, type Reward } from '../config/balance.ts';

export function isCleared(id: string): boolean {
  return !!store.data.levels[id]?.c;
}

export function isSealed(id: string): boolean {
  return !!store.data.levels[id]?.s;
}

/** Levels unlock in order: a level is open when the previous one is cleared. */
export function isUnlocked(index: number): boolean {
  if (index <= 0) return true;
  const prev = ALL_LEVELS[index - 1];
  return !!prev && isCleared(prev.id);
}

/** Index of the first level not cleared yet (the "continue" level). -1 when everything is done. */
export function nextLevelIndex(): number {
  for (let i = 0; i < ALL_LEVELS.length; i++) if (!isCleared(ALL_LEVELS[i].id)) return i;
  return -1;
}

export function clearedCount(): number {
  let n = 0;
  for (const l of ALL_LEVELS) if (isCleared(l.id)) n++;
  return n;
}

/** Highest global index cleared (contiguous from the start). */
export function clearedUpTo(): number {
  let i = -1;
  while (i + 1 < ALL_LEVELS.length && isCleared(ALL_LEVELS[i + 1].id)) i++;
  return i;
}

export function chapterUnlocked(ci: number): boolean {
  const ch = CHAPTERS[ci];
  return !!ch && ch.levels.length > 0 && isUnlocked(ch.first - 1);
}

export function chapterStats(ci: number): { cleared: number; sealed: number; total: number } {
  const ch = CHAPTERS[ci];
  let cleared = 0, sealed = 0;
  for (const l of ch.levels) {
    if (isCleared(l.id)) cleared++;
    if (isSealed(l.id)) sealed++;
  }
  return { cleared, sealed, total: ch.levels.length };
}

export interface ClearResult {
  firstClear: boolean;
  newSeal: boolean;
  /** Coins for this clear (level + seal bonus). Already granted. */
  coins: number;
  levelCoins: number;
  sealCoins: number;
  /** Chapter finished with this clear: reward already granted. */
  chapterComplete: Reward | null;
  /** Seal milestone rewards reached with this clear (already granted). */
  sealMilestones: { seals: number; reward: Reward }[];
  chapterIndex: number;
  /** Painting region index revealed by this clear (first clear only), else -1. */
  revealed: number;
}

export function recordFail(id: string): void {
  const r = store.data.levels[id] || (store.data.levels[id] = {});
  if (!r.c) r.f = (r.f || 0) + 1;
  store.data.stats.plays++;
  store.commit('stats');
}

export function recordClear(id: string, sealed: boolean): ClearResult {
  const info = levelInfo(id)!;
  const ci = info.chapter.index;
  const r = store.data.levels[id] || (store.data.levels[id] = {});
  const firstClear = !r.c;
  const newSeal = sealed && !r.s;
  r.c = 1;
  if (sealed) r.s = 1;
  store.data.stats.plays++;
  store.data.stats.clears++;

  const levelCoins = firstClear ? LEVEL_REWARD.clearCoins[Math.min(ci, LEVEL_REWARD.clearCoins.length - 1)] : 0;
  const sealCoins = newSeal ? LEVEL_REWARD.sealBonus : 0;
  if (levelCoins + sealCoins) grant({ coins: levelCoins + sealCoins });

  const result: ClearResult = {
    firstClear,
    newSeal,
    coins: levelCoins + sealCoins,
    levelCoins,
    sealCoins,
    chapterComplete: null,
    sealMilestones: [],
    chapterIndex: ci,
    revealed: firstClear ? info.chapter.levels.indexOf(info.level) : -1,
  };

  const ch = store.data.chapters[ci] || (store.data.chapters[ci] = {});
  const stats = chapterStats(ci);
  if (stats.cleared === stats.total && !ch.done) {
    ch.done = 1;
    let reward: Reward = { ...CHAPTER_REWARD.complete };
    const cos = COSMETICS.find((c) => c.source === 'chapter' && c.chapter === ci);
    if (cos && !store.data.cosmetics.owned.includes(cos.id)) reward = addRewards(reward, { cosmetic: cos.id });
    grant(reward);
    result.chapterComplete = reward;
  }
  ch.seals = ch.seals || [];
  for (const m of CHAPTER_REWARD.sealMilestones) {
    if (stats.sealed >= m.seals && !ch.seals.includes(m.seals)) {
      ch.seals.push(m.seals);
      grant(m.reward);
      result.sealMilestones.push({ seals: m.seals, reward: m.reward });
    }
  }
  store.commit('progress');
  return result;
}

/** Debug: mark levels [0, upTo] cleared (optionally sealed) without rewards. */
export function debugClearUpTo(upTo: number, sealed = false): void {
  for (let i = 0; i <= upTo && i < ALL_LEVELS.length; i++) {
    const r = store.data.levels[ALL_LEVELS[i].id] || (store.data.levels[ALL_LEVELS[i].id] = {});
    r.c = 1;
    if (sealed) r.s = 1;
  }
  store.commit('progress');
}
