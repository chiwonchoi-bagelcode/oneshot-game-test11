// Rules book screenshot (all rules learned):  node tools/cores/a/rulesbook.mjs [ko|en]
import { openA, closeA, sleep, SHOTS } from './pw.mjs';
const lang = process.argv[2] || 'ko';
const s = await openA({ lang, device: 'small' });
await s.page.evaluate(() => { window.__ink.clearUpTo(29); window.__ink.go('journey', undefined, { resetHistory: true }); });
await sleep(500);
await s.page.locator('.screen.active .topbar .icon-btn').first().click();
await sleep(500);
const how = s.page.locator('.popup button', { hasText: /방법|How to play|규칙|Rules/ }).first();
if (await how.count()) { await how.click(); await sleep(700); }
await s.shot(`${SHOTS}/rulesbook-${lang}.png`);
await s.page.evaluate(() => { const b = document.querySelector('.rules-pop .popup-body, .popup .popup-body'); if (b) b.scrollTop = b.scrollHeight; });
await sleep(400);
await s.shot(`${SHOTS}/rulesbook-${lang}-end.png`);
console.log(s.errors);
await s.close(); await closeA();
