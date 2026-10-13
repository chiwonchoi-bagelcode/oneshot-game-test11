/*
 * Reward reveal: dark stage, light rays, items pop in one by one. Tapping anywhere skips the
 * animation; tapping again closes. Coins then fly into the wallet pill.
 */
import { h, onTap, lockInput } from './dom.ts';
import { icon } from './icons.ts';
import { openPopup } from './popup.ts';
import { visiblePill } from './wallet.ts';
import { t, fmt } from '../i18n/i18n.ts';
import type { Reward } from '../config/balance.ts';
import { audio } from '../audio/index.ts';
import { buzz } from '../services/feedback.ts';
import { boardPreview } from '../screens/meta-common.ts';
import { store } from '../state/store.ts';

export function rewardItemEls(r: Reward): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (r.coins) out.push(h('div.reward-item', { html: icon('coin') }, h('span', { text: fmt(r.coins) }), h('small', { text: t('currency.coins') })));
  if (r.hints) out.push(h('div.reward-item', { html: icon('hint') }, h('span', { text: '×' + fmt(r.hints) }), h('small', { text: t('currency.hints') })));
  if (r.rewinds) out.push(h('div.reward-item', { html: icon('rewind') }, h('span', { text: '×' + fmt(r.rewinds) }), h('small', { text: t('currency.rewinds') })));
  if (r.cosmetic) {
    const isInk = r.cosmetic.startsWith('ink');
    const item = h('div.reward-item', { style: { width: '132px' } });
    try {
      const prev = isInk ? boardPreview(r.cosmetic, store.data.cosmetics.paper, 60, 'ink') : boardPreview(store.data.cosmetics.ink, r.cosmetic, 60, 'paper');
      prev.style.borderRadius = '12px';
      item.appendChild(prev);
    } catch {
      item.insertAdjacentHTML('beforeend', icon(isInk ? 'brush' : 'paper'));
    }
    item.append(h('span', { text: t('cosmetic.' + r.cosmetic), style: { fontSize: '15px', color: 'var(--accent)' } }), h('small', { text: t(isInk ? 'gallery.kind.ink' : 'gallery.kind.paper') }));
    out.push(item);
  }
  return out;
}

/**
 * Shows the reward stage. The reward must already be granted by the caller (so a crash or
 * app kill mid-animation never loses it). Resolves when the player dismisses it.
 */
export function showReward(r: Reward, opts: { title?: string; subtitle?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    const items = rewardItemEls(r);
    const list = h('div.reward-items');
    const title = h('div', { text: opts.title || t('reward.title'), style: { fontSize: '26px', fontWeight: '850', color: '#fff', textAlign: 'center', letterSpacing: '-0.02em' } });
    const sub = opts.subtitle ? h('div', { text: opts.subtitle, style: { fontSize: '15px', color: 'rgba(255,255,255,.8)', textAlign: 'center', marginTop: '6px', fontWeight: '600' } }) : null;
    const hint = h('div.tap-hint', { text: t('common.tapToContinue'), style: { marginTop: '22px', opacity: '0' } });
    const stage = h('div', { style: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '24px 8px' } }, h('div.rays'), title, sub, list, hint);
    const body = h('div', { style: { overflow: 'visible', padding: '0' } }, stage);
    const p = openPopup({ id: 'reward', body, closable: false, dimClose: false, cls: 'reward-sheet', sound: false, onClose: () => { flyCoins(r); resolve(); } });
    p.sheet.style.background = 'transparent';
    p.sheet.style.boxShadow = 'none';
    p.sheet.style.overflow = 'visible';
    (p.el.querySelector('.popup-dim') as HTMLElement).style.background = 'rgba(24,16,10,.82)';
    audio.reward();
    buzz('success');
    let done = false;
    const timers: number[] = [];
    items.forEach((it, i) => {
      it.style.opacity = '0';
      list.appendChild(it);
      timers.push(window.setTimeout(() => {
        it.style.opacity = '';
        it.classList.add('pop');
        buzz('light');
      }, 260 + i * 220));
    });
    const finishAt = 260 + items.length * 220 + 200;
    timers.push(window.setTimeout(() => { done = true; hint.style.opacity = ''; }, finishAt));
    onTap(p.el, () => {
      if (!done) {
        timers.forEach(clearTimeout);
        for (const it of items) { it.style.opacity = ''; it.classList.remove('pop'); }
        hint.style.opacity = '';
        done = true;
        lockInput(120);
        return;
      }
      p.close();
    }, { sound: false, guard: 150, force: true });
  });
}

/** Coins fly from the centre of the screen into the visible coin pill. */
export function flyCoins(r: Reward, from?: { x: number; y: number }): void {
  if (!r.coins) return;
  const pill = visiblePill('coins');
  const app = document.getElementById('app')!;
  if (!pill) return;
  const ar = app.getBoundingClientRect();
  const pr = pill.getBoundingClientRect();
  const tx = pr.left - ar.left + 8, ty = pr.top - ar.top + 6;
  const sx = from ? from.x : ar.width / 2 - 15, sy = from ? from.y : ar.height * 0.45;
  const n = Math.min(10, 3 + Math.floor(r.coins / 40));
  for (let i = 0; i < n; i++) {
    const c = h('div.fly-coin', { html: icon('coin') });
    c.style.left = '0px';
    c.style.top = '0px';
    app.appendChild(c);
    const dx = (Math.random() - 0.5) * 120, dy = (Math.random() - 0.5) * 80;
    const anim = c.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${sx + dx}px, ${sy + dy}px) scale(1.1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px, ${ty}px) scale(.7)`, opacity: 1 },
      ],
      { duration: 700 + i * 45, easing: 'cubic-bezier(.5,0,.6,1)', delay: i * 35 },
    );
    anim.onfinish = () => c.remove();
  }
  setTimeout(() => {
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
    try { audio.coins(Math.min(10, n)); } catch { /* */ }
  }, 650);
}
