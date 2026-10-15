/*
 * Core D shell checks through real touch: fail sheet, rewind, restart, hint (and buying one with
 * coins when out), pause menu, the hold preview while the clock runs, reload mid-progress, colour-blind symbols, EN at 360 px.
 *   node tools/cores/d/checks.mjs [--dev]
 * Screenshots: tools/cores/d/out/checks/
 */
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DEVMODE = process.argv.includes('--dev');
const OUT = new URL('./out/checks/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const lib = DEVMODE ? await import('./dev-lib.mjs') : await import('../../e2e/core-lib.mjs');
const open = (o) => (DEVMODE ? lib.openDev(o) : lib.openCore('d', o));
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); console.log(results[results.length - 1]); };

async function session(opts, fn) {
  const s = await open(opts);
  const page = s.page;
  const cdp = await page.context().newCDPSession(page);
  const T = {
    down: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }),
    move: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] }),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
  const tap = async (p, ms = 60) => { await T.down(p); await sleep(ms); await T.up(); };
  const tapSel = async (sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('missing ' + sel); await tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); };
  const st = () => page.evaluate(() => window.__ink.state());
  const shot = async (name) => { await sleep(250); await page.screenshot({ path: OUT + name + '.png' }); };
  const wellP = async (k) => { const i = await page.evaluate(() => window.__ink.info()); const w = i.wells[k]; return page.evaluate((idx) => window.__ink.cellCenter(idx), w.y * i.w + w.x); };
  const goStage = async (n) => {
    await page.evaluate((n) => { window.__ink.clearUpTo(n - 2); window.__ink.go('play', { index: n - 1 }); }, n);
    await sleep(600);
    for (let k = 0; k < 4 && (await page.locator('.popup').count()); k++) { await tapSel('.popup .popup-foot .btn'); await sleep(450); }
  };
  const waitTick = async (t) => { for (let g = 0; g < 4000; g++) { const x = await st(); if (x.tick >= t || ['won', 'lost'].includes(x.phase)) return x; await sleep(10); } };
  await page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(500);
  try { await fn({ s, page, T, tap, tapSel, st, shot, wellP, goStage, waitTick }); } catch (e) { ok('session error', false, e.message); await page.screenshot({ path: OUT + 'ERROR.png' }); }
  if (s.errors.length) ok('no page errors', false, JSON.stringify(s.errors.slice(0, 4)));
  else ok('no page errors', true);
  await s.close();
}

