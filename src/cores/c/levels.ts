// Core C (colouring book): the 30 pictures, tutorial included.
//
// Each picture is drawn with region letters ('.' = plain paper, ' ' = outside the page) and a
// legend (letter → R Y B O P G K, or w = stays white). The same letter in two places is a linked
// region (one pour colours every part). Solutions are derived from the legend: one pour per
// primary in each colour region (R, then Y, then B), at the region's label cell.
import type { Drop, MechanicKey } from '../../core/sim.ts';
import { analyse, bitsOf, type CLevel, type Deco } from './picture.ts';

interface Spec {
  id: string;
  pic: string;
  rows: string[];
  paint: Record<string, string>;
  intro?: MechanicKey;
  guided?: boolean;
  coach?: string;
  tag?: 'light' | 'think' | 'discovery' | 'boss';
  /** Limited drops: exactly what the picture needs (+ spare primaries). */
  limit?: boolean;
  spare?: string;
  secret?: string;
  /** Letters that are meant to be linked (several separate parts). */
  links?: string;
  deco?: Deco[];
  /** Region letters in solution order (default: reading order of their label cells). */
  order?: string;
}

function stage(s: Spec): CLevel {
  const h = s.rows.length, w = s.rows[0].length;
  const map: string[] = [], goal: string[] = [], regions: string[] = [];
  let mud = false;
  for (let y = 0; y < h; y++) {
    const row = s.rows[y];
    if (row.length !== w) throw new Error(s.id + ': row ' + y + ' has length ' + row.length);
    let m = '', g = '', r = '';
    for (const ch of row) {
      if (ch === ' ') { m += ' '; g += '.'; r += '.'; continue; }
      m += '.';
      r += ch;
      if (ch === '.') { g += '.'; continue; }
      const p = s.paint[ch];
      if (p === undefined) throw new Error(s.id + ': no paint for ' + ch);
      if (p === 'K') mud = true;
      g += p === 'w' || (s.secret || '').includes(ch) ? '.' : p;
    }
    map.push(m); goal.push(g); regions.push(r);
  }
  const def: CLevel = {
    id: s.id,
    map,
    goal,
    regions,
    inks: [],
    solution: [],
    paint: s.paint,
    pic: s.pic,
  };
  if (mud) def.mud = true;
  if (s.secret) def.secret = s.secret;
  if (s.deco) def.deco = s.deco;
  if (s.intro) def.intro = s.intro;
  if (s.guided) def.guided = true;
  if (s.coach) def.coach = s.coach;
  if (s.tag) def.tag = s.tag;
  const pic = analyse(def);
  let regs = pic.colourRegions.slice().sort((a, b) => pic.regions[a].labels[0] - pic.regions[b].labels[0]);
  if (s.order) regs = s.order.split('').map((k) => pic.regions.findIndex((r) => r.key === k)).concat(regs.filter((r) => !s.order!.includes(pic.regions[r].key)));
  const sol: Drop[] = [];
  for (const r of regs) {
    const R = pic.regions[r];
    const at = R.labels[0];
    for (const c of bitsOf(R.goal)) sol.push({ x: at % w, y: Math.floor(at / w), t: 0, c });
  }
  def.solution = sol;
  if (s.limit) {
    const inks = sol.map((d) => ({ 1: 'R', 2: 'Y', 4: 'B' } as Record<number, string>)[d.c!]);
    for (const ch of s.spare || '') inks.push(ch);
    def.inks = inks.sort((a, b) => 'RYB'.indexOf(a) - 'RYB'.indexOf(b));
  }
  (def as CLevel & { links?: string }).links = s.links || '';
  return def;
}

const rays = (cx: number, cy: number, r0: number, r1: number, angles: number[]): Deco[] =>
  angles.map((a) => {
    const t = (a * Math.PI) / 180;
    return { l: [cx + Math.cos(t) * r0, cy + Math.sin(t) * r0, cx + Math.cos(t) * r1, cy + Math.sin(t) * r1] };
  });

