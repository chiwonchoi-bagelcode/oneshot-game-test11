/*
 * Shop (tab). Built once at boot and only updated in place, so buying something never moves
 * the list. Sections: free gift + coin ad, bundles, coin packs, items for coins, restore.
 * show({ section }) jumps straight to a section; show({ overlay: true }) (opened over a level)
 * swaps the gear for a back arrow that returns to the level.
 */
import './meta.css';
import './shop.css';
import { h, onTap, button } from '../ui/dom.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { createTopbar } from '../ui/topbar.ts';
import { openPopup } from '../ui/popup.ts';
import { showReward } from '../ui/reward.ts';
import { go, back, currentScreen, onScreenChange, tabbarEl, type Screen } from '../ui/router.ts';
import { store, today, msToMidnight } from '../state/store.ts';
import { grant, spendCoins } from '../state/economy.ts';
import { PRODUCTS, COIN_ITEMS, PRICES, FREE_GIFT, ADS, type Product, type Reward } from '../config/balance.ts';
import { purchase, canBuy, restorePurchases } from '../services/iap.ts';
import { adsLeft, showRewardedAd } from '../services/ads.ts';
import { t, fmt, fmtPrice, getLang, onLangChange } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';
import { tn, fmtCountdown, everyMinute, cosmeticById, ownsCosmetic, boardPreview, rewardChips, offsetIn, enqueue } from './meta-common.ts';

export type ShopSection = 'free' | 'bundles' | 'coins' | 'items';

export function freeGiftAvailable(): boolean {
  return store.data.shop.gift !== today();
}

// ---------- Not enough coins (shared with the gallery) ----------

let scrollToSection: (s: ShopSection, smooth: boolean, flash: boolean) => void = () => {};

/** Opens the shop at a section (scrolls in place when the shop is already showing). */
export function openShopAt(section: ShopSection): void {
  if (currentScreen() === 'shop') scrollToSection(section, true, true);
  else go('shop', { section, flash: true });
}

/**
 * "Not enough coins": offers a rewarded ad for a few coins (while ads are left today) and a way to
 * the coin packs, which scrolls the shop to the coin section and highlights it.
 */
