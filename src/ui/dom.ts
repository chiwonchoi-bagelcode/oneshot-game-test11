/* Small DOM helpers shared by every screen. */
import { sfx } from '../services/feedback.ts';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, any> | null;

/** Hyperscript: h('div.card.row', { onclick }, child...) */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(sel);
  const tag = (m && m[1]) || 'div';
  const el = document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let inputLockUntil = 0;
/** Ignore taps for a short time (screen/popup transitions) so double taps can't double-open things. */
export function lockInput(ms: number): void {
  inputLockUntil = Math.max(inputLockUntil, performance.now() + ms);
}
export function inputLocked(): boolean {
  return performance.now() < inputLockUntil;
}

export interface TapOpts {
  /** Sound: 'tap' (default), 'back', or false for none. */
  sound?: 'tap' | 'back' | false;
  /** Minimum ms between two activations of this element (default 350). */
  guard?: number;
  /** Fire even while input is locked (e.g. "tap to skip" layers). */
  force?: boolean;
}

/**
 * Click handler with: single-activation guard, global transition lock, button sound and haptic.
 * Uses 'click' so scrolling lists don't trigger it, and fires on the first tap (no hover states).
 */
export function onTap(el: HTMLElement, fn: (e: MouseEvent) => void, opts: TapOpts = {}): HTMLElement {
  let last = 0;
  const guard = opts.guard ?? 350;
  el.addEventListener('click', (e) => {
    const now = performance.now();
    if (!opts.force && inputLocked()) return;
    if (now - last < guard) return;
    if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return;
    last = now;
    if (opts.sound !== false) sfx(opts.sound === 'back' ? 'back' : 'tap');
    fn(e);
  });
  return el;
}

/** Button factory. variant: '' (vermilion) | 'jade' | 'gold' | 'blue' | 'violet' | 'ghost'. */
export function button(label: string | Node, fn: (e: MouseEvent) => void, opts: { variant?: string; size?: 'sm' | 'lg'; icon?: string; block?: boolean; cls?: string; sound?: 'tap' | 'back' | false } = {}): HTMLButtonElement {
  const b = h('button.btn', { type: 'button' }) as HTMLButtonElement;
  if (opts.variant) b.classList.add('btn-' + opts.variant);
  if (opts.size) b.classList.add('btn-' + opts.size);
  if (opts.block) b.classList.add('btn-block');
  if (opts.cls) b.className += ' ' + opts.cls;
  if (opts.icon) b.insertAdjacentHTML('beforeend', opts.icon);
  if (typeof label === 'string') b.appendChild(h('span', { text: label }));
  else b.appendChild(label);
  onTap(b, fn, { sound: opts.sound });
  return b;
}

export function iconButton(iconSvg: string, fn: (e: MouseEvent) => void, opts: { label: string; cls?: string; sound?: 'tap' | 'back' | false } = { label: '' }): HTMLButtonElement {
  const b = h('button.icon-btn', { type: 'button', 'aria-label': opts.label, html: iconSvg }) as HTMLButtonElement;
  if (opts.cls) b.className += ' ' + opts.cls;
  onTap(b, fn, { sound: opts.sound });
  return b;
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Animate a number in an element from a to b (integers only). */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, format: (n: number) => string): void {
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
