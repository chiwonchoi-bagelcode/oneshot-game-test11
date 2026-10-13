import type { MechanicKey } from '../core/sim.ts';

export interface ChapterDef {
  id: string;
  /** Mechanics first taught in this chapter (in order). */
  teaches: MechanicKey[];
  /** UI accent colour for headers and map nodes. */
  accent: string;
  /** Soft background tint for the chapter screen. */
  tint: string;
}

/** Order of the journey. Names and story lines live in i18n under chapter.<id>.* */
export const CHAPTER_DEFS: ChapterDef[] = [
  { id: 'pond', teaches: ['drop', 'walls', 'order', 'mix', 'timing'], accent: '#3f8f7a', tint: '#e7f1ec' },
  { id: 'teahouse', teaches: ['parity', 'three'], accent: '#b4683a', tint: '#f5ebe0' },
  { id: 'bamboo', teaches: ['range'], accent: '#5f8a3a', tint: '#ecf2e2' },
  { id: 'peaks', teaches: ['white'], accent: '#5b6f9c', tint: '#e8ecf4' },
  { id: 'harbor', teaches: ['seed'], accent: '#d06a4a', tint: '#f8e9e1' },
  { id: 'market', teaches: ['gate'], accent: '#c2453d', tint: '#f7e6e2' },
  { id: 'valley', teaches: ['slow'], accent: '#b5542a', tint: '#f6e8dc' },
  { id: 'garden', teaches: [], accent: '#4a4a8f', tint: '#e9e8f4' },
];
