/*
 * Musical identity per chapter: key, pentatonic, progression, instrument palette, ambience.
 * Chord tones are pitch-class offsets from the key (0..11); the director voices them.
 */

export type Ambient = 'none' | 'drip' | 'clink' | 'bamboo' | 'wind' | 'waves' | 'lantern' | 'leaves' | 'twinkle';

export interface Chord {
  /** Bass pitch class (offset from key). */
  b: number;
  /** Pad tones (pitch classes, offsets from key). */
  t: number[];
}

export interface Palette {
  name: string;
  /** Tonic, MIDI, around octave 4. */
  key: number;
  /** Pentatonic offsets used for melody, SFX and board notes. */
  penta: number[];
  prog: Chord[];
  /** Alternative progression mixed in for variety. */
  alt: Chord[];
  /** Default beat for this mood (ms) when no gameplay grid is running. */
  beatMs: number;
  /** Melody instruments (rotated per phrase). */
  lead: string[];
  /** Melody register centre (MIDI). */
  leadMid: number;
  arp: string | null;
  /** Step positions (0..15, eighths across 2 bars) where the arp may play. */
  arpPat: number[];
  arpDensity: number;
  pad: string;
  padGain: number;
  /** Extra soft bass hit at step 8. */
  bass8: boolean;
  /** Board / drop pluck instrument. */
  pluck: string;
  amb: Ambient;
  /** Probability that a 2-bar phrase is a rest. */
  rest: number;
  /** Gayageum-style vibrato / slides on long lead notes. */
  bend: boolean;
}

const MAJ = [0, 2, 4, 7, 9];
const MIN = [0, 3, 5, 7, 10];

export const MENU: Palette = {
  name: 'Menu · C major',
  key: 60, penta: MAJ, beatMs: 860,
  prog: [{ b: 0, t: [4, 7, 11, 2] }, { b: 9, t: [0, 4, 7, 11] }, { b: 5, t: [9, 0, 4, 7] }, { b: 7, t: [11, 2, 4, 9] }],
  alt: [{ b: 5, t: [9, 0, 4, 7] }, { b: 4, t: [7, 11, 2, 4] }, { b: 2, t: [5, 9, 0, 4] }, { b: 7, t: [0, 2, 5, 9] }],
  lead: ['piano', 'piano', 'kalimba'], leadMid: 74,
  arp: 'kalimba', arpPat: [0, 6, 12], arpDensity: 0.3,
  pad: 'pad', padGain: 1, bass8: false, pluck: 'kalimba', amb: 'twinkle', rest: 0.3, bend: false,
};

