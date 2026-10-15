/*
 * Core D dev/test config: the same app, but the other comparison cores (built in parallel by
 * other people) are replaced by tiny stubs so their half-finished files can't break this build.
 *   VITE_CORE=d VITE_DEBUG=1 npx vite --config tools/cores/d/vite.config.mjs --port 5404
 *   VITE_CORE=d VITE_DEBUG=1 npx vite build --config tools/cores/d/vite.config.mjs --outDir dist-test-d
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STUBS = {
  'core.ts': "import { TimingCore } from '/src/play/timing-core.ts'; export function createCore(h) { return new TimingCore(h); }",
  'levels.ts': 'export const LEVELS = [];',
  'strings.ts': 'export default { ko: {}, en: {} };',
};

export default defineConfig({
  root: ROOT,
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  server: { host: true, watch: { ignored: ['**/tools/**', '**/dist*/**', '**/src/cores/[abce]/**'] } },
  plugins: [{
    name: 'stub-other-cores',
    enforce: 'pre',
    resolveId(src, importer) {
      const m = /\/cores\/([abce])\/(core|levels|strings)\.ts$/.exec(src);
      if (m && importer && /src\/(play|levels|i18n)/.test(importer)) return '\0stub-' + m[1] + '-' + m[2] + '.ts';
      return null;
    },
    load(id) {
      const m = /^\0stub-([abce])-(core|levels|strings)\.ts$/.exec(id);
      return m ? STUBS[m[2] + '.ts'] : null;
    },
  }],
});
