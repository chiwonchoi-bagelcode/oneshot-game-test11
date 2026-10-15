/*
 * Core B — one-stroke painting (한붓그리기 혼색).
 *
 * Nothing spreads by itself. From each colour's drop the player drags a stroke that paints one
 * cell at a time; strokes of different colours that overlap mix. A level is a picture: every paper
 * cell has a goal colour, and the picture is done when every cell shows it. No clock, no fail.
 *
 * Input: the finger snaps to cells with a little hysteresis; fast swipes are stepped cell by cell
 * along the dominant axis. Sliding back onto the previous cell erases the last cell. Grabbing any
 * cell of a stroke continues from there (the old tail stays until the finger leaves the path).
 * Tapping a drop clears its stroke. Undo steps back one gesture.
 */
import './core-b.css';
import { Sim, SRC_SEED, SRC_SPREAD, SRC_MIX, isPrimary, type SimEvent } from '../../core/sim.ts';
import type { OverlayApi } from '../../render/board.ts';
import { inkChip } from '../../play/timing-core.ts';
import { h } from '../../ui/dom.ts';
import { icon } from '../../ui/icons.ts';
import { anyPopupOpen } from '../../ui/popup.ts';
import { registerDiagram } from '../../ui/rule-diagrams.ts';
import { store } from '../../state/store.ts';
import { audio } from '../../audio/index.ts';
import { buzz } from '../../services/feedback.ts';
import { t, onLangChange } from '../../i18n/i18n.ts';
import type { Core, CoreHost, CoreBoosters, LevelCtx } from '../../play/core.ts';
import { prepare, Board, solutionStrokes, neighbors, type BLevel, type Block } from './rules.ts';
import { DIAGRAMS } from './diagrams.ts';

for (const k of Object.keys(DIAGRAMS)) registerDiagram(k, DIAGRAMS[k]);

/** How far (in cells) the finger must go past a cell edge before the stroke follows. */
const HYST = 0.14;
/** Line offsets per colour (fraction of a cell) so overlapping strokes stay readable. */
const OFFSET: Record<number, [number, number]> = { 1: [-0.07, 0.07], 2: [0, -0.07], 4: [0.07, 0] };
const WIN_DELAY = 560;

interface Gesture {
  /** Stroke being edited (-1 until the first step decides between candidates). */
  k: number;
  cands: number[];
  /** Cursor index in stroke k (the finger's cell on the stroke). */
  p: number;
  cur: number;
  down: number;
  snap: number[][];
  moved: boolean;
  /** Source index if the gesture began on a drop (a tap there clears its stroke). */
  tapSrc: number;
  rejected: Set<number>;
}

type Phase = 'idle' | 'play' | 'won';

class StrokeCore implements Core {
  readonly boosters: CoreBoosters = { undo: 'undo', hint: true };
  private host: CoreHost;
  private ctx!: LevelCtx;
  private lv!: BLevel;
  private board!: Board;
  private sim!: Sim;
  private sol: number[][] = [];
  private phase: Phase = 'idle';
  private undoStack: number[][][] = [];
  private hintOn = false;
  private g: Gesture | null = null;
  /** Stroke indices, most recently edited last. */
  private recent: number[] = [];
  private lastSound = 0;
  private lastSay = '';
  private lastSayAt = 0;
  private told = new Set<string>();
  private doneColors = new Set<number>();
  private winTimer = 0;
  /** A step cut an old tail off (cells disappeared): resync the renderer. */
  private cutDirty = false;
  /** Stroke edited by the latest gesture (-1: none). */
  private lastEdited = -1;
  private auto: { acts: { kind: 'down' | 'move' | 'up'; idx: number }[]; at: number } | null = null;
  private trayEls = new Map<number, { el: HTMLElement; num: HTMLElement }>();

  constructor(host: CoreHost) {
    this.host = host;
    onLangChange(() => { if (this.ctx) { this.renderTray(); this.placeGuide(); } });
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.ctx = this.host.ctx();
    this.lv = prepare(this.ctx.def);
    this.sol = solutionStrokes(this.lv);
    this.hintOn = this.ctx.guided;
    this.reset();
    const coach = this.ctx.def.coach;
    if (coach) this.host.say(t(coach), 5200);
    else this.host.hush();
  }

