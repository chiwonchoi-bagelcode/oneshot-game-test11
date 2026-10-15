/*
 * Rule-card diagrams for core E's own rules. Each one is played through the real Sim, then handed
 * to the shared diagram renderer as a timeline (src/ui/rule-diagrams.ts → registerDiagram).
 */
import { Sim, type LevelDef } from '../../core/sim.ts';
import { registerDiagram, type CellInk, type TimelineBoard } from '../../ui/rule-diagrams.ts';
import { E_DIAGRAMS, type DiagramBoard } from './diagram-data.ts';

export function timelineOf(b: DiagramBoard): TimelineBoard {
  const def: LevelDef = { id: 'e-diagram', map: b.map, goal: b.goal || b.map.map((r) => '.'.repeat(r.length)), inks: b.inks, solution: [] };
  const sim = new Sim(def);
  const cells: (CellInk | null)[] = new Array(sim.w * sim.h).fill(null);
  const pending = b.drops.slice().sort((a, c) => a.t - c.t);
  for (let guard = 0; guard < 40; guard++) {
    while (pending.length && pending[0].t <= sim.tick) {
      const d = pending.shift()!;
      const idx = sim.idx(d.x, d.y);
      const spec = sim.nextInk();
      if (sim.drop(idx)) cells[idx] = { t: sim.tick, c: sim.ink[idx], kind: 'drop', range: spec && isFinite(spec.range) ? spec.range : undefined };
    }
    if (!pending.length && sim.settled()) break;
    for (const e of sim.step()) {
      if (e.type === 'fill') cells[e.idx] = { t: sim.tick, c: e.c, kind: 'spread' };
      else if (e.type === 'mix') cells[e.idx] = { t: sim.tick, c: e.c, kind: 'mix' };
    }
  }
  return { map: b.map, goal: b.goal, cells };
}

for (const [key, boards] of Object.entries(E_DIAGRAMS)) registerDiagram(key, () => ({ boards: boards.map(timelineOf) }));
