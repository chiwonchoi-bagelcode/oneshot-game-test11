/*
 * Core B — one-stroke painting: the rules, shared by the game (core.ts), the verifier and the
 * solver (tools/cores/b). Pure logic, no DOM; keep it free of TS-only runtime features so Node can
 * run it directly.
 *
 * Rules
 *  - Every paper cell of the board is part of the picture and has a goal colour.
 *  - Each source (a dormant drop: map 'r' 'y' 'b') owns one stroke: a path that starts on the
 *    source and grows one orthogonal cell at a time. Nothing spreads by itself.
 *  - A stroke can't enter stones, holes or another source, can't cross itself, and can't overlap a
 *    stroke of its own colour. Strokes of different colours may overlap: the cell mixes
 *    (yellow + blue = green, red + yellow = orange, red + blue = purple, all three = mud).
 *  - The picture is done when every cell shows its goal colour. There is no fail state.
 */
import type { LevelDef } from '../../core/sim.ts';

export const COLOR_BITS: Record<string, number> = { R: 1, Y: 2, O: 3, B: 4, P: 5, G: 6, K: 7 };
const SRC_CHARS: Record<string, number> = { r: 1, y: 2, b: 4 };

export interface Source { idx: number; c: number }

export interface BLevel {
  def: LevelDef;
  w: number;
  h: number;
  n: number;
  /** 1 = picture cell (paper or source). */
  open: Uint8Array;
  /** Source index at a cell, -1 elsewhere. */
  srcAt: Int16Array;
  /** Sources in reading order (row by row). Stroke k belongs to source k. */
  sources: Source[];
  /** Goal colour bits per picture cell (0 elsewhere). */
  goal: Uint8Array;
  /** Picture cells. */
  cells: number[];
}

export function prepare(def: LevelDef): BLevel {
  const h = def.map.length, w = def.map[0].length, n = w * h;
  const open = new Uint8Array(n), goal = new Uint8Array(n), srcAt = new Int16Array(n).fill(-1);
  const sources: Source[] = [], cells: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, ch = def.map[y][x], g = def.goal[y][x];
      if (ch === '.' || SRC_CHARS[ch]) {
        open[i] = 1;
        cells.push(i);
        goal[i] = COLOR_BITS[g] || 0;
        if (SRC_CHARS[ch]) {
          srcAt[i] = sources.length;
          sources.push({ idx: i, c: SRC_CHARS[ch] });
        }
      }
    }
  }
  return { def, w, h, n, open, srcAt, sources, goal, cells };
}

export function adjacent(lv: BLevel, a: number, b: number): boolean {
  if (a < 0 || b < 0) return false;
  const ax = a % lv.w, bx = b % lv.w;
  return (Math.abs(a - b) === lv.w) || (Math.abs(a - b) === 1 && Math.abs(ax - bx) === 1);
}

export function neighbors(lv: BLevel, i: number): number[] {
  const w = lv.w, x = i % w, out: number[] = [];
  if (i >= w) out.push(i - w);
  if (x < w - 1) out.push(i + 1);
  if (i + w < lv.n) out.push(i + w);
  if (x > 0) out.push(i - 1);
  return out;
}

/** Why a stroke can't step into a cell (null = it can). */
export type Block = null | 'off' | 'far' | 'wall' | 'source' | 'self' | 'same';

export class Board {
  readonly lv: BLevel;
  strokes: number[][];
  /** Colour bits per cell (OR of the strokes covering it). */
  ink: Uint8Array;

  constructor(lv: BLevel, strokes?: number[][]) {
    this.lv = lv;
    this.strokes = strokes ? strokes.map((s) => s.slice()) : lv.sources.map((s) => [s.idx]);
    this.ink = new Uint8Array(lv.n);
    this.recompute();
  }

  snapshot(): number[][] {
    return this.strokes.map((s) => s.slice());
  }

  restore(snap: number[][]): void {
    this.strokes = snap.map((s) => s.slice());
    this.recompute();
  }

  recompute(): void {
    this.ink.fill(0);
    this.strokes.forEach((p, k) => {
      const c = this.lv.sources[k].c;
      for (const i of p) this.ink[i] |= c;
    });
  }

