/*
 * Core D iteration helper: screenshots of stages (start + solved) against the dev server.
 *   node tools/cores/d/look-stages.mjs 2 3 4      (1-based stage numbers; default all)
 */
import { openDev, dismissPopups } from './dev-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
const O = new URL('./out/stages/', import.meta.url).pathname;
mkdirSync(O, { recursive: true });
const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const s = await openDev({ device: process.argv.includes('--small') ? 'small' : 'iphone', lang: process.argv.includes('--en') ? 'en' : 'ko' });
const total = await s.page.evaluate(() => window.__ink.levels.length);
const list = nums.length ? nums : [...Array(total).keys()].map((i) => i + 1);
for (const n of list) {
  const tag = String(n).padStart(2, '0');
  await s.page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
  await sleep(700);
  await dismissPopups(s, O + tag + '-card.png');
  await sleep(300);
  await s.shot(O + tag + '-a.png');
  await s.page.evaluate(() => { window.__ink.timeScale(2); window.__ink.autoplay(true); });
  try { await s.page.waitForFunction(() => ['won', 'lost'].includes(window.__ink.state().phase), null, { timeout: 30000 }); } catch { console.log(tag, 'timeout'); }
  await sleep(500);
  await s.shot(O + tag + '-b.png');
  const st = await s.state();
  console.log(tag, st.phase, 'tick', st.tick);
  await s.page.evaluate(() => { window.__ink.autoplay(false); window.__ink.timeScale(1); });
}
if (s.errors.length) console.log(s.errors.join('\n'));
await s.close();
