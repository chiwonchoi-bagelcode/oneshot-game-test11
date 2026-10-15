/*
 * Core A — "where, not when": timeless spread and overlap mixing.
 *
 * The board is a pure function of where the drops are (see rules.ts). There is no clock: the
 * player picks an ink from the tray and taps a cell; press-and-hold shows the ink's reach first.
 * Placed drops can be lifted (tap) or dragged to another cell at any time, for free (it only
 * voids the seal). The spread is animated ring by ring as a visual reward, but the result never
 * depends on speed or waiting. The level is won as soon as the picture is right.
 *
 * Rendering: a Sim is kept only as the renderer's state holder (ink/mixed/born/from/src/tick);
 * the core writes it ring by ring and feeds renderer.onDrop/onStep for the growth and mix blooms.
 */
import './a.css';
import { Sim, WHITE, isPrimary, type SimEvent, type ParsedLevel } from '../../core/sim.ts';
import type { GhostMark, OverlayApi } from '../../render/board.ts';
import { inkChip, DROP_PATH } from '../../play/timing-core.ts';
import { h, onTap } from '../../ui/dom.ts';
import { anyPopupOpen } from '../../ui/popup.ts';
import { store } from '../../state/store.ts';
import { audio } from '../../audio/index.ts';
import { buzz } from '../../services/feedback.ts';
import { t, onLangChange } from '../../i18n/i18n.ts';
import type { Core, CoreHost, CoreBoosters, LevelCtx } from '../../play/core.ts';
import { reach, paint, placeable, solved, wrongCells, wrongKind, doomedCells, type Placed } from './rules.ts';
import './diagrams.ts';

/** ms per ring of the spread animation. */
const RING_MS = 95;
/** Press longer than this shows the reach preview. */
const HOLD_MS = 170;
/** Fade of ink that disappears when a drop is lifted. */
const FADE_MS = 340;
const SETTLE_MS = 380;

type Phase = 'idle' | 'play' | 'check' | 'won';

interface Pending { at: number; from: number }
interface Fade { idx: number; c: number; t0: number }
interface Hold {
  kind: 'place' | 'drag';
  k: number;
  origin: number;
  cur: number;
  t0: number;
  moved: boolean;
  preview: boolean;
}

export function createCore(host: CoreHost): Core {
  return new SpreadCore(host);
}

class SpreadCore implements Core {
  readonly boosters: CoreBoosters = { undo: 'undo', hint: true };
  private host: CoreHost;
  private ctx!: LevelCtx;
  private L!: ParsedLevel;
  private sim!: Sim;
  private phase: Phase = 'idle';
  /** Cell of each ink (-1 = still in the tray). */
  private pos: number[] = [];
  /** Inks in the order they were placed (undo lifts the last). */
  private order: number[] = [];
  private sel = 0;
  /** Board the drops make (the display catches up ring by ring). */
  private target: Uint8Array = new Uint8Array(0);
  private pending = new Map<number, Pending>();
  private fades: Fade[] = [];
  private hold: Hold | null = null;
  private hintOn = false;
  private met = new Set<number>();
  private doomed: number[] = [];
  private wrongShown = false;
  private winAt = 0;
  private told = new Set<string>();
  private lastAuto = 0;
  private chips: HTMLElement[] = [];
  /** Coach line of the stage, said once the intro cards are closed. */
  private pendingCoach = '';
  /** The drops changed: judge the picture once the display has caught up. */
  private needJudge = false;
  private coachFor = '';
  /** Target cells drawn as a plain colour wash (no ring): the overlay adds a small colour dot. */
  private washGoals: number[] = [];

  constructor(host: CoreHost) {
    this.host = host;
    onLangChange(() => {
      if (this.ctx) this.renderTray();
    });
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.ctx = this.host.ctx();
    this.L = this.ctx.L;
    this.hintOn = this.ctx.guided;
    this.reset();
    // The stage's coach line once per visit (not again on every restart).
    if (this.coachFor !== this.ctx.def.id) this.pendingCoach = this.ctx.def.coach || '';
    this.coachFor = this.ctx.def.id;
  }