export function openNotEnoughCoins(price: number): void {
  const need = Math.max(1, price - store.data.coins);
  const body = h('div.center.nec',
    null,
    h('div.nec-icon', { html: icon('coin') }),
    h('p.nec-text', { text: t('notEnough.body', { n: need }) }),
    h('p.nec-have', { text: t('shop.notEnough.have', { n: store.data.coins }) }),
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
  foot.push(button(t('shop.seeCoins'), () => {
    p.close();
    openShopAt('coins');
  }, { variant: 'jade', icon: icon('coin'), block: true }));
  const p = openPopup({ id: 'not-enough', title: t('notEnough.title'), body, foot, cls: 'nec-pop' });
}

// ---------- Coin art ----------

/** Coin piles that grow with the pack tier: [x%, y%, size px]. */
const COIN_ART: Record<number, [number, number, number][]> = {
  1: [[30, 28, 30], [48, 36, 40]],
  2: [[22, 40, 32], [56, 40, 32], [38, 18, 38]],
  3: [[14, 48, 30], [40, 52, 32], [66, 48, 30], [26, 22, 34], [54, 22, 34]],
  4: [[8, 52, 28], [70, 54, 28], [30, 4, 30], [52, 0, 32]],
};

function coinArt(tier: number): HTMLElement {
  const art = h('div.cp-art.tier-' + tier);
  if (tier >= 4) art.appendChild(h('span.cp-chest', { html: icon('chest') }));
  for (const [x, y, s] of COIN_ART[Math.max(1, Math.min(4, tier))]) {
    art.appendChild(h('span.cp-coin', { html: icon('coin'), style: { left: x + '%', top: y + '%', fontSize: s + 'px' } }));
  }
  return art;
}

// ---------- Screen ----------

interface Updater {
  (): void;
}

export function createShopScreen(): Screen {
  let overlay = false;
  const top = createTopbar({ left: 'settings', onBack: () => back(), wallet: ['coins', 'hints'] });
  const body = h('div.screen-body.shop-body');
  const el = h('section.shop', null, top.el, body);
  const updaters: Updater[] = [];
  const upd = (f: Updater) => updaters.push(f);
  const label = (el2: HTMLElement, f: () => string) => upd(() => { el2.textContent = f(); });

  const title = h('h1.screen-title');
  label(title, () => t('shop.title'));
  body.appendChild(title);

  const sections = {} as Record<ShopSection, HTMLElement>;
  function section(id: ShopSection, ic: IconName, key: string): HTMLElement {
    const head = h('h2.section-title', { html: icon(ic) }, h('span'));
    label(head.lastElementChild as HTMLElement, () => t(key));
    const s = h('section.shop-sec', { dataset: { sec: id } }, head);
    sections[id] = s;
    body.appendChild(s);
    return s;
  }

  // --- Free gift + coin ad
  const free = section('free', 'gift', 'shop.sec.free');
  const giftName = h('b.sr-name');
  const giftSub = h('div.sr-sub');
  const giftChips = h('div.rw-chips');
  const giftNext = h('span.sr-note');
  const giftBtn = h('button.btn.btn-sm.sr-btn', { type: 'button' }, h('span'));
  onTap(giftBtn, claimGift);
  const adName = h('b.sr-name');
  const adSub = h('span.sr-note');
  const adChips = rewardChips(ADS.coinsReward);
  const adBtn = h('button.btn.btn-sm.btn-violet.sr-btn', { type: 'button', html: icon('ad') }, h('span'));
  onTap(adBtn, watchCoinAd);
  free.appendChild(h('div.card.shop-free', null,
    h('div.shop-row', null, h('div.sr-ico.gold', { html: icon('gift') }), h('div.grow', null, giftName, giftSub), giftBtn),
    h('div.shop-row', null, h('div.sr-ico.violet', { html: icon('ad') }), h('div.grow', null, adName, h('div.sr-sub', null, adChips, adSub)), adBtn),
  ));
  giftSub.append(giftChips, giftNext);
  for (const [k, v] of Object.entries(FREE_GIFT.reward) as [keyof Reward, number][]) {
    if (!v || k === 'cosmetic') continue;
    giftChips.appendChild(h('span.rw', { html: icon(k === 'coins' ? 'coin' : k === 'hints' ? 'hint' : 'rewind') }, h('b', { text: k === 'coins' ? fmt(v) : '×' + fmt(v) })));
  }
  label(giftName, () => t('shop.gift.name'));
  label(adName, () => t('shop.ad.name'));
  upd(() => {
    const avail = freeGiftAvailable();
    giftBtn.classList.toggle('btn-ghost', !avail);
    giftBtn.classList.toggle('disabled', !avail);
    giftBtn.querySelector('span')!.textContent = avail ? t('common.claim') : t('common.claimed');
    giftChips.classList.toggle('hidden', !avail);
    giftNext.classList.toggle('hidden', avail);
    giftNext.textContent = avail ? '' : t('shop.gift.next', { time: fmtCountdown(msToMidnight()) });
    const left = adsLeft('coins');
    adSub.textContent = left > 0 ? tn('shop.ad.left', left) : t('shop.ad.none');
    adBtn.classList.toggle('disabled', left <= 0);
    adBtn.querySelector('span')!.textContent = left > 0 ? t('shop.ad.watch') : t('shop.ad.tomorrow');
  });

  // --- Bundles
  const bundles = section('bundles', 'chest', 'shop.sec.bundles');
  const BUNDLE_ART: IconName[] = ['gift', 'brush', 'chest'];
  PRODUCTS.filter((p) => p.kind === 'bundle').forEach((p, i) => bundles.appendChild(bundleCard(p, BUNDLE_ART[i] || 'chest', i)));

  function bundleCard(p: Product, art: IconName, i: number): HTMLElement {
    const name = h('h3.bd-name');
    const desc = h('p.bd-desc');
    label(name, () => t('product.' + p.id + '.name'));
    label(desc, () => t('product.' + p.id + '.desc'));
    const tiles = h('div.bd-items');
    const r = p.reward;
    const tile = (ic: string, val: string, sub: () => string) => {
      const s = h('small');
      label(s, sub);
      return h('div.bd-tile', { html: ic }, h('b', { text: val }), s);
    };
    if (r.coins) tiles.appendChild(tile(icon('coin'), fmt(r.coins), () => t('currency.coins')));
    if (r.hints) tiles.appendChild(tile(icon('hint'), '×' + fmt(r.hints), () => t('currency.hints')));
    if (r.rewinds) tiles.appendChild(tile(icon('rewind'), '×' + fmt(r.rewinds), () => t('currency.rewinds')));
    if (r.cosmetic) {
      const c = cosmeticById(r.cosmetic);
      const prev = h('div.bd-prev');
      const nm = h('b.bd-cos');
      const kind = h('small');
      const own = h('span.bd-own', { html: icon('check') });
      label(nm, () => t('cosmetic.' + r.cosmetic));
      label(kind, () => (ownsCosmetic(r.cosmetic!) ? t('shop.alreadyOwned') : t(c?.kind === 'paper' ? 'gallery.kind.paper' : 'gallery.kind.ink')));
      let shownFor = '';
      upd(() => {
        own.classList.toggle('hidden', !ownsCosmetic(r.cosmetic!));
        if (!c) return;
        const key = c.kind === 'ink' ? r.cosmetic + '|' + store.data.cosmetics.paper : store.data.cosmetics.ink + '|' + r.cosmetic;
        if (key === shownFor) return;
        shownFor = key;
        // Rendered off the critical path (a board thumbnail takes a few frames).
        enqueue('shop:' + c.id, () => {
          prev.textContent = '';
          try {
            prev.appendChild(c.kind === 'ink' ? boardPreview(c.id, store.data.cosmetics.paper, 40, 'ink') : boardPreview(store.data.cosmetics.ink, c.id, 40, 'paper'));
          } catch {
            prev.innerHTML = icon(c.kind === 'paper' ? 'paper' : 'brush');
          }
        }, el.classList.contains('active'));
      });
      tiles.appendChild(h('div.bd-tile.cos', null, prev, nm, kind, own));
    }
    const badge = p.badge ? h('span.bd-badge' + (p.badge.endsWith('once') ? '.accent' : '.gold')) : null;
    if (badge) label(badge, () => t(p.badge!));
    const buy = h('button.btn.btn-jade.btn-block.bd-buy', { type: 'button' }, h('span'));
    onTap(buy, () => void purchase(p.id));
    const owned = h('div.bd-owned', { html: icon('check') }, h('span'));
    label(owned.lastElementChild as HTMLElement, () => t('shop.owned'));
    upd(() => {
      buy.querySelector('span')!.textContent = fmtPrice(p.price);
      const can = canBuy(p.id);
      buy.classList.toggle('hidden', !can);
      owned.classList.toggle('hidden', can);
      card.classList.toggle('is-owned', !can);
    });
    const card = h('div.card.shop-bundle.b' + i + (p.badge === 'shop.badge.best' ? '.featured' : ''), null,
      h('div.bd-head', null, h('div.bd-art', { html: icon(art) }), h('div.grow', null, h('div.bd-title', null, name, badge), desc)),
      tiles,
      buy,
      owned,
    );
    return card;
  }

  // --- Coin packs
  const coins = section('coins', 'coin', 'shop.sec.coins');
  const coinGrid = h('div.coin-grid');
  coins.appendChild(coinGrid);
  const coinPacks = PRODUCTS.filter((p) => p.kind === 'coins');
  const baseRate = (p: Product) => (p.reward.coins || 0) / (getLang() === 'ko' ? p.price.krw : p.price.usd);
  for (const p of coinPacks) {
    const amount = h('div.cp-amount', { text: fmt(p.reward.coins || 0) });
    const name = h('div.cp-name');
    label(name, () => t('product.' + p.id + '.name'));
    const bonus = h('span.cp-bonus');
    const badge = p.badge ? h('span.cp-badge') : null;
    if (badge) label(badge, () => t(p.badge!));
    const buy = h('button.btn.btn-jade.btn-sm.btn-block.cp-buy', { type: 'button' }, h('span'));
    onTap(buy, () => void purchase(p.id));
    upd(() => {
      buy.querySelector('span')!.textContent = fmtPrice(p.price);
      const pct = Math.round((baseRate(p) / baseRate(coinPacks[0]) - 1) * 100);
      bonus.textContent = pct >= 5 ? t('shop.bonus', { n: pct }) : '';
      bonus.classList.toggle('empty', pct < 5);
    });
    coinGrid.appendChild(h('div.card.coin-pack' + (p.badge ? '.hot' : ''), null, badge, coinArt(p.tier || 1), amount, name, bonus, buy));
  }

  // --- Items for coins (one card per kind: what it does once, then the packs)
  const items = section('items', 'hint', 'shop.sec.items');
  for (const kind of ['hints', 'rewinds'] as const) {
    const list = COIN_ITEMS.filter((it) => (it.reward[kind] || 0) > 0);
    if (!list.length) continue;
    const headName = h('b');
    const headDesc = h('span');
    label(headName, () => t('currency.' + kind));
    label(headDesc, () => t('shop.desc.' + kind));
    const card = h('div.card.shop-items', null, h('div.it-head', { html: icon(kind === 'hints' ? 'hint' : 'rewind') }, h('div', null, headName, headDesc)));
    items.appendChild(card);
    for (const it of list) {
      const n = it.reward[kind] || 0;
      const name = h('b');
      const save = h('span.it-save');
      label(name, () => tn('shop.qty.' + kind, n));
      const unit = kind === 'hints' ? PRICES.hint : PRICES.rewind;
      const pct = Math.round((1 - it.price / (unit * n)) * 100);
      label(save, () => (pct >= 5 ? t('shop.save', { n: pct }) : ''));
      save.classList.toggle('hidden', pct < 5);
      const buy = h('button.btn.btn-gold.btn-sm.it-buy', { type: 'button' }, h('span.btn-price', { html: icon('coin') }, h('span', { text: fmt(it.price) })));
      onTap(buy, () => buyItem(it.price, it.reward));
      card.appendChild(h('div.list-row.shop-item', null,
        h('div.it-ico', { html: icon(kind === 'hints' ? 'hint' : 'rewind') }, h('span.it-n', { text: '×' + fmt(n) })),
        h('div.label', null, h('div.it-title', null, name, save)),
        buy,
      ));
    }
  }

  // --- Restore
  const restoreBtn = button('', () => void restorePurchases(), { variant: 'ghost', size: 'sm', icon: icon('restore'), cls: 'shop-restore' });
  label(restoreBtn.querySelector('span')!, () => t('shop.restore'));
  const restoreNote = h('p.shop-restore-note');
  label(restoreNote, () => t('shop.restoreNote'));
  body.appendChild(h('div.shop-foot', null, restoreBtn, restoreNote));

  // ---------- Actions ----------

  function claimGift() {
    if (!freeGiftAvailable()) return;
    store.data.shop.gift = today();
    grant(FREE_GIFT.reward);
    store.commit('shop');
    void showReward(FREE_GIFT.reward, { title: t('shop.gift.title') });
  }

  async function watchCoinAd() {
    if (adsLeft('coins') <= 0) return;
    const ok = await showRewardedAd('coins');
    if (!ok) return;
    grant(ADS.coinsReward);
    refresh();
    await showReward(ADS.coinsReward);
  }

  function buyItem(price: number, reward: Reward) {
    if (!spendCoins(price)) {
      openNotEnoughCoins(price);
      return;
    }
    grant(reward);
    try { audio.purchase(); } catch { /* */ }
    void showReward(reward, { title: t('shop.boughtTitle') });
  }

  // ---------- Scrolling ----------

  let flashTimer = 0;
  scrollToSection = (s, smooth, flash) => {
    const sec = sections[s];
    if (!sec) return;
    const y = Math.max(0, Math.round(offsetIn(sec, body)) - 4);
    if (smooth) body.scrollTo({ top: y, behavior: 'smooth' });
    else body.scrollTop = y;
    if (flash) {
      for (const x of Object.values(sections)) x.classList.remove('flash');
      void sec.offsetWidth;
      sec.classList.add('flash');
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => sec.classList.remove('flash'), 1700);
    }
  };

  // Wallet pills inside the shop jump to their section (the global opener ignores taps on the shop).
  top.el.addEventListener('click', (e) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>('.pill[data-wallet]');
    if (!pill || !el.classList.contains('active')) return;
    scrollToSection(pill.dataset.wallet === 'coins' ? 'coins' : 'items', true, true);
  });

  // ---------- Updates ----------

  function refresh() {
    for (const f of updaters) f();
  }
  store.on('shop', refresh);
  store.on('wallet', refresh);
  store.on('cosmetics', refresh);
  onLangChange(refresh);
  refresh();

  let prevScreen: string | null = null;
  onScreenChange((id) => {
    if (id !== 'shop') prevScreen = id;
  });
  let stopTimer: (() => void) | null = null;

  return {
    id: 'shop',
    el,
    tab: true,
    show(params?: { section?: ShopSection; overlay?: boolean; flash?: boolean }) {
      // Over a level (or opened from one): back arrow instead of the gear, no tab bar.
      overlay = !!(params && params.overlay) || prevScreen === 'play';
      top.setLeft(overlay ? 'back' : 'settings');
      el.classList.toggle('no-tabbar', overlay);
      if (overlay) tabbarEl().classList.add('hidden');
      refresh();
      if (params && params.section && sections[params.section]) scrollToSection(params.section, false, params.flash !== false);
      stopTimer?.();
      stopTimer = everyMinute(refresh);
    },
    hide() {
      stopTimer?.();
      stopTimer = null;
    },
  };
}
