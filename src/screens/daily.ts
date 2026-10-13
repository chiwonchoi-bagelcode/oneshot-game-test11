/*
 * Daily pictures (tab). Today's date and streak, the three puzzles, the all-three bonus, the next
 * streak reward (tap for the full list) and this month's record (tap for the calendar).
 * Locked until DAILY.unlockAfterLevel campaign levels are cleared. Built once, updated in place.
 */
import './meta.css';
import './daily.css';
import { h, onTap, button, iconButton } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { createTopbar } from '../ui/topbar.ts';
import { openPopup } from '../ui/popup.ts';
import { go, type Screen } from '../ui/router.ts';
import { store, today, addDays, msToMidnight } from '../state/store.ts';
import { clearedCount } from '../state/progress.ts';
import { DAILY } from '../config/balance.ts';
import { CHAR_TO_CODE, type LevelDef } from '../core/sim.ts';
import { inkSkin, paperSkin, inkForPaper } from '../render/skins.ts';
import { mix } from '../render/color.ts';
import {
  dailyUnlocked, todaySet, effectiveStreak, streakCountedToday, nextMilestone, milestonesThrough,
  milestoneClaimed, milestoneReward, type DailyPuzzle,
} from '../state/daily.ts';
import { t, fmt, getLang, onLangChange } from '../i18n/i18n.ts';
import { tn, fmtCountdown, everyMinute, rewardChips, fillRewardChips, offsetIn } from './meta-common.ts';

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function locale(): string {
  return getLang() === 'ko' ? 'ko-KR' : 'en-US';
}

function dayRecord(key: string) {
  return store.data.daily.days[key];
}

function clearedOn(key: string): number {
  const r = dayRecord(key);
  return r ? r.done.length : 0;
}

