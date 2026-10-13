/*
 * Rule diagrams: tiny looping illustrations of each mechanic (≤ 300×90 px), made of rounded cells.
 * Every diagram is played through the real Sim, so what it shows is exactly what the game does.
 * The timeline is turned into CSS keyframes (generated once per rule) — no JS runs per frame.
 * With reduced motion (OS setting or the in-game switch) the diagram shows its final frame.
 */
import './rule-diagrams.css';
import { Sim, type LevelDef, type MechanicKey } from '../core/sim.ts';
import { inkSkin } from '../render/skins.ts';
import { glyphSVG } from '../render/glyphs.ts';
import { luminance } from '../render/color.ts';
import { store } from '../state/store.ts';

interface BoardSpec {
  map: string[];
  goal?: string[];
  inks: string[];
  drops: { x: number; y: number; t: number }[];
}

interface DiagramSpec {
  boards: BoardSpec[];
  /** Show the ink queue as chips on the left. */
  queue?: boolean;
  /** Show a check over clean cells once everything settled. */
  check?: boolean;
}

const SPECS: Record<MechanicKey, DiagramSpec> = {
  drop: { boards: [{ map: ['.......', '.......', '.......'], inks: ['R'], drops: [{ x: 3, y: 1, t: 0 }] }] },
  walls: { boards: [{ map: ['..#...', '..#...', '......'], inks: ['B'], drops: [{ x: 1, y: 1, t: 0 }] }] },
  order: { queue: true, boards: [{ map: ['...#...'], inks: ['R', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 1 }] }] },
  mix: { boards: [{ map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 0 }] }] },
  timing: {
    boards: [
      { map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 0 }] },
      { map: ['.......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 2 }] },
    ],
  },
  parity: {
    boards: [
      { map: ['......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 0 }] },
      { map: ['......'], inks: ['Y', 'B'], drops: [{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 1 }] },
    ],
  },
  three: { queue: true, boards: [{ map: ['.......', '   .   '], inks: ['R', 'B', 'Y'], drops: [{ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 0 }, { x: 3, y: 1, t: 2 }] }] },
  range: { boards: [{ map: ['.......'], inks: ['R2'], drops: [{ x: 3, y: 0, t: 0 }] }] },
  white: { check: true, boards: [{ map: ['.......'], goal: ['.....w.'], inks: ['B2'], drops: [{ x: 2, y: 0, t: 0 }] }] },
  seed: { boards: [{ map: ['...b...'], inks: ['R'], drops: [{ x: 0, y: 0, t: 0 }] }] },
  gate: {
    boards: [
      { map: ['...B...'], inks: ['Y'], drops: [{ x: 0, y: 0, t: 0 }] },
      { map: ['...B...'], inks: ['B'], drops: [{ x: 0, y: 0, t: 0 }] },
    ],
  },
  slow: {
    boards: [
      { map: ['.......'], inks: ['R'], drops: [{ x: 0, y: 0, t: 0 }] },
      { map: ['..~....'], inks: ['R'], drops: [{ x: 0, y: 0, t: 0 }] },
    ],
  },
};

// Timeline (ms)
const LEAD = 450;
const BEAT = 560;
const HOLD = 1500;
const FADE = 420;
const TAIL = 260;

const MAX_W = 300;
const MAX_H = 90;
const PAD = 8;
const GAP = 4;
const BOARD_GAP = 10;

interface CellInk { t: number; c: number; kind: 'drop' | 'spread' | 'mix' | 'seed'; range?: number }
interface SimResult { inks: (CellInk | null)[]; touches: { t: number; a: number; b: number }[]; drops: { t: number; idx: number; inkIndex: number }[]; maxT: number; w: number; h: number; sim: Sim }

function simulate(b: BoardSpec): SimResult {
  const w = b.map[0].length, h = b.map.length;
  const def: LevelDef = { id: 'rd', map: b.map, goal: b.goal || b.map.map((r) => '.'.repeat(r.length)), inks: b.inks, solution: [] };
  const sim = new Sim(def);
  const inks: (CellInk | null)[] = new Array(w * h).fill(null);
  const touches: SimResult['touches'] = [];
  const drops: SimResult['drops'] = [];
  const pending = b.drops.slice().sort((a, c) => a.t - c.t);
  let maxT = 0;
  for (let guard = 0; guard < 40; guard++) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      const idx = sim.idx(d.x, d.y);
      const spec = sim.nextInk();
      const inkIndex = sim.pi;
      if (sim.drop(idx)) {
        inks[idx] = { t: sim.tick, c: sim.ink[idx], kind: 'drop', range: spec && isFinite(spec.range) ? spec.range : undefined };
        drops.push({ t: sim.tick, idx, inkIndex });
        maxT = Math.max(maxT, sim.tick);
      }
    }
    if (!pending.length && sim.settled()) break;
    const ev = sim.step();
    for (const e of ev) {
      if (e.type === 'fill') inks[e.idx] = { t: sim.tick, c: e.c, kind: 'spread' };
      else if (e.type === 'mix') inks[e.idx] = { t: sim.tick, c: e.c, kind: 'mix' };
      else if (e.type === 'seed') inks[e.idx] = { t: sim.tick, c: e.c, kind: 'seed' };
      else if (e.type === 'touch') touches.push({ t: sim.tick, a: e.a, b: e.b });
      maxT = Math.max(maxT, sim.tick);
    }
  }
  return { inks, touches, drops, maxT, w, h, sim };
}

