/*
 * Cross-version acceptance run (lead QA): for each core, from a fresh install —
 *   title → stage 1 … stage 30 through the real result flow (autoplay of the stored solution,
 *   intro cards and unlock popups dismissed like a player), chapter completion, then reload
 *   persistence, save-slot isolation and a few screens. Screenshots: tools/e2e/out/accept/<core>/
 *   node tools/cores/accept.mjs [a b c d e]
 */
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCore, closeAll } from '../e2e/core-lib.mjs';

const cores = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b', 'c', 'd', 'e'];
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(' ')); };

async function dismissPopups(s, tag, shotDir, k0 = 0) {
  let k = k0;
  for (let n = 0; n < 6; n++) {
    if (!(await s.page.locator('.popup').count())) break;
    await s.shot(`${shotDir}/${tag}-popup${k++}.png`);
    const foot = s.page.locator('.popup .popup-foot .btn');
    if (await foot.count()) await foot.first().click();
    else await s.page.locator('.popup').last().click({ position: { x: 20, y: 20 } });
    await sleep(700);
    // reward stages need a second tap to close
    if (await s.page.locator('.popup .reward-items').count()) { await s.page.locator('.popup').last().click({ position: { x: 20, y: 20 } }); await sleep(500); }
  }
  return k;
}

for (const core of cores) {
  const dir = new URL(`../e2e/out/accept/${core}`, import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const s = await openCore(core, { device: 'iphone', lang: 'ko' });
  const t0 = Date.now();
  await s.page.waitForFunction(() => window.__ink.screen() === 'title');
  await sleep(500);
  await s.tap(195, 600);
  await s.page.waitForFunction(() => window.__ink.screen() === 'play', null, { timeout: 15000 });
  const bad = [];
  for (let i = 0; i < 30; i++) {
    const tag = String(i + 1).padStart(2, '0');
    try {
      await s.page.waitForFunction(() => window.__ink.screen() === 'play' && window.__ink.state()?.level, null, { timeout: 15000 });
      await sleep(500);
      await dismissPopups(s, tag + 'a', dir);
      if (i < 3) await s.shot(`${dir}/${tag}-start.png`);
      await s.page.evaluate(() => { window.__ink.timeScale(3); window.__ink.autoplay(true); });
      await s.waitPhase(['won', 'lost'], 60000);
      const st = await s.state();
      if (st.phase !== 'won') { bad.push(tag + ':' + st.phase); await s.shot(`${dir}/${tag}-LOST.png`); }
      await s.page.evaluate(() => window.__ink.autoplay(false));
      await s.page.waitForSelector('.sheet.open', { timeout: 20000 });
      await sleep(1500);
      if (i < 3 || i === 29 || i % 7 === 0) await s.shot(`${dir}/${tag}-result.png`);
      await s.page.locator('.sheet.open .sheet-actions .btn-lg').first().click();
      await sleep(900);
      await dismissPopups(s, tag + 'b', dir);
    } catch (e) {
      bad.push(tag + ':' + String(e.message).slice(0, 80));
      await s.shot(`${dir}/${tag}-ERROR.png`);
      break;
    }
  }
  const save = await s.page.evaluate(() => ({ keys: Object.keys(localStorage), cleared: Object.values(window.__ink.store.data.levels).filter((r) => r.c).length, coins: window.__ink.store.data.coins }));
  log(`[${core}] 30-stage flow: ${30 - bad.length}/30 ok in ${Math.round((Date.now() - t0) / 1000)}s ${bad.length ? 'FAIL ' + bad.join(', ') : ''}`);
  log(`[${core}] save keys: ${save.keys.join(', ')} · cleared ${save.cleared} · coins ${save.coins}`);
  await s.page.evaluate(() => window.__ink.store.flush());
  await s.page.reload();
  await s.page.waitForFunction(() => !!window.__ink);
  const after = await s.page.evaluate(() => Object.values(window.__ink.store.data.levels).filter((r) => r.c).length);
  log(`[${core}] after reload: cleared ${after}`);
  await s.page.evaluate(() => window.__ink.hideDebug());
  await s.page.evaluate(() => window.__ink.go('journey', undefined, { resetHistory: true }));
  await s.shot(`${dir}/journey.png`);
  await s.page.evaluate(() => window.__ink.go('chapter', { chapter: 0 }));
  await s.shot(`${dir}/chapter.png`);
  log(`[${core}] errors: ${JSON.stringify(s.errors.slice(0, 5))}`);
  await s.close();
}
await closeAll();
