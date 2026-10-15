// Contact sheet of all 30 stages (start picture + solved picture):  node tools/cores/a/contact.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { openA, closeA, closePopups, sleep, SHOTS } from './pw.mjs';

const OUT = SHOTS + '/contact';
mkdirSync(OUT, { recursive: true });
const s = await openA({ lang: 'ko', device: 'iphone', notch: false });
await s.page.evaluate(() => { window.__ink.clearUpTo(29); const st = window.__ink.store; st.data.seen = Object.fromEntries(['a_drop','a_amount','a_mix','a_walls','a_clean','a_three'].map((k) => ['mech.' + k, 1])); });
const cells = [];
for (let i = 0; i < 30; i++) {
  await s.page.evaluate((k) => window.__ink.go('play', { index: k }), i);
  await sleep(500);
  await closePopups(s);
  await sleep(200);
  const box = await s.page.locator('.screen.active .board-wrap').boundingBox();
  const tray = await s.page.locator('.screen.active .a-tray').boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: tray.y + tray.height - box.y };
  await s.page.screenshot({ path: `${OUT}/s${i + 1}-a.png`, clip });
  await s.page.evaluate(() => window.__ink.solveNow());
  await sleep(450);
  await s.page.screenshot({ path: `${OUT}/s${i + 1}-b.png`, clip: { ...clip, height: box.height } });
  await s.page.waitForSelector('.sheet.open', { timeout: 10000 }).catch(() => {});
  await sleep(300);
  cells.push(i + 1);
}
await s.close();
// Sheet: 6 stages per row, start + solved side by side.
const img = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const html = `<html><body style="margin:0;background:#eee;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:6px">${cells.map((n) => `<div style="background:#fff;padding:4px"><b>${n}</b><div style="display:flex;gap:4px"><img src="${img(`${OUT}/s${n}-a.png`)}" style="width:50%;align-self:flex-start"><img src="${img(`${OUT}/s${n}-b.png`)}" style="width:50%;align-self:flex-start"></div></div>`).join('')}</div></body></html>`;
writeFileSync(`${OUT}/sheet.html`, html);
const s2 = await openA({ device: 'iphone' });
await s2.page.setViewportSize({ width: 1500, height: 1500 });
await s2.page.goto('file://' + OUT + '/sheet.html');
await sleep(500);
for (const [k, y] of [[1, 0], [2, 1]]) {
  await s2.page.evaluate((yy) => window.scrollTo(0, yy * document.body.scrollHeight / 2), y);
  await sleep(200);
  await s2.page.screenshot({ path: `${OUT}/sheet-${k}.png`, fullPage: false });
}
await s2.page.screenshot({ path: `${OUT}/sheet-full.png`, fullPage: true });
await s2.close();
await closeA();
console.log('wrote', OUT);
