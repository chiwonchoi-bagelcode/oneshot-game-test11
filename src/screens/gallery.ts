/*
 * Gallery (tab): the sketchbook's paintings and the cosmetics (ink sets, papers).
 * Paintings colour in as levels are cleared; tap one for the large painting and its story.
 * Cosmetic cards preview a real board in that ink set / paper; use, buy (coins) or see how to earn.
 * Built once; previews render lazily the first time a tab is opened and only re-render on change.
 */
import './meta.css';
import './gallery.css';
import { h, onTap, button } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { createTopbar } from '../ui/topbar.ts';
import { openPopup } from '../ui/popup.ts';
import { showReward } from '../ui/reward.ts';
import { go, type Screen } from '../ui/router.ts';
import { paintingSVG } from '../render/paintings.ts';
import { CHAPTERS } from '../levels/pack.ts';
import { COSMETICS, type Cosmetic, type CosmeticKind } from '../config/balance.ts';
import { store } from '../state/store.ts';
import { chapterStats, chapterUnlocked } from '../state/progress.ts';
import { spendCoins, grant } from '../state/economy.ts';
import { t, fmt, onLangChange } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';
import { openNotEnoughCoins, openShopAt } from './shop.ts';
import {
  boardPreview, offsetIn, enqueue, copyCanvas, cosmeticPrice, cosmeticSource, cosmeticSourceText, equipCosmetic, isEquipped, ownsCosmetic,
} from './meta-common.ts';

type Tab = 'paintings' | 'ink' | 'paper';

function previewKey(c: Cosmetic): string {
  return c.kind === 'ink' ? c.id + '|' + store.data.cosmetics.paper : store.data.cosmetics.ink + '|' + c.id;
}

function previewCanvas(c: Cosmetic, px: number): HTMLElement {
  try {
    return c.kind === 'ink' ? boardPreview(c.id, store.data.cosmetics.paper, px, 'ink') : boardPreview(store.data.cosmetics.ink, c.id, px, 'paper');
  } catch {
    return h('div.gco-fallback', { html: icon(c.kind === 'ink' ? 'brush' : 'paper') });
  }
}

/** Card canvases by cosmetic id (reused instantly by popups). */
const cardCanvas = new Map<string, HTMLCanvasElement>();

/**
 * Preview slot for popups: shows a copy of the card's picture right away, then swaps in a crisp
 * render once the popup has finished opening (a fresh render costs a few frames).
 */
function previewSlot(c: Cosmetic, px: number): HTMLElement {
  const slot = h('div.gal-slot', { style: { width: px + 'px', height: px + 'px' } });
  const card = cardCanvas.get(c.id);
  const key = previewKey(c);
  if (card && card.dataset.key === key) slot.appendChild(copyCanvas(card, px));
  setTimeout(() => enqueue('slot:' + c.id + ':' + px, () => {
    if (!slot.isConnected) return;
    slot.textContent = '';
    slot.appendChild(previewCanvas(c, px));
  }, true), 280);
  return slot;
}

// ---------- Cosmetic actions (also used by the detail popup) ----------

function buyCosmetic(c: Cosmetic): void {
  const price = cosmeticPrice(c);
  if (price === null || ownsCosmetic(c.id)) return;
  if (store.data.coins < price) {
    openNotEnoughCoins(price);
    return;
  }
  const body = h('div.gal-buy', null,
    h('div.gb-prev', null, previewSlot(c, 132)),
    h('b.gb-name', { text: t('cosmetic.' + c.id) }),
    h('span.gb-kind', { text: t('gallery.kind.' + c.kind) }),
    h('p.gb-text', { text: t('gallery.buy.body') }),
  );
  const okBtn = h('button.btn.btn-gold', { type: 'button', html: icon('coin') }, h('span', { text: t('gallery.buy.cta', { n: price }) }));
  const cancel = button(t('common.cancel'), () => p.close(), { variant: 'ghost', sound: 'back' });
  let bought = false;
  onTap(okBtn, () => {
    if (!spendCoins(price)) {
      p.close();
      openNotEnoughCoins(price);
      return;
    }
    grant({ cosmetic: c.id });
    equipCosmetic(c);
    try { audio.purchase(); } catch { /* */ }
    bought = true;
    p.close();
  });
  const p = openPopup({
    id: 'cosmetic-buy',
    title: t('gallery.buy.title'),
    body,
    foot: [okBtn, cancel],
    cls: 'meta-stack',
    onClose: () => {
      if (bought) setTimeout(() => void showReward({ cosmetic: c.id }, { title: t(c.kind === 'ink' ? 'gallery.newInk' : 'gallery.newPaper') }), 170);
    },
  });
}

