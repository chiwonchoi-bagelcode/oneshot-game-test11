/*
 * Build-time variant switch. `VITE_VARIANT=a npm run build` produces version A, etc.
 * The original game (no VITE_VARIANT) is untouched: same save key, levels and features.
 *
 *   orig  original timing game (8 chapters)
 *   a     spatial: spreading and mixing that don't depend on time or order
 *   b     path drawing: paint by dragging ink paths; crossing paths mix
 *   c     colouring book: fill regions of a picture, layer colours to mix
 *   d     timing puzzle with every drop spot shown
 *   e     timing puzzle with the first drop shown
 */
export type VariantId = 'orig' | 'a' | 'b' | 'c' | 'd' | 'e';
export type CoreKind = 'timing' | 'spatial' | 'path' | 'paint';

export interface VariantSpec {
  id: VariantId;
  core: CoreKind;
  /** localStorage key — every version keeps its own progress, items and seen tutorials. */
  saveKey: string;
  /** Rewind items exist (timing cores). Other cores undo for free in their own way. */
  rewinds: boolean;
  /** Daily pictures (original only — the test versions stop at stage 30). */
  daily: boolean;
  /** Beat-based play: "relaxed tempo" setting and the beat clock. */
  beats: boolean;
  /** Options for the timing core. */
  timing?: {
    beatMs?: number;
    tutorialBeatMs?: number;
    /** Tutorial tempo applies up to this level number. */
    tutorialUpTo?: number;
    graceMs?: number;
    /** Only the level's `spots` take ink; spot k holds ink k (variant D). */
    spots?: boolean;
    /** The first drop's cell is always shown and is the only cell open for the first drop (variant E). */
    firstMarker?: boolean;
  };
}

export const VARIANTS: Record<VariantId, VariantSpec> = {
  orig: { id: 'orig', core: 'timing', saveKey: 'inkbloom.save', rewinds: true, daily: true, beats: true, timing: {} },
  a: { id: 'a', core: 'spatial', saveKey: 'inkbloom.va.save', rewinds: false, daily: false, beats: false },
  b: { id: 'b', core: 'path', saveKey: 'inkbloom.vb.save', rewinds: false, daily: false, beats: false },
  c: { id: 'c', core: 'paint', saveKey: 'inkbloom.vc.save', rewinds: false, daily: false, beats: false },
  d: { id: 'd', core: 'timing', saveKey: 'inkbloom.vd.save', rewinds: true, daily: false, beats: true, timing: { spots: true } },
  e: { id: 'e', core: 'timing', saveKey: 'inkbloom.ve.save', rewinds: true, daily: false, beats: true, timing: { firstMarker: true } },
};

const env: Record<string, string | undefined> = ((import.meta as any).env || {}) as any;
const raw = (env.VITE_VARIANT || '').toLowerCase();

export const VARIANT_ID: VariantId = (raw in VARIANTS ? raw : 'orig') as VariantId;
export const V: VariantSpec = VARIANTS[VARIANT_ID];
export const IS_VARIANT = VARIANT_ID !== 'orig';
