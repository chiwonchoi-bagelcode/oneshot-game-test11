/*
 * Candidate factory used by gen-levels.ts (reverse design):
 *   terrain (shaped mask + symmetric walls + features) -> ink queue -> random solution under the
 *   input model -> simulate -> pick goal cells that make that solution (nearly) necessary, by
 *   set-cover against many alternative plays (random-bot plays, near-miss perturbations, all-t=0
 *   plays, greedy-bot wins) -> measure with fresh bots + exhaustive solver.
 */
import { WHITE, CODE_TO_CHAR, type LevelDef, type MechanicKey } from '../src/core/sim.ts';
import {
  FS, makeBoard, withGoal, play, randomTrial, greedyTrial, solve, analyzeSolution, usesOf, difficultyScore,
  mulberry32, planToDrops, t0Space, LIMITS, type Board, type Plan, type Rng, type SolutionInfo, type Metrics,
} from './level-lib.ts';

// ---------------------------------------------------------------------------------------------
// Silhouettes ('.' canvas, ' ' outside). Every row the same width.
// ---------------------------------------------------------------------------------------------

export const MASK_ART: Record<string, string[]> = {
  pad5: [' ... ', '.....', '.....', '.....', ' ... '],
  pad6: [' .... ', '......', '......', '......', '......', ' .... '],
  pad7: ['  ...  ', ' ..... ', '.......', '.......', '.......', ' ..... ', '  ...  '],
  lily6: [' .. . ', '......', '......', '......', ' .... ', '  ..  '],
  lily7: [' .. .. ', '.......', '.......', '.......', '.......', ' ..... ', '  ...  '],
  teacup: ['.......', '.......', '.......', ' ..... ', '  ...  ', ' ..... '],
  mountain: ['   .   ', '  ...  ', ' ..... ', '.......', '.......', '.......'],
  peaks8: [' .    . ', ' ..  .. ', '........', '........', '........', '........'],
  boat: ['   .   ', '   ..  ', '   ... ', '   .   ', '.......', ' ..... ', '  ...  '],
  lantern: ['  .  ', ' ... ', '.....', '.....', '.....', '.....', ' ... ', '  .  '],
  maple: ['   .   ', ' . . . ', ' ..... ', '.......', ' ..... ', '  ...  ', '   .   '],
  star: ['   .   ', '  ...  ', '.......', ' ..... ', '  ...  ', ' .. .. ', ' .   . '],
  heart: [' .. .. ', '.......', '.......', ' ..... ', '  ...  ', '   .   '],
  fish: ['  ...   ', ' ..... .', '........', ' ..... .', '  ...   '],
  bell: ['   .   ', '  ...  ', ' ..... ', ' ..... ', ' ..... ', '.......', '   .   '],
  gourd: ['  .  ', ' ... ', ' ... ', '  .  ', ' ... ', '.....', '.....', '.....', ' ... '],
  diamond: ['   .   ', '  ...  ', ' ..... ', '.......', ' ..... ', '  ...  ', '   .   '],
  flower: [' .. .. ', ' .. .. ', '.......', ' ..... ', '.......', ' .. .. ', ' .. .. '],
  house: ['   .   ', '  ...  ', ' ..... ', '.......', ' ..... ', ' ..... ', ' ..... ', ' ..... '],
  pagoda: ['   .   ', '  ...  ', '.......', '  ...  ', ' ..... ', '.......', '  ...  ', ' ..... ', '.......'],
  cloud: ['  .. .. ', ' .......', '........', '........', ' ...... '],
  fan: ['........', '........', ' ...... ', '  ....  ', '   ..   ', '   ..   '],
  umbrella: ['   .   ', ' ..... ', '.......', '.......', '   .   ', '   .   ', '   . . ', '   ... '],
  butterfly: ['..   ..', '... ...', '.......', '  ...  ', '.......', '... ...', '..   ..'],
  bottle: ['  .  ', '  .  ', ' ... ', '.....', '.....', '.....', '.....', '.....', ' ... '],
  kite: ['  .  ', ' ... ', '.....', '.....', ' ... ', '  .  ', '  .  ', '  .. '],
  leaf: ['   ...', '  ....', ' .....', '......', '......', '..... ', '....  ', '...   '],
  ginkgo: ['.......', '.......', ' ..... ', '  ...  ', '   .   ', '   .   '],
  tree: ['   .   ', '  ...  ', ' ..... ', '  ...  ', ' ..... ', '.......', '   .   ', '   .   '],
  vase: [' ... ', ' ... ', '  .  ', ' ... ', '.....', '.....', '.....', ' ... '],
  bowl: ['........', '........', ' ...... ', '  ....  ', '   ..   '],
  crown: ['. . . .', '.......', '.......', '.......', ' ..... '],
  pine: ['   .   ', '  ...  ', ' ..... ', '  ...  ', ' ..... ', '.......', '  ...  ', '  ...  '],
  moonpool: [' .... ', '......', '..  ..', '..  ..', '......', ' .... '],
  ring7: [' ..... ', '.......', '.. . ..', '.. . ..', '.......', ' ..... '],
  arch: ['.......', '.......', '.......', '..   ..', '..   ..', '..   ..'],
  tower: [' ... ', '.....', ' ... ', ' ... ', '.....', ' ... ', ' ... ', '.....', '.....'],
  shell: ['   ..   ', '  ....  ', ' ...... ', '........', '........', ' ...... ', '  ....  '],
  lotus8: ['   ..   ', ' . .. . ', ' ...... ', '........', '........', ' ...... ', '  ....  ', '   ..   '],
  bigpad: ['  ....  ', ' ...... ', '........', '........', '........', '........', ' ...... ', '  ....  '],
  bigbell: ['   ..   ', '  ....  ', '  ....  ', ' ...... ', ' ...... ', ' ...... ', '........', '........', '   ..   '],
  bigtree: ['   ..   ', '  ....  ', ' ...... ', '  ....  ', ' ...... ', '........', '  ....  ', '   ..   ', '   ..   ', '  ....  '],
  pagoda8: ['   ..   ', '  ....  ', '........', '  ....  ', ' ...... ', '........', '  ....  ', ' ...... ', '........'],
  bigstar: ['   ..   ', '   ..   ', '  ....  ', '........', ' ...... ', '  ....  ', ' ...... ', ' ..  .. ', ' .    . '],
  biglantern: ['   ..   ', '  ....  ', ' ...... ', '........', '........', '........', '........', ' ...... ', '  ....  ', '   ..   '],
  bigleaf: ['    ....', '   .....', '  ......', ' .......', '........', '........', '....... ', '......  ', '.....   ', '...     '],
  bigfish: ['   ...  ', '  ..... ', ' ......  ', '........', '........', ' ...... ', '  .....  ', '   ...  '].map((r) => (r + '        ').slice(0, 8)),
  bigvase: ['  ....  ', '  ....  ', '   ..   ', '  ....  ', ' ...... ', '........', '........', '........', ' ...... ', '  ....  '],
};

