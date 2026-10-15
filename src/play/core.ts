/*
 * Play-screen plug-in interface.
 *
 * The play screen (src/screens/play.ts) is a shell: top bar, coach line, beat pill, board canvas,
 * ink tray area, booster buttons, pause, result/fail sheets, intro cards and the whole reward flow.
 * A *core* owns the rules of one version of the game: its board state, input, clock (if any),
 * hint and undo behaviour, and decides when the level is won or lost.
 */
import type { BoardRenderer } from '../render/board.ts';
import type { LevelDef, ParsedLevel } from '../core/sim.ts';

export interface LevelCtx {
  mode: 'campaign' | 'daily';
  def: LevelDef;
  L: ParsedLevel;
  /** Campaign: global index; daily: tier. */
  index: number;
  chapter: number;
  /** 1-based stage number (0 for dailies). */
  number: number;
  /** Tutorial level: the core shows its solution step by step for free. */
  guided: boolean;
}

/** Hand pointer + speech bubble anchored to a cell. */
export interface GuideSpec {
  idx: number;
  text: string;
  /** Show the pointing hand (not just the bubble). */
  hand: boolean;
  /** Emphasise the bubble ("Now!"). */
  now?: boolean;
  /** Animate the hand along these cells (drag tutorials). */
  path?: number[];
}

export interface BeatInfo {
  tick: number;
  /** 0..1 progress inside the current beat. */
  frac: number;
  running: boolean;
  idle: boolean;
}

export interface CoreHost {
  readonly renderer: BoardRenderer;
  /** The play screen element (cores may add their own overlays, e.g. a resume bar). */
  readonly screen: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly boardWrap: HTMLElement;
  /** The tray area under the board; the core renders its own tray (ink queue, palette, wells…). */
  readonly tray: HTMLElement;
  ctx(): LevelCtx;
  say(text: string, ms?: number): void;
  hush(): void;
  /** Request animation frames until frame() reports nothing is moving. */
  kick(): void;
  guide(g: GuideSpec | null): void;
  /** Beat pill state; null hides the pill (cores without a clock). */
  beat(info: BeatInfo | null): void;
  pulseBeat(): void;
  /** The player made a move in this attempt (restarting now counts as a retry). */
  dirty(): void;
  /** The attempt no longer earns a seal (hint, undo, rewind…). */
  voidSeal(): void;
  /** Level complete: the shell plays the win animation and shows results. */
  win(): void;
  /** Level failed: highlight cells and open the fail sheet with this reason and tip. */
  fail(cells: number[], main: string, tip: string): void;
  refreshBoosters(): void;
  /** Debug speed-up for automated runs (1 = normal). */
  timeScale(): number;
}

export interface CoreBoosters {
  /** 'rewind' = paid item that steps back one drop; 'undo' = free step back. null = none. */
  undo: null | 'rewind' | 'undo';
  /** Paid hint (reveals the solution for this level). */
  hint: boolean;
}

export interface Core {
  readonly boosters: CoreBoosters;
  /** Start a fresh attempt of host.ctx() (new level, restart, replay). */
  start(): void;
  /** Per animation frame. Returns true while the core needs more frames (clock running, animating). */
  frame(now: number): boolean;
  down(idx: number, x: number, y: number, now: number): void;
  move(idx: number, x: number, y: number, now: number): void;
  up(idx: number, x: number, y: number, now: number): void;
  canUndo(): boolean;
  /** Step back (the shell has already charged a rewind if the core's undo is paid). */
  undo(): void;
  /** True while the hint is being shown and still valid. */
  hintShowing(): boolean;
  /** Show the hint (the shell has already charged it or it was bought earlier). quiet = no coach line (re-showing on level start). */
  showHint(quiet?: boolean): void;
  /** Stop the clock (pause menu, app in background, leaving). */
  pause(): void;
  resume(now: number): void;
  /** Ignore board input (won/decided/animating). */
  locked(): boolean;
  /** Board/tray needs re-layout (resize, skin change, symbols toggled). */
  relayout(): void;
  /** Debug/E2E: play the stored solution like a player would. */
  autoplay(now: number): void;
  /** Debug: jump to the solved state. */
  solveNow(): void;
  /** Debug/E2E: a short description of the current state ('phase' is required). */
  state(): Record<string, unknown> & { phase: string };
}

export type CoreFactory = (host: CoreHost) => Core;
