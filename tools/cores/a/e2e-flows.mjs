/*
 * Core A flows in the real build (touch input):  node tools/cores/a/e2e-flows.mjs
 *  - wrong picture → wrong cells + fix line (no fail sheet); tap a drop to lift; drag a drop to move;
 *    seal voided by lifting
 *  - undo booster (free), restart, hint (free stock, then out of hints → buy with coins), pause menu
 *  - reload mid-progress keeps cleared stages
 *  - autoplay wins all 30; a daily puzzle opens and autoplays
 *  - KO/EN at 360 px with symbols on: tray, coach, rule cards (screenshots)
 */
import { mkdirSync } from 'node:fs';
import { openA, closeA, tapSel, closePopups, sleep, SHOTS } from './pw.mjs';

const OUT = SHOTS + '/flows';
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

async function startStage(s, n) {
  await s.page.evaluate((i) => { window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
  await sleep(600);
  await closePopups(s);
  await sleep(300);
}

// ---------------------------------------------------------------- wrong / lift / move / undo
{
  const s = await openA({ lang: 'ko' });
  await startStage(s, 4); // R2 + Y2
  const info = await s.info();
  const [d0, d1] = info.solution;
  const w = info.w;
  // Put both inks one cell off.
  await s.tapCell(d0.y * w + d0.x + 1);
  await sleep(600);
  await s.tapCell(d1.y * w + d1.x - 1);
  await sleep(1200);
  let st = await s.state();
  const coach = await s.page.locator('.coach.show').textContent().catch(() => '');
  ok('wrong picture shows check phase (no fail sheet)', st.phase === 'check' && !(await s.page.locator('.sheet.open').count()), `phase=${st.phase} coach="${coach}"`);
  await s.shot(`${OUT}/wrong-check.png`);
  // Tap the first drop to lift it.
  await s.tapCell(d0.y * w + d0.x + 1);
  await sleep(600);
  st = await s.state();
  ok('tap a drop lifts it back to the tray', st.placed === 1 && st.pos[d0.k] === -1 && st.phase === 'play', JSON.stringify(st.pos));
  ok('lifting voids the seal', st.sealedEligible === false);
  await s.shot(`${OUT}/lifted.png`);
  // Place it right, then drag the other drop onto its right cell.
  await s.tapCell(d0.y * w + d0.x);
  await sleep(700);
  await s.dragCells([d1.y * w + d1.x - 1, d1.y * w + d1.x], 160);
  await sleep(1400);
  st = await s.state();
  ok('drag a drop to move it → solved', st.phase === 'won', st.phase);
  await sleep(2500);
  await s.shot(`${OUT}/moved-won.png`);

  // Undo + restart + hint on stage 12.
  await startStage(s, 12);
  const inf2 = await s.info();
  const a = inf2.solution[0];
  await s.tapCell(a.y * inf2.w + a.x);
  await sleep(500);
  await tapSel(s, '.boosters .booster:nth-child(2) .icon-btn');
  await sleep(500);
  st = await s.state();
  ok('undo lifts the last drop (free)', st.placed === 0, `placed=${st.placed}`);
  await s.tapCell(a.y * inf2.w + a.x);
  await sleep(400);
  await tapSel(s, '.boosters .booster:nth-child(1) .icon-btn');
  await sleep(500);
  st = await s.state();
  ok('restart clears the board', st.placed === 0 && st.phase === 'idle');
  const hints0 = await s.page.evaluate(() => window.__ink.store.data.hints);
  await tapSel(s, '.boosters .booster:nth-child(3) .icon-btn');
  await sleep(700);
  st = await s.state();
  const hints1 = await s.page.evaluate(() => window.__ink.store.data.hints);
  ok('hint shows ghost marks and costs one hint', st.hint === true && hints1 === hints0 - 1, `${hints0}→${hints1}`);
  await s.shot(`${OUT}/hint.png`);
  // Follow the hint by touch.
  for (const d of inf2.solution) {
    const cur = await s.state();
    if (cur.sel !== d.k) { await tapSel(s, `.a-tray .a-chip:nth-child(${d.k + 1})`); await sleep(150); }
    await s.tapCell(d.y * inf2.w + d.x);
    await sleep(400);
  }
  await s.waitPhase(['won'], 8000).catch(() => {});
  ok('hint marks lead to a win', (await s.state()).phase === 'won');
  await sleep(2500);

  // Out of hints → buy with coins.
  await startStage(s, 13);
  await s.page.evaluate(() => { const st = window.__ink.store; st.data.hints = 0; st.data.coins = 500; st.commit('wallet'); });
  await tapSel(s, '.boosters .booster:nth-child(3) .icon-btn');
  await sleep(600);
  await s.shot(`${OUT}/no-hints.png`);
  const buy = s.page.locator('.popup .popup-foot .btn-gold');
  ok('out of hints popup offers coins', (await buy.count()) > 0);
  if (await buy.count()) { await tapSel(s, '.popup .popup-foot .btn-gold'); await sleep(700); }
  const coins = await s.page.evaluate(() => window.__ink.store.data.coins);
  st = await s.state();
  ok('bought a hint with coins and it shows', st.hint === true && coins === 400, `coins=${coins}`);
  // Pause menu.
  await tapSel(s, '.screen.active .topbar .icon-btn:last-child');
  await sleep(500);
  await s.shot(`${OUT}/menu.png`);
  ok('menu opens', (await s.page.locator('.popup').count()) > 0);
  await closePopups(s);
  // Doomed mark while placing (stage 8: a drop that touches a clean cell).
  await startStage(s, 8);
  const i8 = await s.info();
  await s.tapCell(1 * i8.w + 3 + 1); // next to the top clean mark
  await sleep(900);
  st = await s.state();
  ok('a drop that breaks a clean cell is marked at once', st.doomed > 0, `doomed=${st.doomed}`);
  await s.shot(`${OUT}/doomed.png`);
  // Tapping the used chip in the tray takes the drop back; the red marks go away.
  await tapSel(s, '.a-tray .a-chip:nth-child(1)');
  await sleep(700);
  st = await s.state();
  ok('tapping a used chip lifts its drop and clears the marks', st.placed === 0 && st.doomed === 0 && st.phase === 'idle', JSON.stringify({ placed: st.placed, doomed: st.doomed, phase: st.phase }));
  // Hold, slide off the board, release: nothing is placed.
  const c0 = await s.center(3 * i8.w + 3);
  await s.touch('touchStart', [c0]);
  await sleep(400);
  await s.touch('touchMove', [{ x: c0.x, y: c0.y + 260 }]);
  await sleep(100);
  await s.touch('touchMove', [{ x: c0.x, y: c0.y + 520 }]);
  await s.touch('touchEnd', []);
  await sleep(500);
  st = await s.state();
  ok('hold and slide off the board cancels', st.placed === 0, `placed=${st.placed}`);
  // Hold, slide to the right cell, release: placed there.
  const sol8 = i8.solution[0];
  await s.dragCells([3 * i8.w + 1, sol8.y * i8.w + sol8.x], 200);
  await s.waitPhase(['won'], 6000).catch(() => {});
  ok('hold-and-slide places where the finger is released', (await s.state()).phase === 'won');
  await sleep(2500);
  // Guided stage: a tap away from the hand is refused.
  await startStage(s, 3);
  const i3 = await s.info();
  await s.tapCell(0);
  await sleep(400);
  st = await s.state();
  ok('guided stage refuses cells the hand does not point at', st.placed === 0);
  ok('no page errors (flows)', !s.errors.length, s.errors.join(' | '));
  await s.close();
}

// ---------------------------------------------------------------- reload mid-progress
{
  const s = await openA({ lang: 'ko' });
  await s.page.evaluate(() => { window.__ink.clearUpTo(6); window.__ink.store.flush(); });
  await startStage(s, 8);
  await s.page.reload();
  await s.page.waitForFunction(() => !!window.__ink);
  const n = await s.page.evaluate(() => Object.keys(window.__ink.store.data.levels).length);
  ok('reload keeps progress', n >= 7, `levels=${n}`);
  await s.close();
}

// ---------------------------------------------------------------- autoplay all + daily
{
  const s = await openA({ lang: 'en', device: 'small', notch: false });
  const ids = await s.page.evaluate(() => window.__ink.levels);
  ok('30 stages in the build', ids.length === 30, String(ids.length));
  await s.page.evaluate(() => window.__ink.clearUpTo(29));
  let won = 0; const bad = [];
  for (let i = 0; i < ids.length; i++) {
    await s.page.evaluate((k) => window.__ink.go('play', { index: k }), i);
    await sleep(200);
    await closePopups(s);
    await s.page.evaluate(() => { window.__ink.timeScale(4); window.__ink.autoplay(true); });
    try { await s.waitPhase(['won'], 12000); won++; } catch { bad.push(ids[i]); }
    await s.page.evaluate(() => window.__ink.autoplay(false));
    await sleep(150);
    await closePopups(s);
  }
  ok('autoplay wins every stage', won === ids.length, `${won}/${ids.length} ${bad.join(',')}`);
  await s.page.evaluate(() => window.__ink.go('daily', undefined, { resetHistory: true }));
  await sleep(600);
  await s.shot(`${OUT}/daily.png`);
  await s.page.evaluate(() => window.__ink.go('play', { daily: 2 }));
  await sleep(500);
  await closePopups(s);
  await s.page.evaluate(() => window.__ink.autoplay(true));
  let dailyOk = true;
  try { await s.waitPhase(['won'], 15000); } catch { dailyOk = false; }
  ok('daily puzzle plays', dailyOk);
  ok('no page errors (autoplay)', !s.errors.length, s.errors.join(' | '));
  await s.close();
}

// ---------------------------------------------------------------- KO/EN at 360 px, symbols on
for (const lang of ['ko', 'en']) {
  const s = await openA({ lang, device: 'small' });
  await s.page.evaluate(() => { const st = window.__ink.store; st.data.settings.symbols = true; st.commit('settings'); });
  for (const n of [2, 3, 6, 8, 15]) {
    await s.page.evaluate((i) => { window.__ink.clearUpTo(i - 2); window.__ink.store.data.seen = {}; window.__ink.go('play', { index: i - 1 }); }, n);
    await sleep(700);
    if (await s.page.locator('.popup').count()) await s.shot(`${OUT}/${lang}-360-card-${n}.png`);
    await closePopups(s);
    await sleep(300);
    const info = await s.info();
    const d = info.solution[0];
    await s.tapCell(d.y * info.w + d.x);
    await sleep(900);
    await s.shot(`${OUT}/${lang}-360-stage-${n}.png`);
    // Let a finished stage reach its result sheet (the win animation owns the screen until then).
    if ((await s.state()).phase === 'won') await s.page.waitForSelector('.sheet.open', { timeout: 10000 });
  }
  // Wrong picture text at 360.
  await s.page.evaluate(() => { window.__ink.go('play', { index: 26 }); });
  await sleep(600);
  await closePopups(s);
  const info = await s.info();
  const free = info.droppable.filter((i) => !info.solution.some((d) => d.y * info.w + d.x === i));
  for (let k = 0; k < info.solution.length; k++) { await s.tapCell(free[(k * 7) % free.length]); await sleep(250); }
  await sleep(1500);
  const wst = await s.state();
  ok(`${lang} 360: wrong picture after placing every ink`, wst.phase === 'check', `${wst.level} ${wst.phase} placed=${wst.placed}`);
  await s.shot(`${OUT}/${lang}-360-wrong.png`);
  const over = await s.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.screen.active .coach, .screen.active .a-tray, .screen.active .a-chip')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(el.className);
      if (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('coach')) out.push(el.className + ' scroll');
    }
    const chip = document.querySelector('.a-chip')?.getBoundingClientRect();
    return { out, chip: chip ? [chip.width, chip.height] : null };
  });
  ok(`${lang} 360: tray and coach fit, chips ≥ 48 px`, !over.out.length && over.chip && over.chip[0] >= 48 && over.chip[1] >= 48, JSON.stringify(over));
  ok(`no page errors (${lang} 360)`, !s.errors.length, s.errors.join(' | '));
  await s.close();
}

console.log(results.join('\n'));
await closeA();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
