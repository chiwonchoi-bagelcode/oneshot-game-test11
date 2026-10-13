import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './ui/styles.css';
import { store } from './state/store.ts';
import { setLang, getLang } from './i18n/i18n.ts';
import { initRouter, register, go, back, setTabBadge, currentScreen } from './ui/router.ts';
import { initPopups, closeTopPopup, anyPopupOpen } from './ui/popup.ts';
import { initToasts } from './ui/toast.ts';
import { setShopOpener } from './ui/wallet.ts';
import { setSettingsOpener } from './ui/topbar.ts';
import { audio, initAudioLifecycle } from './audio/index.ts';
import { applyAudioSettings } from './services/feedback.ts';
import { PAINTING_CSS } from './render/paintings.ts';
import { createTitleScreen } from './screens/title.ts';
import { createJourneyScreen } from './screens/journey.ts';
import { createChapterScreen } from './screens/chapter.ts';
import { createPlayScreen } from './screens/play.ts';
import { createShopScreen } from './screens/shop.ts';
import { createDailyScreen } from './screens/daily.ts';
import { createGalleryScreen } from './screens/gallery.ts';
import { openSettings } from './screens/settings.ts';
import { dailyBadge } from './state/daily.ts';
import { freeGiftAvailable } from './screens/shop.ts';
import { makePaperTexture } from './ui/paper.ts';
import { initDebug } from './debug/debug.ts';

function applyRootFlags(): void {
  const s = store.data.settings;
  document.documentElement.classList.toggle('reduce-motion', !!s.reducedMotion);
  document.documentElement.lang = getLang();
}

function refreshBadges(): void {
  try {
    setTabBadge('daily', dailyBadge());
    setTabBadge('shop', freeGiftAvailable());
  } catch (e) {
    console.error(e);
  }
}

async function waitFonts(ms: number): Promise<void> {
  const fonts = (document as any).fonts;
  if (!fonts) return;
  const loads = ['400', '700', '800', '900'].map((w) => fonts.load(`${w} 16px "Pretendard Variable"`, '물들임 Inkbloom 0123456789'));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, ms))]);
}

async function boot(): Promise<void> {
  store.init();
  setLang(store.data.settings.lang);
  applyRootFlags();
  document.documentElement.style.setProperty('--paper-tex', `url(${makePaperTexture()})`);

  const app = document.getElementById('app')!;
  const style = document.createElement('style');
  style.textContent = PAINTING_CSS;
  document.head.appendChild(style);

  initRouter(app);
  initPopups(app);
  initToasts(app);
  setShopOpener((section) => {
    if (currentScreen() === 'shop') return;
    go('shop', { section });
  });
  setSettingsOpener(() => openSettings());

  // Build every screen up front so nothing appears late.
  register(createTitleScreen());
  register(createJourneyScreen());
  register(createChapterScreen());
  register(createPlayScreen());
  register(createDailyScreen());
  register(createGalleryScreen());
  register(createShopScreen());

  initAudioLifecycle();
  applyAudioSettings();
  store.on('settings', () => {
    applyAudioSettings();
    applyRootFlags();
    if (store.data.settings.lang !== getLang()) setLang(store.data.settings.lang);
  });
  store.on('all', refreshBadges);
  refreshBadges();
  setInterval(refreshBadges, 60000);

  store.data.stats.sessions++;
  store.data.stats.lastSession = Date.now();
  store.commit('seen');

  // Android hardware back (Capacitor) and Escape on desktop.
  const onBack = () => {
    if (anyPopupOpen()) return void closeTopPopup();
    back();
  };
  const cap = (window as any).Capacitor;
  cap?.Plugins?.App?.addListener?.('backButton', onBack);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onBack();
  });

  if (import.meta.env.DEV) initDebug(app);

  await waitFonts(1800);
  go('title', undefined, { resetHistory: true });
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.style.opacity = '0';
    setTimeout(() => bootEl.remove(), 400);
  }
  // Pre-warm audio buffers on the first gesture (the title screen asks for a tap anyway).
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
}

boot();
