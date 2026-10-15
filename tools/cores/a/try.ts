// Quick design loop: node tools/cores/a/try.ts [id...]  — prints the report of the specs.
import { build } from './lib.ts';
import { SPECS } from './design.ts';

const want = process.argv.slice(2);
for (const s of SPECS) {
  if (want.length && !want.some((w) => s.id.includes(w))) continue;
  const b = build(s);
  console.log(b.report + '\n');
}
