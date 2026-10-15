/*
 * Core C — colouring book (그림 완성 색칠놀이).
 *
 * Pick a colour from the palette and tap a part of the picture: a drop lands where you tapped and
 * the colour floods the part cell by cell. A second colour poured into a painted part spreads a
 * mixing wave through it (red + yellow = orange …, all three = brown). Water washes a part clean.
 * No clock, no fail state: undo is free, wrong colours are washed away, and the stage is done when
 * every part matches the picture. Rules live in picture.ts (shared with the verifier).
 */
import './c.css';
import './diagrams.ts';
import { Sim, SRC_DROP, SRC_SPREAD, SRC_MIX, type SimEvent } from '../../core/sim.ts';
import { transformLevel } from '../../core/transform.ts';
import type { OverlayApi } from '../../render/board.ts';
import { glyphSVG } from '../../render/glyphs.ts';
import { inkSkin, paperSkin, inkForPaper } from '../../render/skins.ts';
import { DROP_PATH } from '../../play/timing-core.ts';
import { h, onTap } from '../../ui/dom.ts';
import { icon } from '../../ui/icons.ts';
import { anyPopupOpen } from '../../ui/popup.ts';
import { store } from '../../state/store.ts';
import { audio } from '../../audio/index.ts';
import { buzz } from '../../services/feedback.ts';
import { t, onLangChange } from '../../i18n/i18n.ts';
import type { Core, CoreHost, CoreBoosters, LevelCtx } from '../../play/core.ts';
import { LEVELS } from './levels.ts';
import { analyse, rings, limitsOf, bitsOf, popcount, Board, type CLevel, type Picture, type Deco } from './picture.ts';

/** ms between two rings of a spreading pour. */
const RING_MS = 100;
const TOOLS = [1, 2, 4, 0];

interface Wave { r: number; rings: number[][]; parent: Map<number, number>; k: number; next: number }
interface Step { idx: number; c: number }

let dropPath: Path2D | null = null;
function drop2D(): Path2D | null {
  if (!dropPath && typeof Path2D !== 'undefined') dropPath = new Path2D(DROP_PATH);
  return dropPath;
}

/** Dailies may arrive upside down (shared re-skin flips both ways): keep only a left-right mirror. */
function orient(def: CLevel): CLevel {
  if (!def.regions || !def.paint || LEVELS.includes(def)) return def;
  const h = def.map.length, w = def.map[0].length;
  const flip = (rows: string[], fx: boolean, fy: boolean) => {
    const out: string[] = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += rows[fy ? h - 1 - y : y][fx ? w - 1 - x : x];
      out.push(r);
    }
    return out.join('|');
  };
  const want = def.regions.join('|');
  for (const src of LEVELS) {
    if (src.map.length !== h || src.map[0].length !== w || src.paint !== def.paint) continue;
    for (const fx of [false, true]) for (const fy of [false, true]) {
      if (flip(src.regions!, fx, fy) !== want) continue;
      const base = fx ? (transformLevel(src, { flipX: true }) as CLevel) : src;
      const out: CLevel = { ...base, id: def.id };
      delete out.intro;
      delete out.guided;
      delete out.coach;
      if (fx && src.deco) out.deco = src.deco.map((d) => mirrorDeco(d, w));
      return out;
    }
  }
  return def;
}

function mirrorDeco(d: Deco, w: number): Deco {
  const fl = (a: number[], step: number) => a.map((v, i) => (i % step === 0 ? w - v : v));
  return { l: d.l && fl(d.l, 2), d: d.d && fl(d.d, 3), o: d.o && fl(d.o, 3) };
}

export class ColouringCore implements Core {
  readonly boosters: CoreBoosters = { undo: 'undo', hint: true };
  private host: CoreHost;
  private ctx!: LevelCtx;
  private def!: CLevel;
  private pic!: Picture;
  private board!: Board;
  private sim!: Sim;
  private tool = 1;
  private phase: 'idle' | 'play' | 'done' | 'won' = 'idle';
  private waves: Wave[] = [];
  private undoStack: Board[] = [];
  private hintOn = false;
  private met = new Uint8Array(0);
  private winAt = 0;
  private ripples: { idx: number; t0: number }[] = [];
  private chips = new Map<number, HTMLElement>();
  private trayHand: HTMLElement | null = null;
  private art: HTMLCanvasElement | null = null;
  private artKey = '';
  private lastAuto = 0;
  private guideKey = '';
  private leftoverSaid = false;
  private lastColour = 1;

