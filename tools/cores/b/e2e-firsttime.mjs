/*
 * Core B: a first-time player who makes the usual mistakes (stage 3 dead end, then backing up;
 * stage 6 painting only yellow first). Screenshots: tools/cores/b/out/firsttime/.
 *   node tools/cores/b/e2e-firsttime.mjs   (E2E_NO_BUILD=1 to reuse dist-test-b)
 */
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCore, closeAll } from '../../e2e/core-lib.mjs';
const OUT = new URL('./out/firsttime/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const s = await openCore('b', { device: 'small', lang: process.argv[2] || 'ko' });
const { page } = s;
const go = async (n) => { await page.evaluate((i) => { window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1); await sleep(600); while (await page.locator('.popup').count()) { await page.locator('.popup .popup-foot .btn').first().click(); await sleep(400); } };
try {
  await go(3);
  const I = (x, y) => y * 3 + x;
  await s.dragCells([I(0, 0), I(1, 0), I(1, 1), I(1, 2), I(0, 2), I(0, 1)], 90);
  await sleep(400);
  await s.shot(OUT + '03-stuck.png');
  console.log('stuck state', JSON.stringify(await s.state()));
  // back up three cells and finish properly
  await s.dragCells([I(0, 1), I(0, 2), I(1, 2), I(1, 1)], 90);
  await s.dragCells([I(1, 1), I(0, 1), I(0, 2), I(1, 2), I(2, 2), I(2, 1), I(2, 0)], 90);
  await sleep(300);
  await s.shot(OUT + '03-fixed.png');
  console.log('fixed', JSON.stringify(await s.state()));
  await sleep(2500);
  await s.shot(OUT + '03-result-noseal.png');
  await go(6);
  const J = (x, y) => y * 5 + x;
  await s.dragCells([J(0, 0), J(1, 0), J(2, 0), J(3, 0), J(4, 0)], 90);
  await sleep(300);
  await s.shot(OUT + '06-half.png');
  await go(1);
  await sleep(1200);
  await s.shot(OUT + '01-guide.png');
  await s.dragCells([0, 1, 2], 120);
  await sleep(500);
  await s.shot(OUT + '01-guide-keep.png');
  console.log('errors', JSON.stringify(s.errors));
} finally { await closeAll(); }
