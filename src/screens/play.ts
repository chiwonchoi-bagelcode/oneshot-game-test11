/*
 * Play screen: the beat clock, input, hints/rewinds, and the win/fail flow.
 *
 * Timing model (keeps failures about judgement, not reflexes):
 *  - The clock doesn't run until the first drop. Drops made in quick succession before the first
 *    beat all count as beat 0 (each drop restarts the count-in).
 *  - A tap up to TEMPO.graceMs after a beat still counts for the previous beat (touch latency).
 *  - A cell that breaks the goal is shown immediately (with the exact reason), and Retry is one tap.
 */
import './play.css';
import { Sim, parseLevel, isPrimary, WHITE, type LevelDef, type ParsedLevel, type SimEvent } from '../core/sim.ts';
import { BoardRenderer, type GhostMark } from '../render/board.ts';
import { glyphSVG } from '../render/glyphs.ts';
import { inkSkin, paperSkin, inkForPaper } from '../render/skins.ts';
import { paintingSVG, revealRegion, PAINTING_REGIONS } from '../render/paintings.ts';
import { h, onTap, iconButton, button, countUp, lockInput } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { openPopup, closeAllPopups, anyPopupOpen, type PopupHandle } from '../ui/popup.ts';
import { showReward } from '../ui/reward.ts';
import { go, back as routerBack, type Screen } from '../ui/router.ts';
import { openSettingsPopup } from '../ui/topbar.ts';
import { ruleDiagram } from '../ui/rule-diagrams.ts';
import { store } from '../state/store.ts';
import { grant, spendCoins, useItem } from '../state/economy.ts';
import { recordClear, recordFail, chapterStats, clearedCount, type ClearResult } from '../state/progress.ts';
import { todaySet, recordDailyClear, type DailyClearResult } from '../state/daily.ts';
import { levelInfo, levelAt, CHAPTERS, ALL_LEVELS } from '../levels/pack.ts';
import { TEMPO, PRICES, LEVEL_REWARD, DAILY } from '../config/balance.ts';
import { adsLeft, showRewardedAd } from '../services/ads.ts';
import { audio } from '../audio/index.ts';
import { buzz } from '../services/feedback.ts';
import { t, fmt, onLangChange } from '../i18n/i18n.ts';

type Phase = 'idle' | 'prestart' | 'running' | 'frozen' | 'rewound' | 'paused' | 'won' | 'lost';
type FailKind = 'needMix' | 'noMix' | 'otherFirst' | 'otherMix' | 'white' | 'mud' | 'unreached';

interface LevelCtx {
  mode: 'campaign' | 'daily';
  def: LevelDef;
  L: ParsedLevel;
  /** Campaign: global index; daily: tier. */
  index: number;
  chapter: number;
  number: number;
  guided: boolean;
}

/** Hooks for the debug panel and automated tests (dev builds only). */
export const debugHooks: {
  autoplay: (on: boolean) => void;
  state: () => any;
  solveNow: () => void;
  setTimeScale: (k: number) => void;
  cellCenter: (idx: number) => { x: number; y: number };
  info: () => any;
} = { autoplay: () => {}, state: () => null, solveNow: () => {}, setTimeScale: () => {}, cellCenter: () => ({ x: 0, y: 0 }), info: () => null };

const DROP_PATH = 'M20 2C20 2 5 18.5 5 28.5a15 15 0 0 0 30 0C35 18.5 20 2 20 2z';

