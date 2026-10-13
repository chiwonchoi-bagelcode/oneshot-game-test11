/*
 * Generative music: a director that walks a chapter's chord progression on an eighth-note step
 * clock, voicing pads/bass, writing short pentatonic phrases (with rests and call/response
 * repetition), sparse arpeggios and chapter ambience — plus the gameplay tension pulse that is
 * locked to the game's beat grid. All scheduling is look-ahead: pump(until) schedules every event
 * that starts before `until`.
 */
import type { Core, Pan } from './core.ts';
import { rng } from './dsp.ts';
import { deg, nearPc, placePc, type Chord, type Palette } from './theory.ts';

export type Mood = 'menu' | 'play' | 'none';

interface Note {
  pos: number;
  len: number;
  midi: number;
}

interface Phrase {
  rhythm: number[][];
  degs: number[];
  inst: string;
  notes: Note[];
  pan: Pan;
}

/** Two-bar rhythm cells: [step, lengthInSteps] (eighth notes). */
const RHY: number[][][] = [
  [[0, 3], [3, 1], [4, 4]],
  [[0, 2], [2, 2], [4, 2], [6, 6]],
  [[2, 2], [4, 1], [5, 3], [8, 6]],
  [[0, 4], [6, 2], [8, 8]],
  [[0, 1], [1, 1], [2, 2], [4, 4], [10, 2], [12, 4]],
  [[4, 2], [6, 2], [8, 4], [12, 4]],
  [[0, 6], [6, 2], [8, 8]],
  [[0, 2], [3, 1], [4, 2], [6, 2], [8, 3], [11, 5]],
  [[2, 1], [3, 1], [4, 4], [10, 6]],
  [[0, 3], [3, 3], [6, 2], [12, 4]],
];
const WALK = [-2, -1, -1, -1, 0, 1, 1, 1, 2, -3, 3];

/** Music mix (linear gains on loudness-normalised instruments). Calibrated with the offline harness. */
export const MIX = { pad: 0.106, bass: 0.079, lead: 0.126, arp: 0.139, amb: 1.26 };
const LEAD_GAIN: Record<string, number> = { piano: 1, kalimba: 0.9, flute: 0.8, bell: 0.75, gayageum: 1, marimba: 0.95 };
const ARP_GAIN: Record<string, number> = { kalimba: 0.9, marimba: 1, gayageum: 1 };

export interface Grid {
  beatMs: number;
  firstBeatAt: number; // performance.now() domain
}

export class Director {
  readonly pal: Palette;
  readonly mood: Mood;
  readonly gid: string;
  private r: () => number;
  private step = 0;
  private nextT: number;
  private stepDur: number;
  private grid: Grid | null = null;
  private halfIdx = 0;
  private chordIdx = -1;
  private useAlt = false;
  chord: Chord;
  private phrase: Phrase | null = null;
  private lastPhrase: Phrase | null = null;
  private leadIdx = 0;
  private arpIdx = 0;
  private lv: { pad: number; bass: number; lead: number; arp: number; amb: number };
  private rests = 0;
  private bars = 0;
  /** MIDI notes scheduled (for the harness / debug). */
  readonly log: number[] = [];
  logEnabled = false;

  constructor(private core: Core, pal: Palette, mood: Mood, t: number, seed: number, gid: string) {
    this.pal = pal;
    this.mood = mood;
    this.gid = gid;
    this.r = rng(seed);
    this.nextT = t;
    this.stepDur = (pal.beatMs / 1000) / 2;
    // the gameplay bed sits lower and thinner than the menu music (room for SFX)
    this.lv = mood === 'menu' ? { pad: 1, bass: 1, lead: 1, arp: 1, amb: 1 } : { pad: 0.8, bass: 0.8, lead: 0.9, arp: 0.9, amb: 0.9 };
    this.chord = pal.prog[0];
  }

