/*
 * Core A: play every stage from a fresh install through real touch input, in order.
 *   node tools/cores/a/e2e-play.mjs [lastStage=30]      (screenshots → $A_SHOTS or /tmp/core-a-shots/play)
 * Title → stage 1 … : rule cards are screenshotted and dismissed with their button; each ink is
 * chosen by tapping its tray chip and placed by tapping the cell (stages 2, 6, 10… use a
 * press-and-hold first to check the reach preview). Every stage must end 'won'; the result
 * sheet's Next button leads on.
 */
import { mkdirSync } from 'node:fs';
import { openA, closeA, tapSel, sleep, SHOTS } from './pw.mjs';

const LAST = +(process.argv[2] || 30);
const OUT = SHOTS + '/play';
mkdirSync(OUT, { recursive: true });
const s = await openA({ lang: process.env.A_LANG || 'ko', device: process.env.DEV || 'iphone' });
const page = s.page;
const pad = (n) => String(n).padStart(2, '0');
const log = (...a) => console.log(...a);
let fails = 0;

await page.waitForFunction(() => window.__ink.screen() === 'title');
await sleep(600);
await s.shot(`${OUT}/00-title.png`);
const vp = page.viewportSize();
await s.tap(vp.width / 2, vp.height * 0.6);

for (let n = 1; n <= LAST; n++) {
  await page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.phase === 'idle', null, { timeout: 20000 });
  await sleep(500);
  for (let k = 0; k < 3 && (await page.locator('.popup').count()); k++) {
    await s.shot(`${OUT}/${pad(n)}-card${k}.png`);
    await tapSel(s, '.popup .popup-foot .btn');
    await sleep(500);
  }
  if (n <= 10 || n % 5 === 0) await s.shot(`${OUT}/${pad(n)}-start.png`);
  const info = await s.info();
  const t0 = Date.now();
  for (const [di, d] of info.solution.entries()) {
    const idx = d.y * info.w + d.x;
    const st = await s.state();
    if (st.sel !== d.k && !info.guided) {
      // Choose the ink in the tray (any chip with the same ink works).
      await tapSel(s, `.a-tray .a-chip:nth-child(${d.k + 1})`);
      await sleep(180);
    }
    const p = await s.center(idx);
    if (di === 0 && (n === 2 || n % 4 === 2)) {
      await s.touch('touchStart', [p]);
      await sleep(450);
      if (n <= 10) await s.shot(`${OUT}/${pad(n)}-hold.png`);
      await s.touch('touchEnd', []);
    } else await s.tap(p.x, p.y);
    await sleep(n <= 3 ? 700 : 260);
    if (n <= 10 && di === 0) await s.shot(`${OUT}/${pad(n)}-drop1.png`);
  }
  try {
    await s.waitPhase(['won'], 15000);
  } catch {
    fails++;
    log(`stage ${n}: NOT WON`, JSON.stringify(await s.state()));
    await s.shot(`${OUT}/${pad(n)}-FAIL.png`);
    break;
  }
  const st = await s.state();
  log(`stage ${n} ${st.level}: won in ${((Date.now() - t0) / 1000).toFixed(1)}s seal=${st.sealedEligible}`);
  await page.waitForSelector('.sheet.open', { timeout: 15000 });
  await sleep(1500);
  if (n <= 3 || n % 10 === 0) await s.shot(`${OUT}/${pad(n)}-result.png`);
  await tapSel(s, '.sheet.open .sheet-actions .btn-lg');
  await sleep(700);
  for (let k = 0; k < 5 && (await page.locator('.popup').count()); k++) {
    await s.shot(`${OUT}/${pad(n)}-after${k}.png`);
    if (await page.locator('.popup .popup-foot .btn').count()) await tapSel(s, '.popup .popup-foot .btn:first-child');
    else if (await page.locator('.popup .popup-close').count()) await page.locator('.popup .popup-close').last().click({ force: true });
    else await s.tap(vp.width / 2, vp.height * 0.85);
    await sleep(700);
  }
  if (n === LAST) break;
}
log('errors:', JSON.stringify(s.errors.slice(0, 8)));
log(fails ? 'FAILED' : `OK: stages 1-${LAST} won through touch`);
await s.close();
await closeA();
process.exit(fails ? 1 : 0);
