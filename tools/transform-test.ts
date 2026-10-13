import { runSolution, type LevelDef } from '../src/core/sim.ts';
import { transformLevel } from '../src/core/transform.ts';
const L: LevelDef = { id: 't', map: ['..b.#.', '.R....', '~.....'], goal: ['w....G', '......', '..P...'], inks: ['Y', 'B3', 'R'], solution: [{ x: 0, y: 1, t: 0 }, { x: 5, y: 2, t: 1 }, { x: 3, y: 2, t: 2 }] };
const perms: [string, string, string][] = [['R', 'Y', 'B'], ['B', 'R', 'Y'], ['Y', 'B', 'R'], ['R', 'B', 'Y'], ['B', 'Y', 'R'], ['Y', 'R', 'B']];
const base = runSolution(L, L.solution).sim.ascii();
let bad = 0;
for (const p of perms) for (const fx of [false, true]) for (const fy of [false, true]) {
  const T = transformLevel(L, { flipX: fx, flipY: fy, perm: p });
  const s = runSolution(T, T.solution).sim;
  // compare cell-for-cell after undoing flips; compare mixed/non-mixed structure
  for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) {
    const sx = fx ? 5 - x : x, sy = fy ? 2 - y : y;
    const a = base.split('\n')[y][x], b = s.ascii().split('\n')[sy][sx];
    if ((a === '.') !== (b === '.') || (a === a.toUpperCase()) !== (b === b.toUpperCase())) { bad++; }
  }
}
console.log(bad ? 'transform FAIL ' + bad : 'transform ok');