  private reset(): void {
    clearTimeout(this.winTimer);
    this.board = new Board(this.lv);
    this.sim = new Sim(this.ctx.L);
    for (const s of this.lv.sources) {
      this.sim.ink[s.idx] = s.c;
      this.sim.src[s.idx] = SRC_SEED;
    }
    this.phase = 'idle';
    this.undoStack = [];
    this.g = null;
    this.auto = null;
    this.recent = this.lv.sources.map((_, k) => k);
    this.lastEdited = -1;
    this.told = new Set();
    this.doneColors = new Set();
    const r = this.host.renderer;
    r.setSim(this.sim);
    r.setGoalStyle([]);
    r.setGhosts(null);
    r.setOverlay((g, api) => this.drawOverlay(g, api), false);
    this.host.beat(null);
    this.renderTray();
    for (const c of this.colors()) if (this.colorDone(c)) this.doneColors.add(c);
    this.placeGuide();
    this.host.refreshBoosters();
    this.host.kick();
  }

  relayout(): void {
    if (!this.ctx) return;
    this.renderTray();
    this.placeGuide();
  }

  locked(): boolean {
    return this.phase === 'won';
  }

  pause(): void {
    if (this.g) this.finishGesture(-1);
  }

  resume(): void {
    this.host.kick();
  }

  frame(now: number): boolean {
    if (this.auto) this.stepAuto(now);
    return !!this.auto;
  }

  // ------------------------------------------------------------------ geometry

  private colors(): number[] {
    const out: number[] = [];
    for (const c of [1, 2, 4]) if (this.lv.sources.some((s) => s.c === c)) out.push(c);
    return out;
  }

  /** Finger position in cell units. */
  private gridPos(x: number, y: number): { fx: number; fy: number } {
    const r = this.host.renderer.cellRect(0);
    const s = r.size || 1;
    return { fx: (x - r.x) / s, fy: (y - r.y) / s };
  }

  private centerOf(idx: number): { x: number; y: number } {
    const r = this.host.renderer.cellRect(idx);
    return { x: r.x + r.size / 2, y: r.y + r.size / 2 };
  }

  // ------------------------------------------------------------------ input

  down(idx: number, x: number, y: number): void {
    if (this.locked() || this.g) return;
    this.auto = null;
    const pos = this.gridPos(x, y);
    const gx = Math.floor(pos.fx), gy = Math.floor(pos.fy);
    if (idx < 0 && (gx < 0 || gy < 0 || gx >= this.lv.w || gy >= this.lv.h)) return;
    if (idx < 0) idx = gy * this.lv.w + gx;
    const board = this.board;
    let cands = board.strokesAt(idx);
    if (!cands.length) {
      // Landed next to a stroke end (or a bare drop): continue from there.
      const ends = this.byRecency(board.strokes.map((_, k) => k).filter((k) => board.blockFor(k, idx) === null));
      if (!ends.length) {
        this.reject(idx, this.lv.open[idx] ? 'start' : 'wall');
        return;
      }
      const k = ends[0];
      this.begin(k, [k], board.strokes[k].length - 1, board.end(k));
      const events: SimEvent[] = [];
      this.cutDirty = false;
      this.applyStep(idx, events);
      this.flush(events, this.cutDirty);
      this.host.guide(null);
      return;
    }
    cands = this.byRecency(cands);
    // Prefer the stroke whose end is under the finger.
    const atEnd = cands.filter((k) => board.end(k) === idx);
    const order = atEnd.concat(cands.filter((k) => board.end(k) !== idx));
    const k = order.length === 1 ? order[0] : -1;
    this.begin(k, order, k >= 0 ? board.strokes[k].indexOf(idx) : -1, idx);
    this.host.guide(null);
    this.host.renderer.setOverlay((g, api) => this.drawOverlay(g, api), false);
  }

  private begin(k: number, cands: number[], p: number, idx: number): void {
    this.g = { k, cands, p, cur: k >= 0 ? this.board.strokes[k][p] : idx, down: idx, snap: this.board.snapshot(), moved: false, tapSrc: this.lv.srcAt[idx], rejected: new Set() };
  }