/** Small picture of a puzzle's goal in the player's current ink and paper. */
function goalSVG(def: LevelDef, done: boolean): string {
  const paper = paperSkin(store.data.cosmetics.paper);
  const ink = inkForPaper(inkSkin(store.data.cosmetics.ink), paper);
  const rows = def.map.length, cols = def.map[0].length;
  const S = 10, G = 1.5, P = 4;
  const W = cols * S + P * 2, H = rows * S + P * 2;
  const blank = mix(paper.base, paper.fiber, paper.dark ? 0.45 : 0.32);
  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="${W}" height="${H}" rx="7" fill="${paper.base}"/>`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const m = def.map[y][x], g = def.goal[y][x];
      if (m === ' ') continue;
      const cx = P + x * S + G / 2, cy = P + y * S + G / 2, s = S - G;
      const rect = (fill: string, extra = '') => `<rect x="${cx}" y="${cy}" width="${s}" height="${s}" rx="2.4" fill="${fill}"${extra}/>`;
      if (m === '#') {
        out += rect(paper.wall);
        continue;
      }
      const code = CHAR_TO_CODE[g];
      if (code) out += rect(done ? ink[code] : mix(paper.base, ink[code], 0.62));
      else if (g === 'w') out += rect('none', ` stroke="${paper.grid}" stroke-opacity=".7" stroke-width="1" stroke-dasharray="2 1.6"`);
      else out += rect(blank);
      const gate = m === 'R' || m === 'Y' || m === 'B' ? CHAR_TO_CODE[m] : 0;
      if (gate && !code) out += `<rect x="${cx + 1}" y="${cy + 1}" width="${s - 2}" height="${s - 2}" rx="2" fill="none" stroke="${ink[gate]}" stroke-width="1.6"/>`;
      const seed = m === 'r' || m === 'y' || m === 'b' ? CHAR_TO_CODE[m.toUpperCase()] : 0;
      if (seed) out += `<circle cx="${cx + s / 2}" cy="${cy + s / 2}" r="${s * 0.24}" fill="${ink[seed]}"/>`;
    }
  }
  return out + '</svg>';
}

export function createDailyScreen(): Screen {
  const top = createTopbar({ left: 'settings', wallet: ['coins', 'hints'] });
  const body = h('div.screen-body.daily-body');
  const el = h('section.daily', null, top.el, body);
  const updaters: (() => void)[] = [];
  const upd = (f: () => void) => updaters.push(f);
  const label = (e: HTMLElement, f: () => string) => upd(() => { e.textContent = f(); });

  const title = h('h1.screen-title');
  label(title, () => t('daily.title'));
  body.appendChild(title);

  // ---------- Locked ----------
  const lockBar = h('i');
  const lockNum = h('span.dl-num');
  const lockTitle = h('h2');
  const lockBody = h('p');
  const lockBtn = button('', () => go('journey', undefined, { resetHistory: true }), { size: 'lg', icon: icon('journey'), block: true });
  const locked = h('div.card.dly-locked', null,
    h('div.dl-art', { html: icon('daily') }, h('span.dl-lock', { html: icon('lock') })),
    lockTitle, lockBody,
    h('div.dl-prog', null, h('div.progress', null, lockBar), lockNum),
    lockBtn,
  );
  label(lockTitle, () => t('daily.locked.title', { n: DAILY.unlockAfterLevel }));
  label(lockBody, () => t('daily.locked.body'));
  label(lockBtn.querySelector('span')!, () => t('daily.locked.go'));
  upd(() => {
    const n = Math.min(DAILY.unlockAfterLevel, clearedCount());
    lockBar.style.width = (n / Math.max(1, DAILY.unlockAfterLevel)) * 100 + '%';
    lockNum.textContent = t('daily.locked.progress', { n, total: DAILY.unlockAfterLevel });
  });

  // ---------- Open ----------
  const open = h('div.dly-open');
  body.append(locked, open);

  // Streak hero
  const dateEl = h('div.dh-date');
  const streakNum = h('b.dh-num');
  const streakUnit = h('span.dh-unit');
  const bestEl = h('div.dh-best');
  const statusEl = h('div.dh-status');
  const nextLabel = h('span.dt-label');
  const nextDays = h('b.dt-days');
  const nextChips = h('div.rw-chips.dt-chips');
  const nextBar = h('i');
  const nextLeft = h('span.dt-left');
  const track = h('button.dly-track', { type: 'button' },
    h('div.dt-top', null, h('div.dt-text', null, nextLabel, nextDays), nextChips, h('span.dt-go', { html: icon('next') })),
    h('div.dt-bottom', null, h('div.progress', null, nextBar), nextLeft),
  );
  onTap(track, openMilestones);
  const hero = h('div.card.dly-hero', null,
    dateEl,
    h('div.dh-row', null, h('div.dh-flame', { html: icon('streak') }), h('div.dh-count', null, h('div.dh-big', null, streakNum, streakUnit), bestEl)),
    statusEl,
    track,
  );
  open.appendChild(hero);
  label(nextLabel, () => t('daily.next.label'));
  upd(() => {
    dateEl.textContent = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', weekday: 'long' }).format(keyToDate(today()));
    const st = effectiveStreak();
    streakNum.textContent = fmt(st);
    streakUnit.textContent = t('daily.streak.unit');
    bestEl.textContent = tn('daily.streak.best', Math.max(st, store.data.daily.best));
    const counted = streakCountedToday();
    statusEl.textContent = counted ? t('daily.streak.safe') : st > 0 ? t('daily.streak.keep', { n: st + 1 }) : t('daily.streak.start');
    statusEl.classList.toggle('safe', counted);
    hero.classList.toggle('lit', st > 0);
    const m = nextMilestone();
    track.classList.toggle('hidden', !m);
    if (m) {
      nextDays.textContent = t('daily.next.days', { n: m.days });
      fillRewardChips(nextChips, milestoneReward(m));
      const prev = milestonesThrough(m.days).filter((x) => x.days < m.days).pop();
      const from = prev ? prev.days : 0;
      nextBar.style.width = Math.max(4, Math.min(100, ((st - from) / Math.max(1, m.days - from)) * 100)) + '%';
      const left = m.days - st;
      nextLeft.textContent = left === 1 && !counted ? t('daily.next.today') : tn('daily.next.left', left);
    }
  });

  // Puzzles
  const puzzHead = h('div.section-title.dly-head', { html: icon('daily') }, h('span'), h('span.dly-reset'));
  const resetEl = puzzHead.lastElementChild as HTMLElement;
  label(puzzHead.children[1] as HTMLElement, () => t('daily.puzzles'));
  upd(() => { resetEl.textContent = t('daily.reset', { time: fmtCountdown(msToMidnight()) }); });
  const empty = h('div.card.dly-empty');
  label(empty, () => t('daily.empty'));
  open.append(puzzHead, empty);

  const cards = DAILY.tiers.map((_, tier) => {
    const thumb = h('div.dp-thumb');
    const stamp = h('span.dp-stamp');
    const name = h('b.dp-name');
    const pips = h('span.dp-pips');
    for (let i = 0; i < DAILY.tiers.length; i++) pips.appendChild(h('i' + (i <= tier ? '.on' : '')));
    const chips = rewardChips(DAILY.tiers[tier].reward, 'dp-reward');
    const go1 = h('span.btn.dp-btn', null, h('span'));
    const card = h('button.card.dly-puzzle.t' + tier, { type: 'button' },
      h('div.dp-art', null, thumb, stamp),
      h('div.dp-info', null, h('div.dp-title', null, name, pips), chips),
      go1,
    );
    onTap(card, () => play(tier));
    open.appendChild(card);
    let shown = '';
    return {
      card,
      update(p: DailyPuzzle | undefined) {
        card.classList.toggle('hidden', !p);
        if (!p) return;
        name.textContent = t('daily.tier.' + tier);
        stamp.textContent = t('daily.done');
        card.classList.toggle('done', p.done);
        go1.className = 'btn dp-btn' + (p.done ? ' btn-ghost btn-sm' : '');
        go1.firstElementChild!.textContent = p.done ? t('daily.replay') : t('daily.play');
        chips.classList.toggle('claimed', p.done);
        const key = p.def.id + (p.done ? ':d' : ':o') + store.data.cosmetics.ink + store.data.cosmetics.paper;
        if (key !== shown) {
          thumb.innerHTML = goalSVG(p.def, p.done);
          shown = key;
        }
      },
    };
  });

  // All-three bonus
  const bonusTitle = h('b.db-title');
  const bonusPips = h('span.db-pips');
  for (let i = 0; i < DAILY.tiers.length; i++) bonusPips.appendChild(h('i'));
  const bonusNum = h('span.db-num');
  const bonusChips = rewardChips(DAILY.allDoneBonus, 'db-chips');
  const bonusDone = h('span.db-done', { html: icon('check') }, h('span'));
  const bonus = h('div.card.dly-bonus', null,
    h('div.db-ico', { html: icon('chest') }),
    h('div.grow', null, bonusTitle, bonusChips, bonusDone),
    h('div.db-prog', null, bonusNum, bonusPips),
  );
  open.appendChild(bonus);
  label(bonusTitle, () => t('daily.bonus.title'));
  label(bonusDone.lastElementChild as HTMLElement, () => t('daily.bonus.claimed'));

  // Month record (tap → calendar)
  const calTitle = h('b');
  const calCount = h('span.dc-count');
  const calOpen = h('span.dc-open', null, h('span'), h('i', { html: icon('next') }));
  label(calTitle, () => t('daily.cal.title'));
  label(calOpen.firstElementChild as HTMLElement, () => t('daily.cal.open'));
  const week = h('div.dc-week');
  const weekCells = Array.from({ length: 7 }, () => {
    const wd = h('small');
    const num = h('span.dc-n');
    const cell = h('div.dc-day', null, wd, num);
    week.appendChild(cell);
    return { cell, wd, num };
  });
  const cal = h('button.card.dly-cal', { type: 'button' },
    h('div.dc-head', null, h('div.grow', null, calTitle, calCount), calOpen),
    week,
  );
  onTap(cal, () => openCalendar());
  open.appendChild(cal);
  upd(() => {
    const now = today();
    const d = keyToDate(now);
    const start = addDays(now, -d.getDay());
    const wf = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
    weekCells.forEach((c, i) => {
      const key = addDays(start, i);
      const kd = keyToDate(key);
      c.wd.textContent = wf.format(kd);
      c.num.textContent = String(kd.getDate());
      const n = clearedOn(key);
      c.cell.className = 'dc-day' + (n > 0 ? ' got' : '') + (n >= DAILY.tiers.length ? ' all' : '') + (key === now ? ' today' : '') + (key > now ? ' future' : '');
    });
    const ym = now.slice(0, 7);
    let n = 0;
    for (const k in store.data.daily.days) if (k.startsWith(ym) && clearedOn(k) > 0) n++;
    calCount.textContent = tn('daily.cal.countMonth', n);
  });

  // Puzzle + bonus state
  upd(() => {
    const unlocked = dailyUnlocked();
    locked.classList.toggle('hidden', unlocked);
    open.classList.toggle('hidden', !unlocked);
    if (!unlocked) return;
    const set = todaySet();
    empty.classList.toggle('hidden', set.length > 0);
    cards.forEach((c, i) => c.update(set[i]));
    const done = set.filter((p) => p.done).length;
    const total = DAILY.tiers.length;
    Array.from(bonusPips.children).forEach((p, i) => p.classList.toggle('on', i < done));
    bonusNum.textContent = t('daily.bonus.progress', { n: done, total });
    const claimed = !!dayRecord(today())?.bonus;
    bonus.classList.toggle('claimed', claimed);
    bonusChips.classList.toggle('hidden', claimed);
    bonusDone.classList.toggle('hidden', !claimed);
  });

  function play(tier: number) {
    const set = todaySet();
    if (!set[tier]) return;
    go('play', { daily: tier });
  }

  // ---------- Milestones popup ----------
  function openMilestones() {
    const st = effectiveStreak();
    const next = nextMilestone();
    const list = h('div.ms-list');
    const listed = DAILY.streakMilestones;
    const all = milestonesThrough(Math.max(st, store.data.daily.best)).filter((m) => !m.repeat || milestoneClaimed(m.days) || (next && m.days === next.days));
    for (const m of all) {
      const claimed = milestoneClaimed(m.days);
      const isNext = !!next && next.days === m.days;
      const status = claimed
        ? h('span.ms-status.ok', { html: icon('check') }, h('span', { text: t('daily.ms.claimed') }))
        : isNext ? h('span.ms-status.next', { text: t('daily.ms.next') }) : h('span.ms-status', { html: icon('lock') });
      list.appendChild(h('div.ms-row' + (claimed ? '.claimed' : '') + (isNext ? '.next' : ''), null,
        h('div.ms-day', null, h('b', { text: fmt(m.days) }), h('small', { text: tn('daily.ms.unit', m.days) })),
        rewardChips(claimed ? m.reward : milestoneReward(m), 'ms-chips'),
        status,
      ));
    }
    if (DAILY.repeatEvery > 0 && listed.length) {
      list.appendChild(h('div.ms-row.repeat', null,
        h('div.ms-day', { html: icon('restart') }),
        h('div.grow', null, h('div.ms-rep', { text: t('daily.ms.repeat', { last: listed[listed.length - 1].days, n: DAILY.repeatEvery }) }), rewardChips(DAILY.repeatReward, 'ms-chips')),
      ));
    }
    const bodyEl = h('div.ms-body', null,
      h('div.ms-now', { html: icon('streak') }, h('b', { text: t('daily.streakDays', { n: st }) }), h('span', { text: tn('daily.streak.best', Math.max(st, store.data.daily.best)) })),
      h('p.ms-intro', { text: t('daily.ms.body') }),
      list,
    );
    const p = openPopup({ id: 'daily-milestones', title: t('daily.ms.title'), body: bodyEl, cls: 'ms-pop' });
    // Bring the next reward into view.
    requestAnimationFrame(() => {
      const row = p.body.querySelector<HTMLElement>('.ms-row.next');
      if (row) p.body.scrollTop = Math.max(0, offsetIn(row, p.body) - p.body.clientHeight / 2 + row.offsetHeight / 2);
    });
  }

  // ---------- Calendar popup ----------
  function openCalendar() {
    const now = today();
    let ym = now.slice(0, 7);
    const first = (() => {
      let min = now.slice(0, 7);
      for (const k in store.data.daily.days) if (clearedOn(k) > 0 && k.slice(0, 7) < min) min = k.slice(0, 7);
      return min;
    })();
    const monthEl = h('b.cal-month');
    const countEl = h('div.cal-count');
    const grid = h('div.cal-grid');
    const prev = iconButton(icon('back'), () => shift(-1), { label: t('daily.cal.prev'), cls: 'sm' });
    const next = iconButton(icon('next'), () => shift(1), { label: t('daily.cal.next'), cls: 'sm' });
    const wf = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
    const heads = h('div.cal-grid.cal-wd');
    for (let i = 0; i < 7; i++) heads.appendChild(h('small', { text: wf.format(new Date(2024, 8, 1 + i, 12)) }));
    const legend = h('div.cal-legend', null,
      h('span', null, h('i.cal-dot'), h('span', { text: t('daily.cal.legend.one') })),
      h('span', null, h('i.cal-dot.all'), h('span', { text: t('daily.cal.legend.all') })),
    );
    const bodyEl = h('div.cal-body', null, h('div.cal-nav', null, prev, monthEl, next), heads, grid, countEl, legend);
    function shift(d: number) {
      const [y, m] = ym.split('-').map(Number);
      const dt = new Date(y, m - 1 + d, 1, 12);
      const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      if (key < first || key > now.slice(0, 7)) return;
      ym = key;
      render();
    }
    function render() {
      const [y, m] = ym.split('-').map(Number);
      monthEl.textContent = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long' }).format(new Date(y, m - 1, 1, 12));
      prev.classList.toggle('disabled', ym <= first);
      next.classList.toggle('disabled', ym >= now.slice(0, 7));
      grid.textContent = '';
      const startDow = new Date(y, m - 1, 1, 12).getDay();
      const days = new Date(y, m, 0, 12).getDate();
      for (let i = 0; i < startDow; i++) grid.appendChild(h('span.cal-c.pad'));
      let n = 0;
      for (let d = 1; d <= days; d++) {
        const key = ym + '-' + String(d).padStart(2, '0');
        const c = clearedOn(key);
        if (c > 0) n++;
        grid.appendChild(h('span.cal-c' + (c > 0 ? '.got' : '') + (c >= DAILY.tiers.length ? '.all' : '') + (key === now ? '.today' : '') + (key > now ? '.future' : ''), null, h('span', { text: String(d) })));
      }
      countEl.textContent = tn('daily.cal.countMonth', n);
    }
    render();
    openPopup({ id: 'daily-calendar', title: t('daily.cal.popup'), body: bodyEl, cls: 'cal-pop' });
  }

  // ---------- Updates ----------
  function refresh() {
    for (const f of updaters) f();
  }
  store.on('daily', refresh);
  store.on('progress', refresh);
  store.on('cosmetics', refresh);
  onLangChange(refresh);
  refresh();

  let stop: (() => void) | null = null;
  return {
    id: 'daily',
    el,
    tab: true,
    show() {
      refresh();
      stop?.();
      stop = everyMinute(() => {
        // A new day while the screen is open: the countdown and the puzzles roll over in place.
        refresh();
      });
    },
    hide() {
      stop?.();
      stop = null;
    },
  };
}
