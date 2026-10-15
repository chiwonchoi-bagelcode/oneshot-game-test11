/*
 * Shared browser-test helpers for the comparison cores.
 *
 *   import { openCore } from './core-lib.mjs';
 *   const s = await openCore('a', { device: 'iphone', lang: 'ko' });
 *   await s.page.screenshot(...); await s.tapCell(idx); await s.dragCells([i0, i1, i2]); await s.close();
 *
 * Builds dist-test-<core> (debug hooks on, VITE_DEBUG=1) unless E2E_NO_BUILD=1, serves it with
 * `vite preview` on its own port, and opens a phone-sized mobile context with touch.
 * Touch gestures go through CDP Input.dispatchTouchEvent, so the game sees real touch pointer
 * events (pointerdown/move/up with pointerType "touch"), exactly like a phone.
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('../../', import.meta.url).pathname;
const CORES = ['orig', 'a', 'b', 'c', 'd', 'e'];
export const DEVICES = {
  small: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 },
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};

const servers = new Map();

export async function serveCore(core, { build = !process.env.E2E_NO_BUILD } = {}) {
  if (servers.has(core)) return servers.get(core);
  const port = 5299 + CORES.indexOf(core);
  const out = `dist-test-${core}`;
  if (build) execSync(`npx vite build --outDir ${out} --emptyOutDir`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_DEBUG: '1', VITE_CORE: core === 'orig' ? '' : core } });
  const proc = spawn('npx', ['vite', 'preview', '--outDir', out, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const base = `http://localhost:${port}/`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    await sleep(250);
  }
  const s = { base, proc };
  servers.set(core, s);
  return s;
}

export function stopServers() {
  for (const s of servers.values()) try { process.kill(-s.proc.pid, 'SIGTERM'); } catch { /* gone */ }
  servers.clear();
}

let browser = null;
export async function getBrowser() {
  if (!browser) browser = await chromium.launch(process.env.PW_CHANNEL === 'none' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
  return browser;
}

/**
 * Opens a fresh first-install page of a core. opts: device ('iphone'|'small'), lang ('ko'|'en'),
 * notch (true), save (JSON string to preload, else empty storage).
 */
export async function openCore(core, opts = {}) {
  const { base } = await serveCore(core);
  const b = await getBrowser();
  const lang = opts.lang || 'ko';
  const context = await b.newContext({ ...DEVICES[opts.device || 'iphone'], isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.save) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [opts.saveKey || `inkbloom.core-${core}.save`, opts.save]);
  await page.goto(base);
  await page.waitForFunction(() => !!window.__ink, null, { timeout: 30000 });
  await page.evaluate(() => window.__ink.hideDebug());
  if (opts.notch !== false) await page.evaluate(() => window.__ink.notch(true));
  if (opts.lang) await page.evaluate((l) => window.__ink.setLang(l), lang);
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
  const api = {
    page,
    errors,
    /** Centre of a board cell in page coordinates (needs the play screen). */
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
    /** Touch-drag through the centres of these cells (stepMs between cells, sub-steps for smoothness). */
    async dragCells(cells, stepMs = 70) {
      const pts = [];
      for (const c of cells) pts.push(await api.center(c));
      await touch('touchStart', [pts[0]]);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], bb = pts[i];
        for (let k = 1; k <= 3; k++) {
          await touch('touchMove', [{ x: a.x + ((bb.x - a.x) * k) / 3, y: a.y + ((bb.y - a.y) * k) / 3 }]);
          await sleep(stepMs / 3);
        }
      }
      await touch('touchEnd', []);
    },
    /** Long press on a point (ms). */
    async press(x, y, ms = 600) {
      await touch('touchStart', [{ x, y }]);
      await sleep(ms);
      await touch('touchEnd', []);
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

export async function closeAll() {
  if (browser) await browser.close();
  browser = null;
  stopServers();
}
