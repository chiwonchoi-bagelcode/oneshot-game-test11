/*
 * Inkbloom board renderer (Canvas 2D).
 *
 * Layers (all offscreen canvases cover the board region only, at device resolution):
 *   stat     paper texture, frame, slow paper, walls, gates, grid, goal marks   (rebuilt on layout/level/skin)
 *   statFin  same without grid and goal marks (finished painting look, built lazily for the win)
 *   inkC     settled ink. Updated incrementally: a cell is (re)drawn only when its shape signature
 *            (colour + open sides + concave corners) changes. Everything in it is opaque, so redraws
 *            are idempotent; the layer is composited with the paper-dependent ink alpha.
 *   dyn      per-frame composition of inkC + growing cells + next-beat tendrils (only while needed)
 * Per frame: blit stat, blit ink (or dyn), then small overlays (seeds, marks, ghosts, effects).
 * render() returns false when nothing animates, so the caller can stop its rAF loop.
 */
import { Sim, WHITE, type SimEvent } from '../core/sim.ts';
import { inkSkin, paperSkin, inkForPaper, type PaperSkin } from './skins.ts';
import { drawGlyph } from './glyphs.ts';
import { mix, shade, rgba, hash01, prng, luminance } from './color.ts';

export interface BoardOptions { ink: string; paper: string; symbols: boolean; reducedMotion: boolean }
export interface GhostMark { idx: number; color: number; beat: number; order: number; state: 'upcoming' | 'now' | 'done' }
export interface BoardLayout { x: number; y: number; w: number; h: number; cell: number }

const MAX_CELL = 72;
const MAX_DPR = 2;
const MIN_MARGIN = 8;
const MAX_PARTICLES = 60;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/** Closed sides overlap the neighbour by this much (css px) so same-colour cells join without seams. */
const EXT = 0.4;

// Side bits (open sides of a cell shape) and corner bits (concave corners).
const S_T = 1, S_R = 2, S_B = 4, S_L = 8;
const C_TL = 1, C_TR = 2, C_BR = 4, C_BL = 8;

// Effect kinds.
const FX_SPLASH = 1, FX_BLOOM = 2, FX_BURST = 3, FX_SPARK = 4, FX_REJECT = 5, FX_POP = 6, FX_WRONG = 7;

interface Pal {
  body: string; mid: string; edge: string; halo: string; light: string; deep: string;
  glyph: string; ring: string; wash: string;
  pat: CanvasPattern | string;
  glow: HTMLCanvasElement;
}

interface Grow { t0: number; dur: number; mode: 0 | 1 | 2; sides: number }
interface Fx { kind: number; t0: number; dur: number; idx: number; c: number; b: number; x: number; y: number; v: number }
interface Particle { x: number; y: number; dx: number; dy: number; r: number; color: string; t0: number; life: number; star: boolean; g: number }
interface Tendril { idx: number; side: number; c: number }
interface WinState { t0: number; dur: number; perfect: boolean; onDone: (() => void) | null; done: boolean; order: number[]; spawned: number }

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function easeOut(t: number): number { t = clamp01(t); return 1 - (1 - t) * (1 - t) * (1 - t); }
function easeInOut(t: number): number { t = clamp01(t); return t * t * (3 - 2 * t); }
function smooth(a: number, b: number, t: number): number { return easeInOut((t - a) / (b - a)); }

