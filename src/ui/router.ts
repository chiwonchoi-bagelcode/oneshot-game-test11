/*
 * Screen router. All screens are built once at boot (so nothing pops in late) and shown/hidden.
 * Tab screens share the bottom tab bar. go() keeps a small history for the back button.
 */
import { h, onTap, lockInput } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { t, onLangChange } from '../i18n/i18n.ts';

export interface Screen {
  id: string;
  el: HTMLElement;
  /** Shows the bottom tab bar (journey, daily, gallery, shop). */
  tab?: boolean;
  /** Called every time the screen becomes visible. */
  show?(params?: any): void;
  /** Called when the screen is hidden. */
  hide?(): void;
  /** Hardware/back handling. Return true when handled. */
  back?(): boolean;
}

const TABS: { id: string; icon: IconName; label: string }[] = [
  { id: 'journey', icon: 'journey', label: 'nav.journey' },
  { id: 'daily', icon: 'daily', label: 'nav.daily' },
  { id: 'gallery', icon: 'gallery', label: 'nav.gallery' },
  { id: 'shop', icon: 'shop', label: 'nav.shop' },
];

const screens = new Map<string, Screen>();
let container: HTMLElement;
let tabbar: HTMLElement;
const tabEls = new Map<string, HTMLElement>();
let current: Screen | null = null;
let history: { id: string; params?: any }[] = [];
const changeListeners = new Set<(id: string) => void>();

export function initRouter(root: HTMLElement): void {
  container = h('div.screens', { style: { position: 'absolute', inset: '0' } });
  root.appendChild(container);
  tabbar = h('nav.tabbar.hidden', { role: 'tablist' });
  for (const tb of TABS) {
    const el = h('button.tab', { type: 'button', role: 'tab', 'data-tab': tb.id, html: icon(tb.icon) }, h('span', { text: t(tb.label) }));
    onTap(el, () => {
      if (current && current.id === tb.id) return;
      go(tb.id, undefined, { resetHistory: true });
    });
    tabEls.set(tb.id, el);
    tabbar.appendChild(el);
  }
  root.appendChild(tabbar);
  onLangChange(() => {
    for (const tb of TABS) tabEls.get(tb.id)!.querySelector('span')!.textContent = t(tb.label);
  });
}

export function register(s: Screen): void {
  screens.set(s.id, s);
  s.el.classList.add('screen');
  if (!s.tab) s.el.classList.add('no-tabbar');
  container.appendChild(s.el);
}

export function go(id: string, params?: any, opts: { resetHistory?: boolean; noHistory?: boolean } = {}): void {
  const next = screens.get(id);
  if (!next) throw new Error('unknown screen ' + id);
  lockInput(240);
  if (current && current !== next) {
    if (!opts.noHistory) history.push({ id: current.id, params: current.id === 'play' ? { resume: true } : undefined });
    current.el.classList.remove('active', 'enter');
    current.hide?.();
  }
  if (opts.resetHistory) history = [];
  if (history.length > 12) history.shift();
  current = next;
  next.el.classList.add('active');
  next.el.classList.remove('enter');
  void next.el.offsetWidth;
  next.el.classList.add('enter');
  // A tab screen opened on top of a level (e.g. shop from the play screen) hides the tab bar.
  tabbar.classList.toggle('hidden', !next.tab || !!(params && params.overlay));
  for (const [tid, el] of tabEls) el.classList.toggle('active', tid === id);
  next.show?.(params);
  changeListeners.forEach((f) => f(id));
}

/** Navigate back; returns false when there is nowhere to go. */
export function back(): boolean {
  if (current?.back?.()) return true;
  const prev = history.pop();
  if (!prev) return false;
  go(prev.id, prev.params, { noHistory: true });
  return true;
}

export function currentScreen(): string | null {
  return current ? current.id : null;
}

export function setTabBadge(id: string, on: boolean): void {
  const el = tabEls.get(id);
  if (!el) return;
  let dot = el.querySelector('.dot');
  if (on && !dot) el.appendChild(h('i.dot'));
  if (!on && dot) dot.remove();
}

export function onScreenChange(f: (id: string) => void): void {
  changeListeners.add(f);
}

export function tabbarEl(): HTMLElement {
  return tabbar;
}
