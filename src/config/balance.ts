/*
 * Every tunable number in the game lives here: tempo, rewards, prices, ad limits, daily rules,
 * store products and cosmetics. Screens read these values; nothing else hard-codes them.
 * (Plain data only — this file is also imported by the Node level tools.)
 */

export interface Reward {
  coins?: number;
  hints?: number;
  rewinds?: number;
  /** Cosmetic id from COSMETICS. */
  cosmetic?: string;
}

export const TEMPO = {
  /** Default beat length (ms). */
  beatMs: 640,
  /** Beat length for the very first lessons. */
  tutorialBeatMs: 760,
  /** Settings → "Relaxed tempo" multiplies the beat length by this. */
  relaxedMul: 1.35,
  /** A tap this soon after a beat still counts for the previous beat (touch latency forgiveness). */
  graceMs: 90,
  /** Speed-up once every ink is down and the result is already decided. */
  fastForwardMul: 3,
  /** Pause after the last change before the result appears (ms). */
  settleDelayMs: 380,
};

export const START = { coins: 200, hints: 3, rewinds: 3 };

export const LEVEL_REWARD = {
  /** First clear coins, by chapter index (0-based). */
  clearCoins: [10, 12, 14, 16, 18, 20, 22, 25],
  /** Extra coins for a seal (first-try clear without hint or rewind). */
  sealBonus: 10,
  /** Result screen "watch an ad to double" multiplies the level coins by this. */
  adMultiplier: 2,
};

export const CHAPTER_REWARD = {
  /** Given when every level of a chapter is cleared. */
  complete: { coins: 250, hints: 1 } as Reward,
  /** Seal milestones inside a chapter (30 levels per chapter). */
  sealMilestones: [
    { seals: 10, reward: { coins: 60, rewinds: 1 } as Reward },
    { seals: 20, reward: { coins: 120, hints: 1 } as Reward },
    { seals: 30, reward: { coins: 250, hints: 2, rewinds: 2 } as Reward },
  ],
};

export const PRICES = {
  hint: 100,
  rewind: 40,
};

/** Coin bundles of items sold in the shop for coins. */
export const COIN_ITEMS = [
  { id: 'hint1', reward: { hints: 1 } as Reward, price: 100 },
  { id: 'hint3', reward: { hints: 3 } as Reward, price: 270 },
  { id: 'rewind3', reward: { rewinds: 3 } as Reward, price: 110 },
  { id: 'rewind8', reward: { rewinds: 8 } as Reward, price: 260 },
];

export const ADS = {
  /** Rewarded ad → 1 hint. Daily cap. */
  hintPerDay: 5,
  /** Rewarded ad on the result screen → level coins x2. Daily cap. */
  doublePerDay: 6,
  /** Rewarded ad in the shop → small coin gift. Daily cap. */
  coinsPerDay: 3,
  coinsReward: { coins: 40 } as Reward,
  /** Placeholder ad length (ms) before it can be closed. */
  placeholderMs: 2200,
};

export const FREE_GIFT = {
  /** Once per day in the shop, no ad needed. */
  reward: { coins: 30, rewinds: 1 } as Reward,
};

export const DAILY = {
  /** Clear this many campaign levels before daily puzzles open. */
  unlockAfterLevel: 8,
  tiers: [
    { id: 'light', reward: { coins: 25 } as Reward },
    { id: 'medium', reward: { coins: 45 } as Reward },
    { id: 'hard', reward: { coins: 80, rewinds: 1 } as Reward },
  ],
  /** All three of today's puzzles cleared. */
  allDoneBonus: { coins: 60, hints: 1 } as Reward,
  /** Streak = consecutive days with at least one daily puzzle cleared. */
  streakMilestones: [
    { days: 2, reward: { coins: 50 } as Reward },
    { days: 3, reward: { coins: 80, rewinds: 1 } as Reward },
    { days: 5, reward: { coins: 120, hints: 1 } as Reward },
    { days: 7, reward: { cosmetic: 'ink-dawn' } as Reward },
    { days: 10, reward: { coins: 200, hints: 1 } as Reward },
    { days: 14, reward: { cosmetic: 'paper-starlight' } as Reward },
    { days: 21, reward: { coins: 300, hints: 2 } as Reward },
    { days: 30, reward: { cosmetic: 'ink-aurora' } as Reward },
  ],
  /** After the last milestone: every N days of streak gives this. */
  repeatEvery: 7,
  repeatReward: { coins: 200, hints: 1 } as Reward,
};

