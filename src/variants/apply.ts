/*
 * Adjusts shared numbers and lists for the test versions before any screen is built:
 *  - cores without rewind items: no rewind items anywhere (shop, gifts, bundles, start kit);
 *    rewinds in gifts become coins so rewards keep their value
 *  - only cosmetics that can be earned inside 30 stages (or bought) are listed
 */
import { V, IS_VARIANT } from './index.ts';
import { START, COIN_ITEMS, PRODUCTS, FREE_GIFT, CHAPTER_REWARD, PRICES, COSMETICS, type Reward } from '../config/balance.ts';

function stripRewinds(r: Reward, toCoins: boolean): void {
  if (!r.rewinds) return;
  if (toCoins) r.coins = (r.coins || 0) + r.rewinds * PRICES.rewind;
  delete r.rewinds;
}

export function applyVariant(): void {
  if (!IS_VARIANT) return;
  if (!V.rewinds) {
    START.rewinds = 0;
    for (let i = COIN_ITEMS.length - 1; i >= 0; i--) if (COIN_ITEMS[i].reward.rewinds) COIN_ITEMS.splice(i, 1);
    for (const p of PRODUCTS) stripRewinds(p.reward, false);
    stripRewinds(FREE_GIFT.reward, true);
    stripRewinds(CHAPTER_REWARD.complete, true);
    for (const m of CHAPTER_REWARD.sealMilestones) stripRewinds(m.reward, true);
  }
  // One chapter, no daily streak: keep what a player can actually get.
  for (let i = COSMETICS.length - 1; i >= 0; i--) {
    const c = COSMETICS[i];
    const earnable = c.price !== undefined || c.source === 'default' || (c.source === 'chapter' && c.chapter === 0);
    if (!earnable) COSMETICS.splice(i, 1);
  }
}
