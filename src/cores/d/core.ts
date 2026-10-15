/*
 * Core D — marked wells (투입 위치를 알려주는 타이밍 퍼즐).
 *
 * The original timing rules (beat clock, spreading, same-beat mixing) with the drop spots shown
 * from the start: ink can only be released from the wells on the board. The player decides which
 * wells to open, in what order and on which beat.
 *
 * Readability and comfort (vs. the original):
 *  - Press and hold a well: the board shows where its ink would go and where it would mix if you
 *    let go now (the preview follows the clock while you hold). Let go to drop, slide off to cancel.
 *  - Longer beats, a wider grace window after each beat, and a quick tap counts on the beat you
 *    pressed it (not the one you lifted your finger on).
 *  - The count-in after a beat-0 drop is longer and waits a little while you hold the next well.
 *  - If the wells left can no longer finish the picture, the stage ends at once (no waiting).
 */
import './d.css';
import { TimingCore, inkChip, DROP_PATH } from '../../play/timing-core.ts';
import type { Core, CoreHost } from '../../play/core.ts';
import { Sim, parseInk, type InkSpec, type DropBlock } from '../../core/sim.ts';
import type { OverlayApi } from '../../render/board.ts';
import { TEMPO } from '../../config/balance.ts';
import { audio } from '../../audio/index.ts';
import { buzz } from '../../services/feedback.ts';
import { t } from '../../i18n/i18n.ts';
import { anyPopupOpen } from '../../ui/popup.ts';
import { registerDDiagrams } from './diagrams.ts';

registerDDiagrams();

/** Within this long of a beat change, a drop may go to either beat (see release()). */
const SNAP_MS = 170;
/** Touch events arrive this late: a press this soon after a beat began before it. */
const LATENCY_MS = 60;
/** A press shorter than this counts on the beat it started in (the finger went down in time). */
const QUICK_MS = 320;
/** Hold this long before the preview shows (a quick tap shouldn't flash it). */
const PREVIEW_DELAY_MS = 130;
/** Count-in after a beat-0 drop, in beats. */
const COUNT_IN = 1.5;
/** Holding a well during the count-in can stretch it up to this many beats after the last drop. */
const COUNT_IN_HOLD_MAX = 3;

const DROP = typeof Path2D !== 'undefined' ? new Path2D(DROP_PATH) : (null as unknown as Path2D);
const SHINE = typeof Path2D !== 'undefined' ? new Path2D('M13 29a7 7 0 0 1 4-7') : (null as unknown as Path2D);

interface Hold { k: number; idx: number; downAt: number; downTick: number; away: boolean }
interface Preview { key: string; ink: Uint8Array; mixed: Uint8Array; born: Int16Array; tick: number }

class WellsCore extends TimingCore {
  private specs: InkSpec[] = [];
  private wellIdx: number[] = [];
  private hold: Hold | null = null;
  private preview: Preview | null = null;
  private previewShown = false;
  private lastDropAt = 0;
  private stuckKey = '';
  private flashUntil = 0;
  /** A press just before a beat change that was meant for the coming beat: dropped on it. */
  private deferred: { idx: number; t: number } | null = null;
  private overlayLive = false;
  /** Attempts per stage this session, and whether the player has seen a hold preview there. */
  private tries = new Map<string, number>();
  private previewedIn = new Set<string>();
  private readonly overlayFn = (g: CanvasRenderingContext2D, api: OverlayApi) => this.drawOverlay(g, api);

  constructor(host: CoreHost) {
    super(host);
  }

  // ------------------------------------------------------------------ setup

  start(): void {
    const def = this.host.ctx().def;
    this.specs = (def.wells || []).map((w) => parseInk(w.ink));
    this.wellIdx = (def.wells || []).map((w) => w.y * def.map[0].length + w.x);
    super.start();
  }

  protected attemptStarted(): void {
    this.hold = null;
    this.deferred = null;
    this.preview = null;
    this.previewShown = false;
    this.stuckKey = '';
    this.overlayLive = false;
    this.redraw();
    const id = this.ctx.def.id;
    const n = (this.tries.get(id) || 0) + 1;
    this.tries.set(id, n);
    // Retrying without ever peeking: remind the player that holding a well shows the outcome.
    if (n >= 2 && !this.previewedIn.has(id) && !this.ctx.guided && this.specs.length > 1) {
      setTimeout(() => { if (this.phase === 'idle' && !anyPopupOpen()) this.host.say(t('d.tip.hold'), 3800); }, 350);
      return;
    }
    const c = this.ctx.def.coach;
    if (c && this.ctx.mode === 'campaign') setTimeout(() => { if (this.phase === 'idle' && !anyPopupOpen()) this.host.say(t(c), 4200); }, 450);
  }