export interface Mask { name: string; rows: string[]; w: number; h: number; cells: number }

function procMasks(): Mask[] {
  const out: Mask[] = [];
  for (let w = 4; w <= 8; w++)
    for (let h = 4; h <= 10; h++) {
      if (h < w - 1) continue; // portrait-ish only
      const rect: string[] = [], round: string[] = [], oval: string[] = [], oct: string[] = [];
      for (let y = 0; y < h; y++) {
        let a = '', b = '', c = '', d = '';
        for (let x = 0; x < w; x++) {
          a += '.';
          const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
          b += corner ? ' ' : '.';
          const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
          c += dx * dx + dy * dy <= 1.08 ? '.' : ' ';
          const cx = Math.min(x, w - 1 - x), cy = Math.min(y, h - 1 - y);
          d += cx + cy >= 1 ? '.' : ' ';
        }
        rect.push(a);
        round.push(b);
        oval.push(c);
        oct.push(d);
      }
      out.push(mk('rect' + w + 'x' + h, rect));
      out.push(mk('round' + w + 'x' + h, round));
      if (w >= 5 && h >= 5) out.push(mk('oval' + w + 'x' + h, oval));
      if (w >= 6 && h >= 6) out.push(mk('oct' + w + 'x' + h, oct));
    }
  return out;
}

function mk(name: string, rows: string[]): Mask {
  const w = rows[0].length;
  for (const r of rows) if (r.length !== w) throw new Error('mask ' + name + ' ragged');
  let cells = 0;
  for (const r of rows) for (const ch of r) if (ch === '.') cells++;
  return { name, rows, w, h: rows.length, cells };
}

export const MASKS: Mask[] = [...Object.entries(MASK_ART).map(([k, v]) => mk(k, v)), ...procMasks()];

// ---------------------------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------------------------

export type Timing = 'none' | 'opt' | 'need';
export type TagKind = 'light' | 'normal' | 'think' | 'boss' | 'intro';

export interface Spec {
  key: string;
  /** Mechanics the level may use. */
  allowed: MechanicKey[];
  /** Mechanics the level must use. */
  require: MechanicKey[];
  timing: Timing;
  /** Timed drops in the designed solution [min, max]. */
  timed: [number, number];
  parity: 'forbid' | 'allow' | 'need';
  inks: [number, number];
  w: [number, number];
  h: [number, number];
  cells: [number, number];
  /** Preferred silhouettes (names or prefixes); empty = any. */
  shapes?: string[];
  /** Wall styles to draw from. */
  walls: string[];
  /** Only these primaries (e.g. ['Y','B']). */
  palette?: string[];
  tag: TagKind;
  minTargets: number;
  maxTargets: number;
  /** 0..1: how hard the goals try to pin down the exact solution (near-miss alternatives). */
  pin: number;
  /** Fraction of alternative plays allowed to survive the goal cover. */
  coverTol: number;
  minCoverage: number;
  minMixed: number;
  /** No two different inks may touch (before `mix`). */
  noCollide?: boolean;
  maxSettle: number;
  /** Random-bot success cap (measured). */
  maxRandom: number;
  /** Greedy-bot success cap (measured). */
  maxGreedy: number;
  /** Want three different secondaries among the targets. */
  threeSecondaries?: boolean;
  seeds?: [number, number];
  gates?: [number, number];
  slowCells?: [number, number];
  rangeP?: number;
  /** Rooms terrain: walls split the canvas into this many rooms; one drop per room. */
  rooms?: [number, number];
}

export interface Candidate {
  def: LevelDef;
  metrics: Metrics;
  uses: MechanicKey[];
  spec: string;
  info: { mixed: number; coverage: number; timed: number; parity: number };
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const ri = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const pick = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function grid(rows: string[]): string[][] {
  return rows.map((r) => r.split(''));
}
function rowsOf(g: string[][]): string[] {
  return g.map((r) => r.join(''));
}

const isPaperCh = (ch: string) => ch === '.' || ch === '~';
const passable = (ch: string) => ch !== '#' && ch !== ' ';

/** Connected components of passable cells (gates and seeds count as passable). */
function components(g: string[][]): number[][] {
  const h = g.length, w = g[0].length;
  const seen = new Uint8Array(w * h);
  const comps: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    const x0 = i % w, y0 = (i - x0) / w;
    if (seen[i] || !passable(g[y0][x0])) continue;
    const comp: number[] = [];
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || !passable(g[ny][nx])) continue;
        seen[j] = 1;
        st.push(j);
      }
    }
    comps.push(comp);
  }
  return comps;
}

