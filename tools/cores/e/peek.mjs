/* Design peek: node tools/cores/e/peek.mjs <stage> [afterDrops] [--en] — screenshots a stage before and after its first drops. */
import { open, OUT, sleep, closeAll, dismissCards } from './e2e-lib.mjs';
const n = +process.argv[2] || 1;
const upto = +(process.argv[3] ?? 1);
const s = await open({ device: 'small', lang: process.argv.includes('--en') ? 'en' : 'ko' });
await s.page.evaluate((i) => { if (i > 0) window.__ink.clearUpTo(i - 1); window.__ink.go('play', { index: i }); }, n - 1);
await s.shot(OUT + `peek-${n}-0.png`);
await sleep(600);
await dismissCards(s, OUT + `peek-${n}`);
await s.shot(OUT + `peek-${n}-a.png`);
if (process.argv.includes('--symbols')) { await s.page.evaluate(() => { window.__ink.store.data.settings.symbols = true; window.__ink.store.commit('settings'); }); await sleep(300); await s.shot(OUT + `peek-${n}-sym-a.png`); }
const info = await s.info();
for (let k = 0; k < Math.min(upto, info.solution.length); k++) {
  const d = info.solution[k];
  for (;;) { const st = await s.state(); if (st.tick >= d.t) break; await sleep(20); }
  await sleep(170);
  await s.tapCell(d.y * info.w + d.x);
  await sleep(250);
  await s.shot(OUT + `peek-${n}-d${k + 1}.png`);
}
await sleep(1000);
await s.shot(OUT + `peek-${n}-z.png`);
console.log(JSON.stringify(await s.state()), s.errors);
await s.close();
await closeAll();
