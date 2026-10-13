/*
 * Rewarded ads (placeholder). The real SDK call goes in `playAd()`; everything else — daily caps,
 * counters, the reward hand-off — is final. Ads only ever play when the player asks for one;
 * the game never interrupts a puzzle with ads.
 */
import { ADS } from '../config/balance.ts';
import { store, today } from '../state/store.ts';
import { h, onTap } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { openPopup } from '../ui/popup.ts';
import { toast } from '../ui/toast.ts';
import { t } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';

export type AdPlacement = 'hint' | 'double' | 'coins';

const CAP: Record<AdPlacement, number> = { hint: ADS.hintPerDay, double: ADS.doublePerDay, coins: ADS.coinsPerDay };

function rollDay(): void {
  const s = store.data.shop;
  const d = today();
  if (s.adDay !== d) {
    s.adDay = d;
    s.ads = { hint: 0, double: 0, coins: 0 };
    store.commit('shop');
  }
}

export function adsLeft(p: AdPlacement): number {
  rollDay();
  return Math.max(0, CAP[p] - store.data.shop.ads[p]);
}

/** Shows a rewarded ad. Resolves true only if the player watched it to the end. */
export async function showRewardedAd(p: AdPlacement): Promise<boolean> {
  if (adsLeft(p) <= 0) {
    toast(t('ad.limit'), 2400);
    return false;
  }
  audio.beatStop();
  const ok = await playAd();
  if (ok) {
    store.data.shop.ads[p] += 1;
    store.commit('shop');
  }
  return ok;
}

/** Placeholder ad player: a fake ad card with a countdown. Replace with the ad SDK. */
function playAd(): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    let secs = Math.ceil(ADS.placeholderMs / 1000);
    const count = h('div', { text: t('ad.wait', { n: secs }), style: { fontWeight: '800', fontSize: '15px', color: 'var(--ink-2)' } });
    const screen = h('div', { style: { height: '220px', borderRadius: '18px', background: 'linear-gradient(135deg,#3b3550,#6b4f8a)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '64px' }, html: icon('ad') }, h('div', { text: t('ad.body'), style: { fontSize: '15px', fontWeight: '700', opacity: '.9' } }));
    const btn = h('button.btn.btn-jade.disabled', { type: 'button' }, h('span', { text: t('ad.done') }));
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' } }, screen, count);
    const pop = openPopup({ id: 'ad', title: t('ad.title'), body, foot: btn, onClose: () => resolve(finished) });
    const timer = setInterval(() => {
      secs -= 1;
      if (secs > 0) count.textContent = t('ad.wait', { n: secs });
      else {
        clearInterval(timer);
        count.textContent = '';
        btn.classList.remove('disabled');
      }
    }, 1000);
    onTap(btn, () => {
      finished = true;
      pop.close();
    });
    pop.closed.then(() => clearInterval(timer));
  });
}
