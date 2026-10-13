/* Shared top bar: optional back or settings button on the left, title, wallet pills on the right. */
import { h, iconButton } from './dom.ts';
import { icon } from './icons.ts';
import { createWallet, type WalletKind } from './wallet.ts';
import { t } from '../i18n/i18n.ts';

let settingsOpener: () => void = () => {};
export function setSettingsOpener(f: () => void): void {
  settingsOpener = f;
}
export function openSettingsPopup(): void {
  settingsOpener();
}

export interface TopbarOpts {
  /** Left button: 'settings' gear, 'back' arrow, or none. */
  left?: 'settings' | 'back' | null;
  onBack?: () => void;
  title?: string;
  wallet?: WalletKind[];
}

export interface Topbar {
  el: HTMLElement;
  setTitle(s: string): void;
  /** Swap the left button at runtime (e.g. shop opened over a level shows a back button). */
  setLeft(kind: 'settings' | 'back' | null): void;
}

export function createTopbar(o: TopbarOpts): Topbar {
  const el = h('header.topbar');
  const left = h('div', { style: { display: 'flex', flex: 'none', minWidth: '52px' } });
  const title = h('div.topbar-title', { text: o.title || '' });
  el.appendChild(left);
  el.appendChild(title);
  if (o.wallet && o.wallet.length) el.appendChild(createWallet(o.wallet));
  else el.appendChild(h('div', { style: { minWidth: '52px' } }));
  const setLeft = (kind: 'settings' | 'back' | null) => {
    left.innerHTML = '';
    if (kind === 'settings') left.appendChild(iconButton(icon('gear'), () => settingsOpener(), { label: t('common.settings') }));
    else if (kind === 'back') left.appendChild(iconButton(icon('back'), () => o.onBack?.(), { label: t('common.back'), sound: 'back' }));
  };
  setLeft(o.left ?? null);
  if (!o.title) title.style.visibility = 'hidden';
  return {
    el,
    setTitle(s: string) {
      title.textContent = s;
      title.style.visibility = s ? '' : 'hidden';
    },
    setLeft,
  };
}
