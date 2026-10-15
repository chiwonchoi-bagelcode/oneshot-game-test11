/*
 * Core C flows with real touch: wrong colour → water/undo, "already in", counted drops and refunds,
 * restart, hint (bought with coins when out), pause menu, secret leftover, reload mid-progress,
 * EN/KO at 360 px, colour-blind symbols, and a daily puzzle (orientation + win).
 *   E2E_NO_BUILD=1 node tools/cores/c/e2e-flows.mjs
 */
import { open, OUT, sleep, closeAll } from './lib.mjs';

const P = (n) => `${OUT}flow-${n}.png`;
const out = [];
const bad = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) bad.push(msg); };
const SEEN = { 'mech.c_mix': 1, 'mech.c_white': 1, 'mech.c_brown': 1, 'mech.c_limit': 1, 'mech.c_link': 1, 'mech.c_secret': 1 };
const goStage = async (s, n) => {
  await s.page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
  await sleep(600);
  await s.cards();
  await sleep(300);
};
const coach = (s) => s.page.evaluate(() => document.querySelector('.coach.show')?.textContent || '');
const region = async (s, key) => (await s.state()).regions.find((r) => r.key === key);
const boost = (s, k) => s.tapSel(`.play .boosters .booster:nth-child(${k}) .icon-btn`); // 1 restart, 2 undo, 3 hint

// ---------------------------------------------------------------- KO, iPhone
{
  const s = await open({ device: 'iphone' });
  await s.page.evaluate((seen) => { window.__ink.clearUpTo(29); Object.assign(window.__ink.store.data.seen, seen); }, SEEN);
  // Wrong colour, already-in, water, undo, restart (stage 6 cactus: green body).
  await goStage(s, 6);
  const cact = await region(s, 'a');
  await s.tapCell(cact.labels[0]); // red is selected: wrong for green
  await sleep(1200);
  check((await region(s, 'a')).state === 1, 'red poured into the cactus');
  const c1 = await coach(s);
  await s.shot(P('01-wrong'));
  check(/물|wash/i.test(c1), 'wrong colour coach mentions water: ' + c1);
  await s.tapCell(cact.labels[0]);
  await sleep(250);
  check(/벌써|already/i.test(await coach(s)), 'same colour again says already: ' + (await coach(s)));
  check((await s.state()).pours === 1, 'already-in pour costs nothing');
  await s.pick(0);
  await s.tapCell(cact.labels[0] + 1);
  await sleep(900);
  check((await region(s, 'a')).state === 0, 'water washed the cactus');
  check((await s.state()).sealedEligible === false, 'washing voids the seal');
  await s.shot(P('02-washed'));
  await boost(s, 2);
  await sleep(500);
  check((await region(s, 'a')).state === 1, 'undo brings the red back');
  await boost(s, 2);
  await sleep(500);
  check((await region(s, 'a')).state === 0 && (await s.state()).pours === 0, 'second undo: clean board');
  await s.pick(2); await s.tapCell(cact.labels[0]); await sleep(300);
  await boost(s, 1);
  await sleep(600);
  check((await s.state()).pours === 0 && (await s.state()).phase === 'idle', 'restart clears the picture');
  // Tapping paper and white parts.
  await goStage(s, 10);
  const st10 = await s.state();
  const white = st10.regions.find((r) => r.white);
  await s.pick(1);
  await s.tapCell(white.labels[0]);
  await sleep(250);
  check(/하얗|white/i.test(await coach(s)), 'white part refuses colour: ' + (await coach(s)));
  await s.tapCell(0);
  await sleep(250);
  check(/그림|picture/i.test(await coach(s)), 'paper says tap the picture: ' + (await coach(s)));
  // Hint with no hints and no coins → popup; buy with coins.
  await goStage(s, 8);
  await s.page.evaluate(() => { const st = window.__ink.store; st.data.hints = 0; st.data.coins = 0; st.commit('wallet'); });
  await boost(s, 3);
  await sleep(600);
  await s.shot(P('03-no-hints'));
  check((await s.page.locator('.popup').count()) > 0, 'out-of-hints popup opens');
  await s.page.evaluate(() => { const st = window.__ink.store; st.data.coins = 500; st.commit('wallet'); });
  await s.tapSel('.popup .btn-gold');
  await sleep(900);
  check((await s.state()).hint === true, 'hint bought with coins and shown');
  await s.shot(P('04-hint'));
  // Pause / menu.
  await s.tapSel('.play .topbar > .icon-btn:last-child');
  await sleep(500);
  await s.shot(P('05-menu'));
  check((await s.page.locator('.popup').count()) > 0, 'menu opens');
  await s.tapSel('.popup .btn-jade');
  await sleep(400);
  // Counted drops (teacup): run out, then wash to refund.
  await goStage(s, 14);
  let st = await s.state();
  check(st.left && st.left[1] === 2, 'teacup starts with 2 red drops');
  const t = await region(s, 't'), hrt = await region(s, 'h'), cup = await region(s, 'a');
  await s.pick(1);
  await s.tapCell(t.labels[0]); await sleep(300);
  await s.tapCell(cup.labels[0]); await sleep(1100);
  st = await s.state();
  check(st.left[1] === 0, 'two red pours use both drops');
  await s.tapCell(hrt.labels[0]); await sleep(300);
  check(/다 썼|No red/i.test(await coach(s)), 'out of red: ' + (await coach(s)));
  await s.shot(P('06-empty'));
  await s.pick(0);
  await s.tapCell(cup.labels[0]); await sleep(700);
  check((await s.state()).left[1] === 1, 'washing the cup gives the red drop back');
  // Secret leftover reminder (sunset): paint all but the sky.
  await goStage(s, 25);
  const info = await s.info();
  const sky = (await s.state()).regions.find((r) => r.secret);
  for (const d of info.solution) {
    const idx = d.y * info.w + d.x;
    if (sky.labels.includes(idx)) continue;
    if ((await s.state()).tool !== d.c) { await s.pick(d.c); await sleep(120); }
    await s.tapCell(idx); await sleep(260);
  }
  await sleep(1300);
  check(/\?/.test(await coach(s)), 'leftover reminder: ' + (await coach(s)));
  await s.shot(P('07-leftover'));
  for (const d of info.solution) {
    const idx = d.y * info.w + d.x;
    if (!sky.labels.includes(idx)) continue;
    if ((await s.state()).tool !== d.c) { await s.pick(d.c); await sleep(120); }
    await s.tapCell(idx); await sleep(500);
  }
  await sleep(500);
  await s.shot(P('08-reveal'));
  await s.waitPhase(['won'], 8000).then(() => check(true, 'secret stage won'), () => check(false, 'secret stage won'));
  check(!s.errors.length, 'no page errors (ko): ' + JSON.stringify(s.errors));
  await s.close();
}