  protected baseBeatMs(): number {
    const c = this.ctx;
    if (c.def.tempo) return c.def.tempo;
    return c.mode === 'campaign' && c.number <= 12 ? 840 : 780;
  }

  // ------------------------------------------------------------------ wells

  private wellAt(idx: number): number {
    return this.wellIdx.indexOf(idx);
  }

  private wellUsed(k: number): boolean {
    return this.sim.drops.some((d) => d.k === k);
  }

  private wellState(k: number): 'open' | 'used' | 'covered' {
    if (this.wellUsed(k)) return 'used';
    return this.sim.ink[this.wellIdx[k]] ? 'covered' : 'open';
  }

  protected blockAt(idx: number): DropBlock | string {
    if (idx < 0 || idx >= this.sim.ink.length) return 'outside';
    const k = this.wellAt(idx);
    if (k < 0) return this.ctx.L.wall[idx] ? 'wall' : 'nowell';
    const st = this.wellState(k);
    if (st !== 'open') return st;
    return this.sim.dropBlock(idx);
  }

  protected inkAt(idx: number): { spec: InkSpec; k: number } | undefined {
    const k = this.wellAt(idx);
    return k < 0 ? undefined : { spec: this.specs[k], k };
  }

  protected rejectText(block: string): string {
    if (block === 'nowell') return t('d.reject.nowell');
    if (block === 'used') return t('d.reject.used');
    if (block === 'covered') return t('d.reject.covered');
    return super.rejectText(block);
  }

  protected changed(): void {
    if (this.sim) this.updateTray();
  }

  // ------------------------------------------------------------------ tray

  protected renderTray(): void {
    const tray = this.host.tray;
    tray.innerHTML = '';
    tray.className = 'queue d-wells';
    this.specs.forEach((s) => tray.appendChild(inkChip(s.c, s.range)));
    this.updateTray();
  }

  protected updateTray(): void {
    const chips = this.host.tray.children;
    const last = this.sim.drops[this.sim.drops.length - 1];
    for (let k = 0; k < chips.length; k++) {
      const c = chips[k] as HTMLElement;
      const st = this.sim ? this.wellState(k) : 'open';
      c.classList.toggle('used', st !== 'open');
      c.classList.toggle('covered', st === 'covered');
      c.classList.toggle('held', (!!this.hold && this.hold.k === k && !this.hold.away) || (!!this.deferred && this.deferred.idx === this.wellIdx[k]));
    }
    void last;
  }

  // ------------------------------------------------------------------ input

  undo(): void {
    this.hold = null;
    this.deferred = null;
    super.undo();
  }

  down(idx: number, _x: number, _y: number, now: number): void {
    if (this.locked() || idx < 0) return;
    if (this.deferred && this.deferred.idx === idx) return; // already opening on the coming beat
    const k = this.wellAt(idx);
    const block = this.blockAt(idx);
    if (k < 0 || block) {
      this.reject(idx, block || 'blocked');
      return;
    }
    if (this.ctx.guided) {
      const g = this.nextGhost();
      if (g && this.sim.idx(g.x, g.y) !== idx) {
        this.reject(idx, 'guide');
        return;
      }
    }
    this.hold = { k, idx, downAt: now, downTick: this.sim.tick, away: false };
    this.previewShown = false;
    if (this.phase === 'prestart') audio.beatStop();
    buzz('light');
    this.updateTray();
    this.placeGuide();
    this.host.kick();
  }

  move(idx = -1): void {
    const h = this.hold;
    if (!h) return;
    const away = idx !== h.idx;
    if (away !== h.away) {
      h.away = away;
      this.updateTray();
      this.placeGuide();
      this.redraw();
      this.host.kick();
    }
  }

