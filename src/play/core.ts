/*
 * A "core" is the rule set + input handling of one puzzle style. The play screen (shell) owns
 * everything around it: layout, title, boosters bar, intro cards, pause, fail/result sheets,
 * rewards and progress. Cores only talk to the shell through CoreHost.
 *
 * Cores in this project:
 *   timing   – the original beat-driven spreading (also variants D and E with options)
 *   spatial  – variant A: order/time independent spreading
 *   path     – variant B: drawing ink paths
 *   paint    – variant C: colouring-book regions
 */
import type { LevelDef, ParsedLevel } from '../core/sim.ts';
import type { BoardRenderer } from '../render/board.ts';
import type { IconName } from '../ui/icons.ts';

export interface LevelCtx {
  mode: 'campaign' | 'daily';
  def: LevelDef;
  L: ParsedLevel;
  /** Campaign: global index; daily: tier. */
  index: number;
  chapter: number;
  /** 1-based level number shown to the player (0 for daily). */
  number: number;
  /** Tutorial level (the core decides what guidance it shows). */
  guided: boolean;
}

/** Extra booster buttons a core can ask for (the shell always adds Restart on the left). */
export type BoosterId = 'undo' | 'hint';

export interface BoosterSpec {
  id: BoosterId;
  icon: IconName;
  /** i18n key of the label under the button. */
  label: string;
  /** Item it consumes (count badge shown from the wallet). */
  item?: 'hints' | 'rewinds';
}

export interface FailInfo {
  /** Cells to highlight (already highlighted by the core is fine too). */
  cells: number[];
  /** Main line (translated). */
  text: string;
  /** Tip line (translated). */
  tip?: string;
}

export interface CoreHost {
  readonly renderer: BoardRenderer;
  /** Board area (position: relative) for overlays such as pointers. */
  readonly boardWrap: HTMLElement;
  /** Row above the board for a status widget (e.g. the beat ring). Emptied on every level start. */
  readonly status: HTMLElement;
  /** Area under the board for the core's tray (ink queue, palette...). Emptied on every level start. */
  readonly tray: HTMLElement;
  /** The play screen root, for core-specific overlays (e.g. a resume bar). */
  readonly root: HTMLElement;
  readonly ctx: LevelCtx | null;
  /** Short coach message over the status row. */
  say(text: string, ms?: number): void;
  hush(): void;
  /** Request animation frames. */
  kick(): void;
  /** Level solved. The core should have stopped its own clock. */
  win(): void;
  /** Attempt failed: highlight + fail sheet (Retry plus the core's failActions). */
  fail(info: FailInfo): void;
  /** The current attempt can no longer earn a seal (hint, undo...). */
  taint(): void;
  /** The player did something: restarting from now on counts as a retry. */
  touched(): void;
  updateBoosters(): void;
  /** Tutorial / hint pointer: hand + bubble over a cell. idx null hides it. */
  point(idx: number | null, text?: string, opts?: { hand?: boolean; now?: boolean }): void;
  /** Spend one item, running the buy / watch-ad flow when out. Resolves true if one was spent. */
  spendItem(kind: 'hints' | 'rewinds'): Promise<boolean>;
  /** Hint already bought for this level (showing it again is free). */
  isHinted(): boolean;
  setHinted(): void;
  /** Restart the attempt from the shell (closes sheets, resets the board). */
  resetAttempt(): void;
  /** Close the fail sheet after an undo/rewind and let play continue. */
  unfail(): void;
  isVisible(): boolean;
}

export interface Core {
  /** Booster buttons after Restart, left to right. */
  readonly boosters: BoosterSpec[];
  /** Side actions in the fail sheet (around the big Retry button). */
  readonly failActions: BoosterId[];
  /** New level or replay: build state for host.ctx. */
  start(): void;
  /** Restart the attempt. */
  reset(): void;
  pointerDown(idx: number, x: number, y: number, now: number): void;
  pointerMove?(idx: number, x: number, y: number, now: number): void;
  pointerUp?(idx: number, x: number, y: number, now: number): void;
  /** Called every animation frame before the board is drawn. Return true to keep frames coming at full rate. */
  frame(now: number): boolean;
  booster(id: BoosterId): void;
  boosterEnabled(id: BoosterId): boolean;
  /** Badge text override for a booster ('' hides the badge), or null for the default wallet count. */
  boosterCount?(id: BoosterId): string | null;
  /** Pause / resume any clock (pause menu, app in background, leaving). */
  pause(): void;
  resume(): void;
  /** True while a clock is running (the shell auto-pauses when the app goes to background). */
  isRunning(): boolean;
  /** True once the attempt ended (won or failed) — the shell blocks input. */
  isOver(): boolean;
  /** Skin or settings changed. */
  refresh?(): void;
  readonly debug: {
    autoplay(on: boolean): void;
    state(): any;
    solveNow(): void;
    info(): any;
    setTimeScale?(k: number): void;
  };
}

export type CoreFactory = (host: CoreHost) => Core;

/** Ink droplet chip used by trays (queue, palette). */
export const DROP_PATH = 'M20 2C20 2 5 18.5 5 28.5a15 15 0 0 0 30 0C35 18.5 20 2 20 2z';

export function dropChipSVG(fill: string): string {
  return `<svg class="dropshape" viewBox="0 0 40 46"><path d="${DROP_PATH}" transform="translate(0 2)" fill="${fill}" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/><path d="M13 27a7 7 0 0 1 4-7" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
}
