// Joins screenshots side by side (cropped) for quick review: node tools/cores/c/strip.mjs out.png a.png b.png …
import { readFileSync } from 'node:fs';
import { getBrowser, closeAll } from '../../e2e/core-lib.mjs';
const [out, ...files] = process.argv.slice(2);
const top = +(process.env.TOP || 0.17), bot = +(process.env.BOT || 0.86), W = +(process.env.W || 300);
const b = await getBrowser();
const p = await b.newPage({ viewport: { width: W * files.length, height: 100 } });
const imgs = files.map((f) => 'data:image/png;base64,' + readFileSync(f).toString('base64'));
await p.setContent(`<body style="margin:0;display:flex;background:#fff">${imgs.map((src) => `<div style="width:${W}px;overflow:hidden;position:relative"><img src="${src}" style="width:${W}px;display:block;margin-top:calc(-${top} * ${W}px * 2532 / 1170)"></div>`).join('')}</body>`);
await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
const h = Math.round(W * 2532 / 1170 * (bot - top));
await p.setViewportSize({ width: W * files.length, height: h });
await p.screenshot({ path: out });
await closeAll();