  move(_idx: number, x: number, y: number): void {
    const g = this.g;
    if (!g || this.locked()) return;
    const { fx, fy } = this.gridPos(x, y);
    const w = this.lv.w;
    const events: SimEvent[] = [];
    let erased = false;
    this.cutDirty = false;
    for (let guard = 0; guard < 64; guard++) {
      const cx = g.cur % w, cy = (g.cur - cx) / w;
      const dx = fx - (cx + 0.5), dy = fy - (cy + 0.5);
      const T = 0.5 + HYST;
      const ox = Math.abs(dx) > T, oy = Math.abs(dy) > T;
      if (!ox && !oy) break;
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      const dirs: number[] = [];
      const nx = cx + sx >= 0 && cx + sx < w ? g.cur + sx : -1;
      const ny = cy + sy >= 0 && cy + sy < this.lv.h ? g.cur + sy * w : -1;
      if (Math.abs(dx) >= Math.abs(dy)) { if (ox) dirs.push(nx); if (oy) dirs.push(ny); }
      else { if (oy) dirs.push(ny); if (ox) dirs.push(nx); }
      let stepped = false;
      for (const n of dirs) {
        if (n < 0) continue;
        const res = this.applyStep(n, events);
        if (res === 'erase') erased = true;
        if (res) { stepped = true; break; }
      }
      if (!stepped) break;
    }
    this.flush(events, erased || this.cutDirty);
  }

  up(_idx: number, _x: number, _y: number): void {
    if (!this.g) return;
    this.finishGesture(_idx);
  }

  private byRecency(ks: number[]): number[] {
    return ks.slice().sort((a, b) => this.recent.indexOf(b) - this.recent.indexOf(a));
  }

  /** What stepping stroke k from cursor p into n would do. */
  private actionFor(k: number, p: number, n: number): 'follow' | 'back' | 'extend' | Block {
    const path = this.board.strokes[k];
    if (p + 1 < path.length && path[p + 1] === n) return 'follow';
    if (p > 0 && path[p - 1] === n) return 'back';
    return this.board.blockFor(k, n, p + 1) || 'extend';
  }

  /**
   * One cell step of the active gesture. Returns 'paint' | 'erase' | 'follow' when the cursor
   * moved, or null when the step is blocked.
   */
  private applyStep(n: number, events: SimEvent[]): 'paint' | 'erase' | 'follow' | null {
    const g = this.g!;
    const board = this.board;
    let act: ReturnType<StrokeCore['actionFor']> = 'off';
    if (g.k < 0) {
      // Several strokes share the touched cell: the first move decides which one is meant.
      let first: Block | null = null;
      for (const k of g.cands) {
        const a = this.actionFor(k, board.strokes[k].indexOf(g.down), n);
        if (a === 'follow' || a === 'back' || a === 'extend') {
          g.k = k;
          g.p = board.strokes[k].indexOf(g.down);
          act = a;
          break;
        }
        if (!first) first = a as Block;
      }
      if (g.k < 0) {
        this.reject(n, first || 'off', g);
        return null;
      }
    } else act = this.actionFor(g.k, g.p, n);
    const k = g.k;
    const path = board.strokes[k];
    if (act === 'follow') {
      g.p++;
      g.cur = n;
      g.moved = true;
      return 'follow';
    }
    if (act === 'back') {
      board.truncate(k, g.p);
      g.p--;
      g.cur = n;
      g.moved = true;
      this.touch(k);
      return 'erase';
    }
    if (act === 'extend') {
      const cut = path.length > g.p + 1;
      if (cut) board.truncate(k, g.p + 1);
      const prev = path[g.p];
      const before = board.ink[n];
      board.extend(k, n);
      g.p++;
      g.cur = n;
      g.moved = true;
      this.touch(k);
      const c = board.ink[n];
      // A cell painted twice in one gesture (erased, then painted again) shows the latest ink.
      for (let j = events.length - 1; j >= 0; j--) if ((events[j] as { idx?: number }).idx === n) events.splice(j, 1);
      events.push(before && before !== c ? { type: 'mix', idx: n, c, parts: c } : { type: 'fill', idx: n, c, from: prev });
      if (cut) this.cutDirty = true;
      // First time a colour lands where the picture doesn't want it: say so.
      if (board.ink[n] & ~this.lv.goal[n]) this.tellOnce('extra', t('b.say.extra'));
      return 'paint';
    }
    this.reject(n, act as Block, g);
    return null;
  }