function isSymX(g: string[][]): boolean {
  const w = g[0].length;
  for (const r of g) for (let x = 0; x < w; x++) if ((r[x] === ' ') !== (r[w - 1 - x] === ' ')) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------

function fittingMasks(spec: Spec): Mask[] {
  const ms = MASKS.filter((m) => m.w >= spec.w[0] && m.w <= spec.w[1] && m.h >= spec.h[0] && m.h <= spec.h[1] && m.cells >= spec.cells[0] && m.cells <= spec.cells[1] + 12);
  if (spec.shapes && spec.shapes.length) {
    const pref = ms.filter((m) => spec.shapes!.some((s) => m.name.startsWith(s)));
    if (pref.length) return pref;
  }
  return ms;
}

function setSym(g: string[][], x: number, y: number, ch: string, sym: boolean) {
  const w = g[0].length;
  if (g[y][x] !== ' ') g[y][x] = ch;
  if (sym && g[y][w - 1 - x] !== ' ') g[y][w - 1 - x] = ch;
}

function applyWalls(rng: Rng, g: string[][], style: string): void {
  const h = g.length, w = g[0].length;
  const sym = isSymX(g);
  const half = sym ? Math.ceil(w / 2) : w;
  const inside = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && g[y][x] !== ' ';
  switch (style) {
    case 'none':
      return;
    case 'sym': {
      const n = ri(rng, 1, Math.max(1, Math.floor((w * h) / 18)));
      for (let k = 0; k < n; k++) {
        const x = ri(rng, 0, half - 1), y = ri(rng, 0, h - 1);
        if (inside(x, y)) setSym(g, x, y, '#', sym);
      }
      return;
    }
    case 'pillars': {
      const ox = rng() < 0.5 ? 1 : 0, oy = rng() < 0.5 ? 1 : 0;
      const p = 0.35 + rng() * 0.4;
      for (let y = oy + 1; y < h - 1; y += 2)
        for (let x = ox + 1; x < half; x += 2) if (inside(x, y) && rng() < p) setSym(g, x, y, '#', sym);
      return;
    }
    case 'bar': {
      const nb = rng() < 0.6 ? 1 : 2;
      for (let k = 0; k < nb; k++) {
        const y = ri(rng, 1, h - 2);
        const gapMid = rng() < 0.5;
        for (let x = 0; x < half; x++) {
          if (!inside(x, y)) continue;
          const edge = x === 0 || !inside(x - 1, y);
          if (gapMid && sym && x >= half - 1) continue;
          if (!gapMid && edge) continue;
          setSym(g, x, y, '#', sym);
        }
      }
      return;
    }
    case 'vbar': {
      if (sym && w % 2 === 1) {
        const cx = (w - 1) / 2;
        const y0 = ri(rng, 0, Math.floor(h / 2)), y1 = ri(rng, y0 + 1, h - 1);
        for (let y = y0; y <= y1; y++) if (inside(cx, y)) g[y][cx] = '#';
      } else {
        const x = ri(rng, 1, Math.max(1, half - 2));
        const y0 = ri(rng, 0, Math.floor(h / 2)), y1 = ri(rng, y0 + 1, h - 1);
        for (let y = y0; y <= y1; y++) if (inside(x, y)) setSym(g, x, y, '#', sym);
      }
      return;
    }
    case 'ring': {
      const x0 = ri(rng, 1, Math.max(1, Math.floor(w / 2) - 2)), y0 = ri(rng, 1, Math.max(1, Math.floor(h / 2) - 2));
      const x1 = w - 1 - x0, y1 = h - 1 - y0;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const border = x === x0 || x === x1 || y === y0 || y === y1;
          if (border && inside(x, y) && rng() < 0.72) g[y][x] = '#';
        }
      return;
    }
    case 'teeth': {
      // alternating stubs from the sides
      for (let y = 1; y < h - 1; y += 2) {
        const left = ((y - 1) / 2) % 2 === 0;
        const len = ri(rng, 1, Math.max(1, Math.floor(w / 2)));
        for (let k = 0; k < len; k++) {
          const x = left ? k : w - 1 - k;
          if (inside(x, y)) g[y][x] = '#';
        }
      }
      return;
    }
    case 'rooms':
      return; // handled by roomsTerrain
  }
}

/** Splits the canvas into rooms with full wall lines. */
function roomsTerrain(rng: Rng, g: string[][], want: number): boolean {
  const h = g.length, w = g[0].length;
  for (let tries = 0; tries < 30; tries++) {
    const t = g.map((r) => r.slice());
    const lines = want - 1;
    const sym = isSymX(t);
    let ok = true;
    let made = 0;
    // vertical centre line first when odd width
    const order = shuffle(rng, ['h', 'h', 'v']);
    for (const kind of order) {
      if (made >= lines) break;
      if (kind === 'v') {
        if (!(w % 2 === 1 && sym)) continue;
        const cx = (w - 1) / 2;
        for (let y = 0; y < h; y++) if (t[y][cx] !== ' ') t[y][cx] = '#';
        made++;
      } else {
        const y = ri(rng, 2, h - 3);
        if (t[y].every((c) => c === ' ' || c === '#')) continue;
        for (let x = 0; x < w; x++) if (t[y][x] !== ' ') t[y][x] = '#';
        made++;
      }
    }
    if (made < lines) ok = false;
    const comps = components(t).filter((c) => c.length >= 1);
    if (ok && comps.length === want && comps.every((c) => c.length >= 3)) {
      for (let y = 0; y < h; y++) g[y] = t[y];
      return true;
    }
  }
  return false;
}