function rrect(ctx: CanvasPath, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Wobbly straight side (zero wobble at both ends so neighbouring cells line up). */
function side(ctx: CanvasPath, x0: number, y0: number, x1: number, y1: number, amp: number, p1: number, p2: number): void {
  if (amp <= 0.05) { ctx.lineTo(x1, y1); return; }
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dy / len, ny = -dx / len; // outward for clockwise traversal
  const N = 6;
  for (let j = 1; j <= N; j++) {
    const t = j / N;
    const o = j === N ? 0 : amp * Math.sin(Math.PI * t) * (0.65 * Math.sin(TAU * (t + p1)) + 0.35 * Math.sin(TAU * (2 * t + p2)));
    ctx.lineTo(x0 + dx * t + nx * o, y0 + dy * t + ny * o);
  }
}

/**
 * Path of one cell of a region: open sides are inset by `inset` (and wobble), closed sides reach
 * EXT past the cell edge, convex corners are rounded, concave corners get a small notch.
 */
function cellPath(ctx: CanvasPath, x: number, y: number, s: number, open: number, concave: number, inset: number, rad: number, amp: number, seed: number): void {
  const xl = open & S_L ? x + inset : x - EXT;
  const xr = open & S_R ? x + s - inset : x + s + EXT;
  const yt = open & S_T ? y + inset : y - EXT;
  const yb = open & S_B ? y + s - inset : y + s + EXT;
  const r = Math.max(0.5, Math.min(rad, (xr - xl) / 2, (yb - yt) / 2));
  const notch = inset > 0.2;
  const ph = (k: number) => hash01(seed, k);
  // TL
  if ((open & S_T) && (open & S_L)) { ctx.moveTo(xl, yt + r); ctx.arc(xl + r, yt + r, r, Math.PI, Math.PI * 1.5); }
  else if (notch && (concave & C_TL)) { ctx.moveTo(x - EXT, y + inset); ctx.arc(x, y, inset, HALF_PI, 0, true); ctx.lineTo(x + inset, y - EXT); }
  else ctx.moveTo(xl, yt);
  // top side → TR
  let ex: number, ey: number;
  if ((open & S_T) && (open & S_R)) { ex = xr - r; ey = yt; }
  else if (notch && (concave & C_TR)) { ex = x + s - inset; ey = y - EXT; }
  else { ex = xr; ey = yt; }
  if (open & S_T) side(ctx, (open & S_L) ? xl + r : xl, yt, ex, ey, amp, ph(1), ph(2)); else ctx.lineTo(ex, ey);
  if ((open & S_T) && (open & S_R)) ctx.arc(xr - r, yt + r, r, Math.PI * 1.5, TAU);
  else if (notch && (concave & C_TR)) { ctx.arc(x + s, y, inset, Math.PI, HALF_PI, true); ctx.lineTo(x + s + EXT, y + inset); }
  // right side → BR
  const sx = ((open & S_T) && (open & S_R)) ? xr : (notch && (concave & C_TR)) ? x + s + EXT : xr;
  const sy = ((open & S_T) && (open & S_R)) ? yt + r : (notch && (concave & C_TR)) ? y + inset : yt;
  if ((open & S_R) && (open & S_B)) { ex = xr; ey = yb - r; }
  else if (notch && (concave & C_BR)) { ex = x + s + EXT; ey = y + s - inset; }
  else { ex = xr; ey = yb; }
  if (open & S_R) side(ctx, sx, sy, ex, ey, amp, ph(3), ph(4)); else ctx.lineTo(ex, ey);
  if ((open & S_R) && (open & S_B)) ctx.arc(xr - r, yb - r, r, 0, HALF_PI);
  else if (notch && (concave & C_BR)) { ctx.arc(x + s, y + s, inset, Math.PI * 1.5, Math.PI, true); ctx.lineTo(x + s - inset, y + s + EXT); }
  // bottom side → BL
  const bx = ((open & S_R) && (open & S_B)) ? xr - r : (notch && (concave & C_BR)) ? x + s - inset : xr;
  const by = ((open & S_R) && (open & S_B)) ? yb : (notch && (concave & C_BR)) ? y + s + EXT : yb;
  if ((open & S_B) && (open & S_L)) { ex = xl + r; ey = yb; }
  else if (notch && (concave & C_BL)) { ex = x + inset; ey = y + s + EXT; }
  else { ex = xl; ey = yb; }
  if (open & S_B) side(ctx, bx, by, ex, ey, amp, ph(5), ph(6)); else ctx.lineTo(ex, ey);
  if ((open & S_B) && (open & S_L)) ctx.arc(xl + r, yb - r, r, HALF_PI, Math.PI);
  else if (notch && (concave & C_BL)) { ctx.arc(x, y + s, inset, 0, Math.PI * 1.5, true); ctx.lineTo(x - EXT, y + s - inset); }
  // left side → TL start
  const lx = ((open & S_B) && (open & S_L)) ? xl : (notch && (concave & C_BL)) ? x - EXT : xl;
  const ly = ((open & S_B) && (open & S_L)) ? yb - r : (notch && (concave & C_BL)) ? y + s - inset : yb;
  if ((open & S_T) && (open & S_L)) { ex = xl; ey = yt + r; }
  else if (notch && (concave & C_TL)) { ex = x - EXT; ey = y + inset; }
  else { ex = xl; ey = yt; }
  if (open & S_L) side(ctx, lx, ly, ex, ey, amp, ph(7), ph(8)); else ctx.lineTo(ex, ey);
  ctx.closePath();
}

/** Irregular closed blob (circle with low-frequency radial noise). */
function blobPath(ctx: CanvasPath, cx: number, cy: number, r: number, seed: number, rough: number, lobes = 0, lobeAmp = 0, n = 18): void {
  const a0 = hash01(seed, 9) * TAU;
  const p1 = hash01(seed, 1) * TAU, p2 = hash01(seed, 2) * TAU, p3 = hash01(seed, 3) * TAU;
  for (let k = 0; k <= n; k++) {
    const a = a0 + (k / n) * TAU;
    let m = 1 + rough * (0.55 * Math.sin(2 * a + p1) + 0.3 * Math.sin(3 * a + p2) + 0.15 * Math.sin(5 * a + p3));
    if (lobes) m += lobeAmp * Math.cos(lobes * (a - a0));
    const px = cx + Math.cos(a) * r * m, py = cy + Math.sin(a) * r * m;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function starPath(ctx: CanvasPath, cx: number, cy: number, r: number): void {
  const q = r * 0.18;
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + q, cy - q, cx + r, cy);
  ctx.quadraticCurveTo(cx + q, cy + q, cx, cy + r);
  ctx.quadraticCurveTo(cx - q, cy + q, cx - r, cy);
  ctx.quadraticCurveTo(cx - q, cy - q, cx, cy - r);
  ctx.closePath();
}

const DIRX = [0, 1, 0, -1];
const DIRY = [-1, 0, 1, 0];

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: BoardOptions;
  private sim: Sim | null = null;
  private lay: BoardLayout = { x: 0, y: 0, w: 0, h: 0, cell: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  /** Used by renderThumbnail (no 72 px cap there). */
  maxCell = MAX_CELL;
  private pad = 8;
  // Board region (css px) covered by the offscreen layers, and its device-pixel origin/size.
  private rx = 0; private ry = 0; private rw = 0; private rh = 0;
  private ox = 0; private oy = 0; private RW = 0; private RH = 0;
  // Ink geometry (css px).
  private gap = 2; private e1 = 1.5; private e2 = 4; private rc = 14; private amp = 1.2; private haloW = 1.4;

  private paper: PaperSkin = paperSkin('paper-hanji');
  private pal: Pal[] = [];
  private inkAlpha = 0.9;
  private grain: HTMLCanvasElement | null = null;
  private sparkle: HTMLCanvasElement | null = null;
  private dropSprites: HTMLCanvasElement[] = [];
  private paperMask: HTMLCanvasElement | null = null;
  private boardClip: Path2D | null = null;

  private stat: HTMLCanvasElement | null = null;
  private statFin: HTMLCanvasElement | null = null;
  private inkC: HTMLCanvasElement | null = null;
  private inkFin: HTMLCanvasElement | null = null;
  private dyn: HTMLCanvasElement | null = null;
  private drawnSig: Int32Array = new Int32Array(0);
  private cacheDirty = true;
  private cacheFull = true;

  private grow = new Map<number, Grow>();
  private fx: Fx[] = [];
  private parts: Particle[] = [];
  private tendrils: Tendril[] = [];
  private mixHints: number[] = [];
  private wakeHints: number[] = [];
  private frontColor: Uint8Array = new Uint8Array(0);
  private simSig = -1;
  private wrong: number[] = [];
  private ghosts: GhostMark[] | null = null;
  private metShown: Uint8Array = new Uint8Array(0);
  private win: WinState | null = null;
  private winTimer: ReturnType<typeof setTimeout> | null = null;

  private phase = 0;
  private running = false;
  private beatMs = 640;
  private lastStepAt = -1;
  private needsDraw = true;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: BoardOptions) {
    this.canvas = canvas;
    this.ctx = ctx2d(canvas);
    this.opts = { ...opts };
    this.applySkin();
  }

  // ------------------------------------------------------------------ public API

  setOptions(o: Partial<BoardOptions>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...o };
    if (prev.ink !== this.opts.ink || prev.paper !== this.opts.paper) {
      this.applySkin();
      this.rebuildAll();
    } else if (prev.symbols !== this.opts.symbols) {
      this.rebuildAll();
    }
    this.needsDraw = true;
  }

  setSim(sim: Sim): void {
    const sameLevel = !!this.sim && this.sim.L === sim.L;
    const dimsChanged = !this.sim || this.sim.w !== sim.w || this.sim.h !== sim.h;
    this.sim = sim;
    this.grow.clear();
    this.fx.length = 0;
    this.parts.length = 0;
    this.wrong = [];
    if (!sameLevel) this.ghosts = null;
    this.cancelWin();
    const n = sim.w * sim.h;
    this.frontColor = new Uint8Array(n);
    this.metShown = new Uint8Array(n);
    for (const t of sim.L.targets) if (sim.ink[t] === sim.L.goal[t]) this.metShown[t] = 1;
    this.simSig = -1;
    if (this.cssW > 0 && (dimsChanged || !sameLevel)) this.computeLayout();
    else this.rebuildAll();
    this.needsDraw = true;
  }

  replaceSim(sim: Sim): void {
    if (!this.sim || this.sim.L !== sim.L) { this.setSim(sim); return; }
    this.sim = sim;
    for (const [i, g] of this.grow) {
      if (!sim.ink[i] || sim.born[i] !== sim.tick) this.grow.delete(i);
      else void g;
    }
    this.wrong = this.wrong.filter((i) => sim.ink[i] !== 0);
    for (const t of sim.L.targets) this.metShown[t] = sim.ink[t] === sim.L.goal[t] ? this.metShown[t] : 0;
    this.cacheDirty = true;
    this.cacheFull = true;
    this.simSig = -1;
    this.needsDraw = true;
  }

  layout(cssW: number, cssH: number, dpr: number): BoardLayout {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.max(1, Math.min(MAX_DPR, dpr || 1));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this.computeLayout();
    this.needsDraw = true;
    return { ...this.lay };
  }

  cellAt(cssX: number, cssY: number): number {
    const sim = this.sim, L = this.lay;
    if (!sim || L.cell <= 0) return -1;
    const cx = Math.floor((cssX - L.x) / L.cell), cy = Math.floor((cssY - L.y) / L.cell);
    if (cx < 0 || cy < 0 || cx >= sim.w || cy >= sim.h) return -1;
    const i = cy * sim.w + cx;
    return sim.L.hole[i] ? -1 : i;
  }

  cellRect(idx: number): { x: number; y: number; size: number } {
    const w = this.sim ? this.sim.w : 1;
    const x = idx % w, y = (idx - x) / w;
    return { x: this.lay.x + x * this.lay.cell, y: this.lay.y + y * this.lay.cell, size: this.lay.cell };
  }

  setBeat(phase: number, running: boolean): void {
    const p = clamp01(phase);
    if (p !== this.phase || running !== this.running) {
      this.phase = p;
      this.running = running;
      if (this.tendrils.length || this.wakeHints.length || this.mixHints.length) this.needsDraw = true;
    }
  }

  onDrop(idx: number, color: number): void {
    if (!this.sim) return;
    const now = performance.now();
    const rm = this.opts.reducedMotion;
    this.grow.set(idx, { t0: now, dur: rm ? 220 : 380, mode: 1, sides: 0 });
    const c = this.cellCenter(idx);
    this.addFx(FX_SPLASH, now, rm ? 320 : 560, idx, color, 0, c.x, c.y, 0);
    if (!rm) {
      const s = this.lay.cell;
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + hash01(idx, k, now | 0) * 0.8;
        const d = s * (0.55 + 0.45 * hash01(k, idx, 3));
        this.addParticle(c.x, c.y, Math.cos(a) * d, Math.sin(a) * d, s * (0.035 + 0.03 * hash01(k, 7, idx)), this.pal[color].body, now + k * 8, 420 + 120 * hash01(k, 2, idx), false, s * 0.12);
      }
    }
    this.cacheDirty = true;
    this.simSig = -1;
    this.needsDraw = true;
  }

  onStep(events: SimEvent[]): void {
    const sim = this.sim;
    if (!sim) return;
    const now = performance.now();
    if (this.lastStepAt > 0) {
      const dt = now - this.lastStepAt;
      if (dt > 60 && dt < 2500) this.beatMs = this.beatMs * 0.6 + dt * 0.4;
    }
    this.lastStepAt = now;
    // Finish growths from the previous beat at once.
    if (this.grow.size) { this.grow.clear(); this.cacheDirty = true; }
    const rm = this.opts.reducedMotion;
    const gd = Math.max(140, Math.min(480, this.beatMs * 0.55)) * (rm ? 0.6 : 1);
    const w = sim.w, s = this.lay.cell;
    for (const e of events) {
      if (e.type === 'fill') {
        let sides = 0;
        for (let k = 0; k < 4; k++) {
          const n = this.nb(e.idx, k);
          if (n >= 0 && sim.ink[n] === e.c && sim.born[n] < sim.born[e.idx]) sides |= 1 << k;
        }
        if (!sides) {
          const f = e.from;
          sides = f === e.idx - w ? 1 : f === e.idx + 1 ? 2 : f === e.idx + w ? 4 : 8;
        }
        this.grow.set(e.idx, { t0: now, dur: gd, mode: 0, sides });
      } else if (e.type === 'mix') {
        this.grow.set(e.idx, { t0: now, dur: rm ? 260 : 520, mode: 2, sides: 0 });
        const c = this.cellCenter(e.idx);
        this.addFx(FX_BLOOM, now, rm ? 360 : 760, e.idx, e.c, e.parts, c.x, c.y, 0);
        if (!rm) {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU + hash01(e.idx, k) * 0.6;
            const d = s * (0.35 + 0.3 * hash01(k, e.idx));
            this.addParticle(c.x, c.y, Math.cos(a) * d, Math.sin(a) * d, s * 0.05, '#fffbe8', now + 60 + k * 30, 520, true, -s * 0.1);
          }
        }
      } else if (e.type === 'seed') {
        this.grow.set(e.idx, { t0: now, dur: rm ? 240 : 460, mode: 1, sides: 0 });
        const c = this.cellCenter(e.idx);
        this.addFx(FX_BURST, now, rm ? 360 : 700, e.idx, e.c, 0, c.x, c.y, 0);
        if (!rm) {
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * TAU + hash01(e.idx, k, 5) * 0.5;
            const d = s * (0.6 + 0.4 * hash01(k, e.idx, 9));
            this.addParticle(c.x, c.y, Math.cos(a) * d, Math.sin(a) * d, s * (0.04 + 0.03 * hash01(k, 1)), this.pal[e.c].body, now + k * 6, 520, false, s * 0.1);
          }
        }
      } else if (e.type === 'touch') {
        const a = this.cellCenter(e.a), b = this.cellCenter(e.b);
        const vertEdge = Math.abs(e.a - e.b) === 1 ? 1 : 0;
        this.addFx(FX_SPARK, now + gd * 0.55, rm ? 260 : 460, e.a, sim.ink[e.a], sim.ink[e.b], (a.x + b.x) / 2, (a.y + b.y) / 2, vertEdge);
        if (!rm) {
          for (let k = 0; k < 4; k++) {
            const sgn = k < 2 ? -1 : 1;
            const along = (k % 2 ? 0.25 : -0.25) * s;
            const dx = vertEdge ? sgn * s * 0.18 : along, dy = vertEdge ? along : sgn * s * 0.18;
            this.addParticle((a.x + b.x) / 2, (a.y + b.y) / 2, dx, dy, s * 0.045, '#fff6d6', now + gd * 0.55 + k * 25, 380, true, 0);
          }
        }
      }
    }
    this.cacheDirty = true;
    this.simSig = -1;
    this.needsDraw = true;
  }

  onReject(idx: number, reason: string): void {
    if (!this.sim || idx < 0) return;
    const now = performance.now();
    const c = this.cellCenter(idx);
    this.addFx(FX_REJECT, now, this.opts.reducedMotion ? 380 : 480, idx, 0, 0, c.x, c.y, reason === 'white' ? 1 : 0);
    this.needsDraw = true;
  }

  onTargetMet(idx: number): void {
    if (!this.sim) return;
    const g = this.grow.get(idx);
    const now = performance.now();
    const start = g ? g.t0 + g.dur * 0.8 : now;
    const c = this.cellCenter(idx);
    const col = this.sim.L.goal[idx];
    this.addFx(FX_POP, start, this.opts.reducedMotion ? 320 : 620, idx, col, 0, c.x, c.y, 0);
    if (!this.opts.reducedMotion) {
      const s = this.lay.cell;
      for (let k = 0; k < 5; k++) {
        const a = -HALF_PI + (k - 2) * 0.55;
        this.addParticle(c.x, c.y - s * 0.1, Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42, s * 0.055, '#fff8dc', start + k * 35, 480, true, -s * 0.05);
      }
    }
    this.needsDraw = true;
  }

  showWrong(cells: number[]): void {
    const now = performance.now();
    for (const i of cells) {
      if (this.wrong.indexOf(i) >= 0) continue;
      this.wrong.push(i);
      const c = this.cellCenter(i);
      this.addFx(FX_WRONG, now, this.opts.reducedMotion ? 400 : 750, i, 0, 0, c.x, c.y, 0);
    }
    this.needsDraw = true;
  }

  setGhosts(g: GhostMark[] | null): void {
    this.ghosts = g && g.length ? g.slice() : null;
    this.needsDraw = true;
  }

  playWin(perfect: boolean, onDone: () => void): void {
    if (!this.sim) { onDone(); return; }
    this.cancelWin();
    this.ensureFinLayers();
    const sim = this.sim;
    const order = sim.L.targets.slice().sort((a, b) => {
      const ax = a % sim.w, ay = (a - ax) / sim.w, bx = b % sim.w, by = (b - bx) / sim.w;
      return ax + ay - (bx + by) || a - b;
    });
    const dur = this.opts.reducedMotion ? 650 : perfect ? 1600 : 1400;
    this.win = { t0: performance.now(), dur, perfect, onDone, done: false, order, spawned: 0 };
    this.winTimer = setTimeout(() => this.finishWin(), dur + 300);
    this.needsDraw = true;
  }

  skipWin(): void {
    this.finishWin();
  }

  render(now: number): boolean {
    if (this.disposed || !this.sim || !this.stat || this.lay.cell <= 0) return false;
    const sim = this.sim;
    // Pick up sim changes made without onStep/onDrop (rewind, fast-forward).
    const sig = sim.tick * 4096 + sim.pi * 64 + (sim.drops.length & 63);
    if (sig !== this.simSig) {
      this.simSig = sig;
      this.computePreview();
      this.cacheDirty = true;
      this.needsDraw = true;
    }
    // Growth bookkeeping.
    for (const [i, g] of this.grow) {
      if (now - g.t0 >= g.dur || !sim.ink[i]) { this.grow.delete(i); this.cacheDirty = true; }
    }
    if (this.cacheDirty) this.updateInkCache();
    // Targets that became met (mark appears once the ink has settled).
    for (const t of sim.L.targets) {
      if (!this.metShown[t] && sim.ink[t] === sim.L.goal[t] && !this.grow.has(t)) { this.metShown[t] = 1; this.needsDraw = true; }
    }
    // Expire effects.
    if (this.fx.length) {
      let k = 0;
      for (const f of this.fx) if (now - f.t0 < f.dur) this.fx[k++] = f;
      this.fx.length = k;
    }
    if (this.parts.length) {
      let k = 0;
      for (const p of this.parts) if (now - p.t0 < p.life) this.parts[k++] = p;
      this.parts.length = k;
    }
    const rm = this.opts.reducedMotion;
    const win = this.win;
    const winAnim = !!win && !win.done;
    const hasSeeds = this.hasDormantSeeds();
    const previewLive = !win && (this.tendrils.length > 0 || this.wakeHints.length > 0 || this.mixHints.length > 0);
    const ghostLive = !win && !!this.ghosts && this.ghosts.some((g) => g.state === 'now');
    const animating = this.grow.size > 0 || this.fx.length > 0 || this.parts.length > 0 || winAnim
      || (!rm && (hasSeeds || ghostLive || (previewLive && !this.running)));
    if (!animating && !this.needsDraw && !(previewLive && this.running)) return false;
    this.needsDraw = false;
    this.draw(now, previewLive);
    if (win && !win.done && now - win.t0 >= win.dur) this.finishWin();
    return animating || (previewLive && this.running);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelWin();
    for (const c of [this.stat, this.statFin, this.inkC, this.inkFin, this.dyn, this.paperMask]) if (c) { c.width = 0; c.height = 0; }
    this.stat = this.statFin = this.inkC = this.inkFin = this.dyn = this.paperMask = null;
    this.fx.length = 0;
    this.parts.length = 0;
    this.grow.clear();
    this.sim = null;
  }

  /** Thumbnail helper: show the finished-painting end state without animation. */
  finishInstant(): void {
    if (!this.sim) return;
    this.ensureFinLayers();
    this.win = { t0: 0, dur: 1, perfect: false, onDone: null, done: true, order: [], spawned: 0 };
    this.needsDraw = true;
  }

  // ------------------------------------------------------------------ setup

  private applySkin(): void {
    this.paper = paperSkin(this.opts.paper);
    this.inkAlpha = this.paper.dark ? 0.95 : 0.9;
    this.buildPalette();
  }

  private buildPalette(): void {
    const p = this.paper;
    const cols = inkForPaper(inkSkin(this.opts.ink), p);
    this.pal = [];
    for (let c = 0; c <= 7; c++) {
      const body = cols[c] || cols[7];
      const lum = luminance(body);
      const deep = shade(body, 0.55, 1.05);
      const edge = p.dark ? shade(body, 1, 1.05, 0.12) : c === 7 ? shade(body, 0.82) : shade(body, 0.74, 1.12);
      const mid = p.dark ? shade(body, 1, 1, 0.05) : shade(body, 0.9, 1.06);
      const light = mix(body, '#ffffff', p.dark ? 0.35 : 0.3);
      const ring = p.dark ? shade(body, 1, 1, 0.08) : lum > 0.35 ? shade(body, 0.78, 1.15) : body;
      const glyph = lum < 0.2 ? mix(body, '#ffffff', 0.62) : mix(body, '#1a1410', 0.55);
      this.pal[c] = {
        body, mid, edge, light, deep, glyph, ring,
        halo: mix(p.base, body, p.dark ? 0.4 : 0.32),
        wash: rgba(body, p.dark ? 0.2 : 0.15),
        pat: body,
        glow: this.makeGlow(light),
      };
    }
  }

  private makeGlow(color: string): HTMLCanvasElement {
    const S = 64;
    const c = makeCanvas(S, S), g = ctx2d(c);
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, rgba(color, 0.95));
    gr.addColorStop(0.45, rgba(color, 0.45));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  }

  private computeLayout(): void {
    const sim = this.sim;
    if (!sim || this.cssW <= 0) return;
    const W = sim.w, H = sim.h;
    const avW = this.cssW - 2 * MIN_MARGIN, avH = this.cssH - 2 * MIN_MARGIN;
    let cell = this.maxCell;
    for (let k = 0; k < 3; k++) {
      const pad = this.padFor(cell);
      cell = Math.floor(Math.min(this.maxCell, (avW - 2 * pad) / W, (avH - 2 * pad) / H));
    }
    cell = Math.max(6, cell);
    const pad = this.padFor(cell);
    const bw = cell * W, bh = cell * H;
    const x = Math.round((this.cssW - bw) / 2), y = Math.round((this.cssH - bh) / 2);
    this.lay = { x, y, w: bw, h: bh, cell };
    this.pad = pad;
    const sh = Math.max(6, Math.round(cell * 0.2));
    this.rx = x - pad - sh; this.ry = y - pad - sh;
    this.rw = bw + 2 * (pad + sh); this.rh = bh + 2 * (pad + sh) + 4;
    const d = this.dpr;
    this.ox = Math.round(this.rx * d); this.oy = Math.round(this.ry * d);
    this.RW = Math.ceil(this.rw * d); this.RH = Math.ceil(this.rh * d);
    const s = cell;
    this.gap = Math.max(1.1, s * 0.036);
    this.e1 = Math.max(1, s * 0.03);
    this.e2 = this.e1 + Math.max(1.2, s * 0.05);
    this.rc = s * 0.27;
    this.amp = Math.min(this.gap * 0.8, s * 0.028);
    this.haloW = this.gap * 0.8;
    this.rebuildAll();
  }

  private padFor(cell: number): number {
    return Math.round(Math.min(14, Math.max(6, cell * 0.2)));
  }

  private rebuildAll(): void {
    const sim = this.sim;
    if (!sim || this.lay.cell <= 0) return;
    this.buildSprites();
    this.buildBoardClip();
    this.stat = this.buildStatic(this.stat, false);
    if (this.statFin) this.statFin = this.buildStatic(this.statFin, true);
    if (!this.inkC || this.inkC.width !== this.RW || this.inkC.height !== this.RH) this.inkC = makeCanvas(this.RW, this.RH);
    if (!this.dyn || this.dyn.width !== this.RW || this.dyn.height !== this.RH) this.dyn = makeCanvas(this.RW, this.RH);
    this.inkFin = null;
    if (this.win) this.ensureFinLayers();
    this.drawnSig = new Int32Array(sim.w * sim.h).fill(-1);
    this.cacheDirty = true;
    this.cacheFull = true;
    this.simSig = -1;
    this.needsDraw = true;
  }

  private layerCtx(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const g = ctx2d(c);
    g.setTransform(this.dpr, 0, 0, this.dpr, -this.ox, -this.oy);
    return g;
  }

  private buildSprites(): void {
    const d = this.dpr, s = this.lay.cell;
    // Granulation tiles → body patterns.
    const T = 128;
    const rnd = prng(911);
    for (let c = 1; c <= 7; c++) {
      const P = this.pal[c];
      const t = makeCanvas(T, T), g = ctx2d(t);
      g.fillStyle = P.body;
      g.fillRect(0, 0, T, T);
      // Soft wash variation (wrapped so the tile repeats seamlessly).
      for (let k = 0; k < 7; k++) {
        const bx = rnd() * T, by = rnd() * T, br = T * (0.18 + rnd() * 0.3);
        const lighter = rnd() < 0.5;
        const col = lighter ? (this.paper.dark ? P.light : mix(P.body, '#ffffff', 0.5)) : P.deep;
        for (let ox = -T; ox <= T; ox += T) for (let oy = -T; oy <= T; oy += T) {
          const gr = g.createRadialGradient(bx + ox, by + oy, 0, bx + ox, by + oy, br);
          gr.addColorStop(0, rgba(col, lighter ? 0.13 : 0.07));
          gr.addColorStop(1, rgba(col, 0));
          g.fillStyle = gr;
          g.fillRect(bx + ox - br, by + oy - br, br * 2, br * 2);
        }
      }
      // Granulation specks.
      const n = c === 7 ? 520 : 300;
      for (let k = 0; k < n; k++) {
        const r = 0.35 + rnd() * (c === 7 ? 1.2 : 0.8);
        g.fillStyle = rgba(rnd() < 0.8 ? P.deep : P.light, 0.05 + rnd() * (c === 7 ? 0.2 : 0.13));
        g.beginPath();
        g.arc(rnd() * T, rnd() * T, r, 0, TAU);
        g.fill();
      }
      const pat = this.ctx.createPattern(t, 'repeat');
      if (pat) {
        if (typeof (pat as CanvasPattern & { setTransform?: unknown }).setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
          pat.setTransform(new DOMMatrix([1 / d, 0, 0, 1 / d, 0, 0]));
        }
        P.pat = pat;
      }
    }
    // Paper grain tile.
    const G = 96;
    this.grain = makeCanvas(G, G);
    {
      const g = ctx2d(this.grain);
      const dark = this.paper.dark;
      for (let k = 0; k < 900; k++) {
        g.fillStyle = rnd() < 0.5 ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.22)') : (dark ? 'rgba(0,0,0,0.22)' : 'rgba(90,70,40,0.07)');
        g.fillRect(rnd() * G, rnd() * G, 1, 1);
      }
    }
    // Sparkle sprite.
    {
      const S = 48;
      this.sparkle = makeCanvas(S, S);
      const g = ctx2d(this.sparkle);
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,250,225,0.9)');
      gr.addColorStop(0.3, 'rgba(255,240,190,0.35)');
      gr.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#ffffff';
      g.beginPath();
      starPath(g, S / 2, S / 2, S * 0.46);
      g.fill();
    }
    // Seed droplet sprites.
    this.dropSprites = [];
    const R = s * 0.2;
    const SW = Math.ceil(R * 2.8 * d), SH = Math.ceil(R * 3.4 * d);
    for (let c = 1; c <= 7; c++) {
      const P = this.pal[c];
      const sp = makeCanvas(SW, SH), g = ctx2d(sp);
      g.setTransform(d, 0, 0, d, 0, 0);
      const cx = SW / d / 2, cy = SH / d * 0.6;
      const drop = (rr: number) => {
        g.beginPath();
        g.moveTo(cx, cy - rr * 2.05);
        g.bezierCurveTo(cx + rr * 0.35, cy - rr * 1.3, cx + rr, cy - rr * 0.75, cx + rr, cy);
        g.arc(cx, cy, rr, 0, Math.PI);
        g.bezierCurveTo(cx - rr, cy - rr * 0.75, cx - rr * 0.35, cy - rr * 1.3, cx, cy - rr * 2.05);
        g.closePath();
      };
      g.fillStyle = this.paper.dark ? 'rgba(0,0,0,0.35)' : 'rgba(60,40,20,0.16)';
      g.save(); g.translate(R * 0.12, R * 0.22); drop(R); g.fill(); g.restore();
      const gr = g.createLinearGradient(cx - R, cy - R * 2, cx + R, cy + R);
      gr.addColorStop(0, P.light);
      gr.addColorStop(0.45, P.body);
      gr.addColorStop(1, P.edge);
      g.fillStyle = gr;
      drop(R);
      g.fill();
      g.lineWidth = Math.max(1, R * 0.12);
      g.strokeStyle = P.edge;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.ellipse(cx - R * 0.38, cy - R * 0.35, R * 0.18, R * 0.32, -0.5, 0, TAU);
      g.fill();
      this.dropSprites[c] = sp;
    }
  }

  private buildBoardClip(): void {
    const sim = this.sim!;
    const p = new Path2D();
    const s = this.lay.cell;
    for (let i = 0; i < sim.w * sim.h; i++) {
      if (sim.L.hole[i]) continue;
      const x = i % sim.w, y = (i - x) / sim.w;
      p.rect(this.lay.x + x * s - 0.5, this.lay.y + y * s - 0.5, s + 1, s + 1);
    }
    this.boardClip = p;
  }

  private ensureFinLayers(): void {
    if (!this.sim || !this.stat) return;
    if (!this.statFin) this.statFin = this.buildStatic(null, true);
    if (!this.inkFin) {
      this.inkFin = makeCanvas(this.RW, this.RH);
      const g = this.layerCtx(this.inkFin);
      const sim = this.sim;
      for (let i = 0; i < sim.w * sim.h; i++) if (sim.ink[i] && !sim.L.hole[i]) this.drawCell(g, i, true);
    }
  }

  // ------------------------------------------------------------------ static layer

  private buildStatic(reuse: HTMLCanvasElement | null, fin: boolean): HTMLCanvasElement {
    const sim = this.sim!;
    const L = sim.L;
    const d = this.dpr, s = this.lay.cell, pad = this.pad;
    const P = this.paper;
    const out = reuse && reuse.width === this.RW && reuse.height === this.RH ? reuse : makeCanvas(this.RW, this.RH);
    const g = this.layerCtx(out);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, out.width, out.height);
    g.restore();
    const W = sim.w, n = sim.w * sim.h;
    const cx0 = this.lay.x, cy0 = this.lay.y;
    const rnd = prng(1234 + W * 31 + sim.h * 7);
    const isPaperCell = (i: number) => i >= 0 && !L.hole[i];

    // --- paper mask (board silhouette with a deckled edge)
    let mask = this.paperMask;
    if (!fin || !mask) {
      mask = makeCanvas(this.RW, this.RH);
      const m = this.layerCtx(mask);
      m.fillStyle = '#000';
      m.beginPath();
      const pr = pad * 0.9;
      for (let i = 0; i < n; i++) {
        if (L.hole[i]) continue;
        const x = i % W, y = (i - x) / W;
        rrect(m, cx0 + x * s - pad, cy0 + y * s - pad, s + 2 * pad, s + 2 * pad, pr);
      }
      m.fill();
      // Deckle: tiny bites and bumps along outer edges.
      const bites = new Path2D(), bumps = new Path2D();
      for (let i = 0; i < n; i++) {
        if (L.hole[i]) continue;
        const x = i % W, y = (i - x) / W;
        for (let k = 0; k < 4; k++) {
          const nb = this.nb(i, k);
          if (nb >= 0 && !L.hole[nb]) continue;
          const px = cx0 + x * s, py = cy0 + y * s;
          for (let t = 2; t < s - 2; t += 2.2 + rnd() * 2.5) {
            let ex: number, ey: number;
            if (k === 0) { ex = px + t; ey = py - pad; } else if (k === 2) { ex = px + t; ey = py + s + pad; }
            else if (k === 1) { ex = px + s + pad; ey = py + t; } else { ex = px - pad; ey = py + t; }
            const r = 0.5 + rnd() * 1.1;
            if (rnd() < 0.55) { bites.moveTo(ex + r, ey); bites.arc(ex, ey, r, 0, TAU); }
            else { const ox = DIRX[k] * r * 0.4, oy = DIRY[k] * r * 0.4; bumps.moveTo(ex + ox + r * 0.8, ey + oy); bumps.arc(ex + ox, ey + oy, r * 0.8, 0, TAU); }
          }
        }
      }
      m.fill(bumps);
      m.globalCompositeOperation = 'destination-out';
      m.fill(bites);
      m.globalCompositeOperation = 'source-over';
      this.paperMask = mask;
    }

    // --- paper texture (clipped to the mask), with soft inner edge tone
    const paperC = makeCanvas(this.RW, this.RH);
    {
      const pg = ctx2d(paperC);
      this.paintPaperTexture(pg, this.RW, this.RH, rnd);
      // inner edge tone
      const inv = makeCanvas(this.RW, this.RH), ig = ctx2d(inv);
      ig.fillStyle = '#000';
      ig.fillRect(0, 0, this.RW, this.RH);
      ig.globalCompositeOperation = 'destination-out';
      ig.drawImage(mask, 0, 0);
      pg.save();
      pg.globalCompositeOperation = 'source-atop';
      pg.shadowColor = P.dark ? 'rgba(0,0,0,0.55)' : rgba(shade(P.fiber, 0.75), 0.42);
      pg.shadowBlur = pad * d * 1.4;
      pg.shadowOffsetX = this.RW * 3;
      pg.drawImage(inv, -this.RW * 3, 0);
      pg.restore();
      pg.globalCompositeOperation = 'destination-in';
      pg.drawImage(mask, 0, 0);
      pg.globalCompositeOperation = 'source-over';
    }
    // shadow + paper
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.shadowColor = P.dark ? 'rgba(0,0,0,0.6)' : 'rgba(70,45,20,0.28)';
    g.shadowBlur = Math.max(4, s * 0.16) * d;
    g.shadowOffsetY = Math.max(1.5, s * 0.05) * d;
    g.drawImage(paperC, 0, 0);
    g.restore();

    // --- frame line (mounted-painting border), union outline at pad/2
    {
      const fr = makeCanvas(this.RW, this.RH), fg = this.layerCtx(fr);
      const f1 = pad * 0.5, lw = Math.max(0.8, s * 0.016);
      fg.fillStyle = P.dark ? rgba(P.grid, 0.32) : rgba(P.grid, 0.3);
      fg.beginPath();
      for (let i = 0; i < n; i++) {
        if (L.hole[i]) continue;
        const x = i % W, y = (i - x) / W;
        rrect(fg, cx0 + x * s - f1, cy0 + y * s - f1, s + 2 * f1, s + 2 * f1, f1);
      }
      fg.fill();
      fg.globalCompositeOperation = 'destination-out';
      fg.beginPath();
      const f2 = f1 - lw;
      for (let i = 0; i < n; i++) {
        if (L.hole[i]) continue;
        const x = i % W, y = (i - x) / W;
        rrect(fg, cx0 + x * s - f2, cy0 + y * s - f2, s + 2 * f2, s + 2 * f2, Math.max(0, f2));
      }
      fg.fill();
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(fr, 0, 0);
      g.restore();
    }

    // --- slow paper
    this.drawSlow(g, rnd);
    // --- walls
    this.drawWalls(g, rnd);
    // --- gates
    for (let i = 0; i < n; i++) if (L.gate[i]) this.drawGate(g, i);
    // --- seed stains
    for (let i = 0; i < n; i++) {
      const c = L.seed[i];
      if (!c) continue;
      const cc = this.cellCenter(i);
      g.fillStyle = this.pal[c].wash;
      g.beginPath();
      blobPath(g, cc.x, cc.y + s * 0.04, s * 0.3, i * 3 + 1, 0.12);
      g.fill();
    }
    if (!fin) {
      this.drawGrid(g);
      this.drawGoals(g);
    } else {
      // Clean cells keep their pristine paper in the finished painting.
      for (const i of L.whites) {
        const r = this.cellRect(i);
        g.fillStyle = P.dark ? rgba('#ffffff', 0.04) : rgba('#ffffff', 0.35);
        g.beginPath();
        rrect(g, r.x + s * 0.12, r.y + s * 0.12, s * 0.76, s * 0.76, s * 0.14);
        g.fill();
      }
    }
    return out;
  }

  private paintPaperTexture(g: CanvasRenderingContext2D, W: number, H: number, rnd: () => number): void {
    const P = this.paper, d = this.dpr;
    const id = P.id;
    g.fillStyle = P.base;
    g.fillRect(0, 0, W, H);
    // Low-frequency mottling: tiny random canvas scaled up with smoothing.
    for (const div of [26, 9]) {
      const mw = Math.max(2, Math.ceil(W / (div * d))), mh = Math.max(2, Math.ceil(H / (div * d)));
      const mc = makeCanvas(mw, mh), mg = ctx2d(mc);
      const img = mg.createImageData(mw, mh);
      const fr = P.dark ? [255, 255, 255] : [120, 95, 60];
      for (let k = 0; k < mw * mh; k++) {
        const v = rnd();
        const lighten = v > 0.5;
        img.data[k * 4] = lighten ? 255 : fr[0];
        img.data[k * 4 + 1] = lighten ? 255 : fr[1];
        img.data[k * 4 + 2] = lighten ? (P.dark ? 255 : 250) : fr[2];
        img.data[k * 4 + 3] = Math.round((P.dark ? 10 : 24) * Math.abs(v - 0.5) * 2 * (div > 10 ? 1 : 0.7));
      }
      mg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(mc, 0, 0, mw, mh, 0, 0, mw * div * d, mh * div * d);
    }
    if (id === 'paper-dusk') {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(255,214,190,0.32)');
      gr.addColorStop(1, 'rgba(196,180,230,0.30)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    if (id === 'paper-starlight') {
      const gr = g.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, Math.max(W, H));
      gr.addColorStop(0, 'rgba(90,110,180,0.25)');
      gr.addColorStop(1, 'rgba(10,12,30,0.0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    if (id === 'paper-linen') {
      g.lineWidth = Math.max(1, d * 0.6);
      for (let y = 0; y < H; y += 2.3 * d) { g.strokeStyle = rgba(P.fiber, 0.1 + rnd() * 0.18); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + (rnd() - 0.5) * d); g.stroke(); }
      for (let x = 0; x < W; x += 2.3 * d) { g.strokeStyle = rgba(P.fiber, 0.08 + rnd() * 0.15); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * d, H); g.stroke(); }
    }
    // Fibers.
    const area = (W * H) / (d * d);
    const nf = Math.round(area / (id === 'paper-linen' ? 1400 : id === 'paper-kraft' ? 420 : 520));
    g.lineCap = 'round';
    for (let k = 0; k < nf; k++) {
      const x = rnd() * W, y = rnd() * H;
      const len = (5 + rnd() * rnd() * (id === 'paper-kraft' ? 14 : 30)) * d;
      const a = rnd() * TAU, bend = (rnd() - 0.5) * len * 0.6;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      const mx = (x + x2) / 2 - Math.sin(a) * bend, my = (y + y2) / 2 + Math.cos(a) * bend;
      const light = rnd() < (P.dark ? 0.15 : 0.3);
      g.strokeStyle = light ? (P.dark ? rgba(P.fiber, 0.5) : 'rgba(255,255,255,0.55)') : rgba(P.fiber, (P.dark ? 0.35 : 0.22) + rnd() * 0.3);
      g.lineWidth = (0.35 + rnd() * 0.75) * d;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(mx, my, x2, y2);
      g.stroke();
    }
    // Flecks (bark inclusions) / gold leaf / stars.
    const nfl = Math.round(area / 2600);
    for (let k = 0; k < nfl; k++) {
      const x = rnd() * W, y = rnd() * H;
      if (id === 'paper-starlight') {
        const r = (0.4 + rnd() * rnd() * 1.3) * d;
        g.fillStyle = rgba(rnd() < 0.7 ? '#dfe6ff' : '#ffe9b8', 0.35 + rnd() * 0.5);
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        if (rnd() < 0.08) { g.fillStyle = 'rgba(235,240,255,0.55)'; g.beginPath(); starPath(g, x, y, r * 4); g.fill(); }
      } else if (id === 'paper-night') {
        if (rnd() < 0.45) { g.fillStyle = rgba('#d8b46a', 0.25 + rnd() * 0.4); g.fillRect(x, y, (0.6 + rnd() * 1.6) * d, (0.5 + rnd()) * d); }
      } else {
        g.fillStyle = rgba(P.dark ? '#000000' : shade(P.fiber, 0.55), 0.18 + rnd() * 0.3);
        g.beginPath(); g.ellipse(x, y, (0.4 + rnd() * 1.1) * d, (0.3 + rnd() * 0.5) * d, rnd() * 3, 0, TAU); g.fill();
      }
    }
    if (id === 'paper-celadon') {
      // Faint glaze crackle.
      g.strokeStyle = rgba(shade(P.fiber, 0.8), 0.18);
      g.lineWidth = 0.6 * d;
      for (let k = 0; k < area / 9000; k++) {
        let x = rnd() * W, y = rnd() * H;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (rnd() - 0.5) * 40 * d; y += (rnd() - 0.5) * 40 * d; g.lineTo(x, y); }
        g.stroke();
      }
    }
    // Fine grain.
    if (this.grain) {
      const pat = g.createPattern(this.grain, 'repeat');
      if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, H); }
    }
  }

  private drawGrid(g: CanvasRenderingContext2D): void {
    const sim = this.sim!, L = sim.L, W = sim.w, H = sim.h, s = this.lay.cell;
    const x0 = this.lay.x, y0 = this.lay.y;
    const P = this.paper;
    const open = (i: number) => !L.wall[i];
    g.lineCap = 'round';
    g.strokeStyle = rgba(P.grid, P.dark ? 0.16 : 0.13);
    g.lineWidth = Math.max(0.6, s * 0.012);
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!open(i)) continue;
      if (x + 1 < W && open(i + 1)) { const lx = x0 + (x + 1) * s; g.moveTo(lx, y0 + y * s + s * 0.08); g.lineTo(lx + 0.3, y0 + y * s + s * 0.92); }
      if (y + 1 < H && open(i + W)) { const ly = y0 + (y + 1) * s; g.moveTo(x0 + x * s + s * 0.08, ly); g.lineTo(x0 + x * s + s * 0.92, ly + 0.3); }
    }
    g.stroke();
    // Corner ticks where four paper cells meet.
    g.strokeStyle = rgba(P.grid, P.dark ? 0.38 : 0.32);
    g.lineWidth = Math.max(0.8, s * 0.018);
    const a = s * 0.075;
    g.beginPath();
    for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
      const i = y * W + x;
      if (!(open(i) && open(i - 1) && open(i - W) && open(i - W - 1))) continue;
      const px = x0 + x * s, py = y0 + y * s;
      g.moveTo(px - a, py); g.lineTo(px + a, py);
      g.moveTo(px, py - a); g.lineTo(px, py + a);
    }
    g.stroke();
  }

  private drawGoals(g: CanvasRenderingContext2D): void {
    const sim = this.sim!, L = sim.L, s = this.lay.cell;
    const P = this.paper;
    for (const i of L.targets) {
      const c = L.goal[i], Pc = this.pal[c];
      const r = this.cellRect(i), cx = r.x + s / 2, cy = r.y + s / 2;
      g.fillStyle = Pc.wash;
      g.beginPath();
      rrect(g, r.x + s * 0.09, r.y + s * 0.09, s * 0.82, s * 0.82, s * 0.2);
      g.fill();
      const lw = Math.max(2, s * 0.062);
      g.strokeStyle = P.dark ? 'rgba(0,0,0,0.35)' : rgba(P.base, 0.9);
      g.lineWidth = lw + 2.2;
      g.beginPath(); g.arc(cx, cy, s * 0.29, 0, TAU); g.stroke();
      g.strokeStyle = Pc.ring;
      g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, s * 0.29, 0, TAU); g.stroke();
      if (this.opts.symbols) drawGlyph(g, c, cx, cy, s * 0.27, Pc.ring);
      else { g.fillStyle = Pc.ring; g.beginPath(); g.arc(cx, cy, s * 0.065, 0, TAU); g.fill(); }
    }
    for (const i of L.whites) {
      const r = this.cellRect(i), cx = r.x + s / 2, cy = r.y + s / 2;
      const ins = s * 0.12;
      g.fillStyle = P.dark ? rgba('#ffffff', 0.05) : rgba('#ffffff', 0.55);
      g.beginPath();
      rrect(g, r.x + ins, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.14);
      g.fill();
      g.save();
      g.setLineDash([0.01, Math.max(3.2, s * 0.075)]);
      g.lineCap = 'round';
      g.lineWidth = Math.max(1.6, s * 0.035);
      g.strokeStyle = rgba(P.grid, P.dark ? 0.75 : 0.62);
      g.beginPath();
      rrect(g, r.x + ins, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.14);
      g.stroke();
      g.restore();
      g.strokeStyle = rgba(P.grid, P.dark ? 0.75 : 0.6);
      g.lineWidth = Math.max(1.3, s * 0.03);
      g.beginPath(); g.arc(cx, cy, s * 0.1, 0, TAU); g.stroke();
    }
  }

  private drawSlow(g: CanvasRenderingContext2D, rnd: () => number): void {
    const sim = this.sim!, L = sim.L, n = sim.w * sim.h, s = this.lay.cell;
    const P = this.paper;
    let any = false;
    for (let i = 0; i < n; i++) if (L.slow[i]) { any = true; break; }
    if (!any) return;
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      if (!L.slow[i]) continue;
      const r = this.cellRect(i);
      const gm = this.geomOf(i, (j) => !!L.slow[j]);
      cellPath(path, r.x, r.y, s, gm & 15, gm >> 4, s * 0.03, s * 0.14, s * 0.012, i * 5 + 2);
    }
    const base = P.dark ? shade(P.base, 1, 1, 0.07) : shade(P.base, 0.9, 1.25);
    g.save();
    g.shadowColor = P.dark ? 'rgba(0,0,0,0.4)' : 'rgba(80,60,30,0.18)';
    g.shadowBlur = s * 0.06 * this.dpr;
    g.shadowOffsetY = s * 0.02 * this.dpr;
    g.fillStyle = base;
    g.fill(path);
    g.restore();
    g.save();
    g.clip(path);
    // dense fibers
    const x0 = this.lay.x, y0 = this.lay.y;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      if (!L.slow[i]) continue;
      const r = this.cellRect(i);
      for (let k = 0; k < 16; k++) {
        const x = r.x + rnd() * s, y = r.y + rnd() * s, len = s * (0.08 + rnd() * 0.22), a = rnd() * TAU;
        g.strokeStyle = rnd() < 0.3 ? (P.dark ? rgba('#ffffff', 0.08) : 'rgba(255,255,255,0.5)') : rgba(shade(P.fiber, P.dark ? 1.3 : 0.85), 0.35 + rnd() * 0.3);
        g.lineWidth = 0.5 + rnd() * 0.8;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    }
    // Quilting stitches (diagonal both ways).
    const step = s / 3;
    g.strokeStyle = rgba(P.dark ? shade(P.fiber, 1.6) : shade(P.fiber, 0.62), P.dark ? 0.5 : 0.55);
    g.lineWidth = Math.max(0.9, s * 0.02);
    g.setLineDash([s * 0.07, s * 0.05]);
    g.beginPath();
    const span = (sim.w + sim.h) * s;
    for (let k = -span; k < span; k += step) {
      g.moveTo(x0 + k, y0); g.lineTo(x0 + k + sim.h * s, y0 + sim.h * s);
      g.moveTo(x0 + k, y0 + sim.h * s); g.lineTo(x0 + k + sim.h * s, y0);
    }
    g.stroke();
    g.setLineDash([]);
    // Raised padded edge: light top-left, dark bottom-right.
    g.lineWidth = Math.max(1.2, s * 0.04);
    for (let i = 0; i < n; i++) {
      if (!L.slow[i]) continue;
      const r = this.cellRect(i);
      const gm = this.geomOf(i, (j) => !!L.slow[j]);
      const ins = s * 0.03 + g.lineWidth / 2;
      g.strokeStyle = P.dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)';
      g.beginPath();
      if (gm & S_T) { g.moveTo(r.x + ins, r.y + ins); g.lineTo(r.x + s - ins, r.y + ins); }
      if (gm & S_L) { g.moveTo(r.x + ins, r.y + ins); g.lineTo(r.x + ins, r.y + s - ins); }
      g.stroke();
      g.strokeStyle = P.dark ? 'rgba(0,0,0,0.35)' : rgba(shade(P.fiber, 0.6), 0.45);
      g.beginPath();
      if (gm & S_B) { g.moveTo(r.x + ins, r.y + s - ins); g.lineTo(r.x + s - ins, r.y + s - ins); }
      if (gm & S_R) { g.moveTo(r.x + s - ins, r.y + ins); g.lineTo(r.x + s - ins, r.y + s - ins); }
      g.stroke();
    }
    g.restore();
  }

  private drawWalls(g: CanvasRenderingContext2D, rnd: () => number): void {
    const sim = this.sim!, L = sim.L, n = sim.w * sim.h, s = this.lay.cell;
    const P = this.paper;
    const isWall = (j: number) => !!L.wall[j] && !L.hole[j];
    const path = new Path2D();
    let any = false;
    const gw = Math.max(1, s * 0.04);
    for (let i = 0; i < n; i++) {
      if (!isWall(i)) continue;
      any = true;
      const r = this.cellRect(i);
      const gm = this.geomOf(i, isWall);
      cellPath(path, r.x, r.y, s, gm & 15, gm >> 4, gw, s * 0.2, s * 0.008, i * 3 + 7);
    }
    if (!any) return;
    g.save();
    g.shadowColor = P.dark ? 'rgba(0,0,0,0.7)' : 'rgba(30,20,10,0.35)';
    g.shadowBlur = s * 0.12 * this.dpr;
    g.shadowOffsetY = s * 0.05 * this.dpr;
    g.fillStyle = P.wall;
    g.fill(path);
    g.restore();
    g.save();
    g.clip(path);
    const gr = g.createLinearGradient(0, this.lay.y, 0, this.lay.y + this.lay.h);
    gr.addColorStop(0, mix(P.wall, P.wallEdge, 0.35));
    gr.addColorStop(1, shade(P.wall, 0.8));
    g.fillStyle = gr;
    g.fill(path);
    // Stone texture: soft sheen blobs, specks and striations.
    for (let i = 0; i < n; i++) {
      if (!isWall(i)) continue;
      const r = this.cellRect(i);
      const sg = g.createRadialGradient(r.x + s * 0.3, r.y + s * 0.25, 0, r.x + s * 0.3, r.y + s * 0.25, s * 0.8);
      sg.addColorStop(0, rgba(P.wallEdge, 0.28));
      sg.addColorStop(1, rgba(P.wallEdge, 0));
      g.fillStyle = sg;
      g.fillRect(r.x - 1, r.y - 1, s + 2, s + 2);
      for (let k = 0; k < 22; k++) {
        g.fillStyle = rnd() < 0.6 ? rgba('#ffffff', 0.04 + rnd() * 0.07) : rgba('#000000', 0.1 + rnd() * 0.12);
        g.beginPath(); g.arc(r.x + rnd() * s, r.y + rnd() * s, 0.4 + rnd() * 1.1, 0, TAU); g.fill();
      }
      g.strokeStyle = rgba(P.wallEdge, 0.12);
      g.lineWidth = 0.8;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const yy = r.y + s * (0.2 + rnd() * 0.6);
        g.moveTo(r.x + s * rnd() * 0.3, yy); g.quadraticCurveTo(r.x + s * 0.5, yy + (rnd() - 0.5) * s * 0.15, r.x + s * (0.7 + rnd() * 0.3), yy + (rnd() - 0.5) * s * 0.1);
      }
      g.stroke();
    }
    g.restore();
    // Bevel highlights on exposed top/left edges.
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      if (!isWall(i)) continue;
      const r = this.cellRect(i);
      const gm = this.geomOf(i, isWall);
      const ins = gw + Math.max(1, s * 0.03);
      const rr = s * 0.2;
      g.strokeStyle = rgba(P.wallEdge, 0.95);
      g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath();
      if (gm & S_T) { g.moveTo(r.x + ((gm & S_L) ? rr + gw : 0), r.y + ins); g.lineTo(r.x + s - ((gm & S_R) ? rr + gw : 0), r.y + ins); }
      g.stroke();
      g.strokeStyle = rgba(P.wallEdge, 0.45);
      g.beginPath();
      if (gm & S_L) { g.moveTo(r.x + ins, r.y + ((gm & S_T) ? rr + gw : 0)); g.lineTo(r.x + ins, r.y + s - ((gm & S_B) ? rr + gw : 0)); }
      g.stroke();
    }
  }

  private drawGate(g: CanvasRenderingContext2D, i: number): void {
    const s = this.lay.cell, c = this.sim!.L.gate[i], Pc = this.pal[c];
    const r = this.cellRect(i), cx = r.x + s / 2, cy = r.y + s / 2;
    const R = s * 0.37, lw = Math.max(2.4, s * 0.085);
    // Tinted frame around a round "moon gate" opening.
    g.fillStyle = mix(this.paper.base, Pc.body, this.paper.dark ? 0.3 : 0.24);
    g.beginPath();
    rrect(g, r.x + s * 0.04, r.y + s * 0.04, s * 0.92, s * 0.92, s * 0.1);
    g.moveTo(cx + R, cy);
    g.arc(cx, cy, R, 0, TAU, true);
    g.fill();
    // Stripes in the corners: "only this colour passes".
    g.save();
    g.beginPath();
    rrect(g, r.x + s * 0.04, r.y + s * 0.04, s * 0.92, s * 0.92, s * 0.1);
    g.moveTo(cx + R, cy);
    g.arc(cx, cy, R, 0, TAU, true);
    g.clip();
    g.strokeStyle = rgba(Pc.ring, 0.45);
    g.lineWidth = Math.max(1, s * 0.03);
    g.beginPath();
    for (let k = -s; k < s * 2; k += s * 0.14) { g.moveTo(r.x + k, r.y); g.lineTo(r.x + k + s, r.y + s); }
    g.stroke();
    g.restore();
    g.strokeStyle = Pc.ring;
    g.lineWidth = lw;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.strokeStyle = rgba(Pc.deep, 0.45);
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R - lw * 0.55, 0, TAU); g.stroke();
    // Key stone on top + two feet.
    g.fillStyle = Pc.ring;
    g.beginPath(); rrect(g, cx - s * 0.06, r.y + s * 0.04, s * 0.12, s * 0.1, s * 0.03); g.fill();
    if (this.opts.symbols) {
      g.fillStyle = this.paper.dark ? 'rgba(0,0,0,0.35)' : rgba(this.paper.base, 0.85);
      g.beginPath(); g.arc(r.x + s * 0.16, r.y + s * 0.16, s * 0.11, 0, TAU); g.fill();
      drawGlyph(g, c, r.x + s * 0.16, r.y + s * 0.16, s * 0.15, Pc.ring);
    }
  }

  // ------------------------------------------------------------------ ink

  private nb(i: number, k: number): number {
    const sim = this.sim!;
    const w = sim.w, x = i % w;
    if (k === 0) return i >= w ? i - w : -1;
    if (k === 1) return x < w - 1 ? i + 1 : -1;
    if (k === 2) return i + w < w * sim.h ? i + w : -1;
    return x > 0 ? i - 1 : -1;
  }

  /** Open-side bits (low 4) and concave-corner bits (<<4) for a cell given a "same region" test. */
  private geomOf(i: number, same: (j: number) => boolean): number {
    const sim = this.sim!;
    const w = sim.w, h = sim.h, x = i % w, y = (i - x) / w;
    const ok = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && same(yy * w + xx);
    const t = ok(x, y - 1), r = ok(x + 1, y), b = ok(x, y + 1), l = ok(x - 1, y);
    let open = 0, conc = 0;
    if (!t) open |= S_T;
    if (!r) open |= S_R;
    if (!b) open |= S_B;
    if (!l) open |= S_L;
    if (t && l && !ok(x - 1, y - 1)) conc |= C_TL;
    if (t && r && !ok(x + 1, y - 1)) conc |= C_TR;
    if (b && r && !ok(x + 1, y + 1)) conc |= C_BR;
    if (b && l && !ok(x - 1, y + 1)) conc |= C_BL;
    return open | (conc << 4);
  }

  private inkGeom(i: number): number {
    const sim = this.sim!, c = sim.ink[i], L = sim.L;
    return this.geomOf(i, (j) => sim.ink[j] === c && !L.hole[j]);
  }

  /** Draws one inked cell (all layers opaque, so redrawing is idempotent). */
  private drawCell(g: CanvasRenderingContext2D, i: number, fin = false): void {
    const sim = this.sim!;
    const c = sim.ink[i];
    const P = this.pal[c];
    const s = this.lay.cell;
    const w = sim.w, cx0 = i % w;
    const x = this.lay.x + cx0 * s, y = this.lay.y + ((i - cx0) / w) * s;
    const gm = this.inkGeom(i);
    const open = gm & 15, conc = gm >> 4;
    const seed = i * 7 + 13;
    const gap = fin ? this.gap * 0.35 : this.gap;
    const amp = fin ? this.amp * 0.6 : this.amp;
    const rc = this.rc;
    if (open && !fin) {
      g.fillStyle = P.halo;
      g.beginPath();
      cellPath(g, x, y, s, open, conc, gap - this.haloW, rc + this.haloW, amp, seed);
      g.fill();
    }
    g.fillStyle = P.edge;
    g.beginPath();
    cellPath(g, x, y, s, open, conc, gap, rc, amp, seed);
    g.fill();
    g.fillStyle = P.mid;
    g.beginPath();
    cellPath(g, x, y, s, open, conc, gap + this.e1, rc - this.e1, amp, seed);
    g.fill();
    g.fillStyle = P.pat;
    g.beginPath();
    cellPath(g, x, y, s, open, conc, gap + this.e2, rc - this.e2, amp, seed);
    g.fill();
    const cx = x + s / 2, cy = y + s / 2;
    if (sim.mixed[i] && c !== 7) {
      // Watercolour bloom (backrun): pale scalloped centre with a darker rim.
      g.fillStyle = P.light;
      g.strokeStyle = P.edge;
      g.lineWidth = Math.max(1, s * 0.022);
      g.beginPath();
      blobPath(g, cx, cy, s * 0.27, seed, 0.06, 7, 0.1, 42);
      g.fill();
      g.stroke();
      g.fillStyle = P.mid;
      g.beginPath();
      blobPath(g, cx, cy, s * 0.1, seed + 5, 0.15, 5, 0.12, 20);
      g.fill();
    } else if (c === 7) {
      // Mud: dull blotches.
      g.fillStyle = P.mid;
      g.beginPath();
      blobPath(g, cx - s * 0.1, cy - s * 0.06, s * 0.2, seed, 0.3);
      blobPath(g, cx + s * 0.14, cy + s * 0.12, s * 0.13, seed + 3, 0.35);
      g.fill();
    }
    if (this.opts.symbols && sim.L.goal[i] !== c) {
      drawGlyph(g, c, cx, cy, s * (sim.mixed[i] ? 0.24 : 0.28), sim.mixed[i] && c !== 7 ? P.deep : P.glyph);
    }
  }

  private updateInkCache(): void {
    const sim = this.sim, cache = this.inkC;
    if (!sim || !cache) return;
    this.cacheDirty = false;
    const g = this.layerCtx(cache);
    const n = sim.w * sim.h;
    if (this.drawnSig.length !== n) { this.drawnSig = new Int32Array(n).fill(-1); this.cacheFull = true; }
    if (!this.cacheFull) {
      // A drawn cell lost its ink or changed colour (rewind) → full rebuild.
      for (let i = 0; i < n; i++) {
        const ds = this.drawnSig[i];
        if (ds >= 0 && (sim.ink[i] !== (ds & 7))) { this.cacheFull = true; break; }
      }
    }
    if (this.cacheFull) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cache.width, cache.height);
      g.restore();
      this.drawnSig.fill(-1);
      this.cacheFull = false;
    }
    for (let i = 0; i < n; i++) {
      const c = sim.ink[i];
      if (!c || sim.L.hole[i] || this.grow.has(i)) continue;
      const sig = c | (sim.mixed[i] << 3) | (this.inkGeom(i) << 4);
      if (sig !== this.drawnSig[i]) {
        this.drawCell(g, i);
        this.drawnSig[i] = sig;
      }
    }
    this.needsDraw = true;
  }

  // ------------------------------------------------------------------ preview

  private computePreview(): void {
    this.tendrils.length = 0;
    this.mixHints.length = 0;
    this.wakeHints.length = 0;
    const sim = this.sim;
    if (!sim || sim.settled()) return;
    const fc = this.frontColor;
    fc.fill(0);
    for (const wv of sim.waves) for (const f of wv.front) if (f.wait === 0 && f.d < wv.range) fc[f.idx] |= wv.c;
    const c2 = sim.clone();
    const ev = c2.step();
    const gate = sim.L.gate;
    for (const e of ev) {
      if (e.type === 'fill' || e.type === 'mix') {
        for (let k = 0; k < 4; k++) {
          const n = this.nb(e.idx, k);
          if (n < 0) continue;
          const fcol = fc[n] & e.c;
          if (!fcol) continue;
          if (gate[e.idx] && gate[e.idx] !== fcol) continue;
          this.tendrils.push({ idx: e.idx, side: k, c: fcol });
        }
        if (e.type === 'mix') this.mixHints.push(e.idx);
      } else if (e.type === 'seed') {
        this.wakeHints.push(e.idx);
        for (let k = 0; k < 4; k++) {
          const n = this.nb(e.idx, k);
          if (n >= 0 && fc[n]) this.tendrils.push({ idx: e.idx, side: k, c: fc[n] });
        }
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  private draw(now: number, previewLive: boolean): void {
    const ctx = this.ctx, d = this.dpr, s = this.lay.cell;
    const win = this.win;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const wk = win ? (win.done ? 1 : clamp01((now - win.t0) / win.dur)) : 0;
    const fade = win ? smooth(0.05, 0.55, wk) : 0;
    // Static layer.
    if (win && this.statFin) {
      ctx.drawImage(this.statFin, this.ox, this.oy);
      if (fade < 1) { ctx.globalAlpha = 1 - fade; ctx.drawImage(this.stat!, this.ox, this.oy); ctx.globalAlpha = 1; }
    } else ctx.drawImage(this.stat!, this.ox, this.oy);

    // Ink.
    const showPreview = previewLive && !win;
    const growing = this.grow.size > 0;
    let inkLayer: HTMLCanvasElement = this.inkC!;
    if (growing || showPreview) {
      const dyn = this.dyn!;
      const g = this.layerCtx(dyn);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, dyn.width, dyn.height);
      g.drawImage(this.inkC!, 0, 0);
      g.restore();
      if (showPreview) this.drawTendrils(g, now);
      for (const [i, gr] of this.grow) this.drawGrowth(g, i, gr, clamp01((now - gr.t0) / gr.dur));
      inkLayer = dyn;
    }
    ctx.globalAlpha = win ? this.inkAlpha + (1 - this.inkAlpha) * fade : this.inkAlpha;
    ctx.drawImage(inkLayer, this.ox, this.oy);
    if (win && this.inkFin && fade > 0) {
      ctx.globalAlpha = 0.96 * fade;
      ctx.drawImage(this.inkFin, this.ox, this.oy);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawSeeds(ctx, now);
    if (showPreview && this.mixHints.length) this.drawMixHints(ctx, now);
    this.drawMetMarks(ctx, now, win ? 1 - fade : 1);
    if (!win) {
      this.drawWrong(ctx);
      if (this.ghosts) this.drawGhosts(ctx, now);
    }
    this.drawFx(ctx, now);
    if (win) this.drawWin(ctx, now, wk);
    this.drawParticles(ctx, now);
    void s;
  }

  private drawTendrils(g: CanvasRenderingContext2D, now: number): void {
    const s = this.lay.cell;
    let depth: number;
    if (this.running) depth = 0.3 * smooth(0.45, 1, this.phase);
    else depth = this.opts.reducedMotion ? 0.16 : 0.12 + 0.07 * (0.5 + 0.5 * Math.sin(now / 520));
    if (depth < 0.01) return;
    const back = this.gap + this.e2 + 1;
    for (const t of this.tendrils) {
      const P = this.pal[t.c];
      const r = this.cellRect(t.idx);
      const k = t.side;
      // Entry edge midpoint and inward direction.
      const ex = r.x + s / 2 + DIRX[k] * s / 2, ey = r.y + s / 2 + DIRY[k] * s / 2;
      const ix = -DIRX[k], iy = -DIRY[k];
      const ang = Math.atan2(iy, ix);
      const cx = ex - ix * back, cy = ey - iy * back;
      const along = depth * s + back;
      const half = s * (0.17 + 0.35 * depth);
      const layer = (fill: string | CanvasPattern, inset: number) => {
        g.fillStyle = fill;
        g.beginPath();
        g.ellipse(cx, cy, Math.max(0.5, along - inset), Math.max(0.5, half - inset), ang, -HALF_PI, HALF_PI);
        g.closePath();
        g.fill();
      };
      layer(P.edge, 0);
      layer(P.mid, this.e1);
      layer(P.pat, this.e2 * 0.9);
    }
  }

  private drawGrowth(g: CanvasRenderingContext2D, i: number, gr: Grow, p: number): void {
    const sim = this.sim!;
    const s = this.lay.cell;
    const r = this.cellRect(i);
    const P = this.pal[sim.ink[i]];
    const e = easeOut(p);
    g.save();
    // Clip 1: cell bounds (+ overlap into joined neighbours).
    g.beginPath();
    g.rect(r.x - EXT - 1, r.y - EXT - 1, s + 2 * EXT + 2, s + 2 * EXT + 2);
    g.clip();
    // Clip 2: growth shape.
    g.beginPath();
    const cx = r.x + s / 2, cy = r.y + s / 2;
    if (gr.mode === 0) {
      const along = s * (0.3 + 1.0 * e), half = s * (0.27 + 0.95 * e);
      for (let k = 0; k < 4; k++) {
        if (!(gr.sides & (1 << k))) continue;
        const ex = cx + DIRX[k] * s / 2, ey = cy + DIRY[k] * s / 2;
        g.moveTo(ex, ey);
        g.ellipse(ex, ey, along, half, Math.atan2(-DIRY[k], -DIRX[k]), -HALF_PI, HALF_PI);
        g.closePath();
      }
    } else if (gr.mode === 1) {
      blobPath(g, cx, cy, s * (0.12 + 0.66 * e), i * 11 + 1, 0.1);
    } else {
      blobPath(g, cx, cy, s * (0.4 + 0.42 * e), i * 11 + 2, 0.05, 7, 0.12, 36);
    }
    g.clip();
    this.drawCell(g, i);
    // Wet front: darker rim on the advancing edge, fading as the ink settles.
    if (p < 1) {
      g.globalAlpha = (1 - p) * 0.85;
      g.strokeStyle = P.edge;
      g.lineWidth = this.e1 * 2.2;
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  private hasDormantSeeds(): boolean {
    const sim = this.sim!;
    const n = sim.w * sim.h;
    for (let i = 0; i < n; i++) if (sim.seed[i]) return true;
    return false;
  }

  private drawSeeds(ctx: CanvasRenderingContext2D, now: number): void {
    const sim = this.sim!, n = sim.w * sim.h, s = this.lay.cell;
    const rm = this.opts.reducedMotion;
    for (let i = 0; i < n; i++) {
      const c = sim.seed[i];
      if (!c) continue;
      const sp = this.dropSprites[c];
      if (!sp) continue;
      const cc = this.cellCenter(i);
      let sc = rm ? 1 : 1 + 0.05 * Math.sin(now / 420 + i);
      const waking = !this.win && this.wakeHints.indexOf(i) >= 0;
      if (waking) {
        const k = this.running ? smooth(0.3, 1, this.phase) : 0.4;
        sc += 0.14 * k;
        ctx.globalAlpha = 0.5 * k + 0.2;
        const gs = s * (0.9 + 0.3 * k);
        ctx.drawImage(this.pal[c].glow, cc.x - gs / 2, cc.y - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
      }
      if (!rm) {
        // Slow breathing ring.
        const k = ((now / 2200 + i * 0.37) % 1);
        ctx.strokeStyle = rgba(this.pal[c].ring, 0.35 * (1 - k));
        ctx.lineWidth = Math.max(1, s * 0.025);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, s * (0.24 + 0.16 * k), 0, TAU); ctx.stroke();
      }
      const w = sp.width / this.dpr * sc, h = sp.height / this.dpr * sc;
      ctx.drawImage(sp, cc.x - w / 2, cc.y - h * 0.6, w, h);
      if (this.opts.symbols) {
        ctx.globalAlpha = 0.9;
        drawGlyph(ctx, c, cc.x + s * 0.3, cc.y + s * 0.3, s * 0.16, this.pal[c].ring);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawMixHints(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.lay.cell;
    const sim = this.sim!;
    const k = this.running ? smooth(0.55, 1, this.phase) : 0.35 + (this.opts.reducedMotion ? 0 : 0.15 * Math.sin(now / 520));
    if (k <= 0.01) return;
    for (const i of this.mixHints) {
      // Which colour will appear: OR of the tendrils arriving here.
      let c = 0;
      for (const t of this.tendrils) if (t.idx === i) c |= t.c;
      if (!c) continue;
      const cc = this.cellCenter(i);
      ctx.globalAlpha = 0.55 * k;
      const gs = s * 0.7;
      ctx.drawImage(this.pal[c].glow, cc.x - gs / 2, cc.y - gs / 2, gs, gs);
      ctx.globalAlpha = 0.8 * k;
      ctx.fillStyle = this.pal[c].body;
      ctx.beginPath(); blobPath(ctx, cc.x, cc.y, s * 0.075 * (0.6 + 0.4 * k), i, 0.2); ctx.fill();
      ctx.globalAlpha = 1;
      void sim;
    }
  }

  private drawMetMarks(ctx: CanvasRenderingContext2D, now: number, alpha: number): void {
    const sim = this.sim!, s = this.lay.cell;
    if (alpha <= 0.01) {
      // Finished painting: leave a faint highlight on each target.
      if (this.win) {
        ctx.strokeStyle = this.paper.dark ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(1, s * 0.03);
        for (const t of sim.L.targets) {
          if (sim.ink[t] !== sim.L.goal[t]) continue;
          const cc = this.cellCenter(t);
          ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.12, 0, TAU); ctx.stroke();
        }
      }
      return;
    }
    for (const t of sim.L.targets) {
      if (!this.metShown[t] || sim.ink[t] !== sim.L.goal[t]) continue;
      const P = this.pal[sim.L.goal[t]];
      const cc = this.cellCenter(t);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.3, 0, TAU); ctx.stroke();
      ctx.strokeStyle = P.deep;
      ctx.lineWidth = Math.max(2, s * 0.055);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cc.x - s * 0.095, cc.y + s * 0.005);
      ctx.lineTo(cc.x - s * 0.025, cc.y + s * 0.075);
      ctx.lineTo(cc.x + s * 0.105, cc.y - s * 0.075);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    void now;
  }

  private drawWrong(ctx: CanvasRenderingContext2D): void {
    if (!this.wrong.length) return;
    const sim = this.sim!, s = this.lay.cell;
    const red = '#d93a2b';
    for (const i of this.wrong) {
      const r = this.cellRect(i);
      const cx = r.x + s / 2, cy = r.y + s / 2;
      // Expected colour (target) shown again on top of the wrong ink.
      const goal = sim.L.goal[i];
      if (goal && goal !== WHITE) {
        const P = this.pal[goal];
        ctx.fillStyle = this.paper.dark ? rgba(this.paper.base, 0.9) : 'rgba(255,255,255,0.86)';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.27, 0, TAU); ctx.fill();
        ctx.strokeStyle = P.ring;
        ctx.lineWidth = Math.max(2, s * 0.06);
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, TAU); ctx.stroke();
        if (this.opts.symbols) drawGlyph(ctx, goal, cx, cy, s * 0.22, P.ring);
        else { ctx.fillStyle = P.body; ctx.beginPath(); ctx.arc(cx, cy, s * 0.12, 0, TAU); ctx.fill(); }
      }
      // Outline: white halo + red dashes.
      const ins = s * 0.06;
      ctx.lineWidth = Math.max(3, s * 0.07);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); rrect(ctx, r.x + ins, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.16); ctx.stroke();
      ctx.lineWidth = Math.max(2, s * 0.045);
      ctx.strokeStyle = red;
      ctx.setLineDash([s * 0.12, s * 0.07]);
      ctx.beginPath(); rrect(ctx, r.x + ins, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.16); ctx.stroke();
      ctx.setLineDash([]);
      // Corner badge with a cross.
      const bx = r.x + s * 0.84, by = r.y + s * 0.16, br = Math.max(7, s * 0.15);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      ctx.strokeStyle = red;
      ctx.lineWidth = Math.max(1.5, br * 0.22);
      ctx.beginPath(); ctx.arc(bx, by, br - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, br * 0.28);
      const q = br * 0.42;
      ctx.beginPath(); ctx.moveTo(bx - q, by - q); ctx.lineTo(bx + q, by + q); ctx.moveTo(bx + q, by - q); ctx.lineTo(bx - q, by + q); ctx.stroke();
    }
  }

  private drawGhosts(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.lay.cell, sim = this.sim!;
    const rm = this.opts.reducedMotion;
    for (const gh of this.ghosts!) {
      if (gh.idx < 0 || gh.idx >= sim.w * sim.h) continue;
      const P = this.pal[gh.color] || this.pal[1];
      const cc = this.cellCenter(gh.idx);
      if (gh.state === 'done') {
        ctx.strokeStyle = rgba(P.ring, 0.3);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.34, 0, TAU); ctx.stroke();
        continue;
      }
      if (gh.state === 'now') {
        const k = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 160);
        // soft fill of the ink to drop
        ctx.globalAlpha = 0.3 + 0.15 * k;
        const gs = s * 1.05;
        ctx.drawImage(P.glow, cc.x - gs / 2, cc.y - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(P.body, 0.28);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = this.paper.dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(3, s * 0.1);
        const rr = s * (0.36 + 0.04 * k);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, rr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = P.ring;
        ctx.lineWidth = Math.max(2.2, s * 0.065);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, rr, 0, TAU); ctx.stroke();
        if (!rm) {
          const q = (now / 1100) % 1;
          ctx.strokeStyle = rgba(P.ring, 0.6 * (1 - q));
          ctx.lineWidth = Math.max(1.5, s * 0.04 * (1 - q));
          ctx.beginPath(); ctx.arc(cc.x, cc.y, s * (0.38 + 0.3 * q), 0, TAU); ctx.stroke();
        }
        if (this.opts.symbols) drawGlyph(ctx, gh.color, cc.x, cc.y, s * 0.26, P.deep);
        else { ctx.fillStyle = P.body; ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.1, 0, TAU); ctx.fill(); }
      } else {
        ctx.save();
        ctx.setLineDash([s * 0.08, s * 0.06]);
        ctx.strokeStyle = rgba(P.ring, 0.75);
        ctx.lineWidth = Math.max(1.6, s * 0.04);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.32, 0, TAU); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = rgba(P.body, 0.14);
        ctx.beginPath(); ctx.arc(cc.x, cc.y, s * 0.3, 0, TAU); ctx.fill();
      }
      // Order badge (+ beats to wait as pips).
      const bx = cc.x + s * 0.3, by = cc.y - s * 0.3, br = Math.max(8, s * 0.15);
      ctx.fillStyle = this.paper.dark ? '#f4efe4' : '#2b2622';
      ctx.globalAlpha = gh.state === 'now' ? 1 : 0.8;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.ring;
      ctx.lineWidth = Math.max(1.5, br * 0.18);
      ctx.stroke();
      ctx.fillStyle = this.paper.dark ? '#2b2622' : '#ffffff';
      ctx.font = '700 ' + Math.round(br * 1.15) + 'px Pretendard, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(gh.order + 1), bx, by + br * 0.06);
      const wait = Math.min(5, gh.beat - sim.tick);
      if (gh.state === 'upcoming' && wait > 0) {
        ctx.fillStyle = P.ring;
        const pr = Math.max(1.6, s * 0.035), gapx = pr * 2.8;
        const sx = cc.x - ((wait - 1) * gapx) / 2;
        for (let k = 0; k < wait; k++) { ctx.beginPath(); ctx.arc(sx + k * gapx, cc.y + s * 0.42, pr, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawFx(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.lay.cell;
    const rm = this.opts.reducedMotion;
    for (const f of this.fx) {
      const k = (now - f.t0) / f.dur;
      if (k < 0 || k > 1) continue;
      const P = this.pal[f.c] || this.pal[7];
      switch (f.kind) {
        case FX_SPLASH: {
          const e = easeOut(k);
          ctx.strokeStyle = rgba(P.edge, 0.75 * (1 - k));
          ctx.lineWidth = Math.max(1, s * 0.07 * (1 - e));
          ctx.beginPath(); ctx.arc(f.x, f.y, s * (0.3 + 0.85 * e), 0, TAU); ctx.stroke();
          const k2 = clamp01((now - f.t0 - 90) / (f.dur - 90));
          if (k2 > 0 && k2 < 1) {
            const e2 = easeOut(k2);
            ctx.strokeStyle = rgba(P.body, 0.5 * (1 - k2));
            ctx.lineWidth = Math.max(1, s * 0.04 * (1 - e2));
            ctx.beginPath(); ctx.arc(f.x, f.y, s * (0.2 + 0.55 * e2), 0, TAU); ctx.stroke();
          }
          break;
        }
        case FX_BLOOM: {
          const e = easeOut(k);
          ctx.globalAlpha = 0.75 * (1 - k);
          const gs = s * (0.8 + 1.0 * e);
          ctx.drawImage(P.glow, f.x - gs / 2, f.y - gs / 2, gs, gs);
          // Petals opening outward.
          ctx.globalAlpha = 0.85 * (1 - k * k);
          ctx.fillStyle = P.light;
          const np = 7, rot = hash01(f.idx, 4) * TAU + e * 0.5;
          for (let j = 0; j < np; j++) {
            const a = rot + (j / np) * TAU;
            const dist = s * (0.22 + 0.42 * e);
            ctx.beginPath();
            ctx.ellipse(f.x + Math.cos(a) * dist, f.y + Math.sin(a) * dist, s * 0.11 * (1 - 0.5 * k), s * 0.055 * (1 - 0.5 * k), a, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          // Centre sparkle.
          const sk = Math.sin(Math.PI * clamp01(k * 1.6));
          if (sk > 0.01 && this.sparkle) {
            const ss = s * 0.75 * sk;
            ctx.drawImage(this.sparkle, f.x - ss / 2, f.y - ss / 2, ss, ss);
          }
          break;
        }
        case FX_BURST: {
          const e = easeOut(k);
          ctx.globalAlpha = 0.7 * (1 - k);
          const gs = s * (0.6 + 1.3 * e);
          ctx.drawImage(P.glow, f.x - gs / 2, f.y - gs / 2, gs, gs);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(P.ring, 0.8 * (1 - k));
          ctx.lineWidth = Math.max(1, s * 0.06 * (1 - e));
          ctx.beginPath(); ctx.arc(f.x, f.y, s * (0.25 + 0.9 * e), 0, TAU); ctx.stroke();
          break;
        }
        case FX_SPARK: {
          const a = Math.sin(Math.PI * k);
          const half = s * 0.36;
          const vert = f.v === 1;
          ctx.lineCap = 'round';
          // Coloured glow on both sides, white core on the shared edge.
          ctx.globalAlpha = 0.55 * a;
          const gs = s * 0.6;
          const off = s * 0.12;
          const Pa = this.pal[f.c] || this.pal[1], Pb = this.pal[f.b] || this.pal[1];
          ctx.drawImage(Pa.glow, f.x - gs / 2 - (vert ? off : 0), f.y - gs / 2 - (vert ? 0 : off), gs, gs);
          ctx.drawImage(Pb.glow, f.x - gs / 2 + (vert ? off : 0), f.y - gs / 2 + (vert ? 0 : off), gs, gs);
          ctx.globalAlpha = a;
          ctx.strokeStyle = 'rgba(255,252,235,0.95)';
          ctx.lineWidth = Math.max(1.5, s * 0.05);
          const l = half * (0.4 + 0.6 * easeOut(k * 1.5));
          ctx.beginPath();
          if (vert) { ctx.moveTo(f.x, f.y - l); ctx.lineTo(f.x, f.y + l); } else { ctx.moveTo(f.x - l, f.y); ctx.lineTo(f.x + l, f.y); }
          ctx.stroke();
          if (this.sparkle) { const ss = s * 0.5 * a; ctx.drawImage(this.sparkle, f.x - ss / 2, f.y - ss / 2, ss, ss); }
          ctx.globalAlpha = 1;
          break;
        }
        case FX_REJECT: {
          const shake = rm ? 0 : Math.sin(k * Math.PI * 7) * (1 - k) * s * 0.07;
          const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          const x = f.x + shake, y = f.y;
          const col = this.paper.dark ? 'rgba(245,238,225,' : 'rgba(60,45,35,';
          if (f.v === 1) {
            // Keep-clean cell: flash its border.
            ctx.strokeStyle = col + (0.7 * a) + ')';
            ctx.lineWidth = Math.max(2, s * 0.05);
            const r = this.cellRect(f.idx), ins = s * 0.12;
            ctx.beginPath(); rrect(ctx, r.x + ins + shake, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.14); ctx.stroke();
          }
          ctx.fillStyle = this.paper.dark ? 'rgba(0,0,0,' + 0.45 * a + ')' : 'rgba(255,255,255,' + 0.75 * a + ')';
          ctx.beginPath(); ctx.arc(x, y, s * 0.24, 0, TAU); ctx.fill();
          ctx.strokeStyle = col + (0.85 * a) + ')';
          ctx.lineWidth = Math.max(2, s * 0.055);
          ctx.lineCap = 'round';
          const rr = s * 0.2;
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - rr * 0.68, y + rr * 0.68); ctx.lineTo(x + rr * 0.68, y - rr * 0.68); ctx.stroke();
          break;
        }
        case FX_POP: {
          const e = easeOut(k);
          ctx.globalAlpha = 0.8 * (1 - k);
          const gs = s * (0.7 + 0.9 * e);
          ctx.drawImage(P.glow, f.x - gs / 2, f.y - gs / 2, gs, gs);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,255,255,' + 0.95 * (1 - k) + ')';
          ctx.lineWidth = Math.max(1, s * 0.07 * (1 - e));
          ctx.beginPath(); ctx.arc(f.x, f.y, s * (0.3 + 0.35 * e), 0, TAU); ctx.stroke();
          break;
        }
        case FX_WRONG: {
          const e = easeOut(k);
          ctx.strokeStyle = 'rgba(217,58,43,' + 0.8 * (1 - k) + ')';
          ctx.lineWidth = Math.max(1, s * 0.08 * (1 - e));
          const r = this.cellRect(f.idx), g = s * 0.25 * e;
          ctx.beginPath(); rrect(ctx, r.x - g, r.y - g, s + 2 * g, s + 2 * g, s * 0.2 + g); ctx.stroke();
          break;
        }
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, now: number): void {
    for (const p of this.parts) {
      const k = (now - p.t0) / p.life;
      if (k < 0 || k > 1) continue;
      const e = easeOut(k);
      const x = p.x + p.dx * e, y = p.y + p.dy * e + p.g * k * k;
      const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (p.star && this.sparkle) {
        const ss = p.r * 4 * (0.6 + 0.4 * Math.sin(Math.PI * k));
        ctx.globalAlpha = a;
        ctx.drawImage(this.sparkle, x - ss / 2, y - ss / 2, ss, ss);
      } else {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, p.r * (1 - 0.3 * k), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawWin(ctx: CanvasRenderingContext2D, now: number, k: number): void {
    const win = this.win!;
    const sim = this.sim!, s = this.lay.cell, L = this.lay;
    if (win.done) return;
    const rm = this.opts.reducedMotion;
    // Light sweep across the board.
    if (!rm && this.boardClip) {
      const sk = clamp01((k - 0.06) / 0.62);
      if (sk > 0 && sk < 1) {
        const pos = -0.35 + 1.7 * easeInOut(sk);
        const diag = L.w + L.h;
        const bx = L.x + pos * diag - L.h, by = L.y;
        const gr = ctx.createLinearGradient(bx, by, bx + L.h * 0.6 + s * 1.5, by + L.h * 0.6);
        const a = this.paper.dark ? 0.22 : 0.42;
        gr.addColorStop(0, 'rgba(255,250,232,0)');
        gr.addColorStop(0.5, 'rgba(255,250,232,' + a + ')');
        gr.addColorStop(1, 'rgba(255,250,232,0)');
        ctx.save();
        ctx.clip(this.boardClip);
        ctx.globalCompositeOperation = this.paper.dark ? 'lighter' : 'source-over';
        ctx.fillStyle = gr;
        ctx.fillRect(L.x - s, L.y - s, L.w + 2 * s, L.h + 2 * s);
        ctx.restore();
      }
    }
    // Targets glow one after another.
    const n = win.order.length;
    for (let j = 0; j < n; j++) {
      const t = win.order[j];
      const t0 = 0.2 + (n > 1 ? (0.5 * j) / (n - 1) : 0.2);
      const lk = (k - t0) / 0.32;
      if (lk <= 0 || lk >= 1) continue;
      const cc = this.cellCenter(t);
      const P = this.pal[sim.L.goal[t]];
      const a = Math.sin(Math.PI * lk);
      ctx.globalAlpha = 0.85 * a;
      const gs = s * (0.9 + 0.8 * lk);
      ctx.drawImage(P.glow, cc.x - gs / 2, cc.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.9 * (1 - lk) + ')';
      ctx.lineWidth = Math.max(1, s * 0.06 * (1 - lk));
      ctx.beginPath(); ctx.arc(cc.x, cc.y, s * (0.25 + 0.4 * easeOut(lk)), 0, TAU); ctx.stroke();
      if (this.sparkle && !rm) {
        const ss = s * 0.6 * a;
        ctx.globalAlpha = a;
        ctx.drawImage(this.sparkle, cc.x - ss / 2, cc.y - ss / 2, ss, ss);
        ctx.globalAlpha = 1;
      }
    }
    if (win.perfect && !rm) {
      // Gold thread tracing the frame + drifting sparkles.
      const fk = clamp01((k - 0.25) / 0.6);
      if (fk > 0) {
        const p = this.pad * 0.5;
        const x = L.x - p, y = L.y - p, w = L.w + 2 * p, h = L.h + 2 * p;
        const per = 2 * (w + h);
        const fadeOut = k > 0.88 ? 1 - (k - 0.88) / 0.12 : 1;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(232,184,74,' + 0.95 * fadeOut + ')';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.setLineDash([per * easeInOut(fk), per]);
        ctx.beginPath();
        rrect(ctx, x, y, w, h, p * 1.5);
        ctx.stroke();
        ctx.restore();
      }
      const want = Math.floor(clamp01((k - 0.3) / 0.5) * 18);
      while (win.spawned < want) {
        const j = win.spawned++;
        const px = L.x + hash01(j, 3) * L.w, py = L.y + hash01(j, 5) * L.h;
        this.addParticle(px, py, 0, -s * (0.3 + 0.4 * hash01(j, 7)), s * (0.05 + 0.04 * hash01(j, 9)), '#ffe08a', now, 700, true, 0);
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private cellCenter(i: number): { x: number; y: number } {
    const r = this.cellRect(i);
    return { x: r.x + r.size / 2, y: r.y + r.size / 2 };
  }

  private addFx(kind: number, t0: number, dur: number, idx: number, c: number, b: number, x: number, y: number, v: number): void {
    this.fx.push({ kind, t0, dur, idx, c, b, x, y, v });
    if (this.fx.length > 40) this.fx.splice(0, this.fx.length - 40);
  }

  private addParticle(x: number, y: number, dx: number, dy: number, r: number, color: string, t0: number, life: number, star: boolean, g: number): void {
    if (this.parts.length >= MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES + 1);
    this.parts.push({ x, y, dx, dy, r, color, t0, life, star, g });
  }

  private finishWin(): void {
    const w = this.win;
    if (!w || w.done) return;
    w.done = true;
    if (this.winTimer) { clearTimeout(this.winTimer); this.winTimer = null; }
    this.needsDraw = true;
    const cb = w.onDone;
    w.onDone = null;
    if (cb) cb();
  }

  private cancelWin(): void {
    if (this.winTimer) { clearTimeout(this.winTimer); this.winTimer = null; }
    this.win = null;
  }
}

/**
 * Finished-board picture for results / gallery: a square `px` × `px` canvas (transparent around
 * the paper) showing the board in its finished-painting look.
 */
export function renderThumbnail(sim: Sim, px: number, opts: BoardOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const r = new BoardRenderer(canvas, { ...opts, reducedMotion: true });
  r.maxCell = 4096;
  r.setSim(sim);
  r.layout(px, px, 1);
  r.finishInstant();
  r.render(performance.now());
  r.dispose();
  canvas.style.width = '';
  canvas.style.height = '';
  return canvas;
}