  private touch(k: number): void {
    this.lastEdited = k;
    const i = this.recent.indexOf(k);
    if (i >= 0) this.recent.splice(i, 1);
    this.recent.push(k);
  }

  private reject(n: number, why: Block | 'start', g?: Gesture): void {
    if (why === 'off' || why === 'far') return;
    if (g) {
      if (g.rejected.has(n)) return;
      g.rejected.add(n);
    }
    // Sliding off the edge of a shaped board is normal: stay quiet.
    if (n < 0 || n >= this.lv.n || this.ctx.L.hole[n]) return;
    this.host.renderer.onReject(n, 'blocked');
    audio.reject();
    buzz('light');
    const key = why === 'self' ? 'b.say.self' : why === 'same' ? 'b.say.same' : why === 'source' ? 'b.say.source' : why === 'wall' ? 'b.say.wall' : 'b.say.start';
    this.say(t(key), 2200);
    this.host.kick();
  }

  private say(text: string, ms: number): void {
    const now = performance.now();
    if (text === this.lastSay && now - this.lastSayAt < 1500) return;
    this.lastSay = text;
    this.lastSayAt = now;
    this.host.say(text, ms);
  }

  private tellOnce(key: string, text: string): void {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.say(text, 2600);
  }

  /** Push painted cells to the renderer (growth from the previous cell, mix bloom). */
  private flush(events: SimEvent[], erased: boolean): void {
    const sim = this.sim, board = this.board;
    if (erased) {
      this.syncSim();
      sim.tick++;
      this.host.renderer.invalidate();
    }
    if (events.length) {
      sim.tick++;
      for (const e of events) {
        if (e.type === 'fill') {
          sim.ink[e.idx] = e.c;
          sim.mixed[e.idx] = 0;
          sim.from[e.idx] = e.from;
          sim.src[e.idx] = SRC_SPREAD;
          sim.born[e.idx] = sim.tick;
        } else if (e.type === 'mix') {
          sim.ink[e.idx] = e.c;
          sim.mixed[e.idx] = 1;
          sim.from[e.idx] = -1;
          sim.src[e.idx] = SRC_MIX;
          sim.born[e.idx] = sim.tick;
        }
      }
      // The board is the truth: make sure nothing drifted.
      for (const e of events) if ('idx' in e && sim.ink[e.idx] !== board.ink[e.idx]) this.syncSim();
      this.host.renderer.onStep(events);
      this.sound(events);
    }
    if (events.length || erased) {
      if (this.phase === 'idle') this.phase = 'play';
      this.host.dirty();
      this.updateTray();
    }
    this.host.renderer.setOverlay((g, api) => this.drawOverlay(g, api), false);
    this.host.kick();
  }

  private syncSim(): void {
    const sim = this.sim, board = this.board;
    for (const i of this.lv.cells) {
      const c = board.ink[i];
      if (sim.ink[i] !== c) {
        sim.ink[i] = c;
        sim.mixed[i] = c && !isPrimary(c) ? 1 : 0;
        sim.src[i] = this.lv.srcAt[i] >= 0 ? SRC_SEED : c ? (sim.mixed[i] ? SRC_MIX : SRC_SPREAD) : 0;
        sim.from[i] = -1;
      }
    }
  }

  private sound(events: SimEvent[]): void {
    const now = performance.now();
    buzz('tick');
    if (now - this.lastSound < 70) return;
    this.lastSound = now;
    const fills: number[] = [], mixes: number[] = [];
    for (const e of events) {
      if (e.type === 'fill' && !fills.includes(e.c)) fills.push(e.c);
      if (e.type === 'mix' && !mixes.includes(e.c)) mixes.push(e.c);
    }
    if (mixes.length) buzz('medium');
    const total = this.lv.cells.length;
    const right = this.lv.cells.filter((i) => this.board.ink[i] === this.lv.goal[i]).length;
    audio.beat({ tick: this.sim.tick, fills: fills as any, mixes: mixes as any, seeds: [], touches: 0, progress: right / total });
  }

