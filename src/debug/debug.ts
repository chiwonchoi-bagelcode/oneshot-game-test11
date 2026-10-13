/*
 * Developer panel — only bundled in dev builds (main.ts calls initDebug behind import.meta.env.DEV).
 * Grants currency, unlocks/clears levels, moves the clock, simulates a notch, resets the save.
 * Also exposes window.__ink for automated tests.
 */
import { h, onTap, button } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { openPopup, closeAllPopups } from '../ui/popup.ts';
import { toast } from '../ui/toast.ts';
import { go, currentScreen } from '../ui/router.ts';
import { store, today } from '../state/store.ts';
import { grant } from '../state/economy.ts';
import { debugClearUpTo, nextLevelIndex } from '../state/progress.ts';
import { ALL_LEVELS, levelInfo } from '../levels/pack.ts';
import { debugHooks } from '../screens/play.ts';
import { setLang, getLang } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';

export function initDebug(app: HTMLElement): void {
  const fab = h('button', {
    type: 'button',
    'aria-label': 'debug',
    html: icon('bug'),
    style: {
      position: 'absolute', left: '0', top: '45%', zIndex: '400', width: '34px', height: '44px', borderRadius: '0 12px 12px 0',
      background: 'rgba(43,39,51,.55)', color: '#fff', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  });
  onTap(fab, open, { sound: false });
  app.appendChild(fab);

  (window as any).__ink = {
    store,
    go,
    grant,
    clearUpTo: debugClearUpTo,
    autoplay: (on: boolean) => debugHooks.autoplay(on),
    state: () => debugHooks.state(),
    solveNow: () => debugHooks.solveNow(),
    timeScale: (k: number) => debugHooks.setTimeScale(k),
    cellCenter: (i: number) => debugHooks.cellCenter(i),
    info: () => debugHooks.info(),
    hideDebug: () => { const b = document.querySelector('[aria-label=debug]') as HTMLElement | null; if (b) b.style.display = 'none'; },
    levels: ALL_LEVELS.map((l) => l.id),
    today,
    screen: currentScreen,
    audioInfo: () => audio.debugInfo(),
    setLang: (l: 'ko' | 'en') => { store.data.settings.lang = l; store.commit('settings'); setLang(l); },
    notch: (on: boolean) => document.documentElement.classList.toggle('fake-notch', on),
  };
}

function open(): void {
  const levelInput = h('input', { type: 'number', min: '1', max: String(ALL_LEVELS.length), value: String(Math.max(1, nextLevelIndex() + 1)), style: { width: '90px', height: '44px', fontSize: '17px', borderRadius: '12px', border: '2px solid var(--line)', padding: '0 10px', fontFamily: 'inherit' } }) as HTMLInputElement;
  const dayInfo = h('div', { text: '', style: { fontWeight: '700', color: 'var(--ink-2)' } });
  const refreshDay = () => (dayInfo.textContent = `${today()} (offset ${store.data.dayOffset})`);
  refreshDay();
  const section = (title: string, ...kids: HTMLElement[]) =>
    h('div', { style: { marginBottom: '16px' } }, h('div', { text: title, style: { fontWeight: '850', marginBottom: '8px' } }), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, ...kids));
  const sm = (label: string, fn: () => void, variant = 'ghost') => button(label, fn, { size: 'sm', variant });

  const body = h('div', null,
    section('Wallet',
      sm('+1,000 coins', () => grant({ coins: 1000 })),
      sm('+10 hints', () => grant({ hints: 10 })),
      sm('+10 rewinds', () => grant({ rewinds: 10 })),
      sm('Coins → 0', () => { store.data.coins = 0; store.commit('wallet'); }),
      sm('Items → 0', () => { store.data.hints = 0; store.data.rewinds = 0; store.commit('wallet'); }),
    ),
    section('Levels',
      levelInput,
      sm('Unlock up to #', () => { const n = +levelInput.value; debugClearUpTo(n - 2); toast('Unlocked up to ' + n); }),
      sm('Play #', () => { const n = +levelInput.value; closeAllPopups(); go('play', { index: n - 1 }); }),
      sm('Clear all', () => debugClearUpTo(ALL_LEVELS.length - 1)),
      sm('Seal all', () => debugClearUpTo(ALL_LEVELS.length - 1, true)),
    ),
    section('Current level',
      sm('Solve now', () => { closeAllPopups(); debugHooks.solveNow(); }, 'jade'),
      sm('Autoplay', () => { closeAllPopups(); debugHooks.autoplay(true); }),
      sm('Stop autoplay', () => debugHooks.autoplay(false)),
    ),
    section('Day', dayInfo,
      sm('Next day', () => { store.data.dayOffset++; store.commit('all'); refreshDay(); }),
      sm('Prev day', () => { store.data.dayOffset--; store.commit('all'); refreshDay(); }),
      sm('Reset daily', () => { store.data.daily = { days: {}, streak: 0, best: 0, last: null, claimed: [] }; store.data.shop.gift = null; store.data.shop.adDay = null; store.commit('all'); }),
    ),
    section('Device',
      sm('Notch on/off', () => document.documentElement.classList.toggle('fake-notch')),
      sm('KO / EN', () => { const l = getLang() === 'ko' ? 'en' : 'ko'; store.data.settings.lang = l; store.commit('settings'); setLang(l); }),
      sm('Reset seen', () => { store.data.seen = {}; store.commit('seen'); }),
    ),
    section('Save',
      sm('Reset all progress', () => { if (confirm('Reset everything?')) { store.reset(); location.reload(); } }, ''),
    ),
    h('div', { text: (() => { const i = nextLevelIndex(); return i >= 0 ? 'Next: ' + ALL_LEVELS[i].id + ' #' + levelInfo(ALL_LEVELS[i].id)?.number : 'All clear'; })(), style: { color: 'var(--ink-3)', fontSize: '13px' } }),
  );
  openPopup({ id: 'debug', title: 'Debug', body });
}
