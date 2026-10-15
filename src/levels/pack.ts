import type { LevelDef, MechanicKey } from '../core/sim.ts';
import { CAMPAIGN } from './data/campaign.ts';
import { DAILY_POOL as ORIG_DAILY } from './data/daily.ts';
import { CHAPTER_DEFS, type ChapterDef } from './chapters.ts';
import { CORE, IS_VARIANT } from '../variant.ts';
import { LEVELS as A_LEVELS } from '../cores/a/levels.ts';
import { LEVELS as B_LEVELS } from '../cores/b/levels.ts';
import { LEVELS as C_LEVELS } from '../cores/c/levels.ts';
import { LEVELS as D_LEVELS } from '../cores/d/levels.ts';
import { LEVELS as E_LEVELS } from '../cores/e/levels.ts';

const CORE_LEVELS: Record<string, LevelDef[]> = { a: A_LEVELS, b: B_LEVELS, c: C_LEVELS, d: D_LEVELS, e: E_LEVELS };
/** A comparison build is one chapter (the Dawn Pond painting) of its own 30 stages. */
const SOURCE: LevelDef[][] = IS_VARIANT ? [CORE_LEVELS[CORE] || []] : CAMPAIGN;
const DEFS: ChapterDef[] = IS_VARIANT ? CHAPTER_DEFS.slice(0, 1) : CHAPTER_DEFS;

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
export const CHAPTERS: Chapter[] = DEFS.map((c, i) => {
  const levels = SOURCE[i] || [];
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
  const s = new Set<MechanicKey>([ALL_LEVELS[0]?.intro || 'drop']);
  for (let i = 0; i <= clearedUpTo && i < ALL_LEVELS.length; i++) {
    const m = ALL_LEVELS[i].intro;
    if (m) s.add(m);
  }
  return s;
}

/**
 * Comparison builds have no separate daily pool: today's pictures are re-skinned (mirrored,
 * colours swapped where the core allows it) versions of the build's own stages 6–30, offered only
 * once the player has learned every rule the stage uses.
 */
function variantDaily(): DailyDef[] {
  const out: DailyDef[] = [];
  const known: MechanicKey[] = [];
  ALL_LEVELS.forEach((l, i) => {
    if (l.intro && !known.includes(l.intro)) known.push(l.intro);
    if (i < 5) return;
    const tiers: DailyTier[] = i < 14 ? ['light'] : i < 20 ? ['light', 'medium'] : i < 25 ? ['medium', 'hard'] : ['hard'];
    for (const tier of tiers) out.push({ ...l, id: 'dpool-' + l.id + '-' + tier, tier, uses: known.slice(), guided: false, intro: undefined, coach: undefined });
  });
  return out;
}

export const DAILY_POOL: DailyDef[] = IS_VARIANT ? variantDaily() : ORIG_DAILY;
