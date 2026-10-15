/*
 * Core E browser-test helpers on top of tools/e2e/core-lib.mjs.
 *   E_DEV=1  → use a running dev server (VITE_CORE=e VITE_DEBUG=1 npx vite --port 5405) instead of a build.
 * Everything else (touch through CDP, phone contexts) is the shared helper's.
 */
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import { openCore, getBrowser, DEVICES, closeAll } from '../../e2e/core-lib.mjs';

const require = createRequire(import.meta.url);
export const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
export { sleep, closeAll };

/** Same API as core-lib's openCore('e'), optionally against the dev server. */
export async function open(opts = {}) {
  if (!process.env.E_DEV) return openCore('e', opts);
  const b = await getBrowser();
  const lang = opts.lang || 'ko';
  const context = await b.newContext({ ...DEVICES[opts.device || 'iphone'], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.save) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['inkbloom.core-e.save', opts.save]);
  await page.goto(process.env.E_DEV_URL || 'http://localhost:5405/');
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 30000 });
  await page.evaluate(() => window.__ink.hideDebug());
  if (opts.notch !== false) await page.evaluate(() => window.__ink.notch(true));
  if (opts.lang) await page.evaluate((l) => window.__ink.setLang(l), lang);
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
  const api = {
    page,
    errors,
    center: (idx) => page.evaluate((i) => window.__ink.cellCenter(i), idx),
    state: () => page.evaluate(() => window.__ink.state()),
    info: () => page.evaluate(() => window.__ink.info()),
    async tap(x, y) {
      await touch('touchStart', [{ x, y }]);
      await sleep(40);
      await touch('touchEnd', []);
    },
    async tapCell(idx) {
      const p = await api.center(idx);
      await api.tap(p.x, p.y);
    },
    async waitPhase(phases, timeout = 30000) {
      await page.waitForFunction((ps) => ps.includes(window.__ink.state()?.phase), phases, { timeout });
    },
    async shot(path, clip) {
      await sleep(300);
      await page.screenshot(clip ? { path, clip } : { path });
    },
    async close() {
      await context.close();
    },
  };
  return api;
}

/** Tap the centre of the first visible element matching sel (real touch). */
export async function tapSel(s, sel, timeout = 8000) {
  const el = s.page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout });
  const b = await el.boundingBox();
  await s.tap(b.x + b.width / 2, b.y + b.height / 2);
}

export async function popupOpen(s) {
  return (await s.page.locator('.popup').count()) > 0;
}

/** Close rule/chapter/reward cards as a player would (main button; "later" when there is a choice). */
export async function dismissCards(s, shotPrefix = null) {
  for (let i = 0; i < 12; i++) {
    await sleep(450);
    const n = await s.page.locator('.popup:not(.closing)').count();
    if (!n) return;
    if (shotPrefix) await s.shot(`${shotPrefix}-card${i}.png`);
    const foot = s.page.locator('.popup:not(.closing) .popup-foot .btn');
    const k = await foot.count();
    const btn = k >= 2 ? foot.first() : k === 1 ? foot.first() : s.page.locator('.popup:not(.closing) .btn').last();
    if (await btn.count()) {
      const b = await btn.boundingBox();
      if (b) { await s.tap(b.x + b.width / 2, b.y + b.height / 2); continue; }
    }
    const close = s.page.locator('.popup:not(.closing) .popup-close').last();
    if (await close.count()) { await close.click({ force: true }); continue; }
    // reward screens: "tap anywhere to continue"
    await s.tap(180, 300);
  }
}

/**
 * Plays the current stage like a person: the stored solution, tapping each cell through real touch
 * at real tempo, ~170 ms after the beat it is due on changes (beat 0 drops: a short pause apart).
 */
export async function playStage(s, { reaction = 170, log = null } = {}) {
  const info = await s.info();
  const sol = info.solution;
  const w = info.w;
  let st = await s.state();
  for (let k = 0; k < sol.length; k++) {
    const d = sol[k];
    const idx = d.y * w + d.x;
    if (d.t > 0) {
      // wait until the beat counter reaches d.t, then react
      const t0 = Date.now();
      for (;;) {
        st = await s.state();
        if (st.phase === 'won' || st.phase === 'lost') return st.phase;
        if (st.tick >= d.t) break;
        if (Date.now() - t0 > 30000) throw new Error('beat ' + d.t + ' never came');
        await sleep(15);
      }
      if (st.tick > d.t) throw new Error(`late: wanted beat ${d.t}, at ${st.tick}`);
      await sleep(reaction);
    } else if (k > 0) await sleep(reaction + 80);
    else await sleep(250);
    const before = (await s.state()).drops;
    await s.tapCell(idx);
    if (log) log(`  drop ${k + 1} at ${d.x},${d.y} beat ${d.t}`);
    await sleep(60);
    const after = await s.state();
    if (after.drops === before && after.phase !== 'won' && after.phase !== 'lost') {
      const p = await s.center(idx);
      const hit = await s.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + e.className : 'none'; }, [p.x, p.y]);
      console.log(`  ! tap ${k + 1} not taken (beat ${after.tick}, phase ${after.phase}, element ${hit})`);
    }
  }
  await s.waitPhase(['won', 'lost'], 40000);
  return (await s.state()).phase;
}
