/*
 * Core A browser helpers. Uses tools/e2e/core-lib.mjs (fresh build) by default; with
 * A_BASE=http://localhost:5401/ it opens a running dev server instead (fast design loop).
 */
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { serveCore, stopServers, DEVICES } from '../../e2e/core-lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let browser = null;

export const SHOTS = process.env.A_SHOTS || '/tmp/core-a-shots';

export async function openA(opts = {}) {
  const base = process.env.A_BASE || (await serveCore('a')).base;
  if (!browser) browser = await chromium.launch({ channel: 'chrome' });
  const lang = opts.lang || 'ko';
  const context = await browser.newContext({ ...DEVICES[opts.device || 'iphone'], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.save) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['inkbloom.core-a.save', opts.save]);
  await page.goto(base);
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 30000 });
  await page.evaluate(() => window.__ink.hideDebug());
  if (opts.notch !== false) await page.evaluate(() => window.__ink.notch(true));
  if (opts.lang) await page.evaluate((l) => window.__ink.setLang(l), lang);
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
  const api = {
    page, errors,
    center: (idx) => page.evaluate((i) => window.__ink.cellCenter(i), idx),
    state: () => page.evaluate(() => window.__ink.state()),
    info: () => page.evaluate(() => window.__ink.info()),
    async tap(x, y) { await touch('touchStart', [{ x, y }]); await sleep(40); await touch('touchEnd', []); },
    async tapCell(idx) { const p = await api.center(idx); await api.tap(p.x, p.y); },
    async dragCells(cells, stepMs = 70) {
      const pts = [];
      for (const c of cells) pts.push(await api.center(c));
      await touch('touchStart', [pts[0]]);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], bb = pts[i];
        for (let k = 1; k <= 3; k++) { await touch('touchMove', [{ x: a.x + ((bb.x - a.x) * k) / 3, y: a.y + ((bb.y - a.y) * k) / 3 }]); await sleep(stepMs / 3); }
      }
      await touch('touchEnd', []);
    },
    async press(x, y, ms = 600) { await touch('touchStart', [{ x, y }]); await sleep(ms); await touch('touchEnd', []); },
    touch,
    async waitPhase(phases, timeout = 30000) { await page.waitForFunction((ps) => ps.includes(window.__ink.state()?.phase), phases, { timeout }); },
    async shot(path, clip) { await sleep(300); await page.screenshot(clip ? { path, clip } : { path }); },
    async close() { await context.close(); },
  };
  return api;
}

export async function closeA() {
  if (browser) { await browser.close(); browser = null; }
  stopServers();
}

/** Taps a visible element by selector with a real touch. */
export async function tapSel(s, sel) {
  const el = s.page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  const b = await el.boundingBox();
  await s.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Dismisses intro/reward popups via their main button. Returns how many were closed. */
export async function closePopups(s, shotPrefix) {
  let n = 0;
  for (let k = 0; k < 6; k++) {
    if (!(await s.page.locator('.popup').count())) break;
    if (shotPrefix) await s.shot(`${shotPrefix}-pop${k}.png`);
    const btn = s.page.locator('.popup .popup-foot .btn').first();
    if (await btn.count()) await tapSel(s, '.popup .popup-foot .btn');
    else { const c = s.page.locator('.popup .popup-close').last(); if (await c.count()) await c.click({ force: true }); }
    await sleep(500);
    n++;
  }
  return n;
}

export { sleep };
