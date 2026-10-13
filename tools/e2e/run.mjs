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
  const root = new URL('../../', import.meta.url).pathname;
  // Static test build (debug hooks on) so file changes can't reload the page mid-test.
  if (!process.env.E2E_NO_BUILD) {
    const { execSync } = await import('node:child_process');
    execSync('npx vite build --outDir dist-test --emptyOutDir', { cwd: root, stdio: 'ignore', env: { ...process.env, VITE_DEBUG: '1' } });
  }
  const p = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return p; } catch {}
    await sleep(500);
  }
  throw new Error('preview server did not start');
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
  await page.evaluate(() => window.__ink.hideDebug());
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
  await page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(500);
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
  // Make a wrong move: drop every ink on cells that are not part of the solution, right away.
  const info = await page.evaluate(() => window.__ink.info());
  const sol = new Set(info.solution.map((d) => d.y * info.w + d.x));
  const picks = info.droppable.filter((i) => !sol.has(i));
  for (let k = 0; k < 4 && k < picks.length; k++) {
    const p = await page.evaluate((i) => window.__ink.cellCenter(i), picks[k * 3 % picks.length]);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(60);
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

/** Plays levels like a person: real tempo, taps at the solution cells on the right beats. */
async function playthrough(browser) {
  const N = +(process.env.PT_LEVELS || 12);
  const page = await newPage(browser, 'iphone');
  await page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(400);
  await page.touchscreen.tap(195, 600);
  for (let i = 0; i < N; i++) {
    await page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.phase === 'idle', null, { timeout: 15000 });
    await sleep(450);
    // Intro cards (chapter / new rule): screenshot, then dismiss with their button.
    for (let k = 0; k < 3; k++) {
      if (!(await page.locator('.popup').count())) break;
      await shot(page, `pt-${String(i + 1).padStart(2, '0')}-card${k}`);
      await tapSel(page, '.popup .popup-foot .btn');
      await sleep(450);
    }
    const info = await page.evaluate(() => window.__ink.info());
    const t0 = Date.now();
    for (const d of info.solution) {
      // wait for the beat
      await page.waitForFunction((t) => window.__ink.state().tick >= t, d.t, { timeout: 20000 });
      const st = await page.evaluate(() => window.__ink.state());
      if (st.tick > d.t) log(`  L${i + 1}: missed beat ${d.t} (now ${st.tick})`);
      if (d.t > 0) await sleep(170); // human reaction after the beat changes
      const p = await page.evaluate((i) => window.__ink.cellCenter(i), d.y * info.w + d.x);
      await page.touchscreen.tap(p.x, p.y);
      await sleep(40);
    }
    try {
      await waitPhase(page, ['won', 'lost'], 40000);
    } catch { log(`  L${i + 1}: timeout`); }
    const st = await page.evaluate(() => window.__ink.state());
    log(`L${i + 1} ${st.level}: ${st.phase} in ${((Date.now() - t0) / 1000).toFixed(1)}s, seal=${st.sealedEligible}`);
    if (st.phase !== 'won') { await shot(page, `pt-${String(i + 1).padStart(2, '0')}-FAIL`); break; }
    await page.waitForSelector('.sheet.open', { timeout: 15000 });
    await sleep(1600);
    if (i < 3 || i % 4 === 0) await shot(page, `pt-${String(i + 1).padStart(2, '0')}-result`);
    await tapSel(page, '.sheet.open .sheet-actions .btn-lg');
    await sleep(500);
    // reward / unlock popups after "next"
    for (let k = 0; k < 4; k++) {
      if (!(await page.locator('.popup').count())) break;
      await shot(page, `pt-${String(i + 1).padStart(2, '0')}-after${k}`);
      const btn = page.locator('.popup .popup-foot .btn').first();
      if (await btn.count()) await btn.click(); else await page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
      await sleep(600);
      if (await page.locator('.popup').count()) { await page.locator('.popup').last().click({ position: { x: 20, y: 20 } }); await sleep(500); }
    }
  }
  log('playthrough errors:', JSON.stringify(page._errors.slice(0, 5)));
  await page.context().close();
}

async function startLevel(page, index) {
  await page.evaluate((i) => window.__ink.go('play', { index: i }), index);
  await sleep(500);
  for (let k = 0; k < 3 && (await page.locator('.popup').count()); k++) { await tapSel(page, '.popup .popup-foot .btn'); await sleep(400); }
}

