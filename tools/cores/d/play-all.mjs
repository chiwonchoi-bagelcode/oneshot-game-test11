/*
 * Core D end-to-end: plays every stage from a fresh install, in order, through real CDP touch
 * input at real tempo (no autoplay, no time scaling), like a person who knows the answer:
 *   - beat-0 wells are tapped one after another,
 *   - a later well is tapped ~170 ms after the beat pill changes (human reaction), or, with
 *     --hold, pressed a beat early and released ~170 ms after the beat changes.
 * Then runs the stored-solution autoplay on every stage as a second check.
 *
 *   node tools/cores/d/play-all.mjs [--hold] [--small] [--en] [--dev] [--from N] [--to N] [--no-autoplay]
 *   (--dev plays against a running dev server, see dev-lib.mjs; default builds and serves dist-test-d)
 * Screenshots: tools/cores/d/out/play/
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const num = (f, d) => (args.includes(f) ? +args[args.indexOf(f) + 1] : d);
const HOLD = flag('--hold');
const REACT = num('--react', 170);
/** --early N: tap N ms before the beat changes (tapping on the tick sound). */
const EARLY = num('--early', 0);
const FROM = num('--from', 1), TO = num('--to', 30);
const OUT = new URL('./out/play' + (HOLD ? '-hold' : '') + (num('--early', 0) ? '-early' : '') + '/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let s, closeAll = async () => {};
const opts = { device: flag('--small') ? 'small' : 'iphone', lang: flag('--en') ? 'en' : 'ko' };
if (flag('--dev')) {
  const { openDev } = await import('./dev-lib.mjs');
  s = await openDev(opts);
  closeAll = () => s.close();
} else {
  const lib = await import('../../e2e/core-lib.mjs');
  s = await lib.openCore('d', opts);
  closeAll = lib.closeAll;
}
const log = [];
const say = (...a) => { console.log(...a); log.push(a.join(' ')); };
const page = s.page;
const st = () => page.evaluate(() => window.__ink.state());
const touch = async (type, pts) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await cdp.detach();
};
let cdp0 = null;
async function cdp() { if (!cdp0) cdp0 = await page.context().newCDPSession(page); return cdp0; }
async function tDown(p) { await (await cdp()).send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); }
async function tUp() { await (await cdp()).send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapAt(p, ms = 60) { await tDown(p); await sleep(ms); await tUp(); }
async function tapSel(sel) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error('no ' + sel);
  await tapAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
}
async function popups(tag) {
  for (let k = 0; k < 6; k++) {
    await sleep(350);
    if (!(await page.locator('.popup').count())) return;
    await page.screenshot({ path: OUT + tag + '-popup' + k + '.png' });
    if (await page.locator('.popup .popup-foot .btn').count()) await tapSel('.popup .popup-foot .btn');
    else await page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
    await sleep(500);
  }
}
/** Wait until the beat counter reaches t (polling like an eye on the beat pill). */
async function waitTick(t, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const x = await st();
    if (x.tick >= t || x.phase === 'won' || x.phase === 'lost') return x;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for beat ' + t);
    await sleep(8);
  }
}

