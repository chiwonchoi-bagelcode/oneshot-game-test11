/*
 * Cosmetic skins: ink sets (the 7 colour codes) and papers (board surface).
 * Every ink set keeps the hue families (R reddish, Y yellowish, B bluish, O between R and Y,
 * P between R and B, G between Y and B, K dull mud) so mixing stays intuitive.
 * Contrast is checked numerically (see tools in the render QA notes): all colours stay
 * clearly distinct from each other and from every paper after `inkForPaper` adjustment.
 */
import { contrast, deltaE, mix, shade } from './color.ts';

export interface InkSkin { id: string; colors: Record<number, string>; /* 1..7 */ }
export interface PaperSkin { id: string; base: string; fiber: string; grid: string; wall: string; wallEdge: string; dark: boolean; }

function ink(id: string, R: string, Y: string, B: string, O: string, P: string, G: string, K: string): InkSkin {
  return { id, colors: { 1: R, 2: Y, 3: O, 4: B, 5: P, 6: G, 7: K } };
}

export const INK_SKINS: InkSkin[] = [
  //            R vermilion  Y gamboge   B ultramarine O orange   P violet    G green     K mud
  ink('ink-classic', '#d9432a', '#eeb517', '#2c5bb8', '#e57a1c', '#874099', '#2f8f57', '#6b5f52'),
  ink('ink-pastel', '#e8786a', '#e9bf3f', '#6b93d6', '#eb9a52', '#a77bc9', '#61b083', '#8f877e'),
  ink('ink-autumn', '#a82a2c', '#d9a91e', '#34557e', '#c9651f', '#7a3558', '#667a26', '#57483b'),
  ink('ink-dawn', '#e2556f', '#f0b93a', '#4f72cf', '#ee8150', '#9c4fae', '#3fa283', '#7a6a74'),
  ink('ink-ocean', '#dd5450', '#e2bd34', '#1d68ad', '#e5843a', '#7a46a6', '#16968a', '#5f5a50'),
  ink('ink-jewel', '#c4153b', '#e4ad0c', '#1c4cd0', '#e2621a', '#7629b8', '#0d9655', '#4a3f52'),
  ink('ink-aurora', '#ef4f7c', '#f2cf37', '#3a78ec', '#f5923a', '#a05aeb', '#22c590', '#666b86'),
];

export const PAPER_SKINS: PaperSkin[] = [
  { id: 'paper-hanji', base: '#f4ead6', fiber: '#d8c49c', grid: '#8a7350', wall: '#3a3a40', wallEdge: '#6c6b75', dark: false },
  { id: 'paper-celadon', base: '#e4ede3', fiber: '#b5cbb8', grid: '#58715f', wall: '#33413d', wallEdge: '#62756e', dark: false },
  { id: 'paper-kraft', base: '#e3d2b8', fiber: '#bf9f6c', grid: '#6f5534', wall: '#3b2f25', wallEdge: '#6d5945', dark: false },
  { id: 'paper-linen', base: '#f3f1eb', fiber: '#d3cec2', grid: '#6d6a62', wall: '#383b42', wallEdge: '#6a6e78', dark: false },
  { id: 'paper-dusk', base: '#efe3e4', fiber: '#d2bcc6', grid: '#7a5f70', wall: '#3a3046', wallEdge: '#6b5d7c', dark: false },
  { id: 'paper-starlight', base: '#1e2643', fiber: '#33416b', grid: '#a9b6e0', wall: '#46517c', wallEdge: '#8e9cd0', dark: true },
  { id: 'paper-night', base: '#1d1d23', fiber: '#2f2f38', grid: '#b9b4aa', wall: '#4a4952', wallEdge: '#8d8b98', dark: true },
];

const INK_BY_ID = new Map(INK_SKINS.map((s) => [s.id, s]));
const PAPER_BY_ID = new Map(PAPER_SKINS.map((s) => [s.id, s]));

export function inkSkin(id: string): InkSkin {
  return INK_BY_ID.get(id) || INK_SKINS[0];
}

export function paperSkin(id: string): PaperSkin {
  return PAPER_BY_ID.get(id) || PAPER_SKINS[0];
}

/**
 * Display colours of an ink set on a given paper. Light papers use the set as is; dark papers
 * lift each colour until it has at least 3.2:1 luminance contrast (and a clear colour difference)
 * against the paper, so ink stays bright and readable at night.
 */
export function inkForPaper(skin: InkSkin, paper: PaperSkin): Record<number, string> {
  const out: Record<number, string> = {};
  for (let c = 1; c <= 7; c++) {
    let col = skin.colors[c];
    if (paper.dark) {
      let k = 0;
      while (k < 12 && (contrast(col, paper.base) < (c === 7 ? 3.0 : 3.6) || deltaE(col, paper.base) < 40)) {
        col = shade(col, 1.0, 1.0, 0.035);
        k++;
      }
    } else {
      // Light inks (yellows, pastels) get a touch deeper until they stand clear of the paper.
      let k = 0;
      while (k < 8 && deltaE(mix(paper.base, col, 0.9), paper.base) < 21) {
        col = shade(col, 0.95, 1.05);
        k++;
      }
    }
    out[c] = col;
  }
  return out;
}