export function createPlayScreen(): Screen {
  // ---------- DOM ----------
  const el = h('section.play');
  const titleB = h('b');
  const titleS = h('small');
  const pauseBtn = iconButton(icon('pause'), () => pause(true), { label: t('play.pause') });
  const backBtn = iconButton(icon('back'), () => leave(), { label: t('common.back'), sound: 'back' });
  const topbar = h('header.topbar', null, backBtn, h('div.play-title', null, titleB, titleS), pauseBtn);

  const ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const beatNum = h('div.num', { text: '0' });
  const beatEl = h('div.beat.idle', { html: `<svg class="ring" viewBox="0 0 34 34"><circle class="ring-bg" cx="17" cy="17" r="14"/></svg>` }, beatNum, h('span.lbl', { text: t('play.beat') }));
  ringFg.setAttribute('class', 'ring-fg');
  ringFg.setAttribute('cx', '17');
  ringFg.setAttribute('cy', '17');
  ringFg.setAttribute('r', '14');
  const RING_LEN = 2 * Math.PI * 14;
  ringFg.setAttribute('stroke-dasharray', String(RING_LEN));
  ringFg.setAttribute('stroke-dashoffset', String(RING_LEN));
  beatEl.querySelector('svg')!.appendChild(ringFg);
  const coach = h('div.coach');
  const beatRow = h('div.beat-row', null, beatEl, coach);

  const canvas = h('canvas') as HTMLCanvasElement;
  const pointer = h('div.pointer.hidden', { html: icon('hand') });
  const bubble = h('div.pointer-bubble.hidden');
  const boardWrap = h('div.board-wrap', null, canvas, pointer, bubble);

  const queue = h('div.queue', { 'aria-label': t('play.inks') });

  const hintCount = h('i.count');
  const rewindCount = h('i.count');
  const hintBtn = iconButton(icon('hint'), () => onHint(), { label: t('play.hint') });
  hintBtn.appendChild(hintCount);
  const rewindBtn = iconButton(icon('rewind'), () => onRewind(), { label: t('play.rewind') });
  rewindBtn.appendChild(rewindCount);
  const restartBtn = iconButton(icon('restart'), () => restart(), { label: t('play.retry'), cls: 'mono' });
  const boHint = h('div.booster', null, hintBtn, h('span', { text: t('play.hint') }));
  const boRewind = h('div.booster', null, rewindBtn, h('span', { text: t('play.rewind') }));
  const boRestart = h('div.booster', null, restartBtn, h('span', { text: t('play.retry') }));
  const boosters = h('div.boosters', null, boRestart, boRewind, boHint);

  const resumeText = h('div.grow', { text: t('play.resumeTap') });
  const resumeBar = h('div.resume-bar', null, resumeText, button(t('play.resume'), () => resumeFromRewind(), { variant: 'jade', size: 'sm', icon: icon('play') }));

  const sheet = h('div.sheet');

  el.append(topbar, beatRow, boardWrap, queue, boosters, resumeBar, sheet);

  // ---------- State ----------
  const renderer = new BoardRenderer(canvas, boardOpts());
  let ctx: LevelCtx | null = null;
  let sim: Sim | null = null;
  let phase: Phase = 'idle';
  let pausedFrom: Phase = 'idle';
  let beatMs = TEMPO.beatMs;
  let nextBeatAt = 0;
  let lastStepAt = -1e9;
  let preStep: Sim | null = null;
  let lastEvents: SimEvent[] = [];
  let rewindStack: Sim[] = [];
  let clean = true; // seal eligibility for this attempt
  let attemptDirty = false; // at least one drop made in this attempt
  let hintOn = false;
  let hintBroken = false;
  let decided: 'win' | null = null;
  let fastForward = false;
  let pendingFail: { at: number; cells: number[] } | null = null;
  let met = new Set<number>();
  let raf = 0;
  let coachTimer = 0;
  let visible = false;
  let pausePopup: PopupHandle | null = null;
  let resultShown = false;
  let timeScale = 1; // debug only

  function boardOpts() {
    const s = store.data;
    return { ink: s.cosmetics.ink, paper: s.cosmetics.paper, symbols: s.settings.symbols, reducedMotion: s.settings.reducedMotion };
  }

  store.on('cosmetics', () => {
    renderer.setOptions(boardOpts());
    if (ctx) renderQueue();
    kick();
  });
  store.on('settings', () => {
    renderer.setOptions(boardOpts());
    if (ctx) {
      renderQueue();
      beatMs = computeBeatMs(ctx);
    }
    kick();
  });
  store.on('wallet', updateBoosters);
  onLangChange(() => {
    if (ctx) setTitle();
    beatEl.querySelector('.lbl')!.textContent = t('play.beat');
    boHint.querySelector('span')!.textContent = t('play.hint');
    boRewind.querySelector('span')!.textContent = t('play.rewind');
    boRestart.querySelector('span')!.textContent = t('play.retry');
    resumeText.textContent = t('play.resumeTap');
  });

  // ---------- Layout ----------
  const ro = new ResizeObserver(() => layout());
  ro.observe(boardWrap);
  function layout() {
    const w = boardWrap.clientWidth, hh = boardWrap.clientHeight;
    if (!w || !hh) return;
    renderer.layout(w, hh, Math.min(2, window.devicePixelRatio || 1));
    placePointer();
    kick();
  }

  // ---------- Level setup ----------
  function computeBeatMs(c: LevelCtx): number {
    const base = c.def.tempo ?? (c.mode === 'campaign' && c.chapter === 0 && c.number <= 14 ? TEMPO.tutorialBeatMs : TEMPO.beatMs);
    return Math.round((base * (store.data.settings.relaxed ? TEMPO.relaxedMul : 1)) / timeScale);
  }

  function setTitle() {
    if (!ctx) return;
    if (ctx.mode === 'daily') {
      titleB.textContent = t('nav.daily');
      titleS.textContent = t('daily.tier.' + ctx.index);
    } else {
      titleB.textContent = t('level.n', { n: ctx.number });
      titleS.textContent = t('chapter.' + CHAPTERS[ctx.chapter].id + '.name');
    }
  }

  function openLevel(c: LevelCtx) {
    ctx = c;
    hintOn = c.guided || !!(c.mode === 'campaign' && store.data.hinted[c.def.id] && store.data.seen['hint.' + c.def.id]);
    clean = true;
    beatMs = computeBeatMs(c);
    setTitle();
    resetAttempt();
    audio.setMusic('play', c.chapter);
    // First visit cards: new chapter, new rule.
    queueIntroCards();
  }

  function resetAttempt() {
    if (!ctx) return;
    stopClock();
    sim = new Sim(ctx.L);
    phase = 'idle';
    preStep = null;
    lastEvents = [];
    rewindStack = [];
    attemptDirty = false;
    hintBroken = false;
    decided = null;
    fastForward = false;
    pendingFail = null;
    resultShown = false;
    met = new Set();
    renderer.setSim(sim);
    closeSheet();
    resumeBar.classList.remove('open');
    boardWrap.style.transform = '';
    renderQueue();
    updateBeat(0, false);
    updateBoosters();
    updateGhosts();
    layout();
    kick();
  }

  function restart() {
    if (!ctx) return;
    if (attemptDirty) {
      clean = false;
      if (ctx.mode === 'campaign' && phase !== 'lost') recordFail(ctx.def.id);
    }
    audio.beatStop();
    resetAttempt();
  }

  function queueIntroCards() {
    if (!ctx || ctx.mode !== 'campaign') return;
    const ch = CHAPTERS[ctx.chapter];
    const steps: (() => Promise<void>)[] = [];
    if (ctx.number > 1 && ch.first === ctx.number && !store.data.seen['chapter.' + ch.id]) {
      steps.push(() => chapterCard(ctx!.chapter, false));
    }
    const m = ctx.def.intro;
    if (m && m !== 'drop' && !store.data.seen['mech.' + m]) steps.push(() => ruleCard(m));
    if (!steps.length) return;
    (async () => {
      for (const s of steps) await s();
      kick();
    })();
  }

  function ruleCard(m: string): Promise<void> {
    store.data.seen['mech.' + m] = 1;
    store.commit('seen');
    const body = h('div.rule-card', null,
      h('div.kicker', null, h('span.chip.accent', { text: t('mech.new') })),
      h('div.diagram', null, ruleDiagram(m as any)),
      h('p', { text: t('mech.' + m + '.body') }),
    );
    const ok = button(t('mech.gotIt'), () => p.close(), { variant: 'jade', size: 'lg' });
    const p = openPopup({ id: 'rule', title: t('mech.' + m + '.title'), body, foot: ok, dimClose: false });
    return p.closed;
  }

  function chapterCard(ci: number, complete: boolean): Promise<void> {
    const ch = CHAPTERS[ci];
    store.data.seen['chapter.' + ch.id] = 1;
    store.commit('seen');
    const stats = chapterStats(ci);
    const art = h('div.art', { html: paintingSVG(ci, complete ? PAINTING_REGIONS : stats.cleared, { idPrefix: 'cc' + ci }) });
    const body = h('div.chapter-card', null,
      h('div.kicker', { style: { display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, h('span.chip.jade', { text: t('chapter.n', { n: ci + 1 }) })),
      art,
      h('p', { text: complete ? t('chapter.completeBody', { name: t('chapter.' + ch.id + '.name') }) : t('chapter.' + ch.id + '.line') }),
    );
    const ok = button(complete ? t('common.continue') : t('common.play'), () => p.close(), { variant: 'jade', size: 'lg', icon: complete ? undefined : icon('play') });
    const p = openPopup({ id: 'chapter-card', title: complete ? t('chapter.complete') : t('chapter.' + ch.id + '.name'), body, foot: ok, dimClose: false });
    if (complete) {
      audio.chapterComplete();
      buzz('success');
      const svg = art.querySelector('svg') as SVGSVGElement | null;
      if (svg && stats.cleared >= PAINTING_REGIONS) {
        // Replay the last region so the finished painting "lands" in front of the player.
        try { revealRegion(svg, PAINTING_REGIONS - 1, true); } catch { /* */ }
      }
    }
    return p.closed;
  }

  // ---------- Queue & boosters ----------
  function renderQueue() {
    if (!sim || !ctx) return;
    queue.innerHTML = '';
    const cols = inkForPaper(inkSkin(store.data.cosmetics.ink), paperSkin(store.data.cosmetics.paper));
    ctx.L.inks.forEach((ink, i) => {
      const hasR = ink.range !== Infinity;
      const chip = h('div.ink-chip' + (hasR ? '.has-rng' : ''), {
        html: `<svg class="dropshape" viewBox="0 0 40 46"><path d="${DROP_PATH}" transform="translate(0 2)" fill="${cols[ink.c]}" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/><path d="M13 27a7 7 0 0 1 4-7" stroke="rgba(255,255,255,.55)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
      });
      if (store.data.settings.symbols) chip.appendChild(h('div.gly', { html: glyphSVG(ink.c, 18) }));
      if (hasR) chip.appendChild(h('div.rng', { text: String(ink.range) }));
      chip.setAttribute('aria-label', t('color.' + ink.c) + (hasR ? ' ' + ink.range : ''));
      queue.appendChild(chip);
    });
    updateQueue();
  }

  function updateQueue(popIndex = -1) {
    if (!sim) return;
    const chips = queue.children;
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i] as HTMLElement;
      c.classList.toggle('used', i < sim.pi);
      c.classList.toggle('next', i === sim.pi);
      if (i === popIndex) {
        c.classList.remove('pop');
        void c.offsetWidth;
        c.classList.add('pop');
      }
    }
  }

  function updateBoosters() {
    const d = store.data;
    sheet.querySelectorAll<HTMLElement>('[data-live]').forEach((el) => {
      const n = d[el.dataset.live as 'hints' | 'rewinds'];
      el.textContent = n > 0 ? fmt(n) : '+';
      el.classList.toggle('plus', !(n > 0));
    });
    hintCount.textContent = ctx && (ctx.guided || (ctx.mode === 'campaign' && d.hinted[ctx.def.id])) ? '' : d.hints > 0 ? fmt(d.hints) : '+';
    hintCount.classList.toggle('plus', !(d.hints > 0));
    hintCount.style.display = hintCount.textContent ? '' : 'none';
    rewindCount.textContent = d.rewinds > 0 ? fmt(d.rewinds) : '+';
    rewindCount.classList.toggle('plus', !(d.rewinds > 0));
    boRewind.classList.toggle('off', !sim || sim.drops.length === 0 || phase === 'won');
    boHint.classList.toggle('off', !ctx || ctx.guided || phase === 'won' || (hintOn && !hintBroken));
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

  function say(text: string, ms = 1800) {
    coach.textContent = text;
    coach.classList.add('show');
    clearTimeout(coachTimer);
    if (ms > 0) coachTimer = window.setTimeout(() => coach.classList.remove('show'), ms);
  }

  function hush() {
    clearTimeout(coachTimer);
    coach.classList.remove('show');
  }

  // ---------- Hints / guided ghosts ----------
  function solutionMatchesSoFar(): boolean {
    if (!sim || !ctx) return false;
    const sol = ctx.def.solution;
    for (let i = 0; i < sim.drops.length; i++) {
      const d = sim.drops[i], s = sol[i];
      if (!s || d.x !== s.x || d.y !== s.y || d.t !== s.t) return false;
    }
    return true;
  }

  function nextGhost() {
    if (!sim || !ctx || !hintOn || hintBroken) return null;
    const s = ctx.def.solution[sim.drops.length];
    return s || null;
  }

  function updateGhosts() {
    if (!sim || !ctx) return;
    if (!hintOn || hintBroken) {
      renderer.setGhosts(null);
      placePointer();
      return;
    }
    const placed = sim.drops.length;
    const marks: GhostMark[] = ctx.def.solution.map((d, i) => {
      const due = d.t <= sim!.tick || (phase === 'idle' || phase === 'prestart' ? d.t === 0 : false);
      return {
        idx: sim!.idx(d.x, d.y),
        color: ctx!.L.inks[i].c,
        beat: d.t,
        order: i + 1,
        state: i < placed ? 'done' : i === placed && due ? 'now' : 'upcoming',
      };
    });
    renderer.setGhosts(marks);
    placePointer();
  }

  function placePointer() {
    const g = nextGhost();
    if (!g || !sim || phase === 'won' || phase === 'lost' || anyPopupOpen()) {
      pointer.classList.add('hidden');
      bubble.classList.add('hidden');
      return;
    }
    const idx = sim.idx(g.x, g.y);
    const r = renderer.cellRect(idx);
    if (!r || !r.size) return;
    const cx = r.x + r.size / 2, cy = r.y + r.size / 2;
    const due = g.t <= sim.tick || ((phase === 'idle' || phase === 'prestart') && g.t === 0);
    pointer.classList.toggle('hidden', !(due && (ctx!.guided || phase === 'idle')));
    pointer.style.left = cx - 26 + 'px';
    pointer.style.top = cy + r.size * 0.18 - 6 + 'px';
    const text = due ? (g.t > 0 ? t('play.now') : t('play.tapHere')) : t('play.waitBeat', { n: g.t });
    if (bubble.textContent !== text) bubble.textContent = text;
    bubble.classList.remove('hidden');
    bubble.classList.toggle('now', due && g.t > 0);
    const bw = bubble.offsetWidth || 120;
    const W = boardWrap.clientWidth;
    bubble.style.left = Math.max(6, Math.min(W - bw - 6, cx - bw / 2)) + 'px';
    bubble.style.top = Math.max(2, r.y - 46) + 'px';
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.unlock();
    if (!sim || !ctx || anyPopupOpen()) return;
    if (phase === 'won' || phase === 'lost' || phase === 'paused' || decided) return;
    const rect = canvas.getBoundingClientRect();
    const idx = renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (idx < 0) return;
    tryDrop(idx, performance.now());
  });

  function tryDrop(idx: number, now: number, noGrace = false) {
    if (!sim || !ctx) return;
    // Grace window: a tap right after a beat counts for the previous beat.
    if (!noGrace && phase === 'running' && preStep && now - lastStepAt < TEMPO.graceMs && !fastForward && preStep.canDrop(idx)) {
      graceDrop(idx, now);
      return;
    }
    const block = sim.dropBlock(idx);
    if (block) {
      renderer.onReject(idx, block);
      audio.reject();
      buzz('light');
      if (block === 'white') say(t('play.reject.white'));
      else if (block === 'inked') say(t('play.reject.inked'));
      else if (block === 'noink') say(t('play.reject.noink'));
      else say(t('play.reject.blocked'));
      kick();
      return;
    }
    rewindStack.push(sim.clone());
    const c = sim.nextInk()!.c;
    const before = sim.pi;
    sim.drop(idx);
    afterDrop(idx, c, before, now);
  }

  function afterDrop(idx: number, c: number, chipIndex: number, now: number) {
    if (!sim || !ctx) return;
    attemptDirty = true;
    store.data.stats.drops++;
    renderer.onDrop(idx, c);
    audio.drop(c);
    buzz('light');
    updateQueue(chipIndex);
    hush();
    if (hintOn && !hintBroken && !solutionMatchesSoFar()) {
      hintBroken = true;
      say(t('play.hintOff'), 2600);
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
    updateBoosters();
    kick();
  }

  function graceDrop(idx: number, now: number) {
    if (!sim || !preStep) return;
    const old = lastEvents;
    const s = preStep;
    rewindStack.push(s.clone());
    const c = s.nextInk()!.c;
    const chip = s.pi;
    s.drop(idx);
    preStep = s.clone();
    const ev = s.step();
    sim = s;
    lastEvents = ev;
    renderer.replaceSim(sim);
    const seen = new Set(old.map((e) => e.type + ':' + ('idx' in e ? e.idx + ':' + e.c : e.a + '-' + e.b)));
    const fresh = ev.filter((e) => !seen.has(e.type + ':' + ('idx' in e ? e.idx + ':' + e.c : e.a + '-' + e.b)));
    renderer.onStep(fresh);
    pendingFail = null;
    met = new Set(ctx!.L.targets.filter((i) => s.ink[i] === ctx!.L.goal[i]));
    afterDrop(idx, c, chip, now);
    checkTargets();
  }

  // ---------- Clock ----------
  function kick() {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  function stopClock() {
    audio.beatStop();
  }

  function frame(now: number) {
    raf = 0;
    if (!visible) return;
    if (autoplay) autoplayTick(now);
    if (sim && ctx) {
      const interval = fastForward ? beatMs / TEMPO.fastForwardMul : beatMs;
      if (phase === 'prestart') {
        const g = ctx.guided ? nextGhost() : null;
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
      const animating = renderer.render(now);
      if (animating || running || pendingFail) kick();
    }
  }

  function doStep(now: number) {
    if (!sim || !ctx) return;
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
    const prog = ctx.L.targets.length ? sim.metCount() / ctx.L.targets.length : 1;
    audio.beat({ tick: sim.tick, fills, mixes, seeds, touches, progress: prog });
    checkTargets();
    // Guided timed drop: hold the clock on the right beat until the player taps.
    const g = ctx.guided ? nextGhost() : null;
    if (g && g.t > 0 && g.t === sim.tick) {
      phase = 'frozen';
      audio.beatStop();
    }
    if (hintOn && !hintBroken) {
      const ng = nextGhost();
      if (ng && ng.t < sim.tick) {
        hintBroken = true;
        say(t('play.hintMissed'), 2600);
      }
    }
    evaluate(now);
    updateGhosts();
  }

  function checkTargets() {
    if (!sim || !ctx) return;
    for (const i of ctx.L.targets) {
      if (!met.has(i) && sim.ink[i] === ctx.L.goal[i]) {
        met.add(i);
        renderer.onTargetMet(i);
        audio.targetMet(met.size / ctx.L.targets.length);
      }
    }
  }

  function evaluate(now: number) {
    if (!sim || !ctx || phase === 'won' || phase === 'lost') return;
    const wrong = sim.wrongCells();
    if (wrong.length) {
      if (!pendingFail) pendingFail = { at: now + TEMPO.graceMs, cells: wrong };
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
      setTimeout(() => win(), TEMPO.settleDelayMs);
      phase = 'won';
      audio.beatStop();
      return;
    }
    if (sim.inksLeft() === 0 && !decided) {
      if (sim.settled()) {
        const missing = ctx.L.targets.filter((i) => sim!.ink[i] !== ctx!.L.goal[i]);
        fail(missing, 'unreached');
        return;
      }
      if (!fastForward && sim.forecast().result === 'lose') fastForward = true;
    }
    if (sim.inksLeft() > 0 && phase !== 'idle') {
      let any = false;
      for (let i = 0; i < sim.ink.length && !any; i++) if (sim.canDrop(i)) any = true;
      if (!any && sim.settled()) {
        const missing = ctx.L.targets.filter((i) => sim!.ink[i] !== ctx!.L.goal[i]);
        fail(missing, 'unreached');
      }
    }
  }

  // ---------- Fail ----------
  function classify(cells: number[]): FailKind {
    if (!sim || !ctx) return 'unreached';
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

  function fail(cells: number[], forced?: FailKind) {
    if (!sim || !ctx || phase === 'won' || phase === 'lost') return;
    phase = 'lost';
    audio.beatStop();
    clean = false;
    if (ctx.mode === 'campaign') recordFail(ctx.def.id);
    const kind = forced || classify(cells);
    renderer.showWrong(cells);
    audio.wrong();
    buzz('error');
    pointer.classList.add('hidden');
    bubble.classList.add('hidden');
    kick();
    setTimeout(() => {
      if (phase === 'lost' && visible) openFailSheet(kind);
    }, 650);
  }

  function openFailSheet(kind: FailKind) {
    const main = kind === 'white' ? t('fail.white') : kind === 'unreached' ? t('fail.unfinished') : t('fail.wrong');
    const tipKey = { needMix: 'fail.tip.needMix', noMix: 'fail.tip.noMix', otherFirst: 'fail.tip.otherFirst', otherMix: 'fail.tip.otherMix', white: 'fail.tip.white', mud: 'fail.tip.mud', unreached: 'fail.tip.unreached' }[kind];
    sheet.innerHTML = '';
    const retry = button(t('play.retry'), () => restart(), { size: 'lg', icon: icon('restart') });
    const rw = sideButton('rewind', t('play.rewind'), () => onRewind(), store.data.rewinds);
    const hb = sideButton('hint', t('play.hint'), () => onHint(), ctx && store.data.hinted[ctx.def.id] ? -1 : store.data.hints);
    sheet.append(
      h('h2', { text: t('fail.title') }),
      h('p', { text: main }),
      h('div.tip', { html: icon('hint') }, h('span', { text: t(tipKey) })),
      h('div.sheet-actions', null, rw, retry, hb),
    );
    if (!sim || sim.drops.length === 0) rw.classList.add('off');
    openSheet();
    shrinkBoard();
  }

  function sideButton(ic: 'rewind' | 'hint', label: string, fn: () => void, count: number): HTMLElement {
    const b = iconButton(icon(ic), fn, { label });
    if (count >= 0) b.appendChild(h('i.count' + (count > 0 ? '' : '.plus'), { text: count > 0 ? fmt(count) : '+', dataset: { live: ic === 'hint' ? 'hints' : 'rewinds' } }));
    const wrap = h('div.side', null, b, h('span', { text: label }));
    return wrap;
  }

  function openSheet() {
    requestAnimationFrame(() => sheet.classList.add('open'));
    lockInput(300);
  }

  function closeSheet() {
    sheet.classList.remove('open');
  }

  // ---------- Boosters ----------
  async function onHint() {
    if (!ctx || !sim) return;
    if (ctx.guided) return;
    if (hintOn && !hintBroken) {
      say(t('play.hintShown'));
      return;
    }
    const owned = ctx.mode === 'campaign' ? !!store.data.hinted[ctx.def.id] : !!store.data.hinted[ctx.def.id];
    if (!owned) {
      if (store.data.hints <= 0) {
        const got = await outOfItem('hints');
        if (!got) return;
      }
      if (!useItem('hints')) return;
      store.data.hinted[ctx.def.id] = 1;
      store.commit('progress');
    }
    store.data.seen['hint.' + ctx.def.id] = 1;
    hintOn = true;
    clean = false;
    audio.hint();
    // Follow the hint from a clean board unless the player is already on the solution path.
    if (phase === 'lost' || phase === 'won' || !solutionMatchesSoFar() || hintBroken) {
      resetAttempt();
      say(t('play.hintRestart'), 2200);
    } else say(t('play.hintShown'), 2200);
    hintBroken = false;
    updateGhosts();
    updateBoosters();
    kick();
  }

  async function onRewind() {
    if (!ctx || !sim) return;
    if (!rewindStack.length || phase === 'won') {
      say(t('play.rewindNone'));
      return;
    }
    if (store.data.rewinds <= 0) {
      const got = await outOfItem('rewinds');
      if (!got) return;
    }
    if (!useItem('rewinds')) return;
    clean = false;
    const snap = rewindStack.pop()!;
    sim = snap;
    preStep = null;
    lastEvents = [];
    pendingFail = null;
    decided = null;
    fastForward = false;
    resultShown = false;
    met = new Set(ctx.L.targets.filter((i) => sim!.ink[i] === ctx!.L.goal[i]));
    renderer.setSim(sim);
    audio.beatStop();
    audio.rewind();
    closeSheet();
    boardWrap.style.transform = '';
    phase = sim.drops.length === 0 ? 'idle' : 'rewound';
    if (phase === 'rewound') resumeBar.classList.add('open');
    say(t('play.rewindDone'), 2200);
    if (hintOn) hintBroken = !solutionMatchesSoFar();
    updateQueue();
    updateBeat(0, false);
    updateGhosts();
    updateBoosters();
    kick();
  }

  function resumeFromRewind() {
    if (phase !== 'rewound') return;
    resumeBar.classList.remove('open');
    phase = 'running';
    nextBeatAt = performance.now() + beatMs;
    audio.beatStart(beatMs, nextBeatAt);
    kick();
  }

  /** Out of hints/rewinds: buy with coins, watch an ad (hints), or go to the shop. Resolves true if one was obtained. */
  function outOfItem(kind: 'hints' | 'rewinds'): Promise<boolean> {
    return new Promise((resolve) => {
      let got = false;
      let adPending = false;
      const price = kind === 'hints' ? PRICES.hint : PRICES.rewind;
      const title = kind === 'hints' ? t('play.noHints.title') : t('play.noRewinds.title');
      const text = kind === 'hints' ? t('play.noHints.body') : t('play.noRewinds.body');
      const body = h('div.center', null,
        h('div', { html: icon(kind === 'hints' ? 'hint' : 'rewind'), style: { fontSize: '64px', display: 'flex', justifyContent: 'center', marginBottom: '8px' } }),
        h('p', { text, style: { margin: '0', fontSize: '16px', lineHeight: '1.5', color: 'var(--ink-2)' } }),
      );
      const foot: HTMLElement[] = [];
      const itemLabel = kind === 'hints' ? t('reward.hints', { n: 1 }) : t('reward.rewinds', { n: 1 });
      const buy = h('button.btn.btn-gold.btn-col', { type: 'button' }, h('span.btn-price', { html: icon('coin') }, h('span', { text: fmt(price) })), h('span.sub', { text: itemLabel }));
      onTap(buy, () => {
        if (!spendCoins(price)) {
          p.close();
          notEnoughCoins(price);
          return;
        }
        grant(kind === 'hints' ? { hints: 1 } : { rewinds: 1 });
        audio.purchase();
        got = true;
        p.close();
      });
      foot.push(buy);
      if (kind === 'hints' && adsLeft('hint') > 0) {
        const ad = h('button.btn.btn-violet.btn-col', { type: 'button' }, h('span.btn-price', { html: icon('ad') }, h('span', { text: t('ad.watch') })), h('span.sub', { text: itemLabel }));
        onTap(ad, async () => {
          adPending = true;
          p.close();
          const ok = await showRewardedAd('hint');
          if (ok) {
            grant({ hints: 1 });
            got = true;
          }
          resolve(got);
        });
        foot.push(ad);
      }
      const p = openPopup({
        id: 'out-' + kind,
        title,
        body,
        foot,
        onClose: () => {
          if (!adPending) setTimeout(() => resolve(got), 0);
        },
      });
    });
  }

  function notEnoughCoins(price: number) {
    const need = price - store.data.coins;
    const body = h('div.center', null,
      h('div', { html: icon('coin'), style: { fontSize: '64px', display: 'flex', justifyContent: 'center', marginBottom: '8px' } }),
      h('p', { text: t('notEnough.body', { n: need }), style: { margin: '0', fontSize: '16px', color: 'var(--ink-2)' } }),
    );
    const shopBtn = button(t('notEnough.toShop'), () => {
      p.close();
      pauseSilently();
      go('shop', { section: 'coins', overlay: true });
    }, { variant: 'jade', icon: icon('shop') });
    const p = openPopup({ id: 'not-enough', title: t('notEnough.title'), body, foot: shopBtn });
  }

  // ---------- Pause ----------
  function pauseSilently() {
    if (phase === 'running' || phase === 'prestart' || phase === 'frozen') {
      pausedFrom = phase;
      phase = 'paused';
      audio.beatStop();
    }
  }

  function pause(showMenu: boolean) {
    if (!ctx) return;
    pauseSilently();
    if (!showMenu || pausePopup?.isOpen()) return;
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      button(t('play.resume'), () => pausePopup?.close(), { variant: 'jade', size: 'lg', icon: icon('play'), block: true }),
      button(t('play.restart'), () => { pausePopup?.close(); restart(); }, { variant: 'ghost', icon: icon('restart'), block: true }),
      h('div.row', { style: { gap: '12px' } },
        button(t('common.settings'), () => openSettingsPopup(), { variant: 'ghost', icon: icon('gear'), cls: 'grow' }),
        button(t('play.toMap'), () => { pausePopup?.close(); leave(); }, { variant: 'ghost', icon: icon('journey'), cls: 'grow' }),
      ),
      h('p', { text: t('play.restartFree'), style: { margin: '2px 0 0', textAlign: 'center', fontSize: '13.5px', color: 'var(--ink-3)', fontWeight: '600' } }),
    );
    pausePopup = openPopup({ id: 'pause', title: t('play.pause'), body, onClose: () => resume() });
  }

  function resume() {
    if (phase !== 'paused') return;
    phase = pausedFrom;
    if (phase === 'running' || phase === 'prestart') {
      nextBeatAt = performance.now() + beatMs;
      audio.beatStart(beatMs, nextBeatAt);
    }
    kick();
  }

  function leave() {
    pauseSilently();
    closeAllPopups();
    if (ctx?.mode === 'daily') go('daily', undefined, { resetHistory: true });
    else go('chapter', { chapter: ctx ? ctx.chapter : 0 }, { resetHistory: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && visible && (phase === 'running' || phase === 'prestart' || phase === 'frozen')) pause(true);
  });

  // ---------- Win ----------
  function win() {
    if (!sim || !ctx || resultShown) return;
    resultShown = true;
    phase = 'won';
    audio.beatStop();
    pointer.classList.add('hidden');
    bubble.classList.add('hidden');
    renderer.setGhosts(null);
    const sealed = clean && ctx.mode === 'campaign';
    audio.win(sealed);
    buzz('success');
    let campaign: ClearResult | null = null;
    let daily: DailyClearResult | null = null;
    if (ctx.mode === 'campaign') campaign = recordClear(ctx.def.id, sealed);
    else daily = recordDailyClear(ctx.index as 0 | 1 | 2);
    let shown = false;
    const showResult = () => {
      if (shown) return;
      shown = true;
      skipLayer.remove();
      if (campaign) openResultSheet(campaign, sealed);
      else if (daily) openDailySheet(daily);
    };
    // Tap anywhere to skip the finishing animation.
    const skipLayer = h('div', { style: { position: 'absolute', inset: '0', zIndex: '20' } });
    skipLayer.addEventListener('pointerdown', () => {
      renderer.skipWin();
    });
    el.appendChild(skipLayer);
    renderer.playWin(sealed, () => setTimeout(showResult, 120));
    kick();
  }

  function shrinkBoard() {
    // Keep the finished picture visible above the result sheet.
    requestAnimationFrame(() => {
      const sheetH = sheet.offsetHeight;
      const wrapRect = boardWrap.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const avail = elRect.height - sheetH - (wrapRect.top - elRect.top) - 8;
      const scale = Math.max(0.42, Math.min(1, avail / wrapRect.height));
      boardWrap.style.transform = `scale(${scale.toFixed(3)})`;
    });
  }

  function openResultSheet(r: ClearResult, sealed: boolean) {
    if (!ctx) return;
    const c = ctx;
    sheet.innerHTML = '';
    const stamp = h('div.seal-stamp', { html: icon('seal') });
    const head = h('div.result-head', null, h('h2', { text: t('result.complete') }), sealed ? stamp : null);
    const chips = h('div.result-sub');
    if (sealed) chips.appendChild(h('span.chip.accent', { html: icon('seal') }, h('span', { text: r.newSeal ? t('result.seal') : t('result.firstTry') })));
    if (!r.firstClear) chips.appendChild(h('span.chip', { text: t('result.alreadyCleared') }));
    if (!sealed && r.firstClear) chips.appendChild(h('span.chip', { text: t('result.sealHelp'), style: { whiteSpace: 'normal', height: 'auto', padding: '6px 12px', textAlign: 'center', lineHeight: '1.3' } }));

    let coinBox: HTMLElement | null = null;
    let doubled = false;
    if (r.coins > 0) {
      const val = h('b', { text: '0' });
      const parts: string[] = [];
      if (r.levelCoins) parts.push(t('result.levelCoins') + ' ' + fmt(r.levelCoins));
      if (r.sealCoins) parts.push(t('result.sealBonus') + ' ' + fmt(r.sealCoins));
      coinBox = h('div.result-coins', { html: icon('coin') }, val, h('div.breakdown', { html: parts.map((p) => `<div>${p}</div>`).join('') }));
      setTimeout(() => {
        countUp(val, 0, r.coins, 700, (n) => '+' + fmt(n));
        audio.coins(Math.min(10, Math.ceil(r.coins / 5)));
      }, 350);
    }

    const ch = CHAPTERS[r.chapterIndex];
    const stats = chapterStats(r.chapterIndex);
    const thumb = h('div.thumb', { html: paintingSVG(r.chapterIndex, Math.max(0, stats.cleared - (r.revealed >= 0 ? 1 : 0)), { idPrefix: 'res' }) });
    const bar = h('i', { style: { width: ((stats.cleared - (r.revealed >= 0 ? 1 : 0)) / stats.total) * 100 + '%' } });
    const prog = h('div.result-progress', null, thumb, h('div.info', null,
      h('b', { text: t('chapter.' + ch.id + '.name') }),
      h('div.progress', null, bar),
      h('small', { text: t('chapter.progress', { n: stats.cleared, total: stats.total }) + ' · ' + t('chapter.seals', { n: stats.sealed, total: stats.total }) }),
    ));
    if (r.revealed >= 0) {
      setTimeout(() => {
        bar.style.width = (stats.cleared / stats.total) * 100 + '%';
        const svg = thumb.querySelector('svg') as SVGSVGElement | null;
        if (svg) try { revealRegion(svg, Math.min(PAINTING_REGIONS - 1, stats.cleared - 1), true); } catch { /* */ }
      }, 700);
    }

    const nextIdx = c.index + 1;
    const hasNext = nextIdx < ALL_LEVELS.length;
    const nextBtn = button(hasNext ? t('result.next') : t('result.map'), () => goNext(r), { size: 'lg', icon: icon(hasNext ? 'next' : 'journey') });
    const replay = h('div.side', null, iconButton(icon('restart'), () => { clean = true; resetAttempt(); }, { label: t('result.replay'), cls: 'mono' }), h('span', { text: t('result.replay') }));
    const mapBtn = h('div.side', null, iconButton(icon('journey'), () => leave(), { label: t('result.map') }), h('span', { text: t('result.map') }));
    const actions = h('div.sheet-actions', null, replay, nextBtn, mapBtn);

    let dbl: HTMLElement | null = null;
    if (r.coins > 0 && c.number > 5 && adsLeft('double') > 0) {
      dbl = button(t('result.double'), async () => {
        if (doubled) return;
        const ok = await showRewardedAd('double');
        if (!ok) return;
        doubled = true;
        const extra = r.coins * (LEVEL_REWARD.adMultiplier - 1);
        grant({ coins: extra });
        dbl!.classList.add('disabled');
        dbl!.querySelector('span')!.textContent = t('result.doubled');
        const val = coinBox?.querySelector('b');
        if (val) countUp(val as HTMLElement, r.coins, r.coins * LEVEL_REWARD.adMultiplier, 600, (n) => '+' + fmt(n));
        audio.coins(8);
      }, { variant: 'violet', size: 'sm', icon: icon('ad'), cls: 'double-btn' });
    }

    sheet.append(head, chips);
    if (coinBox) sheet.appendChild(coinBox);
    if (dbl) sheet.appendChild(dbl);
    sheet.append(prog, actions);
    openSheet();
    shrinkBoard();
    if (sealed) setTimeout(() => {
      stamp.classList.add('hit');
      audio.stamp();
      buzz('heavy');
    }, 260);
  }

  async function goNext(r: ClearResult) {
    if (!ctx) return;
    const c = ctx;
    // Milestone rewards first (already granted), then the chapter celebration.
    for (const m of r.sealMilestones) await showReward(m.reward, { title: t('chapter.sealRewardsTitle'), subtitle: t('chapter.sealGoal', { n: m.seals }) });
    if (r.chapterComplete) {
      await chapterCard(r.chapterIndex, true);
      await showReward(r.chapterComplete, { title: t('chapter.complete'), subtitle: t('chapter.' + CHAPTERS[r.chapterIndex].id + '.name') });
    }
    if (clearedCount() === DAILY.unlockAfterLevel && !store.data.seen['daily.unlocked']) {
      store.data.seen['daily.unlocked'] = 1;
      store.commit('seen');
      let goDaily = false;
      const body = h('div.center', null,
        h('div', { html: icon('daily'), style: { fontSize: '72px', display: 'flex', justifyContent: 'center', color: 'var(--accent)', marginBottom: '6px' } }),
        h('p', { text: t('journey.dailyOpenBody'), style: { margin: '0', fontSize: '16px', lineHeight: '1.55', color: 'var(--ink-2)', fontWeight: '600' } }),
      );
      const later = button(t('common.later'), () => p.close(), { variant: 'ghost', sound: 'back' });
      const goBtn = button(t('journey.dailyGo'), () => { goDaily = true; p.close(); }, { variant: 'jade' });
      const p = openPopup({ id: 'daily-open', title: t('journey.dailyOpenTitle'), body, foot: [later, goBtn] });
      audio.unlock2();
      await p.closed;
      if (goDaily) {
        go('daily', undefined, { resetHistory: true });
        return;
      }
    }
    const nextIdx = c.index + 1;
    const next = levelAt(nextIdx);
    if (!next) {
      const body = h('div.center', null, h('p', { text: t('story.epilogue'), style: { margin: '0', fontSize: '16.5px', lineHeight: '1.6', fontWeight: '600' } }));
      const ok = button(t('nav.daily'), () => p.close(), { variant: 'jade', size: 'lg', icon: icon('daily') });
      const p = openPopup({ id: 'epilogue', title: t('journey.allDone'), body, foot: ok });
      await p.closed;
      go('daily', undefined, { resetHistory: true });
      return;
    }
    startCampaign(nextIdx);
  }

  function openDailySheet(r: DailyClearResult) {
    sheet.innerHTML = '';
    const head = h('div.result-head', null, h('h2', { text: t('result.dailyDone') }));
    const chips = h('div.result-sub', null, h('span.chip.gold', { html: icon('streak') }, h('span', { text: t('daily.streakDays', { n: r.streak }) })));
    const total = (r.reward.coins || 0);
    let coinBox: HTMLElement | null = null;
    if (total > 0) {
      const val = h('b', { text: '0' });
      coinBox = h('div.result-coins', { html: icon('coin') }, val);
      setTimeout(() => {
        countUp(val, 0, total, 700, (n) => '+' + fmt(n));
        audio.coins(6);
      }, 350);
    }
    const backBtn = button(t('result.backToDaily'), async () => {
      if (r.streakUp) audio.streak();
      if (r.allDoneBonus) await showReward(r.allDoneBonus, { title: t('daily.allDoneTitle') });
      if (r.milestone) await showReward(r.milestone.reward, { title: t('daily.milestoneTitle'), subtitle: t('daily.streakDays', { n: r.milestone.days }) });
      go('daily', undefined, { resetHistory: true });
    }, { size: 'lg', variant: 'jade', icon: icon('daily') });
    const replay = h('div.side', null, iconButton(icon('restart'), () => resetAttempt(), { label: t('result.replay'), cls: 'mono' }), h('span', { text: t('result.replay') }));
    sheet.append(head, chips);
    if (coinBox) sheet.appendChild(coinBox);
    sheet.append(h('div.sheet-actions', null, replay, backBtn));
    openSheet();
    shrinkBoard();
    if (r.streakUp) setTimeout(() => audio.streak(), 500);
  }

  // ---------- Debug autoplay (dev builds, E2E tests) ----------
  let autoplay = false;
  function autoplayTick(now: number) {
    if (!sim || !ctx || anyPopupOpen()) return;
    if (phase === 'won' || phase === 'lost' || phase === 'paused') return;
    const s = ctx.def.solution[sim.drops.length];
    if (!s) return;
    const idx = sim.idx(s.x, s.y);
    if (phase === 'idle' || phase === 'prestart') {
      if (s.t === 0) tryDrop(idx, now, true);
    } else if (s.t === sim.tick) tryDrop(idx, now, true);
  }
  debugHooks.autoplay = (on: boolean) => {
    autoplay = on;
    if (on && sim && sim.drops.length) resetAttempt();
    kick();
  };
  debugHooks.cellCenter = (idx: number) => {
    const r = renderer.cellRect(idx);
    const b = canvas.getBoundingClientRect();
    return { x: b.left + r.x + r.size / 2, y: b.top + r.y + r.size / 2 };
  };
  debugHooks.info = () => (ctx && sim ? { w: sim.w, h: sim.h, solution: ctx.def.solution, droppable: Array.from(sim.ink.keys()).filter((i) => sim!.canDrop(i)) } : null);
  debugHooks.setTimeScale = (k: number) => {
    timeScale = Math.max(0.25, k);
    if (ctx) beatMs = computeBeatMs(ctx);
  };
  debugHooks.state = () => ({ phase, tick: sim?.tick ?? 0, drops: sim?.drops.length ?? 0, level: ctx?.def.id ?? null, mode: ctx?.mode ?? null, sealedEligible: clean });
  debugHooks.solveNow = () => {
    if (!sim || !ctx) return;
    const r = runSolutionNow();
    if (r) {
      sim = r;
      renderer.setSim(sim);
      decided = 'win';
      phase = 'running';
      evaluate(performance.now());
      kick();
    }
  };
  function runSolutionNow(): Sim | null {
    if (!ctx) return null;
    const s = new Sim(ctx.L);
    const pending = ctx.def.solution.slice();
    let guard = 0;
    while (guard++ < 400) {
      while (pending.length && pending[0].t <= s.tick) {
        const d = pending.shift()!;
        s.drop(s.idx(d.x, d.y));
      }
      if (!pending.length && s.settled()) break;
      s.step();
    }
    return s;
  }

  // ---------- Entry points ----------
  function startCampaign(index: number) {
    const def = levelAt(index);
    if (!def) return;
    const info = levelInfo(def.id)!;
    closeAllPopups();
    openLevel({ mode: 'campaign', def, L: parseLevel(def), index, chapter: info.chapter.index, number: info.number, guided: !!def.guided });
  }

  function startDaily(tier: number) {
    const set = todaySet();
    const p = set[tier];
    if (!p) return;
    closeAllPopups();
    openLevel({ mode: 'daily', def: p.def, L: parseLevel(p.def), index: tier, chapter: Math.min(CHAPTERS.length - 1, 1 + tier * 3), number: 0, guided: false });
  }

  return {
    id: 'play',
    el,
    show(params?: { levelId?: string; index?: number; daily?: number; resume?: boolean }) {
      visible = true;
      if (params && params.resume && ctx) {
        audio.setMusic('play', ctx.chapter);
        layout();
        updateBoosters();
        if (phase === 'paused') pause(true);
        kick();
        return;
      }
      if (params && params.daily !== undefined) startDaily(params.daily);
      else if (params && params.levelId) {
        const info = levelInfo(params.levelId);
        if (info) startCampaign(info.index);
      } else if (params && params.index !== undefined) startCampaign(params.index);
      layout();
      kick();
    },
    hide() {
      visible = false;
      pauseSilently();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      audio.beatStop();
      audio.setMusic('menu');
    },
    back() {
      if (phase === 'won' || phase === 'lost') {
        leave();
        return true;
      }
      pause(true);
      return true;
    },
  };
}
