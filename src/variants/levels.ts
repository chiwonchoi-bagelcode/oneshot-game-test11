/* The 30-stage level sets of the test versions. */
import type { LevelDef } from '../core/sim.ts';
import { LEVELS as A } from './a/levels.ts';
import { LEVELS as B } from './b/levels.ts';
import { LEVELS as C } from './c/levels.ts';
import { LEVELS as D } from './d/levels.ts';
import { LEVELS as E } from './e/levels.ts';

export const VARIANT_LEVELS: Record<'a' | 'b' | 'c' | 'd' | 'e', LevelDef[]> = { a: A, b: B, c: C, d: D, e: E };
