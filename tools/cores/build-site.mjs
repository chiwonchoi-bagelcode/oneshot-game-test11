/*
 * Builds the core-comparison site: site-cores/cores/{index.html, a/, b/, c/, d/, e/}.
 * Each version is a production build (no debug panel) with its own save slot. The hub page lives
 * outside the games. The original game is NOT rebuilt here (it stays at the site root as deployed).
 *   node tools/cores/build-site.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = ROOT + 'site-cores/cores/';
rmSync(ROOT + 'site-cores', { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const c of ['a', 'b', 'c', 'd', 'e']) {
  execSync(`npx vite build --outDir site-cores/cores/${c} --emptyOutDir`, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_CORE: c, VITE_DEBUG: '' } });
}
copyFileSync(ROOT + 'tools/cores/hub/index.html', OUT + 'index.html');
writeFileSync(ROOT + 'site-cores/.nojekyll', '');
console.log('built', OUT);