  constructor(host: CoreHost) {
    this.host = host;
    onLangChange(() => { if (this.ctx) { this.renderTray(); this.updateGuide(true); } });
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.ctx = this.host.ctx();
    this.def = orient(this.ctx.def as CLevel);
    this.pic = analyse(this.def);
    this.board = new Board(this.pic, limitsOf(this.def));
    this.sim = new Sim(this.def);
    this.waves = [];
    this.undoStack = [];
    this.ripples = [];
    this.met = new Uint8Array(this.pic.regions.length);
    this.phase = 'idle';
    this.hintOn = this.ctx.guided;
    this.guideKey = '';
    this.leftoverSaid = false;
    this.artKey = '';
    this.tool = 1;
    const left = this.board.left;
    if (left && !left[1]) this.tool = left[2] ? 2 : 4;
    const r = this.host.renderer;
    r.setSim(this.sim);
    r.setGoalStyle(this.ringCells());
    r.setOverlay((g, api) => this.drawOverlay(g, api), false);
    this.host.beat(null);
    this.host.guide(null);
    this.renderTray();
    if (this.def.coach) this.host.say(t(this.def.coach), this.ctx.guided ? 3200 : 4200);
    else this.host.hush();
    this.updateGuide(true);
    this.host.refreshBoosters();
    this.host.kick();
  }

  relayout(): void {
    if (!this.ctx) return;
    this.artKey = '';
    this.renderTray();
    this.updateGuide(true);
    this.redraw();
  }

  pause(): void {}
  resume(): void { this.host.kick(); }

  locked(): boolean {
    return this.phase === 'done' || this.phase === 'won';
  }