void touch;
await page.waitForFunction(() => window.__ink.screen() === 'title');
await sleep(600);
await page.screenshot({ path: OUT + '00-title.png' });
// Title: tap anywhere to start, like a player.
await tapAt({ x: 195, y: 600 });
await page.waitForFunction(() => window.__ink.screen() === 'play', null, { timeout: 20000 });
if (FROM > 1) {
  await page.evaluate((n) => { window.__ink.clearUpTo(n - 2); window.__ink.go('play', { index: n - 1 }); }, FROM);
}
const results = [];
for (let n = FROM; n <= TO; n++) {
  const tag = String(n).padStart(2, '0');
  try {
    await page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.phase === 'idle', null, { timeout: 20000 });
    await popups(tag + 'a');
    await sleep(300);
    const info = await page.evaluate(() => window.__ink.info());
    if (n <= 12 || n % 5 === 0) await page.screenshot({ path: OUT + tag + '-start.png' });
    const sol = info.solution.slice().sort((a, b) => a.t - b.t);
    const t0 = Date.now();
    const notes = [];
    for (const d of sol) {
      const idx = d.y * info.w + d.x;
      const p = await page.evaluate((i) => window.__ink.cellCenter(i), idx);
      if (d.t === 0) {
        if (HOLD && flag('--shots') && sol.indexOf(d) > 0) {
          await tDown(p); await sleep(300); await page.screenshot({ path: OUT + tag + '-hold-t0.png' }); await tUp();
          await sleep(260);
          continue;
        }
        await tapAt(p);
        await sleep(260);
        continue;
      }
      if (EARLY) {
        await waitTick(d.t - 1);
        for (let g = 0; g < 3000; g++) { const x = await st(); if (x.tick >= d.t || (x.toBeat >= 0 && x.toBeat <= EARLY)) break; await sleep(5); }
        await tapAt(p);
      } else if (HOLD) {
        await waitTick(d.t - 1);
        await sleep(200);
        await tDown(p);
        if (flag('--shots') && n <= 12 && sol.every((e) => e === d || Math.abs(e.t - d.t) > 1)) { await sleep(250); await page.screenshot({ path: OUT + tag + '-hold-t' + d.t + '.png' }); }
        const x = await waitTick(d.t);
        await sleep(REACT);
        await tUp();
        if (x.tick > d.t) notes.push('late ' + d.t);
      } else {
        const x = await waitTick(d.t);
        if (x.tick > d.t) notes.push('late ' + d.t);
        await sleep(REACT);
        await tapAt(p);
      }
      await sleep(30);
    }
    await page.waitForFunction(() => ['won', 'lost'].includes(window.__ink.state().phase), null, { timeout: 40000 });
    const r = await st();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ n, phase: r.phase, secs, sealed: r.sealedEligible, notes });
    say(`stage ${tag} ${r.level}: ${r.phase} in ${secs}s seal=${r.sealedEligible} ${notes.join(',')}`);
    if (r.phase !== 'won') { await page.screenshot({ path: OUT + tag + '-LOST.png' }); break; }
    await page.waitForSelector('.sheet.open', { timeout: 20000 });
    await sleep(1400);
    if (n <= 3 || n % 10 === 0) await page.screenshot({ path: OUT + tag + '-result.png' });
    await tapSel('.sheet.open .sheet-actions .btn-lg');
    await sleep(700);
    await popups(tag + 'b');
  } catch (e) {
    say(`stage ${tag}: ERROR ${String(e.message).slice(0, 160)}`);
    await page.screenshot({ path: OUT + tag + '-ERROR.png' });
    results.push({ n, phase: 'error' });
    break;
  }
}
const won = results.filter((r) => r.phase === 'won').length;
say(`touch play (${HOLD ? 'hold' : EARLY ? 'tap ' + EARLY + ' ms before the beat' : 'tap'}, reaction ${REACT} ms): ${won}/${TO - FROM + 1} won`);

if (!flag('--no-autoplay')) {
  let ok = 0;
  const bad = [];
  for (let n = 1; n <= 30; n++) {
    await page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
    await sleep(400);
    for (let k = 0; k < 4 && (await page.locator('.popup').count()); k++) { await page.locator('.popup .popup-foot .btn').first().click(); await sleep(300); }
    await page.evaluate(() => { window.__ink.timeScale(4); window.__ink.autoplay(true); });
    try {
      await page.waitForFunction(() => ['won', 'lost'].includes(window.__ink.state().phase), null, { timeout: 30000 });
    } catch { /* */ }
    const r = await st();
    if (r.phase === 'won') ok++; else bad.push(n + ':' + r.phase);
    await page.evaluate(() => { window.__ink.autoplay(false); window.__ink.timeScale(1); });
  }
  say(`autoplay: ${ok}/30 won ${bad.join(' ')}`);
}
say('page errors: ' + JSON.stringify(s.errors.slice(0, 8)));
writeFileSync(OUT + 'log.txt', log.join('\n') + '\n');
await closeAll();
