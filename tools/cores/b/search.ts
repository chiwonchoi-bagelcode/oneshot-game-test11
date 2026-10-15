/*
 * Puzzle search for stage design: random strokes inside a w×h box; the picture is what they paint.
 * Keeps candidates whose box is (mostly) filled, prints the best by "few solutions, low random
 * success, enough mixing" with the moves to paste into stages.ts.
 *
 *   node tools/cores/b/search.ts <w> <h> <drops e.g. yb or bby> [tries] [minFill 0..1] [seed]
 */
import { analyze } from './solver.ts';
import type { LevelDef } from '../../../src/core/sim.ts';

const [W, H] = [+process.argv[2], +process.argv[3]];
const drops = process.argv[4].split('');
const tries = +(process.argv[5] || 20000);
const minFill = +(process.argv[6] || 0.85);
let seed = +(process.argv[7] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const BIT: Record<string, number> = { r: 1, y: 2, b: 4 };
const CH: Record<number, string> = { 1: 'R', 2: 'Y', 3: 'O', 4: 'B', 5: 'P', 6: 'G', 7: 'K' };
const D = [[0, -1, 'U'], [0, 1, 'D'], [-1, 0, 'L'], [1, 0, 'R']] as const;

interface Cand { score: number; def: LevelDef; moves: string[]; sol: number; greedy: number }
const best: Cand[] = [];
const seen = new Set<string>();
for (let t = 0; t < tries; t++) {
  const ink = new Array(W * H).fill(0);
  const srcs: number[] = [];
  const moves: string[] = [];
  let ok = true;
  for (const d of drops) {
    const c = BIT[d];
    // start on an unpainted cell
    let s = -1;
    for (let k = 0; k < 50 && s < 0; k++) { const i = Math.floor(rnd() * W * H); if (!ink[i]) s = i; }
    if (s < 0) { ok = false; break; }
    const path = [s];
    const mine = new Set([s]);
    let mv = '';
    const len = 3 + Math.floor(rnd() * (W * H * 0.7));
    for (let j = 0; j < len; j++) {
      const cur = path[path.length - 1], x = cur % W, y = (cur - x) / W;
      const opts = D.filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
        const n = ny * W + nx;
        return !mine.has(n) && !(ink[n] & c) && !srcs.includes(n);
      });
      if (!opts.length) break;
      // Prefer unpainted cells a little, so the box fills.
      const fresh = opts.filter(([dx, dy]) => !ink[(y + dy) * W + x + dx]);
      const pick = (fresh.length && rnd() < 0.75 ? fresh : opts)[Math.floor(rnd() * (fresh.length && rnd() < 0.75 ? fresh.length : opts.length)) % (fresh.length && rnd() < 0.75 ? fresh.length : opts.length)] || opts[0];
      const n = (y + pick[1]) * W + x + pick[0];
      path.push(n); mine.add(n); mv += pick[2];
    }
    if (path.length < 3) { ok = false; break; }
    for (const i of path) ink[i] |= c;
    srcs.push(s);
    moves.push(`['${d}', ${s % W}, ${Math.floor(s / W)}, '${mv}']`);
  }
  if (!ok) continue;
  // sources must stay pure
  if (srcs.some((s, k) => ink[s] !== BIT[drops[k]])) continue;
  const filled = ink.filter(Boolean).length;
  if (filled / (W * H) < minFill) continue;
  if (ink.some((v) => v === 7)) continue;
  const mixed = ink.filter((v) => v && ![1, 2, 4].includes(v)).length;
  const map: string[] = [], goal: string[] = [];
  for (let y = 0; y < H; y++) {
    let m = '', g = '';
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = srcs.indexOf(i);
      m += k >= 0 ? drops[k] : ink[i] ? '.' : ' ';
      g += ink[i] ? CH[ink[i]] : '.';
    }
    map.push(m); goal.push(g);
  }
  const key = goal.join('/');
  if (seen.has(key)) continue;
  seen.add(key);
  const def: LevelDef = { id: 's' + t, map, goal, inks: [], solution: [] };
  const r = analyze(def, 2000);
  if (!r.solutions) continue;
  const score = -Math.log10(Math.max(1e-4, r.greedy)) * 2 - Math.log10(r.solutions) * 1.5 + Math.min(mixed, 8) * 0.25 + (filled === W * H ? 1 : 0);
  best.push({ score, def, moves, sol: r.solutions, greedy: r.greedy });
  best.sort((a, b) => b.score - a.score);
  if (best.length > 8) best.pop();
}
for (const b of best) {
  console.log(`score=${b.score.toFixed(2)} sol=${b.sol} greedy=${(b.greedy * 100).toFixed(1)}%`);
  b.def.map.forEach((m, y) => console.log('  ' + m.replace(/ /g, '·') + '   ' + b.def.goal[y].replace(/\./g, '·')));
  console.log('  strokes: [' + b.moves.join(', ') + ']');
}