  private ringCells(): number[] {
    const out: number[] = [];
    for (const R of this.pic.regions) if (!R.white && !R.secret) out.push(...R.labels);
    return out.sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------ tray (palette)

  private colours(): Record<number, string> {
    return inkForPaper(inkSkin(store.data.cosmetics.ink), paperSkin(store.data.cosmetics.paper));
  }

  private renderTray(): void {
    const tray = this.host.tray;
    tray.innerHTML = '';
    tray.className = 'queue cpal';
    this.chips.clear();
    const cols = this.colours();
    const symbols = !!store.data.settings.symbols;
    for (const c of TOOLS) {
      const name = t('c.tray.' + c);
      const chip = h('button.cchip' + (c ? '' : '.water'), { type: 'button', 'aria-label': name, dataset: { c: String(c) } });
      const art = c
        ? `<svg class="drop" viewBox="0 0 40 48"><path d="${DROP_PATH}" transform="translate(0 2)" fill="${cols[c]}" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/><path d="M13 27a7 7 0 0 1 4-7" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`
        : `<svg class="drop" viewBox="0 0 40 48"><path d="${DROP_PATH}" transform="translate(0 2)" fill="rgba(206,230,246,.9)" stroke="#5d8fb8" stroke-width="2"/><path d="M11 31c3-2.4 6 2.4 9 0s6 2.4 9 0" stroke="#5d8fb8" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M13 23a7 7 0 0 1 4-6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
      chip.appendChild(h('span.art', { html: art }));
      if (c && symbols) chip.appendChild(h('span.gly', { html: glyphSVG(c, 16) }));
      chip.appendChild(h('span.nm', { text: name }));
      if (c && this.board.left) chip.appendChild(h('span.cnt'));
      onTap(chip, () => this.select(c, true), { sound: false, guard: 90 });
      this.chips.set(c, chip);
      tray.appendChild(chip);
    }
    this.trayHand = h('div.cpal-hand.hidden', { html: icon('hand') });
    tray.appendChild(this.trayHand);
    this.updateTray();
  }

  private updateTray(bump = -1): void {
    const left = this.board.left;
    for (const [c, chip] of this.chips) {
      chip.classList.toggle('sel', c === this.tool);
      chip.setAttribute('aria-pressed', c === this.tool ? 'true' : 'false');
      const cnt = chip.querySelector('.cnt');
      if (cnt && left) {
        cnt.textContent = String(left[c] || 0);
        chip.classList.toggle('out', !(left[c] > 0));
      }
      if (c === bump) {
        chip.classList.remove('bump');
        void chip.offsetWidth;
        chip.classList.add('bump');
      }
    }
  }

  private select(c: number, byPlayer: boolean): void {
    if (this.tool) this.lastColour = this.tool;
    if (this.tool !== c) {
      this.tool = c;
      if (byPlayer) audio.toggle(c !== 0);
    }
    this.updateTray();
    const left = this.board.left;
    if (byPlayer && c && left && !(left[c] > 0)) this.host.say(t('c.say.empty', { color: t('color.' + c) }), 2600);
    this.updateGuide();
    this.redraw();
  }

  // ------------------------------------------------------------------ input

  down(idx: number, _x: number, _y: number, now: number): void {
    if (this.locked()) return;
    this.pourAt(idx, now);
  }

  move(): void {}
  up(): void {}

  private pourAt(idx: number, now: number): void {
    const res = this.board.check(idx, this.tool);
    const ren = this.host.renderer;
    const colour = t('color.' + this.tool);
    if (res === 'paper') {
      if (idx >= 0) ren.onReject(idx, 'paper');
      this.host.say(t('c.say.paper'));
      return;
    }
    if (res === 'white') {
      ren.onReject(idx, 'white');
      audio.reject();
      buzz('light');
      this.host.say(t('c.say.white'));
      return;
    }
    if (res === 'already') {
      ren.onReject(idx, 'inked');
      buzz('light');
      this.host.say(t('c.say.already', { color: colour }));
      return;
    }
    if (res === 'empty') {
      ren.onReject(idx, 'empty');
      audio.reject();
      buzz('light');
      this.host.say(t('c.say.empty', { color: colour }), 2600);
      this.updateTray(this.tool);
      return;
    }
    if (res === 'clean') {
      ren.onReject(idx, 'clean');
      this.host.say(t('c.say.clean'));
      return;
    }
    // A real move.
    const r = this.pic.regionOf[idx];
    const before = this.board.state[r];
    this.undoStack.push(this.board.clone());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.board.apply(idx, this.tool);
    this.host.dirty();
    this.host.hush();
    this.phase = 'play';
    if (res === 'washed') {
      // Back to the last colour, so the next tap paints instead of washing again.
      if (this.lastColour) this.tool = this.lastColour;
      this.host.voidSeal();
      audio.rewind();
      buzz('light');
      this.met[r] = 0;
      this.updateTray();
      if (this.board.left) for (const b of bitsOf(before)) this.updateTray(b);
    } else {
      store.data.stats.drops++;
      audio.drop(this.tool);
      buzz('light');
      this.updateTray(this.tool);
    }
    this.sim.tick++;
    this.sim.pi = this.board.pours;
    const events: SimEvent[] = [];
    const R = this.pic.regions[r];
    R.comps.forEach((comp, ci) => {
      const start = comp.includes(idx) ? idx : R.labels[ci];
      this.startWave(r, comp, start, now, events);
    });
    if (events.length) ren.onStep(events);
    if (res === 'washed') ren.invalidate();
    // One-cell parts have no wave to wait for.
    if (!this.waves.some((wv) => wv.r === r)) this.settleRegion(r, now);
    // Coach: what happened.
    const after = this.board.state[r];
    if (res === 'ok' && popcount(after) >= 2 && !R.secret) {
      audio.beat({ tick: this.sim.tick, fills: [], mixes: [after], seeds: [], touches: 0, progress: this.progress() });
      buzz('medium');
      const parts = bitsOf(after).map((b) => t('color.' + b)).join(' + ');
      this.host.say(parts + ' = ' + t('color.' + after), 2200);
    } else if (res === 'washed') this.host.say(t('c.say.washed'), 1500);
    if (res === 'ok' && after & ~R.goal && !R.secret) {
      const b = this.board;
      setTimeout(() => { if (this.board === b && b.state[r] === after && this.phase === 'play') { this.host.say(t('c.say.wrong'), 3000); this.nudgeWater(); } }, 700);
    }
    this.afterChange();
  }

  private nudgeWater(): void {
    const w = this.chips.get(0);
    if (!w) return;
    w.classList.remove('nudge');
    void w.offsetWidth;
    w.classList.add('nudge');
  }

  private progress(): number {
    const n = this.pic.colourRegions.length;
    return n ? this.board.doneCount() / n : 1;
  }

  // ------------------------------------------------------------------ waves

  private startWave(r: number, comp: number[], start: number, now: number, events: SimEvent[]): void {
    const { rings: rs, parent } = rings(comp, start, this.pic.w, this.pic.h);
    this.paint(start, this.board.state[r], -1, events, true, now);
    if (rs.length > 1) this.waves.push({ r, rings: rs, parent, k: 1, next: now + RING_MS * 1.4 });
  }

  /** Sets one cell to the region's current colour and queues its animation. */
  private paint(i: number, target: number, from: number, events: SimEvent[], first: boolean, now: number): boolean {
    const sim = this.sim, old = sim.ink[i];
    if (old === target) return false;
    if (!target) {
      sim.ink[i] = 0;
      sim.mixed[i] = 0;
      sim.from[i] = -1;
      sim.src[i] = 0;
      this.ripples.push({ idx: i, t0: now });
      return true;
    }
    sim.ink[i] = target;
    sim.born[i] = sim.tick;
    sim.from[i] = first ? -1 : from;
    sim.mixed[i] = 0;
    sim.src[i] = first ? SRC_DROP : SRC_SPREAD;
    if (first) {
      this.host.renderer.onDrop(i, old ? this.tool || target : target);
      if (old) {
        sim.mixed[i] = 1;
        sim.src[i] = SRC_MIX;
        events.push({ type: 'mix', idx: i, c: target, parts: target });
      }
    } else events.push({ type: 'fill', idx: i, c: target, from });
    return true;
  }

  frame(now: number): boolean {
    if (!this.sim) return false;
    if (this.waves.length) {
      const events: SimEvent[] = [];
      let erased = false;
      const finished: number[] = [];
      for (const wv of this.waves) {
        while (wv.k < wv.rings.length && now >= wv.next) {
          const target = this.board.state[wv.r];
          for (const i of wv.rings[wv.k]) {
            if (this.paint(i, target, wv.parent.get(i) ?? -1, events, false, now) && !target) erased = true;
          }
          wv.k++;
          wv.next += RING_MS;
          if (wv.k === 2 && target) audio.beat({ tick: this.sim.tick, fills: [target], mixes: [], seeds: [], touches: 0, progress: this.progress() });
        }
        if (wv.k >= wv.rings.length) finished.push(wv.r);
      }
      this.waves = this.waves.filter((wv) => wv.k < wv.rings.length);
      if (events.length) this.host.renderer.onStep(events);
      if (erased) this.host.renderer.invalidate();
      for (const r of finished) if (!this.waves.some((wv) => wv.r === r)) this.settleRegion(r, now);
    }
    if (this.ripples.length) {
      this.ripples = this.ripples.filter((p) => now - p.t0 < 520);
      this.redraw();
    }
    if (this.phase === 'done' && now >= this.winAt) {
      this.phase = 'won';
      this.host.guide(null);
      this.showTrayHand(-1);
      this.finishedLook();
      this.host.win();
    }
    return this.waves.length > 0 || this.ripples.length > 0 || this.phase === 'done';
  }

  /** A region finished animating: celebrate it, and finish the picture when everything matches. */
  private settleRegion(r: number, now: number): void {
    const R = this.pic.regions[r];
    if (this.board.regionDone(r) && !this.met[r]) {
      this.met[r] = 1;
      if (R.secret) {
        this.host.renderer.onStep(R.labels.map((idx) => ({ type: 'seed' as const, idx, c: R.goal })));
        this.host.say(t('c.say.reveal', { color: t('color.' + R.goal) }), 2600);
      } else for (const idx of R.labels) this.host.renderer.onTargetMet(idx);
      audio.targetMet(this.progress());
    }
    this.checkDone(now);
  }

  private checkDone(now: number): void {
    if (this.phase === 'done' || this.phase === 'won') return;
    if (this.board.done() && !this.waves.length) {
      this.phase = 'done';
      this.winAt = now + 650;
      this.host.guide(null);
      this.showTrayHand(-1);
      this.host.refreshBoosters();
      this.host.kick();
      return;
    }
    // Secret part left: remind where the leftover drops go.
    const sec = this.pic.colourRegions.filter((r) => this.pic.regions[r].secret);
    if (sec.length && !this.leftoverSaid && this.pic.colourRegions.every((r) => this.pic.regions[r].secret || this.board.regionDone(r)) && sec.some((r) => !this.board.regionDone(r))) {
      this.leftoverSaid = true;
      this.host.say(t('c.say.leftover'), 3200);
    }
  }

  /** Finished painting: drop the goal marks (the renderer leaves a ring on every target cell). */
  private finishedLook(): void {
    const def: CLevel = { ...this.def, goal: this.def.goal.map((row) => '.'.repeat(row.length)) };
    const s = new Sim(def);
    s.ink.set(this.sim.ink);
    s.tick = this.sim.tick;
    this.sim = s;
    this.host.renderer.setSim(s);
  }

  private afterChange(): void {
    for (const r of this.pic.colourRegions) if (!this.board.regionDone(r)) this.met[r] = 0;
    this.updateGuide();
    this.host.refreshBoosters();
    this.redraw();
    this.host.kick();
  }

  /** Ask the renderer for a frame (the overlay changed). */
  private redraw(): void {
    this.host.renderer.setOverlay((g, api) => this.drawOverlay(g, api), false);
  }

  // ------------------------------------------------------------------ undo / hint

  canUndo(): boolean {
    return this.undoStack.length > 0 && !this.locked();
  }

  undo(): void {
    const b = this.undoStack.pop();
    if (!b) {
      this.host.say(t('play.undoNone'));
      return;
    }
    this.board = b;
    this.waves = [];
    this.ripples = [];
    const sim = this.sim;
    sim.tick++;
    for (let i = 0; i < sim.ink.length; i++) {
      const r = this.pic.regionOf[i];
      const target = r >= 0 ? b.state[r] : 0;
      if (sim.ink[i] !== target) {
        sim.ink[i] = target;
        sim.mixed[i] = 0;
        sim.born[i] = sim.tick;
        sim.from[i] = -1;
        sim.src[i] = target ? SRC_SPREAD : 0;
      }
    }
    sim.pi = b.pours;
    for (const r of this.pic.colourRegions) this.met[r] = b.regionDone(r) ? 1 : 0;
    this.phase = this.undoStack.length ? 'play' : 'idle';
    this.host.renderer.invalidate();
    audio.rewind();
    this.host.say(t('c.say.undone'), 1400);
    this.updateTray();
    this.afterChange();
  }

  hintShowing(): boolean {
    return this.hintOn && !this.locked();
  }

  showHint(quiet = false): void {
    this.hintOn = true;
    if (!quiet) {
      audio.hint();
      this.host.say(t('c.say.hint'), 2800);
    }
    this.host.refreshBoosters();
    this.redraw();
    this.host.kick();
  }

  // ------------------------------------------------------------------ guided steps

  /** Next move toward the picture: wash a wrong part first, else the next missing colour. */
  private nextStep(): Step | null {
    const pic = this.pic, b = this.board;
    for (const r of pic.colourRegions) {
      const R = pic.regions[r];
      if (b.state[r] & ~R.goal) return { idx: R.labels[0], c: 0 };
    }
    for (const d of this.def.solution) {
      const idx = d.y * pic.w + d.x;
      const r = pic.regionOf[idx];
      if (r >= 0 && d.c && !(b.state[r] & d.c)) return { idx, c: d.c };
    }
    return null;
  }

  private updateGuide(force = false): void {
    if (!this.ctx) return;
    if (!this.ctx.guided || this.locked()) {
      this.host.guide(null);
      this.showTrayHand(-1);
      return;
    }
    const s = this.nextStep();
    if (!s) {
      this.host.guide(null);
      this.showTrayHand(-1);
      return;
    }
    const key = s.idx + ':' + s.c + ':' + this.tool;
    if (key === this.guideKey && !force) return;
    this.guideKey = key;
    if (this.tool !== s.c) {
      this.host.guide(null);
      this.showTrayHand(s.c);
      this.host.say(t('c.guide.pick', { color: s.c ? t('color.' + s.c) : t('c.tray.water') }), 0);
    } else {
      this.showTrayHand(-1);
      this.host.guide({ idx: s.idx, text: t('play.tapHere'), hand: true });
    }
  }

  private showTrayHand(c: number): void {
    for (const [k, chip] of this.chips) chip.classList.toggle('guide', k === c);
    const hand = this.trayHand;
    if (!hand) return;
    const chip = this.chips.get(c);
    if (!chip) { hand.classList.add('hidden'); return; }
    hand.classList.remove('hidden');
    hand.style.left = chip.offsetLeft + chip.offsetWidth / 2 - 14 + 'px';
    hand.style.top = chip.offsetTop + chip.offsetHeight * 0.45 + 'px';
  }

  // ------------------------------------------------------------------ overlay

  private drawOverlay(g: CanvasRenderingContext2D, api: OverlayApi): void {
    const pic = this.pic;
    if (!pic) return;
    const s = api.cell;
    const o = api.rect(0);
    const ink = api.dark ? 'rgba(240,232,220,0.78)' : 'rgba(52,44,58,0.8)';
    this.syncArt(o.x, o.y, s, api.dark);
    // Colour-by-wash: a clearer tint on parts still waiting for their colour.
    for (const r of pic.colourRegions) {
      const R = pic.regions[r];
      if (R.secret || this.board.state[r] === R.goal) continue;
      g.fillStyle = api.color(R.goal).body;
      g.globalAlpha = api.dark ? 0.24 : 0.22;
      for (const i of R.cells) {
        if (this.sim.ink[i]) continue;
        const q = api.rect(i);
        g.fillRect(q.x + 0.5, q.y + 0.5, s - 1, s - 1);
      }
    }
    g.globalAlpha = 1;
    // Water ripples.
    if (this.ripples.length && !api.reducedMotion) {
      for (const p of this.ripples) {
        const k = Math.min(1, (api.now - p.t0) / 520);
        const c = api.center(p.idx);
        g.strokeStyle = 'rgba(120,170,215,' + (0.7 * (1 - k)).toFixed(3) + ')';
        g.lineWidth = Math.max(1.5, s * 0.05 * (1 - k));
        g.beginPath(); g.arc(c.x, c.y, s * (0.12 + 0.36 * k), 0, Math.PI * 2); g.stroke();
      }
    }
    const done = this.locked();
    for (let r = 0; r < pic.regions.length; r++) {
      const R = pic.regions[r];
      if (R.white) continue;
      const st = this.board.state[r];
      const ok = st === R.goal;
      // Secret parts: a "?" until revealed.
      if (R.secret && !ok) for (const idx of R.labels) this.drawSecret(g, api, idx);
      // Linked parts: a small link mark on each part.
      if (R.comps.length > 1 && !ok && !done) for (const idx of R.labels) this.drawLink(g, api, idx, ink);
      // Painted but not finished: the ink hides the faint target, so show it as a small badge.
      if (!ok && !done && st && !R.secret && !this.hintOn) for (const idx of R.labels) this.drawTarget(g, api, idx, R.goal);
      // Hint: drops still needed (or water first when a wrong colour is in).
      if (!ok && !done && this.hintOn) {
        const extra = st & ~R.goal;
        const need = extra ? [0] : bitsOf(R.goal & ~st);
        this.drawNeeds(g, api, R.labels[0], need);
      }
    }
  }

  /**
   * Line art (region outlines + drawings) lives on its own canvas above the board, so it stays on
   * the finished painting too. Redrawn only when the board geometry or paper changes.
   */
  private syncArt(x0: number, y0: number, s: number, dark: boolean): void {
    const wrap = this.host.boardWrap, board = this.host.canvas;
    let cv = this.art;
    if (!cv) {
      cv = this.art = h('canvas.c-art') as HTMLCanvasElement;
      wrap.insertBefore(cv, board.nextSibling);
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = board.clientWidth, H = board.clientHeight;
    const key = [this.def.id, x0, y0, s, W, H, dpr, dark ? 1 : 0].join(',');
    if (key === this.artKey) return;
    this.artKey = key;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const ink = dark ? 'rgba(240,232,220,0.8)' : 'rgba(52,44,58,0.82)';
    const X = (x: number) => x0 + x * s, Y = (y: number) => y0 + y * s;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = Math.max(2, s * 0.058);
    g.stroke(this.outlinePath(x0, y0, s));
    g.lineWidth = Math.max(1.6, s * 0.045);
    for (const d of this.def.deco || []) {
      if (d.l) {
        const p = d.l;
        g.beginPath();
        g.moveTo(X(p[0]), Y(p[1]));
        if (p.length === 4) g.lineTo(X(p[2]), Y(p[3]));
        else {
          for (let k = 2; k < p.length - 2; k += 2) {
            const mx = (p[k] + p[k + 2]) / 2, my = (p[k + 1] + p[k + 3]) / 2;
            g.quadraticCurveTo(X(p[k]), Y(p[k + 1]), X(mx), Y(my));
          }
          g.lineTo(X(p[p.length - 2]), Y(p[p.length - 1]));
        }
        g.stroke();
      }
      if (d.d) { g.beginPath(); g.arc(X(d.d[0]), Y(d.d[1]), d.d[2] * s, 0, Math.PI * 2); g.fill(); }
      if (d.o) { g.beginPath(); g.arc(X(d.o[0]), Y(d.o[1]), d.o[2] * s, 0, Math.PI * 2); g.stroke(); }
    }
  }

  /** Region contours with softly rounded corners (each loop traced with the region on its right). */
  private outlinePath(x0: number, y0: number, s: number): Path2D {
    const pic = this.pic, w = pic.w, hh = pic.h;
    const p = new Path2D();
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= hh ? -1 : pic.regionOf[y * w + x]);
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const rad = s * 0.24;
    for (let r = 0; r < pic.regions.length; r++) {
      // Directed boundary edges keyed by start point.
      const edges = new Map<string, number[]>();
      const add = (x: number, y: number, d: number) => {
        const k = x + ',' + y;
        const l = edges.get(k);
        if (l) l.push(d); else edges.set(k, [d]);
      };
      for (const i of pic.regions[r].cells) {
        const x = i % w, y = (i - x) / w;
        if (at(x, y - 1) !== r) add(x, y, 0);
        if (at(x + 1, y) !== r) add(x + 1, y, 1);
        if (at(x, y + 1) !== r) add(x + 1, y + 1, 2);
        if (at(x - 1, y) !== r) add(x, y + 1, 3);
      }
      const take = (x: number, y: number, prefer: number[]): number => {
        const l = edges.get(x + ',' + y);
        if (!l) return -1;
        for (const d of prefer) {
          const k = l.indexOf(d);
          if (k >= 0) { l.splice(k, 1); if (!l.length) edges.delete(x + ',' + y); return d; }
        }
        return -1;
      };
      while (edges.size) {
        const [k0, l0] = edges.entries().next().value as [string, number[]];
        const [sx, sy] = k0.split(',').map(Number);
        let d = take(sx, sy, [l0[0]]);
        let x = sx, y = sy;
        const pts: number[][] = [];
        let prev = -1;
        for (let guard = 0; guard < 4 * w * hh + 8 && d >= 0; guard++) {
          if (d !== prev) pts.push([x, y]);
          prev = d;
          x += DX[d]; y += DY[d];
          d = take(x, y, [(d + 1) % 4, d, (d + 3) % 4]);
        }
        const n = pts.length;
        if (n < 3) continue;
        const P = pts.map(([px, py]) => [x0 + px * s, y0 + py * s]);
        const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const m0 = mid(P[n - 1], P[0]);
        p.moveTo(m0[0], m0[1]);
        for (let i = 0; i < n; i++) {
          const a = P[i], b = P[(i + 1) % n];
          p.arcTo(a[0], a[1], b[0], b[1], rad);
        }
        p.closePath();
      }
    }
    return p;
  }

  private drawSecret(g: CanvasRenderingContext2D, api: OverlayApi, idx: number): void {
    const c = api.center(idx), s = api.cell;
    g.fillStyle = api.dark ? 'rgba(30,30,40,0.75)' : 'rgba(255,255,255,0.88)';
    g.strokeStyle = api.dark ? 'rgba(240,232,220,0.8)' : 'rgba(52,44,58,0.75)';
    g.lineWidth = Math.max(1.5, s * 0.04);
    g.setLineDash([s * 0.07, s * 0.06]);
    g.beginPath(); g.arc(c.x, c.y, s * 0.32, 0, Math.PI * 2); g.fill(); g.stroke();
    g.setLineDash([]);
    g.fillStyle = api.dark ? '#f4efe4' : '#3a3240';
    g.font = '900 ' + Math.round(s * 0.42) + 'px Pretendard, system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', c.x, c.y + s * 0.02);
  }

  private drawTarget(g: CanvasRenderingContext2D, api: OverlayApi, idx: number, goal: number): void {
    const c = api.center(idx), s = api.cell, col = api.color(goal);
    g.fillStyle = api.dark ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.92)';
    g.beginPath(); g.arc(c.x, c.y, s * 0.27, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col.ring;
    g.lineWidth = Math.max(2, s * 0.06);
    g.beginPath(); g.arc(c.x, c.y, s * 0.22, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col.body;
    g.beginPath(); g.arc(c.x, c.y, s * 0.13, 0, Math.PI * 2); g.fill();
    if (api.symbols) api.glyph(g, goal, c.x, c.y, s * 0.18, 'rgba(255,255,255,0.95)');
  }

  private drawLink(g: CanvasRenderingContext2D, api: OverlayApi, idx: number, ink: string): void {
    const r = api.rect(idx), s = api.cell;
    const cx = r.x + s * 0.8, cy = r.y + s * 0.2, rr = s * 0.085;
    g.fillStyle = api.dark ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.92)';
    g.beginPath(); g.arc(cx, cy, s * 0.16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.4, s * 0.035);
    g.beginPath(); g.arc(cx - rr * 0.6, cy + rr * 0.35, rr, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx + rr * 0.6, cy - rr * 0.35, rr, 0, Math.PI * 2); g.stroke();
  }

  /** Ghost drops (needed colours) or a water drop, centred on the label cell. */
  private drawNeeds(g: CanvasRenderingContext2D, api: OverlayApi, idx: number, need: number[]): void {
    const path = drop2D();
    if (!path || !need.length) return;
    const c = api.center(idx), s = api.cell;
    const n = need.length;
    const size = s * (n === 1 ? 0.44 : n === 2 ? 0.36 : 0.3);
    const gap = size * 0.78;
    const x0 = c.x - ((n - 1) * gap) / 2;
    need.forEach((b, k) => {
      const cx = x0 + k * gap, cy = c.y;
      const sc = size / 46;
      g.save();
      g.translate(cx - 20 * sc, cy - 26 * sc);
      g.scale(sc, sc);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 7;
      g.stroke(path);
      g.globalAlpha = 0.95;
      g.fillStyle = b ? api.color(b).body : 'rgba(206,230,246,1)';
      g.fill(path);
      g.lineWidth = 2.4;
      g.strokeStyle = b ? api.color(b).deep : '#5d8fb8';
      g.stroke(path);
      g.restore();
      if (b && api.symbols) api.glyph(g, b, cx, cy + size * 0.08, size * 0.42, 'rgba(255,255,255,0.95)');
    });
  }

  // ------------------------------------------------------------------ debug

  autoplay(now: number): void {
    // Keep frames coming while the debug autoplay is on (this core has no clock of its own).
    if (this.phase !== 'won') this.host.kick();
    if (anyPopupOpen() || this.locked() || this.waves.length || now - this.lastAuto < 320) return;
    const s = this.nextStep();
    if (!s) return;
    this.lastAuto = now;
    if (this.tool !== s.c) this.select(s.c, false);
    else this.pourAt(s.idx, now);
    this.host.kick();
  }

  solveNow(): void {
    const b = new Board(this.pic, limitsOf(this.def));
    for (const d of this.def.solution) b.apply(d.y * this.pic.w + d.x, d.c ?? 1);
    this.undoStack.push(this.board.clone());
    this.board = b;
    this.waves = [];
    const sim = this.sim;
    sim.tick++;
    for (let i = 0; i < sim.ink.length; i++) {
      const r = this.pic.regionOf[i];
      sim.ink[i] = r >= 0 ? b.state[r] : 0;
      sim.mixed[i] = 0;
      sim.born[i] = sim.tick;
      sim.from[i] = -1;
    }
    this.met.fill(1);
    this.host.renderer.invalidate();
    this.updateTray();
    this.checkDone(performance.now());
    this.host.kick();
  }

  state() {
    const b = this.board;
    return {
      phase: this.phase as string,
      tool: this.tool,
      left: b ? (b.left ? { ...b.left } : null) : null,
      pours: b ? b.pours : 0,
      done: b ? b.doneCount() : 0,
      total: this.pic ? this.pic.colourRegions.length : 0,
      waves: this.waves.length,
      hint: this.hintOn,
      regions: this.pic ? this.pic.regions.map((R, r) => ({ key: R.key, goal: R.goal, state: b.state[r], white: R.white, secret: R.secret, labels: R.labels })) : [],
    };
  }
}

export function createCore(host: CoreHost): Core {
  return new ColouringCore(host);
}

