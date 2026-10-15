/*
 * Build-time variant ("core") selection for the core-comparison builds.
 *
 *   orig — the original Inkbloom (timing puzzle, 240 levels)
 *   a    — timeless spread: overlapping spreads mix, only *where* matters
 *   b    — one-stroke painting: drag paths from each colour's source
 *   c    — colouring book: pour colours into picture regions
 *   d    — marked wells: pick which well to open, in which order, on which beat
 *   e    — first drop shown: the first move is given, the rest is read from its spread
 *
 * Each variant is a separate build (VITE_CORE=a …) with its own save slot, so progress,
 * tutorials and currencies never leak between versions or into the original game.
 */
export type CoreId = 'orig' | 'a' | 'b' | 'c' | 'd' | 'e';

function readCore(): CoreId {
  let v = '';
  try {
    v = String((import.meta as any).env?.VITE_CORE || '');
  } catch {
    v = '';
  }
  return (['a', 'b', 'c', 'd', 'e'].includes(v) ? v : 'orig') as CoreId;
}

export const CORE: CoreId = readCore();
export const IS_VARIANT = CORE !== 'orig';

export interface VariantInfo {
  id: CoreId;
  /** localStorage key of the save blob (backup uses key + '.bak'). */
  saveKey: string;
  /** The core runs on a beat clock (beat pill, relaxed-tempo setting). */
  hasBeat: boolean;
  /** Rewinds exist as a paid item (timing cores). Free-undo cores drop them from every reward. */
  rewindItem: boolean;
}

const INFO: Record<CoreId, VariantInfo> = {
  orig: { id: 'orig', saveKey: 'inkbloom.save', hasBeat: true, rewindItem: true },
  a: { id: 'a', saveKey: 'inkbloom.core-a.save', hasBeat: false, rewindItem: false },
  b: { id: 'b', saveKey: 'inkbloom.core-b.save', hasBeat: false, rewindItem: false },
  c: { id: 'c', saveKey: 'inkbloom.core-c.save', hasBeat: false, rewindItem: false },
  d: { id: 'd', saveKey: 'inkbloom.core-d.save', hasBeat: true, rewindItem: true },
  e: { id: 'e', saveKey: 'inkbloom.core-e.save', hasBeat: true, rewindItem: true },
};

export const VARIANT: VariantInfo = INFO[CORE];
