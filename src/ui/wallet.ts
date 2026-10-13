/*
 * Currency pills for top bars. Each pill shows the amount and a + button; tapping the pill
 * opens the shop at the matching section. Values animate when they change.
 */
import { h, onTap, countUp } from './dom.ts';
import { icon } from './icons.ts';
import { store } from '../state/store.ts';
import { fmt, t } from '../i18n/i18n.ts';

export type WalletKind = 'coins' | 'hints' | 'rewinds';

/** Set by main.ts: how a pill opens the shop. */
let openShop: (section: string) => void = () => {};
export function setShopOpener(f: (section: string) => void): void {
  openShop = f;
}

const ICON: Record<WalletKind, 'coin' | 'hint' | 'rewind'> = { coins: 'coin', hints: 'hint', rewinds: 'rewind' };
const SECTION: Record<WalletKind, string> = { coins: 'coins', hints: 'items', rewinds: 'items' };

export function createWallet(kinds: WalletKind[] = ['coins', 'hints']): HTMLElement {
  const wrap = h('div.wallet');
  for (const k of kinds) wrap.appendChild(createPill(k));
  return wrap;
}

export function createPill(kind: WalletKind): HTMLElement {
  const val = h('span.val', { text: fmt(store.data[kind]) });
  const pill = h('button.pill', { type: 'button', 'data-wallet': kind, 'aria-label': t('currency.' + kind) + ' ' + t('currency.add'), html: icon(ICON[kind]) }, val, h('span.add', { html: icon('plus') }));
  onTap(pill, () => openShop(SECTION[kind]));
  let shown = store.data[kind];
  const refresh = () => {
    const now = store.data[kind];
    if (now === shown) return;
    if (pill.isConnected && pill.offsetParent !== null) {
      countUp(val, shown, now, 600, fmt);
      if (now > shown) {
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
      }
    } else val.textContent = fmt(now);
    shown = now;
  };
  store.on('wallet', refresh);
  store.on('all', refresh);
  return pill;
}

/** Visible pill of a kind (for flying-coin animations). */
export function visiblePill(kind: WalletKind): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`.pill[data-wallet="${kind}"]`);
  for (const p of all) if (p.offsetParent !== null && p.closest('.screen.active, .popup')) return p;
  return null;
}