  get tempoMs(): number {
    return this.stepDur * 2000;
  }

  get chordNumber(): number {
    return this.chordIdx;
  }

  /** Follow the gameplay beat grid (play mood only). */
  lock(grid: Grid | null): void {
    const c = this.core;
    if (grid) {
      this.grid = grid;
      this.stepDur = grid.beatMs / 2000;
      const halfMs = grid.beatMs / 2;
      const want = Math.max(this.nextT - this.stepDur * 0.4, c.now() + 0.03);
      this.halfIdx = Math.ceil((c.audioToPerf(want) - grid.firstBeatAt) / halfMs);
      this.nextT = c.perfToAudio(grid.firstBeatAt + this.halfIdx * halfMs);
    } else if (this.grid) {
      this.grid = null; // keep the last tempo, continue free-running
    }
  }

  private advance(): void {
    this.step++;
    if (this.grid) {
      this.halfIdx++;
      this.nextT = this.core.perfToAudio(this.grid.firstBeatAt + this.halfIdx * (this.grid.beatMs / 2));
    } else this.nextT += this.stepDur;
  }

  pump(until: number): void {
    const now = this.core.now();
    if (this.grid) this.nextT = this.core.perfToAudio(this.grid.firstBeatAt + this.halfIdx * (this.grid.beatMs / 2));
    // after a stall (suspend, throttled timers) skip missed steps instead of bunching them up
    if (this.nextT < now - 0.05) {
      const miss = Math.ceil((now - this.nextT) / this.stepDur);
      this.phrase = null;
      this.step += miss;
      if (this.grid) {
        this.halfIdx += miss;
        this.nextT = this.core.perfToAudio(this.grid.firstBeatAt + this.halfIdx * (this.grid.beatMs / 2));
      } else this.nextT += miss * this.stepDur;
    }
    let guard = 0;
    while (this.nextT < until && guard++ < 64) {
      this.doStep(this.nextT);
      this.advance();
    }
  }

  stop(t: number): void {
    this.core.releasePrefix(this.gid, t, 0.3);
  }

  private doStep(t: number): void {
    const pos = this.step % 16;
    if (pos === 0) this.nextChord(t);
    const p = this.pal;
    let leadHit = false;
    if (this.phrase) {
      for (const n of this.phrase.notes) if (n.pos === pos) {
        this.playLead(n, t);
        leadHit = true;
      }
    }
    if (p.arp && p.arpPat.indexOf(pos) >= 0) {
      const dens = p.arpDensity * (this.mood === 'menu' ? 0.85 : 1);
      if (this.r() < dens && !(leadHit && this.r() < 0.6)) this.playArp(t);
    }
    if (pos === 8 && p.bass8 && this.r() < 0.7) {
      const b = placePc(p, this.chord.b, 36);
      this.core.play('sub', b, t, {
        gain: MIX.bass * 0.6 * this.lv.bass, bus: 'music', group: this.gid + 'b', sustain: true,
        attack: 0.2, hold: this.stepDur * 8 + 0.2, rel: 0.2,
      });
    }
  }

