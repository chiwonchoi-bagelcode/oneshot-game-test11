/* Chapter screen: the chapter painting, seal rewards, and the 30 level buttons. */
import './journey.css';
import { h, onTap, button } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { createTopbar } from '../ui/topbar.ts';
import { go, back, type Screen } from '../ui/router.ts';
import { openPopup } from '../ui/popup.ts';
import { toast } from '../ui/toast.ts';
import { paintingSVG } from '../render/paintings.ts';
import { CHAPTERS, levelInfo } from '../levels/pack.ts';
import { chapterStats, isCleared, isSealed, isUnlocked, chapterUnlocked } from '../state/progress.ts';
import { CHAPTER_REWARD, type Reward } from '../config/balance.ts';
import { store } from '../state/store.ts';
import { t, fmt, onLangChange } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';

export function createChapterScreen(): Screen {
  const top = createTopbar({ left: 'back', onBack: () => back() || go('journey', undefined, { resetHistory: true }), wallet: ['coins', 'hints'] });
  const body = h('div.screen-body');
  const el = h('section.chapter', null, top.el, body);

  const art = h('div.art');
  const line = h('p');
  const sealBtn = h('button.seal-btn', { type: 'button' });
  onTap(sealBtn, () => openSealRewards());
  const head = h('div.chapter-head', null, art, h('div.info', null, line, sealBtn));
  const grid = h('div.level-grid');
  const cta = button('', () => playNext(), { size: 'lg', icon: icon('play') });
  const ctaWrap = h('div.chapter-cta', null, cta);
  body.append(head, grid, ctaWrap);

  let ci = 0;
  let shownCleared = -1;
  let shownChapter = -1;
  const buttons: HTMLElement[] = [];

  function build() {
    const ch = CHAPTERS[ci];
    grid.innerHTML = '';
    buttons.length = 0;
    ch.levels.forEach((lv, i) => {
      const b = h('button.lv', { type: 'button' });
      if (lv.tag === 'boss') b.classList.add('boss');
      onTap(b, () => {
        const info = levelInfo(lv.id)!;
        if (!isUnlocked(info.index)) {
          toast(t('level.locked'));
          return;
        }
        go('play', { index: info.index });
      });
      buttons.push(b);
      grid.appendChild(b);
      void i;
    });
  }

  function refresh() {
    const ch = CHAPTERS[ci];
    if (shownChapter !== ci) {
      build();
      shownChapter = ci;
      shownCleared = -1;
      body.scrollTop = 0;
    }
    const st = chapterStats(ci);
    top.setTitle(t('chapter.' + ch.id + '.name'));
    if (shownCleared !== st.cleared) {
      art.innerHTML = paintingSVG(ci, st.cleared, { idPrefix: 'ch' });
      shownCleared = st.cleared;
    }
    line.textContent = t('chapter.' + ch.id + '.line');
    sealBtn.innerHTML = icon('seal') + `<span>${fmt(st.sealed)}/${fmt(st.total)}</span>`;
    sealBtn.setAttribute('aria-label', t('chapter.sealRewardsTitle'));
    let nextNum = -1;
    ch.levels.forEach((lv, i) => {
      const info = levelInfo(lv.id)!;
      const b = buttons[i];
      const cleared = isCleared(lv.id);
      const open = isUnlocked(info.index);
      const current = open && !cleared;
      if (current && nextNum < 0) nextNum = info.number;
      b.className = 'lv' + (lv.tag === 'boss' ? ' boss' : '') + (cleared ? ' cleared' : current ? ' current' : open ? '' : ' locked');
      b.innerHTML = open ? `<span>${info.number}</span>` : icon('lock');
      if (isSealed(lv.id)) b.insertAdjacentHTML('beforeend', `<span class="seal-mini">${icon('seal')}</span>`);
      if (lv.intro && open && !cleared && lv.intro !== 'drop') b.insertAdjacentHTML('beforeend', `<span class="new-mini">${t('common.new')}</span>`);
      b.setAttribute('aria-label', t('level.n', { n: info.number }));
    });
    if (nextNum > 0) {
      cta.querySelector('span')!.textContent = t('journey.continue', { n: nextNum });
      ctaWrap.classList.remove('hidden');
    } else ctaWrap.classList.add('hidden');
  }

  function playNext() {
    const ch = CHAPTERS[ci];
    for (const lv of ch.levels) {
      const info = levelInfo(lv.id)!;
      if (!isCleared(lv.id) && isUnlocked(info.index)) {
        go('play', { index: info.index });
        return;
      }
    }
  }

  function rewardChips(r: Reward): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (r.coins) out.push(h('span.chip', { html: icon('coin') }, h('span', { text: fmt(r.coins) })));
    if (r.hints) out.push(h('span.chip', { html: icon('hint') }, h('span', { text: '×' + fmt(r.hints) })));
    if (r.rewinds) out.push(h('span.chip', { html: icon('rewind') }, h('span', { text: '×' + fmt(r.rewinds) })));
    return out;
  }

  function openSealRewards() {
    const st = chapterStats(ci);
    const claimed = store.data.chapters[ci]?.seals || [];
    const rows = CHAPTER_REWARD.sealMilestones.map((m) => {
      const got = claimed.includes(m.seals);
      return h('div.milestone-row', null,
        h('div.goal', { html: icon('seal') }, h('span', { text: fmt(m.seals) })),
        h('div.items', null, ...rewardChips(m.reward)),
        got ? h('span.chip.jade', { html: icon('check') }, h('span', { text: t('common.claimed') })) : h('span.chip', { text: `${fmt(Math.min(st.sealed, m.seals))}/${fmt(m.seals)}` }),
      );
    });
    const bodyEl = h('div', null,
      h('p', { text: t('chapter.sealRewardsBody'), style: { margin: '0 0 8px', color: 'var(--ink-2)', fontSize: '15px', lineHeight: '1.5' } }),
      ...rows,
    );
    openPopup({ id: 'seal-rewards', title: t('chapter.sealRewardsTitle'), body: bodyEl });
  }

  store.on('progress', () => {
    if (el.classList.contains('active')) refresh();
  });
  onLangChange(() => refresh());

  return {
    id: 'chapter',
    el,
    show(params?: { chapter?: number }) {
      if (params && params.chapter !== undefined) ci = Math.max(0, Math.min(CHAPTERS.length - 1, params.chapter));
      if (!chapterUnlocked(ci)) ci = 0;
      refresh();
      audio.setMusic('menu');
      // Bring the current level into view without a visible jump.
      const cur = grid.querySelector('.lv.current') as HTMLElement | null;
      if (cur) {
        const r = cur.offsetTop - body.clientHeight * 0.5;
        if (r > 0) body.scrollTop = r;
      }
    },
  };
}
