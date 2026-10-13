/*
 * Inkbloom level generator.  npm run levels:gen   (node --experimental-strip-types tools/gen-levels.ts)
 *
 * Method (reverse design): terrain (shaped silhouette + symmetric walls + features) -> ink queue ->
 * a random solution under the input model -> simulate -> choose goal cells that make that solution
 * (nearly) necessary by set cover against many alternative plays (random-bot plays, near misses,
 * all-t=0 plays, greedy-bot wins) -> exact all-t=0 check -> measure (bots + exhaustive solver) ->
 * place candidates on each chapter's sawtooth curve.
 *
 * Deterministic: every job has its own seed, jobs run in worker threads, results are merged in job
 * order, so the output does not depend on scheduling. Writes:
 *   src/levels/data/campaign.ts   8 chapters x 30 levels
 *   src/levels/data/daily.ts      daily pool (light / medium / hard)
 *   tools/level-report.md         metrics table
 * Options: --workers N   --quick (fewer candidates, for testing)
 *          --cache FILE (dev only: reuse job results whose spec and generator/simulator code are unchanged)
 */
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WHITE, CODE_TO_CHAR, type LevelDef, type MechanicKey } from '../src/core/sim.ts';
import { LEVELS_PER_CHAPTER } from '../src/config/balance.ts';
import {
  FS, makeBoard, withGoal, play, randomTrial, greedyTrial, solve, analyzeSolution, usesOf, measure, floodT0,
  mulberry32, planToDrops, t0Space, canonKey, terrainKey, solutionString, buildReport, BASIC_MECHANICS, LIMITS,
  type Board, type Plan, type Rng, type SolutionInfo, type Metrics, type ReportRow,
} from './level-lib.ts';
import { HANDMADE } from './handmade-levels.ts';

// <core>
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
  /** Preferred silhouettes (names, or prefixes ending in '*'). */
  shapes?: string[];
  /** Probability of using a preferred silhouette. */
  shapeP?: number;
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
  info: { mixed: number; coverage: number; timed: number; parity: number; blanks: number; colours: number };
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

