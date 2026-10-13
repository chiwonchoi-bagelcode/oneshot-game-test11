import { Sim, runSolution, parseLevel, type LevelDef } from '../src/core/sim.ts';

let fails = 0;
function check(name: string, cond: boolean, extra = '') { if (!cond) { fails++; console.log('FAIL', name, extra); } else console.log('ok  ', name); }
function lv(map: string[], goal: string[], inks: string[]): LevelDef { return { id: 't', map, goal, inks, solution: [] }; }

{ // even distance meets on a cell
  const L = lv(['.......', '.......', '.......'], ['.......', '...G...', '.......'], ['Y', 'B']);
  const r = runSolution(L, [{ x: 0, y: 1, t: 0 }, { x: 6, y: 1, t: 0 }]);
  check('even mix', r.ok, r.sim.ascii());
}
{ // odd distance only touches
  const s = new Sim(lv(['......'], ['......'], ['Y', 'B']));
  s.drop(0); s.drop(5);
  let touched = false;
  while (!s.settled()) { const ev = s.step(); if (ev.some(e => e.type === 'touch')) touched = true; }
  check('odd touch no mix', s.ascii() === 'yyybbb' && touched, s.ascii());
}
{ // delay shifts meeting to a cell
  const r = runSolution(lv(['......'], ['...G..'], ['Y', 'B']), [{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 1 }]);
  check('delay mix', r.ok, r.sim.ascii());
}
{ // range
  const r = runSolution(lv(['.......'], ['w.....w'], ['R2']), [{ x: 3, y: 0, t: 0 }]);
  check('range 2', r.ok && r.sim.ascii() === 'wrrrrrw', r.sim.ascii());
}
{ // seed wakes and spreads own colour
  const r = runSolution(lv(['..b..'], ['....B'], ['Y']), [{ x: 0, y: 0, t: 0 }]);
  check('seed', r.ok && r.sim.ascii() === 'yybbb', r.sim.ascii());
}
{ // gate blocks other colours
  const r = runSolution(lv(['..R..'], ['....w'], ['B']), [{ x: 0, y: 0, t: 0 }]);
  check('gate blocks', r.ok && r.sim.ascii() === 'bb..w', r.sim.ascii());
  const r2 = runSolution(lv(['..R..'], ['....R'], ['R']), [{ x: 0, y: 0, t: 0 }]);
  check('gate passes', r2.ok, r2.sim.ascii());
}
{ // slow paper delays one beat
  const s = new Sim(lv(['.~...'], ['.....'], ['R']));
  s.drop(0); s.step(); s.step();
  check('slow holds', s.ascii() === 'rr...', s.ascii());
  s.step(); check('slow releases', s.ascii() === 'rrr..', s.ascii());
}
{ // three-way mud
  const s = new Sim(lv(['.....', '.....', '.....'], ['.....', '.....', '.....'], ['R', 'Y', 'B']));
  s.drop(s.idx(0, 1)); s.drop(s.idx(4, 1)); s.drop(s.idx(2, 3 - 3 + 0));
  while (!s.settled()) s.step();
  console.log(s.ascii());
}
{ // wrong target stops early
  const r = runSolution(lv(['.....'], ['..B..'], ['R']), [{ x: 0, y: 0, t: 0 }]);
  check('early fail', !r.ok && r.failTick === 2, String(r.failTick));
}
{ // clone independence
  const s = new Sim(lv(['.....'], ['.....'], ['R', 'B']));
  s.drop(0); const c = s.clone(); c.step(); c.drop(4);
  check('clone', s.tick === 0 && s.pi === 1 && c.pi === 2 && s.ascii() === 'r....', s.ascii());
}
// perf
{
  const L = parseLevel(lv(Array(9).fill('........'), Array(9).fill('........'), ['R', 'Y', 'B']));
  const t0 = Date.now(); let n = 0;
  for (let k = 0; k < 20000; k++) { const s = new Sim(L); s.drop(k % 72); s.step(); s.drop((k * 7 + 3) % 72); s.step(); s.drop((k * 13 + 40) % 72); while (!s.settled()) s.step(); n++; }
  console.log('perf: ' + n + ' sims in ' + (Date.now() - t0) + 'ms');
}
process.exit(fails ? 1 : 0);
