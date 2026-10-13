/* Wallet helpers. All gains and costs go through here so the HUD and saves stay in sync. */
import { store } from './store.ts';
import type { Reward } from '../config/balance.ts';

export function grant(r: Reward): void {
  const d = store.data;
  if (r.coins) d.coins += Math.floor(r.coins);
  if (r.hints) d.hints += Math.floor(r.hints);
  if (r.rewinds) d.rewinds += Math.floor(r.rewinds);
  if (r.cosmetic && !d.cosmetics.owned.includes(r.cosmetic)) {
    d.cosmetics.owned.push(r.cosmetic);
    store.commit('cosmetics');
  }
  store.commit('wallet');
}

export function addRewards(a: Reward, b: Reward): Reward {
  const out: Reward = {};
  const coins = (a.coins || 0) + (b.coins || 0), hints = (a.hints || 0) + (b.hints || 0), rewinds = (a.rewinds || 0) + (b.rewinds || 0);
  if (coins) out.coins = coins;
  if (hints) out.hints = hints;
  if (rewinds) out.rewinds = rewinds;
  if (a.cosmetic || b.cosmetic) out.cosmetic = a.cosmetic || b.cosmetic;
  return out;
}

export function isEmptyReward(r: Reward): boolean {
  return !r.coins && !r.hints && !r.rewinds && !r.cosmetic;
}

export function canAfford(coins: number): boolean {
  return store.data.coins >= coins;
}

/** Spends coins if possible. Returns false (and spends nothing) when short. */
export function spendCoins(n: number): boolean {
  if (store.data.coins < n) return false;
  store.data.coins -= n;
  store.commit('wallet');
  return true;
}

export function useItem(kind: 'hints' | 'rewinds'): boolean {
  if (store.data[kind] <= 0) return false;
  store.data[kind] -= 1;
  store.commit('wallet');
  return true;
}
