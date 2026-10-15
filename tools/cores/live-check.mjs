// Smoke test of the deployed comparison site (fresh browser context, nothing persists).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = 'https://chiwonchoi-bagelcode.github.io/oneshot-game-test11/cores/';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE);
console.log('hub cards:', await page.locator('section.card').count());
for (const c of ['a', 'b', 'c', 'd', 'e']) {
  await page.goto(BASE + c + '/');
  await page.waitForTimeout(2500);
  await page.touchscreen.tap(195, 600);
  await page.waitForTimeout(1500);
  const title = await page.locator('.play-title b').textContent().catch(() => null);
  const hasDebug = await page.locator('[aria-label=debug]').count();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log(c, '→', title, '| debug panel:', hasDebug, '| keys:', keys.join(','));
}
await page.goto(BASE);
page.on('dialog', (d) => d.accept());
await page.locator('section.card').first().locator('.reset').click();
await page.waitForTimeout(400);
console.log('after reset A keys:', (await page.evaluate(() => Object.keys(localStorage))).join(','));
console.log('errors:', errs);
await b.close();
