// Every picture: start state and finished state (via the debug solve). node tools/cores/c/gallery.mjs [from] [to]
import { open, OUT, sleep, closeAll } from './lib.mjs';
const from = +(process.argv[2] || 1), to = +(process.argv[3] || 30);
const s = await open({ device: 'iphone', lang: process.env.LANG2 || 'ko' });
await s.page.evaluate(() => { window.__ink.clearUpTo(29); window.__ink.store.data.seen = { 'mech.c_mix': 1, 'mech.c_white': 1, 'mech.c_brown': 1, 'mech.c_limit': 1, 'mech.c_link': 1, 'mech.c_secret': 1 }; });
for (let n = from; n <= to; n++) {
  await s.page.evaluate((i) => window.__ink.go('play', { index: i }), n - 1);
  await sleep(700);
  await s.cards();
  const id = String(n).padStart(2, '0');
  await s.page.screenshot({ path: `${OUT}g-${id}-a.png` });
  await s.page.evaluate(() => window.__ink.solveNow());
  await s.waitPhase(['won'], 8000).catch(() => console.log('no win', n));
  await sleep(2900);
  await s.page.screenshot({ path: `${OUT}g-${id}-b.png` });
}
console.log('errors', s.errors);
await s.close(); await closeAll();