function useCosmetic(c: Cosmetic): void {
  if (!ownsCosmetic(c.id) || isEquipped(c)) return;
  equipCosmetic(c);
  try { audio.toggle(true); } catch { /* */ }
}

function openCosmeticDetail(c: Cosmetic): void {
  const owned = ownsCosmetic(c.id);
  const price = cosmeticPrice(c);
  const src = cosmeticSource(c);
  const srcText = owned ? '' : cosmeticSourceText(c);
  const body = h('div.gal-detail', null,
    h('div.gd-prev', null, previewSlot(c, 220)),
    h('span.chip', { text: t('gallery.kind.' + c.kind) }),
    h('p.gd-note', { text: t('gallery.previewNote') }),
    srcText && src?.kind !== 'default' ? h('div.gd-src', { html: icon('lock') }, h('span', { text: srcText })) : null,
  );
  const foot: HTMLElement[] = [];
  let p: ReturnType<typeof openPopup>;
  if (owned) {
    if (isEquipped(c)) foot.push(h('button.btn.btn-ghost.disabled', { type: 'button', html: icon('check') }, h('span', { text: t('gallery.inUse') })));
    else foot.push(button(t('gallery.use'), () => { useCosmetic(c); p.close(); }, { variant: 'jade', icon: icon('check') }));
  } else {
    if (src && src.kind === 'chapter') foot.push(button(t('gallery.goChapter'), () => {
      p.close();
      if (chapterUnlocked(src.chapter)) go('chapter', { chapter: src.chapter });
      else go('journey', undefined, { resetHistory: true });
    }, { variant: 'ghost', icon: icon('journey') }));
    if (src && src.kind === 'streak') foot.push(button(t('gallery.goDaily'), () => { p.close(); go('daily', undefined, { resetHistory: true }); }, { variant: 'ghost', icon: icon('daily') }));
    if (src && src.kind === 'bundle') foot.push(button(t('gallery.goShop'), () => { p.close(); openShopAt('bundles'); }, { variant: 'ghost', icon: icon('shop') }));
    if (price !== null) {
      const b = h('button.btn.btn-gold', { type: 'button', html: icon('coin') }, h('span', { text: t('gallery.buy.cta', { n: price }) }));
      onTap(b, () => { p.close(); setTimeout(() => buyCosmetic(c), 170); });
      foot.push(b);
    }
  }
  p = openPopup({ id: 'cosmetic-detail', title: t('cosmetic.' + c.id), body, foot, cls: 'gal-detail-pop meta-stack' });
}

// ---------- Screen ----------

