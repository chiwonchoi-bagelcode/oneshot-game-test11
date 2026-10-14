/*
 * Builds the comparison set into dist-lab/:
 *   dist-lab/lab/index.html          comparison hub (outside the games)
 *   dist-lab/lab/<v>/                version A–E, store-like build
 *   dist-lab/lab/<v>/debug/          same version with the debug panel (shares that version's save)
 * The original game is not rebuilt here.
 */
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'dist-lab/lab/';
rmSync(ROOT + 'dist-lab', { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const v of ['a', 'b', 'c', 'd', 'e']) {
  for (const debug of [false, true]) {
    const dir = OUT + v + (debug ? '/debug' : '');
    execSync(`npx vite build --outDir "${dir}" --emptyOutDir`, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_VARIANT: v, VITE_DEBUG: debug ? '1' : '' } });
  }
}
cpSync(ROOT + 'lab-hub/index.html', OUT + 'index.html');
console.log('lab built into dist-lab/lab');
