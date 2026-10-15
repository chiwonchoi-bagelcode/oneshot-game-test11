/*
 * Core E — "first drop shown": the original timing rules, but every stage marks the exact spot of
 * the first ink. The player drops it there, watches it spread, and works out where and when the
 * remaining inks go.
 *
 * What this core adds on top of TimingCore (src/play/timing-core.ts, unchanged):
 *  - The first ink can only go on the marked spot (a bobbing drop with a ring). Other taps get a
 *    friendly line. From the second ink on, the original rules apply (queue order, same-beat
 *    mixing, walls, short inks, clean cells, one drop per beat after beat 0).
 *  - Arrival countdowns: every goal cell that the ink already on the board will reach shows how
 *    many beats are left until it arrives, in the colour that arrives. A mix target waiting for
 *    its partner shows a plain badge ("yellow lands here in 4"), a target the wrong colour is
 *    heading for shows a warning badge, and a mix that will come out right shows the mixed colour.
 *    Before the first drop the badges preview what the first drop will do. The badges are a pure
 *    forecast with Sim.clone() + step(), so they are exactly what the game will do.
 *  - Per-stage coach lines (start / after the first drop / guided "now" moment) and slightly
 *    longer beats for the first stages.
 */
import './e.css';
import './diagrams.ts';
import { TimingCore, DROP_PATH } from '../../play/timing-core.ts';
import type { Core, CoreHost } from '../../play/core.ts';
import type { DropBlock } from '../../core/sim.ts';
import type { GhostMark, OverlayApi } from '../../render/board.ts';
import { anyPopupOpen } from '../../ui/popup.ts';
import { t, has } from '../../i18n/i18n.ts';

import { arrivalBadges, type Badge } from './badges.ts';

/** Beat lengths (ms) before the relaxed-tempo setting. */
export const E_TEMPO = { guided: 980, early: 900, later: 820, daily: 820, earlyUntil: 12 };

class FirstDropCore extends TimingCore {
  private firstIdx = -1;
  private badges: Badge[] = [];
  /** Badges are a preview (before the first drop). */
  private preview = false;
  private coachDone = { first: false, due: false };
  private nudgeAt = -1e9;
  private dropPath: Path2D | null = null;

  constructor(host: CoreHost) {
    super(host);
    host.renderer.setOverlay((ctx, api) => this.drawOverlay(ctx, api), true);
  }

  // ------------------------------------------------------------------ rules

  protected baseBeatMs(): number {
    const c = this.ctx;
    if (c.def.tempo) return c.def.tempo;
    if (c.mode !== 'campaign') return E_TEMPO.daily;
    if (c.guided) return E_TEMPO.guided;
    return c.number <= E_TEMPO.earlyUntil ? E_TEMPO.early : E_TEMPO.later;
  }

  protected blockAt(idx: number): DropBlock | string {
    const b = this.sim.dropBlock(idx);
    if (this.sim.drops.length === 0 && this.firstIdx >= 0 && idx !== this.firstIdx) {
      if (b === 'outside' || b === 'noink') return b;
      return 'first';
    }
    return b;
  }

  protected rejectText(block: string): string {
    if (block === 'first') {
      this.nudgeAt = performance.now();
      this.host.kick();
      return t('e.reject.first');
    }
    return super.rejectText(block);
  }

  // ------------------------------------------------------------------ tray

  protected updateTray(popIndex = -1): void {
    super.updateTray(popIndex);
    const tray = this.host.tray;
    tray.classList.toggle('e-await', !!this.sim && this.sim.drops.length === 0);
    const fill = tray.firstElementChild?.querySelector('path')?.getAttribute('fill');
    if (fill) tray.style.setProperty('--e-first', fill);
  }

  // ------------------------------------------------------------------ attempt / updates

  protected attemptStarted(): void {
    const sol = this.ctx.def.solution[0];
    this.firstIdx = sol ? sol.y * this.ctx.L.w + sol.x : -1;
    this.coachDone = { first: false, due: false };
    const k = this.coachKey('start');
    if (k) this.host.say(t(k), this.coachMs());
    else if (this.ctx.mode === 'campaign' && this.ctx.number <= 6 && !this.ctx.guided) this.host.say(t('e.coach.markHint'), 3200);
  }

