/*
 * Core B level generator: turns stage designs (tools/cores/b/stages.ts — the intended strokes)
 * into src/cores/b/levels.ts. The picture is exactly what the strokes paint: every painted cell
 * gets the mixed colour of the strokes over it, everything else in the bounding box is a hole
 * (or a stone where the design says so). The intended strokes become the stored solution.
 *
 *   node tools/cores/b/gen.ts            write levels.ts and print the analysis table
 *   node tools/cores/b/gen.ts --dry      only print
 */
import { writeFileSync } from 'node:fs';
import { STAGES, type StageDesign } from './stages.ts';
import { analyze } from './solver.ts';
import type { LevelDef } from '../../../src/core/sim.ts';

const BIT: Record<string, number> = { r: 1, y: 2, b: 4 };
const CH: Record<number, string> = { 1: 'R', 2: 'Y', 3: 'O', 4: 'B', 5: 'P', 6: 'G', 7: 'K' };
const DIR: Record<string, [number, number]> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

export function build(d: StageDesign): LevelDef {
  if (d.pic) return buildPic(d);
  const paths = d.strokes.map(([c, x, y, moves]) => {
    const p: [number, number][] = [[x, y]];
    for (const m of moves.replace(/\s+/g, '')) {
      const v = DIR[m];
      if (!v) throw new Error(d.id + ': bad move ' + m);
      const [px, py] = p[p.length - 1];
      p.push([px + v[0], py + v[1]]);
    }
    return { c: BIT[c], ch: c, p };
  });
  let w = d.w || 0, h = d.h || 0;
  for (const s of paths) for (const [x, y] of s.p) {
    if (x < 0 || y < 0) throw new Error(d.id + ': negative coordinate');
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  for (const [x, y] of d.stones || []) { w = Math.max(w, x + 1); h = Math.max(h, y + 1); }
  const ink = new Array(w * h).fill(0);
  const srcAt = new Map<number, string>();
  for (const s of paths) {
    const seen = new Set<number>();
    for (const [x, y] of s.p) {
      const i = y * w + x;
      if (seen.has(i)) throw new Error(`${d.id}: ${s.ch} stroke crosses itself at ${x},${y}`);
      seen.add(i);
      if (ink[i] & s.c) throw new Error(`${d.id}: two ${s.ch} strokes overlap at ${x},${y}`);
      ink[i] |= s.c;
    }
    const [sx, sy] = s.p[0];
    srcAt.set(sy * w + sx, s.ch);
  }
  for (const [i, ch] of srcAt) if (ink[i] !== BIT[ch]) throw new Error(`${d.id}: another stroke runs over the ${ch} drop`);
  const stones = new Set((d.stones || []).map(([x, y]) => y * w + x));
  const map: string[] = [], goal: string[] = [];
  for (let y = 0; y < h; y++) {
    let mr = '', gr = '';
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (stones.has(i)) {
        if (ink[i]) throw new Error(`${d.id}: stroke over a stone at ${x},${y}`);
        mr += '#'; gr += '.';
      } else if (ink[i]) {
        mr += srcAt.get(i) || '.';
        gr += CH[ink[i]];
      } else { mr += ' '; gr += '.'; }
    }
    map.push(mr);
    goal.push(gr);
  }
  // Strokes in source (reading) order.
  const ordered = paths.slice().sort((a, b) => (a.p[0][1] * w + a.p[0][0]) - (b.p[0][1] * w + b.p[0][0]));
  const def: LevelDef = {
    id: d.id,
    map,
    goal,
    inks: ordered.map((s) => s.ch.toUpperCase()),
    solution: ordered.map((s) => ({ x: s.p[0][0], y: s.p[0][1], t: 0, c: s.c })),
    strokes: ordered.map((s) => s.p.map(([x, y]) => ({ x, y }))),
  };
  if (d.intro) def.intro = d.intro;
  if (d.guided) def.guided = true;
  if (d.tag) def.tag = d.tag;
  if (d.coach) def.coach = d.coach;
  return def;
}

/** A design drawn as a picture (map + goal): the solver supplies the stored strokes. */
function buildPic(d: StageDesign): LevelDef {
  const { map, goal } = d.pic!;
  const def: LevelDef = { id: d.id, map, goal, inks: [], solution: [] };
  const r = analyze(def, 50);
  if (!r.example) throw new Error(d.id + ': picture has no solution');
  const w = map[0].length;
  const ex = r.example;
  def.inks = ex.map((p) => ({ r: 'R', y: 'Y', b: 'B' } as Record<string, string>)[map[Math.floor(p[0] / w)][p[0] % w]]);
  def.solution = ex.map((p, k) => ({ x: p[0] % w, y: Math.floor(p[0] / w), t: 0, c: ({ R: 1, Y: 2, B: 4 } as Record<string, number>)[def.inks[k]] }));
  def.strokes = ex.map((p) => p.map((i) => ({ x: i % w, y: Math.floor(i / w) })));
  if (d.intro) def.intro = d.intro;
  if (d.guided) def.guided = true;
  if (d.tag) def.tag = d.tag;
  if (d.coach) def.coach = d.coach;
  return def;
}

function score(r: ReturnType<typeof analyze>): number {
  // 0..100: how much planning the stage asks for (low random-fill success, long strokes).
  const g = Math.max(1e-4, r.greedy);
  return Math.max(1, Math.min(100, Math.round(-Math.log10(g) * 22 + r.cells * 0.35)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry');
  const defs: LevelDef[] = [];
  const rows: string[] = [];
  STAGES.forEach((d, n) => {
    const def = build(d);
    const r = analyze(def);
    def.diff = score(r);
    defs.push(def);
    rows.push(`${String(n + 1).padStart(2)} ${d.id.padEnd(4)} ${(r.w + 'x' + r.h).padEnd(5)} cells=${String(r.cells).padStart(2)} src=${def.inks.join('')} sol=${String(r.solutions).padStart(6)}${r.capped ? '+' : ' '} greedy=${(r.greedy * 100).toFixed(1).padStart(5)}% diff=${String(def.diff).padStart(3)} ${d.intro || ''} ${d.name}`);
  });
  console.log(rows.join('\n'));
  if (!dry) {
    const body = defs.map((d) => '  ' + JSON.stringify(d)).join(',\n');
    const src = `// Core B: the 30 stages (tutorial included). Generated by tools/cores/b/gen.ts from
// tools/cores/b/stages.ts — edit the designs there and re-run the generator.
import type { LevelDef } from '../../core/sim.ts';
export const LEVELS: LevelDef[] = [
${body},
];
`;
    writeFileSync(new URL('../../../src/cores/b/levels.ts', import.meta.url), src);
    console.log('wrote src/cores/b/levels.ts');
  }
}