function fittingMasks(spec: Spec): { all: Mask[]; pref: Mask[] } {
  const all = MASKS.filter((m) => m.w >= spec.w[0] && m.w <= spec.w[1] && m.h >= spec.h[0] && m.h <= spec.h[1] && m.cells >= spec.cells[0] && m.cells <= spec.cells[1] + 12);
  const pref = spec.shapes && spec.shapes.length ? all.filter((m) => spec.shapes!.some((s) => m.name === s || (s.endsWith('*') && m.name.startsWith(s.slice(0, -1))))) : [];
  return { all, pref };
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

export function buildTerrain(rng: Rng, spec: Spec, cols: string[], roomsWant = 0): { rows: string[]; mask: string } | null {
  const fm = fittingMasks(spec);
  if (!fm.all.length) return null;
  for (let tries = 0; tries < 40; tries++) {
    const m = fm.pref.length && rng() < (spec.shapeP ?? 0.6) ? pick(rng, fm.pref) : pick(rng, fm.all);
    let g = grid(m.rows);
    if (rng() < 0.5 && !isSymX(g)) g = g.map((r) => r.slice().reverse());
    if (spec.rooms) {
      const want = roomsWant || ri(rng, spec.rooms[0], spec.rooms[1]);
      if (!roomsTerrain(rng, g, want)) continue;
      if (rng() < 0.5) applyWalls(rng, g, pick(rng, ['sym', 'pillars']));
      if (components(g).length !== want) continue;
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
    if (c === WHITE) {
      let edgeW = false;
      for (let k = 0; k < 4; k++) {
        const m = B0.nb[i * 4 + k];
        if (m >= 0 && final[m]) edgeW = true;
      }
      w *= edgeW ? 1.3 : 0.4;
    }
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
  if (!B0.slow.some((x) => x) && plan.every((p) => p.t === 0)) {
    const out = new Uint8Array(B0.n);
    const cells = plan.map((p) => p.i);
    for (const i of cells) if (B0.wall[i] || B0.seed0[i] || B0.gate[i]) return null;
    if (new Set(cells).size !== cells.length) return null;
    floodT0(B0, cells, out);
    return out;
  }
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

export interface GenStats { attempts: number; terrain: number; plan: number; filter: number; cover: number; measure: number; ok: number; preR?: number; preG?: number; t0?: number; t0e?: number; t0c?: number; t0x?: number; fin?: number }

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
  const ter = buildTerrain(rng, spec, cols, spec.rooms ? inks.length : 0);
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
  // every part of the canvas should take part in the picture
  for (const comp of components(grid(rows))) {
    if (!comp.some((i) => info!.final[i])) {
      st.filter++;
      return null;
    }
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
  const t0From = alts.length;
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
      for (let k = 0; k < 600; k++) {
        const f = finalOf(B0, randomT0Plan(rng, B0));
        if (f) alts.push(f);
      }
      // every t=0 play with each drop near its designed cell
      const K = inks.length;
      const R = K <= 2 ? 4 : K === 3 ? 2 : 1;
      const near: number[][] = plan.map((p) => B0.open.filter((i) => Math.abs((i % B0.w) - (p.i % B0.w)) + Math.abs(Math.floor(i / B0.w) - Math.floor(p.i / B0.w)) <= R));
      let total = 1;
      for (const l of near) total *= l.length;
      const keepP = Math.min(1, 9000 / total);
      const cur: Plan = [];
      const rec = (q: number) => {
        if (q === K) {
          if (keepP < 1 && rng() > keepP) return;
          const f = finalOf(B0, cur);
          if (f) alts.push(f);
          return;
        }
        for (const i of near[q]) {
          if (cur.some((p) => p.i === i)) continue;
          cur.push({ i, t: 0 });
          rec(q + 1);
          cur.pop();
        }
      };
      rec(0);
    }
  }
  if (spec.timing === 'need') {
    // a t=0 play that paints the very same picture makes waiting pointless: give up early
    for (let j = t0From; j < alts.length; j++) {
      if (sameAll(alts[j], info.final)) {
        st.t0e = (st.t0e || 0) + 1;
        st.measure++;
        return null;
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
    const blanks: number[] = [], edge: number[] = [];
    for (let i = 0; i < B0.n; i++) {
      if (B0.wall[i] || info.final[i] || B0.seed0[i] || B0.gate[i]) continue;
      blanks.push(i);
      for (let k = 0; k < 4; k++) {
        const m = B0.nb[i * 4 + k];
        if (m >= 0 && info.final[m]) {
          edge.push(i);
          break;
        }
      }
    }
    if (edge.length) forced.push(pick(rng, edge));
    else if (blanks.length) forced.push(pick(rng, blanks));
  }
  const ci: CoverInput = { B0, final: info.final, alts, plan, info, spec, allowWhite, forced };
  let goal: Uint8Array | null = cover(rng, ci);
  if (!goal) {
    st.cover++;
    return null;
  }
  // --- refine against the bots (their winning plays become alternatives)
  const refine = (rounds: number, nr: number, ng: number): boolean => {
    for (let round = 0; round < rounds; round++) {
      const Bg = withGoal(B0, goal!);
      let added = 0;
      for (let k = 0; k < nr; k++) {
        const r = randomTrial(Bg, rng, buf);
        if (!r.won) continue;
        const f = finalOf(B0, r.plan);
        if (f && !sameAll(f, info!.final)) {
          alts.push(f);
          added++;
        }
      }
      for (let k = 0; k < ng; k++) {
        const r = greedyTrial(Bg, rng, buf);
        if (!r.won) continue;
        const f = finalOf(B0, r.plan);
        if (f && !sameAll(f, info!.final)) {
          alts.push(f);
          added++;
        }
      }
      if (!added) return true;
      const g2 = cover(rng, ci);
      if (!g2) return false;
      goal = g2;
    }
    return true;
  };
  if (!refine(3, 900, 300)) {
    st.cover++;
    return null;
  }
  // --- cheap pre-check with an independent stream before the expensive searches
  {
    const Bg = withGoal(B0, goal);
    let w = 0;
    for (let k = 0; k < 500; k++) if (randomTrial(Bg, rng, buf).won) w++;
    if (w / 500 > spec.maxRandom * 1.3) {
      st.measure++;
      st.preR = (st.preR || 0) + 1;
      return null;
    }
    let gw = 0;
    for (let k = 0; k < 150; k++) if (greedyTrial(Bg, rng, buf).won) gw++;
    if (gw / 150 > Math.min(1, spec.maxGreedy * 1.3)) {
      st.measure++;
      st.preG = (st.preG || 0) + 1;
      return null;
    }
  }
  // --- exact all-t=0 check (lazy: any t=0 solution found becomes an alternative, then re-cover)
  let needsTiming: boolean | null = null;
  if (spec.timing === 'need' || spec.timing === 'opt') {
    const K = inks.length;
    const budget = K <= 3 ? 600000 : 250000;
    for (let round = 0; round < 8; round++) {
      const Bg = withGoal(B0, goal);
      const t0 = solve(Bg, { onlyT0: true, maxSolutions: 40, keep: 40, nodeBudget: budget });
      if (!t0.examples.length) {
        needsTiming = t0.complete ? true : null;
        break;
      }
      needsTiming = false;
      if (spec.timing !== 'need') break;
      for (const ex of t0.examples) {
        const f = finalOf(B0, ex);
        if (f) alts.push(f);
      }
      const g2 = cover(rng, ci);
      if (!g2) {
        st.t0c = (st.t0c || 0) + 1;
        break;
      }
      goal = g2;
      if (!refine(1, 400, 150)) break;
    }
    if (spec.timing === 'need' && needsTiming === false) {
      st.measure++;
      st.t0 = (st.t0 || 0) + 1;
      return null;
    }
    if (spec.timing === 'need' && needsTiming === null && K <= 3) {
      st.measure++;
      st.t0x = (st.t0x || 0) + 1;
      return null;
    }
  } else needsTiming = false; // designed all-t=0 solution
  const def: LevelDef = { id, map: rows, goal: goalRows(B0, goal), inks, solution: planToDrops(B0, plan) };
  // --- final measurement (the same function the verifier runs)
  const m = measure(def, { needsTimingHint: needsTiming });
  if (m.random >= spec.maxRandom || m.greedy >= spec.maxGreedy) {
    st.measure++;
    st.fin = (st.fin || 0) + 1;
    return null;
  }
  if (spec.timing === 'none' && info.timedDrops > 0) {
    st.measure++;
    return null;
  }
  st.ok++;
  return {
    def,
    metrics: m,
    uses: usesOf(def, info),
    spec: spec.key,
    info: { mixed: info.mixedCells.length, coverage: info.coverage, timed: info.timedDrops, parity: info.parityCells.length, ...pictureStats(B0, info.final, goal) },
  };
}

/** Blank paper left in the finished picture (not counting clean goals) and how colourful it is. */
export function pictureStats(B0: Board, final: Uint8Array, goal: Uint8Array): { blanks: number; colours: number } {
  let blanks = 0;
  const cols = new Set<number>();
  for (let i = 0; i < B0.n; i++) {
    if (B0.wall[i] || B0.gate[i]) continue;
    if (final[i]) cols.add(final[i]);
    else if (goal[i] !== WHITE) blanks++;
  }
  return { blanks, colours: cols.size };
}

function sameAll(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
// </core>

// =============================================================================================
// Campaign plan, jobs, selection
// =============================================================================================

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------------------------
// Mechanic schedule
// ---------------------------------------------------------------------------------------------

/** Campaign slot (chapter 1-based, slot 1-based) where each mechanic is introduced. */
export const INTRO_AT: Record<MechanicKey, [number, number]> = {
  drop: [1, 1], walls: [1, 3], order: [1, 5], mix: [1, 7], timing: [1, 16],
  parity: [2, 1], three: [2, 12], range: [3, 1], white: [4, 1], seed: [5, 1], gate: [6, 1], slow: [7, 1],
};

function knownAt(ch: number, slot: number): MechanicKey[] {
  return (Object.keys(INTRO_AT) as MechanicKey[]).filter((m) => {
    const [c, s] = INTRO_AT[m];
    return c < ch || (c === ch && s <= slot);
  });
}

const CHAPTER_MECH: (MechanicKey | null)[] = [null, 'parity', 'range', 'white', 'seed', 'gate', 'slow', null];

const CHAPTER_SHAPES: string[][] = [
  ['pad5', 'pad6', 'pad7', 'lily6', 'lily7', 'fish', 'cloud', 'lotus8', 'bigpad', 'moonpool', 'oval*', 'round*'],
  ['teacup', 'bowl', 'lantern', 'fan', 'house', 'pagoda', 'pagoda8', 'bigbell', 'bell', 'vase', 'oct*'],
  ['leaf', 'tree', 'pine', 'tower', 'bottle', 'bigtree', 'bigleaf', 'kite', 'rect*', 'round*'],
  ['mountain', 'peaks8', 'diamond', 'star', 'bigstar', 'house', 'arch', 'oct*'],
  ['boat', 'fish', 'bigfish', 'shell', 'bell', 'umbrella', 'cloud', 'oval*'],
  ['lantern', 'biglantern', 'crown', 'fan', 'gourd', 'vase', 'bigvase', 'bowl', 'teacup'],
  ['leaf', 'ginkgo', 'maple', 'butterfly', 'flower', 'bigleaf', 'mountain', 'round*'],
  ['flower', 'butterfly', 'heart', 'lotus8', 'maple', 'star', 'bigstar', 'shell', 'bigtree', 'pagoda8'],
];

const BOSS_SHAPES = ['bigpad', 'bigbell', 'bigtree', 'pagoda8', 'bigstar', 'biglantern', 'bigleaf', 'bigfish', 'bigvase', 'lotus8', 'shell', 'pagoda', 'house', 'oct8x9', 'oct8x10', 'oval8x9', 'oval8x10', 'oval7x9', 'oct7x9'];

type Kind = 'L' | 'N' | 'T' | 'D' | 'B';
interface Slot { kind: Kind; timing: Timing; timed?: [number, number]; newMech?: boolean; extra?: Partial<Spec> }

const T = (kind: Kind, timing: Timing, timed?: [number, number], newMech = false, extra?: Partial<Spec>): Slot => ({ kind, timing, timed, newMech, extra });

/** Per chapter: slot number -> plan (handmade slots are absent). */
function chapterPlan(ch: number): Record<number, Slot> {
  if (ch === 1) {
    const roomsBase: Partial<Spec> = { allowed: ['drop', 'walls', 'order'], require: ['order'], noCollide: true, minMixed: 0, walls: ['rooms'] };
    return {
      6: T('L', 'none', undefined, false, { ...roomsBase, rooms: [3, 4], inks: [3, 4] }),
      8: T('L', 'none', undefined, false, { require: ['mix'], walls: ['none'], inks: [2, 2], minMixed: 3 }),
      9: T('L', 'none', undefined, false, { require: ['mix'], walls: ['none', 'sym'], inks: [2, 2], minMixed: 3 }),
      10: T('T', 'none', undefined, false, { require: ['mix'], inks: [2, 2], minMixed: 2 }),
      11: T('L', 'none', undefined, false, { require: ['mix', 'walls'], inks: [2, 2], minMixed: 2 }),
      12: T('T', 'none', undefined, false, { require: ['mix'], inks: [2, 3] }),
      13: T('L', 'none', undefined, false, { require: ['mix'], inks: [2, 3] }),
      14: T('N', 'none', undefined, false, { require: ['mix'], inks: [3, 3] }),
      15: T('T', 'none', undefined, false, { require: ['mix'], inks: [3, 3] }),
      17: T('L', 'need', [1, 1], false, { require: ['mix'], inks: [2, 2] }),
      18: T('L', 'opt', [1, 1]),
      19: T('N', 'need', [1, 1]),
      20: T('T', 'need', [1, 2]),
      21: T('L', 'opt', [1, 1]),
      22: T('N', 'opt', [1, 2]),
      23: T('T', 'need', [2, 2]),
      24: T('D', 'need', [1, 2], false, { require: ['walls'], walls: ['bar', 'vbar', 'ring', 'teeth'] }),
      25: T('L', 'opt', [0, 1]),
      26: T('T', 'need', [1, 2]),
      27: T('N', 'opt', [1, 2]),
      28: T('L', 'need', [1, 1]),
      29: T('T', 'need', [2, 2]),
      30: T('B', 'need', [2, 3]),
    };
  }
  if (ch === 2) {
    const three = (k: Kind, t: Timing, tt?: [number, number]) => T(k, t, tt, false, { require: ['three'] });
    return {
      2: T('L', 'need', [1, 1], true),
      3: T('L', 'need', [1, 1], true),
      4: T('N', 'need', [1, 2], true),
      5: T('T', 'need', [1, 2], true),
      6: T('L', 'opt', [1, 1]),
      7: T('N', 'need', [1, 2], true),
      8: T('T', 'need', [2, 2]),
      9: T('L', 'opt', [1, 1]),
      10: T('D', 'need', [1, 2], true, { require: ['walls'], walls: ['bar', 'vbar', 'ring', 'teeth'] }),
      11: T('T', 'need', [1, 2]),
      13: three('L', 'none'),
      14: three('L', 'opt', [1, 1]),
      15: three('N', 'need', [1, 1]),
      16: T('T', 'need', [1, 2]),
      17: T('L', 'opt', [1, 1]),
      18: three('N', 'need', [1, 2]),
      19: T('T', 'need', [2, 2]),
      20: T('L', 'opt', [1, 1]),
      21: T('N', 'need', [1, 2], true),
      22: three('T', 'need', [1, 2]),
      23: T('D', 'need', [1, 2], false, { require: ['three', 'walls'] }),
      24: T('L', 'opt', [1, 1]),
      25: T('N', 'need', [1, 2], true),
      26: T('T', 'need', [2, 3]),
      27: T('L', 'opt', [1, 1]),
      28: three('N', 'need', [1, 2]),
      29: T('T', 'need', [2, 2], true),
      30: T('B', 'need', [2, 3], false, { require: ['three'] }),
    };
  }
  // chapters 3..8 share a sawtooth; M = chapter mechanic required
  const M = ch <= 7;
  const plan: Record<number, Slot> = {
    2: T('L', 'none', undefined, M),
    3: T('L', 'opt', [1, 1], M),
    4: T('N', 'need', [1, 1], M),
    5: T('T', 'need', [1, 2], M),
    6: T('L', 'opt', [1, 1]),
    7: T('N', 'need', [1, 2], M),
    8: T('T', 'need', [1, 2]),
    9: T('L', 'opt', [1, 1], M),
    10: T('D', 'need', [1, 2], M),
    11: T('N', 'need', [1, 2]),
    12: T('L', 'opt', [1, 1], M),
    13: T('T', 'need', [2, 2], M),
    14: T('N', 'opt', [1, 2]),
    15: T('L', 'need', [1, 1], M),
    16: T('T', 'need', [1, 2]),
    17: T('N', 'opt', [1, 2], M),
    18: T('L', 'opt', [1, 1]),
    19: T('D', 'need', [1, 2], M),
    20: T('T', 'need', [1, 2], M),
    21: T('L', 'opt', [1, 1]),
    22: T('N', 'need', [1, 2], M),
    23: T('T', 'need', [2, 2]),
    24: T('L', 'opt', [1, 1], M),
    25: T('N', 'need', [1, 2]),
    26: T('T', 'need', [1, 3], M),
    27: T('L', 'opt', [1, 1]),
    28: T('N', 'need', [1, 2], M),
    29: T('T', 'need', [2, 2], M),
    30: T('B', 'need', [2, 3], M),
  };
  if (ch === 8) {
    plan[1] = T('D', 'need', [1, 2]);
    // grand finale: all three primaries, lots of mixing, a big picture
    plan[30] = T('B', 'need', [2, 3], false, { require: ['three', 'mix'], minMixed: 4, inks: [4, 5], minTargets: 9, maxTargets: 18, shapes: ['lotus8', 'bigpad', 'biglantern', 'bigstar', 'pagoda8', 'bigbell'], shapeP: 1 });
  }
  // discovery twists per chapter
  const twist: Record<number, Partial<Spec>> = {
    3: { rangeP: 0.8 },
    4: { require: ['white', 'walls'], rangeP: 0 },
    5: { seeds: [2, 3] },
    6: { gates: [2, 2] },
    7: { slowCells: [5, 9], parity: 'allow' },
    8: { require: ['three'] },
  };
  if (twist[ch]) {
    plan[10] = { ...plan[10], extra: { ...(plan[10].extra || {}), ...twist[ch] } };
    plan[19] = { ...plan[19], extra: { ...(plan[19].extra || {}), ...twist[ch] } };
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Spec builder
// ---------------------------------------------------------------------------------------------

interface Dims { w: [number, number]; h: [number, number]; cells: [number, number] }

function dimsFor(ch: number, kind: Kind): Dims {
  if (kind === 'B') return ch === 1 ? { w: [7, 7], h: [7, 9], cells: [28, 52] } : { w: [7, 8], h: [8, 10], cells: [34, 66] };
  if (ch === 1) return kind === 'L' ? { w: [5, 7], h: [5, 7], cells: [14, 34] } : { w: [5, 7], h: [5, 8], cells: [16, 42] };
  if (ch === 2) return kind === 'L' ? { w: [5, 7], h: [5, 8], cells: [16, 38] } : { w: [5, 7], h: [6, 9], cells: [20, 48] };
  if (kind === 'L') return { w: [5, 7], h: [5, 9], cells: [16, 44] };
  return { w: [5, 8], h: [6, 10], cells: [22, 58] };
}

function inksFor(ch: number, kind: Kind): [number, number] {
  const t: Record<Kind, [number, number]>[] = [
    { L: [2, 2], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 3] },
    { L: [2, 3], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [1, 2], N: [2, 3], T: [2, 3], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 3], T: [2, 4], D: [2, 3], B: [3, 4] },
    { L: [2, 3], N: [2, 4], T: [3, 4], D: [3, 4], B: [4, 5] },
  ];
  return t[ch - 1][kind];
}

const TAG_OF: Record<Kind, 'light' | 'think' | 'discovery' | 'boss' | undefined> = { L: 'light', N: undefined, T: 'think', D: 'discovery', B: 'boss' };
export const RANDOM_CAP: Record<string, number> = { light: 0.06, think: 0.02, boss: 0.01, discovery: 0.03, normal: 0.03 };

function baseSpec(key: string, known: MechanicKey[], kind: Kind, dims: Dims, inks: [number, number], timing: Timing, timed: [number, number], ch: number): Spec {
  const tag = TAG_OF[kind] || 'normal';
  const light = kind === 'L';
  return {
    key,
    allowed: known.slice(),
    require: ['order'],
    timing: known.includes('timing') ? timing : 'none',
    timed: known.includes('timing') ? timed : [0, 0],
    parity: known.includes('parity') ? 'allow' : 'forbid',
    inks,
    w: dims.w,
    h: dims.h,
    cells: dims.cells,
    walls: known.includes('walls') ? ['none', 'none', 'sym', 'sym', 'pillars', 'bar', 'vbar', 'ring', 'teeth'] : ['none'],
    tag: kind === 'B' ? 'boss' : light ? 'light' : kind === 'T' ? 'think' : 'normal',
    minTargets: kind === 'B' ? 7 : light ? 6 : 5,
    maxTargets: kind === 'B' ? 16 : light ? 10 : kind === 'T' ? 12 : 11,
    pin: kind === 'B' ? 0.9 : light ? 0.35 : kind === 'T' ? 0.85 : 0.6,
    coverTol: light ? 0.01 : 0,
    minCoverage: 0.94,
    minMixed: known.includes('mix') ? 1 : 0,
    maxSettle: kind === 'B' ? LIMITS_SETTLE : light ? 16 : 20,
    maxRandom: RANDOM_CAP[tag === 'discovery' ? 'discovery' : tag],
    maxGreedy: ch >= 2 && !light ? 0.25 : ch === 1 && kind === 'T' ? 0.35 : 1,
    shapes: kind === 'B' ? BOSS_SHAPES : CHAPTER_SHAPES[ch - 1],
    shapeP: kind === 'B' ? 0.85 : 0.6,
  };
}
const LIMITS_SETTLE = 22;

/** Adds optional / required mechanic features to a spec. */
function withMechanics(spec: Spec, require: MechanicKey[], rng: () => number, optP: number): Spec {
  const s: Spec = { ...spec, require: Array.from(new Set([...spec.require, ...require])) };
  const has = (m: MechanicKey) => s.allowed.includes(m);
  const want = (m: MechanicKey) => s.require.includes(m) || (has(m) && rng() < optP);
  if (!has('mix')) s.minMixed = 0;
  if (has('range') && want('range')) {
    s.rangeP = s.rangeP ?? 0.45;
    if (!s.require.includes('range') && rng() < 0.5) s.rangeP = 0.25;
  } else s.rangeP = 0;
  if (has('white') && want('white')) {
    if (!s.require.includes('white')) s.require.push('white');
    s.minCoverage = 0.5;
  } else s.allowed = s.allowed.filter((m) => m !== 'white');
  if (has('seed') && want('seed')) {
    s.seeds = s.seeds || [1, 2];
    if (!s.require.includes('seed')) s.require.push('seed');
  }
  if (has('gate') && want('gate')) {
    s.gates = s.gates || [1, 2];
    if (!s.require.includes('gate')) s.require.push('gate');
  }
  if (has('slow') && want('slow')) {
    s.slowCells = s.slowCells || [2, 7];
    if (!s.require.includes('slow')) s.require.push('slow');
  }
  if (!has('range')) s.rangeP = 0;
  if (s.require.includes('range')) s.rangeP = Math.max(s.rangeP || 0, 0.45);
  if (s.require.includes('white') && s.rangeP === 0 && !s.walls.includes('rooms')) s.walls = ['sym', 'pillars', 'bar', 'ring', 'teeth'];
  if (!has('three')) s.palette = undefined;
  if (s.require.includes('parity')) s.parity = 'need';
  return s;
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

interface Job { idx: number; key: string; spec: Spec; seed: number; want: number; maxAttempts: number }
interface JobResult { idx: number; cands: Candidate[]; stats: GenStats; ms: number }

interface SlotJob { id: string; ch: number; slot: number; kind: Kind; slot0: Slot; jobs: number[]; target: number; spec: Spec }
interface DailyJob { tier: 'light' | 'medium' | 'hard'; jobs: number[] }

function diffTarget(ch: number, slot: number, kind: Kind): number {
  const base = [22, 32, 40, 46, 52, 58, 63, 68][ch - 1];
  const ramp = (8 * (slot - 1)) / 29;
  const off: Record<Kind, number> = { L: -9, N: 0, T: 8, D: 3, B: 14 };
  return base + ramp + off[kind];
}

export function buildJobs(quick: boolean): { jobs: Job[]; slots: SlotJob[]; dailies: DailyJob[] } {
  const jobs: Job[] = [];
  const slots: SlotJob[] = [];
  const add = (key: string, spec: Spec, want: number, maxAttempts: number): number => {
    const idx = jobs.length;
    jobs.push({ idx, key, spec, seed: hash32('inkbloom-v1|' + key), want, maxAttempts });
    return idx;
  };
  for (let ch = 1; ch <= 8; ch++) {
    const plan = chapterPlan(ch);
    for (let s = 1; s <= LEVELS_PER_CHAPTER; s++) {
      const id = 'c' + ch + '-' + String(s).padStart(2, '0');
      if (HANDMADE[id]) continue;
      const sl = plan[s];
      if (!sl) throw new Error('no plan for ' + id);
      const known = knownAt(ch, s);
      const dims = dimsFor(ch, sl.kind);
      const inks = (sl.extra && sl.extra.inks) || inksFor(ch, sl.kind);
      const timed = sl.timed || [0, 0];
      const rng = mulberry32(hash32('spec|' + id));
      let spec = baseSpec(id, known, sl.kind, dims, inks, sl.timing, timed, ch);
      if (sl.extra) spec = { ...spec, ...sl.extra, require: spec.require };
      const req: MechanicKey[] = [...((sl.extra && sl.extra.require) || [])];
      const cm = CHAPTER_MECH[ch - 1];
      if (sl.newMech && cm) req.push(cm);
      if (ch >= 2 && !req.includes('mix') && known.includes('mix') && rng() < 0.85) req.push('mix');
      spec = withMechanics(spec, req, rng, ch === 8 ? 0.45 : 0.25);
      if (sl.extra && sl.extra.allowed) spec.allowed = sl.extra.allowed.slice();
      if (sl.extra && sl.extra.require) spec.require = Array.from(new Set([...spec.require.filter((m) => spec.allowed.includes(m)), ...sl.extra.require]));
      const finale = id === 'c8-30';
      const want = quick ? 2 : finale ? 12 : sl.kind === 'B' ? 6 : 5;
      const maxA = quick ? 60 : finale ? 1500 : sl.kind === 'B' ? 700 : 450;
      const j1 = add(id + '#a', spec, want, maxA);
      slots.push({ id, ch, slot: s, kind: sl.kind, slot0: sl, jobs: [j1], target: diffTarget(ch, s, sl.kind), spec });
    }
  }
  // ---- daily pool
  const dailies: DailyJob[] = [];
  const tiers: ('light' | 'medium' | 'hard')[] = ['light', 'medium', 'hard'];
  for (const tier of tiers) {
    const dj: DailyJob = { tier, jobs: [] };
    const groups = quick ? 6 : 40;
    for (let g = 0; g < groups; g++) {
      const key = 'daily-' + tier + '-' + g;
      const rng = mulberry32(hash32('spec|' + key));
      // one group in eight: basic rules without waiting, so players who just unlocked dailies get every tier
      const early = g % 8 === 0;
      const basicOnly = early || (tier === 'light' ? g % 10 < 7 : tier === 'medium' ? g % 10 < 4 : g % 10 < 4);
      const ch = tier === 'light' ? (g % 3 === 0 ? 1 : 2) : tier === 'medium' ? 3 + (g % 3) : 6 + (g % 3);
      let known: MechanicKey[];
      if (basicOnly) known = BASIC_MECHANICS.slice();
      else if (tier === 'light') known = [...BASIC_MECHANICS, 'three'];
      else known = knownAt(ch, 30);
      const kinds: Kind[] = tier === 'light' ? ['L', 'L', 'N'] : tier === 'medium' ? ['N', 'T', 'N'] : ['T', 'T', 'N'];
      const kind = kinds[g % 3];
      const timingOpts: Timing[] = tier === 'light' ? ['none', 'opt', 'need', 'need'] : ['opt', 'need', 'need', 'need'];
      const timing: Timing = early ? 'none' : timingOpts[g % 4];
      const timed: [number, number] = tier === 'hard' ? [1, 3] : tier === 'medium' ? [1, 2] : [1, 1];
      const dims = tier === 'hard' && g % 5 === 0 ? dimsFor(ch, 'B') : dimsFor(ch, kind === 'L' ? 'L' : 'N');
      const inks: [number, number] = tier === 'light' ? [2, 3] : tier === 'medium' ? [2, 3] : [2, 4];
      let spec = baseSpec(key, known, kind, dims, inks, timing, timed, ch);
      spec.shapes = CHAPTER_SHAPES[(g * 7 + tiers.indexOf(tier)) % 8];
      spec.maxRandom = tier === 'light' ? 0.06 : tier === 'medium' ? 0.02 : 0.01;
      spec.maxGreedy = tier === 'light' ? 1 : 0.25;
      const req: MechanicKey[] = [];
      if (!basicOnly) {
        const cm = tier === 'light' ? 'three' : CHAPTER_MECH[ch - 1];
        if (cm) req.push(cm);
      }
      if (known.includes('mix') && rng() < 0.85) req.push('mix');
      spec = withMechanics(spec, req, rng, tier === 'hard' ? 0.35 : 0.2);
      if (early) {
        spec.allowed = ['drop', 'walls', 'order', 'mix'];
        spec.require = ['order', 'mix'];
        spec.parity = 'forbid';
        if (tier !== 'light') spec.inks = [3, 4];
      }
      const want = quick ? 2 : 6;
      dj.jobs.push(add(key, spec, want, quick ? 40 : 320));
    }
    dailies.push(dj);
  }
  return { jobs, slots, dailies };
}

// ---------------------------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------------------------

export function runJob(job: Job): JobResult {
  const t0 = Date.now();
  const rng = mulberry32(job.seed);
  const st: GenStats = { attempts: 0, terrain: 0, plan: 0, filter: 0, cover: 0, measure: 0, ok: 0 };
  const cands: Candidate[] = [];
  for (let a = 0; a < job.maxAttempts && cands.length < job.want; a++) {
    const c = makeCandidate(rng, job.spec, job.key + '~' + a, st);
    if (c) cands.push(c);
  }
  return { idx: job.idx, cands, stats: st, ms: Date.now() - t0 };
}

interface MeasureTask { idx: number; def: LevelDef }
interface MeasureResult { idx: number; metrics: Metrics }

if (!isMainThread) {
  const wd = workerData as { mode: string };
  parentPort!.on('message', (msg: { job?: Job; measure?: MeasureTask; stop?: boolean }) => {
    if (msg.stop) process.exit(0);
    if (msg.job) parentPort!.postMessage({ result: runJob(msg.job) });
    if (msg.measure) parentPort!.postMessage({ measured: { idx: msg.measure.idx, metrics: measureFinal(msg.measure.def) } as MeasureResult });
  });
  void wd;
}

/** Final measurement (content-seeded, identical to what verify-levels.ts computes). */
export function measureFinal(def: LevelDef): Metrics {
  return measure(def);
}

// ---------------------------------------------------------------------------------------------
// Main side
// ---------------------------------------------------------------------------------------------

async function runPool<T, R>(tasks: T[], nWorkers: number, wrap: (t: T) => object, unwrap: (m: any) => R | undefined, onDone?: (n: number) => void): Promise<R[]> {
  const results: R[] = [];
  let next = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    if (!tasks.length) return resolve();
    const workers: Worker[] = [];
    const n = Math.min(nWorkers, tasks.length);
    for (let w = 0; w < n; w++) {
      const wk = new Worker(new URL(import.meta.url), { workerData: { mode: 'gen' } });
      workers.push(wk);
      wk.on('error', reject);
      wk.on('message', (m: any) => {
        const r = unwrap(m);
        if (r !== undefined) {
          results.push(r);
          done++;
          if (onDone) onDone(done);
        }
        if (next < tasks.length) wk.postMessage(wrap(tasks[next++]));
        else wk.postMessage({ stop: true });
        if (done === tasks.length) resolve();
      });
      wk.postMessage(wrap(tasks[next++]));
    }
  });
  return results;
}

function fmtLevel(def: LevelDef, extra: Record<string, unknown> = {}): string {
  const o: Record<string, unknown> = {
    id: def.id, map: def.map, goal: def.goal, inks: def.inks, solution: def.solution,
  };
  if (def.tempo) o.tempo = def.tempo;
  if (def.intro) o.intro = def.intro;
  if (def.guided) o.guided = true;
  if (def.tag) o.tag = def.tag;
  if (def.diff !== undefined) o.diff = def.diff;
  Object.assign(o, extra);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'solution') parts.push(k + ': [' + (v as { x: number; y: number; t: number }[]).map((d) => '{ x: ' + d.x + ', y: ' + d.y + ', t: ' + d.t + ' }').join(', ') + ']');
    else parts.push(k + ': ' + JSON.stringify(v).replace(/","/g, "', '").replace(/\["/g, "['").replace(/"\]/g, "']").replace(/^"(.*)"$/, "'$1'"));
  }
  return '{ ' + parts.join(', ') + ' }';
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const wi = args.indexOf('--workers');
  const nW = wi >= 0 ? +args[wi + 1] : Math.max(1, Math.min(8, cpus().length));
  const t0 = Date.now();
  const { jobs, slots, dailies } = buildJobs(quick);
  // optional dev cache (--cache file): keyed by job spec + a hash of the generator/simulator sources
  const ci = args.indexOf('--cache');
  const cacheFile = ci >= 0 ? args[ci + 1] : '';
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const coreSrc = self.slice(self.indexOf('// <core>'), self.indexOf('// </core>'));
  const codeHash = hash32([coreSrc, ...['tools/level-lib.ts', 'src/core/sim.ts'].map((f) => readFileSync(ROOT + f, 'utf8'))].join('\n'));
  const sig = (j: Job) => String(hash32(JSON.stringify(j.spec) + '|' + j.seed + '|' + j.want + '|' + j.maxAttempts + '|' + codeHash));
  const cache: Record<string, { sig: string; result: JobResult }> = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const cached: JobResult[] = [];
  const todoJobs = jobs.filter((j) => {
    const c = cache[j.key];
    if (c && c.sig === sig(j)) {
      cached.push({ ...c.result, idx: j.idx });
      return false;
    }
    return true;
  });
  console.log('jobs: ' + jobs.length + (cached.length ? ' (' + cached.length + ' cached)' : '') + '  workers: ' + nW + (quick ? '  (quick)' : ''));
  let lastPct = -1;
  const res = await runPool<Job, JobResult>(todoJobs, nW, (j) => ({ job: j }), (m) => m.result, (d) => {
    const pct = Math.floor((d * 20) / jobs.length) * 5;
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(pct + '% ');
    }
  });
  console.log('\ngenerated in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (cacheFile) {
    for (const r of res) cache[jobs[r.idx].key] = { sig: sig(jobs[r.idx]), result: r };
  }
  res.push(...cached);
  const byIdx = new Map<number, JobResult>();
  for (const r of res) byIdx.set(r.idx, r);
  // phase 2: relaxed specs for slots that found nothing usable
  const extra: Job[] = [];
  for (const sj of slots) {
    const pool = byIdx.get(sj.jobs[0])!.cands;
    if (pool.filter((c) => okFor(c, sj, 0)).length >= 2) continue;
    const sp = sj.spec;
    const relaxed: Spec = { ...sp, key: sp.key + '-relaxed', pin: Math.max(0.3, sp.pin - 0.3), maxTargets: Math.min(18, sp.maxTargets + 3), w: [Math.max(4, sp.w[0] - 1), sp.w[1]], cells: [Math.max(12, sp.cells[0] - 4), sp.cells[1] + 4], inks: [sp.inks[0], Math.min(5, sp.inks[1] + (sp.inks[1] < 3 ? 1 : 0))] };
    const idx = jobs.length + extra.length;
    extra.push({ idx, key: sj.id + '#b', spec: relaxed, seed: hash32('inkbloom-v1|' + sj.id + '#b'), want: quick ? 2 : 4, maxAttempts: quick ? 60 : 900 });
    sj.jobs.push(idx);
  }
  if (extra.length) {
    console.log('phase 2: ' + extra.length + ' relaxed jobs (' + slots.filter((s) => s.jobs.length > 1).map((s) => s.id).join(' ') + ')');
    const run2: Job[] = [];
    for (const j of extra) {
      const c = cache[j.key];
      if (c && c.sig === sig(j)) byIdx.set(j.idx, { ...c.result, idx: j.idx });
      else run2.push(j);
    }
    const res2 = await runPool<Job, JobResult>(run2, nW, (j) => ({ job: j }), (m) => m.result);
    const exByIdx = new Map(extra.map((j) => [j.idx, j]));
    for (const r of res2) {
      byIdx.set(r.idx, r);
      if (cacheFile) cache[exByIdx.get(r.idx)!.key] = { sig: sig(exByIdx.get(r.idx)!), result: r };
    }
    res.push(...res2);
  }
  if (cacheFile) writeFileSync(cacheFile, JSON.stringify(cache));
  const tot: GenStats = { attempts: 0, terrain: 0, plan: 0, filter: 0, cover: 0, measure: 0, ok: 0 };
  for (const r of res) for (const k of Object.keys(tot) as (keyof GenStats)[]) tot[k] += r.stats[k];
  console.log('attempts ' + JSON.stringify(tot));

  // ---------------- selection (per chapter; raise a chapter's targets until its average beats the previous one)
  const metricsOf = new Map<string, Metrics>();
  let usedCanon = new Set<string>();
  let terrainUse = new Map<string, number>();
  const campaign: LevelDef[][] = [];
  for (const hm of Object.values(HANDMADE)) usedCanon.add(canonKey(hm));
  const problems: string[] = [];
  const pickChapter = (ch: number, offset: number) => {
    const used = new Set(usedCanon);
    const tUse = new Map(terrainUse);
    const list: LevelDef[] = [];
    const mets = new Map<string, Metrics>();
    const probs: string[] = [];
    let prevRandom = 0;
    let sum = 0;
    for (let s = 1; s <= LEVELS_PER_CHAPTER; s++) {
      const id = 'c' + ch + '-' + String(s).padStart(2, '0');
      if (HANDMADE[id]) {
        list.push({ ...HANDMADE[id] });
        prevRandom = 0;
        sum += handDiff.get(id)!;
        continue;
      }
      const sj = slots.find((x) => x.id === id)!;
      const pool: Candidate[] = [];
      for (const j of sj.jobs) pool.push(...byIdx.get(j)!.cands);
      const usable = pool.filter((c) => okFor(c, sj, prevRandom) && !used.has(canonKey(c.def)));
      if (!usable.length) {
        probs.push(id + ': no usable candidate (' + pool.length + ' generated)');
        continue;
      }
      const target = sj.target + offset;
      usable.sort((a, b) => score(a, sj, tUse, target) - score(b, sj, tUse, target));
      const c = usable[0];
      const def: LevelDef = { ...c.def, id };
      const tag = TAG_OF[sj.kind];
      if (tag) def.tag = tag;
      used.add(canonKey(def));
      const tk = terrainKey(def);
      tUse.set(tk, (tUse.get(tk) || 0) + 1);
      prevRandom = c.metrics.random;
      mets.set(id, c.metrics);
      list.push(def);
      sum += c.metrics.diff;
    }
    return { list, mets, used, tUse, probs, avg: sum / LEVELS_PER_CHAPTER };
  };
  // handmade levels are measured up front (their diff counts toward the chapter average)
  const handDefs = Object.values(HANDMADE);
  const handMeas = await runPool<MeasureTask, MeasureResult>(handDefs.map((def, idx) => ({ idx, def })), nW, (t) => ({ measure: t }), (m) => m.measured);
  const handDiff = new Map<string, number>();
  for (const m of handMeas) {
    handDiff.set(handDefs[m.idx].id, m.metrics.diff);
    metricsOf.set(handDefs[m.idx].id, m.metrics);
  }
  let prevAvg = -1;
  for (let ch = 1; ch <= 8; ch++) {
    let offset = 0;
    let r = pickChapter(ch, offset);
    while (ch > 1 && r.avg <= prevAvg + 1.5 && offset < 40) {
      offset += 2;
      r = pickChapter(ch, offset);
    }
    console.log('chapter ' + ch + ': avg diff ' + r.avg.toFixed(1) + (offset ? ' (targets +' + offset + ')' : ''));
    prevAvg = r.avg;
    usedCanon = r.used;
    terrainUse = r.tUse;
    problems.push(...r.probs);
    for (const [k, v] of r.mets) metricsOf.set(k, v);
    campaign.push(r.list);
  }
  // ---------------- daily pool
  const daily: (LevelDef & { tier: string; uses: MechanicKey[] })[] = [];
  const PER_TIER = quick ? 20 : 140;
  for (const dj of dailies) {
    const all: Candidate[] = [];
    for (const j of dj.jobs) all.push(...byIdx.get(j)!.cands);
    // round-robin over groups for variety
    // best pictures first (no blank paper, colourful), then harder ones
    const pq = (c: Candidate) => c.info.blanks * 6 - Math.min(4, c.info.colours) - c.metrics.diff / 25;
    const perGroup = dj.jobs.map((j) => byIdx.get(j)!.cands.slice().sort((a, b) => pq(a) - pq(b)));
    let n = 0, round = 0;
    while (n < PER_TIER && round < 20) {
      for (const g of perGroup) {
        if (n >= PER_TIER) break;
        const c = g[round];
        if (!c) continue;
        const ck = canonKey(c.def);
        if (usedCanon.has(ck)) continue;
        const tk = terrainKey(c.def);
        if ((terrainUse.get(tk) || 0) >= 3) continue;
        usedCanon.add(ck);
        terrainUse.set(tk, (terrainUse.get(tk) || 0) + 1);
        n++;
        const id = 'd-' + dj.tier + '-' + String(n).padStart(3, '0');
        metricsOf.set(id, c.metrics);
        daily.push({ ...c.def, id, tag: dj.tier === 'light' ? 'light' : 'think', tier: dj.tier, uses: c.uses });
      }
      round++;
    }
    if (n < PER_TIER) problems.push('daily ' + dj.tier + ': only ' + n);
  }
  if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));

  // ---------------- measure the handmade levels (generated ones carry their metrics) -> diff + report
  const flat: LevelDef[] = [...campaign.flat(), ...daily];
  const todo = flat.filter((d) => !metricsOf.has(d.id));
  const meas = await runPool<MeasureTask, MeasureResult>(todo.map((def, idx) => ({ idx, def })), nW, (t) => ({ measure: t }), (m) => m.measured);
  for (const m of meas) metricsOf.set(todo[m.idx].id, m.metrics);
  for (const def of flat) def.diff = metricsOf.get(def.id)!.diff;

  // ---------------- write files
  const campLines: string[] = [];
  campLines.push('// Generated by tools/gen-levels.ts — do not edit by hand (npm run levels:gen).');
  campLines.push("import type { LevelDef } from '../../core/sim.ts';");
  campLines.push('');
  campLines.push('export const CAMPAIGN: LevelDef[][] = [');
  for (const list of campaign) {
    campLines.push('  [');
    for (const def of list) campLines.push('    ' + fmtLevel(def) + ',');
    campLines.push('  ],');
  }
  campLines.push('];');
  writeFileSync(ROOT + 'src/levels/data/campaign.ts', campLines.join('\n') + '\n');
  const dLines: string[] = [];
  dLines.push('// Generated by tools/gen-levels.ts — do not edit by hand (npm run levels:gen).');
  dLines.push("import type { DailyDef } from '../pack.ts';");
  dLines.push('');
  dLines.push('export const DAILY_POOL: DailyDef[] = [');
  for (const def of daily) {
    const { tier, uses, ...rest } = def;
    dLines.push('  ' + fmtLevel(rest as LevelDef, { tier, uses }) + ',');
  }
  dLines.push('];');
  writeFileSync(ROOT + 'src/levels/data/daily.ts', dLines.join('\n') + '\n');
  const rows: ReportRow[] = flat.map((def) => ({ def, metrics: metricsOf.get(def.id)!, uses: usesOf(def) }));
  writeFileSync(ROOT + 'tools/level-report.md', buildReport(rows));
  console.log('wrote campaign (' + campaign.flat().length + '), daily (' + daily.length + '), report. total ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (problems.length) process.exitCode = 1;
}

function okFor(c: Candidate, sj: SlotJob, prevRandom: number): boolean {
  const tag = TAG_OF[sj.kind] || 'normal';
  const cap = RANDOM_CAP[tag];
  if (c.metrics.random >= cap) return false;
  if (prevRandom >= 0.03 && c.metrics.random >= 0.03) return false;
  if (sj.slot0.timing === 'need' && c.metrics.needsTiming !== true) return false;
  if (sj.ch >= 2 && sj.kind !== 'L' && c.metrics.greedy >= 0.25) return false;
  return true;
}

function score(c: Candidate, sj: SlotJob, terrainUse: Map<string, number>, target: number): number {
  let s = Math.abs(c.metrics.diff - target);
  // timing is the core skill: where the slot allows it, prefer two or more timed drops
  if (sj.slot0.timed && sj.slot0.timed[1] >= 2 && c.metrics.timedDrops >= 2) s -= 5;
  s += (terrainUse.get(terrainKey(c.def)) || 0) * 12;
  // the finished board is the reward picture: avoid blank paper, like colour
  s += c.info.blanks * 3;
  s -= Math.min(4, c.info.colours) * (sj.kind === 'B' ? 3 : 1);
  s -= Math.min(4, c.info.mixed) * (sj.kind === 'B' ? 1 : 0.3);
  if (c.metrics.settleTick > 16) s += (c.metrics.settleTick - 16) * 0.8;
  return s;
}

if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

