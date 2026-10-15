// Captures a pour as a frame sequence: node tools/cores/c/frames.mjs <stageIndex> [count] [everyMs]
import { open, OUT, sleep, closeAll } from './lib.mjs';
const idx = +(process.argv[2] || 0), N = +(process.argv[3] || 6), every = +(process.argv[4] || 90);
const s = await open({ device: 'iphone' });
await s.page.evaluate(() => { window.__ink.store.data.seen = { 'mech.c_mix': 1, 'mech.c_white': 1, 'mech.c_brown': 1, 'mech.c_limit': 1, 'mech.c_link': 1, 'mech.c_secret': 1 }; window.__ink.clearUpTo(40); });
await s.page.evaluate((i) => window.__ink.go('play', { index: i }), idx);
await sleep(800);
await s.cards();
const info = await s.info();
const steps = +(process.env.STEPS || 99);
let k = 0;
for (const d of info.solution.slice(0, steps)) {
  const st = await s.state();
  if (st.tool !== d.c) { await s.pick(d.c); await sleep(200); }
  await s.tapCell(d.y * info.w + d.x);
  if (k === +(process.env.SEQ ?? 0)) for (let f = 0; f < N; f++) { await s.page.screenshot({ path: `${OUT}f-${idx}-${f}.png` }); await sleep(every); }
  await sleep(700);
  k++;
}
await sleep(800);
await s.page.screenshot({ path: `${OUT}f-${idx}-end.png` });
if (process.env.WIN) { await s.waitPhase(['won']); await sleep(2600); await s.page.screenshot({ path: `${OUT}f-${idx}-won.png` }); }
console.log(s.errors);
await s.close(); await closeAll();
