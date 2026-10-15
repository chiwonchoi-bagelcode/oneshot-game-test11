/*
 * Core A rule-card diagrams. Each one is played through the same reach() the game uses: every
 * covered cell shows its ink one ring after the other, and a later ink flowing over an earlier
 * one shows the mixed colour on the overlap.
 */
import { registerDiagram, type TimelineBoard, type CellInk } from '../../ui/rule-diagrams.ts';
import { parseLevel, CHAR_TO_CODE } from '../../core/sim.ts';
import { reach } from './rules.ts';

interface D { x: number; y: number; ink: string; t: number }

function board(map: string[], drops: D[], goal?: string[]): TimelineBoard {
  const w = map[0].length;
  const L = parseLevel({ id: 'a-diagram', map, goal: goal || map.map((r) => '.'.repeat(r.length)), inks: drops.map((d) => d.ink), solution: [], mud: true });
  const cells: CellInk[][] = map.flatMap((r) => r.split('').map(() => [] as CellInk[]));
  const color = new Uint8Array(L.w * L.h);
  // Events in time order so mixes know what was there before.
  const ev: { t: number; idx: number; c: number; drop: boolean; range: number }[] = [];
  for (const d of drops) {
    const c = CHAR_TO_CODE[d.ink[0]], range = parseInt(d.ink.slice(1), 10);
    const r = reach(L, d.y * w + d.x, range);
    r.cells.forEach((i, q) => ev.push({ t: d.t + r.dist[q], idx: i, c, drop: q === 0, range }));
  }
  ev.sort((a, b) => a.t - b.t);
  for (const e of ev) {
    const had = color[e.idx], now = had | e.c;
    color[e.idx] = now;
    if (e.drop) cells[e.idx].push({ t: e.t, c: now, kind: 'drop', range: e.range });
    else if (now !== had) cells[e.idx].push({ t: e.t, c: now, kind: had ? 'mix' : 'spread' });
  }
  return { map, goal, cells: cells.map((l) => (l.length ? l : null)) };
}

registerDiagram('a_drop', () => ({
  boards: [board(['.......', '.......', '.......'], [{ x: 3, y: 1, ink: 'B2', t: 0 }])],
}));

registerDiagram('a_amount', () => ({
  boards: [board(['.........', '.........', '.........'], [{ x: 1, y: 1, ink: 'R1', t: 0 }, { x: 6, y: 1, ink: 'Y2', t: 2 }])],
}));

registerDiagram('a_mix', () => ({
  boards: [board(['........', '........', '........'], [{ x: 2, y: 1, ink: 'Y2', t: 0 }, { x: 5, y: 1, ink: 'B2', t: 3 }])],
}));

registerDiagram('a_walls', () => ({
  boards: [board(['...#...', '...#...', '.......'], [{ x: 1, y: 0, ink: 'B4', t: 0 }])],
}));

registerDiagram('a_clean', () => ({
  check: true,
  boards: [board(['........', '........', '........'], [{ x: 2, y: 1, ink: 'R2', t: 0 }], ['.....w..', '......w.', '.....w..'])],
}));

registerDiagram('a_three', () => ({
  boards: [board(['.........', '.........', '.........'], [{ x: 1, y: 1, ink: 'R2', t: 0 }, { x: 4, y: 1, ink: 'Y2', t: 2 }, { x: 7, y: 1, ink: 'B2', t: 4 }])],
}));