  private nextChord(t: number): void {
    const p = this.pal;
    const c = this.core;
    this.chordIdx = (this.chordIdx + 1) % p.prog.length;
    if (this.chordIdx === 0) this.useAlt = this.bars > 0 && this.r() < 0.35;
    this.bars++;
    this.chord = (this.useAlt ? p.alt : p.prog)[this.chordIdx];
    const ch = this.chord;

    // pad: 3 tones in close position around the centre, crossfading from the previous chord
    const chordDur = this.stepDur * 16;
    c.release(this.gid + 'p', t + 0.3, 0.5);
    const tones = this.r() < 0.5 ? [ch.t[0], ch.t[1], ch.t[2]] : [ch.t[0], ch.t[1], ch.t[3] != null ? ch.t[3] : ch.t[2]];
    const centre = 62 + (this.bars % 3) - 1;
    const pans: Pan[] = [-1, 1, 0];
    const pg = MIX.pad * p.padGain * this.lv.pad;
    tones.forEach((pc, i) => {
      const m = nearPc(p, pc, centre);
      c.play(p.pad, m, t, {
        gain: pg * (i === 2 ? 0.8 : 1), pan: pans[i], wet: 1, bus: 'music', group: this.gid + 'p', sustain: true,
        attack: 1.4, hold: chordDur * 1.2 + 0.3, rel: 0.5,
      });
      this.rec(m);
    });
    // bass
    c.release(this.gid + 'b', t, 0.12);
    const b = placePc(p, ch.b, 36);
    c.play('sub', b, t, {
      gain: MIX.bass * this.lv.bass, bus: 'music', group: this.gid + 'b', sustain: true,
      attack: 0.25, hold: p.bass8 ? this.stepDur * 8 - 0.05 : chordDur * 1.1, rel: 0.2,
    });
    this.rec(b);

    // new phrase for these two bars
    this.phrase = this.genPhrase();

    // ambience
    this.ambient(t);
  }

  private rec(m: number): void {
    if (this.logEnabled && this.log.length < 20000) this.log.push(m);
  }

  private chordPcs(): number[] {
    const s = this.chord.t.map((x) => ((x % 12) + 12) % 12);
    s.push(((this.chord.b % 12) + 12) % 12);
    return s;
  }

  private isChordTone(midi: number): boolean {
    const pc = (((midi - this.pal.key) % 12) + 12) % 12;
    return this.chordPcs().indexOf(pc) >= 0;
  }

  private genPhrase(): Phrase | null {
    const p = this.pal;
    const r = this.r;
    const rest = p.rest + (this.mood === 'play' ? 0.05 : 0);
    if (this.chordIdx === 0 && this.bars <= 1) {
      // let the first chord breathe
      this.lastPhrase = null;
      return null;
    }
    // rests give the music air, but never more than two phrases in a row
    if (this.rests < 2 && r() < rest) {
      this.rests++;
      return null;
    }
    this.rests = 0;
    const prev = this.lastPhrase;
    const n5 = p.penta.length;
    // degree whose note is nearest the lead register centre
    let dMid = 0;
    while (deg(p, dMid) < p.leadMid - 2) dMid++;
    while (deg(p, dMid) > p.leadMid + 2) dMid--;
    let rhythm: number[][];
    let degs: number[];
    if (prev && r() < 0.42) {
      // call & response: same rhythm, contour shifted by a step
      rhythm = prev.rhythm;
      const sh = r() < 0.5 ? -1 : 1;
      degs = prev.degs.map((d) => d + sh);
    } else {
      rhythm = RHY[Math.floor(r() * RHY.length)];
      degs = [];
      let d = dMid + Math.floor(r() * 5) - 2;
      for (let i = 0; i < rhythm.length; i++) {
        if (i > 0) d += WALK[Math.floor(r() * WALK.length)];
        if (d < dMid - n5) d += 2;
        if (d > dMid + n5 + 1) d -= 2;
        degs.push(d);
      }
    }
    // land the last (longest) note on a chord tone
    const last = degs.length - 1;
    for (let k = 0; k < 3 && !this.isChordTone(deg(p, degs[last])); k++) degs[last] += k % 2 ? -k - 1 : k + 1;
    const inst = p.lead[this.leadIdx++ % p.lead.length];
    const notes: Note[] = rhythm.map(([pos, len], i) => ({ pos, len, midi: deg(p, degs[i]) }));
    const pans: Pan[] = [0, -1, 1];
    const ph: Phrase = { rhythm, degs, inst, notes, pan: pans[Math.floor(r() * 3)] };
    this.lastPhrase = ph;
    return ph;
  }