  private finishGesture(upIdx: number): void {
    const g = this.g!;
    this.g = null;
    const board = this.board;
    if (!g.moved && g.tapSrc >= 0 && upIdx === g.down) {
      const k = g.tapSrc;
      if (board.strokes[k].length > 1) {
        // Tap on a drop: clear its stroke.
        this.undoStack.push(g.snap);
        board.truncate(k, 1);
        this.host.voidSeal();
        this.flush([], true);
        audio.rewind();
        this.say(t('b.say.cleared'), 2600);
      } else {
        this.say(t('b.say.tapDrag'), 2600);
      }
    } else {
      const changed = g.snap.some((s, k) => s.length !== board.strokes[k].length || s.some((c, j) => board.strokes[k][j] !== c));
      if (changed) {
        // Redrawing with the finger is part of drawing (stage 3 teaches it): only undo, hint and
        // tap-to-clear cost the first-try seal.
        this.undoStack.push(g.snap);
      }
    }
    this.afterChange();
  }

  private afterChange(): void {
    const board = this.board;
    for (const c of this.colors()) {
      const done = this.colorDone(c);
      if (done && !this.doneColors.has(c)) {
        this.doneColors.add(c);
        const right = this.lv.cells.filter((i) => board.ink[i] === this.lv.goal[i]).length;
        audio.targetMet(right / this.lv.cells.length);
        const te = this.trayEls.get(c);
        if (te) { te.el.classList.remove('pop'); void te.el.offsetWidth; te.el.classList.add('pop'); }
      } else if (!done) this.doneColors.delete(c);
    }
    if (board.isWin()) {
      this.phase = 'won';
      this.host.guide(null);
      this.host.renderer.setGhosts(null);
      this.host.refreshBoosters();
      this.winTimer = window.setTimeout(() => this.host.win(), WIN_DELAY / Math.max(1, this.host.timeScale()));
      this.host.kick();
      return;
    }
    if (!board.missing().length && board.wrongCells().length) this.say(t('b.say.wrong'), 3000);
    else if (this.lastEdited >= 0 && this.deadEnd(this.lastEdited)) this.say(t('b.say.stuck'), 3200);
    this.updateTray();
    this.placeGuide();
    this.host.refreshBoosters();
    this.host.renderer.setOverlay((g, api) => this.drawOverlay(g, api), false);
    this.host.kick();
  }

  /**
   * The stroke can't go on (no free cell next to its end still wants its colour), yet its colour
   * has cells left that no other drop of that colour can reach: it has to back up.
   */
  private deadEnd(k: number): boolean {
    const board = this.board, lv = this.lv, c = lv.sources[k].c;
    if (board.strokes[k].length < 2) return false;
    const left = board.missing(c);
    if (!left.length) return false;
    const wants = (n: number) => (lv.goal[n] & c) && board.blockFor(k, n) === null && !(board.ink[n] & c);
    if (neighbors(lv, board.end(k)).some(wants)) return false;
    // Another drop of the same colour may still pick up the rest.
    return !lv.sources.some((s, m) => m !== k && s.c === c && neighbors(lv, board.end(m)).some((n) => (lv.goal[n] & c) && board.blockFor(m, n) === null));
  }