await session({ device: 'iphone', lang: 'ko' }, async ({ page, T, tap, tapSel, st, shot, wellP, goStage, waitTick }) => {
  await tap({ x: 195, y: 600 });
  await page.waitForFunction(() => window.__ink.screen() === 'play');
  await sleep(800);

  // ---- tapping a plain cell is refused with a message
  await goStage(9);
  await tap(await page.evaluate(() => window.__ink.cellCenter(14)));
  await sleep(150);
  const coach = await page.locator('.coach.show').textContent().catch(() => '');
  ok('plain cell refused', (await st()).drops === 0 && /샘/.test(coach || ''), coach);
  await shot('01-reject');

  // ---- wrong wells → fail sheet
  for (const k of [0, 1, 2, 3]) { await tap(await wellP(k)); await sleep(120); }
  await page.waitForSelector('.sheet.open', { timeout: 15000 });
  await sleep(500);
  ok('fail sheet', (await st()).phase === 'lost');
  await shot('02-fail');
  // rewind from the fail sheet
  const rw0 = await page.evaluate(() => window.__ink.store.data.rewinds);
  await tapSel('.sheet.open .side:first-child .icon-btn');
  await sleep(600);
  const s1 = await st();
  ok('rewind from fail', s1.phase === 'rewound' && (await page.evaluate(() => window.__ink.store.data.rewinds)) === rw0 - 1, `phase=${s1.phase} drops=${s1.drops}`);
  await shot('03-rewound');
  // restart (the resume bar sits over the boosters while rewound: use the pause menu like a player)
  await tapSel('.screen.active .topbar .icon-btn:last-child');
  await sleep(500);
  await shot('03b-pause-rewound');
  await page.locator('.popup .btn').nth(1).click();
  await sleep(600);
  ok('restart from menu', (await st()).phase === 'idle' && (await st()).drops === 0);

  // ---- hint (has hints) on stage 9 → numbered marks on the wells
  await tapSel('.boosters .booster:last-child .icon-btn');
  await sleep(600);
  await shot('04-hint');
  ok('hint shown', !(await page.locator('.popup').count()));

  // ---- out of hints: buy one with coins
  await goStage(11);
  await page.evaluate(() => { window.__ink.store.data.hints = 0; window.__ink.store.commit('wallet'); });
  const coins0 = await page.evaluate(() => window.__ink.store.data.coins);
  await tapSel('.boosters .booster:last-child .icon-btn');
  await sleep(500);
  await shot('05-buy-hint');
  await tapSel('.popup .popup-foot .btn-gold');
  await sleep(800);
  const coins1 = await page.evaluate(() => window.__ink.store.data.coins);
  ok('hint bought with coins', coins1 === coins0 - 100, `${coins0} -> ${coins1}`);
  await shot('06-hint-bought');

  // ---- hold preview while the clock runs (stage 11: yellow, then hold blue)
  await goStage(12);
  await tap(await wellP(0));
  await waitTick(1);
  await T.down(await wellP(1));
  await sleep(350);
  const sp = await st();
  ok('hold shows preview', sp.preview === true && sp.holding === 1);
  await shot('07-hold-beat1');
  // slide off to cancel
  const p0 = await wellP(1);
  await T.move({ x: p0.x - 120, y: p0.y });
  await sleep(200);
  await shot('08-slide-off');
  await T.up();
  await sleep(300);
  ok('slide off cancels', (await st()).drops === 1);

  // ---- pause menu while the clock runs
  await goStage(6);
  await tap(await wellP(0));
  await waitTick(1);
  await tapSel('.screen.active .topbar .icon-btn:last-child');
  await sleep(500);
  ok('pause opens', (await page.locator('.popup').count()) > 0 && (await st()).phase === 'paused');
  await shot('09-pause');
  await tapSel('.popup .btn');
  await sleep(400);

  // ---- reload mid-progress keeps the save
  await page.evaluate(() => window.__ink.store.flush());
  const before = await page.evaluate(() => Object.values(window.__ink.store.data.levels).filter((r) => r.c).length);
  await page.reload();
  await page.waitForFunction(() => !!window.__ink);
  await sleep(800);
  const after = await page.evaluate(() => Object.values(window.__ink.store.data.levels).filter((r) => r.c).length);
  ok('reload keeps progress', after === before && after > 0, `${before} -> ${after}`);
  await page.evaluate(() => { window.__ink.hideDebug(); window.__ink.notch(true); window.__ink.go('chapter', { chapter: 0 }); });
  await shot('11-chapter-after-reload');
});

// ---- EN at 360 px with colour-blind symbols: tray, coach, rule card, preview
await session({ device: 'small', lang: 'en' }, async ({ page, T, tap, tapSel, st, shot, wellP, waitTick }) => {
  await page.evaluate(() => { window.__ink.store.data.settings.symbols = true; window.__ink.store.commit('settings'); });
  await tap({ x: 180, y: 600 });
  await page.waitForFunction(() => window.__ink.screen() === 'play');
  await sleep(900);
  await shot('20-en-stage1');
  for (const n of [4, 12, 14, 16, 21]) {
    await page.evaluate((n) => { window.__ink.clearUpTo(n - 2); window.__ink.go('play', { index: n - 1 }); }, n);
    await sleep(700);
    if (await page.locator('.popup').count()) await shot(`21-en-card-${n}`);
    for (let k = 0; k < 4 && (await page.locator('.popup').count()); k++) { await tapSel('.popup .popup-foot .btn'); await sleep(450); }
    await tap(await wellP(0));
    await sleep(200);
    await T.down(await wellP(1));
    await sleep(400);
    await shot(`22-en-hold-${n}`);
    await T.up();
    await sleep(200);
  }
  const over = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.screen.active *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > window.innerWidth + 1 || r.left < -1)) bad.push(el.className);
    }
    return bad.slice(0, 5);
  });
  ok('no horizontal overflow at 360 (EN)', over.length === 0, over.join(','));
});

console.log('\n' + results.join('\n'));
if (!DEVMODE) await lib.closeAll();
