/*
 * Core B: plays every stage from a fresh install, in order, with real touch drags along the stored
 * strokes (CDP touch events at cell centres), and checks each stage is won. Dismisses rule cards
 * and reward popups like a player and screenshots the first-time flow.
 *
 *   node tools/cores/b/e2e-play.mjs [--device small|iphone] [--lang ko|en] [--n 30] [--shots all|first]
 *   E2E_NO_BUILD=1 reuses dist-test-b.
 */
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCore, closeAll } from '../../e2e/core-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const device = arg('device', 'iphone'), lang = arg('lang', 'ko'), N = +arg('n', 30), shots = arg('shots', 'first');
const OUT = new URL(`./out/play-${device}-${lang}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');

const s = await openCore('b', { device, lang });
const { page } = s;
const shot = (name) => s.shot(OUT + name + '.png');
async function tapSel(sel) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  const b = await el.boundingBox();
  await s.tap(b.x + b.width / 2, b.y + b.height / 2);
}
const results = [];
let failed = false;
try {
  await page.waitForFunction(() => window.__ink.screen() === 'title', null, { timeout: 15000 });
  await sleep(600);
  await shot('00-title');
  await s.tap(195, 600);
  for (let i = 0; i < N; i++) {
    await page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.phase === 'idle', null, { timeout: 15000 });
    await sleep(500);
    for (let k = 0; k < 3; k++) {
      if (!(await page.locator('.popup').count())) break;
      await shot(`${pad(i + 1)}-card${k}`);
      await tapSel('.popup .popup-foot .btn');
      await sleep(500);
    }
    const info = await s.info();
    const strokes = info.strokes.map((p) => p.map((c) => c.y * info.w + c.x));
    if (shots === 'all' || i < 12 || i % 5 === 4) await shot(`${pad(i + 1)}-start`);
    const t0 = Date.now();
    for (const [k, p] of strokes.entries()) {
      if (p.length < 2) continue;
      await s.dragCells(p, 75);
      await sleep(150);
      if (k === 0 && (shots === 'all' || i < 10)) await shot(`${pad(i + 1)}-stroke1`);
    }
    let st;
    try {
      await s.waitPhase(['won'], 8000);
      st = await s.state();
    } catch {
      st = await s.state();
      await shot(`${pad(i + 1)}-FAIL`);
    }
    results.push(`${pad(i + 1)} ${st.level}: ${st.phase} ${((Date.now() - t0) / 1000).toFixed(1)}s seal=${st.sealedEligible}`);
    console.log(results[results.length - 1]);
    if (st.phase !== 'won') { failed = true; break; }
    await page.waitForSelector('.sheet.open', { timeout: 15000 });
    await sleep(1500);
    if (shots === 'all' || i < 3 || i % 5 === 4) await shot(`${pad(i + 1)}-result`);
    await tapSel('.sheet.open .sheet-actions .btn-lg');
    await sleep(700);
    for (let k = 0; k < 5; k++) {
      if (!(await page.locator('.popup').count())) break;
      await shot(`${pad(i + 1)}-after${k}`);
      const btn = page.locator('.popup .popup-foot .btn');
      if (await btn.count()) await tapSel('.popup .popup-foot .btn');
      else await page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
      await sleep(700);
    }
    // Daily unlock popup may send us elsewhere; come back to the next stage.
    if ((await page.evaluate(() => window.__ink.screen())) !== 'play' && i + 1 < N) {
      await page.evaluate((n) => window.__ink.go('play', { index: n }), i + 1);
    }
  }
} finally {
  console.log('errors:', JSON.stringify(s.errors.slice(0, 10)));
  console.log(failed ? 'FAILED' : `OK ${results.length}/${N} won`);
  await closeAll();
}