function addSeeds(rng: Rng, g: string[][], n: number, cols: string[]): void {
  const h = g.length, w = g[0].length;
  const cells: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      let nbp = 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && isPaperCh(g[ny][nx])) nbp++;
      }
      if (nbp >= 2) cells.push([x, y]);
    }
  shuffle(rng, cells);
  for (let k = 0; k < n && k < cells.length; k++) {
    const [x, y] = cells[k];
    g[y][x] = pick(rng, cols).toLowerCase();
  }
}

function addGates(rng: Rng, g: string[][], n: number, cols: string[]): number {
  const h = g.length, w = g[0].length;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && isPaperCh(g[y][x]);
  const doors: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y][x] !== '#') continue;
      if ((ok(x - 1, y) && ok(x + 1, y)) || (ok(x, y - 1) && ok(x, y + 1))) doors.push([x, y]);
    }
  if (doors.length < n) {
    // draw a full wall line with a gate door
    const y = ri(rng, 2, h - 3);
    const xs: number[] = [];
    for (let x = 0; x < w; x++) if (g[y][x] !== ' ') xs.push(x);
    if (xs.length >= 3) {
      for (const x of xs) g[y][x] = '#';
      const dx = xs[ri(rng, 1, xs.length - 2)];
      if (ok(dx, y - 1) && ok(dx, y + 1)) doors.push([dx, y]);
      else return 0;
      if (xs.length >= 6 && rng() < 0.5) {
        const dx2 = xs[ri(rng, 1, xs.length - 2)];
        if (dx2 !== dx && Math.abs(dx2 - dx) > 1 && ok(dx2, y - 1) && ok(dx2, y + 1)) doors.push([dx2, y]);
      }
    } else return 0;
  }
  shuffle(rng, doors);
  let made = 0;
  for (let k = 0; k < doors.length && made < n; k++) {
    const [x, y] = doors[k];
    g[y][x] = pick(rng, cols);
    made++;
  }
  return made;
}

function addSlow(rng: Rng, g: string[][], n: number): void {
  const h = g.length, w = g[0].length;
  const sym = isSymX(g) && rng() < 0.6;
  const style = rng();
  const paper: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y][x] === '.') paper.push([x, y]);
  if (!paper.length) return;
  if (style < 0.35) {
    // a band (row)
    const y = ri(rng, 1, h - 2);
    let c = 0;
    for (let x = 0; x < w && c < n + 2; x++) if (g[y][x] === '.') {
      g[y][x] = '~';
      c++;
    }
    return;
  }
  // blob(s)
  let placed = 0;
  let guard = 0;
  while (placed < n && guard++ < 50) {
    const [sx, sy] = pick(rng, paper);
    const st: [number, number][] = [[sx, sy]];
    while (st.length && placed < n) {
      const [x, y] = st.splice(Math.floor(rng() * st.length), 1)[0];
      if (g[y][x] !== '.') continue;
      g[y][x] = '~';
      placed++;
      if (sym && g[y][w - 1 - x] === '.') {
        g[y][w - 1 - x] = '~';
        placed++;
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && g[ny][nx] === '.') st.push([nx, ny]);
      }
    }
  }
}