export const CHAPTERS: Palette[] = [
  {
    name: 'Dawn Pond · D major',
    key: 62, penta: MAJ, beatMs: 640,
    prog: [{ b: 0, t: [4, 7, 2, 9] }, { b: 9, t: [0, 4, 7, 2] }, { b: 5, t: [9, 0, 4, 7] }, { b: 7, t: [9, 2, 4, 11] }],
    alt: [{ b: 0, t: [4, 7, 9, 2] }, { b: 2, t: [5, 9, 0, 4] }, { b: 5, t: [9, 0, 4, 2] }, { b: 7, t: [11, 2, 4, 9] }],
    lead: ['kalimba', 'flute'], leadMid: 76,
    arp: 'marimba', arpPat: [0, 3, 6, 10, 13], arpDensity: 0.5,
    pad: 'pad', padGain: 0.9, bass8: false, pluck: 'kalimba', amb: 'drip', rest: 0.45, bend: false,
  },
  {
    name: 'Tea House · E minor',
    key: 64, penta: MIN, beatMs: 640,
    prog: [{ b: 0, t: [3, 7, 10, 2] }, { b: 8, t: [0, 3, 7, 10] }, { b: 3, t: [7, 10, 5, 2] }, { b: 10, t: [2, 5, 7, 0] }],
    alt: [{ b: 5, t: [8, 0, 3, 7] }, { b: 3, t: [7, 10, 2, 5] }, { b: 8, t: [0, 3, 7, 10] }, { b: 7, t: [10, 2, 5, 0] }],
    lead: ['piano', 'piano', 'gayageum'], leadMid: 74,
    arp: 'gayageum', arpPat: [2, 6, 10, 14], arpDensity: 0.5,
    pad: 'pad', padGain: 0.8, bass8: false, pluck: 'gayageum', amb: 'clink', rest: 0.45, bend: true,
  },
  {
    name: 'Bamboo Trail · B dorian',
    key: 59, penta: MIN, beatMs: 640,
    prog: [{ b: 0, t: [3, 7, 10, 2] }, { b: 10, t: [2, 5, 7, 9] }, { b: 8, t: [0, 3, 7, 10] }, { b: 10, t: [0, 5, 7, 2] }],
    alt: [{ b: 0, t: [3, 7, 10, 5] }, { b: 5, t: [9, 0, 3, 7] }, { b: 3, t: [7, 10, 2, 5] }, { b: 10, t: [2, 5, 9, 0] }],
    lead: ['flute', 'flute', 'marimba'], leadMid: 75,
    arp: 'marimba', arpPat: [0, 2, 5, 8, 11, 14], arpDensity: 0.45,
    pad: 'pad', padGain: 0.75, bass8: true, pluck: 'marimba', amb: 'bamboo', rest: 0.4, bend: false,
  },
  {
    name: 'Misty Peaks · Bb lydian',
    key: 58, penta: MAJ, beatMs: 640,
    prog: [{ b: 0, t: [4, 7, 11, 2] }, { b: 0, t: [2, 6, 9, 7] }, { b: 4, t: [7, 11, 2, 9] }, { b: 9, t: [0, 4, 7, 2] }],
    alt: [{ b: 0, t: [4, 7, 11, 9] }, { b: 2, t: [6, 9, 0, 4] }, { b: 7, t: [11, 2, 4, 9] }, { b: 0, t: [2, 6, 9, 11] }],
    lead: ['bell', 'flute'], leadMid: 76,
    arp: 'kalimba', arpPat: [0, 8, 11], arpDensity: 0.4,
    pad: 'pad', padGain: 1.05, bass8: false, pluck: 'kalimba', amb: 'wind', rest: 0.55, bend: false,
  },
  {
    name: 'Sunset Harbor · Eb major',
    key: 63, penta: MAJ, beatMs: 640,
    prog: [{ b: 5, t: [9, 0, 4, 7] }, { b: 0, t: [4, 7, 2, 9] }, { b: 9, t: [0, 4, 7, 2] }, { b: 7, t: [0, 2, 5, 9] }],
    alt: [{ b: 0, t: [4, 7, 11, 2] }, { b: 4, t: [7, 11, 2, 9] }, { b: 5, t: [9, 0, 4, 2] }, { b: 7, t: [11, 2, 5, 9] }],
    lead: ['piano', 'marimba', 'piano'], leadMid: 75,
    arp: 'marimba', arpPat: [0, 3, 6, 8, 11, 14], arpDensity: 0.5,
    pad: 'pad', padGain: 0.85, bass8: true, pluck: 'marimba', amb: 'waves', rest: 0.4, bend: false,
  },
  {
    name: 'Lantern Market · G minor',
    key: 55, penta: MIN, beatMs: 640,
    prog: [{ b: 0, t: [3, 7, 10, 2] }, { b: 8, t: [0, 3, 7, 10] }, { b: 10, t: [2, 5, 7, 0] }, { b: 7, t: [10, 2, 5, 0] }],
    alt: [{ b: 0, t: [3, 7, 10, 5] }, { b: 3, t: [7, 10, 2, 5] }, { b: 8, t: [0, 3, 7, 10] }, { b: 7, t: [10, 2, 5, 0] }],
    lead: ['gayageum', 'gayageum', 'flute'], leadMid: 74,
    arp: 'marimba', arpPat: [0, 2, 3, 6, 8, 10, 11, 14], arpDensity: 0.55,
    pad: 'pad', padGain: 0.7, bass8: true, pluck: 'gayageum', amb: 'lantern', rest: 0.3, bend: true,
  },
  {
    name: 'Maple Valley · C# minor',
    key: 61, penta: MIN, beatMs: 640,
    prog: [{ b: 0, t: [3, 7, 10, 2] }, { b: 8, t: [0, 3, 7, 10] }, { b: 3, t: [7, 10, 0, 5] }, { b: 10, t: [0, 3, 5, 7] }],
    alt: [{ b: 5, t: [8, 0, 3, 7] }, { b: 8, t: [0, 3, 7, 10] }, { b: 0, t: [3, 7, 10, 5] }, { b: 10, t: [2, 5, 7, 0] }],
    lead: ['flute', 'piano', 'gayageum'], leadMid: 73,
    arp: 'gayageum', arpPat: [0, 4, 7, 10, 12], arpDensity: 0.45,
    pad: 'pad', padGain: 0.85, bass8: true, pluck: 'gayageum', amb: 'leaves', rest: 0.4, bend: true,
  },
  {
    name: 'Starlit Garden · Ab major',
    key: 56, penta: MAJ, beatMs: 640,
    prog: [{ b: 5, t: [9, 0, 4, 7] }, { b: 7, t: [0, 2, 5, 9] }, { b: 9, t: [0, 4, 7, 11] }, { b: 0, t: [4, 7, 11, 2] }],
    alt: [{ b: 5, t: [9, 0, 4, 11] }, { b: 2, t: [5, 9, 0, 4] }, { b: 7, t: [11, 2, 5, 9] }, { b: 0, t: [4, 7, 9, 2] }],
    lead: ['bell', 'kalimba', 'bell'], leadMid: 80,
    arp: 'kalimba', arpPat: [0, 2, 4, 6, 8, 10, 12, 14], arpDensity: 0.4,
    pad: 'pad', padGain: 1, bass8: false, pluck: 'kalimba', amb: 'twinkle', rest: 0.4, bend: false,
  },
];

export function chapterPalette(ch: number | undefined): Palette {
  const i = Math.max(0, Math.min(CHAPTERS.length - 1, Math.floor(ch || 0)));
  return CHAPTERS[i];
}

/** MIDI note for pentatonic degree `d` (may be negative / > 4) relative to `base` (a tonic). */
export function deg(p: Palette, d: number, base = p.key): number {
  const n = p.penta.length;
  const o = Math.floor(d / n);
  const i = ((d % n) + n) % n;
  return base + p.penta[i] + 12 * o;
}

/** Nearest MIDI note at or above `lo` with pitch class (key + pc). */
export function placePc(p: Palette, pc: number, lo: number): number {
  const target = (((p.key + pc) % 12) + 12) % 12;
  let m = lo;
  while (((m % 12) + 12) % 12 !== target) m++;
  return m;
}

/** Nearest note to `near` with pitch class (key + pc). */
export function nearPc(p: Palette, pc: number, near: number): number {
  const m = placePc(p, pc, near - 6);
  return m;
}
