/*
 * End-to-end checks in a real browser at phone sizes (Playwright + Chromium).
 *   node tools/e2e/run.mjs [scenario ...]      (default: all)
 * Scenarios: firstrun, screens, flows, levels, persist
 * Screenshots go to tools/e2e/out/. Requires a dev server (started automatically).
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const want = (s) => !args.length || args.includes(s);
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(' ')); };

async function startServer() {
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: new URL('../../', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return p; } catch {}
    await sleep(500);
  }
  throw new Error('dev server did not start');
}

const DEVICES = {
  small: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 },
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};

async function newPage(browser, device = 'iphone', { lang = 'ko', notch = true, storage = null } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[device], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (storage) await page.addInitScript((s) => { localStorage.setItem('inkbloom.save', s); }, storage);
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 20000 });
  if (notch) await page.evaluate(() => window.__ink.notch(true));
  page._errors = errors;
  return page;
}

async function shot(page, name) {
  await sleep(350);
  await page.screenshot({ path: OUT + name + '.png' });
}

async function tapSel(page, sel) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  const b = await el.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

async function waitPhase(page, phases, timeout = 30000) {
  await page.waitForFunction((ps) => ps.includes(window.__ink.state()?.phase), phases, { timeout });
}

async function closePopups(page) {
  for (let i = 0; i < 6; i++) {
    const n = await page.locator('.popup').count();
    if (!n) return;
    const close = page.locator('.popup .popup-close').last();
    if (await close.count()) await close.click({ force: true });
    else await page.locator('.popup').last().click({ force: true, position: { x: 10, y: 10 } });
    await sleep(300);
  }
}

// ---------------------------------------------------------------- scenarios

async function firstrun(browser) {
  const page = await newPage(browser, 'iphone');
  await shot(page, '01-title');
  await page.touchscreen.tap(195, 500);
  await sleep(900);
  await shot(page, '02-level1-guided');
  // Tap where the guide points.
  const hand = page.locator('.pointer:not(.hidden)');
  if (await hand.count()) {
    const b = await hand.boundingBox();
    await page.touchscreen.tap(b.x + 26, b.y + 8);
  } else log('WARN no guide pointer on level 1');
  await sleep(1500);
  await shot(page, '03-level1-spreading');
  await waitPhase(page, ['won'], 30000).catch(() => log('FAIL level 1 not won'));
  await sleep(2600);
  await shot(page, '04-level1-result');
  await tapSel(page, '.sheet.open .btn-lg');
  await sleep(1200);
  await shot(page, '05-level2');
  log('firstrun errors:', JSON.stringify(page._errors));
  await page.context().close();
}

async function levels(browser) {
  const page = await newPage(browser, 'small', { notch: false });
  const ids = await page.evaluate(() => window.__ink.levels);
  await page.evaluate(() => { window.__ink.grant({ coins: 0 }); window.__ink.clearUpTo(window.__ink.levels.length - 1); });
  let ok = 0, bad = [];
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate((i) => { window.__ink.go('play', { index: i }); }, i);
    await sleep(120);
    await closePopups(page);
    await page.evaluate(() => { window.__ink.timeScale(10); window.__ink.autoplay(true); });
    try {
      await waitPhase(page, ['won', 'lost'], 25000);
      const st = await page.evaluate(() => window.__ink.state());
      if (st.phase === 'won') ok++; else bad.push(ids[i] + ':' + st.phase);
    } catch { bad.push(ids[i] + ':timeout'); }
    await page.evaluate(() => window.__ink.autoplay(false));
    await closePopups(page);
  }
  log(`levels autoplay: ${ok}/${ids.length} won`, bad.length ? 'FAILED: ' + bad.join(', ') : '');
  log('levels errors:', JSON.stringify(page._errors.slice(0, 10)));
  await page.context().close();
}

async function screens(browser) {
  for (const lang of ['ko', 'en']) {
    for (const device of ['small', 'iphone']) {
      const page = await newPage(browser, device, { lang });
      await page.evaluate((l) => window.__ink.setLang(l), lang);
      await page.evaluate(() => { window.__ink.clearUpTo(37); window.__ink.grant({ coins: 2500, hints: 2 }); });
      const p = `${lang}-${device}-`;
      await page.evaluate(() => window.__ink.go('journey', undefined, { resetHistory: true }));
      await shot(page, p + 'journey');
      await page.evaluate(() => window.__ink.go('chapter', { chapter: 1 }));
      await shot(page, p + 'chapter');
      await page.evaluate(() => window.__ink.go('daily', undefined, { resetHistory: true }));
      await shot(page, p + 'daily');
      await page.evaluate(() => window.__ink.go('gallery', undefined, { resetHistory: true }));
      await shot(page, p + 'gallery');
      await page.evaluate(() => window.__ink.go('shop', undefined, { resetHistory: true }));
      await shot(page, p + 'shop');
      await page.evaluate(() => { const b = document.querySelector('.screen.active .screen-body'); b.scrollTop = b.scrollHeight; });
      await shot(page, p + 'shop-bottom');
      await page.evaluate(() => window.__ink.go('play', { index: 38 }));
      await sleep(400);
      await closePopups(page);
      await shot(page, p + 'play');
      log(p + 'errors:', JSON.stringify(page._errors.slice(0, 5)));
      await page.context().close();
    }
  }
}

async function persist(browser) {
  const page = await newPage(browser, 'iphone');
  await page.evaluate(() => { window.__ink.clearUpTo(4); window.__ink.grant({ coins: 77 }); window.__ink.store.flush(); });
  const before = await page.evaluate(() => ({ coins: window.__ink.store.data.coins, lv: Object.keys(window.__ink.store.data.levels).length }));
  await page.reload();
  await page.waitForFunction(() => !!window.__ink);
  const after = await page.evaluate(() => ({ coins: window.__ink.store.data.coins, lv: Object.keys(window.__ink.store.data.levels).length }));
  log('persist:', JSON.stringify(before), '→', JSON.stringify(after), before.coins === after.coins && before.lv === after.lv ? 'OK' : 'MISMATCH');
  await page.touchscreen.tap(195, 500);
  await sleep(800);
  log('after restart screen:', await page.evaluate(() => window.__ink.screen()));
  await shot(page, 'persist-home');
  await page.context().close();
}

async function flows(browser) {
  const page = await newPage(browser, 'iphone');
  await page.evaluate(() => { window.__ink.clearUpTo(10); });
  await page.evaluate(() => window.__ink.go('play', { index: 11 }));
  await sleep(500);
  await closePopups(page);
  // Make a wrong move: drop every ink on the first free cells right away.
  const canvas = await page.locator('.screen.active canvas').boundingBox();
  for (let k = 0; k < 6; k++) {
    await page.touchscreen.tap(canvas.x + 20 + k * 3, canvas.y + canvas.height / 2);
    await sleep(80);
  }
  await waitPhase(page, ['lost', 'won'], 30000).catch(() => {});
  await sleep(1200);
  await shot(page, 'flow-fail');
  // Out of hints → popup
  await page.evaluate(() => { const s = window.__ink.store; s.data.hints = 0; s.data.coins = 0; s.commit('wallet'); });
  await tapSel(page, '.sheet.open .side:last-child .icon-btn');
  await sleep(500);
  await shot(page, 'flow-no-hints');
  await closePopups(page);
  log('flows errors:', JSON.stringify(page._errors.slice(0, 5)));
  await page.context().close();
}

// ----------------------------------------------------------------
const server = await startServer();
const browser = await chromium.launch();
try {
  if (want('firstrun')) await firstrun(browser);
  if (want('screens')) await screens(browser);
  if (want('flows')) await flows(browser);
  if (want('persist')) await persist(browser);
  if (want('levels')) await levels(browser);
} catch (e) {
  log('E2E crashed:', e.stack || e);
} finally {
  await browser.close();
  server.kill();
  writeFileSync(OUT + 'report.txt', report.join('\n'));
}
