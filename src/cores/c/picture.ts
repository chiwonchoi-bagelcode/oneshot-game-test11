/*
 * Core C (colouring book) — picture model and rules, free of DOM so the game, the level builder
 * and the Node verifier all use exactly the same code.
 *
 * A picture is a grid of regions (one letter per cell, '.' = plain paper, ' ' = outside the page).
 * The same letter in separate places is one *linked* region: a single pour colours every part.
 * Each region has a target colour (bit flags R=1 Y=2 B=4, mixes are ORs, K=7 brown), or stays
 * white ('w': cannot be painted), or is a secret '?' region (target hidden; on limited stages it
 * takes the drops left over once everything else is painted).
 *
 * Rules
 *  - Pour colour c into a region: its colour becomes state | c (a second colour mixes in).
 *    Pouring a colour that is already in the region changes nothing (and costs nothing).
 *  - Water washes a region clean (state 0) and gives its drops back on limited stages.
 *  - Limited stages: each colour has a number of drops; one pour uses one drop (linked parts too).
 *  - Done when every colour region matches its target. White regions can never be painted.
 */
import type { LevelDef, Drop } from '../../core/sim.ts';

/** Decoration drawn as line art over the picture (cell units; 0,0 = top-left corner of the grid). */
export interface Deco {
  /** Polyline (x0,y0,x1,y1,…), drawn smooth. */
  l?: number[];
  /** Filled dot [x, y, r]. */
  d?: number[];
  /** Circle outline [x, y, r]. */
  o?: number[];
}

export interface CLevel extends LevelDef {
  /** Region letter → target: 'R' 'Y' 'B' 'O' 'P' 'G' 'K' or 'w' (stays white). */
  paint: Record<string, string>;
  /** Secret regions (letters): no colour shown; they take the leftover drops. */
  secret?: string;
  /** Line art (strings, stems, eyes…). */
  deco?: Deco[];
  /** Short picture name key (c.pic.<name>). */
  pic?: string;
}

export const COLOR_BITS: Record<string, number> = { R: 1, Y: 2, B: 4, O: 3, P: 5, G: 6, K: 7, w: 0 };
export const PRIMS = [1, 2, 4];
export const PRIM_CHAR: Record<number, string> = { 1: 'R', 2: 'Y', 4: 'B' };

export interface Region {
  key: string;
  /** Target colour bits (0 for white). */
  goal: number;
  white: boolean;
  secret: boolean;
  cells: number[];
  /** Connected parts, largest first. */
  comps: number[][];
  /** Label cell (most interior) of each part. */
  labels: number[];
}

export interface Picture {
  w: number;
  h: number;
  /** Region index per cell, -1 for paper / outside. */
  regionOf: Int16Array;
  regions: Region[];
  /** Colour regions only (indices). */
  colourRegions: number[];
  hole: Uint8Array;
}

const NB = (i: number, w: number, h: number): number[] => {
  const x = i % w, y = (i - x) / w, out: number[] = [];
  if (y > 0) out.push(i - w);
  if (x < w - 1) out.push(i + 1);
  if (y < h - 1) out.push(i + w);
  if (x > 0) out.push(i - 1);
  return out;
};
export { NB as neighbours };

export function analyse(def: CLevel): Picture {
  const rows = def.regions || [];
  const h = def.map.length, w = def.map[0].length;
  const regionOf = new Int16Array(w * h).fill(-1);
  const hole = new Uint8Array(w * h);
  const keys: string[] = [];
  const secret = def.secret || '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (def.map[y][x] === ' ') hole[i] = 1;
    const ch = rows[y] ? rows[y][x] : '.';
    if (!ch || ch === '.' || ch === ' ') continue;
    let k = keys.indexOf(ch);
    if (k < 0) { k = keys.length; keys.push(ch); }
    regionOf[i] = k;
  }
  const regions: Region[] = keys.map((key) => {
    const p = def.paint[key];
    if (p === undefined) throw new Error(def.id + ': region ' + key + ' has no paint');
    return { key, goal: COLOR_BITS[p] ?? 0, white: p === 'w', secret: secret.includes(key), cells: [], comps: [], labels: [] };
  });
  for (let i = 0; i < w * h; i++) if (regionOf[i] >= 0) regions[regionOf[i]].cells.push(i);
  regions.forEach((r, ri) => {
    const seen = new Set<number>();
    for (const c of r.cells) {
      if (seen.has(c)) continue;
      const comp: number[] = [];
      const q = [c];
      seen.add(c);
      while (q.length) {
        const a = q.shift()!;
        comp.push(a);
        for (const n of NB(a, w, h)) if (regionOf[n] === ri && !seen.has(n)) { seen.add(n); q.push(n); }
      }
      comp.sort((a, b) => a - b);
      r.comps.push(comp);
    }
    r.comps.sort((a, b) => b.length - a.length || a[0] - b[0]);
    r.labels = r.comps.map((comp) => labelCell(comp, w, h));
  });
  const colourRegions = regions.map((_, i) => i).filter((i) => !regions[i].white);
  return { w, h, regionOf, regions, colourRegions, hole };
}

