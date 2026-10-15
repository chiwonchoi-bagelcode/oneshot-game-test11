/*
 * Core E shell checks through real touch:  node tools/cores/e/checks.mjs
 *  wrong first tap → friendly line · fail sheet + retry · rewind + resume · hint bought with coins
 *  when out of hints · pause menu · reload mid-progress · autoplay of all 30 stages · KO/EN at 360 px
 * Screenshots: tools/cores/e/out/chk-*.png
 */
import { open, OUT, sleep, closeAll, dismissCards, tapSel, playStage } from './e2e-lib.mjs';

const log = (...a) => console.log(...a);
let bad = 0;
const expect = (ok, what) => { log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
const booster = (i) => `.boosters .booster:nth-child(${i}) button`;

async function goStage(s, n) {
  await s.page.evaluate((i) => { if (i > 0) window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
  await sleep(700);
  await dismissCards(s);
}

async function main() {
  // ---------------------------------------------------------------- KO, 360 px
  let s = await open({ device: 'small', lang: 'ko' });
  await goStage(s, 9);
  let info = await s.info();
  const w = info.w, sol = info.solution;
  const first = sol[0].y * w + sol[0].x;
  // 1. a tap away from the mark is refused with a line
  const other = (await s.page.evaluate(() => window.__ink.info())).droppable;
  const away = sol[1].y * w + sol[1].x;
  await s.tapCell(away);
  await sleep(250);
  const coach = await s.page.locator('.coach').textContent();
  expect((await s.state()).drops === 0 && /반짝이는/.test(coach), 'tap off the mark is refused: "' + coach + '"');
  await s.shot(OUT + 'chk-01-reject.png');
  void other;

  // 2. fail: second ink dropped too early in the wrong place
  await s.tapCell(first);
  await sleep(1300);
  const st1 = await s.state();
  const wrong = st1.droppable.find((i) => i !== sol[1].y * w + sol[1].x);
  await s.tapCell(wrong);
  try { await s.waitPhase(['lost'], 20000); } catch { /* checked below */ }
  await sleep(1200);
  expect((await s.state()).phase === 'lost', 'wrong second drop fails');
  await s.shot(OUT + 'chk-02-fail.png');
  await tapSel(s, '.sheet.open .btn-lg');
  await sleep(600);
  expect((await s.state()).phase === 'idle', 'retry from the fail sheet');

  // 3. rewind: drop first + a wrong second, rewind, resume
  await s.tapCell(first);
  await sleep(1300);
  const st2 = await s.state();
  await s.tapCell(st2.droppable.find((i) => i !== sol[1].y * w + sol[1].x));
  await sleep(150);
  const rw0 = await s.page.evaluate(() => window.__ink.store.data.rewinds);
  await tapSel(s, booster(2));
  await sleep(500);
  await dismissCards(s);
  const st3 = await s.state();
  expect(st3.drops === 1 && st3.phase === 'rewound', 'rewind back to one drop (' + st3.phase + ', drops ' + st3.drops + ')');
  expect((await s.page.evaluate(() => window.__ink.store.data.rewinds)) === rw0 - 1, 'rewind used one item');
  await s.shot(OUT + 'chk-03-rewound.png');
  await tapSel(s, '.resume-bar.open .btn');
  await sleep(300);
  expect((await s.state()).phase === 'running', 'resume after rewind');
  await tapSel(s, booster(1));
  await sleep(500);

  // 4. hint with no hints left: buy with coins
  await s.page.evaluate(() => { const d = window.__ink.store.data; d.hints = 0; d.coins = 500; window.__ink.store.commit('wallet'); });
  await sleep(200);
  await tapSel(s, booster(3));
  await sleep(600);
  await s.shot(OUT + 'chk-04-hint-buy.png');
  const gold = s.page.locator('.popup .btn-gold');
  if (await gold.count()) {
    const b = await gold.first().boundingBox();
    await s.tap(b.x + b.width / 2, b.y + b.height / 2);
  }
  await sleep(900);
  await dismissCards(s);
  const coins = await s.page.evaluate(() => window.__ink.store.data.coins);
  expect(coins < 500, 'hint bought with coins (coins now ' + coins + ')');
  await s.shot(OUT + 'chk-05-hint-shown.png');
  // follow the hint to win
  const ph = await playStage(s);
  expect(ph === 'won', 'hinted stage won by following the marks');
  await sleep(2500);
  await s.shot(OUT + 'chk-06-result.png');

  // 5. pause menu
  await goStage(s, 10);
  await s.tapCell((await s.info()).solution[0].y * (await s.info()).w + (await s.info()).solution[0].x);
  await sleep(1200);
  await tapSel(s, 'section.play .topbar button:last-child');
  await sleep(500);
  const tick0 = (await s.state()).tick;
  await sleep(2000);
  expect((await s.state()).tick === tick0 && (await s.state()).phase === 'paused', 'pause stops the clock');
  await s.shot(OUT + 'chk-07-pause.png');
  await tapSel(s, '.popup .btn-jade');
  await sleep(300);
  expect((await s.state()).phase !== 'paused', 'resume from pause');

  // 6. reload mid-progress
  await s.page.evaluate(() => window.__ink.clearUpTo(11));
  await sleep(300);
  await s.page.reload();
  await s.page.waitForFunction(() => !!window.__ink);
  await s.page.evaluate(() => { window.__ink.hideDebug(); window.__ink.notch(true); });
  await sleep(800);
  await s.tap(180, 520);
  await sleep(1500);
  await s.shot(OUT + 'chk-08-reload-journey.png');
  const saved = await s.page.evaluate(() => Object.keys(window.__ink.store.data.progress || window.__ink.store.data.levels || {}).length);
  log('     saved progress entries after reload:', saved);
  await s.close();

  // 7. autoplay every stage (stored solution through the core's own input path)
  s = await open({ device: 'small' });
  let won = 0;
  for (let n = 1; n <= 30; n++) {
    await goStage(s, n);
    await s.page.evaluate(() => { window.__ink.timeScale(4); window.__ink.autoplay(true); });
    try { await s.waitPhase(['won', 'lost'], 30000); } catch { /* */ }
    const ph2 = (await s.state()).phase;
    if (ph2 === 'won') won++; else log('     autoplay stage', n, ph2);
    await s.page.evaluate(() => { window.__ink.autoplay(false); window.__ink.timeScale(1); });
    await sleep(200);
    await dismissCards(s);
  }
  expect(won === 30, `autoplay won ${won}/30`);
  expect(!s.errors.length, 'no page errors (' + JSON.stringify(s.errors.slice(0, 3)) + ')');
  await s.close();

  // 8. EN at 360 px: rule cards, coach lines, tray
  s = await open({ device: 'small', lang: 'en' });
  for (const n of [3, 6, 8, 11, 13, 15]) {
    await s.page.evaluate((i) => { window.__ink.store.data.seen = {}; window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
    await sleep(900);
    await s.shot(OUT + `chk-en-${n}-card.png`);
    await dismissCards(s);
    const inf = await s.info();
    await s.tapCell(inf.solution[0].y * inf.w + inf.solution[0].x);
    await sleep(700);
    await s.shot(OUT + `chk-en-${n}-play.png`);
    const over = await s.page.evaluate(() => {
      const els = [...document.querySelectorAll('.coach, .pointer-bubble, .queue, .boosters, .popup-sheet')];
      return els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
    });
    expect(!over.length, `EN stage ${n}: nothing overflows ${over.join(',')}`);
  }
  expect(!s.errors.length, 'EN: no page errors');
  await s.close();
}

try {
  await main();
} catch (e) {
  log('ERROR', e.stack || e.message);
  bad++;
} finally {
  await closeAll();
  log(bad ? `${bad} check(s) failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