  private colorDone(c: number): boolean {
    const b = this.board;
    for (const i of this.lv.cells) {
      const goal = this.lv.goal[i] & c, has = b.ink[i] & c;
      if (goal !== has) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ undo / hint

  canUndo(): boolean {
    return this.undoStack.length > 0 && this.phase !== 'won';
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    if (this.g) this.g = null;
    this.board.restore(snap);
    this.syncSim();
    this.sim.tick++;
    this.host.renderer.invalidate();
    audio.rewind();
    this.say(t('b.say.undo'), 1600);
    this.afterChange();
  }

  hintShowing(): boolean {
    return this.hintOn;
  }

  showHint(quiet = false): void {
    this.hintOn = true;
    if (!quiet) {
      audio.hint();
      this.say(t('b.say.hint'), 3000);
    }
    this.placeGuide();
    this.host.refreshBoosters();
    this.host.renderer.setOverlay((g, api) => this.drawOverlay(g, api), false);
    this.host.kick();
  }

  // ------------------------------------------------------------------ guide (tutorial hand)

  private placeGuide(): void {
    if (!this.ctx || !this.ctx.guided || this.phase === 'won' || this.g || anyPopupOpen()) {
      this.host.guide(null);
      return;
    }
    const board = this.board;
    for (let k = 0; k < this.sol.length; k++) {
      const want = this.sol[k], have = board.strokes[k];
      let m = 0;
      while (m < want.length && m < have.length && want[m] === have[m]) m++;
      if (m === want.length && have.length === want.length) continue;
      if (have.length > m) {
        // Went off the dotted line: show the way back.
        const back = have.slice(m - 1).reverse();
        this.host.guide({ idx: back[0], text: t('b.guide.back'), hand: true, path: back });
        return;
      }
      const rest = want.slice(m - 1);
      this.host.guide({ idx: rest[0], text: t(m <= 1 ? 'b.guide.drag' : 'b.guide.keep'), hand: true, path: rest });
      return;
    }
    this.host.guide(null);
  }

  // ------------------------------------------------------------------ tray

  private renderTray(): void {
    const tray = this.host.tray;
    tray.innerHTML = '';
    tray.className = 'queue b-tray';
    this.trayEls.clear();
    for (const c of this.colors()) {
      const num = h('b.b-left');
      const el = h('div.b-chip', null, inkChip(c, Infinity), num);
      tray.appendChild(el);
      this.trayEls.set(c, { el, num });
    }
    this.updateTray();
  }

  private updateTray(): void {
    for (const [c, te] of this.trayEls) {
      const left = this.board.missing(c).length;
      const wrong = this.board.wrongCells().some((i) => this.board.ink[i] & c & ~this.lv.goal[i]);
      const done = left === 0 && !wrong;
      te.el.classList.toggle('done', done);
      te.el.classList.toggle('bad', wrong);
      if (done) te.num.innerHTML = icon('check');
      else te.num.textContent = String(left);
      te.el.setAttribute('aria-label', done ? t('b.tray.done', { color: t('color.' + c) }) : t('b.tray.left', { color: t('color.' + c), n: left }));
    }
  }

  // ------------------------------------------------------------------ overlay

  private drawOverlay(g: CanvasRenderingContext2D, api: OverlayApi): void {
    if (!this.board) return;
    const s = api.cell, lv = this.lv, board = this.board;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const pt = (i: number, c: number) => {
      const p = api.center(i), o = OFFSET[c] || [0, 0];
      return { x: p.x + o[0] * s, y: p.y + o[1] * s };
    };
    // Hint: dashed ghost strokes.
    if (this.hintOn && this.phase !== 'won') {
      g.setLineDash([s * 0.13, s * 0.11]);
      g.lineWidth = Math.max(2, s * 0.075);
      this.sol.forEach((path, k) => {
        if (path.length < 2) return;
        const c = lv.sources[k].c, col = api.color(c);
        g.strokeStyle = api.dark ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(3.5, s * 0.12);
        g.beginPath();
        path.forEach((i, j) => { const q = pt(i, c); if (j) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
        g.stroke();
        g.strokeStyle = col.deep;
        g.lineWidth = Math.max(2, s * 0.07);
        g.stroke();
        // End marker: small open ring.
        const e = pt(path[path.length - 1], c);
        g.setLineDash([]);
        g.beginPath(); g.arc(e.x, e.y, s * 0.11, 0, Math.PI * 2); g.stroke();
        g.setLineDash([s * 0.13, s * 0.11]);
      });
      g.setLineDash([]);
    }
    // Painted cells that aren't their goal colour yet: the ink hides the wash, so show the goal
    // colour as a small swatch (with its glyph when symbols are on).
    for (const i of lv.cells) {
      const k = board.ink[i], goal = lv.goal[i];
      if (!k) {
        // Unpainted: the wash alone is faint, so a dot of the goal colour makes the picture
        // readable at a glance (with symbols on, the wash already carries the glyph).
        if (api.symbols || this.phase === 'won') continue;
        const p = api.center(i), col = api.color(goal);
        g.globalAlpha = 0.85;
        g.fillStyle = col.body;
        g.beginPath(); g.arc(p.x, p.y, s * 0.12, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        continue;
      }
      if (k === goal) continue;
      const p = api.center(i), col = api.color(goal);
      const r = s * 0.2;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.arc(p.x, p.y, r + Math.max(1.5, s * 0.035), 0, Math.PI * 2); g.fill();
      g.fillStyle = col.body;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      if (api.symbols) api.glyph(g, goal, p.x, p.y, r * 1.15, 'rgba(255,255,255,0.95)');
    }
    // Strokes: a darker centre line and a bright head.
    const active = this.g && this.g.k >= 0 ? this.g.k : -1;
    board.strokes.forEach((path, k) => {
      if (path.length < 2) return;
      const c = lv.sources[k].c, col = api.color(c);
      g.globalAlpha = 0.8;
      g.strokeStyle = col.deep;
      g.lineWidth = Math.max(3, s * 0.12);
      g.beginPath();
      path.forEach((i, j) => { const q = pt(i, c); if (j) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
      g.stroke();
      g.globalAlpha = 1;
    });
    board.strokes.forEach((path, k) => {
      if (path.length < 2 && k !== active) return;
      const c = lv.sources[k].c, col = api.color(c);
      const at = k === active && this.g ? path[this.g.p] : path[path.length - 1];
      if (at === lv.sources[k].idx) return;
      const q = pt(at, c);
      const r = s * (k === active ? 0.21 : 0.16);
      if (k === active) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.arc(q.x, q.y, r * 1.6, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.96)';
      g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col.deep;
      g.lineWidth = Math.max(2, s * 0.06);
      g.stroke();
      if (api.symbols) api.glyph(g, c, q.x, q.y, r * 1.1, col.deep);
      else { g.fillStyle = col.body; g.beginPath(); g.arc(q.x, q.y, r * 0.5, 0, Math.PI * 2); g.fill(); }
    });
    // Cells holding a colour the picture doesn't want there.
    const wrong = board.wrongCells();
    if (wrong.length) {
      const red = '#d93a2b';
      for (const i of wrong) {
        const rc = api.rect(i);
        const bx = rc.x + s * 0.83, by = rc.y + s * 0.17, br = Math.max(6, s * 0.13);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
        g.strokeStyle = red;
        g.lineWidth = Math.max(1.5, br * 0.24);
        g.stroke();
        const q = br * 0.42;
        g.lineWidth = Math.max(2, br * 0.28);
        g.beginPath(); g.moveTo(bx - q, by - q); g.lineTo(bx + q, by + q); g.moveTo(bx + q, by - q); g.lineTo(bx - q, by + q); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ debug / autoplay

  autoplay(now: number): void {
    if (anyPopupOpen() || this.locked() || this.auto || this.g) return;
    const acts: { kind: 'down' | 'move' | 'up'; idx: number }[] = [];
    this.sol.forEach((path, k) => {
      if (path.length < 2) return;
      const have = this.board.strokes[k];
      if (have.length === path.length && have.every((c, j) => c === path[j])) return;
      acts.push({ kind: 'down', idx: path[0] });
      for (let j = 1; j < path.length; j++) acts.push({ kind: 'move', idx: path[j] });
      acts.push({ kind: 'up', idx: path[path.length - 1] });
    });
    if (acts.length) this.auto = { acts, at: now };
  }

  private stepAuto(now: number): void {
    const a = this.auto!;
    if (now < a.at) return;
    const act = a.acts.shift();
    if (!act) { this.auto = null; return; }
    const p = this.centerOf(act.idx);
    if (act.kind === 'down') this.down(act.idx, p.x, p.y);
    else if (act.kind === 'move') this.move(act.idx, p.x, p.y);
    else this.up(act.idx, p.x, p.y);
    a.at = now + 70 / Math.max(1, this.host.timeScale());
    this.auto = a.acts.length && this.phase !== 'won' ? a : null;
  }

  solveNow(): void {
    if (this.locked()) return;
    this.g = null;
    this.auto = null;
    this.board.restore(this.sol);
    this.syncSim();
    this.sim.tick++;
    this.host.renderer.invalidate();
    this.afterChange();
  }

  state() {
    const b = this.board;
    return {
      phase: this.phase === 'won' ? 'won' : this.g ? 'drawing' : this.phase,
      paths: b ? b.strokes.map((s) => s.slice()) : [],
      missing: b ? b.missing().length : 0,
      wrong: b ? b.wrongCells().length : 0,
      undo: this.undoStack.length,
      hint: this.hintOn,
    };
  }
}

export function createCore(host: CoreHost): Core {
  return new StrokeCore(host);
}

