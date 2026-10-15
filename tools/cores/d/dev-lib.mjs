/*
 * Core D: quick browser helpers against a running dev server (iteration only; the acceptance
 * scripts use tools/e2e/core-lib.mjs and a real build).
 *   VITE_CORE=d VITE_DEBUG=1 npx vite --port 5404
 */
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
export const DEV = process.env.D_URL || 'http://localhost:5404/';

export async function openDev(opts = {}) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const lang = opts.lang || 'ko';
  const vp = opts.device === 'small' ? { width: 360, height: 780 } : { width: 390, height: 844 };
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  if (opts.save) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['inkbloom.core-d.save', opts.save]);
  await page.goto(DEV);
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 30000 });
  await page.evaluate(() => window.__ink.hideDebug());
  await page.evaluate(() => window.__ink.notch(true));
  if (opts.lang) await page.evaluate((l) => window.__ink.setLang(l), lang);
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
  const api = {
    page, errors, browser,
    center: (idx) => page.evaluate((i) => window.__ink.cellCenter(i), idx),
    state: () => page.evaluate(() => window.__ink.state()),
    info: () => page.evaluate(() => window.__ink.info()),
    touch,
    async tap(x, y, ms = 40) { await touch('touchStart', [{ x, y }]); await sleep(ms); await touch('touchEnd', []); },
    async tapCell(idx, ms = 40) { const p = await api.center(idx); await api.tap(p.x, p.y, ms); },
    async down(idx) { const p = await api.center(idx); await touch('touchStart', [p]); return p; },
    async moveTo(p) { await touch('touchMove', [p]); },
    async upTouch() { await touch('touchEnd', []); },
    async shot(path) { await sleep(250); await page.screenshot({ path }); },
    async close() { await browser.close(); },
  };
  return api;
}

export async function dismissPopups(s, shot) {
  for (let n = 0; n < 6; n++) {
    if (!(await s.page.locator('.popup').count())) return;
    if (shot) await s.shot(shot.replace('.png', '-p' + n + '.png'));
    const foot = s.page.locator('.popup .popup-foot .btn');
    if (await foot.count()) await foot.first().click();
    else await s.page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
    await sleep(600);
  }
}