// ---------- CSS generation ----------

let styleEl: HTMLStyleElement | null = null;
const built = new Set<string>();

function addCSS(css: string): void {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'rule-diagram-keyframes';
    document.head.appendChild(styleEl);
  }
  styleEl.appendChild(document.createTextNode(css));
}

const pct = (ms: number, total: number) => Math.max(0, Math.min(100, (ms / total) * 100)).toFixed(2) + '%';

/** Keyframes: hidden until `at`, pops in, stays, fades with everything at the end of the loop. */
function bloomFrames(name: string, at: number, total: number): string {
  const out0 = total - TAIL - FADE, out1 = total - TAIL;
  return `@keyframes ${name}{0%,${pct(at, total)}{opacity:0;transform:scale(.3)}${pct(at + 170, total)}{opacity:1;transform:scale(1.1)}${pct(at + 300, total)},${pct(out0, total)}{opacity:1;transform:scale(1)}${pct(out1, total)},100%{opacity:0;transform:scale(1)}}`;
}

function ringFrames(name: string, at: number, total: number): string {
  return `@keyframes ${name}{0%,${pct(at, total)}{opacity:0;transform:scale(.5)}${pct(at + 60, total)}{opacity:.95;transform:scale(.75)}${pct(at + 620, total)},100%{opacity:0;transform:scale(1.7)}}`;
}

function usedFrames(name: string, at: number, total: number): string {
  const out0 = total - TAIL - FADE, out1 = total - TAIL;
  return `@keyframes ${name}{0%,${pct(at, total)}{opacity:1;transform:scale(1)}${pct(at + 220, total)},${pct(out0, total)}{opacity:.22;transform:scale(.78)}${pct(out1, total)},100%{opacity:1;transform:scale(1)}}`;
}

function nextFrames(name: string, from: number, to: number, total: number): string {
  // Highlight ring around the chip that drops next.
  return `@keyframes ${name}{0%,${pct(from, total)}{opacity:1}${pct(to, total)},100%{opacity:0}}`;
}

// ---------- DOM ----------

function el(cls: string, style?: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  if (style) Object.assign(e.style, style);
  return e;
}

function textColorFor(hex: string): string {
  return luminance(hex) > 0.42 ? 'rgba(43,39,51,.85)' : 'rgba(255,255,255,.95)';
}

