/*
 * Play screen shell. Owns everything around the puzzle: layout, title, boosters bar, tutorial
 * pointer, intro cards, pause, fail and result sheets, rewards and progress. The rules and the
 * input handling live in a core (src/play/*) chosen by the build variant.
 */
import './play.css';
import { parseLevel, type LevelDef } from '../core/sim.ts';
import { BoardRenderer } from '../render/board.ts';
import { paintingSVG, revealRegion, PAINTING_REGIONS } from '../render/paintings.ts';
import { h, onTap, iconButton, button, countUp, lockInput } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { openPopup, closeAllPopups, anyPopupOpen, type PopupHandle } from '../ui/popup.ts';
import { showReward } from '../ui/reward.ts';
import { go, type Screen } from '../ui/router.ts';
import { openSettingsPopup } from '../ui/topbar.ts';
import { store } from '../state/store.ts';
import { grant, spendCoins, useItem } from '../state/economy.ts';
import { recordClear, recordFail, chapterStats, clearedCount, type ClearResult } from '../state/progress.ts';
import { todaySet, recordDailyClear, type DailyClearResult } from '../state/daily.ts';
import { levelInfo, levelAt, CHAPTERS, ALL_LEVELS } from '../levels/pack.ts';
import { PRICES, LEVEL_REWARD, DAILY, ADS } from '../config/balance.ts';
import { adsLeft, showRewardedAd } from '../services/ads.ts';
import { audio } from '../audio/index.ts';
import { buzz } from '../services/feedback.ts';
import { t, fmt, onLangChange } from '../i18n/i18n.ts';
import { V } from '../variants/index.ts';
import { CORES } from '../play/registry.ts';
import { ruleDiagramFor } from '../play/rules.ts';
import type { Core, CoreHost, LevelCtx, BoosterId, FailInfo } from '../play/core.ts';

/** Hooks for the debug panel and automated tests (dev builds only). */
export const debugHooks: {
  autoplay: (on: boolean) => void;
  state: () => any;
  solveNow: () => void;
  setTimeScale: (k: number) => void;
  cellCenter: (idx: number) => { x: number; y: number };
  info: () => any;
} = { autoplay: () => {}, state: () => null, solveNow: () => {}, setTimeScale: () => {}, cellCenter: () => ({ x: 0, y: 0 }), info: () => null };

