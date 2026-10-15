// Screenshot loop for design work: A_BASE=http://localhost:5401/ node tools/cores/a/look.mjs <stage> [lang]
import { mkdirSync } from 'node:fs';
import { openA, closeA, closePopups, SHOTS, sleep } from './pw.mjs';

const n = +(process.argv[2] || 1);
const lang = process.argv[3] || 'ko';
mkdirSync(SHOTS, { recursive: true });
const s = await openA({ lang, device: process.env.DEV || 'iphone' });
await s.page.evaluate((i) => { window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
await sleep(700);
await closePopups(s, `${SHOTS}/look-${n}`);
await sleep(400);
await s.shot(`${SHOTS}/look-${n}-start.png`);
const info = await s.info();
// Hold-preview on the first solution cell, screenshot mid-hold, then release.
const d0 = info.solution[0];
const p = await s.center(d0.y * info.w + d0.x);
await s.touch('touchStart', [p]);
await sleep(500);
await s.shot(`${SHOTS}/look-${n}-hold.png`);
await s.touch('touchEnd', []);
await sleep(200);
await s.shot(`${SHOTS}/look-${n}-spread.png`);
await sleep(900);
for (const d of info.solution.slice(1)) {
  await s.tapCell(d.y * info.w + d.x);
  await sleep(250);
  await s.shot(`${SHOTS}/look-${n}-mid.png`);
  await sleep(900);
}
await sleep(500);
console.log(JSON.stringify(await s.state()));
await sleep(1500);
await s.shot(`${SHOTS}/look-${n}-end.png`);
console.log('errors', s.errors);
await s.close();
await closeA();
