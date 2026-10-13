/*
 * Tiny i18n. Strings live in src/i18n/strings/*.ts, one file per feature, each exporting
 * `{ ko: {...}, en: {...} }`. Keys are dotted: 'shop.title'. Params: t('x', { n: 3 }) → "{n}".
 */
import { STRINGS } from './strings/index.ts';

export type Lang = 'ko' | 'en';

let lang: Lang = 'ko';
const listeners = new Set<() => void>();

export function detectLang(): Lang {
  const l = (navigator.languages && navigator.languages[0]) || navigator.language || 'ko';
  return l.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function has(key: string): boolean {
  return key in STRINGS[lang];
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = STRINGS[lang][key];
  if (s === undefined) {
    s = STRINGS.en[key] ?? STRINGS.ko[key];
    if (s === undefined) {
      if (import.meta.env?.DEV) console.warn('[i18n] missing', key);
      return key;
    }
  }
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => {
      const v = params[k];
      if (v === undefined) return m;
      return typeof v === 'number' ? fmt(v) : v;
    });
  }
  return s;
}

/** Integer formatting with grouping (1,200). Never shows decimals. */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US');
}

/** Store price placeholder formatting (₩2,500 / $1.99). */
export function fmtPrice(p: { krw: number; usd: number }): string {
  if (lang === 'ko') return '₩' + p.krw.toLocaleString('ko-KR');
  return '$' + p.usd.toFixed(2);
}

/** Applies translations to [data-i18n] elements under root (textContent) and [data-i18n-aria]. */
export function translateTree(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria!));
  });
}