export function buildTerrain(rng: Rng, spec: Spec, cols: string[]): { rows: string[]; mask: string } | null {
  const masks = fittingMasks(spec);
  if (!masks.length) return null;
  for (let tries = 0; tries < 40; tries++) {
    const m = pick(rng, masks);
    let g = grid(m.rows);
    if (rng() < 0.5 && !isSymX(g)) g = g.map((r) => r.slice().reverse());
    if (spec.rooms) {
      const want = ri(rng, spec.rooms[0], spec.rooms[1]);
      if (!roomsTerrain(rng, g, want)) continue;
    } else {
      applyWalls(rng, g, pick(rng, spec.walls));
    }
    if (spec.gates) {
      const n = ri(rng, spec.gates[0], spec.gates[1]);
      if (n && addGates(rng, g, n, cols) < spec.gates[0]) continue;
    }
    if (spec.slowCells) {
      const n = ri(rng, spec.slowCells[0], spec.slowCells[1]);
      if (n) addSlow(rng, g, n);
    }
    if (spec.seeds) {
      const n = ri(rng, spec.seeds[0], spec.seeds[1]);
      if (n) addSeeds(rng, g, n, ['R', 'Y', 'B'].filter((c) => !spec.palette || spec.palette.includes(c)));
    }
    // trim fully empty outer rows/cols
    while (g.length && g[0].every((c) => c === ' ')) g.shift();
    while (g.length && g[g.length - 1].every((c) => c === ' ')) g.pop();
    if (!g.length) continue;
    while (g[0].length && g.every((r) => r[0] === ' ')) g = g.map((r) => r.slice(1));
    while (g[0].length && g.every((r) => r[r.length - 1] === ' ')) g = g.map((r) => r.slice(0, -1));
    const h = g.length, w = g[0].length;
    if (w < spec.w[0] || w > spec.w[1] || h < spec.h[0] || h > spec.h[1]) continue;
    // walls on an all-wall border row are pointless: turn edge walls that touch only outside into outside? keep
    const comps = components(g);
    let paper = 0;
    for (const r of g) for (const ch of r) if (isPaperCh(ch)) paper++;
    if (paper < spec.cells[0] || paper > spec.cells[1]) continue;
    if (!spec.rooms && comps.length > 1) {
      if (comps.length > 2 || Math.min(...comps.map((c) => c.length)) < 4 || rng() < 0.7) continue;
    }
    if (comps.some((c) => c.length < 3)) continue;
    // walls must not cover more than a third of the canvas
    let walls = 0;
    for (const r of g) for (const ch of r) if (ch === '#') walls++;
    if (walls > (paper + walls) * 0.34) continue;
    return { rows: rowsOf(g), mask: m.name };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inks + plan
// ---------------------------------------------------------------------------------------------

function chooseInks(rng: Rng, spec: Spec): string[] {
  const k = ri(rng, spec.inks[0], spec.inks[1]);
  const all = spec.palette || ['R', 'Y', 'B'];
  const allowOrder = spec.allowed.includes('order');
  const allowThree = spec.allowed.includes('three');
  let pal: string[];
  if (!allowOrder) pal = [pick(rng, all)];
  else if (allowThree && all.length === 3 && (spec.require.includes('three') || (k >= 3 && rng() < 0.45))) pal = all.slice();
  else {
    const a = shuffle(rng, all.slice());
    pal = a.slice(0, Math.min(2, a.length));
    if (k === 1) pal = [a[0]];
  }
  const out: string[] = [];
  const need = shuffle(rng, pal.slice());
  for (let q = 0; q < k; q++) out.push(q < need.length ? need[q] : pick(rng, pal));
  shuffle(rng, out);
  if (spec.allowed.includes('range')) {
    const p = spec.rangeP ?? 0.4;
    let any = false;
    for (let q = 0; q < k; q++)
      if (rng() < p) {
        out[q] += String(pick(rng, [1, 2, 2, 2, 3, 3, 3, 4, 4]));
        any = true;
      }
    if (!any && spec.require.includes('range')) out[ri(rng, 0, k - 1)] += String(pick(rng, [2, 2, 3, 3, 4]));
  }
  return out;
}

function makePlan(rng: Rng, B: Board, spec: Spec, roomsOf: number[][] | null): Plan | null {
  const k = B.inkC.length;
  let m = 0;
  if (spec.timing !== 'none' && k > 1) {
    const lo = spec.timing === 'need' ? Math.max(1, spec.timed[0]) : spec.timed[0];
    const hi = Math.min(k - 1, spec.timed[1]);
    if (hi < lo) return null;
    m = ri(rng, lo, hi);
  }
  const prefix = k - m;
  const times: number[] = [];
  let t = 0;
  for (let q = 0; q < m; q++) {
    t += pick(rng, [1, 1, 2, 2, 2, 3, 3, 4, 5, 6]);
    times.push(t);
  }
  const s = new FS(B);
  const plan: Plan = [];
  const roomOrder = roomsOf ? shuffle(rng, roomsOf.map((_, i) => i)) : null;
  const buf: number[] = [];
  for (let q = 0; q < k; q++) {
    const tt = q < prefix ? 0 : times[q - prefix];
    while (s.tick < tt) s.step();
    let cells = s.droppable(buf).slice();
    if (roomOrder) {
      const room = roomsOf![roomOrder[q % roomOrder.length]];
      cells = cells.filter((c) => room.includes(c));
    }
    if (!cells.length) return null;
    // keep drops apart a little
    const far = cells.filter((c) => plan.every((p) => Math.abs((p.i % B.w) - (c % B.w)) + Math.abs(Math.floor(p.i / B.w) - Math.floor(c / B.w)) >= 2));
    const i = pick(rng, far.length && rng() < 0.85 ? far : cells);
    s.drop(i);
    plan.push({ i, t: tt });
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Goal choice by set cover
// ---------------------------------------------------------------------------------------------

function popcnt(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

interface CoverInput {
  B0: Board;
  final: Uint8Array;
  alts: Uint8Array[];
  plan: Plan;
  info: SolutionInfo;
  spec: Spec;
  allowWhite: boolean;
  forced: number[];
}

/** Returns goal codes per cell (0 = free) or null. */
function cover(rng: Rng, ci: CoverInput): Uint8Array | null {
  const { B0, final, alts, spec } = ci;
  const n = B0.n;
  const cand: number[] = [], code: number[] = [], wt: number[] = [];
  const dropCells = new Set(ci.plan.map((p) => p.i));
  for (let i = 0; i < n; i++) {
    if (B0.wall[i]) continue;
    const f = final[i];
    let c = 0;
    if (f && f !== 7) c = f;
    else if (!f && ci.allowWhite && !B0.seed0[i] && !B0.gate[i]) c = WHITE;
    if (!c) continue;
    let w = 1;
    const mixedCell = c !== WHITE && c !== 1 && c !== 2 && c !== 4;
    if (mixedCell) w *= 1.7;
    if (c === WHITE) w *= 1.25;
    // boundary cell (next to a different colour)
    let boundary = false;
    for (let k = 0; k < 4; k++) {
      const m = B0.nb[i * 4 + k];
      if (m >= 0 && !B0.wall[m] && final[m] !== f) boundary = true;
    }
    if (boundary) w *= 1.25;
    if (dropCells.has(i)) w *= 0.45;
    if (B0.seed0[i]) w *= 0.7;
    cand.push(i);
    code.push(c);
    wt.push(w * (0.85 + 0.3 * rng()));
  }
  const A = alts.length;
  const words = (A + 31) >>> 5;
  const kill: Uint32Array[] = cand.map(() => new Uint32Array(words));
  const killable = new Uint32Array(words);
  for (let j = 0; j < A; j++) {
    const F = alts[j];
    const wj = j >>> 5, bj = 1 << (j & 31);
    for (let c = 0; c < cand.length; c++) {
      const want = code[c] === WHITE ? 0 : code[c];
      if (F[cand[c]] !== want) {
        kill[c][wj] |= bj;
        killable[wj] |= bj;
      }
    }
  }
  const alive = killable.slice();
  const chosen: number[] = [];
  const take = (c: number) => {
    chosen.push(c);
    for (let q = 0; q < words; q++) alive[q] &= ~kill[c][q];
  };
  for (const f of ci.forced) {
    const c = cand.indexOf(f);
    if (c >= 0 && !chosen.includes(c)) take(c);
  }
  const maxT = spec.maxTargets;
  for (;;) {
    let any = 0;
    for (let q = 0; q < words; q++) any |= alive[q];
    if (!any || chosen.length >= maxT) break;
    let best = -1, bestS = 0;
    for (let c = 0; c < cand.length; c++) {
      if (chosen.includes(c)) continue;
      let cnt = 0;
      const kc = kill[c];
      for (let q = 0; q < words; q++) cnt += popcnt(kc[q] & alive[q]);
      if (!cnt) continue;
      const sc = cnt * wt[c];
      if (sc > bestS) {
        bestS = sc;
        best = c;
      }
    }
    if (best < 0) break;
    take(best);
  }
  let left = 0;
  for (let q = 0; q < words; q++) left += popcnt(alive[q]);
  if (left > spec.coverTol * A) return null;
  // reverse delete (keep forced)
  const killedNow = killable.slice();
  for (let q = 0; q < words; q++) killedNow[q] &= ~alive[q];
  const forcedIdx = new Set(ci.forced.map((f) => cand.indexOf(f)));
  const order = chosen.slice().sort((a, b) => wt[a] - wt[b]);
  for (const c of order) {
    if (forcedIdx.has(c)) continue;
    const rest = chosen.filter((x) => x !== c);
    const u = new Uint32Array(words);
    for (const x of rest) for (let q = 0; q < words; q++) u[q] |= kill[x][q];
    let okk = true;
    for (let q = 0; q < words; q++) if ((killedNow[q] & ~u[q]) !== 0) { okk = false; break; }
    if (okk) chosen.splice(chosen.indexOf(c), 1);
  }
  // pad to the minimum with informative cells (mixed / boundary first)
  let paper = 0;
  for (let i = 0; i < n; i++) if (!B0.wall[i]) paper++;
  const minT = Math.min(spec.minTargets, Math.floor(paper * 0.5));
  if (chosen.length < minT) {
    const rest = cand.map((_, c) => c).filter((c) => !chosen.includes(c)).sort((a, b) => wt[b] - wt[a]);
    for (const c of rest) {
      if (chosen.length >= minT) break;
      chosen.push(c);
    }
  }
  if (chosen.length < LIMITS.minTargets || chosen.length > Math.min(LIMITS.maxTargets, maxT + 2)) return null;
  if (chosen.length > Math.max(LIMITS.minTargets, paper * 0.6)) return null;
  const goal = new Uint8Array(n);
  for (const c of chosen) goal[cand[c]] = code[c];
  return goal;
}

function goalRows(B: Board, goal: Uint8Array): string[] {
  const out: string[] = [];
  for (let y = 0; y < B.h; y++) {
    let r = '';
    for (let x = 0; x < B.w; x++) {
      const g = goal[y * B.w + x];
      r += !g ? '.' : g === WHITE ? 'w' : CODE_TO_CHAR[g];
    }
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------------------------

function finalOf(B0: Board, plan: Plan): Uint8Array | null {
  const r = play(B0, plan, false);
  if (!r.valid) return null;
  return r.sim.ink;
}

function validTiming(plan: Plan): boolean {
  if (plan[0].t !== 0) return false;
  for (let k = 1; k < plan.length; k++) {
    if (plan[k].t < plan[k - 1].t) return false;
    if (plan[k].t > 0 && plan[k].t === plan[k - 1].t) return false;
    if (plan[k].t - plan[k - 1].t > LIMITS.maxWait) return false;
  }
  return true;
}

function perturbations(rng: Rng, B0: Board, plan: Plan, radius: number, frac: number): Plan[] {
  const out: Plan[] = [];
  const w = B0.w;
  const K = plan.length;
  for (let q = 0; q < K; q++) {
    const p = plan[q];
    const px = p.i % w, py = Math.floor(p.i / w);
    for (const i of B0.open) {
      const d = Math.abs((i % w) - px) + Math.abs(Math.floor(i / w) - py);
      if (d === 0 || d > radius) continue;
      if (rng() > frac && d > 1) continue;
      const np = plan.map((x) => ({ ...x }));
      np[q].i = i;
      out.push(np);
    }
    // timing shifts
    for (const dt of [-2, -1, 1, 2, 3]) {
      const np = plan.map((x) => ({ ...x }));
      np[q].t = Math.max(0, p.t + dt);
      if (q === 0 && np[q].t !== 0) continue;
      if (validTiming(np)) out.push(np);
    }
  }
  // swap positions of two drops of different colour
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++) {
      if (B0.inkC[a] === B0.inkC[b] && B0.inkR[a] === B0.inkR[b]) continue;
      const np = plan.map((x) => ({ ...x }));
      np[a].i = plan[b].i;
      np[b].i = plan[a].i;
      out.push(np);
    }
  // all at t=0 with the same cells
  if (plan.some((p) => p.t > 0)) out.push(plan.map((p) => ({ i: p.i, t: 0 })));
  return out;
}

function randomT0Plan(rng: Rng, B0: Board): Plan {
  const K = B0.inkC.length;
  const cells = shuffle(rng, B0.open.slice());
  const out: Plan = [];
  for (let q = 0; q < K && q < cells.length; q++) out.push({ i: cells[q], t: 0 });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------------------------

export interface GenStats { attempts: number; terrain: number; plan: number; filter: number; cover: number; measure: number; ok: number }

function terrainMatters(rows: string[], inks: string[], plan: Plan, final: Uint8Array, re: RegExp, to: string): boolean {
  const alt = rows.map((r) => r.replace(re, to));
  const B = makeBoard({ id: 'x', map: alt, goal: alt.map((r) => '.'.repeat(r.length)), inks, solution: [] });
  const f = finalOf(B, plan);
  if (!f) return true;
  for (let i = 0; i < f.length; i++) if (f[i] !== final[i]) return true;
  return false;
}

function rangeMatters(rows: string[], inks: string[], plan: Plan, final: Uint8Array): boolean {
  const B = makeBoard({ id: 'x', map: rows, goal: rows.map((r) => '.'.repeat(r.length)), inks: inks.map((s) => s[0]), solution: [] });
  const f = finalOf(B, plan);
  if (!f) return true;
  for (let i = 0; i < f.length; i++) if (f[i] !== final[i]) return true;
  return false;
}

export function makeCandidate(rng: Rng, spec: Spec, id: string, st: GenStats): Candidate | null {
  st.attempts++;
  const cols = spec.palette || ['R', 'Y', 'B'];
  const inks = chooseInks(rng, spec);
  const ter = buildTerrain(rng, spec, cols);
  if (!ter) {
    st.terrain++;
    return null;
  }
  const rows = ter.rows;
  const blank = rows.map((r) => '.'.repeat(r.length));
  const def0: LevelDef = { id, map: rows, goal: blank, inks, solution: [] };
  let B0: Board;
  try {
    B0 = makeBoard(def0);
  } catch {
    st.terrain++;
    return null;
  }
  let roomsOf: number[][] | null = null;
  if (spec.rooms) {
    roomsOf = components(grid(rows));
    if (roomsOf.length !== inks.length) {
      st.terrain++;
      return null;
    }
  }
  // --- solution
  let plan: Plan | null = null;
  let info: SolutionInfo | null = null;
  for (let tries = 0; tries < 12 && !info; tries++) {
    const p = makePlan(rng, B0, spec, roomsOf);
    if (!p) continue;
    const inf = analyzeSolution(B0, p);
    if (inf.settleTick > spec.maxSettle) continue;
    if (inf.coverage < spec.minCoverage) continue;
    if (inf.mud) continue;
    if (inf.territory.some((t) => t < 2)) continue;
    if (spec.noCollide && inf.collisions) continue;
    if (inf.mixedCells.length < spec.minMixed) continue;
    if (!spec.allowed.includes('mix') && inf.mixedCells.length) continue;
    if (spec.parity === 'forbid' && inf.parityCells.length) continue;
    if (spec.parity === 'need' && !inf.parityCells.length) continue;
    if (spec.require.includes('seed') && inf.seedsWoken < 1) continue;
    let sleeping = 0;
    for (let i = 0; i < B0.n; i++) if (B0.seed0[i]) sleeping++;
    if (inf.seedsWoken < sleeping) continue; // every seed should wake
    if (spec.require.includes('gate') && !terrainMatters(rows, inks, p, inf.final, /[RYB]/g, '.')) continue;
    if (spec.require.includes('slow') && !terrainMatters(rows, inks, p, inf.final, /~/g, '.')) continue;
    if (spec.require.includes('range') && !rangeMatters(rows, inks, p, inf.final)) continue;
    if (spec.threeSecondaries) {
      const sec = new Set(inf.mixedCells.map((i) => inf.final[i]));
      if (!(sec.has(3) && sec.has(5) && sec.has(6))) continue;
    }
    if (spec.require.includes('white')) {
      let blankCells = 0;
      for (let i = 0; i < B0.n; i++) if (!B0.wall[i] && !inf.final[i] && !B0.seed0[i] && !B0.gate[i]) blankCells++;
      if (!blankCells) continue;
    }
    plan = p;
    info = inf;
  }
  if (!plan || !info) {
    st.plan++;
    return null;
  }
  // mechanic check of the would-be level (three)
  let prim = 0;
  for (const s of inks) prim |= s[0] === 'R' ? 1 : s[0] === 'Y' ? 2 : 4;
  for (const ch of rows.join('')) if (ch === 'r') prim |= 1; else if (ch === 'y') prim |= 2; else if (ch === 'b') prim |= 4;
  if (prim === 7 && !spec.allowed.includes('three')) {
    st.filter++;
    return null;
  }
  if (spec.require.includes('three') && prim !== 7) {
    st.filter++;
    return null;
  }
  // --- alternatives
  const alts: Uint8Array[] = [];
  const nRand = spec.tag === 'light' ? 700 : 1100;
  const gfree = B0;
  const buf: number[] = [];
  for (let k = 0; k < nRand; k++) {
    const { plan: rp } = randomTrial(gfree, rng, buf);
    if (rp.length < inks.length) continue;
    const f = finalOf(B0, rp);
    if (f) alts.push(f);
  }
  const pert = perturbations(rng, B0, plan, spec.pin > 0.5 ? 2 : 1, spec.pin);
  for (const pp of pert) if (rng() < 0.35 + spec.pin * 0.65) {
    const f = finalOf(B0, pp);
    if (f) alts.push(f);
  }
  if (spec.timing === 'need') {
    const space = t0Space(B0);
    if (space <= 4000) {
      // enumerate every t=0 play
      const K = inks.length;
      const cur: Plan = [];
      const rec = (q: number) => {
        if (q === K) {
          const f = finalOf(B0, cur);
          if (f) alts.push(f);
          return;
        }
        for (const i of B0.open) {
          if (cur.some((p) => p.i === i)) continue;
          cur.push({ i, t: 0 });
          rec(q + 1);
          cur.pop();
        }
      };
      rec(0);
    } else {
      for (let k = 0; k < 900; k++) {
        const f = finalOf(B0, randomT0Plan(rng, B0));
        if (f) alts.push(f);
      }
    }
  }
  const forced: number[] = [];
  if (spec.parity === 'need' && info.parityCells.length) forced.push(pick(rng, info.parityCells));
  const mixedOK = info.mixedCells.filter((i) => info!.final[i] !== 7);
  if (spec.require.includes('mix') && mixedOK.length && !forced.length) forced.push(pick(rng, mixedOK));
  if (spec.threeSecondaries) {
    for (const c of [3, 5, 6]) {
      const cs = mixedOK.filter((i) => info!.final[i] === c);
      if (cs.length && !forced.some((f) => info!.final[f] === c)) forced.push(pick(rng, cs));
    }
  }
  const allowWhite = spec.allowed.includes('white');
  if (spec.require.includes('white')) {
    const blanks: number[] = [];
    for (let i = 0; i < B0.n; i++) if (!B0.wall[i] && !info.final[i] && !B0.seed0[i] && !B0.gate[i]) blanks.push(i);
    if (blanks.length) forced.push(pick(rng, blanks));
  }
  const ci: CoverInput = { B0, final: info.final, alts, plan, info, spec, allowWhite, forced };
  let goal = cover(rng, ci);
  if (!goal) {
    st.cover++;
    return null;
  }
  // --- refine against the bots (their winning plays become alternatives) and t=0 solutions
  let def: LevelDef = { id, map: rows, goal: goalRows(B0, goal), inks, solution: planToDrops(B0, plan) };
  for (let round = 0; round < 4; round++) {
    const Bg = withGoal(B0, goal);
    let added = 0;
    for (let k = 0; k < 1200; k++) {
      const r = randomTrial(Bg, rng, buf);
      if (r.won) {
        const f = finalOf(B0, r.plan);
        if (f && !sameOnGoal(f, info.final, goal)) {} // cannot happen (won)
        if (f && !sameAll(f, info.final)) {
          alts.push(f);
          added++;
        }
      }
    }
    for (let k = 0; k < 300; k++) {
      const r = greedyTrial(Bg, rng, buf);
      if (r.won) {
        const f = finalOf(B0, r.plan);
        if (f && !sameAll(f, info.final)) {
          alts.push(f);
          added++;
        }
      }
    }
    if (spec.timing === 'need') {
      const t0 = solve(Bg, { onlyT0: true, maxSolutions: 3, keep: 3, nodeBudget: 120000 });
      for (const ex of t0.examples) {
        const f = finalOf(B0, ex);
        if (f) {
          alts.push(f);
          added++;
        }
      }
      if (!t0.complete && !t0.examples.length && round === 3) {
        st.cover++;
        return null;
      }
    }
    if (!added) break;
    const g2 = cover(rng, ci);
    if (!g2) {
      st.cover++;
      return null;
    }
    goal = g2;
  }
  def = { id, map: rows, goal: goalRows(B0, goal), inks, solution: planToDrops(B0, plan) };
  // --- measure with fresh seeds
  const m = measureCandidate(def, spec, info);
  if (!m) {
    st.measure++;
    return null;
  }
  st.ok++;
  return {
    def,
    metrics: m,
    uses: usesOf(def, info),
    spec: spec.key,
    info: { mixed: info.mixedCells.length, coverage: info.coverage, timed: info.timedDrops, parity: info.parityCells.length },
  };
}

function sameAll(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function sameOnGoal(a: Uint8Array, b: Uint8Array, goal: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (goal[i] && a[i] !== b[i]) return false;
  return true;
}

export function measureCandidate(def: LevelDef, spec: Spec, info: SolutionInfo): Metrics | null {
  const B = makeBoard(def);
  const seed = hash32(def.id + '|' + def.goal.join('') + def.map.join(''));
  const rng = mulberry32(seed);
  let wins = 0;
  const buf: number[] = [];
  const RT = 2000;
  for (let k = 0; k < RT; k++) {
    if (randomTrial(B, rng, buf).won) wins++;
    if (k === 400 && wins / 400 > spec.maxRandom * 2.5) return null; // early reject
  }
  const random = wins / RT;
  if (random >= spec.maxRandom) return null;
  let gw = 0;
  for (let k = 0; k < 300; k++) if (greedyTrial(B, rng, buf).won) gw++;
  const greedy = gw / 300;
  if (greedy >= spec.maxGreedy) return null;
  let solutions: number | null = null;
  let complete = false;
  let needsTiming: boolean | null = null;
  const K = B.inkC.length;
  const sr = solve(B, { nodeBudget: K <= 2 ? 400000 : 700000, maxSolutions: 4000 });
  if (sr.complete) {
    solutions = sr.solutions;
    complete = true;
    needsTiming = !sr.noWait;
  } else if (sr.noWait) needsTiming = false;
  if (needsTiming === null) {
    const t0 = solve(B, { onlyT0: true, nodeBudget: 600000, maxSolutions: 1 });
    if (t0.noWait) needsTiming = false;
    else if (t0.complete) needsTiming = true;
  }
  if (spec.timing === 'need' && needsTiming === false) return null;
  if (spec.timing === 'none' && info.timedDrops > 0) return null;
  let cells = 0;
  for (let i = 0; i < B.n; i++) if (!B.wall[i]) cells++;
  const mech = usesOf(def, info).length;
  const metrics: Metrics = {
    random, greedy, solutions, complete, needsTiming, timedDrops: info.timedDrops, settleTick: info.settleTick,
    targets: B.targets.length + B.whites.length, inks: K, cells, diff: 0,
  };
  metrics.diff = difficultyScore({ random, greedy, solutions, needsTiming, timedDrops: info.timedDrops, inks: K, cells, mechCount: mech });
  return metrics;
}

export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function asciiLevel(def: LevelDef): string {
  const out: string[] = [];
  for (let y = 0; y < def.map.length; y++) out.push(def.map[y].replace(/ /g, '·') + '   ' + def.goal[y].replace(/ /g, '·'));
  return out.join('\n');
}
