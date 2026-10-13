import type { LevelDef, MechanicKey } from '../core/sim.ts';
import { CAMPAIGN } from './data/campaign.ts';
import { DAILY_POOL } from './data/daily.ts';
import { CHAPTER_DEFS, type ChapterDef } from './chapters.ts';

export type DailyTier = 'light' | 'medium' | 'hard';

export interface DailyDef extends LevelDef {
  tier: DailyTier;
  /** Mechanics the puzzle uses; it is only offered once the player has learned all of them. */
  uses: MechanicKey[];
}

export interface Chapter extends ChapterDef {
  index: number;
  levels: LevelDef[];
  /** Global number (1-based) of the first level in this chapter. */
  first: number;
}

let n = 1;
export const CHAPTERS: Chapter[] = CHAPTER_DEFS.map((c, i) => {
  const levels = CAMPAIGN[i] || [];
  const ch: Chapter = { ...c, index: i, levels, first: n };
  n += levels.length;
  return ch;
});

export const ALL_LEVELS: LevelDef[] = CHAPTERS.flatMap((c) => c.levels);
const byId = new Map<string, { level: LevelDef; chapter: Chapter; number: number; index: number }>();
ALL_LEVELS.forEach((l, i) => {
  const chapter = CHAPTERS.find((c) => c.levels.includes(l))!;
  byId.set(l.id, { level: l, chapter, number: i + 1, index: i });
});

export function levelInfo(id: string) {
  return byId.get(id);
}

export function levelAt(index: number): LevelDef | undefined {
  return ALL_LEVELS[index];
}

/** Mechanics the player has been taught after clearing levels up to (and including) `clearedUpTo` (global index). */
export function mechanicsKnown(clearedUpTo: number): Set<MechanicKey> {
  const s = new Set<MechanicKey>(['drop']);
  for (let i = 0; i <= clearedUpTo && i < ALL_LEVELS.length; i++) {
    const m = ALL_LEVELS[i].intro;
    if (m) s.add(m);
  }
  return s;
}

export { DAILY_POOL };
