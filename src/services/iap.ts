/*
 * In-app purchases (placeholder). `charge()` is where the store SDK goes (e.g. RevenueCat /
 * cordova-plugin-purchase). Product data, once-only rules, reward granting and restore are final.
 */
import { PRODUCTS, type Product } from '../config/balance.ts';
import { store } from '../state/store.ts';
import { grant } from '../state/economy.ts';
import { h, onTap } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { openPopup } from '../ui/popup.ts';
import { showReward } from '../ui/reward.ts';
import { toast } from '../ui/toast.ts';
import { t, fmtPrice } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';

export function product(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function canBuy(id: string): boolean {
  const p = product(id);
  if (!p) return false;
  return !(p.once && store.data.shop.bought.includes(id));
}

export async function purchase(id: string): Promise<boolean> {
  const p = product(id);
  if (!p || !canBuy(id)) return false;
  const ok = await charge(p);
  if (!ok) return false;
  store.data.shop.bought.push(id);
  store.commit('shop');
  grant(p.reward);
  audio.purchase();
  await showReward(p.reward, { title: t('iap.thanks'), subtitle: t('product.' + id + '.name') });
  return true;
}

/** Placeholder for the platform payment sheet. */
function charge(p: Product): Promise<boolean> {
  return new Promise((resolve) => {
    let paid = false;
    const body = h('div.center', null,
      h('div', { html: icon(p.kind === 'coins' ? 'coin' : 'gift'), style: { fontSize: '72px', display: 'flex', justifyContent: 'center' } }),
      h('div', { text: t('product.' + p.id + '.name'), style: { fontSize: '19px', fontWeight: '850', marginTop: '8px' } }),
      h('div', { text: fmtPrice(p.price), style: { fontSize: '17px', fontWeight: '700', color: 'var(--ink-2)', marginTop: '4px' } }),
      import.meta.env.DEV ? h('div', { text: t('iap.testNote'), style: { fontSize: '13px', color: 'var(--ink-3)', marginTop: '12px' } }) : null,
    );
    const pay = h('button.btn.btn-jade', { type: 'button' }, h('span', { text: t('iap.pay') }));
    const pop = openPopup({ id: 'iap-confirm', title: t('iap.confirmTitle'), body, foot: pay, onClose: () => resolve(paid) });
    onTap(pay, () => {
      paid = true;
      pop.close();
    });
  });
}

/** Re-applies non-consumable content (cosmetics) from past purchases. */
export async function restorePurchases(): Promise<void> {
  let restored = 0;
  for (const id of store.data.shop.bought) {
    const p = product(id);
    const c = p?.reward.cosmetic;
    if (c && !store.data.cosmetics.owned.includes(c)) {
      store.data.cosmetics.owned.push(c);
      restored++;
    }
  }
  if (restored) store.commit('cosmetics');
  toast(restored ? t('iap.restored') : t('iap.nothingToRestore'));
}
