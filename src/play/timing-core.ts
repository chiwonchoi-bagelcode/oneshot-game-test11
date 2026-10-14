/*
 * Timing core: the original beat-driven rules (also variants D and E through options).
 *
 * Timing model (keeps failures about judgement, not reflexes):
 *  - The clock doesn't run until the first drop. Drops made in quick succession before the first
 *    beat all count as beat 0 (each drop restarts the count-in).
 *  - A tap up to graceMs after a beat still counts for the previous beat (touch latency).
 *  - A cell that breaks the goal is shown immediately (with the exact reason), and Retry is one tap.
 *
 * Options (variant config):
 *  - spots: only the level's spots take ink; spot k holds ink k and may be used in any order.
 *  - firstMarker: the first drop's cell is shown and is the only cell open until the first drop.
 */
import { Sim, isPrimary, WHITE, type SimEvent } from '../core/sim.ts';
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
import { V } from '../variants/index.ts';
import { dropChipSVG, type Core, type CoreHost, type BoosterId } from './core.ts';

type Phase = 'idle' | 'prestart' | 'running' | 'frozen' | 'rewound' | 'paused' | 'won' | 'lost';
type FailKind = 'needMix' | 'noMix' | 'otherFirst' | 'otherMix' | 'white' | 'mud' | 'unreached';

