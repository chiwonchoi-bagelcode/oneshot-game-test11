import { h } from './dom.ts';

let layer: HTMLElement;
const live = new Map<string, HTMLElement>();

export function initToasts(root: HTMLElement): void {
  layer = h('div.toast-layer', { 'aria-live': 'polite' });
  root.appendChild(layer);
}

/** Short message near the top. Identical messages don't stack. */
export function toast(text: string, ms = 1800): void {
  const prev = live.get(text);
  if (prev) prev.remove();
  const el = h('div.toast', { text });
  layer.appendChild(el);
  live.set(text, el);
  while (layer.children.length > 2) layer.firstElementChild!.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      if (live.get(text) === el) live.delete(text);
    }, 230);
  }, ms);
}
