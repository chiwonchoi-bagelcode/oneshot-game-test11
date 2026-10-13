/*
 * Studio = everything that lives on one (Offline)AudioContext: graph (Core), music director,
 * tension pulse and SFX. The live engine (index.ts) owns lifecycle and timers and drives a Studio;
 * the offline test harness drives one directly with a virtual clock.
 */
import { Bank } from './bank.ts';
import { Core, type Clock } from './core.ts';
import { Director, Tension, type Grid, type Mood } from './music.ts';
import { Sfx, type BeatInfo } from './sfx.ts';
import { MENU, chapterPalette, type Chord, type Palette } from './theory.ts';

export interface StudioOptions {
  lowPower?: boolean;
  clock?: Clock;
  seed?: number;
}

/** Instruments every SFX may need right away — rendered first. */
export const ESSENTIALS = ['marimba', 'woodHi', 'kalimba', 'plip', 'swish', 'swishDown', 'tok', 'bell', 'coin'];

export function paletteInstruments(p: Palette): string[] {
  const s = [p.pad, 'sub', p.pluck, ...p.lead];
  if (p.arp) s.push(p.arp);
  if (p.amb === 'wind' || p.amb === 'waves') s.push('air');
  if (p.amb === 'leaves') s.push('brush');
  s.push('woodLo', 'shakerA', 'shakerB', 'thud');
  return s;
}

export class Studio {
  readonly core: Core;
  readonly sfx: Sfx;
  dir: Director | null = null;
  tension: Tension | null = null;
  mood: Mood = 'none';
  chapter = 0;
  grid: Grid | null = null;
  private lastPal: Palette = MENU;
  private seed: number;
  private gen = 0;
  logNotes = false;

  constructor(ctx: BaseAudioContext, bank: Bank, opts: StudioOptions = {}) {
    this.core = new Core(ctx, bank, { lowPower: opts.lowPower, clock: opts.clock });
    this.seed = opts.seed != null ? opts.seed : (Date.now() ^ 0x5bd1e995) >>> 0;
    this.sfx = new Sfx(this.core, { pal: () => this.pal(), chord: () => this.chord() }, this.seed + 17);
  }

  pal(): Palette {
    return this.dir ? this.dir.pal : this.lastPal;
  }

  chord(): Chord {
    return this.dir ? this.dir.chord : this.lastPal.prog[0];
  }

  setVolumes(sfx: number, music: number): void {
    this.core.setBusLevel('sfx', clamp01(sfx));
    this.core.setBusLevel('music', clamp01(music));
  }

  setMusic(mood: Mood, chapter: number | undefined, t: number): void {
    const ch = Math.max(0, Math.min(7, Math.floor(chapter || 0)));
    if (mood === this.mood && (mood !== 'play' || ch === this.chapter) && (mood === 'none' || this.dir)) return;
    if (this.dir) {
      this.dir.stop(t);
      this.dir = null;
    }
    this.mood = mood;
    this.chapter = ch;
    if (mood === 'none') return;
    const pal = mood === 'menu' ? MENU : chapterPalette(ch);
    this.lastPal = pal;
    this.core.bank.prefetch(paletteInstruments(pal));
    const d = new Director(this.core, pal, mood, t + 0.06, (this.seed + 101 * ++this.gen) >>> 0, 'm' + this.gen + ':');
    d.logEnabled = this.logNotes;
    if (mood === 'play' && this.grid) d.lock(this.grid);
    this.dir = d;
  }

  /** Grid in the performance.now() domain (mapped through core.clock). */
  beatStart(beatMs: number, firstBeatAt: number): void {
    const ms = Math.max(150, Math.min(3000, beatMs || 640));
    this.grid = { beatMs: ms, firstBeatAt };
    const prog = this.tension ? this.tension.progress : 0;
    if (this.tension) this.core.cancelFuture('tension', this.core.now());
    this.tension = new Tension(this.core, this.grid);
    this.tension.progress = prog;
    if (this.dir && this.dir.mood === 'play') this.dir.lock(this.grid);
  }

  beatStop(t: number): void {
    this.grid = null;
    if (this.tension) {
      this.tension = null;
      this.core.release('tension', t, 0.04);
    }
    if (this.dir) this.dir.lock(null);
  }

  beat(info: BeatInfo, t: number): void {
    if (this.tension) this.tension.progress = clamp01(info.progress || 0);
    this.sfx.beat(info, t);
  }

  /** Something still needs the look-ahead scheduler. */
  needsPump(): boolean {
    return (!!this.dir || !!this.tension) && this.core.busLevel('music') > 0;
  }

  pump(until: number): void {
    if (this.core.busLevel('music') <= 0) return;
    if (this.dir) this.dir.pump(until);
    if (this.tension) this.tension.pump(until);
  }

  describe(): string {
    const p = this.pal();
    const d = this.dir;
    const parts = [
      `mood=${this.mood}${this.mood === 'play' ? ' ch' + this.chapter : ''}`,
      `palette="${p.name}"`,
      d ? `chord=${d.chordNumber + 1}/${p.prog.length} tempo=${Math.round(d.tempoMs)}ms` : 'director=off',
      this.grid ? `grid=${Math.round(this.grid.beatMs)}ms tension=${this.tension ? Math.round(this.tension.progress * 100) + '%' : 'off'}` : 'grid=off',
      `voices=${this.core.activeVoices}/${this.core.maxVoices}`,
    ];
    return parts.join(' ');
  }

  dispose(): void {
    this.core.dispose();
  }
}

function clamp01(x: number): number {
  return !(x > 0) ? 0 : x > 1 ? 1 : x;
}
