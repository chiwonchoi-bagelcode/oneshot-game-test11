/*
 * Popup manager. Every popup has a fixed header (title + 48px close button) and an optional
 * fixed footer; only the body scrolls. Opening an id that is already open returns the same
 * popup, and input is briefly locked during open/close so fast double taps can't re-open or
 * dismiss things by accident.
 */
import { h, onTap, lockInput } from './dom.ts';
import { icon } from './icons.ts';
import { t } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';

export interface PopupOpts {
  id: string;
  title?: string;
  body: HTMLElement;
  foot?: HTMLElement | HTMLElement[];
  /** Show the close button and allow closing (default true). */
  closable?: boolean;
  /** Tap on the dim background closes (default = closable). */
  dimClose?: boolean;
  cls?: string;
  headCls?: string;
  onClose?: () => void;
  /** Play open/close sounds (default true). */
  sound?: boolean;
}

export interface PopupHandle {
  id: string;
  el: HTMLElement;
  sheet: HTMLElement;
  body: HTMLElement;
  close(): void;
  closed: Promise<void>;
  isOpen(): boolean;
}

let layer: HTMLElement;
const stack: PopupHandle[] = [];

export function initPopups(root: HTMLElement): void {
  layer = h('div.popup-layer');
  root.appendChild(layer);
}

export function openPopup(o: PopupOpts): PopupHandle {
  const existing = stack.find((p) => p.id === o.id);
  if (existing) return existing;
  const closable = o.closable !== false;
  const dimClose = o.dimClose ?? closable;
  let open = true;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  const dim = h('div.popup-dim');
  const sheet = h('div.popup-sheet', { role: 'dialog', 'aria-modal': 'true' });
  if (o.cls) sheet.className += ' ' + o.cls;
  const el = h('div.popup', null, dim, sheet);

  if (o.title !== undefined || closable) {
    const head = h('div.popup-head');
    if (o.headCls) head.className += ' ' + o.headCls;
    if (o.title !== undefined) head.appendChild(h('div.popup-title', { text: o.title }));
    if (closable) {
      const x = h('button.popup-close', { type: 'button', 'aria-label': t('common.close'), html: icon('close') });
      onTap(x, () => handle.close(), { sound: 'back' });
      head.appendChild(x);
    }
    sheet.appendChild(head);
  }
  const body = o.body;
  body.classList.add('popup-body');
  sheet.appendChild(body);
  if (o.foot) {
    const foot = h('div.popup-foot');
    for (const f of Array.isArray(o.foot) ? o.foot : [o.foot]) foot.appendChild(f);
    sheet.appendChild(foot);
  }

  if (dimClose) onTap(dim, () => handle.close(), { sound: 'back' });

  const handle: PopupHandle = {
    id: o.id,
    el,
    sheet,
    body,
    closed,
    isOpen: () => open,
    close() {
      if (!open) return;
      open = false;
      lockInput(160);
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      el.classList.add('closing');
      if (o.sound !== false) try { audio.popupClose(); } catch { /* */ }
      setTimeout(() => {
        el.remove();
        resolveClosed();
      }, 150);
      o.onClose?.();
    },
  };
  stack.push(handle);
  layer.appendChild(el);
  lockInput(260);
  if (o.sound !== false) try { audio.popupOpen(); } catch { /* */ }
  return handle;
}

export function topPopup(): PopupHandle | undefined {
  return stack[stack.length - 1];
}

export function anyPopupOpen(): boolean {
  return stack.length > 0;
}

/** Hardware back: close the top popup if it is closable. Returns true when handled. */
export function closeTopPopup(): boolean {
  const p = topPopup();
  if (!p) return false;
  const btn = p.sheet.querySelector<HTMLElement>('.popup-close');
  if (btn) p.close();
  return true;
}

export function closeAllPopups(): void {
  for (const p of stack.slice()) p.close();
}

/** Simple message popup with one or two buttons. Resolves true for the primary action. */
export function confirmPopup(o: { id: string; title: string; text: string; ok: string; cancel?: string; okVariant?: string; iconSvg?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const body = h('div.center');
    if (o.iconSvg) body.appendChild(h('div', { html: o.iconSvg, style: { fontSize: '64px', display: 'flex', justifyContent: 'center', marginBottom: '8px' } }));
    body.appendChild(h('p', { text: o.text, style: { margin: '0', fontSize: '16px', color: 'var(--ink-2)', lineHeight: '1.5' } }));
    const okBtn = h('button.btn', { type: 'button' }, h('span', { text: o.ok }));
    if (o.okVariant) okBtn.classList.add('btn-' + o.okVariant);
    const foot: HTMLElement[] = [];
    if (o.cancel) {
      const c = h('button.btn.btn-ghost', { type: 'button' }, h('span', { text: o.cancel }));
      onTap(c, () => p.close(), { sound: 'back' });
      foot.push(c);
    }
    onTap(okBtn, () => {
      result = true;
      p.close();
    });
    foot.push(okBtn);
    const p = openPopup({ id: o.id, title: o.title, body, foot, onClose: () => resolve(result) });
  });
}
