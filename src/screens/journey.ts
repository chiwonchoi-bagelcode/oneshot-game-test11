/* Journey (home): the current chapter with a big "play" button, then every chapter of the sketchbook. */
import './journey.css';
import { h, onTap, button } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { createTopbar } from '../ui/topbar.ts';
import { go, type Screen } from '../ui/router.ts';
import { toast } from '../ui/toast.ts';
import { paintingSVG } from '../render/paintings.ts';
import { CHAPTERS, ALL_LEVELS } from '../levels/pack.ts';
import { chapterStats, chapterUnlocked, nextLevelIndex, clearedCount } from '../state/progress.ts';
import { levelInfo } from '../levels/pack.ts';
import { store } from '../state/store.ts';
import { t, fmt, onLangChange } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';
import { dailyUnlocked, todaySet, effectiveStreak } from '../state/daily.ts';

export function createJourneyScreen(): Screen {
  const top = createTopbar({ left: 'settings', wallet: ['coins', 'hints'] });
  const body = h('div.screen-body');
  const el = h('section.journey', null, top.el, body);

  // Hero (current chapter)
  const heroChip = h('span.chip.jade.hero-chip');
  const heroArt = h('div.hero-art');
  const heroName = h('h2');
  const heroLine = h('p');
  const heroBar = h('i');
  const heroNum = h('span.num');
  const heroSeals = h('span.num', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } });
  const playBtn = button('', () => onPlay(), { size: 'lg', icon: icon('play') });
  const hero = h('div.hero', null,
    h('div', { style: { position: 'relative' } }, heroArt, heroChip),
    h('div.hero-info', null, heroName, heroLine, h('div.hero-stats', null, h('div.progress', null, heroBar), heroNum, heroSeals), playBtn),
  );
  onTap(heroArt, () => go('chapter', { chapter: heroChapter }));

  const dailyNum = h('span');
  const dailyStreak = h('span.chip.gold', { html: icon('streak') }, h('span'));
  const dailyCard = h('button.daily-strip', { type: 'button', html: icon('daily') },
    h('div.grow', null, h('b', { text: t('nav.daily') }), dailyNum),
    dailyStreak,
    h('span.go', { html: icon('next') }),
  );
  onTap(dailyCard, () => go('daily', undefined, { resetHistory: true }));

  const story = h('div.story-banner', { html: icon('paper') }, h('span', { text: t('story.prologue') }));
  const listTitle = h('div.section-title', { html: icon('journey') }, h('span', { text: t('journey.title') }));
  const list = h('div.chapter-list');
  body.append(story, hero, dailyCard, listTitle, list);
  // A single-chapter book (test versions) has nothing to list under the hero.
  if (CHAPTERS.length < 2) {
    listTitle.classList.add('hidden');
    list.classList.add('hidden');
  }

  let heroChapter = 0;
  const cards: { el: HTMLElement; art: HTMLElement; name: HTMLElement; num: HTMLElement; seals: HTMLElement; bar: HTMLElement; lock: HTMLElement; done: HTMLElement; shown: number }[] = [];
  CHAPTERS.forEach((ch, i) => {
    const art = h('div.art');
    const name = h('b');
    const num = h('span');
    const seals = h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' } });
    const bar = h('i');
    const lock = h('div.lock', { html: icon('lock') });
    const done = h('span.chip.jade.done-badge', { html: icon('check') });
    const card = h('button.ch-card', { type: 'button' }, art, h('div.meta', null, name, h('div.row', null, num, seals), h('div.progress', null, bar)), lock, done);
    onTap(card, () => {
      if (!chapterUnlocked(i)) {
        toast(t('chapter.lockedBody'));
        return;
      }
      go('chapter', { chapter: i });
    });
    cards.push({ el: card, art, name, num, seals, bar, lock, done, shown: -1 });
    list.appendChild(card);
  });

  function onPlay() {
    const idx = nextLevelIndex();
    if (idx < 0) {
      go('daily', undefined, { resetHistory: true });
      return;
    }
    go('play', { index: idx });
  }

  function refresh() {
    const idx = nextLevelIndex();
    const info = idx >= 0 ? levelInfo(ALL_LEVELS[idx].id) : null;
    heroChapter = info ? info.chapter.index : CHAPTERS.length - 1;
    const ch = CHAPTERS[heroChapter];
    const st = chapterStats(heroChapter);
    heroChip.textContent = t('chapter.n', { n: heroChapter + 1 });
    heroArt.innerHTML = paintingSVG(heroChapter, st.cleared, { idPrefix: 'hero' });
    heroName.textContent = t('chapter.' + ch.id + '.name');
    heroLine.textContent = t('chapter.' + ch.id + '.line');
    heroBar.style.width = (st.cleared / Math.max(1, st.total)) * 100 + '%';
    heroNum.textContent = t('chapter.progress', { n: st.cleared, total: st.total });
    heroSeals.innerHTML = icon('seal') + `<span>${fmt(st.sealed)}</span>`;
    (heroSeals.firstElementChild as HTMLElement).style.fontSize = '18px';
    playBtn.querySelector('span')!.textContent = info ? t('journey.continue', { n: info.number }) : t('nav.daily');
    story.classList.toggle('hidden', clearedCount() >= 3);
    const dOpen = dailyUnlocked();
    dailyCard.classList.toggle('hidden', !dOpen);
    if (dOpen) {
      const set = todaySet();
      const done = set.filter((p) => p.done).length;
      dailyCard.querySelector('b')!.textContent = t('nav.daily');
      dailyNum.textContent = t('journey.dailySub', { n: done, total: set.length });
      const st = effectiveStreak();
      dailyStreak.querySelector('span')!.textContent = fmt(st);
      dailyCard.classList.toggle('all-done', done >= set.length);
    }
    story.querySelector('span')!.textContent = t('story.prologue');
    listTitle.querySelector('span')!.textContent = t('journey.title');

    CHAPTERS.forEach((c, i) => {
      const card = cards[i];
      const s = chapterStats(i);
      const open = chapterUnlocked(i);
      if (card.shown !== s.cleared) {
        card.art.innerHTML = paintingSVG(i, s.cleared, { idPrefix: 'jc' + i });
        card.shown = s.cleared;
      }
      card.name.textContent = t('chapter.' + c.id + '.name');
      card.num.textContent = t('chapter.progress', { n: s.cleared, total: s.total });
      card.seals.innerHTML = icon('seal') + `<span>${fmt(s.sealed)}</span>`;
      card.bar.style.width = (s.cleared / Math.max(1, s.total)) * 100 + '%';
      card.el.classList.toggle('locked', !open);
      card.lock.classList.toggle('hidden', open);
      card.done.classList.toggle('hidden', s.cleared < s.total || s.total === 0);
    });
  }

  store.on('progress', () => {
    if (el.classList.contains('active')) refresh();
  });
  onLangChange(refresh);
  refresh();

  return {
    id: 'journey',
    el,
    tab: true,
    show() {
      refresh();
      audio.setMusic('menu');
    },
  };
}