  private playLead(n: Note, t: number): void {
    const p = this.pal;
    const inst = (this.phrase as Phrase).inst;
    const base = MIX.lead * (LEAD_GAIN[inst] || 1);
    const accent = n.pos % 4 === 0 ? 1 : 0.85;
    const g = base * this.lv.lead * accent * (0.9 + this.r() * 0.2);
    const len = n.len * this.stepDur;
    const o: Parameters<Core['play']>[3] = {
      gain: g, pan: (this.phrase as Phrase).pan, wet: 1, bus: 'music', group: this.gid + 'l',
    };
    if (inst === 'flute') o.maxDur = Math.max(0.45, Math.min(2.1, len + 0.25));
    else if (inst === 'piano') o.maxDur = Math.min(2.6, len + 1.4);
    else if (inst === 'bell') o.maxDur = 3;
    else o.maxDur = Math.min(1.8, len + 1);
    if (p.bend && inst === 'gayageum') {
      if (n.len >= 3) o.vib = 0.35;
      if (this.r() < 0.25) o.slide = 2;
    }
    const jitter = this.r() * 0.008;
    this.core.play(inst, n.midi, t + jitter, o);
    this.rec(n.midi);
  }

  private playArp(t: number): void {
    const p = this.pal;
    const inst = p.arp as string;
    const pcs = this.chord.t;
    const lo = p.key + 7;
    const notes = pcs.map((pc) => placePc(p, pc, lo)).sort((a, b) => a - b);
    const i = this.arpIdx++ % (notes.length + 1);
    const m = i === notes.length ? notes[0] + 12 : notes[i];
    const g = MIX.arp * (ARP_GAIN[inst] || 1) * this.lv.arp * (0.85 + this.r() * 0.3);
    this.core.play(inst, m, t + this.r() * 0.006, {
      gain: g, pan: this.arpIdx % 2 ? -1 : 1, wet: 1, bus: 'music', group: this.gid + 'a', maxDur: 1.3,
    });
    this.rec(m);
  }