/** The most interior cell of a part (ties: closest to its centre, then reading order). */
function labelCell(comp: number[], w: number, h: number): number {
  const inComp = new Set(comp);
  const dist = new Map<number, number>();
  const q: number[] = [];
  for (const c of comp) {
    const x = c % w, y = (c - x) / w;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || NB(c, w, h).some((n) => !inComp.has(n));
    if (edge) { dist.set(c, 0); q.push(c); }
  }
  while (q.length) {
    const a = q.shift()!;
    for (const n of NB(a, w, h)) if (inComp.has(n) && !dist.has(n)) { dist.set(n, dist.get(a)! + 1); q.push(n); }
  }
  let cx = 0, cy = 0;
  for (const c of comp) { cx += c % w; cy += Math.floor(c / w); }
  cx /= comp.length; cy /= comp.length;
  let best = comp[0], bd = -1, bc = Infinity;
  for (const c of comp) {
    const d = dist.get(c) ?? 0;
    const x = c % w, y = (c - x) / w;
    const dc = (x - cx) ** 2 + (y - cy) ** 2;
    if (d > bd || (d === bd && dc < bc - 1e-9)) { best = c; bd = d; bc = dc; }
  }
  return best;
}

/** Breadth-first rings through one part from a start cell: [[start], [dist 1…], …] plus parents. */
export function rings(comp: number[], start: number, w: number, h: number): { rings: number[][]; parent: Map<number, number> } {
  const inComp = new Set(comp);
  const parent = new Map<number, number>([[start, -1]]);
  const out: number[][] = [[start]];
  let cur = [start];
  while (cur.length) {
    const next: number[] = [];
    for (const a of cur) for (const n of NB(a, w, h)) if (inComp.has(n) && !parent.has(n)) { parent.set(n, a); next.push(n); }
    if (next.length) out.push(next);
    cur = next;
  }
  return { rings: out, parent };
}

export function bitsOf(c: number): number[] {
  return PRIMS.filter((p) => c & p);
}

export function popcount(c: number): number {
  return (c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1);
}

/** Drop limits of a level: null = unlimited, else drops left per primary (index by bit). */
export function limitsOf(def: LevelDef): Record<number, number> | null {
  if (!def.inks || !def.inks.length) return null;
  const out: Record<number, number> = { 1: 0, 2: 0, 4: 0 };
  for (const s of def.inks) out[COLOR_BITS[s[0]]]++;
  return out;
}

export type PourResult = 'ok' | 'paper' | 'white' | 'already' | 'empty' | 'clean' | 'washed';

/** The rules, as a tiny state machine (used by the game core and the verifier). */
export class Board {
  readonly pic: Picture;
  state: Uint8Array;
  left: Record<number, number> | null;
  pours = 0;

  constructor(pic: Picture, limits: Record<number, number> | null) {
    this.pic = pic;
    this.state = new Uint8Array(pic.regions.length);
    this.left = limits ? { ...limits } : null;
  }

  clone(): Board {
    const b = new Board(this.pic, this.left);
    b.state = this.state.slice();
    b.pours = this.pours;
    return b;
  }

  /** What a pour of tool (1/2/4, or 0 = water) into cell idx would do. */
  check(idx: number, tool: number): PourResult {
    const r = idx >= 0 ? this.pic.regionOf[idx] : -1;
    if (r < 0) return 'paper';
    const R = this.pic.regions[r];
    if (R.white) return 'white';
    if (tool === 0) return this.state[r] ? 'washed' : 'clean';
    if (this.state[r] & tool) return 'already';
    if (this.left && !(this.left[tool] > 0)) return 'empty';
    return 'ok';
  }

  /** Applies a pour/wash. Returns the result ('ok' / 'washed' change the board). */
  apply(idx: number, tool: number): PourResult {
    const res = this.check(idx, tool);
    const r = idx >= 0 ? this.pic.regionOf[idx] : -1;
    if (res === 'ok') {
      this.state[r] |= tool;
      if (this.left) this.left[tool]--;
      this.pours++;
    } else if (res === 'washed') {
      if (this.left) for (const b of bitsOf(this.state[r])) this.left[b]++;
      this.state[r] = 0;
    }
    return res;
  }

  regionDone(r: number): boolean {
    return this.state[r] === this.pic.regions[r].goal;
  }

  done(): boolean {
    for (const r of this.pic.colourRegions) if (!this.regionDone(r)) return false;
    return true;
  }

  doneCount(): number {
    let n = 0;
    for (const r of this.pic.colourRegions) if (this.regionDone(r)) n++;
    return n;
  }
}

/** Plays a stored solution through the rules. */
export function playSolution(def: CLevel, drops: Drop[] = def.solution): { ok: boolean; errors: string[]; board: Board } {
  const pic = analyse(def);
  const b = new Board(pic, limitsOf(def));
  const errors: string[] = [];
  for (const d of drops) {
    const idx = d.y * pic.w + d.x;
    const res = b.apply(idx, d.c ?? -1);
    if (res !== 'ok' && res !== 'washed') errors.push(`(${d.x},${d.y}) c${d.c}: ${res}`);
  }
  if (!b.done()) errors.push('not finished');
  return { ok: !errors.length, errors, board: b };
}
