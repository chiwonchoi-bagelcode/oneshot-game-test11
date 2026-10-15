/*
 * Adjusts shared game data for a comparison build. Imported first by main.ts so every screen
 * is built from the adjusted data:
 *  - free-undo cores (A, B, C) have no rewind item, so rewinds disappear from every reward,
 *    shop item and bundle (instead of showing an item that does nothing);
 *  - a comparison build has one chapter, so cosmetics earned from later chapters are hidden.
 */
import { VARIANT, IS_VARIANT } from './variant.ts';
import * as BAL from './config/balance.ts';

function strip(r: any): void {
  if (r && typeof r === 'object' && 'rewinds' in r) delete r.rewinds;
}

if (!VARIANT.rewindItem) {
  strip(BAL.CHAPTER_REWARD.complete);
  for (const m of BAL.CHAPTER_REWARD.sealMilestones) strip(m.reward);
  for (let i = BAL.COIN_ITEMS.length - 1; i >= 0; i--) {
    strip(BAL.COIN_ITEMS[i].reward);
    if (!Object.keys(BAL.COIN_ITEMS[i].reward).length) BAL.COIN_ITEMS.splice(i, 1);
  }
  strip(BAL.FREE_GIFT.reward);
  strip(BAL.ADS.coinsReward);
  for (const tier of BAL.DAILY.tiers) strip(tier.reward);
  strip(BAL.DAILY.allDoneBonus);
  for (const m of BAL.DAILY.streakMilestones) strip(m.reward);
  strip(BAL.DAILY.repeatReward);
  for (const p of BAL.PRODUCTS) strip(p.reward);
  // A rewind-only milestone would become empty: give its coin value instead.
  for (const m of BAL.DAILY.streakMilestones) if (!Object.keys(m.reward).length) (m.reward as any).coins = 80;
  for (const m of BAL.CHAPTER_REWARD.sealMilestones) if (!Object.keys(m.reward).length) (m.reward as any).coins = 60;
}

if (IS_VARIANT) {
  for (let i = BAL.COSMETICS.length - 1; i >= 0; i--) {
    const c = BAL.COSMETICS[i];
    if (c.source === 'chapter' && (c.chapter || 0) > 0) BAL.COSMETICS.splice(i, 1);
  }
}

export {};
