/*
 * Inkbloom audio engine — public API.
 *
 * Everything is synthesised (no audio files): instruments are rendered once into AudioBuffers
 * (bank.ts / dsp.ts), music is generative per chapter (music.ts), SFX are tuned to the current key
 * (sfx.ts). This file owns the AudioContext lifecycle: unlock on gesture, suspend when hidden or
 * idle, resume / re-create after iOS interruptions or a closed context, perf→audio clock mapping
 * for the beat grid, and the 25 ms look-ahead scheduler.
 *
 * Every public method is a no-op (never throws) when WebAudio is unavailable.
 */
import { Bank } from './bank.ts';
import { bufferFactory, type Clock } from './core.ts';
import type { Mood } from './music.ts';
import type { BeatInfo } from './sfx.ts';
import { ESSENTIALS, Studio, paletteInstruments } from './studio.ts';
import { CHAPTERS, MENU } from './theory.ts';

export type InkColor = number; // bit flags: R=1 Y=2 B=4, O=3 P=5 G=6 K=7 (mud)

export interface AudioEngine {
  /** Call from any user gesture. Creates/resumes the context; safe to call often. */
  unlock(): void;
  /** 0..1 each. Persisted by the caller, not by you. */
  setVolumes(v: { sfx: number; music: number }): void;
  /** Background music. 'menu' = calm ambient loop for menus/map; 'play' = gameplay bed for a chapter; 'none' = fade out. Crossfade ~1s. */
  setMusic(mood: 'menu' | 'play' | 'none', chapter?: number): void;
  /** Gameplay beat grid: first beat at performance.now()-time `firstBeatAt`, then every beatMs. */
  beatStart(beatMs: number, firstBeatAt: number): void;
  /** Clock paused/stopped (pause, fail, win, leaving). Tension layer fades quickly. */
  beatStop(): void;
  /** Called on every beat the board advances. */
  beat(info: { tick: number; fills: InkColor[]; mixes: InkColor[]; seeds: InkColor[]; touches: number; progress: number }): void;
  uiTap(): void;
  uiBack(): void;
  popupOpen(): void;
  popupClose(): void;
  toggle(on: boolean): void;
  drop(c: InkColor): void;
  reject(): void;
  rewind(): void;
  hint(): void;
  targetMet(progress: number): void;
  wrong(): void;
  win(perfect: boolean): void;
  stamp(): void;
  coins(count: number): void;
  reward(): void;
  purchase(): void;
  chapterComplete(): void;
  streak(): void;
  unlock2(): void;
  /** Debug helper: currently playing description. */
  debugInfo(): string;
  /** Extra: silence + suspend everything (e.g. while a video ad plays); false restores. */
  setPaused(paused: boolean): void;
  /** Extra: true once the context is running. */
  isRunning(): boolean;
}

const LOOKAHEAD = 0.12; // s scheduled ahead
const TICK_MS = 25;
const IDLE_SUSPEND_S = 5;

type AnyWin = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

function ctor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as AnyWin;
  return w.AudioContext || w.webkitAudioContext || null;
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function detectLowPower(): boolean {
  try {
    const n = navigator as Navigator & { deviceMemory?: number };
    if (n.deviceMemory != null && n.deviceMemory <= 2) return true;
    if (n.hardwareConcurrency != null && n.hardwareConcurrency <= 2) return true;
  } catch {
    /* */
  }
  return false;
}

