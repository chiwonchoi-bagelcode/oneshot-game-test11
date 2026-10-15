/*
 * Core C: plays all 30 stages from a fresh install, in order, with real touch taps (palette chip,
 * then the part of the picture), like a first-time player. Screenshots of every stage start,
 * every rule card and a few results go to tools/cores/c/out/play-*.png.
 *   node tools/cores/c/e2e-play.mjs            (builds dist-test-c; E2E_NO_BUILD=1 to reuse)
 * Then checks autoplay on every stage (debug hook, same input path).
 */
import { open, OUT, sleep, closeAll } from './lib.mjs';

const device = process.env.DEVICE || 'iphone';
const s = await open({ device, lang: process.env.LANG2 || 'ko' });
const P = (n) => `${OUT}play-${n}`;
const log = { push: (m) => console.log(m) };
const fails = [];
await s.page.waitForFunction(() => window.__ink.screen() === 'title');
await sleep(500);
await s.shot(P('00-title.png'));
await s.tap(195, 600);
const t00 = Date.now();
for (let i = 1; i <= 30; i++) {
  const id = String(i).padStart(2, '0');
  await s.page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.phase === 'idle', null, { timeout: 15000 });
  const cards = await s.cards(P(id));
  await sleep(450);
  if (i <= 30) await s.shot(P(id + '-start.png'));
  const t0 = Date.now();
  const info = await s.info();
  let taps = 0;
  for (const d of info.solution) {
    const st = await s.state();
    if (st.tool !== d.c) { await s.pick(d.c); taps++; await sleep(160); }
    await s.tapCell(d.y * info.w + d.x);
    taps++;
    await sleep(380);
  }
  try { await s.waitPhase(['won'], 12000); } catch { fails.push(id); await s.shot(P(id + '-FAIL.png')); log.push(`${id} NOT WON ${JSON.stringify(await s.state())}`); break; }
  const st = await s.state();
  log.push(`${id} ${st.level} won in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${taps} taps, cards ${cards}, seal ${st.sealedEligible}`);
  await s.page.waitForSelector('.sheet.open', { timeout: 15000 });
  await sleep(1500);
  if (i <= 3 || i % 5 === 0) await s.shot(P(id + '-result.png'));
  await s.tapSel('.sheet.open .sheet-actions .btn-lg');
  await sleep(600);
  for (let k = 0; k < 5; k++) {
    if (!(await s.page.locator('.popup').count()) || (await s.page.locator('.popup .rule-card').count())) break;
    await s.shot(P(id + '-after' + k + '.png'));
    // "Later" on the daily-unlock offer (stay in the campaign), else the popup's main button.
    if (await s.page.locator('.popup .popup-foot .btn-ghost').count()) await s.tapSel('.popup .popup-foot .btn-ghost');
    else if (await s.page.locator('.popup .popup-foot .btn').count()) await s.tapSel('.popup .popup-foot .btn >> nth=-1');
    else await s.page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
    await sleep(700);
  }
}
log.push(`total ${((Date.now() - t00) / 60000).toFixed(1)} min`);
log.push('screen after 30: ' + (await s.page.evaluate(() => window.__ink.screen())));
log.push('errors: ' + JSON.stringify(s.errors));
await s.close();

// Autoplay every stage (debug hook drives the same select/pour code).
const a = await open({ device: 'small', notch: false });
await a.page.evaluate(() => { window.__ink.clearUpTo(29); });
let ok = 0;
for (let i = 0; i < 30; i++) {
  await a.page.evaluate((k) => window.__ink.go('play', { index: k }), i);
  await sleep(300);
  await a.cards();
  await a.page.evaluate(() => window.__ink.autoplay(true));
  try { await a.waitPhase(['won'], 30000); ok++; } catch { fails.push('auto' + (i + 1)); }
  await a.page.evaluate(() => window.__ink.autoplay(false));
}
log.push(`autoplay ${ok}/30 won; errors ${JSON.stringify(a.errors)}`);
await a.close();
await closeAll();

console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL OK');
process.exit(fails.length ? 1 : 0);