  protected changed(): void {
    const sim = this.sim;
    if (!sim) return;
    const over = this.phase === 'won' || this.phase === 'lost' || !!this.decided;
    if (over) this.badges = [];
    else if (sim.drops.length === 0 && this.firstIdx >= 0) {
      const s = sim.clone();
      s.drop(this.firstIdx);
      this.badges = arrivalBadges(s);
      this.preview = true;
    } else {
      this.badges = arrivalBadges(sim);
      this.preview = false;
    }
    // Coach lines tied to this stage's moments.
    if (sim.drops.length >= 1 && !this.coachDone.first) {
      this.coachDone.first = true;
      const k = this.coachKey('first');
      if (k) this.host.say(t(k), this.coachMs());
    }
    if (this.phase === 'frozen' && !this.coachDone.due) {
      this.coachDone.due = true;
      const k = this.coachKey('due');
      if (k) this.host.say(t(k), 0);
    }
    const live = !over && (sim.drops.length === 0 || this.badges.some((b) => b.kind === 'threat'));
    this.host.renderer.setOverlay((ctx, api) => this.drawOverlay(ctx, api), live);
  }

  /** Guided stages keep their line up until the next step; elsewhere it gets out of the way. */
  private coachMs(): number {
    return this.ctx.guided ? 0 : 5200;
  }

  private coachKey(moment: 'start' | 'first' | 'due'): string | null {
    const c = this.ctx;
    if (c.mode !== 'campaign' || !c.def.coach) return null;
    const k = 'e.coach.' + c.def.coach + '.' + moment;
    return has(k) ? k : null;
  }

  /** Hint/guide ghosts: the marked first spot is drawn by this core, so ghost #1 waits until it's used. */
  protected updateGhosts(): void {
    super.updateGhosts();
    if (!this.hintOn || this.hintBroken) return;
    // Guided stages point with the hand and bubble only: a ghost's order badge ("2") would read as a countdown.
    if (this.ctx.guided) {
      this.host.renderer.setGhosts(null);
      return;
    }
    if (this.sim.drops.length > 0) return;
    const sim = this.sim;
    const marks: GhostMark[] = this.ctx.def.solution.slice(1).map((d, i) => ({ idx: sim.idx(d.x, d.y), color: this.solutionColor(i + 1), beat: d.t, order: i + 2, state: 'upcoming' }));
    this.host.renderer.setGhosts(marks);
  }

  protected placeGuide(): void {
    const g = this.nextGhost();
    if (!g || this.phase === 'won' || this.phase === 'lost' || anyPopupOpen()) {
      this.host.guide(null);
      return;
    }
    const pre = this.phase === 'idle' || this.phase === 'prestart';
    const due = g.t <= this.sim.tick || (pre && g.t === 0);
    const first = this.sim.drops.length === 0;
    this.host.guide({
      idx: this.sim.idx(g.x, g.y),
      text: first ? t('e.guide.first') : due ? (g.t > 0 ? t('play.now') : t('play.tapHere')) : t('e.guide.wait'),
      hand: due && (this.ctx.guided || this.phase === 'idle'),
      now: due && g.t > 0,
    });
  }

  state() {
    const s = super.state();
    return { ...s, first: this.firstIdx, badges: this.badges.map((b) => ({ idx: b.idx, kind: b.kind, left: b.beat - (this.preview ? 0 : this.sim.tick), c: b.c })) };
  }

  // ------------------------------------------------------------------ drawing

  private drawOverlay(ctx: CanvasRenderingContext2D, api: OverlayApi): void {
    const sim = this.sim;
    if (!sim || !this.ctx) return;
    if (this.phase === 'won' || this.phase === 'lost') return;
    if (sim.drops.length === 0 && this.firstIdx >= 0) this.drawFirstMark(ctx, api);
    if (!this.badges.length) return;
    const tick = this.preview ? 0 : sim.tick;
    for (const b of this.badges) {
      const left = b.beat - tick;
      if (left <= 0) continue;
      this.drawBadge(ctx, api, b, left);
    }
  }

