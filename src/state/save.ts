/*
 * Persistent save data. One JSON blob in localStorage with a rolling backup.
 * Bump SAVE_VERSION and add a migration step when the shape changes.
 */
import { START } from '../config/balance.ts';
import type { Lang } from '../i18n/i18n.ts';

export const SAVE_VERSION = 1;
import { V } from '../variants/index.ts';

// Each build variant keeps its own save (the original keeps 'inkbloom.save').
const KEY = V.saveKey;
const BACKUP_KEY = V.saveKey + '.bak';

export interface LevelRecord {
  /** Cleared at least once. */
  c?: 1;
  /** Seal (first-try clear without hint or rewind). */
  s?: 1;
  /** Failed/retried attempts before the first clear (for analytics / seal logic). */
  f?: number;
}

export interface DailyDayRecord {
  /** Tier indexes cleared that day (0 light, 1 medium, 2 hard). */
  done: number[];
  /** All-three bonus claimed. */
  bonus?: 1;
  /** Pool ids picked for that day (keeps the set stable all day, avoids repeats). */
  ids?: string[];
}

export interface Settings {
  sfx: number;
  music: number;
  vibration: boolean;
  symbols: boolean;
  relaxed: boolean;
  lang: Lang;
  reducedMotion: boolean;
}

export interface SaveData {
  v: number;
  createdAt: number;
  coins: number;
  hints: number;
  rewinds: number;
  /** Per level id. */
  levels: Record<string, LevelRecord>;
  /** Levels where a hint was bought (re-showing it is free). */
  hinted: Record<string, 1>;
  /** Chapter rewards already granted: chapter index → { done: complete reward, seals: milestone seal counts claimed }. */
  chapters: Record<number, { done?: 1; seals?: number[] }>;
  daily: {
    days: Record<string, DailyDayRecord>;
    streak: number;
    best: number;
    /** Day key of the last day that counted for the streak. */
    last: string | null;
    /** Streak milestone day-counts already rewarded. */
    claimed: number[];
  };
  shop: {
    /** Product ids bought (for once-only items and restore). */
    bought: string[];
    /** Day key when the free gift was last taken. */
    gift: string | null;
    /** Ad counters, reset each day. */
    adDay: string | null;
    ads: { hint: number; double: number; coins: number };
  };
  cosmetics: { owned: string[]; ink: string; paper: string };
  settings: Settings;
  /** One-time things the player has seen: intro cards, coach marks, popups. */
  seen: Record<string, 1>;
  stats: { plays: number; clears: number; drops: number; sessions: number; lastSession: number };
  /** Debug: days added to the real clock (dev builds only). */
  dayOffset: number;
}

export function defaultSave(lang: Lang): SaveData {
  return {
    v: SAVE_VERSION,
    createdAt: Date.now(),
    coins: START.coins,
    hints: START.hints,
    rewinds: START.rewinds,
    levels: {},
    hinted: {},
    chapters: {},
    daily: { days: {}, streak: 0, best: 0, last: null, claimed: [] },
    shop: { bought: [], gift: null, adDay: null, ads: { hint: 0, double: 0, coins: 0 } },
    cosmetics: { owned: ['ink-classic', 'paper-hanji'], ink: 'ink-classic', paper: 'paper-hanji' },
    settings: { sfx: 0.9, music: 0.6, vibration: true, symbols: false, relaxed: false, lang, reducedMotion: false },
    seen: {},
    stats: { plays: 0, clears: 0, drops: 0, sessions: 0, lastSession: 0 },
    dayOffset: 0,
  };
}

function migrate(raw: any, lang: Lang): SaveData {
  const base = defaultSave(lang);
  if (!raw || typeof raw !== 'object') return base;
  // Deep-fill missing fields so older saves keep working.
  const out: any = { ...base, ...raw };
  for (const k of ['daily', 'shop', 'cosmetics', 'settings', 'stats'] as const) {
    out[k] = { ...(base as any)[k], ...(raw[k] || {}) };
  }
  out.shop.ads = { ...base.shop.ads, ...((raw.shop && raw.shop.ads) || {}) };
  for (const k of ['levels', 'hinted', 'chapters', 'seen'] as const) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  if (!Array.isArray(out.cosmetics.owned)) out.cosmetics.owned = base.cosmetics.owned;
  for (const id of base.cosmetics.owned) if (!out.cosmetics.owned.includes(id)) out.cosmetics.owned.push(id);
  for (const k of ['coins', 'hints', 'rewinds', 'dayOffset'] as const) {
    if (typeof out[k] !== 'number' || !isFinite(out[k]) || out[k] < 0) out[k] = k === 'dayOffset' ? 0 : (base as any)[k];
    out[k] = Math.floor(out[k]);
  }
  out.v = SAVE_VERSION;
  return out as SaveData;
}

export function loadSave(lang: Lang): SaveData {
  for (const key of [KEY, BACKUP_KEY]) {
    try {
      const s = localStorage.getItem(key);
      if (s) return migrate(JSON.parse(s), lang);
    } catch {
      /* corrupted or blocked storage → try backup / start fresh */
    }
  }
  return defaultSave(lang);
}

export function writeSave(data: SaveData): void {
  try {
    const s = JSON.stringify(data);
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP_KEY, prev);
    localStorage.setItem(KEY, s);
  } catch {
    /* storage full or blocked; the game keeps running from memory */
  }
}

export function wipeSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
}
