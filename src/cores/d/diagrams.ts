/*
 * Core D rule-card diagrams. Each one is played through the real Sim (wells release their own
 * ink), then handed to the shared diagram player as a timeline. Wells are marked with a ring via a
 * small generated stylesheet (the shared player knows nothing about wells).
 */
import { Sim, parseInk, type LevelDef } from '../../core/sim.ts';
import { registerDiagram, type TimelineBoard, type CellInk } from '../../ui/rule-diagrams.ts';
import { inkSkin } from '../../render/skins.ts';

interface DWell { x: number; y: number; ink: string; t?: number }
interface DBoard { map: string[]; goal?: string[]; wells: DWell[] }

function play(b: DBoard): { board: TimelineBoard; wells: { i: number; c: number }[] } {
  const w = b.map[0].length;
  const def: LevelDef = { id: 'dd', map: b.map, goal: b.goal || b.map.map((r) => '.'.repeat(r.length)), inks: b.wells.map((x) => x.ink), solution: [] };
  const sim = new Sim(def);
  const cells: (CellInk | null)[] = new Array(w * b.map.length).fill(null);
  const pending = b.wells.map((wl, k) => ({ ...wl, k })).filter((wl) => wl.t !== undefined).sort((a, c) => a.t! - c.t!);
  for (let g = 0; g < 30; g++) {
    while (pending.length && pending[0].t! <= sim.tick) {
      const d = pending.shift()!;
      const idx = sim.idx(d.x, d.y);
      const spec = parseInk(d.ink);
      if (sim.drop(idx, spec, d.k)) cells[idx] = { t: sim.tick, c: spec.c, kind: 'drop', range: isFinite(spec.range) ? spec.range : undefined };
    }
    if (!pending.length && sim.settled()) break;
    for (const e of sim.step()) {
      if (e.type === 'fill') cells[e.idx] = { t: sim.tick, c: e.c, kind: 'spread' };
      else if (e.type === 'mix') cells[e.idx] = { t: sim.tick, c: e.c, kind: 'mix' };
    }
  }
  return { board: { map: b.map, goal: b.goal, cells }, wells: b.wells.map((wl) => ({ i: wl.y * w + wl.x, c: parseInk(wl.ink).c })) };
}

const SPECS: Record<string, DBoard[]> = {
  d_well: [{ map: ['.......', '.......', '.......'], wells: [{ x: 3, y: 1, ink: 'R', t: 0 }] }],
  d_mix: [{ map: ['.......', '.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 1, ink: 'B', t: 0 }] }],
  d_wait: [
    { map: ['.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 0, ink: 'B', t: 0 }] },
    { map: ['.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 0, ink: 'B', t: 2 }] },
  ],
  d_touch: [
    { map: ['......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 5, y: 0, ink: 'B', t: 0 }] },
    { map: ['......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 5, y: 0, ink: 'B', t: 1 }] },
  ],
  d_decoy: [{ map: ['.......', '.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 0, ink: 'B', t: 0 }, { x: 6, y: 1, ink: 'B' }] }],
  d_cover: [
    { map: ['.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 4, y: 0, ink: 'B', t: 1 }] },
    { map: ['.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 4, y: 0, ink: 'B' }] },
  ],
  d_range: [{ map: ['.......', '.......'], wells: [{ x: 1, y: 0, ink: 'R2', t: 0 }, { x: 6, y: 1, ink: 'B1', t: 0 }] }],
  d_three: [{ map: ['.......', '.......'], wells: [{ x: 0, y: 0, ink: 'R', t: 0 }, { x: 6, y: 0, ink: 'Y', t: 0 }, { x: 3, y: 1, ink: 'B', t: 2 }] }],
  d_white: [{ map: ['.......'], goal: ['.....w.'], wells: [{ x: 2, y: 0, ink: 'B2', t: 0 }] }],
  d_slow: [
    { map: ['.......'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 0, ink: 'B', t: 0 }] },
    { map: ['.~.....'], wells: [{ x: 0, y: 0, ink: 'Y', t: 0 }, { x: 6, y: 0, ink: 'B', t: 0 }] },
  ],
};

let styleEl: HTMLStyleElement | null = null;
const styled = new Set<string>();

function wellStyle(key: string, boards: DBoard[], wells: { i: number; c: number }[][]): void {
  if (styled.has(key) || typeof document === 'undefined') return;
  styled.add(key);
  const colors = inkSkin('ink-classic').colors;
  // Child index of each cell inside the diagram root: holes are skipped, boards follow each other.
  let base = 0;
  const css: string[] = [];
  boards.forEach((b, bi) => {
    const w = b.map[0].length;
    const order = new Map<number, number>();
    let n = 0;
    b.map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') order.set(y * w + x, n++); }));
    for (const wl of wells[bi]) {
      const nth = base + (order.get(wl.i) ?? 0) + 1;
      const sel = `.rd[data-rule="${key}"] > .rd-c:nth-child(${nth})`;
      css.push(`${sel}::before{content:'';position:absolute;inset:22%;border-radius:50%;background:${colors[wl.c]};opacity:.9}`);
      css.push(`${sel}::after{content:'';position:absolute;inset:6%;border-radius:50%;border:2.5px solid ${colors[wl.c]};box-shadow:0 0 0 1.5px rgba(255,255,255,.85);z-index:2}`);
    }
    base += n;
  });
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'd-diagram-wells';
    document.head.appendChild(styleEl);
  }
  styleEl.appendChild(document.createTextNode(css.join('\n')));
}

export function registerDDiagrams(): void {
  for (const key of Object.keys(SPECS)) {
    registerDiagram(key, () => {
      const res = SPECS[key].map(play);
      wellStyle(key, SPECS[key], res.map((r) => r.wells));
      return { boards: res.map((r) => r.board), check: key === 'd_white' };
    });
  }
}