  private ambient(t: number): void {
    const p = this.pal;
    const c = this.core;
    const r = this.r;
    const span = this.stepDur * 16;
    const at = t + r() * span * 0.7;
    const L = this.lv.amb * MIX.amb;
    const grp = this.gid + 'x';
    const rp = (): Pan => ((Math.floor(r() * 3) - 1) as Pan);
    switch (p.amb) {
      case 'drip': {
        if (r() < 0.6) {
          const n = 1 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) c.play('plip', deg(p, 7 + Math.floor(r() * 5)), at + i * (0.18 + r() * 0.4), { gain: 0.06 * L, pan: rp(), wet: 1, bus: 'music', group: grp });
        }
        break;
      }
      case 'clink': {
        if (r() < 0.35) c.play('bell', deg(p, 10 + Math.floor(r() * 4)), at, { gain: 0.03 * L, pan: rp(), wet: 1, bus: 'music', group: grp, maxDur: 1.2 });
        break;
      }
      case 'bamboo': {
        if (r() < 0.5) {
          const n = 2 + Math.floor(r() * 3);
          let x = at;
          for (let i = 0; i < n; i++) {
            c.play('tok', 0, x, { gain: 0.05 * L * (1 - i * 0.15), rate: 0.85 + r() * 0.6, pan: rp(), wet: 1, bus: 'music', group: grp });
            x += 0.09 + r() * 0.22;
          }
        }
        break;
      }
      case 'wind': {
        if (r() < 0.45) c.play('air', 0, at, { gain: 0.035 * L, rate: 0.85 + r() * 0.3, pan: rp(), wet: 1, bus: 'music', group: grp });
        break;
      }
      case 'waves': {
        if (r() < 0.55) c.play('air', 0, at, { gain: 0.07 * L, rate: 0.45 + r() * 0.1, pan: rp(), wet: 0, bus: 'music', group: grp });
        break;
      }
      case 'lantern': {
        if (r() < 0.4) {
          const d = 8 + Math.floor(r() * 4);
          c.play('bell', deg(p, d), at, { gain: 0.026 * L, pan: rp(), wet: 1, bus: 'music', group: grp, maxDur: 1.6 });
          c.play('bell', deg(p, d + 2), at + 0.16, { gain: 0.019 * L, pan: rp(), wet: 1, bus: 'music', group: grp, maxDur: 1.6 });
        }
        break;
      }
      case 'leaves': {
        if (r() < 0.45) {
          const n = 1 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) c.play('brush', 0, at + i * (0.25 + r() * 0.5), { gain: 0.05 * L, rate: 0.7 + r() * 0.5, pan: rp(), wet: 1, bus: 'music', group: grp });
        }
        break;
      }
      case 'twinkle': {
        if (r() < 0.45) {
          const n = 2 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) c.play('bell', deg(p, 11 + Math.floor(r() * 5)), at + i * (0.12 + r() * 0.25), { gain: 0.028 * L, pan: rp(), wet: 1, bus: 'music', group: grp, maxDur: 1.8 });
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Soft pulse locked to the gameplay beat grid (music bus). */
export class Tension {
  progress = 0;
  private k = 0;
  private k0 = 0;
  constructor(private core: Core, public grid: Grid) {
    const c = core;
    this.k = Math.max(0, Math.ceil((c.audioToPerf(c.now() + 0.02) - grid.firstBeatAt) / grid.beatMs));
    this.k0 = this.k;
  }

  pump(until: number): void {
    const c = this.core;
    const now = c.now();
    const g = this.grid;
    if (c.perfToAudio(g.firstBeatAt + this.k * g.beatMs) < now - 0.05) {
      this.k = Math.max(this.k, Math.ceil((c.audioToPerf(now) - g.firstBeatAt) / g.beatMs));
    }
    let guard = 0;
    for (;;) {
      const tk = c.perfToAudio(this.grid.firstBeatAt + this.k * this.grid.beatMs);
      if (tk >= until || guard++ > 32) break;
      if (tk >= now - 0.01) this.hit(this.k, tk);
      this.k++;
    }
  }

  private hit(k: number, t: number): void {
    const c = this.core;
    const p = this.progress;
    const inten = 0.35 + 0.65 * p;
    const fadeIn = Math.min(1, (k - this.k0 + 1) / 3);
    const acc = k % 4 === 0;
    const half = this.grid.beatMs / 2000;
    const jit = 0.92 + ((k * 7919) % 17) / 100;
    // every 8th pulse swaps the woodblock for a hollow tok — keeps a long session from feeling mechanical
    if (k % 8 === 7) c.play('tok', 0, t, { gain: 0.1 * (0.75 + 0.25 * inten) * fadeIn, rate: 1.2, bus: 'music', group: 'tension' });
    else c.play('woodLo', 0, t, { gain: (acc ? 0.17 : 0.115) * (0.75 + 0.25 * inten) * fadeIn * jit, rate: acc ? 1 : 0.94, bus: 'music', group: 'tension' });
    if (k % 16 === 15) c.play('brush', 0, t + half, { gain: 0.05 * fadeIn, rate: 1.1, pan: 1, bus: 'music', group: 'tension' });
    c.play(k % 2 ? 'shakerA' : 'shakerB', 0, t + half, { gain: (0.045 + 0.05 * inten) * fadeIn, pan: k % 2 ? -1 : 1, bus: 'music', group: 'tension' });
    if (inten > 0.72) c.play(k % 2 ? 'shakerB' : 'shakerA', 0, t + half * 1.5, { gain: 0.025 * fadeIn, pan: k % 2 ? 1 : -1, bus: 'music', group: 'tension' });
    if (p >= 0.5 && acc) c.play('thud', 0, t, { gain: (0.08 + 0.12 * p) * fadeIn, rate: 0.9, bus: 'music', group: 'tension' });
  }
}