class Engine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private studio: Studio | null = null;
  private bank: Bank | null = null;
  private clock: Clock = { offset: 0 };
  private clockInit = false;
  private vol = { sfx: 1, music: 1 };
  private mood: Mood = 'none';
  private chapter = 0;
  private grid: { beatMs: number; firstBeatAt: number } | null = null;
  private fast: ReturnType<typeof setInterval> | null = null;
  private slow: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeCheck: ReturnType<typeof setTimeout> | null = null;
  private hidden = false;
  private paused = false;
  private idleSuspended = false;
  private stale = false;
  private lastResumeAt = -1e9;
  private lastCt = -1;
  private lastCtPerf = 0;
  private lowPower = false;
  private created = 0;
  /** Audio time of the last request that needed sound (idle-suspend countdown starts here). */
  private lastWake = 0;
  /** The current context has been 'running' at least once (so a failed resume means interrupted). */
  private ran = false;

  // ------------------------------------------------------------------ lifecycle
  unlock(): void {
    try {
      const C = ctor();
      if (!C) return;
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running' && !this.stale) return;
      if (!ctx || ctx.state === 'closed' || this.stale) this.create();
      if (!this.ctx || this.hidden || this.paused) return;
      if ((this.ctx.state as string) !== 'running') {
        this.kick();
        this.resume(true);
      }
    } catch {
      /* never throw from a gesture handler */
    }
  }

  private create(): void {
    const C = ctor();
    if (!C) return;
    this.teardown();
    this.lowPower = detectLowPower();
    let ctx: AudioContext;
    try {
      ctx = new C({ latencyHint: this.lowPower ? 'balanced' : 'interactive' });
    } catch {
      ctx = new C();
    }
    this.ctx = ctx;
    this.created++;
    this.ran = false;
    this.lastWake = 0;
    this.stale = false;
    this.clockInit = false;
    this.idleSuspended = false;
    this.lastCt = -1;
    if (!this.bank) this.bank = new Bank(ctx.sampleRate, bufferFactory(ctx));
    else this.bank.setFactory(bufferFactory(ctx));
    const st = new Studio(ctx, this.bank, { lowPower: this.lowPower, clock: this.clock, deferReverb: true });
    this.studio = st;
    st.setVolumes(this.vol.sfx, this.vol.music);
    this.bank.prefetch(ESSENTIALS);
    this.syncClock();
    if (this.mood !== 'none') st.setMusic(this.mood, this.chapter, ctx.currentTime);
    if (this.grid) st.beatStart(this.grid.beatMs, this.grid.firstBeatAt);
    // then everything else, current palette first
    this.bank.prefetch(paletteInstruments(this.mood === 'play' ? CHAPTERS[this.chapter] : MENU));
    this.bank.prefetch(Bank.allNames());
    ctx.onstatechange = () => this.onState();
    this.ensureTimers();
    // reverb IR after the gesture handler returns (keeps the first tap instant)
    setTimeout(() => {
      try {
        if (this.studio === st) st.core.buildReverb();
      } catch {
        /* */
      }
    }, 30);
  }

  private teardown(): void {
    this.stopTimers();
    const old = this.ctx;
    if (this.studio) {
      try { this.studio.dispose(); } catch { /* */ }
    }
    this.studio = null;
    this.ctx = null;
    if (old) {
      old.onstatechange = null;
      if (old.state !== 'closed') {
        try { old.close().catch(() => undefined); } catch { /* */ }
      }
    }
  }

  /** iOS: starting any buffer inside the gesture unlocks output. */
  private kick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* */
    }
  }

  private resume(fromGesture: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    this.lastResumeAt = perfNow();
    try {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(() => this.onState(), () => {
          if (fromGesture && this.ran) this.stale = true;
        });
      }
    } catch {
      if (fromGesture && this.ran) this.stale = true;
    }
    if (fromGesture && this.ran) {
      if (this.resumeCheck) clearTimeout(this.resumeCheck);
      this.resumeCheck = setTimeout(() => {
        this.resumeCheck = null;
        // still not running after a gesture (iOS "interrupted", dead session): rebuild next gesture
        if (this.ctx === ctx && ctx.state !== 'running' && !this.hidden && !this.paused) this.stale = true;
      }, 800);
    }
  }

  private onState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.state as string;
    if (s === 'running') {
      this.ran = true;
      this.idleSuspended = false;
      this.lastCt = -1;
      this.clockInit = false;
      this.syncClock();
      if (this.studio && !this.hidden && !this.paused) this.studio.core.fadeMaster(1, 0.08);
      this.ensureTimers();
    } else if (s === 'closed') {
      this.stale = true;
      this.stopTimers();
    } else {
      // suspended / interrupted: timers are pointless until it runs again
      this.stopTimers();
    }
  }

  onHide(): void {
    this.hidden = true;
    this.stopTimers();
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    try {
      if (this.studio) this.studio.core.fadeMaster(0, 0.012);
    } catch { /* */ }
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.hidden && this.ctx === ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined);
    }, 70);
  }

  onShow(): void {
    if (!this.hidden) return;
    this.hidden = false;
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.paused) return;
    if (ctx.state === 'closed' || this.stale) {
      // Re-create now; if the browser wants a gesture first, the capture listener resumes it.
      try { this.create(); } catch { /* */ }
      if (this.ctx && (this.ctx.state as string) !== 'running') this.resume(false);
      return;
    }
    if ((ctx.state as string) === 'running') {
      if (this.studio) this.studio.core.fadeMaster(1, 0.12);
      this.ensureTimers();
    } else this.resume(false);
  }

  onFocus(): void {
    if (this.hidden || this.paused) return;
    const ctx = this.ctx;
    if (ctx && (ctx.state as string) !== 'running' && ctx.state !== 'closed' && !this.idleSuspended) this.resume(false);
  }

  setPaused(paused: boolean): void {
    try {
      if (paused === this.paused) return;
      this.paused = paused;
      const ctx = this.ctx;
      if (!ctx || ctx.state === 'closed') return;
      if (paused) {
        this.stopTimers();
        if (this.studio) this.studio.core.fadeMaster(0, 0.03);
        setTimeout(() => {
          if (this.paused && this.ctx === ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined);
        }, 150);
      } else if (!this.hidden) {
        if ((ctx.state as string) === 'running') {
          if (this.studio) this.studio.core.fadeMaster(1, 0.15);
          this.ensureTimers();
        } else this.resume(false);
      }
    } catch {
      /* */
    }
  }

  isRunning(): boolean {
    return !!this.ctx && (this.ctx.state as string) === 'running';
  }

  // ------------------------------------------------------------------ clock & scheduler
  /** audioTime = performance.now()/1000 + offset, measured at the speaker when possible. */
  private syncClock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pn = perfNow();
    const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    const est = ctx.currentTime - pn / 1000 - lat;
    let raw = est;
    if (typeof ctx.getOutputTimestamp === 'function') {
      try {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.performanceTime && ts.contextTime && ts.performanceTime > 0) {
          const r = ts.contextTime - ts.performanceTime / 1000;
          if (Math.abs(r - est) < 0.25) raw = r;
        }
      } catch {
        /* */
      }
    }
    if (!this.clockInit || Math.abs(raw - this.clock.offset) > 0.05) {
      this.clock.offset = raw;
      this.clockInit = true;
    } else this.clock.offset += (raw - this.clock.offset) * 0.05;
  }

  private tick = (): void => {
    const ctx = this.ctx;
    const st = this.studio;
    if (!ctx || !st) return;
    if ((ctx.state as string) !== 'running') return;
    try {
      const pn = perfNow();
      // watchdog: "running" but the clock is frozen (seen after iOS backgrounding) → rebuild on next gesture
      if (ctx.currentTime === this.lastCt) {
        if (pn - this.lastCtPerf > 1500 && !this.hidden) {
          this.stale = true;
          this.resume(false);
        }
      } else {
        this.lastCt = ctx.currentTime;
        this.lastCtPerf = pn;
      }
      this.syncClock();
      st.pump(ctx.currentTime + LOOKAHEAD);
      const bank = this.bank;
      if (bank && bank.pending) bank.step(this.lowPower ? 3 : 5);
      this.idleCheck();
      this.ensureTimers();
    } catch {
      /* keep the timer alive */
    }
  };

  private idleCheck(): void {
    const ctx = this.ctx;
    const st = this.studio;
    if (!ctx || !st || this.grid) return;
    if (st.needsPump() || (this.bank && this.bank.pending)) return;
    if (ctx.currentTime > Math.max(st.core.busyUntil(), this.lastWake) + IDLE_SUSPEND_S) {
      this.idleSuspended = true;
      this.stopTimers();
      ctx.suspend().catch(() => undefined);
    }
  }

  private ensureTimers(): void {
    const ctx = this.ctx;
    const st = this.studio;
    if (!ctx || !st || this.hidden || this.paused || (ctx.state as string) !== 'running') {
      this.stopTimers();
      return;
    }
    const needFast = st.needsPump() || !!(this.bank && this.bank.pending);
    if (needFast) {
      if (this.slow) { clearInterval(this.slow); this.slow = null; }
      if (!this.fast) this.fast = setInterval(this.tick, TICK_MS);
    } else {
      if (this.fast) { clearInterval(this.fast); this.fast = null; }
      if (!this.slow) this.slow = setInterval(this.tick, 1000);
    }
  }

  private stopTimers(): void {
    if (this.fast) { clearInterval(this.fast); this.fast = null; }
    if (this.slow) { clearInterval(this.slow); this.slow = null; }
  }

  /** Wake from idle-suspend for a new sound. Returns the studio if sounds can be scheduled now. */
  private live(): Studio | null {
    const ctx = this.ctx;
    const st = this.studio;
    if (!ctx || !st || this.hidden || this.paused || ctx.state === 'closed') return null;
    const s = ctx.state as string;
    if (s !== 'running') {
      if (this.idleSuspended) {
        this.idleSuspended = false;
        this.resume(false);
      } else if (perfNow() - this.lastResumeAt > 600) {
        // waiting for a gesture (iOS interrupted etc.): don't queue sounds that would burst later
        return null;
      }
    }
    this.lastWake = ctx.currentTime;
    this.ensureTimers();
    return st;
  }

  // ------------------------------------------------------------------ API
  setVolumes(v: { sfx: number; music: number }): void {
    try {
      const n = (x: number): number => (typeof x === 'number' && x > 0 ? Math.min(1, x) : 0);
      this.vol = { sfx: n(v && v.sfx), music: n(v && v.music) };
      if (this.studio) {
        this.studio.setVolumes(this.vol.sfx, this.vol.music);
        if (this.vol.music > 0 && this.studio.needsPump()) this.live();
        this.ensureTimers();
      }
    } catch {
      /* */
    }
  }

  setMusic(mood: 'menu' | 'play' | 'none', chapter?: number): void {
    try {
      this.mood = mood === 'menu' || mood === 'play' ? mood : 'none';
      this.chapter = Math.max(0, Math.min(7, Math.floor(chapter || 0)));
      const st = this.studio;
      if (!st) return;
      if (this.mood !== 'none') this.live();
      st.setMusic(this.mood, this.chapter, st.core.now());
      this.ensureTimers();
    } catch {
      /* */
    }
  }

  beatStart(beatMs: number, firstBeatAt: number): void {
    try {
      this.grid = { beatMs, firstBeatAt };
      const st = this.live();
      if (!st) return;
      this.syncClock();
      st.beatStart(beatMs, firstBeatAt);
      this.ensureTimers();
    } catch {
      /* */
    }
  }

  beatStop(): void {
    try {
      this.grid = null;
      if (this.studio) this.studio.beatStop(this.studio.core.now());
    } catch {
      /* */
    }
  }

  beat(info: BeatInfo): void {
    if (!info || this.vol.sfx <= 0) {
      if (info && this.studio && this.studio.tension) this.studio.tension.progress = info.progress || 0;
      return;
    }
    this.fx((st, t) => st.beat(info, t));
  }

  private fx(f: (st: Studio, t: number) => void): void {
    try {
      if (this.vol.sfx <= 0) return;
      const st = this.live();
      if (!st) return;
      f(st, st.core.now());
    } catch {
      /* a sound must never break the game */
    }
  }

  uiTap(): void { this.fx((s, t) => s.sfx.uiTap(t)); }
  uiBack(): void { this.fx((s, t) => s.sfx.uiBack(t)); }
  popupOpen(): void { this.fx((s, t) => s.sfx.popupOpen(t)); }
  popupClose(): void { this.fx((s, t) => s.sfx.popupClose(t)); }
  toggle(on: boolean): void { this.fx((s, t) => s.sfx.toggle(!!on, t)); }
  drop(c: InkColor): void { this.fx((s, t) => s.sfx.drop(c, t)); }
  reject(): void { this.fx((s, t) => s.sfx.reject(t)); }
  rewind(): void { this.fx((s, t) => s.sfx.rewind(t)); }
  hint(): void { this.fx((s, t) => s.sfx.hint(t)); }
  targetMet(progress: number): void { this.fx((s, t) => s.sfx.targetMet(progress, t)); }
  wrong(): void { this.fx((s, t) => s.sfx.wrong(t)); }
  win(perfect: boolean): void { this.fx((s, t) => s.sfx.win(!!perfect, t)); }
  stamp(): void { this.fx((s, t) => s.sfx.stamp(t)); }
  coins(count: number): void { this.fx((s, t) => s.sfx.coins(count, t)); }
  reward(): void { this.fx((s, t) => s.sfx.reward(t)); }
  purchase(): void { this.fx((s, t) => s.sfx.purchase(t)); }
  chapterComplete(): void { this.fx((s, t) => s.sfx.chapterComplete(t)); }
  streak(): void { this.fx((s, t) => s.sfx.streak(t)); }
  unlock2(): void { this.fx((s, t) => s.sfx.unlock(t)); }

  debugInfo(): string {
    try {
      if (!ctor()) return 'audio: WebAudio unavailable';
      const ctx = this.ctx;
      if (!ctx) return `audio: not unlocked (mood=${this.mood} ch=${this.chapter})`;
      const st = this.studio;
      const b = this.bank;
      return [
        `audio: ${ctx.state}${this.stale ? ' (stale→rebuild on tap)' : ''}${this.idleSuspended ? ' (idle)' : ''}${this.hidden ? ' hidden' : ''}${this.paused ? ' paused' : ''}`,
        `sr=${ctx.sampleRate} t=${ctx.currentTime.toFixed(2)} ctx#${this.created}${this.lowPower ? ' lowPower' : ''}`,
        st ? st.describe() : '',
        `vol sfx=${this.vol.sfx.toFixed(2)} music=${this.vol.music.toFixed(2)}`,
        b ? `bank=${b.count} pending=${b.pending} synth=${Math.round(b.renderMs)}ms` : '',
        `clockOffset=${(this.clock.offset * 1000).toFixed(1)}ms`,
      ].filter(Boolean).join(' | ');
    } catch {
      return 'audio: error';
    }
  }
}

const engine = new Engine();
export const audio: AudioEngine = engine;

let installed = false;

/**
 * Installs page-lifecycle listeners: gesture unlock / resume (capturing), visibility, pagehide /
 * pageshow, focus. Call once at boot. Safe without WebAudio.
 */
export function initAudioLifecycle(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  try {
    // iOS 16.4+: behave like a game (mix with other audio, respect the silent switch).
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    /* */
  }
  try {
    const onGesture = (): void => engine.unlock();
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click']) window.addEventListener(ev, onGesture, opts);
    const eng = engine;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') eng.onHide();
      else eng.onShow();
    });
    window.addEventListener('pagehide', () => eng.onHide());
    window.addEventListener('pageshow', () => {
      if (document.visibilityState !== 'hidden') eng.onShow();
    });
    window.addEventListener('focus', () => eng.onFocus());
    if (document.visibilityState === 'hidden') eng.onHide();
  } catch {
    /* */
  }
}
