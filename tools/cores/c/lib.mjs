/*
 * Core C browser helpers on top of tools/e2e/core-lib.mjs.
 * DEV_URL=http://localhost:5403/ uses a running dev server instead of building dist-test-c.
 */
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCore, closeAll, getBrowser, DEVICES } from '../../e2e/core-lib.mjs';

const require = createRequire(import.meta.url);
export const OUT = new URL('./out/', import.meta.url).pathname;
export { sleep, closeAll };

/** Opens core C (fresh install unless opts.save). With DEV_URL set, talks to the dev server. */
export async function open(opts = {}) {
  if (!process.env.DEV_URL) return decorate(await openCore('c', opts));
  const b = await getBrowser();
  const lang = opts.lang || 'ko';
  const context = await b.newContext({ ...DEVICES[opts.device || 'iphone'], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.save) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['inkbloom.core-c.save', opts.save]);
  await page.goto(process.env.DEV_URL);
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
    async waitPhase(phases, timeout = 30000) { await page.waitForFunction((ps) => ps.includes(window.__ink.state()?.phase), phases, { timeout }); },
    async shot(path, clip) { await sleep(300); await page.screenshot(clip ? { path, clip } : { path }); },
    async close() { await context.close(); },
  };
  return decorate(api);
}

function decorate(s) {
  const page = s.page;
  /** Taps the centre of the first visible element matching sel (real touch). */
  s.tapSel = async (sel, timeout = 8000) => {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout });
    const b = await el.boundingBox();
    await s.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  /** Selects a palette tool (1 R, 2 Y, 4 B, 0 water) by tapping its chip. */
  s.pick = async (c) => s.tapSel(`.cchip[data-c="${c}"]`);
  /** Dismisses intro cards (rule / chapter) with their button; returns how many. */
  s.cards = async (shotPrefix) => {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      await sleep(350);
      if (!(await page.locator('.popup').count())) break;
      if (shotPrefix) await s.shot(`${shotPrefix}-card${k}.png`);
      await s.tapSel('.popup .popup-foot .btn');
      n++;
      await sleep(450);
    }
    return n;
  };
  /** Colours the current stage by real taps following its stored solution. */
  s.colour = async (gapMs = 260) => {
    const info = await s.info();
    for (const d of info.solution) {
      const st = await s.state();
      if (st.tool !== d.c) { await s.pick(d.c); await sleep(120); }
      await s.tapCell(d.y * info.w + d.x);
      await sleep(gapMs);
    }
  };
  return s;
}