  colorOf(k: number): number {
    return this.lv.sources[k].c;
  }

  end(k: number): number {
    const p = this.strokes[k];
    return p[p.length - 1];
  }

  /** Strokes (indices) covering cell i, most recent first is up to the caller. */
  strokesAt(i: number): number[] {
    const out: number[] = [];
    this.strokes.forEach((p, k) => { if (p.indexOf(i) >= 0) out.push(k); });
    return out;
  }

  /**
   * Can stroke k, cut back to its first `len` cells, step from its last kept cell into n?
   */
  blockFor(k: number, n: number, len = this.strokes[k].length): Block {
    const lv = this.lv, p = this.strokes[k];
    if (n < 0 || n >= lv.n) return 'off';
    if (!adjacent(lv, p[len - 1], n)) return 'far';
    if (!lv.open[n]) return 'wall';
    if (lv.srcAt[n] >= 0) return 'source';
    for (let j = 0; j < len; j++) if (p[j] === n) return 'self';
    const c = lv.sources[k].c;
    for (let m = 0; m < this.strokes.length; m++) {
      if (m === k || lv.sources[m].c !== c) continue;
      if (this.strokes[m].indexOf(n) >= 0) return 'same';
    }
    return null;
  }

  /** Cut stroke k back to its first len cells (len >= 1). */
  truncate(k: number, len: number): number[] {
    const p = this.strokes[k];
    const removed = p.splice(Math.max(1, len));
    if (removed.length) this.recompute();
    return removed;
  }

  extend(k: number, n: number): boolean {
    if (this.blockFor(k, n) !== null) return false;
    this.strokes[k].push(n);
    this.ink[n] |= this.lv.sources[k].c;
    return true;
  }

  /** Cells whose ink has a colour the goal doesn't want. */
  wrongCells(): number[] {
    const out: number[] = [];
    for (const i of this.lv.cells) if (this.ink[i] & ~this.lv.goal[i]) out.push(i);
    return out;
  }

  /** Cells of the goal still missing colour c (c = 0: missing any colour). */
  missing(c = 0): number[] {
    const out: number[] = [];
    for (const i of this.lv.cells) {
      const g = this.lv.goal[i], k = this.ink[i];
      if (c ? (g & c) && !(k & c) : (g & ~k) !== 0) out.push(i);
    }
    return out;
  }

  isWin(): boolean {
    for (const i of this.lv.cells) if (this.ink[i] !== this.lv.goal[i]) return false;
    return true;
  }

  /** Number of cells drawn beyond the sources. */
  drawn(): number {
    let n = 0;
    for (const p of this.strokes) n += p.length - 1;
    return n;
  }
}

/** Solution strokes of a level as cell indices (one per source, in source order). */
export function solutionStrokes(lv: BLevel): number[][] {
  const out: number[][] = lv.sources.map((s) => [s.idx]);
  // Match by start cell: mirrored copies (dailies) change the reading order of the drops.
  for (const s of lv.def.strokes || []) {
    const cells = s.map((p) => p.y * lv.w + p.x);
    const k = lv.srcAt[cells[0]];
    if (k >= 0) out[k] = cells;
  }
  return out;
}

/** Plays solution strokes through the same step rules as the game. */
export function playStrokes(lv: BLevel, strokes: number[][]): { ok: boolean; board: Board; errors: string[] } {
  const board = new Board(lv);
  const errors: string[] = [];
  if (strokes.length !== lv.sources.length) errors.push(`strokes ${strokes.length} != sources ${lv.sources.length}`);
  strokes.forEach((s, k) => {
    if (k >= lv.sources.length) return;
    if (s[0] !== lv.sources[k].idx) errors.push(`stroke ${k} doesn't start on its source`);
    for (let j = 1; j < s.length; j++) {
      const b = board.blockFor(k, s[j]);
      if (b) { errors.push(`stroke ${k} step ${j} -> ${s[j]} blocked: ${b}`); break; }
      board.extend(k, s[j]);
    }
  });
  return { ok: !errors.length && board.isWin(), board, errors };
}
