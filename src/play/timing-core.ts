/*
 * Timing core — the original Inkbloom rules (beat clock, same-beat mixing), extracted from the
 * play screen. Cores D (marked wells) and E (first drop shown) subclass it and override the
 * protected hooks instead of copying the clock.
 *
 * Timing model (keeps failures about judgement, not reflexes):
 *  - The clock doesn't run until the first drop. Drops made in quick succession before the first
 *    beat all count as beat 0 (each drop restarts the count-in).
 *  - A tap up to graceMs after a beat still counts for the previous beat (touch latency).
 *  - A cell that breaks the goal is shown immediately (with the exact reason), and Retry is one tap.
 */
import { Sim, isPrimary, WHITE, type SimEvent, type InkSpec, type DropBlock, type Drop } from '../core/sim.ts';
import type { GhostMark } from '../render/board.ts';
import { glyphSVG } from '../render/glyphs.ts';
import { inkSkin, paperSkin, inkForPaper } from '../render/skins.ts';
import { h, button } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { anyPopupOpen } from '../ui/popup.ts';
import { store } from '../state/store.ts';
import { TEMPO } from '../config/balance.ts';
import { audio } from '../audio/index.ts';
import { buzz } from '../services/feedback.ts';
import { t, onLangChange } from '../i18n/i18n.ts';
import type { Core, CoreHost, CoreBoosters, LevelCtx } from './core.ts';

export type TimingPhase = 'idle' | 'prestart' | 'running' | 'frozen' | 'rewound' | 'paused' | 'won' | 'lost';
type FailKind = 'needMix' | 'noMix' | 'otherFirst' | 'otherMix' | 'white' | 'mud' | 'unreached';

export const DROP_PATH = 'M20 2C20 2 5 18.5 5 28.5a15 15 0 0 0 30 0C35 18.5 20 2 20 2z';

