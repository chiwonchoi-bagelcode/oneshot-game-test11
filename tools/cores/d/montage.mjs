/* Joins screenshots into one image for review: node montage.mjs out.png cols scale img1 img2 ... */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, cols, scale, ...imgs] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
const html = `<body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(${cols},auto);gap:4px">` + imgs.map((f) => `<div style="font:12px sans-serif"><img style="width:${Math.round(390 * scale)}px;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}">${f.split('/').pop()}</div>`).join('') + '</body>';
await p.setContent(html);
await p.waitForTimeout(200);
await p.screenshot({ path: out, fullPage: true });
await b.close();