export type ProductKind = 'coins' | 'bundle';

export interface Product {
  id: string;
  kind: ProductKind;
  reward: Reward;
  /** Store price in local currency (placeholder until real billing is connected). */
  price: { krw: number; usd: number };
  /** Only purchasable once. */
  once?: boolean;
  /** Highlight label key (i18n) e.g. 'shop.badge.best'. */
  badge?: string;
  /** Visual size tier for the coin art (1..4). */
  tier?: number;
}

export const PRODUCTS: Product[] = [
  { id: 'starter', kind: 'bundle', once: true, badge: 'shop.badge.once', reward: { coins: 1000, hints: 5, rewinds: 5, cosmetic: 'paper-celadon' }, price: { krw: 2500, usd: 1.99 } },
  { id: 'painter', kind: 'bundle', badge: 'shop.badge.best', reward: { coins: 3000, hints: 15, rewinds: 15 }, price: { krw: 9900, usd: 7.99 } },
  { id: 'master', kind: 'bundle', reward: { coins: 8000, hints: 40, rewinds: 40, cosmetic: 'ink-jewel' }, price: { krw: 25000, usd: 19.99 } },
  { id: 'coins-s', kind: 'coins', tier: 1, reward: { coins: 500 }, price: { krw: 1200, usd: 0.99 } },
  { id: 'coins-m', kind: 'coins', tier: 2, reward: { coins: 1300 }, price: { krw: 2900, usd: 2.49 } },
  { id: 'coins-l', kind: 'coins', tier: 3, badge: 'shop.badge.popular', reward: { coins: 3000 }, price: { krw: 5900, usd: 4.99 } },
  { id: 'coins-xl', kind: 'coins', tier: 4, reward: { coins: 7000 }, price: { krw: 12000, usd: 9.99 } },
];

export type CosmeticKind = 'ink' | 'paper';

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  /** Coin price; 0 = default/free. Omit when it can only be earned. */
  price?: number;
  /** How it is earned when not for sale (i18n key under gallery.source.*). */
  source?: 'default' | 'chapter' | 'streak' | 'bundle';
  /** Chapter index (0-based) that awards it on completion. */
  chapter?: number;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'ink-classic', kind: 'ink', price: 0, source: 'default' },
  { id: 'ink-pastel', kind: 'ink', price: 900 },
  { id: 'ink-autumn', kind: 'ink', source: 'chapter', chapter: 2 },
  { id: 'ink-dawn', kind: 'ink', source: 'streak' },
  { id: 'ink-ocean', kind: 'ink', price: 1600 },
  { id: 'ink-jewel', kind: 'ink', source: 'bundle', price: 2800 },
  { id: 'ink-aurora', kind: 'ink', source: 'streak' },
  { id: 'paper-hanji', kind: 'paper', price: 0, source: 'default' },
  { id: 'paper-celadon', kind: 'paper', price: 700 },
  { id: 'paper-kraft', kind: 'paper', source: 'chapter', chapter: 0 },
  { id: 'paper-linen', kind: 'paper', price: 1100 },
  { id: 'paper-dusk', kind: 'paper', source: 'chapter', chapter: 4 },
  { id: 'paper-starlight', kind: 'paper', source: 'streak' },
  { id: 'paper-night', kind: 'paper', source: 'chapter', chapter: 6 },
];

export const LEVELS_PER_CHAPTER = 30;
