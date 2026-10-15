// Contact sheet of screenshots: node tools/cores/b/montage.mjs out.png a.png b.png ... (4 per row)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, ...files] = process.argv.slice(2);
const cols = +(process.env.COLS || 4), w = +(process.env.W || 300);
const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${f.split('/').pop()}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px">${imgs}<style>figure{margin:0}img{width:${w}px;display:block}figcaption{color:#fff;font:12px sans-serif}</style></body></html>`;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: cols * (w + 6) + 6, height: 400 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