async function misc(browser) {
  const page = await newPage(browser, 'iphone');
  await page.waitForFunction(() => window.__ink.screen() === 'title');
  await page.evaluate(() => { window.__ink.clearUpTo(40); window.__ink.store.data.seen = { 'daily.unlocked': 1 }; window.__ink.store.commit('seen'); });
  // Settings + rules book
  await page.evaluate(() => window.__ink.go('journey', undefined, { resetHistory: true }));
  await sleep(300);
  await tapSel(page, '.screen.active .topbar .icon-btn');
  await sleep(400);
  await shot(page, 'misc-settings');
  const how = page.locator('.popup button', { hasText: /방법|How to play/ }).first();
  if (await how.count()) { await how.click(); await sleep(500); await shot(page, 'misc-rulesbook'); }
  await closePopups(page);

  // Hint on a timing level (find one whose solution has a t>0 drop)
  const timedIndex = await page.evaluate(() => {
    const ids = window.__ink.levels;
    for (let i = 20; i < 40; i++) { window.__ink.go('play', { index: i }); const inf = window.__ink.info(); if (inf && inf.solution.some((d) => d.t > 0)) return i; }
    return 30;
  });
  await startLevel(page, timedIndex);
  await tapSel(page, '.boosters .booster:last-child .icon-btn');
  await sleep(700);
  await shot(page, 'misc-hint-idle');
  const info = await page.evaluate(() => window.__ink.info());
  for (const d of info.solution.filter((d) => d.t === 0)) {
    const p = await page.evaluate((i) => window.__ink.cellCenter(i), d.y * info.w + d.x);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(60);
  }
  await sleep(1100);
  await shot(page, 'misc-hint-waiting');
  // Pause
  await tapSel(page, '.screen.active .topbar .icon-btn:last-child');
  await sleep(400);
  await shot(page, 'misc-pause');
  await closePopups(page);
  await sleep(300);
  // Rewind: let it play out (likely fails without the timed drop), then rewind
  await waitPhase(page, ['lost', 'won'], 30000).catch(() => {});
  await sleep(900);
  if (await page.locator('.sheet.open').count()) {
    await tapSel(page, '.sheet.open .side:first-child .icon-btn');
    await sleep(700);
    await shot(page, 'misc-rewound');
  }
  // Out of coins → shop overlay → back
  await startLevel(page, timedIndex + 1);
  await page.evaluate(() => { const s = window.__ink.store; s.data.hints = 0; s.data.coins = 10; s.commit('wallet'); });
  await tapSel(page, '.boosters .booster:last-child .icon-btn');
  await sleep(500);
  await tapSel(page, '.popup .popup-foot .btn');
  await sleep(500);
  await shot(page, 'misc-not-enough');
  await tapSel(page, '.popup .popup-foot .btn:last-child');
  await sleep(800);
  await shot(page, 'misc-shop-overlay');
  await tapSel(page, '.screen.active .topbar .icon-btn');
  await sleep(800);
  log('after shop back:', await page.evaluate(() => window.__ink.screen()), await page.evaluate(() => window.__ink.state().phase));
  await shot(page, 'misc-back-to-play');
  await closePopups(page);

  // Symbols + dark paper
  await page.evaluate(() => { const s = window.__ink.store; s.data.settings.symbols = true; s.data.cosmetics.paper = 'paper-night'; s.data.cosmetics.owned.push('paper-night'); s.commit('settings'); s.commit('cosmetics'); });
  await startLevel(page, 45);
  await page.evaluate(() => { window.__ink.timeScale(1); window.__ink.autoplay(true); });
  await sleep(2500);
  await shot(page, 'misc-symbols-night');
  await page.evaluate(() => window.__ink.autoplay(false));
  await page.evaluate(() => { const s = window.__ink.store; s.data.settings.symbols = false; s.data.cosmetics.paper = 'paper-hanji'; s.commit('settings'); s.commit('cosmetics'); });

  // Chapter complete
  await page.evaluate(() => window.__ink.clearUpTo(28));
  await startLevel(page, 29);
  await page.evaluate(() => { window.__ink.timeScale(4); window.__ink.autoplay(true); });
  await waitPhase(page, ['won'], 40000).catch(() => log('chapter boss not won'));
  await page.waitForSelector('.sheet.open', { timeout: 15000 });
  await sleep(1500);
  await shot(page, 'misc-boss-result');
  await tapSel(page, '.sheet.open .sheet-actions .btn-lg');
  for (let k = 0; k < 5; k++) {
    await sleep(1200);
    if (!(await page.locator('.popup').count())) break;
    await shot(page, 'misc-chapter-' + k);
    const btn = page.locator('.popup .popup-foot .btn');
    if (await btn.count()) await btn.first().click(); else { await page.locator('.popup').last().click({ position: { x: 20, y: 20 } }); await sleep(300); await page.locator('.popup').last().click({ position: { x: 20, y: 20 } }).catch(() => {}); }
  }
  await sleep(800);
  await shot(page, 'misc-next-chapter');
  await closePopups(page);

  // Daily
  await page.evaluate(() => window.__ink.go('daily', undefined, { resetHistory: true }));
  await sleep(500);
  await page.evaluate(() => window.__ink.go('play', { daily: 0 }));
  await sleep(500);
  await page.evaluate(() => { window.__ink.timeScale(4); window.__ink.autoplay(true); });
  await waitPhase(page, ['won', 'lost'], 40000).catch(() => {});
  await page.waitForSelector('.sheet.open', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  await shot(page, 'misc-daily-result');
  await tapSel(page, '.sheet.open .sheet-actions .btn-lg');
  await sleep(1500);
  await page.locator('.popup').last().click({ position: { x: 20, y: 20 } }).catch(() => {});
  await sleep(1200);
  await shot(page, 'misc-daily-after');
  log('misc errors:', JSON.stringify(page._errors.slice(0, 8)));
  await page.context().close();
}

// ----------------------------------------------------------------
const server = await startServer();
const browser = await chromium.launch();
try {
  if (want('firstrun')) await firstrun(browser);
  if (args.includes('playthrough')) await playthrough(browser);
  if (want('misc')) await misc(browser);
  if (want('screens')) await screens(browser);
  if (want('flows')) await flows(browser);
  if (want('persist')) await persist(browser);
  if (want('levels')) await levels(browser);
} catch (e) {
  log('E2E crashed:', e.stack || e);
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(0);
  writeFileSync(OUT + 'report.txt', report.join('\n'));
}