  up(idx = -1, _x = 0, _y = 0, now = performance.now()): void {
    const h = this.hold;
    if (!h) return;
    this.hold = null;
    this.previewShown = false;
    this.updateTray();
    const restartCountIn = () => {
      if (this.phase === 'prestart') {
        this.nextBeatAt = Math.max(this.nextBeatAt, now + this.beatMs * 0.75);
        audio.beatStart(this.beatMs, this.nextBeatAt);
      }
    };
    if (this.locked()) { this.redraw(); return; }
    if (h.away || idx !== h.idx) {
      restartCountIn();
      if (now - h.downAt > QUICK_MS) this.host.say(t('d.cancelled'), 1600);
      this.placeGuide();
      this.redraw();
      this.host.kick();
      return;
    }
    // Guided lesson: letting go too early only teaches the wrong thing; keep the well closed.
    if (this.ctx.guided) {
      const g = this.nextGhost();
      if (g && g.t > this.sim.tick && this.sim.idx(g.x, g.y) === idx) {
        restartCountIn();
        this.host.say(t('d.guide.early', { n: g.t }), 2200);
        audio.reject();
        this.placeGuide();
        this.host.kick();
        return;
      }
    }
    // A quick tap counts from the moment the finger went down; a hold from the moment it lifts.
    this.release(idx, now - h.downAt < QUICK_MS ? h.downAt : now, now);
  }

  /**
   * Drops well idx for a press/lift at time m. Near a beat change the intended beat is ambiguous
   * (touch latency, tapping on the tick sound, a slow lift), so within SNAP_MS of the change the
   * drop goes to whichever of the two beats the player most likely meant: the beat of the stored
   * solution if they are on its path, else the one that doesn't spoil the picture, else the beat
   * the finger was on (minus touch latency).
   */
  private release(idx: number, m: number, now: number): void {
    const tick = this.sim.tick;
    let cands: number[] = [];
    if (this.phase === 'running' && !this.fastForward) {
      if (m - this.lastStepAt < SNAP_MS && this.preStep && tick > 0 && this.graceAllowed(idx)) cands = [tick - 1, tick];
      else if (this.nextBeatAt - m < SNAP_MS) cands = [tick, tick + 1];
    }
    let beat = tick;
    if (cands.length) {
      beat = cands[0] === tick - 1 ? (m < this.lastStepAt + LATENCY_MS ? tick - 1 : tick) : tick;
      const g = this.solutionMatchesSoFar() ? this.ctx.def.solution[this.sim.drops.length] : null;
      if (g && this.sim.idx(g.x, g.y) === idx && cands.includes(g.t)) beat = g.t;
      else {
        const sc = cands.map((b) => this.outlook(idx, b));
        if (sc[0] !== sc[1]) beat = cands[sc[0] > sc[1] ? 0 : 1];
      }
    }
    if (beat === tick - 1) this.graceDrop(idx, now);
    else if (beat === tick + 1) {
      this.deferred = { idx, t: beat };
      this.updateTray();
      this.redraw();
    } else super.tryDrop(idx, now, true);
  }

  /** 2 = dropping on beat b would finish the picture, 1 = nothing goes wrong yet, 0 = spoils it. */
  private outlook(idx: number, b: number): number {
    const k = this.wellAt(idx);
    const tick = this.sim.tick;
    const s = (b < tick ? this.preStep! : this.sim).clone();
    if (b > tick) s.step();
    if (s.wrongCells().length || !s.drop(idx, this.specs[k], k)) return 0;
    const f = s.forecast();
    return f.result === 'win' ? 2 : f.sim.wrongCells().length ? 0 : 1;
  }

  private reject(idx: number, block: string): void {
    this.host.renderer.onReject(idx, block);
    audio.reject();
    buzz('light');
    this.host.say(block === 'guide' ? t('d.guide.follow') : this.rejectText(block));
    if (block === 'nowell') this.flashUntil = performance.now() + 900;
    this.overlayLive = true;
    this.redraw();
    this.host.kick();
  }

  protected afterDrop(idx: number, c: number, chipIndex: number, now: number): void {
    this.lastDropAt = now;
    super.afterDrop(idx, c, chipIndex, now);
    if (this.phase === 'prestart') {
      // A longer count-in: time to open the other beat-0 wells.
      this.nextBeatAt = now + this.beatMs * COUNT_IN;
      audio.beatStart(this.beatMs, this.nextBeatAt);
    }
  }

  // ------------------------------------------------------------------ clock

