/*
 * Shared Playwright helpers for E2E scripts.
 *   const { startServer, newPage, ... } = await import('./lib.mjs');
 * VARIANT env (a..e) builds that test version; each variant gets its own port and build dir so
 * several scripts can run at once.
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
export const { chromium } = playwright;
export { sleep };

export const VARIANT = (process.env.VARIANT || '').toLowerCase();
const OFFSET = { '': 0, a: 2, b: 3, c: 4, d: 5, e: 6 }[VARIANT] ?? 9;
export const PORT = 5199 + OFFSET;
export const BASE = `http://localhost:${PORT}/`;
export const ROOT = new URL('../../', import.meta.url).pathname;
export const OUT = ROOT + 'tools/e2e/out/' + (VARIANT ? VARIANT + '/' : '');
mkdirSync(OUT, { recursive: true });

export const DEVICES = {
  small: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 },
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};

/** Builds a static debug build (VITE_DEBUG=1) for the variant and serves it. */
export async function startServer() {
  const outDir = 'dist-test' + (VARIANT ? '-' + VARIANT : '');
  if (!process.env.E2E_NO_BUILD) {
    execSync(`npx vite build --outDir ${outDir} --emptyOutDir`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_DEBUG: '1', VITE_VARIANT: VARIANT } });
  }
  const p = spawn('npx', ['vite', 'preview', '--outDir', outDir, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return p; } catch {}
    await sleep(500);
  }
  throw new Error('preview server did not start');
}

export function stopServer(p) {
  try { process.kill(-p.pid, 'SIGTERM'); } catch {}
}

export async function newPage(browser, device = 'iphone', { lang = 'ko', notch = true } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[device], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 20000 });
  if (notch) await page.evaluate(() => window.__ink.notch(true));
  await page.evaluate(() => window.__ink.hideDebug());
  page._errors = errors;
  return page;
}

export async function shot(page, name) {
  await sleep(350);
  await page.screenshot({ path: OUT + name + '.png' });
}

export async function tapSel(page, sel) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  const b = await el.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Touch-drag through a list of client points (Playwright touchscreen has no move, so use CDP). */
export async function touchDrag(page, points, stepMs = 40) {
  const cdp = await page.context().newCDPSession(page);
  const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(points[0]) });
  for (let i = 1; i < points.length; i++) {
    await sleep(stepMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(points[i]) });
  }
  await sleep(stepMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function waitPhase(page, phases, timeout = 30000) {
  await page.waitForFunction((ps) => ps.includes(window.__ink.state()?.phase), phases, { timeout });
}

export async function closePopups(page) {
  for (let i = 0; i < 6; i++) {
    const n = await page.locator('.popup').count();
    if (!n) return;
    const close = page.locator('.popup .popup-close').last();
    if (await close.count()) await close.click({ force: true });
    else await page.locator('.popup').last().click({ force: true, position: { x: 10, y: 10 } });
    await sleep(300);
  }
}
