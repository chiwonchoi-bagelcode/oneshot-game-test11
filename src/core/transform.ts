import { CHAR_TO_CODE, CODE_TO_CHAR, type LevelDef } from './sim.ts';

/**
 * Re-skins a level without changing its logic: optional horizontal / vertical mirror and a
 * permutation of the three primary inks. Used to give daily puzzles a fresh look.
 * perm maps R,Y,B (in that order) to new primaries, e.g. ['B','R','Y'].
 */
export function transformLevel(def: LevelDef, opts: { flipX?: boolean; flipY?: boolean; perm?: [string, string, string] }, id?: string): LevelDef {
  const perm = opts.perm || ['R', 'Y', 'B'];
  const bit: Record<number, number> = { 1: CHAR_TO_CODE[perm[0]], 2: CHAR_TO_CODE[perm[1]], 4: CHAR_TO_CODE[perm[2]] };
  const mapCode = (code: number) => (code & 1 ? bit[1] : 0) | (code & 2 ? bit[2] : 0) | (code & 4 ? bit[4] : 0);
  const mapUpper = (ch: string) => {
    const code = CHAR_TO_CODE[ch];
    return code ? CODE_TO_CHAR[mapCode(code)] : ch;
  };
  const terrain = (ch: string) => {
    if (ch === 'r' || ch === 'y' || ch === 'b') return mapUpper(ch.toUpperCase()).toLowerCase();
    if (ch === 'R' || ch === 'Y' || ch === 'B') return mapUpper(ch);
    return ch;
  };
  const goalCh = (ch: string) => (ch === '.' || ch === 'w' ? ch : mapUpper(ch));
  const h = def.map.length, w = def.map[0].length;
  const fx = (x: number) => (opts.flipX ? w - 1 - x : x);
  const fy = (y: number) => (opts.flipY ? h - 1 - y : y);
  const remap = (rows: string[], f: (ch: string) => string) => {
    const out: string[] = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += f(rows[fy(y)][fx(x)]);
      out.push(r);
    }
    return out;
  };
  const fp = (p: { x: number; y: number }) => ({ x: fx(p.x), y: fy(p.y) });
  const out: LevelDef = {
    ...def,
    id: id || def.id,
    map: remap(def.map, terrain),
    goal: remap(def.goal, goalCh),
    inks: def.inks.map((s) => mapUpper(s[0]) + s.slice(1)),
    solution: def.solution.map((d) => {
      const o: typeof d = { ...d, x: fx(d.x), y: fy(d.y) };
      if (d.c) o.c = mapCode(d.c);
      return o;
    }),
  };
  if (def.wells) out.wells = def.wells.map((w) => ({ ...fp(w), ink: mapUpper(w.ink[0]) + w.ink.slice(1) }));
  if (def.regions) out.regions = remap(def.regions, (ch) => ch);
  if (def.strokes) out.strokes = def.strokes.map((st) => st.map(fp));
  return out;
}
