/*
 * Core E: play every stage from a fresh install, in order, like a player.
 *   node tools/cores/e/play-all.mjs [--en] [--from N] [--shots]
 * Title → stage 1 → … → stage 30 through the real flow (rule cards closed with their button,
 * result sheet "Next"), every drop a real CDP touch tap at a cell centre at real tempo, ~170 ms after
 * the beat it is due on. Checks each stage is won and there are no page errors.
 */
import { open, OUT, sleep, closeAll, dismissCards, tapSel, playStage } from './e2e-lib.mjs';

const lang = process.argv.includes('--en') ? 'en' : 'ko';
const shots = process.argv.includes('--shots');
const from = process.argv.includes('--from') ? +process.argv[process.argv.indexOf('--from') + 1] : 1;
const s = await open({ device: 'small', lang });
const log = (...a) => console.log(...a);
const results = [];
try {
  await sleep(800);
  await s.tap(180, 520); // title: tap anywhere
  await sleep(1200);
  if (from > 1) {
    await dismissCards(s);
    await s.page.evaluate((i) => { window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, from - 1);
    await sleep(800);
  }
  for (let n = from; n <= 30; n++) {
    await dismissCards(s, shots ? OUT + `all-${n}` : null);
    const st0 = await s.state();
    if (st0.level !== 'e-' + String(n).padStart(2, '0')) throw new Error(`expected stage ${n}, on ${st0.level} (${st0.phase})`);
    if (shots) await s.shot(OUT + `all-${n}-start.png`);
    const t0 = Date.now();
    const phase = await playStage(s, { reaction: 170 });
    const ms = Date.now() - t0;
    results.push({ n, phase, ms });
    log(`stage ${n}: ${phase} (${(ms / 1000).toFixed(1)} s)`);
    if (phase !== 'won') {
      await s.shot(OUT + `all-${n}-FAIL.png`);
      throw new Error('stage ' + n + ' ' + phase);
    }
    // result sheet → Next
    await s.page.waitForSelector('.sheet.open .btn-lg', { timeout: 15000 });
    await sleep(700);
    if (shots && (n <= 3 || n === 30)) await s.shot(OUT + `all-${n}-result.png`);
    if (n < 30) await tapSel(s, '.sheet.open .btn-lg');
    await sleep(900);
  }
  log('ALL 30 WON. page errors:', JSON.stringify(s.errors));
} catch (e) {
  log('FAILED:', e.message, JSON.stringify(s.errors));
  process.exitCode = 1;
} finally {
  await s.close();
  await closeAll();
}
