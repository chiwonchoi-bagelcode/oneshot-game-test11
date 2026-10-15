// Quick look: first-time flow screenshots. DEV_URL=http://localhost:5403/ node tools/cores/c/explore.mjs [stages]
import { open, OUT, sleep, closeAll } from './lib.mjs';
const N = +(process.argv[2] || 3);
const s = await open({ device: process.env.DEVICE || 'iphone', lang: process.env.LANG2 || 'ko' });
const P = (n) => OUT + 'x-' + n;
await s.shot(P('00-title.png'));
await s.page.waitForFunction(() => window.__ink.screen() === 'title');
await sleep(300);
await s.tap(195, 600);
for (let i = 1; i <= N; i++) {
  const id = String(i).padStart(2, '0');
  await s.page.waitForFunction(() => window.__ink.screen() === 'play', null, { timeout: 15000 });
  await s.cards(P(id));
  await sleep(500);
  await s.shot(P(id + '-a-start.png'));
  const info = await s.info();
  let k = 0;
  for (const d of info.solution) {
    const st = await s.state();
    if (st.tool !== d.c) { await s.pick(d.c); await sleep(250); if (k === 0) await s.shot(P(id + '-b-picked.png')); }
    await s.tapCell(d.y * info.w + d.x);
    await sleep(140);
    if (k === 0) await s.shot(P(id + '-c-pouring.png'));
    await sleep(500);
    k++;
  }
  await s.shot(P(id + '-d-end.png'));
  await s.waitPhase(['won'], 15000).catch(async () => console.log('not won', id, JSON.stringify(await s.state()), await s.page.evaluate(() => window.__ink.screen())));
  await s.page.waitForSelector('.sheet.open', { timeout: 15000 });
  await sleep(1500);
  await s.shot(P(id + '-e-result.png'));
  await s.tapSel('.sheet.open .sheet-actions .btn-lg');
  await sleep(700);
  for (let k2 = 0; k2 < 4; k2++) {
    if (!(await s.page.locator('.popup').count())) break;
    const btn = s.page.locator('.popup .popup-foot .btn').first();
    if (await btn.count()) await btn.click(); else break;
    await sleep(600);
  }
}
console.log('errors', s.errors);
await s.close();
await closeAll();