// ---------------------------------------------------------------- reload mid-progress
{
  const s = await open({ device: 'iphone' });
  await s.page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(400);
  await s.tap(195, 600);
  for (let i = 0; i < 2; i++) {
    await s.page.waitForFunction(() => window.__ink.state()?.phase === 'idle', null, { timeout: 15000 });
    await s.cards();
    await s.colour(420);
    await s.waitPhase(['won'], 10000);
    await s.page.waitForSelector('.sheet.open', { timeout: 10000 });
    await sleep(1200);
    await s.tapSel('.sheet.open .sheet-actions .btn-lg');
    await sleep(800);
  }
  // Mid stage 3: one pour, then reload.
  await s.page.waitForFunction(() => window.__ink.state()?.phase === 'idle', null, { timeout: 15000 });
  const inf = await s.info();
  await s.tapCell(inf.solution[0].y * inf.w + inf.solution[0].x);
  await sleep(400);
  await s.page.evaluate(() => window.__ink.store.flush && window.__ink.store.flush());
  await s.page.reload();
  await s.page.waitForFunction(() => !!window.__ink);
  const prog = await s.page.evaluate(() => Object.keys(window.__ink.store.data.levels).length);
  check(prog === 2, 'progress kept after reload: ' + prog + ' cleared');
  await s.page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(500);
  await s.tap(195, 600);
  await sleep(1500);
  const where = await s.page.evaluate(() => window.__ink.screen());
  await s.shot(P('09a-after-reload-home'));
  const cur = await s.page.evaluate(() => document.querySelector('.lv.current')?.textContent || '');
  check(where !== 'title', 'after reload, the start tap opens ' + where + ' (current stage node: ' + cur + ')');
  await s.page.evaluate(() => window.__ink.go('play', { index: 2 }));
  await sleep(800);
  const lv = (await s.state()).level;
  check(lv === 'c03', 'stage 3 opens after reload: ' + lv);
  await s.shot(P('09-after-reload'));
  await s.close();
}