/** Builds the looping mini illustration for a mechanic. */
export function ruleDiagram(key: MechanicKey): HTMLElement {
  const spec = SPECS[key] || SPECS.drop;
  const colors = inkSkin('ink-classic').colors;
  const symbols = !!store.data.settings.symbols;
  const results = spec.boards.map(simulate);
  const maxT = Math.max(...results.map((r) => r.maxT));
  const total = LEAD + maxT * BEAT + HOLD + FADE + TAIL;
  const at = (t: number) => LEAD + t * BEAT;

  // Size: fit every board in the box, cells up to 30 px.
  const cols = Math.max(...results.map((r) => r.w));
  const rows = results.reduce((n, r) => n + r.h, 0);
  const queueLen = spec.queue ? spec.boards[0].inks.length : 0;
  const qGapCols = queueLen ? queueLen * 0.86 + 0.5 : 0; // queue chips take ~0.86 cell each + spacing
  const sW = (MAX_W - PAD * 2 - (cols - 1) * GAP - (queueLen ? 14 + (queueLen - 1) * 4 : 0)) / (cols + qGapCols);
  const sH = (MAX_H - PAD * 2 - (rows - results.length) * GAP - (results.length - 1) * BOARD_GAP) / rows;
  const s = Math.floor(Math.min(30, sW, sH));
  const chip = Math.round(s * 0.86);
  const qW = queueLen ? queueLen * chip + (queueLen - 1) * 4 + 14 : 0;
  const boardW = cols * s + (cols - 1) * GAP;
  const W = qW + boardW + PAD * 2;
  const H = rows * s + (rows - results.length) * GAP + (results.length - 1) * BOARD_GAP + PAD * 2;

  // Laid out in px on a W×H canvas, placed in % so the diagram scales down in narrow containers.
  const root = el('rd', { width: W + 'px', aspectRatio: W + ' / ' + H });
  const place = (node: HTMLElement, x: number, y: number, w?: number, hh?: number) => {
    node.style.left = ((x / W) * 100).toFixed(3) + '%';
    node.style.top = ((y / H) * 100).toFixed(3) + '%';
    if (w !== undefined) node.style.width = ((w / W) * 100).toFixed(3) + '%';
    if (hh !== undefined) node.style.height = ((hh / H) * 100).toFixed(3) + '%';
  };
  root.setAttribute('aria-hidden', 'true');
  root.dataset.rule = key;
  const css: string[] = [];
  const first = !built.has(key);
  let n = 0;
  const anim = (node: HTMLElement, frames: (name: string) => string) => {
    const name = `rd-${key}-${n++}`;
    if (first) css.push(frames(name));
    node.style.animation = `${name} ${total}ms linear infinite`;
  };

  // Ink queue
  if (queueLen) {
    const ink = spec.boards[0].inks;
    const dropsByInk = results[0].drops;
    const qTop = PAD + (results[0].h * s + (results[0].h - 1) * GAP - chip) / 2;
    ink.forEach((spec1, i) => {
      const c = colors[{ R: 1, Y: 2, B: 4 }[spec1[0] as 'R' | 'Y' | 'B']];
      const q = el('rd-q', { background: c });
      place(q, PAD + i * (chip + 4), qTop, chip, chip);
      if (symbols) q.innerHTML = glyphSVG({ R: 1, Y: 2, B: 4 }[spec1[0] as 'R' | 'Y' | 'B'], Math.round(chip * 0.62));
      q.style.color = textColorFor(c);
      const d = dropsByInk.find((x) => x.inkIndex === i);
      if (d) {
        anim(q, (nm) => usedFrames(nm, at(d.t) + (i ? 120 : 0), total));
        const prev = i === 0 ? 0 : at(dropsByInk.find((x) => x.inkIndex === i - 1)?.t ?? 0) + 120;
        const ring = el('rd-qnext');
        anim(ring, (nm) => nextFrames(nm, prev, at(d.t) + (i ? 120 : 0), total));
        q.appendChild(ring);
      }
      root.appendChild(q);
    });
    const arrow = el('rd-qarrow');
    place(arrow, PAD + queueLen * (chip + 4) - 1, qTop + chip / 2 - 5);
    root.appendChild(arrow);
  }

  // Boards
  let y0 = PAD;
  results.forEach((r, bi) => {
    const b = spec.boards[bi];
    const L = r.sim.L;
    const x0 = PAD + qW + (boardW - (r.w * s + (r.w - 1) * GAP)) / 2;
    const pos = (i: number) => {
      const x = i % r.w, y = (i - x) / r.w;
      return { left: x0 + x * (s + GAP), top: y0 + y * (s + GAP) };
    };
    for (let i = 0; i < r.w * r.h; i++) {
      if (L.hole[i]) continue;
      const p = pos(i);
      const cell = el('rd-c');
      place(cell, p.left, p.top, s, s);
      if (L.wall[i]) cell.classList.add('wall');
      if (L.slow[i]) cell.classList.add('slow');
      if (L.goal[i] === 8) cell.classList.add('white');
      if (L.gate[i]) {
        cell.classList.add('gate');
        cell.style.setProperty('--gate', colors[L.gate[i]]);
      }
      if (L.seed[i]) {
        const dot = el('rd-seed', { background: colors[L.seed[i]] });
        cell.appendChild(dot);
      }
      const ink = r.inks[i];
      if (ink) {
        const c = colors[ink.c];
        const blob = el('rd-i' + (ink.kind === 'mix' ? ' mix' : ''), { background: c, color: textColorFor(c) });
        if (ink.kind === 'drop' && ink.range !== undefined) {
          const num = el('rd-n');
          num.textContent = String(ink.range);
          num.style.fontSize = ((s * 0.52 * 100) / W).toFixed(2) + 'cqw';
          blob.appendChild(num);
        } else if (symbols) blob.innerHTML = glyphSVG(ink.c, Math.round(s * 0.6));
        // Ink that arrives with a spread starts a moment after the beat so the motion reads as flowing.
        anim(blob, (nm) => bloomFrames(nm, at(ink.t) + (ink.kind === 'drop' ? 80 : 0), total));
        cell.appendChild(blob);
        if (ink.kind === 'drop') {
          const ring = el('rd-ring', { borderColor: c });
          anim(ring, (nm) => ringFrames(nm, at(ink.t), total));
          cell.appendChild(ring);
        }
      }
      if (spec.check && L.goal[i] === 8 && !r.sim.ink[i]) {
        const ck = el('rd-check');
        ck.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        anim(ck, (nm) => bloomFrames(nm, at(r.maxT) + 380, total));
        cell.appendChild(ck);
      }
      root.appendChild(cell);
    }
    for (const tc of r.touches) {
      const pa = pos(tc.a), pb = pos(tc.b);
      const vertical = pa.top === pb.top;
      const mark = el('rd-touch' + (vertical ? '' : ' h'));
      if (vertical) place(mark, Math.max(pa.left, pb.left) - GAP / 2 - 2, pa.top + s * 0.18, 4, s * 0.64);
      else place(mark, pa.left + s * 0.18, Math.max(pa.top, pb.top) - GAP / 2 - 2, s * 0.64, 4);
      anim(mark, (nm) => bloomFrames(nm, at(tc.t) + 200, total));
      root.appendChild(mark);
    }
    y0 += r.h * s + (r.h - 1) * GAP + BOARD_GAP;
  });

  if (first) {
    built.add(key);
    addCSS(css.join('\n'));
  }
  return root;
}