/** Ink chip (drop shape) used by trays. */
export function inkChip(c: number, range: number): HTMLElement {
  const cols = inkForPaper(inkSkin(store.data.cosmetics.ink), paperSkin(store.data.cosmetics.paper));
  const hasR = range !== Infinity;
  const chip = h('div.ink-chip' + (hasR ? '.has-rng' : ''), {
    html: `<svg class="dropshape" viewBox="0 0 40 46"><path d="${DROP_PATH}" transform="translate(0 2)" fill="${cols[c]}" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/><path d="M13 27a7 7 0 0 1 4-7" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  });
  if (store.data.settings.symbols) chip.appendChild(h('div.gly', { html: glyphSVG(c, 18) }));
  if (hasR) chip.appendChild(h('div.rng', { text: String(range) }));
  chip.setAttribute('aria-label', t('color.' + c) + (hasR ? ' ' + range : ''));
  return chip;
}

export class TimingCore implements Core {
  readonly boosters: CoreBoosters = { undo: 'rewind', hint: true };
  protected host: CoreHost;
  protected ctx!: LevelCtx;
  protected sim!: Sim;
  protected phase: TimingPhase = 'idle';
  protected pausedFrom: TimingPhase = 'idle';
  protected beatMs = TEMPO.beatMs;
  protected nextBeatAt = 0;
  protected lastStepAt = -1e9;
  protected preStep: Sim | null = null;
  protected lastEvents: SimEvent[] = [];
  protected rewindStack: Sim[] = [];
  protected hintOn = false;
  protected hintBroken = false;
  protected decided: 'win' | null = null;
  protected fastForward = false;
  protected pendingFail: { at: number; cells: number[] } | null = null;
  protected met = new Set<number>();
  protected resumeBar: HTMLElement;
  protected resumeText: HTMLElement;

  constructor(host: CoreHost) {
    this.host = host;
    this.resumeText = h('div.grow', { text: t('play.resumeTap') });
    this.resumeBar = h('div.resume-bar', null, this.resumeText, button(t('play.resume'), () => this.resumeFromRewind(), { variant: 'jade', size: 'sm', icon: icon('play') }));
    host.screen.appendChild(this.resumeBar);
    onLangChange(() => {
      this.resumeText.textContent = t('play.resumeTap');
      if (this.ctx) this.renderTray();
    });
    store.on('settings', () => {
      if (this.ctx) this.beatMs = this.computeBeatMs();
    });
  }

  // ------------------------------------------------------------------ hooks for subclasses

  /** Base beat length for this level (before the relaxed-tempo setting). */
  protected baseBeatMs(): number {
    const c = this.ctx;
    return c.def.tempo ?? (c.mode === 'campaign' && c.chapter === 0 && c.number <= 20 ? TEMPO.tutorialBeatMs : TEMPO.beatMs);
  }

  /** Why a drop at idx is refused (null = allowed). Subclasses add their own rules. */
  protected blockAt(idx: number): DropBlock | string {
    return this.sim.dropBlock(idx);
  }

  /** Ink released at idx (undefined = the next ink in the queue). */
  protected inkAt(_idx: number): { spec: InkSpec; k: number } | undefined {
    return undefined;
  }

  /** Coach text for a refused tap. */
  protected rejectText(block: string): string {
    if (block === 'white') return t('play.reject.white');
    if (block === 'inked') return t('play.reject.inked');
    if (block === 'noink') return t('play.reject.noink');
    return t('play.reject.blocked');
  }

  /** Ink colour of solution move i (hint marks). */
  protected solutionColor(i: number): number {
    const d = this.ctx.def.solution[i];
    if (d && d.k !== undefined) {
      const w = this.ctx.def.wells?.[d.k];
      if (w) return ({ R: 1, Y: 2, B: 4 } as Record<string, number>)[w.ink[0]] || 1;
    }
    return this.ctx.L.inks[i]?.c || 1;
  }

  /** Called after every drop and beat (subclass overlays, aids). */
  protected changed(): void {}

  /** Board was (re)built for a new attempt. */
  protected attemptStarted(): void {}

  // ------------------------------------------------------------------ tray

  protected renderTray(): void {
    const tray = this.host.tray;
    tray.innerHTML = '';
    tray.className = 'queue';
    this.ctx.L.inks.forEach((ink) => tray.appendChild(inkChip(ink.c, ink.range)));
    this.updateTray();
  }

  protected updateTray(popIndex = -1): void {
    const chips = this.host.tray.children;
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i] as HTMLElement;
      c.classList.toggle('used', i < this.sim.pi);
      c.classList.toggle('next', i === this.sim.pi);
      if (i === popIndex) {
        c.classList.remove('pop');
        void c.offsetWidth;
        c.classList.add('pop');
      }
    }
  }

  // ------------------------------------------------------------------ Core API

  start(): void {
    this.ctx = this.host.ctx();
    this.beatMs = this.computeBeatMs();
    this.hintOn = this.ctx.guided;
    this.reset();
  }

  protected computeBeatMs(): number {
    return Math.round((this.baseBeatMs() * (store.data.settings.relaxed ? TEMPO.relaxedMul : 1)) / this.host.timeScale());
  }

  protected reset(): void {
    audio.beatStop();
    this.sim = new Sim(this.ctx.L);
    this.phase = 'idle';
    this.preStep = null;
    this.lastEvents = [];
    this.rewindStack = [];
    this.hintBroken = false;
    this.decided = null;
    this.fastForward = false;
    this.pendingFail = null;
    this.met = new Set();
    this.host.renderer.setSim(this.sim);
    this.resumeBar.classList.remove('open');
    this.renderTray();
    this.updateBeat(0, false);
    this.attemptStarted();
    this.changed();
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  relayout(): void {
    if (!this.ctx) return;
    this.renderTray();
    this.placeGuide();
  }

  locked(): boolean {
    return this.phase === 'won' || this.phase === 'lost' || this.phase === 'paused' || !!this.decided;
  }

  down(idx: number, _x: number, _y: number, now: number): void {
    if (this.locked() || idx < 0) return;
    this.tryDrop(idx, now);
  }

  move(): void {}
  up(): void {}

  canUndo(): boolean {
    return this.rewindStack.length > 0 && this.phase !== 'won';
  }

  undo(): void {
    if (!this.rewindStack.length) {
      this.host.say(t('play.rewindNone'));
      return;
    }
    const snap = this.rewindStack.pop()!;
    this.sim = snap;
    this.preStep = null;
    this.lastEvents = [];
    this.pendingFail = null;
    this.decided = null;
    this.fastForward = false;
    this.met = new Set(this.ctx.L.targets.filter((i) => this.sim.ink[i] === this.ctx.L.goal[i]));
    this.host.renderer.setSim(this.sim);
    audio.beatStop();
    audio.rewind();
    this.phase = this.sim.drops.length === 0 ? 'idle' : 'rewound';
    if (this.phase === 'rewound') this.resumeBar.classList.add('open');
    this.host.say(t('play.rewindDone'), 2200);
    if (this.hintOn) this.hintBroken = !this.solutionMatchesSoFar();
    this.updateTray();
    this.updateBeat(0, false);
    this.changed();
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  hintShowing(): boolean {
    return this.hintOn && !this.hintBroken;
  }

  showHint(quiet = false): void {
    this.hintOn = true;
    if (!quiet) audio.hint();
    // Follow the hint from a clean board unless the player is already on the solution path.
    if (this.phase === 'lost' || this.phase === 'won' || !this.solutionMatchesSoFar() || this.hintBroken) {
      this.reset();
      if (!quiet) this.host.say(t('play.hintRestart'), 2200);
    } else if (!quiet) this.host.say(t('play.hintShown'), 2200);
    this.hintBroken = false;
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  pause(): void {
    if (this.phase === 'running' || this.phase === 'prestart' || this.phase === 'frozen') {
      this.pausedFrom = this.phase;
      this.phase = 'paused';
      audio.beatStop();
    }
  }

  resume(now: number): void {
    if (this.phase !== 'paused') return;
    this.phase = this.pausedFrom;
    if (this.phase === 'running' || this.phase === 'prestart') {
      this.nextBeatAt = now + this.beatMs;
      audio.beatStart(this.beatMs, this.nextBeatAt);
    }
    this.host.kick();
  }

  state() {
    const droppable: number[] = [];
    if (this.sim) for (let i = 0; i < this.sim.ink.length; i++) if (!this.blockAt(i)) droppable.push(i);
    return { phase: this.phase as string, tick: this.sim?.tick ?? 0, drops: this.sim?.drops.length ?? 0, droppable };
  }

  // ------------------------------------------------------------------ clock

  frame(now: number): boolean {
    const sim = this.sim;
    if (!sim) return false;
    const interval = this.fastForward ? this.beatMs / TEMPO.fastForwardMul : this.beatMs;
    if (this.phase === 'prestart') {
      const g = this.ctx.guided ? this.nextGhost() : null;
      if (g && g.t === 0) this.nextBeatAt = now + this.beatMs; // guided: wait for every beat-0 drop
      else if (now >= this.nextBeatAt) {
        this.phase = 'running';
        this.doStep(now);
        this.nextBeatAt = now + interval;
      }
    } else if (this.phase === 'running') {
      if (now >= this.nextBeatAt) {
        this.doStep(now);
        this.nextBeatAt = Math.max(this.nextBeatAt + interval, now + interval * 0.5);
      }
    }
    if (this.pendingFail && now >= this.pendingFail.at) {
      const cells = this.pendingFail.cells;
      this.pendingFail = null;
      this.fail(cells);
    }
    const running = this.phase === 'running' || this.phase === 'prestart';
    const frac = running ? 1 - (this.nextBeatAt - now) / interval : 0;
    this.host.renderer.setBeat(Math.max(0, Math.min(1, frac)), this.phase === 'running');
    this.updateBeat(frac, running);
    return running || !!this.pendingFail;
  }

  protected updateBeat(frac: number, running: boolean): void {
    this.host.beat({ tick: this.sim.tick, frac: Math.max(0, Math.min(1, frac)), running, idle: this.phase === 'idle' });
  }

  // ------------------------------------------------------------------ input

  protected tryDrop(idx: number, now: number, noGrace = false): void {
    const sim = this.sim;
    // Grace window: a tap right after a beat counts for the previous beat.
    if (!noGrace && this.phase === 'running' && this.preStep && now - this.lastStepAt < TEMPO.graceMs && !this.fastForward && this.graceAllowed(idx)) {
      this.graceDrop(idx, now);
      return;
    }
    const block = this.blockAt(idx);
    if (block) {
      this.host.renderer.onReject(idx, block);
      audio.reject();
      buzz('light');
      this.host.say(this.rejectText(block));
      this.host.kick();
      return;
    }
    this.rewindStack.push(sim.clone());
    const ink = this.inkAt(idx);
    const c = ink ? ink.spec.c : sim.nextInk()!.c;
    const before = sim.pi;
    sim.drop(idx, ink?.spec, ink?.k);
    this.afterDrop(idx, c, before, now);
  }

  /** May the grace re-step put this drop on the previous beat? */
  protected graceAllowed(idx: number): boolean {
    if (!this.preStep) return false;
    const live = this.sim;
    this.sim = this.preStep;
    const ok = !this.blockAt(idx);
    this.sim = live;
    return ok;
  }

  protected afterDrop(idx: number, c: number, chipIndex: number, now: number): void {
    this.host.dirty();
    store.data.stats.drops++;
    this.host.renderer.onDrop(idx, c);
    audio.drop(c);
    buzz('light');
    this.updateTray(chipIndex);
    this.host.hush();
    if (this.hintOn && !this.hintBroken && !this.solutionMatchesSoFar()) {
      this.hintBroken = true;
      this.host.say(t('play.hintOff'), 2600);
    }
    if (this.phase === 'idle' || this.phase === 'prestart') {
      this.phase = 'prestart';
      this.nextBeatAt = now + this.beatMs;
      audio.beatStart(this.beatMs, this.nextBeatAt);
    } else if (this.phase === 'frozen' || this.phase === 'rewound') {
      this.phase = 'running';
      this.nextBeatAt = now + this.beatMs;
      audio.beatStart(this.beatMs, this.nextBeatAt);
      this.resumeBar.classList.remove('open');
    }
    this.evaluate(now);
    this.changed();
    this.updateGhosts();
    this.host.refreshBoosters();
    this.host.kick();
  }

  protected graceDrop(idx: number, now: number): void {
    const old = this.lastEvents;
    const s = this.preStep!;
    this.rewindStack.push(s.clone());
    const live = this.sim;
    this.sim = s;
    const ink = this.inkAt(idx);
    this.sim = live;
    const c = ink ? ink.spec.c : s.nextInk()!.c;
    const chip = s.pi;
    s.drop(idx, ink?.spec, ink?.k);
    this.preStep = s.clone();
    const ev = s.step();
    this.sim = s;
    this.lastEvents = ev;
    this.host.renderer.replaceSim(s);
    const key = (e: SimEvent) => e.type + ':' + ('idx' in e ? e.idx + ':' + e.c : e.a + '-' + e.b);
    const seen = new Set(old.map(key));
    this.host.renderer.onStep(ev.filter((e) => !seen.has(key(e))));
    this.pendingFail = null;
    this.met = new Set(this.ctx.L.targets.filter((i) => s.ink[i] === this.ctx.L.goal[i]));
    this.afterDrop(idx, c, chip, now);
    this.checkTargets();
  }

  protected resumeFromRewind(): void {
    if (this.phase !== 'rewound') return;
    this.resumeBar.classList.remove('open');
    this.phase = 'running';
    this.nextBeatAt = performance.now() + this.beatMs;
    audio.beatStart(this.beatMs, this.nextBeatAt);
    this.host.kick();
  }

  // ------------------------------------------------------------------ beats

  protected doStep(now: number): void {
    const sim = this.sim, ctx = this.ctx;
    this.preStep = sim.clone();
    const ev = sim.step();
    this.lastEvents = ev;
    this.lastStepAt = now;
    this.host.renderer.onStep(ev);
    this.host.pulseBeat();
    const fills: number[] = [], mixes: number[] = [], seeds: number[] = [];
    let touches = 0;
    for (const e of ev) {
      if (e.type === 'fill') { if (!fills.includes(e.c)) fills.push(e.c); }
      else if (e.type === 'mix') { if (!mixes.includes(e.c)) mixes.push(e.c); }
      else if (e.type === 'seed') seeds.push(e.c);
      else if (e.type === 'touch') touches++;
    }
    if (mixes.length) buzz('medium');
    const prog = ctx.L.targets.length ? sim.metCount() / ctx.L.targets.length : 1;
    audio.beat({ tick: sim.tick, fills, mixes, seeds, touches, progress: prog });
    this.checkTargets();
    // Guided timed drop: hold the clock on the right beat until the player taps.
    const g = ctx.guided ? this.nextGhost() : null;
    if (g && g.t > 0 && g.t === sim.tick) {
      this.phase = 'frozen';
      audio.beatStop();
    }
    if (this.hintOn && !this.hintBroken) {
      const ng = this.nextGhost();
      if (ng && ng.t < sim.tick) {
        this.hintBroken = true;
        this.host.say(t('play.hintMissed'), 2600);
      }
    }
    this.evaluate(now);
    this.changed();
    this.updateGhosts();
  }

  protected checkTargets(): void {
    const sim = this.sim, ctx = this.ctx;
    for (const i of ctx.L.targets) {
      if (!this.met.has(i) && sim.ink[i] === ctx.L.goal[i]) {
        this.met.add(i);
        this.host.renderer.onTargetMet(i);
        audio.targetMet(this.met.size / ctx.L.targets.length);
      }
    }
  }

  protected evaluate(now: number): void {
    const sim = this.sim, ctx = this.ctx;
    if (this.phase === 'won' || this.phase === 'lost') return;
    const wrong = sim.wrongCells();
    if (wrong.length) {
      if (!this.pendingFail) this.pendingFail = { at: now + TEMPO.graceMs, cells: wrong };
      else this.pendingFail.cells = wrong;
      return;
    }
    if (!this.decided && sim.allTargetsMet()) {
      const f = sim.forecast();
      if (f.result === 'win') {
        this.decided = 'win';
        this.fastForward = true;
      }
    }
    if (this.decided === 'win' && sim.settled()) {
      this.phase = 'won';
      audio.beatStop();
      this.host.guide(null);
      setTimeout(() => this.host.win(), TEMPO.settleDelayMs);
      return;
    }
    if (sim.inksLeft() === 0 && !this.decided) {
      if (sim.settled()) {
        this.fail(ctx.L.targets.filter((i) => sim.ink[i] !== ctx.L.goal[i]), 'unreached');
        return;
      }
      if (!this.fastForward && sim.forecast().result === 'lose') this.fastForward = true;
    }
    if (sim.inksLeft() > 0 && this.phase !== 'idle' && sim.settled()) {
      let any = false;
      for (let i = 0; i < sim.ink.length && !any; i++) if (!this.blockAt(i)) any = true;
      if (!any) this.fail(ctx.L.targets.filter((i) => sim.ink[i] !== ctx.L.goal[i]), 'unreached');
    }
  }

  protected classify(cells: number[]): FailKind {
    const sim = this.sim, ctx = this.ctx;
    for (const i of cells) {
      const goal = ctx.L.goal[i], got = sim.ink[i];
      if (goal === WHITE) return 'white';
      if (got === 7) return 'mud';
      if (!got) continue;
      if (!isPrimary(goal) && isPrimary(got)) return 'needMix';
      if (isPrimary(goal) && !isPrimary(got)) return 'noMix';
      if (isPrimary(goal) && isPrimary(got)) return 'otherFirst';
      return 'otherMix';
    }
    return 'unreached';
  }

  protected fail(cells: number[], forced?: FailKind): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = 'lost';
    audio.beatStop();
    const kind = forced || this.classify(cells);
    const main = kind === 'white' ? t('fail.white') : kind === 'unreached' ? t('fail.unfinished') : t('fail.wrong');
    const tip = t({ needMix: 'fail.tip.needMix', noMix: 'fail.tip.noMix', otherFirst: 'fail.tip.otherFirst', otherMix: 'fail.tip.otherMix', white: 'fail.tip.white', mud: 'fail.tip.mud', unreached: 'fail.tip.unreached' }[kind]);
    this.host.fail(cells, main, tip);
  }

  // ------------------------------------------------------------------ hints / guided

  protected solutionMatchesSoFar(): boolean {
    const sol = this.ctx.def.solution;
    for (let i = 0; i < this.sim.drops.length; i++) {
      const d = this.sim.drops[i], s = sol[i];
      if (!s || d.x !== s.x || d.y !== s.y || d.t !== s.t) return false;
    }
    return true;
  }

  protected nextGhost(): Drop | null {
    if (!this.hintOn || this.hintBroken) return null;
    return this.ctx.def.solution[this.sim.drops.length] || null;
  }

  protected updateGhosts(): void {
    const sim = this.sim;
    if (!this.hintOn || this.hintBroken) {
      this.host.renderer.setGhosts(null);
      this.placeGuide();
      return;
    }
    const placed = sim.drops.length;
    const pre = this.phase === 'idle' || this.phase === 'prestart';
    const marks: GhostMark[] = this.ctx.def.solution.map((d, i) => {
      const due = d.t <= sim.tick || (pre ? d.t === 0 : false);
      return { idx: sim.idx(d.x, d.y), color: this.solutionColor(i), beat: d.t, order: i + 1, state: i < placed ? 'done' : i === placed && due ? 'now' : 'upcoming' };
    });
    this.host.renderer.setGhosts(marks);
    this.placeGuide();
  }

  protected placeGuide(): void {
    const g = this.nextGhost();
    if (!g || this.phase === 'won' || this.phase === 'lost' || anyPopupOpen()) {
      this.host.guide(null);
      return;
    }
    const due = g.t <= this.sim.tick || ((this.phase === 'idle' || this.phase === 'prestart') && g.t === 0);
    this.host.guide({
      idx: this.sim.idx(g.x, g.y),
      text: due ? (g.t > 0 ? t('play.now') : t('play.tapHere')) : t('play.waitBeat', { n: g.t }),
      hand: due && (this.ctx.guided || this.phase === 'idle'),
      now: due && g.t > 0,
    });
  }

  // ------------------------------------------------------------------ debug

  autoplay(now: number): void {
    if (anyPopupOpen() || this.locked()) return;
    const s = this.ctx.def.solution[this.sim.drops.length];
    if (!s) return;
    const idx = this.sim.idx(s.x, s.y);
    if (this.phase === 'idle' || this.phase === 'prestart') {
      if (s.t === 0) this.tryDrop(idx, now, true);
    } else if (s.t === this.sim.tick && (this.phase === 'running' || this.phase === 'frozen' || this.phase === 'rewound')) this.tryDrop(idx, now, true);
  }

  solveNow(): void {
    const s = new Sim(this.ctx.L);
    const pending = this.ctx.def.solution.slice();
    for (let guard = 0; guard < 400; guard++) {
      while (pending.length && pending[0].t <= s.tick) {
        const d = pending.shift()!;
        const live = this.sim;
        this.sim = s;
        const idx = s.idx(d.x, d.y);
        const ink = this.inkAt(idx);
        this.sim = live;
        s.drop(idx, ink?.spec, ink?.k);
      }
      if (!pending.length && s.settled()) break;
      s.step();
    }
    this.sim = s;
    this.host.renderer.setSim(s);
    this.decided = 'win';
    this.phase = 'running';
    this.evaluate(performance.now());
    this.host.kick();
  }
}