// ---------------------------------------------------------------- EN at 360 px, symbols, daily
{
  const s = await open({ device: 'small', lang: 'en' });
  await s.page.evaluate(() => { window.__ink.clearUpTo(15); });
  for (const n of [5, 10, 12, 14, 16, 25]) {
    // Rule cards in English (fresh `seen`).
    await s.page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
    await sleep(700);
    if (await s.page.locator('.popup').count()) { await s.shot(P('en-card-' + n)); await s.tapSel('.popup .popup-foot .btn'); await sleep(500); }
    await s.shot(P('en-stage-' + n));
  }
  const over = await s.page.evaluate(() => {
    const els = [...document.querySelectorAll('.cchip .nm, .coach, .booster span')];
    return els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth).concat([...document.querySelectorAll('.cchip')].filter((e) => e.getBoundingClientRect().right > window.innerWidth - 4 || e.getBoundingClientRect().left < 4)).map((e) => e.className + ':' + e.textContent);
  });
  check(!over.length, 'no overflow in EN tray at 360px ' + JSON.stringify(over));
  const sizes = await s.page.evaluate(() => [...document.querySelectorAll('.cchip')].map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
  check(sizes.every(([w, h]) => w >= 48 && h >= 48), 'palette chips >= 48px: ' + JSON.stringify(sizes));
  await s.page.evaluate(() => { const st = window.__ink.store; st.data.settings.symbols = true; st.commit('settings'); });
  await s.page.evaluate(() => window.__ink.go('play', { index: 8 }));
  await sleep(600);
  await s.cards();
  const inf = await s.info();
  await s.pick(4); await s.tapCell(inf.solution[2].y * inf.w + inf.solution[2].x); await sleep(900);
  await s.shot(P('en-symbols'));
  // Daily: open today's first puzzle and finish it by autoplay.
  await s.page.evaluate(() => window.__ink.go('daily', undefined, { resetHistory: true }));
  await sleep(800);
  await s.shot(P('en-daily'));
  await s.page.evaluate(() => window.__ink.go('play', { daily: 0 }));
  await sleep(800);
  await s.cards();
  const dinfo = await s.info();
  await s.shot(P('en-daily-play'));
  await s.page.evaluate(() => window.__ink.autoplay(true));
  await s.waitPhase(['won'], 30000).then(() => check(true, 'daily puzzle won (' + dinfo.regions?.[0] + ')'), () => check(false, 'daily puzzle won'));
  check(!s.errors.length, 'no page errors (en): ' + JSON.stringify(s.errors));
  await s.close();
}
// ---------------------------------------------------------------- KO at 360 px
{
  const s = await open({ device: 'small', lang: 'ko' });
  await s.page.evaluate(() => { window.__ink.clearUpTo(29); });
  for (const n of [14, 16, 26]) {
    await s.page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
    await sleep(700);
    if (await s.page.locator('.popup').count()) { await s.shot(P('ko360-card-' + n)); await s.tapSel('.popup .popup-foot .btn'); await sleep(500); }
    await s.shot(P('ko360-stage-' + n));
  }
  const over = await s.page.evaluate(() => [...document.querySelectorAll('.cchip .nm, .coach, .booster span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent).concat([...document.querySelectorAll('.cchip')].filter((e) => e.getBoundingClientRect().right > window.innerWidth - 4).map((e) => e.textContent)));
  check(!over.length, 'no overflow in KO tray at 360px ' + JSON.stringify(over));
  check(!s.errors.length, 'no page errors (ko 360): ' + JSON.stringify(s.errors));
  await s.close();
}
await closeAll();
console.log(bad.length ? 'FAILED ' + bad.length : 'ALL FLOWS OK');
process.exit(bad.length ? 1 : 0);