export function createTimingCore(host: CoreHost): Core {
  const opt = V.timing || {};
  const BEAT_MS = opt.beatMs ?? TEMPO.beatMs;
  const TUTORIAL_BEAT_MS = opt.tutorialBeatMs ?? TEMPO.tutorialBeatMs;
  const TUTORIAL_UP_TO = opt.tutorialUpTo ?? 20;
  const GRACE_MS = opt.graceMs ?? TEMPO.graceMs;
  const renderer = host.renderer;

  // ---------- Beat widget (status row) ----------
  const ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const beatNum = h('div.num', { text: '0' });
  const beatLbl = h('span.lbl', { text: t('play.beat') });
  const beatEl = h('div.beat.idle', { html: `<svg class="ring" viewBox="0 0 34 34"><circle class="ring-bg" cx="17" cy="17" r="14"/></svg>` }, beatNum, beatLbl);
  ringFg.setAttribute('class', 'ring-fg');
  ringFg.setAttribute('cx', '17');
  ringFg.setAttribute('cy', '17');
  ringFg.setAttribute('r', '14');
  const RING_LEN = 2 * Math.PI * 14;
  ringFg.setAttribute('stroke-dasharray', String(RING_LEN));
  ringFg.setAttribute('stroke-dashoffset', String(RING_LEN));
  beatEl.querySelector('svg')!.appendChild(ringFg);

  // ---------- Resume bar (after a rewind) ----------
  const resumeText = h('div.grow', { text: t('play.resumeTap') });
  const resumeBar = h('div.resume-bar', null, resumeText, button(t('play.resume'), () => resumeFromRewind(), { variant: 'jade', size: 'sm', icon: icon('play') }));
  host.root.appendChild(resumeBar);

  onLangChange(() => {
    beatLbl.textContent = t('play.beat');
    resumeText.textContent = t('play.resumeTap');
  });

  // ---------- State ----------
  let sim: Sim | null = null;
  let phase: Phase = 'idle';
  let pausedFrom: Phase = 'idle';
  let beatMs = BEAT_MS;
  let nextBeatAt = 0;
  let lastStepAt = -1e9;
  let preStep: Sim | null = null;
  let lastEvents: SimEvent[] = [];
  let rewindStack: Sim[] = [];
  let hintOn = false;
  let hintBroken = false;
  let decided: 'win' | null = null;
  let fastForward = false;
  let pendingFail: { at: number; cells: number[] } | null = null;
  let met = new Set<number>();
  let timeScale = 1;
  let autoplay = false;

  const ctx = () => host.ctx!;

  function computeBeatMs(): number {
    const c = ctx();
    const base = c.def.tempo ?? (c.mode === 'campaign' && c.chapter === 0 && c.number <= TUTORIAL_UP_TO ? TUTORIAL_BEAT_MS : BEAT_MS);
    return Math.round((base * (store.data.settings.relaxed ? TEMPO.relaxedMul : 1)) / timeScale);
  }

  // ---------- Spots (variant D) & first marker (variant E) ----------
  function spotInkAt(s: Sim, idx: number): number {
    const spots = ctx().def.spots;
    if (!opt.spots || !spots) return s.nextInkIndex();
    for (let k = 0; k < spots.length; k++) {
      if (s.idx(spots[k].x, spots[k].y) === idx && !s.used[k]) return k;
    }
    return -1;
  }

  function isSpot(idx: number): boolean {
    const spots = ctx().def.spots;
    if (!opt.spots || !spots || !sim) return true;
    return spots.some((p) => sim!.idx(p.x, p.y) === idx);
  }

  function firstCell(): number {
    const d = ctx().def.solution[0];
    return d && sim ? sim.idx(d.x, d.y) : -1;
  }

  /** Why this cell can't take ink right now (null = fine). Adds the variant rules on top of the sim's. */
  function blockReason(s: Sim, idx: number): string | null {
    if (opt.firstMarker && s.drops.length === 0 && idx !== firstCell()) return 'first';
    if (opt.spots && ctx().def.spots) {
      if (!isSpot(idx)) return 'notSpot';
      if (spotInkAt(s, idx) < 0) return 'inked';
    }
    return s.dropBlock(idx);
  }

  // ---------- Tray (ink queue) ----------
  function renderQueue() {
    if (!sim) return;
    host.tray.innerHTML = '';
    const cols = inkForPaper(inkSkin(store.data.cosmetics.ink), paperSkin(store.data.cosmetics.paper));
    ctx().L.inks.forEach((ink) => {
      const hasR = ink.range !== Infinity;
      const chip = h('div.ink-chip' + (hasR ? '.has-rng' : ''), { html: dropChipSVG(cols[ink.c]) });
      if (store.data.settings.symbols) chip.appendChild(h('div.gly', { html: glyphSVG(ink.c, 18) }));
      if (hasR) chip.appendChild(h('div.rng', { text: String(ink.range) }));
      chip.setAttribute('aria-label', t('color.' + ink.c) + (hasR ? ' ' + ink.range : ''));
      host.tray.appendChild(chip);
    });
    updateQueue();
  }

  function updateQueue(popIndex = -1) {
    if (!sim) return;
    const chips = host.tray.children;
    const next = opt.spots ? -1 : sim.nextInkIndex();
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i] as HTMLElement;
      c.classList.toggle('used', !!sim.used[i]);
      c.classList.toggle('next', i === next);
      if (i === popIndex) {
        c.classList.remove('pop');
        void c.offsetWidth;
        c.classList.add('pop');
      }
    }
  }

  // ---------- Beat UI ----------
  function updateBeat(frac: number, running: boolean) {
    if (!sim) return;
    beatNum.textContent = String(sim.tick);
    beatEl.classList.toggle('idle', phase === 'idle');
    ringFg.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - (running ? Math.max(0, Math.min(1, frac)) : 0))));
  }

  function pulseBeat() {
    beatEl.classList.remove('pulse');
    void beatEl.offsetWidth;
    beatEl.classList.add('pulse');
  }

  // ---------- Hints / guided ghosts / spots ----------
  function solutionMatchesSoFar(): boolean {
    if (!sim) return false;
    const sol = ctx().def.solution;
    for (let i = 0; i < sim.drops.length; i++) {
      const d = sim.drops[i], s = sol[i];
      if (!s || d.x !== s.x || d.y !== s.y || d.t !== s.t) return false;
    }
    return true;
  }

  function nextGhost() {
    if (!sim || !hintOn || hintBroken) return null;
    return ctx().def.solution[sim.drops.length] || null;
  }

  function inkOfSolutionDrop(i: number): number {
    const d = ctx().def.solution[i];
    if (d && d.k !== undefined) return d.k;
    if (opt.spots && ctx().def.spots) {
      const k = ctx().def.spots!.findIndex((p) => p.x === d.x && p.y === d.y);
      if (k >= 0) return k;
    }
    return i;
  }

  function updateGhosts() {
    if (!sim) return;
    const L = ctx().L;
    if (hintOn && !hintBroken) {
      const placed = sim.drops.length;
      const marks: GhostMark[] = ctx().def.solution.map((d, i) => {
        const due = d.t <= sim!.tick || (phase === 'idle' || phase === 'prestart' ? d.t === 0 : false);
        return {
          idx: sim!.idx(d.x, d.y),
          color: L.inks[inkOfSolutionDrop(i)].c,
          beat: d.t,
          order: i + 1,
          state: i < placed ? 'done' : i === placed && due ? 'now' : 'upcoming',
        };
      });
      renderer.setGhosts(marks);
    } else if (opt.spots && ctx().def.spots) {
      // Every spot is shown; the player picks the order and the beat.
      const marks: GhostMark[] = [];
      ctx().def.spots!.forEach((p, k) => {
        if (!sim!.used[k]) marks.push({ idx: sim!.idx(p.x, p.y), color: L.inks[k].c, beat: 0, order: 0, state: 'upcoming' });
      });
      renderer.setGhosts(marks);
    } else if (opt.firstMarker && sim.drops.length === 0) {
      const fc = firstCell();
      renderer.setGhosts(fc >= 0 ? [{ idx: fc, color: L.inks[inkOfSolutionDrop(0)].c, beat: 0, order: 0, state: 'now' }] : null);
    } else renderer.setGhosts(null);
    placePointer();
  }

  function placePointer() {
    const g = nextGhost();
    if (!g || !sim || phase === 'won' || phase === 'lost') {
      if (opt.firstMarker && sim && sim.drops.length === 0 && ctx().guided && phase === 'idle') {
        host.point(firstCell(), t('play.tapHere'), { hand: true });
        return;
      }
      host.point(null);
      return;
    }
    const idx = sim.idx(g.x, g.y);
    const due = g.t <= sim.tick || ((phase === 'idle' || phase === 'prestart') && g.t === 0);
    const text = due ? (g.t > 0 ? t('play.now') : t('play.tapHere')) : t('play.waitBeat', { n: g.t });
    host.point(idx, text, { hand: due && (ctx().guided || phase === 'idle'), now: due && g.t > 0 });
  }

  // ---------- Input ----------
  function tryDrop(idx: number, now: number, noGrace = false) {
    if (!sim) return;
    // Grace window: a tap right after a beat counts for the previous beat.
    if (!noGrace && phase === 'running' && preStep && now - lastStepAt < GRACE_MS && !fastForward && !blockReason(preStep, idx)) {
      graceDrop(idx, now);
      return;
    }
    const block = blockReason(sim, idx);
    if (block) {
      renderer.onReject(idx, block);
      audio.reject();
      buzz('light');
      if (block === 'white') host.say(t('play.reject.white'));
      else if (block === 'inked') host.say(t('play.reject.inked'));
      else if (block === 'noink') host.say(t('play.reject.noink'));
      else if (block === 'notSpot') host.say(t('play.reject.notSpot'));
      else if (block === 'first') host.say(t('play.reject.first'));
      else host.say(t('play.reject.blocked'));
      host.kick();
      return;
    }
    rewindStack.push(sim.clone());
    const k = spotInkAt(sim, idx);
    const c = ctx().L.inks[k].c;
    sim.dropInk(idx, k);
    afterDrop(idx, c, k, now);
  }

  function afterDrop(idx: number, c: number, chipIndex: number, now: number) {
    if (!sim) return;
    host.touched();
    store.data.stats.drops++;
    renderer.onDrop(idx, c);
    audio.drop(c);
    buzz('light');
    updateQueue(chipIndex);
    host.hush();
    if (hintOn && !hintBroken && !solutionMatchesSoFar()) {
      hintBroken = true;
      host.say(t('play.hintOff'), 2600);
    }
    if (phase === 'idle' || phase === 'prestart') {
      phase = 'prestart';
      nextBeatAt = now + beatMs;
      audio.beatStart(beatMs, nextBeatAt);
    } else if (phase === 'frozen' || phase === 'rewound') {
      phase = 'running';
      nextBeatAt = now + beatMs;
      audio.beatStart(beatMs, nextBeatAt);
      resumeBar.classList.remove('open');
    }
    evaluate(now);
    updateGhosts();
    host.updateBoosters();
    host.kick();
  }

  function graceDrop(idx: number, now: number) {
    if (!sim || !preStep) return;
    const old = lastEvents;
    const s = preStep;
    rewindStack.push(s.clone());
    const k = spotInkAt(s, idx);
    const c = ctx().L.inks[k].c;
    s.dropInk(idx, k);
    preStep = s.clone();
    const ev = s.step();
    sim = s;
    lastEvents = ev;
    renderer.replaceSim(sim);
    const key = (e: SimEvent) => e.type + ':' + ('idx' in e ? e.idx + ':' + e.c : e.a + '-' + e.b);
    const seen = new Set(old.map(key));
    renderer.onStep(ev.filter((e) => !seen.has(key(e))));
    pendingFail = null;
    met = new Set(ctx().L.targets.filter((i) => s.ink[i] === ctx().L.goal[i]));
    afterDrop(idx, c, k, now);
    checkTargets();
  }

  // ---------- Clock ----------
  function doStep(now: number) {
    if (!sim) return;
    preStep = sim.clone();
    const ev = sim.step();
    lastEvents = ev;
    lastStepAt = now;
    renderer.onStep(ev);
    pulseBeat();
    const fills: number[] = [], mixes: number[] = [], seeds: number[] = [];
    let touches = 0;
    for (const e of ev) {
      if (e.type === 'fill') { if (!fills.includes(e.c)) fills.push(e.c); }
      else if (e.type === 'mix') { if (!mixes.includes(e.c)) mixes.push(e.c); }
      else if (e.type === 'seed') seeds.push(e.c);
      else if (e.type === 'touch') touches++;
    }
    if (mixes.length) buzz('medium');
    const L = ctx().L;
    const prog = L.targets.length ? sim.metCount() / L.targets.length : 1;
    audio.beat({ tick: sim.tick, fills, mixes, seeds, touches, progress: prog });
    checkTargets();
    // Guided timed drop: hold the clock on the right beat until the player taps.
    const g = ctx().guided ? nextGhost() : null;
    if (g && g.t > 0 && g.t === sim.tick) {
      phase = 'frozen';
      audio.beatStop();
    }
    if (hintOn && !hintBroken) {
      const ng = nextGhost();
      if (ng && ng.t < sim.tick) {
        hintBroken = true;
        host.say(t('play.hintMissed'), 2600);
      }
    }
    evaluate(now);
    updateGhosts();
  }

  function checkTargets() {
    if (!sim) return;
    const L = ctx().L;
    for (const i of L.targets) {
      if (!met.has(i) && sim.ink[i] === L.goal[i]) {
        met.add(i);
        renderer.onTargetMet(i);
        audio.targetMet(met.size / L.targets.length);
      }
    }
  }

  function anyDroppable(): boolean {
    if (!sim) return false;
    for (let i = 0; i < sim.ink.length; i++) if (!blockReason(sim, i)) return true;
    return false;
  }

  function evaluate(now: number) {
    if (!sim || phase === 'won' || phase === 'lost') return;
    const L = ctx().L;
    const wrong = sim.wrongCells();
    if (wrong.length) {
      if (!pendingFail) pendingFail = { at: now + GRACE_MS, cells: wrong };
      else pendingFail.cells = wrong;
      return;
    }
    if (!decided && sim.allTargetsMet()) {
      const f = sim.forecast();
      if (f.result === 'win') {
        decided = 'win';
        fastForward = true;
      }
    }
    if (decided === 'win' && sim.settled()) {
      phase = 'won';
      audio.beatStop();
      setTimeout(() => host.win(), TEMPO.settleDelayMs);
      return;
    }
    if (sim.inksLeft() === 0 && !decided) {
      if (sim.settled()) {
        fail(L.targets.filter((i) => sim!.ink[i] !== L.goal[i]), 'unreached');
        return;
      }
      if (!fastForward && sim.forecast().result === 'lose') fastForward = true;
    }
    if (sim.inksLeft() > 0 && phase !== 'idle' && sim.settled() && !anyDroppable()) {
      fail(L.targets.filter((i) => sim!.ink[i] !== L.goal[i]), 'unreached');
    }
  }

  // ---------- Fail ----------
  function classify(cells: number[]): FailKind {
    if (!sim) return 'unreached';
    const L = ctx().L;
    for (const i of cells) {
      const goal = L.goal[i], got = sim.ink[i];
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

  function fail(cells: number[], forced?: FailKind) {
    if (!sim || phase === 'won' || phase === 'lost') return;
    phase = 'lost';
    audio.beatStop();
    const kind = forced || classify(cells);
    const text = kind === 'white' ? t('fail.white') : kind === 'unreached' ? t('fail.unfinished') : t('fail.wrong');
    const tip = t({ needMix: 'fail.tip.needMix', noMix: 'fail.tip.noMix', otherFirst: 'fail.tip.otherFirst', otherMix: 'fail.tip.otherMix', white: 'fail.tip.white', mud: 'fail.tip.mud', unreached: 'fail.tip.unreached' }[kind]);
    host.point(null);
    host.fail({ cells, text, tip });
  }

  // ---------- Boosters ----------
  async function onHint() {
    if (!sim) return;
    if (ctx().guided) return;
    if (hintOn && !hintBroken) {
      host.say(t('play.hintShown'));
      return;
    }
    if (!host.isHinted()) {
      if (!(await host.spendItem('hints'))) return;
      host.setHinted();
    }
    store.data.seen['hint.' + ctx().def.id] = 1;
    hintOn = true;
    host.taint();
    audio.hint();
    // Follow the hint from a clean board unless the player is already on the solution path.
    if (phase === 'lost' || phase === 'won' || !solutionMatchesSoFar() || hintBroken) {
      host.resetAttempt();
      host.say(t('play.hintRestart'), 2200);
    } else host.say(t('play.hintShown'), 2200);
    hintBroken = false;
    updateGhosts();
    host.updateBoosters();
    host.kick();
  }

  async function onRewind() {
    if (!sim) return;
    if (!rewindStack.length || phase === 'won') {
      host.say(t('play.rewindNone'));
      return;
    }
    if (!(await host.spendItem('rewinds'))) return;
    host.taint();
    sim = rewindStack.pop()!;
    preStep = null;
    lastEvents = [];
    pendingFail = null;
    decided = null;
    fastForward = false;
    const L = ctx().L;
    met = new Set(L.targets.filter((i) => sim!.ink[i] === L.goal[i]));
    renderer.setSim(sim);
    audio.beatStop();
    audio.rewind();
    host.unfail();
    phase = sim.drops.length === 0 ? 'idle' : 'rewound';
    if (phase === 'rewound') resumeBar.classList.add('open');
    host.say(t('play.rewindDone'), 2200);
    if (hintOn) hintBroken = !solutionMatchesSoFar();
    updateQueue();
    updateBeat(0, false);
    updateGhosts();
    host.updateBoosters();
    host.kick();
  }

  function resumeFromRewind() {
    if (phase !== 'rewound') return;
    resumeBar.classList.remove('open');
    phase = 'running';
    nextBeatAt = performance.now() + beatMs;
    audio.beatStart(beatMs, nextBeatAt);
    host.kick();
  }

  // ---------- Debug autoplay ----------
  function autoplayTick(now: number) {
    if (!sim || anyPopupOpen()) return;
    if (phase === 'won' || phase === 'lost' || phase === 'paused') return;
    const s = ctx().def.solution[sim.drops.length];
    if (!s) return;
    const idx = sim.idx(s.x, s.y);
    if (phase === 'idle' || phase === 'prestart') {
      if (s.t === 0) tryDrop(idx, now, true);
    } else if (s.t === sim.tick) tryDrop(idx, now, true);
  }

  function runSolutionNow(): Sim {
    const s = new Sim(ctx().L);
    const pending = ctx().def.solution.slice();
    let guard = 0;
    while (guard++ < 400) {
      while (pending.length && pending[0].t <= s.tick) {
        const d = pending.shift()!;
        const i = s.idx(d.x, d.y);
        const k = d.k ?? spotInkAt(s, i);
        s.dropInk(i, k);
      }
      if (!pending.length && s.settled()) break;
      s.step();
    }
    return s;
  }

  const core: Core = {
    boosters: [
      { id: 'undo', icon: 'rewind', label: 'play.rewind', item: 'rewinds' },
      { id: 'hint', icon: 'hint', label: 'play.hint', item: 'hints' },
    ],
    failActions: ['undo', 'hint'],

    start() {
      hintOn = ctx().guided || !!(ctx().mode === 'campaign' && host.isHinted() && store.data.seen['hint.' + ctx().def.id]);
      beatMs = computeBeatMs();
      host.status.appendChild(beatEl);
      core.reset();
    },

    reset() {
      audio.beatStop();
      sim = new Sim(ctx().L);
      phase = 'idle';
      preStep = null;
      lastEvents = [];
      rewindStack = [];
      hintBroken = false;
      decided = null;
      fastForward = false;
      pendingFail = null;
      met = new Set();
      renderer.setSim(sim);
      resumeBar.classList.remove('open');
      renderQueue();
      updateBeat(0, false);
      updateGhosts();
    },

    pointerDown(idx, _x, _y, now) {
      if (!sim || phase === 'won' || phase === 'lost' || phase === 'paused' || decided) return;
      tryDrop(idx, now);
    },

    frame(now) {
      if (!sim) return false;
      if (autoplay) autoplayTick(now);
      const interval = fastForward ? beatMs / TEMPO.fastForwardMul : beatMs;
      if (phase === 'prestart') {
        const g = ctx().guided ? nextGhost() : null;
        if (g && g.t === 0) nextBeatAt = now + beatMs; // guided: wait for every beat-0 drop
        else if (now >= nextBeatAt) {
          phase = 'running';
          doStep(now);
          nextBeatAt = now + interval;
        }
      } else if (phase === 'running') {
        if (now >= nextBeatAt) {
          doStep(now);
          nextBeatAt = Math.max(nextBeatAt + interval, now + interval * 0.5);
        }
      }
      if (pendingFail && now >= pendingFail.at) {
        const cells = pendingFail.cells;
        pendingFail = null;
        fail(cells);
      }
      const running = phase === 'running' || phase === 'prestart';
      const frac = running ? 1 - (nextBeatAt - now) / interval : 0;
      renderer.setBeat(Math.max(0, Math.min(1, frac)), phase === 'running');
      updateBeat(frac, running);
      return running || !!pendingFail;
    },

    booster(id: BoosterId) {
      if (id === 'hint') void onHint();
      else if (id === 'undo') void onRewind();
    },

    boosterEnabled(id: BoosterId) {
      if (!sim) return false;
      if (id === 'undo') return sim.drops.length > 0 && phase !== 'won';
      return !ctx().guided && phase !== 'won' && !(hintOn && !hintBroken);
    },

    boosterCount(id: BoosterId) {
      if (id === 'hint' && (ctx().guided || host.isHinted())) return '';
      return null;
    },

    pause() {
      if (phase === 'running' || phase === 'prestart' || phase === 'frozen') {
        pausedFrom = phase;
        phase = 'paused';
        audio.beatStop();
      }
    },

    resume() {
      if (phase !== 'paused') return;
      phase = pausedFrom;
      if (phase === 'running' || phase === 'prestart') {
        nextBeatAt = performance.now() + beatMs;
        audio.beatStart(beatMs, nextBeatAt);
      }
      host.kick();
    },

    isRunning() {
      return phase === 'running' || phase === 'prestart' || phase === 'frozen';
    },

    isOver() {
      return phase === 'won' || phase === 'lost' || !!decided;
    },

    refresh() {
      if (!sim) return;
      renderQueue();
      beatMs = computeBeatMs();
    },

    debug: {
      autoplay(on: boolean) {
        autoplay = on;
        if (on && sim && sim.drops.length) host.resetAttempt();
        host.kick();
      },
      state() {
        return { phase, tick: sim?.tick ?? 0, drops: sim?.drops.length ?? 0 };
      },
      solveNow() {
        if (!sim) return;
        sim = runSolutionNow();
        renderer.setSim(sim);
        decided = 'win';
        phase = 'running';
        evaluate(performance.now());
        host.kick();
      },
      info() {
        if (!sim) return null;
        const droppable: number[] = [];
        for (let i = 0; i < sim.ink.length; i++) if (!blockReason(sim, i)) droppable.push(i);
        return { w: sim.w, h: sim.h, solution: ctx().def.solution, droppable };
      },
      setTimeScale(k: number) {
        timeScale = Math.max(0.25, k);
        if (host.ctx) beatMs = computeBeatMs();
      },
    },
  };
  return core;
}