export function createPlayScreen(): Screen {
  // ---------- DOM ----------
  const el = h('section.play');
  const titleB = h('b');
  const titleS = h('small');
  const pauseBtn = iconButton(icon('pause'), () => pause(true), { label: t('play.pause') });
  const backBtn = iconButton(icon('back'), () => leave(), { label: t('common.back'), sound: 'back' });
  const topbar = h('header.topbar', null, backBtn, h('div.play-title', null, titleB, titleS), pauseBtn);

  const status = h('div.status-slot', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const coach = h('div.coach');
  const beatRow = h('div.beat-row', null, status, coach);

  const canvas = h('canvas') as HTMLCanvasElement;
  const pointer = h('div.pointer.hidden', { html: icon('hand') });
  const bubble = h('div.pointer-bubble.hidden');
  const boardWrap = h('div.board-wrap', null, canvas, pointer, bubble);

  const tray = h('div.queue', { 'aria-label': t('play.inks') });
  const boosters = h('div.boosters');
  const sheet = h('div.sheet');

  el.append(topbar, beatRow, boardWrap, tray, boosters, sheet);

  // ---------- State ----------
  const renderer = new BoardRenderer(canvas, boardOpts());
  let ctx: LevelCtx | null = null;
  let clean = true; // seal eligibility for this attempt
  let attemptDirty = false; // the player did something in this attempt
  let outcome: null | 'won' | 'lost' = null;
  let raf = 0;
  let coachTimer = 0;
  let visible = false;
  let pausePopup: PopupHandle | null = null;
  let lastDraw = 0;

  function boardOpts() {
    const s = store.data;
    return { ink: s.cosmetics.ink, paper: s.cosmetics.paper, symbols: s.settings.symbols, reducedMotion: s.settings.reducedMotion };
  }

  // ---------- Host for the core ----------
  const host: CoreHost = {
    renderer,
    boardWrap,
    status,
    tray,
    root: el,
    get ctx() {
      return ctx;
    },
    say,
    hush,
    kick,
    win: () => win(),
    fail: (info) => fail(info),
    taint: () => {
      clean = false;
    },
    touched: () => {
      attemptDirty = true;
    },
    updateBoosters: () => updateBoosters(),
    point,
    spendItem,
    isHinted: () => !!(ctx && store.data.hinted[ctx.def.id]),
    setHinted: () => {
      if (!ctx) return;
      store.data.hinted[ctx.def.id] = 1;
      store.commit('progress');
    },
    resetAttempt: () => resetAttempt(),
    unfail: () => {
      outcome = null;
      closeSheet();
      boardWrap.style.transform = '';
    },
    isVisible: () => visible,
  };
  const core: Core = CORES[V.core](host);

  // ---------- Boosters bar: Restart + the core's ----------
  interface BoosterUI { id: BoosterId | 'restart'; wrap: HTMLElement; count: HTMLElement | null; label: HTMLElement; labelKey: string; item?: 'hints' | 'rewinds' }
  const boosterUI: BoosterUI[] = [];
  {
    const restartBtn = iconButton(icon('restart'), () => restart(), { label: t('play.retry'), cls: 'mono' });
    const lbl = h('span', { text: t('play.retry') });
    const wrap = h('div.booster', null, restartBtn, lbl);
    boosters.appendChild(wrap);
    boosterUI.push({ id: 'restart', wrap, count: null, label: lbl, labelKey: 'play.retry' });
    for (const b of core.boosters) {
      const btn = iconButton(icon(b.icon), () => {
        if (!ctx || outcome === 'won') return;
        core.booster(b.id);
      }, { label: t(b.label), cls: b.item ? '' : 'mono' });
      const count = h('i.count');
      btn.appendChild(count);
      const l = h('span', { text: t(b.label) });
      const w = h('div.booster', null, btn, l);
      boosters.appendChild(w);
      boosterUI.push({ id: b.id, wrap: w, count, label: l, labelKey: b.label, item: b.item });
    }
  }

  function updateBoosters() {
    const d = store.data;
    sheet.querySelectorAll<HTMLElement>('[data-live]').forEach((e) => {
      const n = d[e.dataset.live as 'hints' | 'rewinds'];
      e.textContent = n > 0 ? fmt(n) : '+';
      e.classList.toggle('plus', !(n > 0));
    });
    if (!ctx) return;
    for (const b of boosterUI) {
      if (b.id === 'restart') continue;
      const over = core.boosterCount?.(b.id);
      let text = '';
      if (over !== undefined && over !== null) text = over;
      else if (b.item) text = d[b.item] > 0 ? fmt(d[b.item]) : '+';
      b.count!.textContent = text;
      b.count!.style.display = text ? '' : 'none';
      b.count!.classList.toggle('plus', text === '+');
      b.wrap.classList.toggle('off', !core.boosterEnabled(b.id));
    }
  }

  store.on('cosmetics', () => {
    renderer.setOptions(boardOpts());
    if (ctx) core.refresh?.();
    kick();
  });
  store.on('settings', () => {
    renderer.setOptions(boardOpts());
    if (ctx) core.refresh?.();
    kick();
  });
  store.on('wallet', updateBoosters);
  onLangChange(() => {
    if (ctx) setTitle();
    for (const b of boosterUI) b.label.textContent = t(b.labelKey);
  });

  // ---------- Layout ----------
  const ro = new ResizeObserver(() => layout());
  ro.observe(boardWrap);
  function layout() {
    const w = boardWrap.clientWidth, hh = boardWrap.clientHeight;
    if (!w || !hh) return;
    renderer.layout(w, hh, Math.min(2, window.devicePixelRatio || 1));
    replacePointer();
    kick();
  }

  // ---------- Coach line & pointer ----------
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

  let pointing: { idx: number; text?: string; hand?: boolean; now?: boolean } | null = null;
  function point(idx: number | null, text?: string, opts: { hand?: boolean; now?: boolean } = {}) {
    pointing = idx === null || idx < 0 ? null : { idx, text, hand: opts.hand, now: opts.now };
    replacePointer();
  }

  function replacePointer() {
    if (!pointing || outcome || anyPopupOpen()) {
      pointer.classList.add('hidden');
      bubble.classList.add('hidden');
      return;
    }
    const r = renderer.cellRect(pointing.idx);
    if (!r || !r.size) return;
    const cx = r.x + r.size / 2, cy = r.y + r.size / 2;
    pointer.classList.toggle('hidden', !pointing.hand);
    pointer.style.left = cx - 26 + 'px';
    pointer.style.top = cy + r.size * 0.18 - 6 + 'px';
    if (pointing.text) {
      if (bubble.textContent !== pointing.text) bubble.textContent = pointing.text;
      bubble.classList.remove('hidden');
      bubble.classList.toggle('now', !!pointing.now);
      const bw = bubble.offsetWidth || 120;
      const W = boardWrap.clientWidth;
      bubble.style.left = Math.max(6, Math.min(W - bw - 6, cx - bw / 2)) + 'px';
      bubble.style.top = Math.max(2, r.y - 46) + 'px';
    } else bubble.classList.add('hidden');
  }

  // ---------- Level setup ----------
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
    clean = true;
    setTitle();
    status.innerHTML = '';
    tray.innerHTML = '';
    pointing = null;
    outcome = null;
    attemptDirty = false;
    closeSheet();
    boardWrap.style.transform = '';
    core.start();
    updateBoosters();
    layout();
    kick();
    audio.setMusic('play', c.chapter);
    queueIntroCards();
  }

  function resetAttempt() {
    if (!ctx) return;
    outcome = null;
    attemptDirty = false;
    closeSheet();
    boardWrap.style.transform = '';
    core.reset();
    updateBoosters();
    layout();
    kick();
  }

  function restart() {
    if (!ctx) return;
    if (attemptDirty) {
      clean = false;
      if (ctx.mode === 'campaign' && outcome !== 'lost') recordFail(ctx.def.id);
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
    core.pause();
    (async () => {
      for (const s of steps) await s();
      core.resume();
      replacePointer();
      kick();
    })();
  }

  function ruleCard(m: string): Promise<void> {
    store.data.seen['mech.' + m] = 1;
    store.commit('seen');
    const body = h('div.rule-card', null,
      h('div.kicker', null, h('span.chip.accent', { text: t('mech.new') })),
      h('div.diagram', null, ruleDiagramFor(m)),
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
        try { revealRegion(svg, PAINTING_REGIONS - 1, true); } catch { /* */ }
      }
    }
    return p.closed;
  }

  // ---------- Input ----------
  function cellFromEvent(e: PointerEvent): { idx: number; x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return { idx: renderer.cellAt(x, y), x, y };
  }

  let activePointer = -1;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.unlock();
    if (!ctx || anyPopupOpen() || outcome || core.isOver()) return;
    if (activePointer >= 0 && activePointer !== e.pointerId) return; // ignore a second finger
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    const p = cellFromEvent(e);
    core.pointerDown(p.idx, p.x, p.y, performance.now());
    kick();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !ctx || !core.pointerMove) return;
    const p = cellFromEvent(e);
    core.pointerMove(p.idx, p.x, p.y, performance.now());
    kick();
  });
  const endPointer = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = -1;
    if (!ctx || !core.pointerUp) return;
    const p = cellFromEvent(e);
    core.pointerUp(p.idx, p.x, p.y, performance.now());
    kick();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // ---------- Frame loop ----------
  function kick() {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  function frame(now: number) {
    raf = 0;
    if (!visible || !ctx) return;
    const busy = core.frame(now);
    // While nothing time-critical runs only gentle ambient motion remains: draw it at ~30 fps.
    if (!busy && now - lastDraw < 31 && lastDraw > 0) {
      kick();
      return;
    }
    lastDraw = now;
    const animating = renderer.render(now);
    if (animating || busy) kick();
    else lastDraw = 0;
  }

  // ---------- Fail ----------
  function fail(info: FailInfo) {
    if (!ctx || outcome) return;
    outcome = 'lost';
    clean = false;
    if (ctx.mode === 'campaign') recordFail(ctx.def.id);
    renderer.showWrong(info.cells);
    audio.wrong();
    buzz('error');
    point(null);
    kick();
    setTimeout(() => {
      if (outcome === 'lost' && visible) openFailSheet(info);
    }, 650);
  }

  function openFailSheet(info: FailInfo) {
    sheet.innerHTML = '';
    const retry = button(t('play.retry'), () => restart(), { size: 'lg', icon: icon('restart') });
    const sides = core.failActions.map((id) => {
      const spec = core.boosters.find((b) => b.id === id)!;
      const over = core.boosterCount?.(id);
      const count = over !== undefined && over !== null ? -1 : spec.item ? store.data[spec.item] : -1;
      const s = sideButton(spec.icon, t(spec.label), () => core.booster(id), count, spec.item);
      if (!core.boosterEnabled(id) && id === 'undo') s.classList.add('off');
      return s;
    });
    const actions = h('div.sheet-actions');
    if (sides[0]) actions.appendChild(sides[0]);
    actions.appendChild(retry);
    for (const s of sides.slice(1)) actions.appendChild(s);
    sheet.append(h('h2', { text: t('fail.title') }), h('p', { text: info.text }));
    if (info.tip) sheet.appendChild(h('div.tip', { html: icon('hint') }, h('span', { text: info.tip })));
    sheet.appendChild(actions);
    openSheet();
    shrinkBoard();
  }

  function sideButton(ic: any, label: string, fn: () => void, count: number, item?: 'hints' | 'rewinds'): HTMLElement {
    const b = iconButton(icon(ic), fn, { label });
    if (count >= 0) b.appendChild(h('i.count' + (count > 0 ? '' : '.plus'), { text: count > 0 ? fmt(count) : '+', dataset: item ? { live: item } : undefined }));
    return h('div.side', null, b, h('span', { text: label }));
  }

  function openSheet() {
    requestAnimationFrame(() => sheet.classList.add('open'));
    lockInput(300);
  }

  function closeSheet() {
    sheet.classList.remove('open');
  }

  // ---------- Items ----------
  async function spendItem(kind: 'hints' | 'rewinds'): Promise<boolean> {
    if (store.data[kind] <= 0) {
      const got = await outOfItem(kind);
      if (!got) return false;
    }
    return useItem(kind);
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
    const foot: HTMLElement[] = [];
    const adCoins = ADS.coinsReward.coins || 0;
    if (adsLeft('coins') > 0 && adCoins > 0) {
      foot.push(button(t('notEnough.watchAd', { n: adCoins }), async () => {
        p.close();
        const ok = await showRewardedAd('coins');
        if (!ok) return;
        grant(ADS.coinsReward);
        await showReward(ADS.coinsReward);
      }, { variant: 'violet', icon: icon('ad'), block: true }));
    }
    foot.push(button(t('notEnough.toShop'), () => {
      p.close();
      core.pause();
      go('shop', { section: 'coins', overlay: true });
    }, { variant: 'jade', icon: icon('shop'), block: true }));
    const p = openPopup({ id: 'not-enough', title: t('notEnough.title'), body, foot, cls: 'nec-pop' });
  }

  // ---------- Pause ----------
  function pause(showMenu: boolean) {
    if (!ctx) return;
    core.pause();
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
    pausePopup = openPopup({ id: 'pause', title: t('play.pause'), body, onClose: () => { core.resume(); replacePointer(); } });
  }

  function leave() {
    core.pause();
    closeAllPopups();
    if (ctx?.mode === 'daily') go('daily', undefined, { resetHistory: true });
    else go('chapter', { chapter: ctx ? ctx.chapter : 0 }, { resetHistory: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && visible && core.isRunning()) pause(true);
  });

  // ---------- Win ----------
  function win() {
    if (!ctx || outcome) return;
    outcome = 'won';
    audio.beatStop();
    point(null);
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
    skipLayer.addEventListener('pointerdown', () => renderer.skipWin());
    el.appendChild(skipLayer);
    renderer.playWin(sealed, () => setTimeout(showResult, 120));
    updateBoosters();
    kick();
  }

  function shrinkBoard() {
    // Keep the finished picture visible above the sheet.
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
    if (V.daily && clearedCount() === DAILY.unlockAfterLevel && !store.data.seen['daily.unlocked']) {
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
      const ok = V.daily
        ? button(t('nav.daily'), () => p.close(), { variant: 'jade', size: 'lg', icon: icon('daily') })
        : button(t('nav.journey'), () => p.close(), { variant: 'jade', size: 'lg', icon: icon('journey') });
      const p = openPopup({ id: 'epilogue', title: t('journey.allDone'), body, foot: ok });
      await p.closed;
      go(V.daily ? 'daily' : 'journey', undefined, { resetHistory: true });
      return;
    }
    startCampaign(nextIdx);
  }

  function openDailySheet(r: DailyClearResult) {
    sheet.innerHTML = '';
    const head = h('div.result-head', null, h('h2', { text: t('result.dailyDone') }));
    const chips = h('div.result-sub', null, h('span.chip.gold', { html: icon('streak') }, h('span', { text: t('daily.streakDays', { n: r.streak }) })));
    const total = r.reward.coins || 0;
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

  // ---------- Debug hooks ----------
  debugHooks.autoplay = (on) => core.debug.autoplay(on);
  debugHooks.solveNow = () => core.debug.solveNow();
  debugHooks.setTimeScale = (k) => core.debug.setTimeScale?.(k);
  debugHooks.cellCenter = (idx: number) => {
    const r = renderer.cellRect(idx);
    const b = canvas.getBoundingClientRect();
    return { x: b.left + r.x + r.size / 2, y: b.top + r.y + r.size / 2 };
  };
  debugHooks.info = () => core.debug.info();
  debugHooks.state = () => {
    const s = core.debug.state() || {};
    return { ...s, phase: outcome || s.phase || 'playing', level: ctx?.def.id ?? null, mode: ctx?.mode ?? null, sealedEligible: clean };
  };

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
    const def: LevelDef = p.def;
    openLevel({ mode: 'daily', def, L: parseLevel(def), index: tier, chapter: Math.min(CHAPTERS.length - 1, 1 + tier * 3), number: 0, guided: false });
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
        if (!outcome) pause(true);
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
      core.pause();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      audio.beatStop();
      audio.setMusic('menu');
    },
    back() {
      if (outcome) {
        leave();
        return true;
      }
      pause(true);
      return true;
    },
  };
}
