/*
 * Small helpers shared by the meta screens (shop, daily, gallery, settings):
 * reward chips, plural-aware strings, countdown text, cosmetic lookups and board previews.
 */
import { h } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { t, fmt, has } from '../i18n/i18n.ts';
import { COSMETICS, DAILY, PRODUCTS, type Cosmetic, type Reward } from '../config/balance.ts';
import { CHAPTERS } from '../levels/pack.ts';
import { runSolution, type LevelDef } from '../core/sim.ts';
import { renderThumbnail } from '../render/board.ts';
import { store } from '../state/store.ts';

/** t() with an English singular form: uses `key.one` when n === 1 and it exists. */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
  const k = n === 1 && has(key + '.one') ? key + '.one' : key;
  return t(k, { n, ...params });
}

/** "5시간 12분" / "5h 12m" (never seconds; rounds up so it never shows 0). */
export function fmtCountdown(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const hh = Math.floor(mins / 60), mm = mins % 60;
  // Non-breaking spaces: a duration never splits across lines.
  return (hh > 0 ? t('time.hm', { h: hh, m: mm }) : t('time.m', { m: mm })).replace(/ /g, '\u00a0');
}

/** Scroll position inside `container` that puts `el` at its top (independent of offsetParent). */
export function offsetIn(el: HTMLElement, container: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

/** Calls fn now and then on every minute boundary while `active()` is true. Returns a stop function. */
export function everyMinute(fn: () => void): () => void {
  let timer = 0;
  const schedule = () => {
    const ms = 60000 - (Date.now() % 60000) + 50;
    timer = window.setTimeout(() => {
      fn();
      schedule();
    }, ms);
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Inline chips for a reward: coin 25 · hint ×1 · rewind ×1 · cosmetic name. */
export function rewardChips(r: Reward, cls = ''): HTMLElement {
  const wrap = h('div.rw-chips' + (cls ? '.' + cls : ''));
  fillRewardChips(wrap, r);
  return wrap;
}

export function fillRewardChips(wrap: HTMLElement, r: Reward): void {
  wrap.textContent = '';
  if (r.coins) wrap.appendChild(h('span.rw', { html: icon('coin') }, h('b', { text: fmt(r.coins) })));
  if (r.hints) wrap.appendChild(h('span.rw', { html: icon('hint') }, h('b', { text: '×' + fmt(r.hints) })));
  if (r.rewinds) wrap.appendChild(h('span.rw', { html: icon('rewind') }, h('b', { text: '×' + fmt(r.rewinds) })));
  if (r.cosmetic) {
    const c = cosmeticById(r.cosmetic);
    wrap.appendChild(h('span.rw.cos', { html: icon(c && c.kind === 'paper' ? 'paper' : 'brush') }, h('b', { text: t('cosmetic.' + r.cosmetic) })));
  }
}

// ---------- Cosmetics ----------

export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export function ownsCosmetic(id: string): boolean {
  return store.data.cosmetics.owned.includes(id);
}

export function isEquipped(c: Cosmetic): boolean {
  return c.kind === 'ink' ? store.data.cosmetics.ink === c.id : store.data.cosmetics.paper === c.id;
}

export function equipCosmetic(c: Cosmetic): void {
  if (c.kind === 'ink') store.data.cosmetics.ink = c.id;
  else store.data.cosmetics.paper = c.id;
  store.commit('cosmetics');
}

export type CosmeticSource =
  | { kind: 'default' }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'streak'; days: number }
  | { kind: 'bundle'; product: string }
  | null;

/** Where a cosmetic comes from when it isn't simply bought (first match wins). */
export function cosmeticSource(c: Cosmetic): CosmeticSource {
  if (c.source === 'default' || c.price === 0) return { kind: 'default' };
  if (c.source === 'chapter' && c.chapter !== undefined) return { kind: 'chapter', chapter: c.chapter };
  const ms = DAILY.streakMilestones.find((m) => m.reward.cosmetic === c.id);
  if (c.source === 'streak' && ms) return { kind: 'streak', days: ms.days };
  const p = PRODUCTS.find((x) => x.reward.cosmetic === c.id);
  if (c.source === 'bundle' && p) return { kind: 'bundle', product: p.id };
  return null;
}

export function cosmeticSourceText(c: Cosmetic): string {
  const s = cosmeticSource(c);
  if (!s) return '';
  if (s.kind === 'default') return t('gallery.source.default');
  if (s.kind === 'chapter') return t('gallery.source.chapter', { name: t('chapter.' + CHAPTERS[s.chapter]?.id + '.name') });
  if (s.kind === 'streak') return t('gallery.source.streak', { n: s.days });
  return t('gallery.source.bundle', { name: t('product.' + s.product + '.name') });
}

/** Coin price when the cosmetic can be bought with coins. */
export function cosmeticPrice(c: Cosmetic): number | null {
  return c.price && c.price > 0 ? c.price : null;
}

// ---------- Board previews ----------

/** Built-in 5×5 samples: all six colours for ink sets; short inks that leave paper showing for papers. */
const SAMPLES: Record<'ink' | 'paper', LevelDef> = {
  ink: {
    id: 'cosmetic-sample-ink',
    map: ['.....', '.....', '..#..', '.....', '.....'],
    goal: ['.....', '.....', '.....', '.....', '.....'],
    inks: ['R', 'Y', 'B'],
    solution: [{ x: 0, y: 0, t: 0 }, { x: 4, y: 0, t: 0 }, { x: 2, y: 4, t: 0 }],
  },
  paper: {
    id: 'cosmetic-sample-paper',
    map: ['.....', '.....', '..#..', '.....', '.....'],
    goal: ['.....', '.....', '.....', '.....', '.....'],
    inks: ['R2', 'Y2', 'B2'],
    solution: [{ x: 0, y: 0, t: 0 }, { x: 4, y: 0, t: 0 }, { x: 4, y: 4, t: 0 }],
  },
};

const sampleSims: Partial<Record<'ink' | 'paper', ReturnType<typeof runSolution>['sim']>> = {};

/** Canvas of a solved sample board drawn with the given ink set and paper (`px` CSS pixels, square). */
export function boardPreview(ink: string, paper: string, px: number, sample: 'ink' | 'paper' = 'ink'): HTMLCanvasElement {
  const sim = sampleSims[sample] || (sampleSims[sample] = runSolution(SAMPLES[sample], SAMPLES[sample].solution).sim);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const c = renderThumbnail(sim, Math.round(px * dpr), { ink, paper, symbols: !!store.data.settings.symbols, reducedMotion: true });
  c.style.width = px + 'px';
  c.style.height = px + 'px';
  c.style.display = 'block';
  return c;
}

// ---------- Heavy-job queue (board thumbnails) ----------

const jobs: { id: string; run: () => void; urgent: boolean }[] = [];
let pumping = false;

/**
 * Runs heavy jobs (board thumbnails cost ~50 ms each) one per frame so a screen never stalls.
 * Urgent jobs (what's on screen now) go first on animation frames; the rest run when the
 * browser is idle. A job with the same id replaces the queued one.
 */
export function enqueue(id: string, run: () => void, urgent = false): void {
  const i = jobs.findIndex((j) => j.id === id);
  if (i >= 0) {
    urgent = urgent || jobs[i].urgent;
    jobs.splice(i, 1);
  }
  if (urgent) {
    let k = 0;
    while (k < jobs.length && jobs[k].urgent) k++;
    jobs.splice(k, 0, { id, run, urgent });
  } else jobs.push({ id, run, urgent });
  pump();
}

function pump(): void {
  if (pumping || !jobs.length) return;
  pumping = true;
  const step = () => {
    pumping = false;
    const j = jobs.shift();
    if (j) {
      try { j.run(); } catch (e) { console.error(e); }
    }
    pump();
  };
  const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
  if (jobs[0].urgent || !ric) requestAnimationFrame(() => setTimeout(step, 0));
  else ric(step, { timeout: 1200 });
}

/** Same picture at once (e.g. a card's preview reused in a popup while the crisp one renders). */
export function copyCanvas(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.style.width = px + 'px';
  c.style.height = px + 'px';
  c.style.display = 'block';
  return c;
}