  private reset(): void {
    const L = this.L;
    this.sim = new Sim(L);
    this.phase = 'idle';
    this.pos = L.inks.map(() => -1);
    this.order = [];
    this.sel = 0;
    this.target = new Uint8Array(L.w * L.h);
    this.pending.clear();
    this.fades = [];
    this.hold = null;
    this.met = new Set();
    this.doomed = [];
    this.wrongShown = false;
    this.winAt = 0;
    this.needJudge = false;
    this.told = new Set();
    this.host.beat(null);
    this.host.renderer.setSim(this.sim);
    // Big pictures: rings (and checks) only where colours must mix; the rest is a colour wash.
    const mixedGoals = L.targets.filter((i) => !isPrimary(L.goal[i]));
    this.washGoals = L.targets.length > 14 && mixedGoals.length ? L.targets.filter((i) => isPrimary(L.goal[i])) : [];
    this.host.renderer.setGoalStyle(this.washGoals.length ? mixedGoals : null);
    this.redraw();
    this.renderTray();
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  relayout(): void {
    if (!this.ctx) return;
    this.renderTray();
    this.placeGuide();
  }

  pause(): void {
    this.cancelHold();
  }

  resume(): void {
    this.host.kick();
  }

  locked(): boolean {
    return this.phase === 'won';
  }

  // ------------------------------------------------------------------ tray

  private renderTray(): void {
    const tray = this.host.tray;
    tray.innerHTML = '';
    tray.className = 'queue a-tray';
    this.chips = this.L.inks.map((ink, k) => {
      const b = h('button.a-chip', { type: 'button' }, inkChip(ink.c, ink.range));
      onTap(b, () => this.tapChip(k), { guard: 120 });
      tray.appendChild(b);
      return b;
    });
    this.updateTray();
  }

  private updateTray(pop = -1): void {
    this.chips.forEach((b, k) => {
      const used = this.pos[k] >= 0;
      b.classList.toggle('used', used);
      b.classList.toggle('sel', !used && k === this.sel);
      const ink = this.L.inks[k];
      b.setAttribute('aria-label', t('color.' + ink.c) + ' ' + ink.range + (used ? ' ' + t('a.tray.placed') : ''));
      b.setAttribute('aria-pressed', String(!used && k === this.sel));
      if (k === pop) {
        b.classList.remove('pop');
        void b.offsetWidth;
        b.classList.add('pop');
      }
    });
  }

  private tapChip(k: number): void {
    if (this.locked() || anyPopupOpen()) return;
    if (this.pos[k] >= 0) {
      // A placed ink: take it back into the hand.
      this.lift(k, performance.now());
      this.host.say(t('a.say.liftedChip'), 2200);
      return;
    }
    if (this.ctx.guided && this.hintOn) {
      const g = this.nextGhost();
      if (g && g.k !== k && !this.sameInk(g.k, k)) {
        this.host.say(t('a.say.guideChip'), 2200);
        return;
      }
    }
    this.sel = k;
    this.updateTray();
    this.updateGhosts();
    this.host.kick();
  }

  private firstFree(): number {
    for (let k = 0; k < this.pos.length; k++) if (this.pos[k] < 0) return k;
    return -1;
  }

  private sameInk(a: number, b: number): boolean {
    const A = this.L.inks[a], B = this.L.inks[b];
    return A.c === B.c && A.range === B.range;
  }

  // ------------------------------------------------------------------ input

  private sourceAt(idx: number): number {
    for (let k = 0; k < this.pos.length; k++) if (this.pos[k] === idx) return k;
    return -1;
  }

  down(idx: number, _x: number, _y: number, now: number): void {
    if (this.locked() || idx < 0) return;
    const k = this.sourceAt(idx);
    if (k >= 0) {
      this.hold = { kind: 'drag', k, origin: idx, cur: idx, t0: now, moved: false, preview: false };
      this.host.kick();
      return;
    }
    if (this.sel < 0 || this.pos[this.sel] >= 0) this.sel = this.firstFree();
    if (this.sel < 0) {
      this.reject(idx, t('a.say.noInk'));
      return;
    }
    if (!placeable(this.L, idx)) {
      this.reject(idx, this.L.goal[idx] === WHITE ? t('play.reject.white') : t('play.reject.blocked'));
      return;
    }
    this.hold = { kind: 'place', k: this.sel, origin: idx, cur: idx, t0: now, moved: false, preview: false };
    this.host.kick();
  }

  move(idx: number, _x: number, _y: number, now: number): void {
    const hd = this.hold;
    if (!hd || this.locked()) return;
    if (idx !== hd.cur) {
      hd.cur = idx;
      hd.moved = true;
      hd.preview = true;
      this.host.guide(null);
      this.redraw();
      this.host.kick();
    }
    void now;
  }

  up(idx: number, _x: number, _y: number, now: number): void {
    const hd = this.hold;
    this.hold = null;
    if (!hd || this.locked()) {
      this.host.kick();
      return;
    }
    const cell = hd.moved ? idx : hd.origin;
    if (hd.kind === 'drag') {
      if (!hd.moved || cell === hd.origin) {
        if (!hd.preview) {
          this.lift(hd.k, now);
          this.tell('lift', t('a.say.lifted'), 2400);
        }
      } else if (cell >= 0 && placeable(this.L, cell) && this.sourceAt(cell) < 0 && this.guidedOk(hd.k, cell, true)) {
        this.lift(hd.k, now, true);
        this.place(hd.k, cell, now);
      } else {
        this.host.say(t('a.say.cancel'), 1800);
      }
      this.afterInput();
      return;
    }
    if (cell < 0 || !placeable(this.L, cell) || this.sourceAt(cell) >= 0) {
      if (hd.preview) this.host.say(t('a.say.cancel'), 1800);
      else if (cell >= 0) this.reject(cell, t('play.reject.blocked'));
      this.afterInput();
      return;
    }
    if (!this.guidedOk(hd.k, cell, false)) {
      this.afterInput();
      return;
    }
    this.place(hd.k, cell, now);
    this.afterInput();
  }

  private afterInput(): void {
    this.placeGuide();
    this.redraw();
    this.host.kick();
  }

  private cancelHold(): void {
    if (this.hold) {
      this.hold = null;
      this.redraw();
      this.placeGuide();
      this.host.kick();
    }
  }

  /** Guided stages: only the cell the hand shows. */
  private guidedOk(k: number, cell: number, quiet: boolean): boolean {
    if (!this.ctx.guided || !this.hintOn) return true;
    const sol = this.ctx.def.solution;
    const ok = sol.some((d) => d.y * this.L.w + d.x === cell && this.sameInk(d.k ?? 0, k));
    if (!ok) {
      this.host.renderer.onReject(cell, 'blocked');
      audio.reject();
      if (!quiet) buzz('light');
      this.host.say(t('a.say.guideCell'), 2200);
    }
    return ok;
  }

  private reject(idx: number, text: string): void {
    this.host.renderer.onReject(idx, 'blocked');
    audio.reject();
    buzz('light');
    this.host.say(text, 2000);
    this.host.kick();
  }

  /** Coach line shown once per attempt. */
  private tell(key: string, text: string, ms: number): void {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.host.say(text, ms);
  }

  // ------------------------------------------------------------------ board changes

  private placedList(): Placed[] {
    const out: Placed[] = [];
    for (const k of this.order) out.push({ idx: this.pos[k], k });
    return out;
  }

  private clearWrong(): void {
    if (!this.wrongShown) return;
    this.wrongShown = false;
    this.host.hush();
    // setSim keeps the static layers for the same level; it only drops the wrong marks and effects.
    this.host.renderer.setSim(this.sim);
    this.met = new Set(this.L.targets.filter((i) => this.sim.ink[i] === this.L.goal[i]));
  }

  private place(k: number, idx: number, now: number): void {
    const L = this.L, sim = this.sim, spec = L.inks[k];
    this.clearWrong();
    this.host.hush();
    this.host.dirty();
    store.data.stats.drops++;
    this.pos[k] = idx;
    this.order.push(k);
    this.needJudge = true;
    this.phase = 'play';
    this.winAt = 0;
    this.target = paint(L, this.placedList());
    sim.tick++;
    sim.pi = this.order.length;
    sim.drops = this.order.map((kk) => ({ x: this.pos[kk] % L.w, y: Math.floor(this.pos[kk] / L.w), t: 0, k: kk }));
    // Source cell now, then ring by ring.
    const r = reach(L, idx, spec.range);
    for (let q = 0; q < r.cells.length; q++) {
      const i = r.cells[q];
      if (q === 0) continue;
      const at = now + r.dist[q] * RING_MS;
      const p = this.pending.get(i);
      if (!p || p.at > at) this.pending.set(i, { at, from: r.parent[q] });
    }
    const c0 = this.target[idx];
    sim.ink[idx] = c0;
    sim.mixed[idx] = isPrimary(c0) ? 0 : 1;
    sim.born[idx] = sim.tick;
    sim.from[idx] = -1;
    sim.src[idx] = 1;
    this.pending.delete(idx);
    this.host.renderer.onDrop(idx, spec.c);
    audio.drop(spec.c);
    buzz('light');
    this.checkMet();
    // Next ink in hand.
    this.sel = this.firstFree();
    if (this.ctx.guided && this.hintOn) {
      const g = this.nextGhost();
      if (g) this.sel = g.k;
    }
    this.updateTray(k);
    this.updateGhosts();
    this.host.refreshBoosters();
  }

  /** Takes ink k back into the tray. silent = part of a move (no sound, keeps the hand). */
  private lift(k: number, now: number, silent = false): void {
    const idx = this.pos[k];
    if (idx < 0) return;
    const L = this.L, sim = this.sim;
    this.clearWrong();
    this.host.voidSeal();
    this.pos[k] = -1;
    this.order = this.order.filter((x) => x !== k);
    this.needJudge = true;
    this.doomed = [];
    this.phase = this.order.length ? 'play' : 'idle';
    this.winAt = 0;
    this.target = paint(L, this.placedList());
    sim.tick++;
    sim.pi = this.order.length;
    sim.drops = this.order.map((kk) => ({ x: this.pos[kk] % L.w, y: Math.floor(this.pos[kk] / L.w), t: 0, k: kk }));
    // Ink that goes away fades out at once; ink that stays keeps animating.
    let changed = false;
    for (let i = 0; i < sim.ink.length; i++) {
      const want = this.target[i], had = sim.ink[i];
      const keep = had & want;
      if (keep !== had) {
        this.fades.push({ idx: i, c: had, t0: now });
        sim.ink[i] = keep;
        sim.mixed[i] = keep && !isPrimary(keep) ? 1 : 0;
        sim.src[i] = keep ? 2 : 0;
        sim.from[i] = -1;
        changed = true;
      }
      if (this.pending.has(i) && want === keep) this.pending.delete(i);
    }
    for (const i of this.met) if (sim.ink[i] !== L.goal[i]) this.met.delete(i);
    if (changed) this.host.renderer.invalidate();
    if (!silent) {
      audio.rewind();
      buzz('light');
      this.sel = k;
    }
    this.redraw();
    this.updateTray();
    this.updateGhosts();
    this.host.refreshBoosters();
  }

  canUndo(): boolean {
    return this.order.length > 0 && this.phase !== 'won';
  }

  undo(): void {
    const k = this.order[this.order.length - 1];
    if (k === undefined) return;
    this.lift(k, performance.now());
    this.host.say(t('a.say.undo'), 1800);
    this.placeGuide();
    this.host.kick();
  }

  // ------------------------------------------------------------------ frame

  frame(now: number): boolean {
    if (!this.sim) return false;
    if (this.pendingCoach && !anyPopupOpen()) {
      this.host.say(t(this.pendingCoach), 4500);
      this.pendingCoach = '';
    }
    const sim = this.sim, L = this.L;
    if (this.pending.size) {
      const ev: SimEvent[] = [];
      const fills: number[] = [], mixes: number[] = [];
      for (const [i, p] of this.pending) {
        if (p.at > now) continue;
        this.pending.delete(i);
        const want = this.target[i], had = sim.ink[i];
        if (want === had || !want) continue;
        sim.ink[i] = want;
        sim.born[i] = sim.tick;
        if (isPrimary(want)) {
          sim.mixed[i] = 0;
          sim.from[i] = p.from;
          sim.src[i] = 2;
          ev.push({ type: 'fill', idx: i, c: want, from: p.from });
          if (!fills.includes(want)) fills.push(want);
        } else {
          sim.mixed[i] = 1;
          sim.from[i] = -1;
          sim.src[i] = 4;
          ev.push({ type: 'mix', idx: i, c: want, parts: want });
          if (!mixes.includes(want)) mixes.push(want);
        }
      }
      if (ev.length) {
        this.host.renderer.onStep(ev);
        if (mixes.length) buzz('medium');
        const prog = L.targets.length ? this.metCount() / L.targets.length : 1;
        audio.beat({ tick: sim.tick, fills, mixes, seeds: [], touches: 0, progress: prog });
        this.checkMet();
      }
    }
    if (this.needJudge && !this.pending.size) {
      this.needJudge = false;
      this.settled(now);
    }
    if (this.hold && !this.hold.preview && now - this.hold.t0 >= HOLD_MS) {
      this.hold.preview = true;
      this.host.guide(null);
      this.redraw();
    }
    if (this.fades.length) this.fades = this.fades.filter((f) => now - f.t0 < FADE_MS);
    if (this.winAt && now >= this.winAt && this.phase !== 'won') {
      this.phase = 'won';
      this.host.guide(null);
      this.redraw();
      this.host.win();
    }
    if (this.isLive() !== this.overlayLive) this.redraw();
    return this.pending.size > 0 || this.needJudge || this.fades.length > 0 || !!this.hold || (this.winAt > 0 && this.phase !== 'won');
  }

  private metCount(): number {
    let n = 0;
    for (const i of this.L.targets) if (this.sim.ink[i] === this.L.goal[i]) n++;
    return n;
  }

  private checkMet(): void {
    const L = this.L, sim = this.sim;
    for (const i of L.targets) {
      if (sim.ink[i] === L.goal[i]) {
        if (!this.met.has(i)) {
          this.met.add(i);
          this.host.renderer.onTargetMet(i);
          audio.targetMet(this.met.size / L.targets.length);
        }
      } else this.met.delete(i);
    }
  }

  /** The display caught up with the drops: judge the picture. */
  private settled(now: number): void {
    const L = this.L;
    if (this.phase === 'won') return;
    if (solved(L, this.target)) {
      this.winAt = now + SETTLE_MS;
      this.doomed = [];
      this.host.guide(null);
      return;
    }
    this.doomed = doomedCells(L, this.target);
    if (this.firstFree() < 0) {
      // Every ink is down and the picture isn't right: show where and how to fix it.
      const wrong = wrongCells(L, this.target);
      this.phase = 'check';
      this.wrongShown = true;
      this.host.renderer.showWrong(wrong);
      audio.wrong();
      buzz('error');
      this.host.say(this.fixText(wrong), 0);
      return;
    }
    if (this.doomed.length) this.tell('doomed', this.fixText(this.doomed, true), 3600);
    this.redraw();
  }

  private fixText(cells: number[], early = false): string {
    const L = this.L, ink = this.target;
    const kinds = cells.map((i) => ({ i, k: wrongKind(L, ink, i) }));
    const pick = kinds.find((x) => x.k === 'clean') || kinds.find((x) => x.k === 'mud') || kinds.find((x) => x.k === 'tooMuch')
      || kinds.find((x) => x.k === 'otherColor') || kinds.find((x) => x.k === 'needMix') || kinds[0];
    if (!pick) return t('a.fix.missing');
    const g = L.goal[pick.i], c = ink[pick.i];
    let main: string;
    if (pick.k === 'clean') main = t('a.fix.clean');
    else if (pick.k === 'mud') main = t('a.fix.mud');
    else if (pick.k === 'tooMuch') main = t('a.fix.tooMuch', { goal: t('color.' + g), extra: t('color.' + (c & ~g)) });
    else if (pick.k === 'otherColor') main = t('a.fix.other', { goal: t('color.' + g) });
    else if (pick.k === 'needMix') main = t('a.fix.needMix', { goal: t('color.' + g), part: t('color.' + (g & ~c)) });
    else main = t('a.fix.missing');
    return main + ' ' + (early ? t('a.fix.tapDrop') : t('a.fix.move'));
  }

  // ------------------------------------------------------------------ overlay

  private overlayLive = false;
  private overlayFn = (g: CanvasRenderingContext2D, api: OverlayApi) => this.drawOverlay(g, api);

  private isLive(): boolean {
    return this.phase !== 'won' && (this.fades.length > 0 || (!!this.hold && this.hold.preview));
  }

  /** Ask the renderer for a frame (the overlay changed). */
  private redraw(): void {
    this.overlayLive = this.isLive();
    this.host.renderer.setOverlay(this.phase === 'won' ? null : this.overlayFn, this.overlayLive);
  }

  private drawOverlay(g: CanvasRenderingContext2D, api: OverlayApi): void {
    const s = api.cell, now = api.now;
    // Colour dots on blank wash targets (a pale blue wash alone reads as grey).
    if (!api.symbols) {
      for (const i of this.washGoals) {
        if (this.sim.ink[i]) continue;
        const cc = api.center(i), col = api.color(this.L.goal[i]);
        g.fillStyle = col.ring;
        g.globalAlpha = 0.8;
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.085, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    // Targets under ink that isn't their colour yet: show the colour they still need.
    if (!this.wrongShown) {
      for (const i of this.L.targets) {
        const c = this.sim.ink[i], goal = this.L.goal[i];
        if (!c || c === goal || this.pending.has(i)) continue;
        const cc = api.center(i), col = api.color(goal);
        g.lineWidth = Math.max(3, s * 0.085);
        g.strokeStyle = api.dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.85)';
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.24, 0, Math.PI * 2); g.stroke();
        g.lineWidth = Math.max(2, s * 0.05);
        g.strokeStyle = col.ring;
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.24, 0, Math.PI * 2); g.stroke();
        if (api.symbols) api.glyph(g, goal, cc.x, cc.y, s * 0.22, col.ring);
        else {
          g.fillStyle = col.ring;
          g.beginPath(); g.arc(cc.x, cc.y, s * 0.07, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // Lifted ink fading away.
    for (const f of this.fades) {
      const p = Math.min(1, (now - f.t0) / FADE_MS);
      const r = api.rect(f.idx);
      const col = api.color(f.c);
      g.globalAlpha = 0.85 * (1 - p) * (1 - p);
      g.fillStyle = col.body;
      const ins = s * (0.06 + 0.12 * p);
      roundRect(g, r.x + ins, r.y + ins, s - 2 * ins, s - 2 * ins, s * 0.22);
      g.fill();
    }
    g.globalAlpha = 1;
    // Reach preview while holding.
    const hd = this.hold;
    if (hd && hd.preview && hd.cur >= 0 && placeable(this.L, hd.cur) && (this.sourceAt(hd.cur) < 0 || hd.cur === hd.origin)) {
      const spec = this.L.inks[hd.k];
      const cells = reach(this.L, hd.cur, spec.range).cells;
      const col = api.color(spec.c);
      const inSet = new Set(cells);
      g.fillStyle = col.wash;
      g.globalAlpha = 0.55;
      for (const i of cells) {
        const r = api.rect(i);
        g.fillRect(r.x + 1, r.y + 1, s - 2, s - 2);
      }
      g.globalAlpha = 1;
      // Dotted outline around the covered area.
      g.save();
      g.strokeStyle = api.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)';
      g.lineWidth = Math.max(4, s * 0.1);
      g.lineCap = 'round';
      this.outline(g, api, cells, inSet);
      g.stroke();
      g.strokeStyle = col.deep;
      g.lineWidth = Math.max(2.2, s * 0.055);
      g.setLineDash([s * 0.12, s * 0.1]);
      g.lineDashOffset = api.reducedMotion ? 0 : -now / 40;
      this.outline(g, api, cells, inSet);
      g.stroke();
      g.restore();
      this.drawMarker(g, api, hd.cur, spec.c, spec.range, 0.92, true);
    }
    // Placed drops: a badge with the amount (tap to lift).
    for (let k = 0; k < this.pos.length; k++) {
      const i = this.pos[k];
      if (i < 0) continue;
      const spec = this.L.inks[k];
      const dragging = !!hd && hd.kind === 'drag' && hd.k === k && hd.preview && hd.cur !== hd.origin;
      this.drawMarker(g, api, i, spec.c, spec.range, dragging ? 0.35 : 1, false);
    }
    // Cells that can't end right any more (while inks remain).
    if (!this.wrongShown && !this.pending.size) {
      for (const i of this.doomed) {
        const r = api.rect(i);
        const bx = r.x + s * 0.82, by = r.y + s * 0.18, br = Math.max(6, s * 0.12);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#d93a2b';
        g.lineWidth = Math.max(1.5, br * 0.25);
        g.stroke();
        const q = br * 0.42;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(bx - q, by - q); g.lineTo(bx + q, by + q); g.moveTo(bx + q, by - q); g.lineTo(bx - q, by + q); g.stroke();
      }
    }
  }

  private outline(g: CanvasRenderingContext2D, api: OverlayApi, cells: number[], set: Set<number>): void {
    const w = this.L.w, s = api.cell;
    g.beginPath();
    for (const i of cells) {
      const x = i % w, r = api.rect(i);
      const top = i >= w ? set.has(i - w) : false;
      const bot = set.has(i + w) && i + w < w * this.L.h;
      const left = x > 0 && set.has(i - 1);
      const right = x < w - 1 && set.has(i + 1);
      const m = 2;
      if (!top) { g.moveTo(r.x + m, r.y + m); g.lineTo(r.x + s - m, r.y + m); }
      if (!bot) { g.moveTo(r.x + m, r.y + s - m); g.lineTo(r.x + s - m, r.y + s - m); }
      if (!left) { g.moveTo(r.x + m, r.y + m); g.lineTo(r.x + m, r.y + s - m); }
      if (!right) { g.moveTo(r.x + s - m, r.y + m); g.lineTo(r.x + s - m, r.y + s - m); }
    }
  }

  /** A placed drop: a small ink drop with its amount in the cell's top-left corner (clear of the goal check). */
  private drawMarker(g: CanvasRenderingContext2D, api: OverlayApi, idx: number, c: number, range: number, alpha: number, ghost: boolean): void {
    const s = api.cell, r = api.rect(idx), col = api.color(c);
    const k = (s * 0.5) / 42;
    const ox = r.x + s * 0.21 - 20 * k, oy = r.y + s * 0.29 - 28.5 * k;
    g.globalAlpha = alpha;
    g.save();
    g.translate(ox, oy);
    g.scale(k, k);
    g.lineJoin = 'round';
    g.strokeStyle = api.dark ? 'rgba(20,16,24,0.9)' : 'rgba(255,255,255,0.97)';
    g.lineWidth = Math.max(3, s * 0.07) / k;
    g.stroke(dropPath());
    g.fillStyle = col.body;
    g.fill(dropPath());
    g.strokeStyle = col.deep;
    g.lineWidth = Math.max(1.4, s * 0.025) / k;
    if (ghost) g.setLineDash([5, 4]);
    g.stroke(dropPath());
    g.restore();
    const cx = r.x + s * 0.21, cy = r.y + s * 0.3;
    g.font = '900 ' + Math.round(s * 0.24) + 'px Pretendard, system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, s * 0.05);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(String(range), cx, cy + s * 0.01);
    g.fillStyle = '#ffffff';
    g.fillText(String(range), cx, cy + s * 0.01);
    if (api.symbols) {
      const gx = r.x + s * 0.39, gy = r.y + s * 0.44, gr = s * 0.1;
      g.fillStyle = api.dark ? 'rgba(30,26,34,0.95)' : 'rgba(255,255,255,0.95)';
      g.beginPath(); g.arc(gx, gy, gr, 0, Math.PI * 2); g.fill();
      api.glyph(g, c, gx, gy, gr * 1.3, col.deep);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ hints / guide

  hintShowing(): boolean {
    return this.hintOn;
  }

  showHint(quiet = false): void {
    this.hintOn = true;
    if (!quiet) {
      audio.hint();
      this.host.say(t('a.say.hint'), 2600);
    }
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  /** Solution drops not yet matched by a placed drop of the same ink. */
  private openGhosts(): { idx: number; k: number }[] {
    const sol = this.ctx.def.solution;
    const w = this.L.w;
    const taken = new Set<number>();
    const out: { idx: number; k: number }[] = [];
    sol.forEach((d, n) => {
      const idx = d.y * w + d.x, k = d.k ?? n;
      const pk = this.sourceAt(idx);
      if (pk >= 0 && this.sameInk(pk, k) && !taken.has(pk)) { taken.add(pk); return; }
      out.push({ idx, k });
    });
    return out;
  }

  private nextGhost(): { idx: number; k: number } | null {
    if (!this.hintOn) return null;
    const open = this.openGhosts();
    if (!open.length) return null;
    return open.find((g) => this.sel >= 0 && this.sameInk(g.k, this.sel)) || open[0];
  }

  private updateGhosts(): void {
    if (!this.hintOn || this.phase === 'won') {
      this.host.renderer.setGhosts(null);
      this.placeGuide();
      return;
    }
    const open = this.openGhosts();
    const next = this.nextGhost();
    const marks: GhostMark[] = [];
    const w = this.L.w;
    this.ctx.def.solution.forEach((d, n) => {
      const idx = d.y * w + d.x, k = d.k ?? n;
      const isOpen = open.some((o) => o.idx === idx);
      const spec = this.L.inks[k];
      marks.push({ idx, color: spec.c, beat: 0, order: spec.range, state: !isOpen ? 'done' : next && next.idx === idx ? 'now' : 'upcoming' });
    });
    this.host.renderer.setGhosts(marks);
    this.placeGuide();
  }

  private placeGuide(): void {
    if (!this.ctx || !this.ctx.guided || !this.hintOn || this.phase === 'won' || anyPopupOpen() || (this.hold && this.hold.preview)) {
      this.host.guide(null);
      return;
    }
    const g = this.nextGhost();
    if (!g) {
      this.host.guide(null);
      return;
    }
    // Guided: the ghost's ink must be in hand first.
    if (this.sel !== g.k && !(this.sel >= 0 && this.sameInk(this.sel, g.k))) this.sel = g.k;
    this.updateTray();
    this.host.guide({ idx: g.idx, text: t('play.tapHere'), hand: true });
  }

  // ------------------------------------------------------------------ debug

  autoplay(now: number): void {
    if (anyPopupOpen() || this.locked() || this.hold) return;
    if (now - this.lastAuto < 260 / Math.max(1, this.host.timeScale())) return;
    this.lastAuto = now;
    const sol = this.ctx.def.solution, w = this.L.w;
    // Lift any drop that isn't part of the answer.
    const want = new Map<number, number>();
    sol.forEach((d, n) => want.set(d.y * w + d.x, d.k ?? n));
    for (let k = 0; k < this.pos.length; k++) {
      const i = this.pos[k];
      if (i >= 0 && !(want.has(i) && this.sameInk(want.get(i)!, k))) {
        this.down(i, 0, 0, now);
        this.up(i, 0, 0, now + 1);
        return;
      }
    }
    for (const g of this.openGhostsAll()) {
      let k = g.k;
      if (this.pos[k] >= 0) k = this.pos.findIndex((p, kk) => p < 0 && this.sameInk(kk, g.k));
      if (k < 0) continue;
      this.sel = k;
      this.down(g.idx, 0, 0, now);
      this.up(g.idx, 0, 0, now + 1);
      return;
    }
  }

  private openGhostsAll(): { idx: number; k: number }[] {
    const h0 = this.hintOn;
    this.hintOn = true;
    const o = this.openGhosts();
    this.hintOn = h0;
    return o;
  }

  solveNow(): void {
    const L = this.L, sim = this.sim, w = L.w;
    this.pending.clear();
    this.pos = L.inks.map(() => -1);
    this.order = [];
    this.ctx.def.solution.forEach((d, n) => {
      const k = d.k ?? n;
      this.pos[k] = d.y * w + d.x;
      this.order.push(k);
    });
    this.target = paint(L, this.placedList());
    sim.tick++;
    for (let i = 0; i < sim.ink.length; i++) {
      sim.ink[i] = this.target[i];
      sim.mixed[i] = sim.ink[i] && !isPrimary(sim.ink[i]) ? 1 : 0;
      sim.born[i] = sim.tick;
    }
    this.host.renderer.setSim(sim);
    this.updateTray();
    this.settled(performance.now());
    this.host.kick();
  }

  state() {
    const droppable: number[] = [];
    if (this.L) for (let i = 0; i < this.L.w * this.L.h; i++) if (placeable(this.L, i) && this.sourceAt(i) < 0) droppable.push(i);
    return {
      phase: this.phase as string,
      placed: this.order.length,
      inkCount: this.L ? this.L.inks.length : 0,
      sel: this.sel,
      pos: this.pos.slice(),
      animating: this.pending.size > 0,
      hint: this.hintOn,
      doomed: this.doomed.length,
      droppable,
    };
  }
}

let DROP_CACHE: Path2D | null = null;
function dropPath(): Path2D {
  return DROP_CACHE || (DROP_CACHE = new Path2D(DROP_PATH));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
  const rr = Math.min(r, w / 2, hh / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + hh, rr);
  g.arcTo(x + w, y + hh, x, y + hh, rr);
  g.arcTo(x, y + hh, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