  frame(now: number): boolean {
    const h = this.hold;
    const ghost = this.ctx && this.ctx.guided ? this.nextGhost() : null;
    if (h && this.phase === 'prestart' && !h.away && !(ghost && ghost.t > 0)) {
      // Holding the next well during the count-in: the first beat waits (up to a limit).
      const cap = this.lastDropAt + this.beatMs * COUNT_IN_HOLD_MAX;
      if (now < cap) this.nextBeatAt = Math.max(this.nextBeatAt, Math.min(cap, now + this.beatMs * 0.5));
    }
    // Keep a lost beat open while a late tap could still save it.
    if (this.pendingFail) {
      const rescue = h && !h.away && h.downTick === this.sim.tick - 1 && now - h.downAt < QUICK_MS;
      this.pendingFail.at = Math.max(this.pendingFail.at, this.lastStepAt + SNAP_MS, rescue ? now + 30 : 0);
    }
    const busy = super.frame(now);
    const dd = this.deferred;
    if (dd && (this.phase !== 'running' || this.locked())) this.deferred = null;
    else if (dd && this.sim.tick >= dd.t) {
      this.deferred = null;
      super.tryDrop(dd.idx, now, true);
    }
    let live = false;
    if (h && !h.away) {
      live = true; // keep frames coming until the preview shows (and while it follows the clock)
      if (!this.previewShown && now - h.downAt >= PREVIEW_DELAY_MS) {
        this.previewShown = true;
        this.previewedIn.add(this.ctx.def.id);
        this.placeGuide();
      }
      if (this.previewShown) this.updatePreview(h.k);
    }
    if (this.flashUntil > now) live = true;
    if (live !== this.overlayLive) {
      this.overlayLive = live;
      this.redraw();
    }
    return busy || live;
  }

  /** Forecast of the board if well k is opened now and nothing else is dropped. */
  private updatePreview(k: number): void {
    const sim = this.sim;
    const key = k + ':' + sim.tick + ':' + sim.drops.length + ':' + sim.pi;
    if (this.preview && this.preview.key === key) return;
    const s = sim.clone();
    const idx = this.wellIdx[k];
    if (!s.drop(idx, this.specs[k], k)) { this.preview = null; return; }
    for (let g = 0; g < 120 && !s.settled(); g++) s.step();
    this.preview = { key, ink: s.ink, mixed: s.mixed, born: s.born, tick: sim.tick };
    this.redraw();
  }

  /** Ask the board to draw again (overlay only; the ink layers stay cached). */
  private redraw(): void {
    this.host.renderer.setOverlay(this.overlayFn, this.overlayLive);
  }

  // ------------------------------------------------------------------ verdicts

  protected evaluate(now: number): void {
    super.evaluate(now);
    const sim = this.sim;
    if (this.phase === 'won' || this.phase === 'lost' || this.decided || this.pendingFail) return;
    if (this.phase === 'idle' || !sim.settled() || sim.inksLeft() === 0) return;
    const key = sim.drops.length + ':' + sim.pi;
    if (key === this.stuckKey) return;
    this.stuckKey = key;
    if (!this.canStillWin()) {
      this.fail(this.ctx.L.targets.filter((i) => sim.ink[i] !== this.ctx.L.goal[i]), 'unreached');
    }
  }

