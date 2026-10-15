/*
 * Core B rule-card diagrams (pure data, Node-safe): strokes drawn cell by cell on tiny boards.
 * core.ts registers them with the shared rule-diagram renderer.
 */
import type { TimelineBoard, CellInk } from '../../ui/rule-diagrams.ts';

type Ink = CellInk | CellInk[] | null;

/** Builds a board from a map and strokes: [colour bit, cells as [x,y], start time]. */
function board(map: string[], strokes: [number, [number, number][], number][], goal?: string[]): TimelineBoard {
  const w = map[0].length, h = map.length;
  const cells: Ink[] = new Array(w * h).fill(null);
  const bits = new Array(w * h).fill(0);
  const push = (i: number, k: CellInk) => {
    const cur = cells[i];
    cells[i] = cur ? (Array.isArray(cur) ? [...cur, k] : [cur, k]) : k;
  };
  for (const [c, path, t0] of strokes) {
    path.forEach(([x, y], j) => {
      const i = y * w + x;
      const had = bits[i];
      bits[i] |= c;
      const mixed = had && had !== bits[i];
      push(i, { t: t0 + j, c: bits[i], kind: j === 0 ? 'seed' : mixed ? 'mix' : 'spread' });
    });
  }
  return { map, goal, cells };
}

const R = 1, Y = 2, B = 4;

export const DIAGRAMS: Record<string, () => { boards: TimelineBoard[]; check?: boolean }> = {
  // One stroke from the drop.
  b_draw: () => ({ boards: [board(['r....'], [[R, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 0]])] }),
  // Paint every cell in one stroke that never crosses itself.
  b_fill: () => ({
    boards: [board(['r..', '...', '...'], [[R, [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]], 0]])],
  }),
  // Yellow and blue cross: the shared cell turns green.
  b_mix: () => ({
    boards: [board(['  y  ', 'b....', '  .  '], [
      [Y, [[2, 0], [2, 1], [2, 2]], 0],
      [B, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], 3],
    ])],
  }),
  // Red crosses yellow (orange) and blue (purple).
  b_three: () => ({
    boards: [board([' y b ', 'r....', ' . . '], [
      [Y, [[1, 0], [1, 1], [1, 2]], 0],
      [B, [[3, 0], [3, 1], [3, 2]], 0],
      [R, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], 3],
    ])],
  }),
  // Two drops of one colour share the work.
  b_twin: () => ({
    boards: [board(['b.....b'], [
      [B, [[0, 0], [1, 0], [2, 0], [3, 0]], 0],
      [B, [[6, 0], [5, 0], [4, 0]], 0],
    ])],
  }),
  // Stones can't be painted: strokes go around them.
  b_stone: () => ({
    boards: [board(['..#..', 'y....'], [[Y, [[0, 1], [0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 0], [4, 0], [4, 1]], 0]])],
  }),
};