export const LEVELS: CLevel[] = [
  // ---------------------------------------------------------------- 1–4: pour and watch it fill
  stage({
    id: 'c01', pic: 'balloon', intro: 'c_pour', guided: true, tag: 'discovery', coach: 'c.coach.c01',
    rows: [
      '.aaa.',
      'aaaaa',
      'aaaaa',
      'aaaaa',
      '.aaa.',
      '..a..',
      '.....',
    ],
    paint: { a: 'R' },
    deco: [{ l: [2.5, 6, 2.25, 6.35, 2.7, 6.65, 2.4, 6.95] }],
  }),
  stage({
    id: 'c02', pic: 'sunrise', guided: true, tag: 'light', coach: 'c.coach.c02',
    rows: [
      '......',
      '..aa..',
      '.aaaa.',
      '.aaaa.',
      '..aa..',
      'bbbbbb',
      'bbbbbb',
    ],
    paint: { a: 'Y', b: 'B' },
    deco: [
      ...rays(3, 3, 2.25, 2.85, [180, 215, 250, 270, 290, 325, 0]),
      { l: [0.6, 6.0, 1.0, 5.8, 1.4, 6.0] }, { l: [3.4, 6.4, 3.8, 6.2, 4.2, 6.4] },
    ],
  }),
  stage({
    id: 'c03', pic: 'sailboat', tag: 'light', coach: 'c.coach.c03',
    rows: [
      '...a...',
      '...aa..',
      '...aaa.',
      '...aaaa',
      'bbbbbbb',
      '.bbbbb.',
      'ccccccc',
    ],
    paint: { a: 'Y', b: 'R', c: 'B' },
    deco: [{ l: [3, 0, 3, 4] }, { l: [3, 0.05, 2.35, 0.3, 3, 0.55] }],
  }),
  stage({
    id: 'c04', pic: 'house', tag: 'light',
    rows: [
      '...a.e.',
      '..aaae.',
      '.aaaaa.',
      'aaaaaaa',
      '.bbbbb.',
      '.bdbcb.',
      '.bbbcb.',
    ],
    paint: { a: 'R', b: 'Y', c: 'R', d: 'B', e: 'B' },
    deco: [{ l: [5.5, 0, 5.8, -0.3] }, { d: [4.75, 6.05, 0.07] }],
  }),
  // ---------------------------------------------------------------- 5–9: mixing
  stage({
    id: 'c05', pic: 'goldfish', intro: 'c_mix', guided: true, tag: 'discovery', coach: 'c.coach.c05',
    rows: [
      '..aaa..b',
      '.aaaaabb',
      'aaaaaabb',
      '.aaaaabb',
      '..aaa..b',
    ],
    paint: { a: 'O', b: 'Y' },
    deco: [{ d: [1.75, 1.8, 0.16] }, { o: [0.45, 0.7, 0.2] }, { o: [0.8, 0.25, 0.13] }, { l: [3.7, 1.2, 4.1, 2.5, 3.7, 3.8] }],
  }),
  stage({
    id: 'c06', pic: 'cactus', tag: 'discovery', coach: 'c.coach.c06',
    rows: [
      '..cc..',
      '..aa..',
      'a.aa..',
      'a.aa.a',
      'aaaa.a',
      '..aaaa',
      '.bbbb.',
      '.bbbb.',
    ],
    paint: { a: 'G', b: 'O', c: 'R' },
    deco: [{ l: [2.4, 2.4, 2.25, 2.6] }, { l: [3.6, 3.2, 3.75, 3.4] }, { l: [2.4, 4.4, 2.25, 4.6] }, { l: [3.6, 5.5, 3.75, 5.3] }, { l: [1, 6.5, 5, 6.5] }],
  }),
  stage({
    id: 'c07', pic: 'grapes', tag: 'discovery', coach: 'c.coach.c07',
    rows: [
      '....bb',
      '...bbb',
      'aaaaa.',
      'aaaaaa',
      '.aaaaa',
      '.aaaa.',
      '..aaa.',
      '...a..',
    ],
    paint: { a: 'P', b: 'G' },
    deco: [
      { l: [2.6, 2, 2.9, 1.2, 3.3, 0.5] },
      { o: [1.0, 2.9, 0.42] }, { o: [2.5, 2.7, 0.42] }, { o: [3.9, 3.0, 0.42] }, { o: [1.8, 4.1, 0.42] }, { o: [3.3, 4.2, 0.42] }, { o: [4.8, 4.0, 0.42] }, { o: [2.5, 5.4, 0.42] }, { o: [3.9, 5.5, 0.42] }, { o: [3.2, 6.7, 0.42] },
      { l: [4.2, 1.6, 5.4, 0.6] },
    ],
  }),
  stage({
    id: 'c08', pic: 'butterfly', tag: 'think',
    rows: [
      'aaa..bbb',
      'aaaeebbb',
      'aaaeebbb',
      '.cceedd.',
      'ccceeddd',
      'ccc..ddd',
    ],
    paint: { a: 'O', b: 'O', c: 'P', d: 'P', e: 'B' },
    deco: [{ l: [3.6, 1, 3.2, 0.4, 2.7, 0.15] }, { l: [4.4, 1, 4.8, 0.4, 5.3, 0.15] }, { d: [2.7, 0.15, 0.1] }, { d: [5.3, 0.15, 0.1] }],
  }),
  stage({
    id: 'c09', pic: 'kite', tag: 'think', coach: 'c.coach.c09',
    rows: [
      '...ab...',
      '..aabb..',
      '.aaabbb.',
      'ccccdddd',
      '.cccddd.',
      '..ccdd..',
      '...cd...',
      '........',
      '....e...',
      '......f.',
    ],
    paint: { a: 'R', b: 'Y', c: 'B', d: 'G', e: 'O', f: 'P' },
    deco: [{ l: [4, 7, 4.3, 7.6, 4.5, 8.5, 5.4, 8.9, 6.4, 9.5, 7.6, 9.9] }],
  }),
  // ---------------------------------------------------------------- 10–11: leave it white
  stage({
    id: 'c10', pic: 'mushroom', intro: 'c_white', tag: 'discovery',
    rows: [
      '..aaaa..',
      '.aasaaa.',
      'aaaaaata',
      'auaaaaaa',
      '...vv...',
      '...vv...',
      '..vvvv..',
      'gggggggg',
    ],
    paint: { a: 'R', s: 'w', t: 'w', u: 'w', v: 'w', g: 'G' },
    deco: [{ l: [0.6, 7, 0.8, 6.6] }, { l: [1.6, 7, 1.4, 6.5] }, { l: [6.5, 7, 6.7, 6.5] }, { l: [7.3, 7, 7.2, 6.7] }],
  }),
  stage({
    id: 'c11', pic: 'snowman', tag: 'think', coach: 'c.coach.c11',
    rows: [
      'aaaaaaaa',
      'aaappaaa',
      'aappppaa',
      'aahhhhaa',
      'aahhnhaa',
      'aasssssa',
      'aaooooaa',
      'aooooooa',
      'aooooooa',
      'gggggggg',
    ],
    paint: { a: 'B', p: 'P', h: 'w', n: 'O', s: 'R', o: 'w', g: 'w' },
    deco: [
      { d: [3.2, 3.55, 0.12] }, { d: [4.7, 3.55, 0.12] },
      { d: [4, 6.6, 0.11] }, { d: [4, 7.5, 0.11] }, { d: [4, 8.4, 0.11] },
      { l: [1.2, 7.2, 0.6, 6.5, 0.2, 6.2] }, { l: [6.8, 7.2, 7.4, 6.5, 7.8, 6.2] },
    ],
  }),
  // ---------------------------------------------------------------- 12–13: brown from all three
  stage({
    id: 'c12', pic: 'tree', intro: 'c_brown', tag: 'discovery', coach: 'c.coach.c12',
    rows: [
      '..aaaa..',
      '.aaaaaa.',
      'aabaaaaa',
      'aaaaacaa',
      'aaaaaaaa',
      '.aaaaaa.',
      '...tt...',
      '...tt...',
      '..tttt..',
      'gggggggg',
    ],
    paint: { a: 'G', b: 'R', c: 'R', t: 'K', g: 'G' },
    order: 'tabcg',
  }),
  stage({
    id: 'c13', pic: 'gingerbread', tag: 'light',
    rows: [
      '..aaa..',
      '.aaaaa.',
      '.aaaaa.',
      '..aaa..',
      'aaabaaa',
      '..aca..',
      '..ada..',
      '.aa.aa.',
      'aa...aa',
    ],
    paint: { a: 'K', b: 'R', c: 'G', d: 'Y' },
    deco: [
      { d: [2.6, 1.45, 0.13] }, { d: [4.4, 1.45, 0.13] }, { l: [2.7, 2.2, 3.5, 2.55, 4.3, 2.2] },
      { l: [0.55, 4.15, 0.55, 4.85] }, { l: [6.45, 4.15, 6.45, 4.85] }, { l: [0.3, 8.6, 1.4, 8.3] }, { l: [5.6, 8.3, 6.7, 8.6] },
    ],
  }),
  // ---------------------------------------------------------------- 14–15: counted drops
  stage({
    id: 'c14', pic: 'teacup', intro: 'c_limit', tag: 'discovery', limit: true,
    rows: [
      '........',
      'atttta..',
      'aaaaaaa.',
      'aahaaa.a',
      'aaaaaaaa',
      '.aaaa...',
      'ssssssss',
      '.ssssss.',
    ],
    paint: { a: 'B', t: 'K', h: 'R', s: 'Y' },
    deco: [{ l: [2, 0.95, 1.75, 0.6, 2.15, 0.3, 1.9, 0.02] }, { l: [3.3, 0.95, 3.05, 0.6, 3.45, 0.3, 3.2, 0.02] }],
  }),
  stage({
    id: 'c15', pic: 'icecream', tag: 'think', limit: true,
    rows: [
      '...c..',
      '.aaaa.',
      'aaaaaa',
      'bbbbbb',
      'bbbbbb',
      'dddddd',
      '.dddd.',
      '.dddd.',
      '..dd..',
      '..dd..',
    ],
    paint: { a: 'P', b: 'G', c: 'R', d: 'O' },
    deco: [{ l: [3.5, 0.2, 3.9, -0.1] }, { l: [1.3, 5.2, 2.9, 9.7] }, { l: [4.7, 5.2, 3.1, 9.7] }, { l: [3, 5.15, 1.7, 6.9] }, { l: [3, 5.15, 4.3, 6.9] }],
  }),
  // ---------------------------------------------------------------- 16–19: linked parts
  stage({
    id: 'c16', pic: 'cat', intro: 'c_link', tag: 'discovery', links: 'be', coach: 'c.coach.c16',
    rows: [
      'b......b',
      'bb....bb',
      'aaaaaaaa',
      'aaeaaeaa',
      'aaaaaaaa',
      'aaannaaa',
      '.aaaaaa.',
      '..aaaa..',
    ],
    paint: { a: 'O', b: 'R', e: 'G', n: 'P' },
    order: 'eabn',
    deco: [
      { l: [3.5, 6, 3.1, 6.35, 2.7, 6.2] }, { l: [4.5, 6, 4.9, 6.35, 5.3, 6.2] }, { l: [4, 6, 4, 5.9] },
      { l: [2.6, 5.3, 0.4, 5.0] }, { l: [2.6, 5.7, 0.5, 6.0] }, { l: [5.4, 5.3, 7.6, 5.0] }, { l: [5.4, 5.7, 7.5, 6.0] },
    ],
  }),
  stage({
    id: 'c17', pic: 'ladybug', tag: 'think', links: 's',
    rows: [
      '...hh...',
      '..hhhh..',
      '.aaaaaa.',
      'aasaasaa',
      'aaaaaaaa',
      'asaaaasa',
      'aaaaaaaa',
      '.aaasaa.',
      '..aaaa..',
      'gggggggg',
    ],
    paint: { h: 'B', a: 'R', s: 'K', g: 'G' },
    deco: [{ l: [4, 2, 4, 9] }, { l: [3.5, 0.3, 3.2, 0.1] }, { l: [4.5, 0.3, 4.8, 0.1] }],
  }),
  stage({
    id: 'c18', pic: 'tulips', tag: 'think', limit: true, links: 'fl', coach: 'c.coach.c18',
    rows: [
      'ff.ff.ff',
      'ff.ff.ff',
      '........',
      '........',
      '.l....l.',
      '........',
      '..vvvv..',
      '..vwvv..',
      '..vvvv..',
      '...vv...',
    ],
    paint: { f: 'P', l: 'G', v: 'B', w: 'w' },
    deco: [{ l: [1, 2, 1.6, 4, 2.9, 6] }, { l: [4, 2, 4, 6] }, { l: [7, 2, 6.4, 4, 5.1, 6] }, { l: [1, 0, 1, 0.6] }, { l: [4, 0, 4, 0.6] }, { l: [7, 0, 7, 0.6] }],
  }),
  stage({
    id: 'c19', pic: 'lighthouse', tag: 'think', links: 'rw',
    rows: [
      '...oo...',
      '..llll..',
      '..rrrr..',
      '..wwww..',
      '..rrrr..',
      '.wwwwww.',
      '.rrrrrr.',
      'kkkkkkkk',
      'ssssssss',
      'ssssssss',
    ],
    paint: { o: 'P', l: 'Y', r: 'R', w: 'w', k: 'K', s: 'B' },
    deco: [{ l: [2, 1.3, 0.2, 0.6] }, { l: [2, 1.7, 0.2, 2.4] }, { l: [6, 1.3, 7.8, 0.6] }, { l: [6, 1.7, 7.8, 2.4] }, { l: [1, 8.6, 1.5, 8.4, 2, 8.6] }, { l: [5, 9.3, 5.5, 9.1, 6, 9.3] }],
  }),
  // ---------------------------------------------------------------- 20–24: everything together
  stage({
    id: 'c20', pic: 'owl', tag: 'think', links: 'p',
    rows: [
      'a......a',
      'aa....aa',
      'aaaaaaaa',
      'awwaawwa',
      'awpaapwa',
      'aaabbaaa',
      '.acccca.',
      '.acccca.',
      '.aaaaaa.',
      'kkkkkkkk',
    ],
    paint: { a: 'K', w: 'w', p: 'B', b: 'O', c: 'Y', k: 'G' },
    deco: [{ l: [2.5, 6.6, 3, 6.9, 3.5, 6.6] }, { l: [3.5, 7.4, 4, 7.7, 4.5, 7.4] }, { l: [4.5, 6.6, 5, 6.9, 5.5, 6.6] }, { l: [2.6, 9, 2.6, 8.7] }, { l: [5.4, 9, 5.4, 8.7] }],
  }),
  stage({
    id: 'c21', pic: 'aquarium', tag: 'think', links: 'fg', limit: true,
    rows: [
      'aaaaaaaa',
      'afffaaaa',
      'aaaaaaaa',
      'gaaaafff',
      'gaaaaaag',
      'ggaaaagg',
      'yyyyyyyy',
    ],
    paint: { a: 'B', f: 'O', g: 'G', y: 'Y' },
    deco: [{ d: [1.5, 1.45, 0.1] }, { d: [5.5, 3.45, 0.1] }, { l: [3, 1, 3, 2] }, { l: [7, 3, 7, 4] }, { o: [4.2, 1.4, 0.18] }, { o: [4.6, 0.7, 0.13] }, { o: [4.5, 2.6, 0.15] }],
  }),
  stage({
    id: 'c22', pic: 'airballoon', tag: 'think', links: 'ac', limit: true,
    rows: [
      '..abba..',
      '.cabbac.',
      'ccabbacc',
      'ccabbacc',
      '.cabbac.',
      '..abba..',
      '...bb...',
      '........',
      '..kkkk..',
      '..kkkk..',
    ],
    paint: { a: 'O', b: 'Y', c: 'P', k: 'K' },
    deco: [{ l: [3, 7, 2.3, 8] }, { l: [5, 7, 5.7, 8] }, { l: [3.4, 7, 3.2, 8] }, { l: [4.6, 7, 4.8, 8] }],
  }),
  stage({
    id: 'c23', pic: 'lanterns', tag: 'think', links: 'lgt', coach: 'c.coach.c23',
    rows: [
      'aaaaaaam',
      'asaaaamm',
      'atttaaam',
      'alglaaaa',
      'alllttta',
      'atttlgla',
      'aaaallla',
      'asaattta',
      'aaaaaaaa',
      'rrrrrrrr',
    ],
    paint: { a: 'P', m: 'Y', s: 'w', t: 'K', l: 'R', g: 'Y', r: 'B' },
    deco: [{ l: [2.5, 0, 2.5, 2] }, { l: [5.5, 0, 5.5, 4] }, { l: [1, 9.4, 1.5, 9.2, 2, 9.4] }, { l: [5, 9.6, 5.5, 9.4, 6, 9.6] }],
  }),
  stage({
    id: 'c24', pic: 'train', tag: 'think', links: 'k', limit: true,
    rows: [
      'ww......',
      '.ww.....',
      '..c..ddd',
      '..c..dxd',
      'rrrrrddd',
      'rrrrrddd',
      '.kk..kk.',
      'oooooooo',
    ],
    paint: { w: 'w', c: 'K', d: 'G', x: 'w', r: 'R', k: 'K', o: 'O' },
    deco: [{ l: [0.4, 6.5, 7.6, 6.5] }],
  }),
  stage({
    id: 'c25', pic: 'sunset', intro: 'c_secret', tag: 'discovery', limit: true, secret: 'a',
    rows: [
      'aaaaaaaa',
      'aaaaaaaa',
      'aaaaaaaa',
      'aaabbaaa',
      'aabbbbaa',
      'ssssssss',
      'sssskkss',
      'ssssssss',
    ],
    paint: { a: 'O', b: 'Y', s: 'B', k: 'K' },
    deco: [{ l: [4.5, 6, 4.5, 4.6] }, { l: [4.6, 4.7, 5.3, 5.6, 4.6, 5.8] }, { l: [1, 7.3, 1.5, 7.1, 2, 7.3] }],
  }),
  stage({
    id: 'c26', pic: 'village', tag: 'think', limit: true, secret: 'a', links: 'ry',
    rows: [
      'aaaaaamm',
      'asaaaaam',
      'aaaaasaa',
      'arraaaaa',
      'rrrrarra',
      'oyoorrrr',
      'ooooqyqq',
      'oodoqqqq',
      'gggggggg',
    ],
    paint: { a: 'P', s: 'w', m: 'Y', r: 'R', o: 'O', q: 'B', y: 'Y', d: 'K', g: 'G' },
    deco: [{ d: [2.75, 7.5, 0.08] }],
  }),
  stage({
    id: 'c27', pic: 'parrot', tag: 'think', limit: true,
    rows: [
      '..rrr...',
      '.rrrryy.',
      '.rerry..',
      '.rrrr...',
      '..gggb..',
      '.ggggbb.',
      '.gggbbb.',
      '..ggbb..',
      'kkkkkkkk',
      '...tt...',
    ],
    paint: { r: 'R', y: 'Y', e: 'w', g: 'G', b: 'B', k: 'K', t: 'O' },
    deco: [{ d: [2.55, 2.5, 0.13] }, { l: [3, 8, 3, 7.6] }, { l: [4.5, 8, 4.5, 7.6] }],
  }),
  stage({
    id: 'c28', pic: 'koi', tag: 'think', limit: true, links: 'lf', secret: 'p',
    rows: [
      'aaaaaaaa',
      'allaaaaa',
      'allaaffa',
      'aaaaaafa',
      'afaapaaa',
      'affpppaa',
      'aaaapall',
      'aaaaaall',
    ],
    paint: { a: 'B', l: 'G', f: 'O', p: 'P' },
  }),
  stage({
    id: 'c29', pic: 'autumn', tag: 'think', limit: true, secret: 'a',
    rows: [
      '..aaaa..',
      '.aaaaba.',
      'aaaaaaaa',
      'acaaaaaa',
      '.aaaaa..',
      '...tt...',
      '...tt...',
      '..tttt.b',
      'gggggggg',
    ],
    paint: { a: 'O', b: 'R', c: 'R', t: 'K', g: 'G' },
    links: 'b',
  }),
  stage({
    id: 'c30', pic: 'dawnpond', tag: 'boss', limit: true, secret: 'a', links: 'lpk',
    rows: [
      'aaaaaaaa',
      'aaassaaa',
      'aassssaa',
      'hhhhhhhh',
      'wwwwwwww',
      'wllwwpww',
      'wllwpppw',
      'kwwwwwwk',
      'kwppwllk',
      'kwwwwllk',
    ],
    paint: { a: 'O', s: 'Y', h: 'G', w: 'B', l: 'G', p: 'P', k: 'K' },
  }),
];