  /** Can the wells still open finish the picture from this settled board? (bounded search) */
  private canStillWin(): boolean {
    const free: number[] = [];
    for (let k = 0; k < this.specs.length; k++) if (this.wellState(k) === 'open') free.push(k);
    if (!free.length) return false;
    if (free.length > 5) return true;
    let budget = 6000; // sim steps; past it we assume the player can still win (never a false fail)
    const ok = (s: Sim): 'win' | 'lose' | 'open' => {
      if (s.wrongCells().length) return 'lose';
      if (s.allTargetsMet() && s.forecast().result === 'win') return 'win';
      return 'open';
    };
    const search = (s: Sim, left: number[], depth: number): boolean => {
      if (--budget < 0) return true;
      // Any subset of the free wells now (the board may be moving or still).
      const n = left.length;
      for (let mask = 1; mask < 1 << n; mask++) {
        if (--budget < 0) return true;
        const s2 = s.clone();
        const rest: number[] = [];
        let good = true;
        for (let j = 0; j < n; j++) {
          const k = left[j];
          if (mask & (1 << j)) { if (!s2.drop(this.wellIdx[k], this.specs[k], k)) good = false; }
          else rest.push(k);
        }
        if (!good) continue;
        const v = ok(s2);
        if (v === 'win') return true;
        if (v === 'lose') continue;
        // Let it run; try the remaining wells on each of the next beats.
        let s3 = s2;
        for (let b = 0; b < 8 && budget > 0; b++) {
          if (s3.settled()) {
            if (rest.length && depth < 6 && search(s3, rest.filter((k) => !s3.ink[this.wellIdx[k]]), depth + 1)) return true;
            break;
          }
          s3 = s3.clone();
          s3.step();
          budget--;
          const v3 = ok(s3);
          if (v3 === 'win') return true;
          if (v3 === 'lose') break;
          const r3 = rest.filter((k) => !s3.ink[this.wellIdx[k]]);
          if (r3.length && depth < 6 && search(s3, r3, depth + 1)) return true;
        }
        if (budget <= 0) return true;
      }
      return false;
    };
    return search(this.sim, free, 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected fail(cells: number[], forced?: any): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.hold = null;
    if (forced === 'unreached' && this.sim.inksLeft() > 0) {
      this.phase = 'lost';
      audio.beatStop();
      this.host.fail(cells, t('d.fail.stuck'), t('d.fail.stuckTip'));
      return;
    }
    super.fail(cells, forced);
  }

  // ------------------------------------------------------------------ guide (tutorial hand)

  protected updateGhosts(): void {
    super.updateGhosts();
    // Lessons point with the hand only; the numbered marks are for the paid hint.
    if (this.ctx.guided) this.host.renderer.setGhosts(null);
  }

  protected placeGuide(): void {
    if (!this.ctx || !this.sim) return;
    const g = this.nextGhost();
    if (!g || this.phase === 'won' || this.phase === 'lost' || anyPopupOpen()) {
      this.host.guide(null);
      return;
    }
    const idx = this.sim.idx(g.x, g.y);
    const pre = this.phase === 'idle' || this.phase === 'prestart';
    const due = g.t <= this.sim.tick || (pre && g.t === 0);
    const holding = !!this.hold && this.hold.idx === idx && !this.hold.away;
    const teachHold = this.ctx.guided && this.sim.drops.length > 0;
    let text: string;
    if (due) {
      if (holding && this.previewShown) text = t('d.guide.release');
      else if (teachHold && g.t === 0) text = t('d.guide.hold');
      else text = g.t > 0 ? t('play.now') : t('d.guide.tap');
    } else {
      text = holding ? t('d.guide.keep', { n: g.t }) : this.ctx.guided ? t('d.guide.holdWait', { n: g.t }) : t('play.waitBeat', { n: g.t });
    }
    this.host.guide({
      idx,
      text,
      hand: !holding && (due || (this.ctx.guided && teachHold)) && (this.ctx.guided || this.phase === 'idle'),
      now: due && (g.t > 0 || holding),
    });
  }

  // ------------------------------------------------------------------ drawing

  private drawOverlay(g: CanvasRenderingContext2D, api: OverlayApi): void {
    const sim = this.sim;
    if (!sim) return;
    const s = api.cell;
    const h = this.hold && !this.hold.away && this.previewShown ? this.hold : null;
    const pv = h && this.preview && this.preview.key.startsWith(h.k + ':') ? this.preview : null;
    const TAU = Math.PI * 2;
    // Preview: where the held ink (and the inks already running) will be once everything settles.
    if (pv) {
      for (let i = 0; i < pv.ink.length; i++) {
        if (sim.ink[i] || !pv.ink[i]) continue;
        const cc = api.center(i);
        const col = api.color(pv.ink[i]);
        if (pv.mixed[i]) {
          g.globalAlpha = 0.9;
          g.fillStyle = col.body;
          g.beginPath(); g.arc(cc.x, cc.y, s * 0.27, 0, TAU); g.fill();
          g.lineWidth = Math.max(2, s * 0.06);
          g.strokeStyle = 'rgba(255,255,255,0.95)';
          g.stroke();
          if (api.symbols) api.glyph(g, pv.ink[i], cc.x, cc.y, s * 0.24, 'rgba(255,255,255,0.95)');
        } else if (this.ctx.L.goal[i] && this.ctx.L.goal[i] !== 8) {
          // On a goal ring: a solid disc inside the ring, easy to compare with the ring's colour.
          g.fillStyle = col.body;
          g.beginPath(); g.arc(cc.x, cc.y, s * 0.2, 0, TAU); g.fill();
          g.lineWidth = Math.max(1.5, s * 0.04);
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.stroke();
          if (api.symbols) api.glyph(g, pv.ink[i], cc.x, cc.y, s * 0.18, 'rgba(255,255,255,0.95)');
        } else {
          g.globalAlpha = 0.42;
          g.fillStyle = col.body;
          g.beginPath(); g.arc(cc.x, cc.y, s * 0.17, 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
      }
      // Clean cells the preview would stain.
      for (const i of this.ctx.L.whites) {
        if (sim.ink[i] || !pv.ink[i]) continue;
        const cc = api.center(i);
        g.strokeStyle = '#d93a2b';
        g.lineWidth = Math.max(2, s * 0.06);
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.3, 0, TAU); g.stroke();
      }
    }
    const flash = this.flashUntil > api.now ? (this.flashUntil - api.now) / 900 : 0;
    for (let k = 0; k < this.wellIdx.length; k++) {
      const i = this.wellIdx[k];
      const cc = api.center(i);
      const spec = this.specs[k];
      const col = api.color(spec.c);
      const st = this.wellState(k);
      if (st === 'used') {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = Math.max(1.5, s * 0.035);
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.36, 0, TAU); g.stroke();
        continue;
      }
      if (st === 'covered') {
        g.save();
        g.setLineDash([s * 0.07, s * 0.06]);
        g.strokeStyle = api.dark ? 'rgba(255,255,255,0.75)' : 'rgba(43,38,34,0.55)';
        g.lineWidth = Math.max(1.5, s * 0.04);
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.3, 0, TAU); g.stroke();
        g.restore();
        g.fillStyle = col.body;
        g.globalAlpha = 0.55;
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.11, 0, TAU); g.fill();
        g.globalAlpha = 1;
        continue;
      }
      const held = (!!this.hold && this.hold.k === k) || (!!this.deferred && this.deferred.idx === i);
      const pulse = held && !api.reducedMotion ? 0.04 * Math.sin(api.now / 120) : 0;
      // Basin: a sunken stone square with the well's ink as a big drop in it.
      const bx = cc.x - s * 0.42, by = cc.y - s * 0.42, bw = s * 0.84;
      g.fillStyle = api.dark ? 'rgba(255,255,255,0.10)' : 'rgba(120,92,60,0.16)';
      g.beginPath(); g.roundRect(bx, by, bw, bw, s * 0.2); g.fill();
      g.strokeStyle = held ? col.ring : api.dark ? 'rgba(255,255,255,0.35)' : 'rgba(120,92,60,0.38)';
      g.lineWidth = held ? Math.max(2.5, s * 0.07) : Math.max(1.5, s * 0.035);
      g.stroke();
      if (flash > 0) {
        g.strokeStyle = col.ring;
        g.globalAlpha = flash;
        g.lineWidth = Math.max(2.5, s * 0.08);
        const e = s * 0.1 * (1 - flash);
        g.beginPath(); g.roundRect(bx - e, by - e, bw + 2 * e, bw + 2 * e, s * 0.22); g.stroke();
        g.globalAlpha = 1;
      }
      const sc = (s * (0.66 + (held ? 0.06 : 0) + pulse)) / 46;
      g.save();
      g.translate(cc.x - 20 * sc, cc.y - 25 * sc);
      g.scale(sc, sc);
      g.fillStyle = api.dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.95)';
      g.lineJoin = 'round';
      g.lineWidth = 6;
      g.strokeStyle = g.fillStyle;
      g.stroke(DROP);
      g.fillStyle = col.body;
      g.fill(DROP);
      g.strokeStyle = col.deep;
      g.lineWidth = 1.6;
      g.stroke(DROP);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.stroke(SHINE);
      g.restore();
      const gy = cc.y + s * 0.07;
      if (isFinite(spec.range)) {
        g.fillStyle = '#fff';
        g.font = '900 ' + Math.round(s * 0.3) + 'px Pretendard, system-ui, -apple-system, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = Math.max(2, s * 0.05);
        g.strokeStyle = 'rgba(0,0,0,0.4)';
        g.strokeText(String(spec.range), cc.x, gy + s * 0.02);
        g.fillText(String(spec.range), cc.x, gy + s * 0.02);
        if (api.symbols) api.glyph(g, spec.c, cc.x + s * 0.29, cc.y - s * 0.29, s * 0.15, col.deep);
      } else if (api.symbols) api.glyph(g, spec.c, cc.x, gy, s * 0.22, 'rgba(255,255,255,0.95)');
    }
      }

  // ------------------------------------------------------------------ debug / tests

  state() {
    const base = super.state();
    return {
      ...base,
      wellStates: this.wellIdx.map((idx, k) => ({ idx, k, state: this.sim ? this.wellState(k) : "open" })),
      holding: this.hold ? this.hold.k : -1,
      preview: !!(this.hold && this.previewShown && this.preview),
      beatMs: this.beatMs,
      toBeat: this.phase === 'running' ? Math.round(this.nextBeatAt - performance.now()) : -1,
      deferred: !!this.deferred,
    };
  }
}

export function createCore(host: CoreHost): Core {
  return new WellsCore(host);
}

void TEMPO;
