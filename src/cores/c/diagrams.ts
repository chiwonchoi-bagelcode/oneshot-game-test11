// Core C rule-card diagrams: tiny colouring-page parts filling up (outlined regions).
import { registerDiagram, type CellInk, type TimelineBoard } from '../../ui/rule-diagrams.ts';

type Cells = (CellInk | CellInk[] | null)[];

/** Flood one part: drop at `start`, then one ring per beat (BFS over cells of letter `key`). */
function flood(outline: string[], key: string, start: [number, number], c: number, t0: number, cells: Cells, mix = false): number {
  const w = outline[0].length, h = outline.length;
  const at = (x: number, y: number) => y * w + x;
  const dist = new Map<number, number>([[at(start[0], start[1]), 0]]);
  const q = [start];
  let maxD = 0;
  while (q.length) {
    const [x, y] = q.shift()!;
    const d = dist.get(at(x, y))!;
    maxD = Math.max(maxD, d);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || outline[ny][nx] !== key || dist.has(at(nx, ny))) continue;
      dist.set(at(nx, ny), d + 1);
      q.push([nx, ny]);
    }
  }
  for (const [i, d] of dist) {
    const ink: CellInk = { t: t0 + d * 0.5, c, kind: d === 0 ? (mix ? 'mix' : 'drop') : mix ? 'mix' : 'spread' };
    const prev = cells[i];
    cells[i] = prev ? (Array.isArray(prev) ? [...prev, ink] : [prev, ink]) : ink;
  }
  return t0 + maxD * 0.5;
}

function board(outline: string[], goal?: string[]): { b: TimelineBoard; cells: Cells } {
  const cells: Cells = new Array(outline.length * outline[0].length).fill(null);
  const map = outline.map((r) => r.replace(/[^ ]/g, '.'));
  return { b: { map, goal, cells, outline }, cells };
}

registerDiagram('c_pour', () => {
  const o = ['aaab', 'aaab', 'aabb'];
  const { b, cells } = board(['aaa.bb', 'aaa.bb', 'aa..bb']);
  void o;
  const t = flood(b.outline!, 'a', [1, 1], 1, 0, cells);
  flood(b.outline!, 'b', [4, 1], 2, t + 1, cells);
  return { boards: [b] };
});

registerDiagram('c_mix', () => {
  const { b, cells } = board(['aaaaa', 'aaaaa']);
  const t = flood(b.outline!, 'a', [1, 0], 1, 0, cells);
  flood(b.outline!, 'a', [3, 1], 3, t + 1, cells, true);
  return { boards: [b] };
});

registerDiagram('c_white', () => {
  const { b, cells } = board(['aaaaa', 'awaaa', 'aaawa'], ['.....', '.w...', '...w.']);
  flood(b.outline!, 'a', [2, 1], 1, 0, cells);
  return { boards: [b], check: true };
});

registerDiagram('c_brown', () => {
  const { b, cells } = board(['aaaa', 'aaaa']);
  let t = flood(b.outline!, 'a', [0, 0], 1, 0, cells);
  t = flood(b.outline!, 'a', [3, 1], 3, t + 0.8, cells, true);
  flood(b.outline!, 'a', [1, 1], 7, t + 0.8, cells, true);
  return { boards: [b] };
});

registerDiagram('c_limit', () => {
  const { b, cells } = board(['aa.bb', 'aa.bb']);
  // A numbered drop: the red runs out after one part.
  const t = flood(b.outline!, 'a', [0, 0], 1, 0, cells);
  (cells[0] as CellInk).range = 1;
  flood(b.outline!, 'b', [4, 1], 4, t + 1, cells);
  (cells[9] as CellInk).range = 1;
  return { boards: [b] };
});

registerDiagram('c_link', () => {
  const { b, cells } = board(['aa..aa', 'aa..aa', '.bbbb.']);
  flood(b.outline!.map((r) => r.slice(0, 3) + '...'), 'a', [0, 0], 6, 0, cells);
  flood(b.outline!.map((r) => '...' + r.slice(3)), 'a', [4, 0], 6, 0, cells);
  return { boards: [b] };
});

registerDiagram('c_secret', () => {
  const { b, cells } = board(['aaaaaa', 'aaaaaa']);
  const t = flood(b.outline!, 'a', [0, 0], 1, 0, cells);
  flood(b.outline!, 'a', [5, 1], 5, t + 1, cells, true);
  return { boards: [b] };
});
