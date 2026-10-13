/*
 * Global game state: the save blob plus change notifications.
 * Mutate `store.data` and then call `store.commit(topic)`; listeners re-render, the save is
 * written shortly after (and immediately when the app goes to the background).
 */
import { loadSave, writeSave, wipeSave, defaultSave, type SaveData } from './save.ts';
import { detectLang } from '../i18n/i18n.ts';

export type Topic = 'wallet' | 'progress' | 'daily' | 'cosmetics' | 'settings' | 'shop' | 'seen' | 'all';

type Listener = (topic: Topic) => void;

class Store {
  data: SaveData = defaultSave('ko');
  private listeners = new Map<Topic, Set<Listener>>();
  private timer = 0;

  init(): void {
    this.data = loadSave(detectLang());
    const flush = () => this.flush();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  on(topic: Topic, fn: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  commit(topic: Topic): void {
    this.emit(topic);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 250);
  }

  emit(topic: Topic): void {
    const fire = (t: Topic) => this.listeners.get(t)?.forEach((f) => {
      try { f(topic); } catch (e) { console.error(e); }
    });
    fire(topic);
    if (topic !== 'all') fire('all');
    else for (const t of this.listeners.keys()) if (t !== 'all') fire(t);
  }

  flush(): void {
    clearTimeout(this.timer);
    writeSave(this.data);
  }

  reset(): void {
    wipeSave();
    this.data = defaultSave(this.data.settings.lang);
    this.flush();
    this.emit('all');
  }
}

export const store = new Store();

/** Local calendar day key (YYYY-MM-DD) including the debug day offset. */
export function today(): string {
  return dayKey(Date.now() + store.data.dayOffset * 86400000);
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** Shift a day key by n days. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Milliseconds until local midnight (with debug offset). */
export function msToMidnight(): number {
  const now = new Date(Date.now() + store.data.dayOffset * 86400000);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}