export function createGalleryScreen(): Screen {
  const top = createTopbar({ left: 'settings', wallet: ['coins', 'hints'] });
  const body = h('div.screen-body.gallery-body');
  const el = h('section.gallery', null, top.el, body);
  const updaters: (() => void)[] = [];
  const upd = (f: () => void) => updaters.push(f);
  const label = (e: HTMLElement, f: () => string) => upd(() => { e.textContent = f(); });

  const title = h('h1.screen-title');
  label(title, () => t('gallery.title'));

  // Tabs
  let tab: Tab = 'paintings';
  const seg = h('div.seg.gal-seg', { role: 'tablist' });
  const tabBtns: Record<Tab, HTMLElement> = {} as Record<Tab, HTMLElement>;
  (['paintings', 'ink', 'paper'] as Tab[]).forEach((id) => {
    const b = h('button', { type: 'button', role: 'tab' });
    label(b, () => t('gallery.tab.' + id));
    onTap(b, () => setTab(id));
    tabBtns[id] = b;
    seg.appendChild(b);
  });
  const summary = h('div.gal-sum');
  body.append(title, seg, summary);

  const panes: Record<Tab, HTMLElement> = {
    paintings: h('div.gal-pane.gal-paintings'),
    ink: h('div.gal-pane.gal-cos-grid'),
    paper: h('div.gal-pane.gal-cos-grid'),
  };
  for (const k of Object.keys(panes) as Tab[]) body.appendChild(panes[k]);

  // ---------- Paintings ----------
  const chCards = CHAPTERS.map((ch, i) => {
    const art = h('div.gc-art');
    const lock = h('div.gc-lock', { html: icon('lock') });
    const done = h('span.gc-done', { html: icon('check') });
    const name = h('b.gc-name');
    const num = h('span.gc-num');
    const seals = h('span.gc-seals', { html: icon('seal') }, h('span'));
    const bar = h('i');
    const lockText = h('span.gc-locktext');
    const card = h('button.card.gal-ch', { type: 'button' },
      h('div.gc-frame', null, art, lock, done),
      h('div.gc-meta', null, name, h('div.gc-row', null, num, seals), h('div.progress', null, bar), lockText),
    );
    onTap(card, () => openChapter(i));
    panes.paintings.appendChild(card);
    let shown = -1;
    upd(() => {
      const st = chapterStats(i);
      const open = chapterUnlocked(i);
      const revealed = open ? st.cleared : 0;
      if (shown !== revealed) {
        art.innerHTML = paintingSVG(i, revealed, { idPrefix: 'gal' + i });
        shown = revealed;
      }
      name.textContent = t('chapter.' + ch.id + '.name');
      num.textContent = t('chapter.progress', { n: st.cleared, total: st.total });
      (seals.lastElementChild as HTMLElement).textContent = fmt(st.sealed);
      bar.style.width = (st.cleared / Math.max(1, st.total)) * 100 + '%';
      lockText.textContent = t('gallery.lockedShort');
      card.classList.toggle('locked', !open);
      card.classList.toggle('complete', st.total > 0 && st.cleared >= st.total);
    });
    return card;
  });

  function openChapter(i: number) {
    const ch = CHAPTERS[i];
    const st = chapterStats(i);
    const open = chapterUnlocked(i);
    const complete = st.total > 0 && st.cleared >= st.total;
    const last = i === CHAPTERS.length - 1;
    const art = h('div.gp-art', { html: paintingSVG(i, open ? st.cleared : 0, { idPrefix: 'galp' }) });
    if (!open) art.appendChild(h('div.gc-lock', { html: icon('lock') }));
    const stats = open
      ? h('div.gp-stats', null,
        h('div.gp-stat', null, h('div.progress', null, h('i', { style: { width: (st.cleared / Math.max(1, st.total)) * 100 + '%' } })), h('span', { text: t('gallery.levels', { n: st.cleared, total: st.total }) })),
        h('div.gp-seals', { html: icon('seal') }, h('span', { text: t('chapter.seals', { n: st.sealed, total: st.total }) })),
      )
      : h('div.gd-src', { html: icon('lock') }, h('span', { text: t('chapter.lockedBody') }));
    const bodyEl = h('div.gal-chapter', null,
      art,
      h('div.gp-kicker', null, h('span.chip' + (complete ? '.jade' : ''), complete ? { html: icon('check') } : null, h('span', { text: complete ? t('gallery.done') : t('chapter.n', { n: i + 1 }) }))),
      h('p.gp-line', { text: t('chapter.' + ch.id + '.line') }),
      stats,
      last && complete ? h('div.gp-epi', null, h('b', { text: t('gallery.epilogue') }), h('p', { text: t('story.epilogue') })) : null,
    );
    const foot: HTMLElement[] = [];
    let p: ReturnType<typeof openPopup>;
    if (open) foot.push(button(t('gallery.openChapter'), () => { p.close(); go('chapter', { chapter: i }); }, { variant: 'jade', icon: icon('journey') }));
    p = openPopup({ id: 'gallery-chapter', title: t('chapter.' + ch.id + '.name'), body: bodyEl, foot: foot.length ? foot : undefined, cls: 'gal-ch-pop' });
  }

  // ---------- Cosmetics ----------
  interface CosCard { c: Cosmetic; prev: HTMLElement; shown: string }
  const cosCards: CosCard[] = [];
  for (const c of COSMETICS) {
    const prev = h('div.gco-prev');
    const badge = h('span.gco-badge', { html: icon('check') });
    const name = h('b.gco-name');
    const src = h('div.gco-src', { html: icon('lock') }, h('span'));
    const also = h('div.gco-also');
    const useBtn = h('button.btn.btn-jade.btn-sm.btn-block.gco-act', { type: 'button' }, h('span'));
    const inUse = h('div.gco-inuse', { html: icon('check') }, h('span'));
    const price = cosmeticPrice(c);
    const buyBtn = price !== null ? h('button.btn.btn-gold.btn-sm.btn-block.gco-act', { type: 'button' }, h('span.btn-price', { html: icon('coin') }, h('span', { text: fmt(price) }))) : null;
    onTap(useBtn, () => useCosmetic(c));
    if (buyBtn) onTap(buyBtn, () => buyCosmetic(c));
    const card = h('div.card.gal-cos', null, h('button.gco-top', { type: 'button', 'aria-label': '' }, prev, badge, name), h('div.gco-foot', null, also, inUse, useBtn, buyBtn, src));
    onTap(card.firstElementChild as HTMLElement, () => openCosmeticDetail(c));
    panes[c.kind].appendChild(card);
    const cc: CosCard = { c, prev, shown: '' };
    cosCards.push(cc);
    upd(() => {
      const owned = ownsCosmetic(c.id);
      const eq = isEquipped(c);
      name.textContent = t('cosmetic.' + c.id);
      (card.firstElementChild as HTMLElement).setAttribute('aria-label', t('cosmetic.' + c.id));
      card.classList.toggle('equipped', eq);
      badge.classList.toggle('hidden', !eq);
      inUse.classList.toggle('hidden', !eq);
      (inUse.lastElementChild as HTMLElement).textContent = t('gallery.inUse');
      useBtn.classList.toggle('hidden', !owned || eq);
      (useBtn.firstElementChild as HTMLElement).textContent = t('gallery.use');
      if (buyBtn) buyBtn.classList.toggle('hidden', owned);
      const earnOnly = !owned && price === null;
      src.classList.toggle('hidden', !earnOnly);
      if (earnOnly) (src.lastElementChild as HTMLElement).textContent = cosmeticSourceText(c);
      // Buyable, but also part of a bundle / reward: say so above the price.
      const srcKind = cosmeticSource(c)?.kind;
      const showAlso = !owned && price !== null && !!srcKind && srcKind !== 'default';
      also.classList.toggle('hidden', !showAlso);
      if (showAlso) also.textContent = cosmeticSourceText(c);
    });
  }

  /** Renders changed previews of a kind, one per frame (urgent = that tab is on screen). */
  function renderPreviews(kind: CosmeticKind, urgent = true) {
    for (const cc of cosCards) {
      if (cc.c.kind !== kind) continue;
      const key = previewKey(cc.c);
      if (key === cc.shown) continue;
      enqueue('gal:' + cc.c.id, () => {
        const k = previewKey(cc.c);
        if (k === cc.shown) return;
        cc.shown = k;
        const cv = previewCanvas(cc.c, 128);
        if (cv instanceof HTMLCanvasElement) {
          cv.dataset.key = k;
          cardCanvas.set(cc.c.id, cv);
        }
        cc.prev.textContent = '';
        cc.prev.appendChild(cv);
      }, urgent);
    }
  }

  // ---------- Tabs ----------
  function setTab(id: Tab) {
    if (tab === id) return;
    tab = id;
    applyTab();
    const segTop = Math.round(offsetIn(seg, body)) - 8;
    if (body.scrollTop > segTop) body.scrollTop = Math.max(0, segTop);
  }

  function applyTab() {
    for (const k of Object.keys(panes) as Tab[]) {
      panes[k].classList.toggle('hidden', k !== tab);
      tabBtns[k].classList.toggle('on', k === tab);
      tabBtns[k].setAttribute('aria-selected', String(k === tab));
    }
    if (tab !== 'paintings') renderPreviews(tab);
    updateSummary();
  }

  function updateSummary() {
    if (tab === 'paintings') {
      let done = 0;
      CHAPTERS.forEach((_, i) => {
        const s = chapterStats(i);
        if (s.total > 0 && s.cleared >= s.total) done++;
      });
      summary.textContent = t('gallery.restored', { n: done, total: CHAPTERS.length });
    } else {
      const list = COSMETICS.filter((c) => c.kind === tab);
      summary.textContent = t('gallery.ownedCount', { n: list.filter((c) => ownsCosmetic(c.id)).length, total: list.length });
    }
  }

  function refresh() {
    for (const f of updaters) f();
    updateSummary();
  }

  store.on('progress', refresh);
  store.on('cosmetics', () => {
    refresh();
    if (el.classList.contains('active')) warmUp();
  });
  let symbolsShown = !!store.data.settings.symbols;
  store.on('settings', () => {
    // Colour symbols change how the previews are drawn.
    if (!!store.data.settings.symbols === symbolsShown) return;
    symbolsShown = !!store.data.settings.symbols;
    for (const cc of cosCards) cc.shown = '';
    if (el.classList.contains('active')) warmUp();
  });
  onLangChange(refresh);
  refresh();
  applyTab();

  /** Once the gallery has been opened, prepare the other tab's previews while the player looks around. */
  function warmUp() {
    renderPreviews('ink', tab === 'ink');
    renderPreviews('paper', tab === 'paper');
  }

  return {
    id: 'gallery',
    el,
    tab: true,
    show(params?: { tab?: Tab }) {
      if (params && params.tab && params.tab !== tab) {
        tab = params.tab;
        applyTab();
      }
      refresh();
      warmUp();
    },
  };
}
