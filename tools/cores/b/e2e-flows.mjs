/*
 * Core B flows in the real build (touch input): wrong colours, backtracking, self-crossing,
 * grabbing a stroke end, tap-to-clear, undo, restart, hint purchase when out of hints, pause menu,
 * reload mid-progress, symbols mode, every rule card in KO and EN at 360 px, autoplay of all 30
 * stages and a daily puzzle. Screenshots: tools/cores/b/out/flows/.
 *
 *   node tools/cores/b/e2e-flows.mjs      (E2E_NO_BUILD=1 to reuse dist-test-b)
 */
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCore, closeAll } from '../../e2e/core-lib.mjs';

const OUT = new URL('./out/flows/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const log = [];
const check = (ok, msg) => { log.push((ok ? 'ok   ' : 'FAIL ') + msg); console.log((ok ? 'ok   ' : 'FAIL ') + msg); };

async function closePopups(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.popup').count())) return;
    const btn = page.locator('.popup .popup-foot .btn').first();
    if (await btn.count()) await btn.click({ force: true });
    else await page.locator('.popup .popup-close').last().click({ force: true });
    await sleep(350);
  }
}

async function openStage(s, n) {
  await s.page.evaluate((i) => { window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
  await sleep(500);
  await closePopups(s.page);
  await sleep(200);
  const info = await s.info();
  return { info, idx: (x, y) => y * info.w + x, strokes: info.strokes.map((p) => p.map((c) => c.y * info.w + c.x)) };
}

async function tapSel(s, sel) {
  const el = s.page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  const b = await el.boundingBox();
  await s.tap(b.x + b.width / 2, b.y + b.height / 2);
}
const coach = (s) => s.page.evaluate(() => { const c = document.querySelector('.play .coach'); return c && c.classList.contains('show') ? c.textContent : ''; });

try {
  // ---------------------------------------------------------------- core interactions (KO, 360)
  {
    const s = await openCore('b', { device: 'small', lang: 'ko' });
    const { page } = s;
    let L = await openStage(s, 6); // yellow (0,0) over rows 0-1, blue (4,2) over rows 1-2
    // Yellow along the top row only, then down into the blue row: a wrong cell.
    await s.dragCells([L.idx(0, 0), L.idx(1, 0), L.idx(2, 0), L.idx(3, 0), L.idx(4, 0), L.idx(4, 1), L.idx(4, 2 - 0)].slice(0, 6), 80);
    await sleep(200);
    let st = await s.state();
    check(st.paths[0].length === 6 && st.wrong === 0, 'drag paints 6 cells, none wrong yet');
    // Continue from the end into a cell that wants only blue (3,2).
    await s.dragCells([L.idx(4, 1), L.idx(3, 1), L.idx(3, 2)], 80);
    await sleep(250);
    st = await s.state();
    check(st.wrong === 1, 'grabbing the end continues the stroke; yellow on a blue-only cell is marked wrong');
    check((await coach(s)).length > 0, 'coach explains the wrong colour: ' + (await coach(s)));
    await s.shot(OUT + 'ko-01-wrong-cell.png');
    // Slide back along the stroke: erase two cells.
    await s.dragCells([L.idx(3, 2), L.idx(3, 1), L.idx(4, 1)], 80);
    await sleep(250);
    st = await s.state();
    check(st.paths[0].length === 6 && st.wrong === 0, 'sliding back erases the wrong cells');
    check(st.sealedEligible === false, 'taking back cells from an earlier gesture voids the seal');
    // Self-crossing is refused.
    await s.dragCells([L.idx(4, 1), L.idx(3, 1), L.idx(3, 0)], 80);
    await sleep(250);
    st = await s.state();
    check(st.paths[0].length === 7, 'stroke stops at its own path (no self-crossing)');
    check((await coach(s)).includes('지나온'), 'coach: ' + (await coach(s)));
    await s.shot(OUT + 'ko-02-self-cross.png');
    // Fast diagonal-ish swipe across the board in one move (interpolated cell by cell).
    const a = await s.center(L.idx(4, 2)), b = await s.center(L.idx(0, 2));
    await s.page.evaluate(() => 0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x, y: b.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    st = await s.state();
    check(st.paths[1].length === 5, 'one fast swipe paints every cell it passes (' + st.paths[1].length + ')');
    await s.shot(OUT + 'ko-03-fast-swipe.png');
    // Tap the blue drop: clears its stroke. Undo brings it back.
    await s.tapCell(L.idx(4, 2));
    await sleep(300);
    st = await s.state();
    check(st.paths[1].length === 1, 'tapping a drop clears its stroke');
    await s.shot(OUT + 'ko-04-tap-clear.png');
    await tapSel(s, '.boosters .booster:nth-child(2) .icon-btn');
    await sleep(300);
    st = await s.state();
    check(st.paths[1].length === 5, 'undo restores the cleared stroke');
    // Restart.
    await tapSel(s, '.boosters .booster:nth-child(1) .icon-btn');
    await sleep(400);
    st = await s.state();
    check(st.paths.every((p) => p.length === 1) && st.phase === 'idle', 'restart clears the board');
    // Hint when out of hints: buy with coins.
    await page.evaluate(() => { const st = window.__ink.store; st.data.hints = 0; st.data.coins = 500; st.data.hinted = {}; st.commit('wallet'); });
    L = await openStage(s, 13);
    await tapSel(s, '.boosters .booster:nth-child(3) .icon-btn');
    await sleep(600);
    await s.shot(OUT + 'ko-05-out-of-hints.png');
    const buy = page.locator('.popup .btn-gold');
    check((await buy.count()) > 0, 'out-of-hints popup offers coins');
    await tapSel(s, '.popup .btn-gold');
    await sleep(700);
    st = await s.state();
    check(st.hint === true, 'bought hint shows the dotted strokes');
    await s.shot(OUT + 'ko-06-hint.png');
    // Follow the hint with real drags.
    for (const p of L.strokes) if (p.length > 1) await s.dragCells(p, 60);
    await s.waitPhase(['won'], 8000).then(() => check(true, 'hinted stage won by following the dotted lines')).catch(() => check(false, 'hinted stage not won'));
    await sleep(2500);
    await s.shot(OUT + 'ko-07-result-after-hint.png');
    // Pause menu.
    L = await openStage(s, 14);
    await s.dragCells(L.strokes[0].slice(0, 4), 60);
    await tapSel(s, '.play .topbar .icon-btn:last-child');
    await sleep(500);
    await s.shot(OUT + 'ko-08-menu.png');
    await closePopups(page);
    st = await s.state();
    check(st.paths[0].length === 4, 'menu open/close keeps the drawing');
    // Symbols on (colour-blind).
    await page.evaluate(() => { const st = window.__ink.store; st.data.settings.symbols = true; st.commit('settings'); });
    L = await openStage(s, 15);
    await s.dragCells(L.strokes[0], 60);
    await s.dragCells(L.strokes[1].slice(0, 8), 60);
    await sleep(300);
    await s.shot(OUT + 'ko-09-symbols.png');
    await page.evaluate(() => { const st = window.__ink.store; st.data.settings.symbols = false; st.commit('settings'); });
    // Reload mid-progress.
    await page.evaluate(() => { window.__ink.clearUpTo(7); window.__ink.store.flush && window.__ink.store.flush(); });
    const before = await page.evaluate(() => Object.keys(window.__ink.store.data.levels).length);
    await page.reload();
    await page.waitForFunction(() => !!window.__ink);
    const after = await page.evaluate(() => Object.keys(window.__ink.store.data.levels).length);
    check(before === after && after >= 8, `reload keeps progress (${before} -> ${after})`);
    check(s.errors.length === 0, 'no page errors: ' + JSON.stringify(s.errors.slice(0, 3)));
    await s.close();
  }
  // ---------------------------------------------------------------- rule cards + tray, KO and EN at 360
  for (const lang of ['ko', 'en']) {
    const s = await openCore('b', { device: 'small', lang });
    const { page } = s;
    const intros = await page.evaluate(() => window.__ink.levels.map((id, i) => i));
    void intros;
    for (const n of [3, 5, 11, 17, 22]) {
      await page.evaluate((i) => { const st = window.__ink.store; st.data.seen = {}; st.commit('seen'); window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
      await sleep(2200); // let the diagram play
      await s.shot(OUT + `${lang}-card-stage${String(n).padStart(2, '0')}.png`);
      await closePopups(page);
    }
    // A mid-game board with tray + coach in this language.
    await page.evaluate(() => { window.__ink.clearUpTo(4); window.__ink.go('play', { index: 5 }); });
    await sleep(700);
    await closePopups(page);
    await s.shot(OUT + `${lang}-stage06-coach.png`);
    await page.evaluate(() => { window.__ink.clearUpTo(28); window.__ink.go('play', { index: 29 }); });
    await sleep(700);
    await closePopups(page);
    await s.shot(OUT + `${lang}-stage30.png`);
    // Overflow check: nothing wider than the screen.
    const over = await page.evaluate(() => [...document.querySelectorAll('.play *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map((e) => e.className).slice(0, 5));
    check(over.length === 0, `${lang}: nothing overflows at 360 px ${JSON.stringify(over)}`);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.b-chip')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(chips.every(([w, h]) => h >= 48 && w >= 48), `${lang}: tray chips >= 48 px ${JSON.stringify(chips)}`);
    check(s.errors.length === 0, `${lang}: no page errors ` + JSON.stringify(s.errors.slice(0, 3)));
    await s.close();
  }
  // ---------------------------------------------------------------- autoplay all + daily
  {
    const s = await openCore('b', { device: 'iphone', lang: 'ko' });
    const { page } = s;
    const ids = await page.evaluate(() => window.__ink.levels);
    let won = 0;
    for (let i = 0; i < ids.length; i++) {
      await page.evaluate((n) => { window.__ink.clearUpTo(n - 1); window.__ink.go('play', { index: n }); }, i);
      await sleep(300);
      await closePopups(page);
      await page.evaluate(() => { window.__ink.timeScale(6); window.__ink.autoplay(true); });
      try { await s.waitPhase(['won'], 20000); won++; } catch { check(false, 'autoplay stuck on ' + ids[i]); }
      await page.evaluate(() => window.__ink.autoplay(false));
      // Leave only once the result sheet is up (the shell's tap-to-skip layer is gone by then).
      await page.waitForSelector('.sheet.open', { timeout: 15000 }).catch(() => {});
      await sleep(200);
    }
    check(won === ids.length, `autoplay won ${won}/${ids.length}`);
    await page.evaluate(() => { window.__ink.timeScale(1); window.__ink.clearUpTo(29); window.__ink.go('daily', undefined, { resetHistory: true }); });
    await sleep(900);
    await closePopups(page);
    await s.shot(OUT + 'ko-daily.png');
    await page.evaluate(() => window.__ink.go('play', { daily: 0 }));
    await sleep(700);
    await closePopups(page);
    const info = await s.info();
    for (const p of info.strokes) if (p.length > 1) await s.dragCells(p.map((c) => c.y * info.w + c.x), 60);
    await s.waitPhase(['won'], 8000).then(() => check(true, 'daily puzzle won by touch')).catch(async () => { check(false, 'daily not won ' + JSON.stringify(await s.state())); await s.shot(OUT + 'ko-daily-FAIL.png'); });
    check(s.errors.length === 0, 'no page errors ' + JSON.stringify(s.errors.slice(0, 3)));
    await s.close();
  }
} finally {
  await closeAll();
  const fails = log.filter((l) => l.startsWith('FAIL'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
}