  private drawFirstMark(ctx: CanvasRenderingContext2D, api: OverlayApi): void {
    const s = api.cell, c = this.ctx.L.inks[0]?.c || 1;
    const col = api.color(c);
    const r = api.rect(this.firstIdx);
    const cx = r.x + s / 2, cy = r.y + s / 2;
    const rm = api.reducedMotion;
    const now = api.now;
    const nudge = Math.max(0, 1 - (now - this.nudgeAt) / 700);
    const k = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    // Soft pool of the ink colour.
    ctx.fillStyle = col.wash;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, s * (0.44 + 0.04 * k + 0.08 * nudge), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Ring: white halo + ink ring, and a ripple going out.
    const rr = s * (0.42 + 0.03 * k + 0.08 * nudge);
    ctx.lineWidth = Math.max(3.5, s * 0.1);
    ctx.strokeStyle = api.dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(2.4, s * 0.07);
    ctx.strokeStyle = col.ring;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    if (!rm) {
      const q = (now / 1300) % 1;
      ctx.globalAlpha = 0.55 * (1 - q);
      ctx.lineWidth = Math.max(1.5, s * 0.05 * (1 - q));
      ctx.beginPath();
      ctx.arc(cx, cy, s * (0.46 + 0.32 * q), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The drop itself, bobbing.
    if (!this.dropPath) this.dropPath = new Path2D(DROP_PATH);
    const ds = (s * 0.5) / 40;
    const bob = rm ? 0 : Math.sin(now / 300) * s * 0.035;
    ctx.save();
    ctx.translate(cx - 20 * ds, cy - 25 * ds + bob - s * 0.02);
    ctx.scale(ds, ds);
    ctx.fillStyle = col.body;
    ctx.fill(this.dropPath);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = col.deep;
    ctx.stroke(this.dropPath);
    ctx.restore();
    if (api.symbols) api.glyph(ctx, c, cx, cy + s * 0.04 + bob, s * 0.2, 'rgba(255,255,255,0.95)');
    else {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.06 + bob, s * 0.1, Math.PI * 0.95, Math.PI * 1.45);
      ctx.stroke();
    }
  }

  private drawBadge(ctx: CanvasRenderingContext2D, api: OverlayApi, b: Badge, left: number): void {
    const s = api.cell;
    const r = api.rect(b.idx);
    const cx = r.x + s / 2, cy = r.y + s / 2;
    const col = api.color(b.c);
    const threat = b.kind === 'threat';
    const promise = b.kind === 'promise';
    const rad = s * (promise ? 0.2 : 0.22);
    const pulse = threat && !api.reducedMotion ? 0.5 + 0.5 * Math.sin(api.now / 210) : 0.5;
    ctx.globalAlpha = this.preview ? 0.82 : 1;
    if (threat) {
      // Warning: a dashed frame along the cell edge (keeps the goal ring inside visible), gently pulsing.
      const m = s * 0.05, rr = s * 0.16;
      const x0 = r.x + m, y0 = r.y + m, ww = s - 2 * m;
      ctx.save();
      ctx.globalAlpha = (this.preview ? 0.7 : 1) * (0.6 + 0.4 * pulse);
      ctx.setLineDash([s * 0.09, s * 0.06]);
      ctx.lineWidth = Math.max(2.2, s * 0.06);
      ctx.strokeStyle = col.deep;
      ctx.beginPath();
      ctx.moveTo(x0 + rr, y0);
      ctx.arcTo(x0 + ww, y0, x0 + ww, y0 + ww, rr);
      ctx.arcTo(x0 + ww, y0 + ww, x0, y0 + ww, rr);
      ctx.arcTo(x0, y0 + ww, x0, y0, rr);
      ctx.arcTo(x0, y0, x0 + ww, y0, rr);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = this.preview ? 0.82 : 1;
    }
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.strokeStyle = api.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)';
    ctx.stroke();
    // Number: white with a dark edge reads on every ink.
    const fs = Math.round(s * (promise ? 0.27 : 0.32));
    ctx.font = '900 ' + fs + 'px Pretendard, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.5, fs * 0.2);
    ctx.strokeStyle = 'rgba(30,24,20,0.7)';
    const txt = String(left);
    ctx.strokeText(txt, cx, cy + fs * 0.05);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(txt, cx, cy + fs * 0.05);
    if (api.symbols) {
      // Colour glyph of the arriving ink on the badge's shoulder.
      const gx = cx - rad * 0.95, gy = cy - rad * 0.95, gr = Math.max(6, s * 0.1);
      ctx.fillStyle = api.dark ? '#2b2622' : '#ffffff';
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
      api.glyph(ctx, b.c, gx, gy, gr * 1.25, col.deep);
      // The badge covers the goal's own glyph: repeat it on the opposite shoulder.
      const g = this.ctx.L.goal[b.idx];
      if (g && g < 8) {
        const qx = cx + rad * 0.95, qy = cy + rad * 0.95, gcol = api.color(g);
        ctx.fillStyle = api.dark ? '#2b2622' : '#ffffff';
        ctx.beginPath();
        ctx.arc(qx, qy, gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, s * 0.03);
        ctx.strokeStyle = gcol.ring;
        ctx.stroke();
        api.glyph(ctx, g, qx, qy, gr * 1.25, gcol.deep);
      }
    }
    ctx.globalAlpha = 1;
  }
}

export function createCore(host: CoreHost): Core {
  return new FirstDropCore(host);
}
