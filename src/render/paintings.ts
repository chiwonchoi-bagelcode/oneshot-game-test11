/*
 * Chapter murals: 8 code-drawn watercolour paintings (viewBox 300 x 200), 30 regions each.
 * Regions are revealed in order as the chapter's levels are cleared: early regions are broad
 * background washes, later ones midground, the last ones focal details (29 = crowning element).
 *
 * Every region is <g class="rg" data-i="k"> holding a paint group (.pt) and a sketch group (.sk).
 * Unrevealed: only the pencil sketch shows, so the whole composition reads as a line drawing.
 * Revealed (.on): translucent layered fills with darker edges; the pencil stays faintly visible.
 * No SVG filters are used. Gradient ids are prefixed (opts.idPrefix) so instances never clash.
 */

export const PAINTING_REGIONS = 30;

// ---------------------------------------------------------------- geometry helpers

type Pt = [number, number];

function n1(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom spline through points as cubic Beziers. */
function sm(p: Pt[], closed: boolean): string {
  const n = p.length;
  if (n < 2) return '';
  let d = 'M' + n1(p[0][0]) + ' ' + n1(p[0][1]);
  const at = (i: number): Pt => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += 'C' + n1(c1x) + ' ' + n1(c1y) + ' ' + n1(c2x) + ' ' + n1(c2y) + ' ' + n1(p2[0]) + ' ' + n1(p2[1]);
  }
  return closed ? d + 'Z' : d;
}

/** Smooth top edge through `p`, closed down to `bottom`. */
function ridge(p: Pt[], bottom: number): string {
  const a = p[0], b = p[p.length - 1];
  return sm(p, false) + 'L' + n1(b[0]) + ' ' + n1(bottom) + 'L' + n1(a[0]) + ' ' + n1(bottom) + 'Z';
}

function poly(p: Pt[]): string {
  return 'M' + p.map((q) => n1(q[0]) + ' ' + n1(q[1])).join('L') + 'Z';
}

function line(p: Pt[]): string {
  return 'M' + p.map((q) => n1(q[0]) + ' ' + n1(q[1])).join('L');
}

function rect(x: number, y: number, w: number, h: number): string {
  return 'M' + n1(x) + ' ' + n1(y) + 'h' + n1(w) + 'v' + n1(h) + 'h' + n1(-w) + 'Z';
}

function ell(cx: number, cy: number, rx: number, ry: number): string {
  return 'M' + n1(cx - rx) + ' ' + n1(cy) + 'a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + n1(2 * rx) + ' 0a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + n1(-2 * rx) + ' 0Z';
}

/** Organic closed blob around an ellipse. */
function blob(cx: number, cy: number, rx: number, ry: number, r: () => number, rough = 0.15, n = 9, rot = 0): string {
  const pts: Pt[] = [];
  const a0 = r() * 6.283;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * 6.283;
    const m = 1 + (r() - 0.5) * 2 * rough;
    const x = Math.cos(a) * rx * m, y = Math.sin(a) * ry * m;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return sm(pts, true);
}

/** Pointed leaf / petal from base (x,y), length len, half-width w, angle (radians, 0 = right). */
function leaf(x: number, y: number, len: number, w: number, ang: number, bulge = 0.45): string {
  const c = Math.cos(ang), s = Math.sin(ang);
  const tx = x + c * len, ty = y + s * len;
  const mx = x + c * len * bulge, my = y + s * len * bulge;
  const px = -s * w * 1.25, py = c * w * 1.25;
  return 'M' + n1(x) + ' ' + n1(y) + 'Q' + n1(mx + px) + ' ' + n1(my + py) + ' ' + n1(tx) + ' ' + n1(ty) + 'Q' + n1(mx - px) + ' ' + n1(my - py) + ' ' + n1(x) + ' ' + n1(y) + 'Z';
}

/** Rounded petal (wider tip) — lotus / blossom petals. */
function petal(x: number, y: number, len: number, w: number, ang: number): string {
  const c = Math.cos(ang), s = Math.sin(ang);
  const px = -s, py = c;
  const p1x = x + c * len * 0.55 + px * w, p1y = y + s * len * 0.55 + py * w;
  const p2x = x + c * len * 0.55 - px * w, p2y = y + s * len * 0.55 - py * w;
  const tx = x + c * len, ty = y + s * len;
  return 'M' + n1(x) + ' ' + n1(y) + 'C' + n1(p1x - c * len * 0.2) + ' ' + n1(p1y - s * len * 0.2) + ' ' + n1(p1x + c * len * 0.35) + ' ' + n1(p1y + s * len * 0.35) + ' ' + n1(tx) + ' ' + n1(ty) +
    'C' + n1(p2x + c * len * 0.35) + ' ' + n1(p2y + s * len * 0.35) + ' ' + n1(p2x - c * len * 0.2) + ' ' + n1(p2y - s * len * 0.2) + ' ' + n1(x) + ' ' + n1(y) + 'Z';
}

/** Lily pad: ellipse with a wedge notch. */
function pad(cx: number, cy: number, rx: number, ry: number, notch: number): string {
  const a1 = notch - 0.22, a2 = notch + 0.22;
  return 'M' + n1(cx) + ' ' + n1(cy) + 'L' + n1(cx + Math.cos(a2) * rx) + ' ' + n1(cy + Math.sin(a2) * ry) +
    'A' + n1(rx) + ' ' + n1(ry) + ' 0 1 1 ' + n1(cx + Math.cos(a1) * rx) + ' ' + n1(cy + Math.sin(a1) * ry) + 'Z';
}

function star4(cx: number, cy: number, r: number): string {
  const q = r * 0.22;
  return 'M' + n1(cx) + ' ' + n1(cy - r) + 'Q' + n1(cx + q) + ' ' + n1(cy - q) + ' ' + n1(cx + r) + ' ' + n1(cy) + 'Q' + n1(cx + q) + ' ' + n1(cy + q) + ' ' + n1(cx) + ' ' + n1(cy + r) +
    'Q' + n1(cx - q) + ' ' + n1(cy + q) + ' ' + n1(cx - r) + ' ' + n1(cy) + 'Q' + n1(cx - q) + ' ' + n1(cy - q) + ' ' + n1(cx) + ' ' + n1(cy - r) + 'Z';
}

/** Flying bird: a soft "v". */
function bird(x: number, y: number, s: number): string {
  return 'M' + n1(x - s) + ' ' + n1(y - s * 0.35) + 'Q' + n1(x - s * 0.45) + ' ' + n1(y - s * 0.55) + ' ' + n1(x) + ' ' + n1(y) + 'Q' + n1(x + s * 0.45) + ' ' + n1(y - s * 0.6) + ' ' + n1(x + s) + ' ' + n1(y - s * 0.4);
}

// ---------------------------------------------------------------- shapes & colour

/** f: fill colour ('#hex' or '@gradient'), o: opacity, e: edge colour (null = none), k: kind. */
interface Sh {
  d: string;
  f: string;
  o?: number;
  e?: string | null;
  /** 'f' fill (default) · 'l' stroked line · 's' sketch-only line */
  k?: 'f' | 'l' | 's';
  w?: number;
  /** include in the pencil sketch (default: fills and lines yes) */
  sk?: boolean;
}

type Region = Sh[];

interface Painting {
  paper: string;
  defs: string; // uses "§" as the id prefix placeholder
  regions: Region[];
  seal: Pt;
}

function hexDarken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const F = (d: string, f: string, o = 0.88, e?: string | null): Sh => ({ d, f, o, e });
const G = (d: string, f: string, o = 0.5): Sh => ({ d, f, o, e: null, sk: false }); // glaze, no sketch
const L = (d: string, f: string, w = 1, o = 0.9): Sh => ({ d, f, o, w, k: 'l' });
const S = (d: string): Sh => ({ d, f: '', k: 's' });

function lin(id: string, stops: [number, string, number?][], x2 = 0, y2 = 1): string {
  return '<linearGradient id="§' + id + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">' +
    stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</linearGradient>';
}

function lin4(id: string, stops: [number, string, number?][], x1: number, y1: number, x2: number, y2: number): string {
  return '<linearGradient id="§' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
    stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</linearGradient>';
}

/** Band hugging a ridge line (for light glazes on slopes). */
function band(p: Pt[], t: number): string {
  const lower = p.slice().reverse().map((q, k, a) => [q[0], q[1] + t * Math.sin(Math.PI * (k + 0.5) / a.length) + 1] as Pt);
  return sm(p.concat(lower), true);
}

/** Soft mist: stacked translucent blobs with a horizontal fade. */
function mistShapes(cx: number, cy: number, rx: number, ry: number, r: () => number): Sh[] {
  return [
    F(blob(cx, cy, rx, ry * 1.9, r, 0.1, 12), '@mist', 0.28, null),
    G(blob(cx, cy, rx * 0.86, ry * 1.2, r, 0.12, 12), '@mist', 0.35),
    G(blob(cx, cy, rx * 0.7, ry * 0.6, r, 0.12, 12), '@mist', 0.4),
  ];
}

function rad(id: string, stops: [number, string, number?][]): string {
  return '<radialGradient id="§' + id + '">' +
    stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</radialGradient>';
}

// ---------------------------------------------------------------- paintings

function dawnPond(): Painting {
  const r = rng(101);
  const R: Region[] = [];
  const petalC = '#ef8fae';
  // 0 sky + soft cloud streaks
  R.push([
    G(rect(0, 0, 300, 114), '@sky', 1),
    F(sm([[30, 36], [70, 31], [120, 33], [150, 37], [118, 40], [70, 40]], true), '#f6d3d3', 0.55, null),
    F(sm([[165, 24], [215, 19], [270, 21], [292, 25], [250, 28], [200, 28]], true), '#f8dccd', 0.5, null),
  ]);
  // 1 dawn glow
  R.push([G(ell(205, 102, 130, 46), '@glow', 0.95), S(sm([[150, 62], [205, 56], [262, 64]], false))]);
  // 2 water
  R.push([G(rect(0, 112, 300, 88), '@water', 1), S(line([[0, 112.5], [300, 112.5]])),
    G(rect(0, 112, 300, 10), '#fbe3c8', 0.45)]);
  // 3 sun
  R.push([G(ell(205, 99, 22, 22), '#ffe9b4', 0.45), F(ell(205, 99, 12, 12), '#fff3c9', 0.95, '#f2b77a')]);
  // 4 far hills
  R.push([F(ridge([[-5, 104], [25, 96], [55, 99], [92, 91], [128, 98], [160, 95], [184, 101], [228, 93], [266, 99], [305, 94]], 113), '#b4a6c9', 0.78)]);
  // 5 tree line
  {
    const p: Pt[] = [];
    for (let x = -6; x <= 306; x += 9) p.push([x, 107 - r() * 5 - (x > 120 && x < 170 ? 2 : 0)]);
    R.push([F(ridge(p, 113), '#7d9690', 0.85)]);
  }
  // 6 mist
  R.push([F(sm([[-10, 108], [60, 104], [150, 106], [240, 103], [310, 107], [240, 112], [150, 111], [60, 113]], true), '#ffffff', 0.55, null)]);
  // 7 sun reflection
  {
    const R7: Region = [];
    for (let k = 0; k < 8; k++) {
      const y = 116 + k * 5 + k * k * 0.3, hl = 13 - k * 1.3 + r() * 2;
      R7.push(L(line([[205 - hl, y], [205 + hl, y]]), '#fff1cf', 1.6 - k * 0.1, 0.85));
    }
    R.push(R7);
  }
  // 8, 9 reeds
  for (const [x0, x1] of [[4, 44], [258, 298]]) {
    const R8: Region = [];
    for (let x = x0; x < x1; x += 3 + r() * 3) {
      const top = 88 + r() * 16, dx = (r() - 0.5) * 6;
      R8.push(L(sm([[x, 117], [x + dx * 0.4, 104], [x + dx, top]], false), '#5f7353', 0.8, 0.9));
      if (r() < 0.3) R8.push(F(ell(x + dx, top - 2, 1.1, 3.2), '#7a5a3c', 0.9));
    }
    R.push(R8);
  }
  // 10 ripples
  R.push([
    L(sm([[52, 136], [70, 134], [88, 136]], false), '#ffffff', 0.7, 0.6),
    L(sm([[58, 139], [70, 138], [82, 139]], false), '#ffffff', 0.6, 0.5),
    L(sm([[226, 130], [242, 128], [258, 130]], false), '#ffffff', 0.7, 0.6),
    L(sm([[130, 166], [150, 163], [172, 166]], false), '#ffffff', 0.7, 0.5),
    L(sm([[136, 170], [150, 168], [165, 170]], false), '#ffffff', 0.6, 0.45),
  ]);
  // 11 far pads
  R.push([[40, 125, 9, 2.2], [75, 129, 7, 1.8], [118, 124, 8, 2], [178, 127, 10, 2.4], [264, 124, 8, 2], [228, 133, 7, 1.8]].map((q) => F(pad(q[0], q[1], q[2], q[3], r() * 6), '#88aa76', 0.9)));
  // 12, 13 mid pads
  R.push([[38, 148, 18, 5], [80, 156, 14, 4], [16, 163, 12, 3.5]].map((q) => F(pad(q[0], q[1], q[2], q[3], -1.2 + r()), '#79a165', 0.9)));
  R.push([[222, 151, 16, 4.5], [264, 159, 20, 5.5], [292, 146, 10, 3]].map((q) => F(pad(q[0], q[1], q[2], q[3], -2 + r()), '#79a165', 0.9)));
  // 14, 15 foreground pads (with veins)
  for (const set of [[[34, 184, 34, 9], [96, 193, 26, 7]], [[214, 189, 30, 8], [281, 179, 26, 7]]]) {
    const Rg: Region = [];
    for (const q of set) {
      Rg.push(F(pad(q[0], q[1], q[2], q[3], -1.6 + r() * 0.6), '#6a9858', 0.92));
      Rg.push(G(ell(q[0] - q[2] * 0.2, q[1] - q[3] * 0.25, q[2] * 0.55, q[3] * 0.45), '#9cc584', 0.5));
      for (let k = 0; k < 5; k++) {
        const a = 0.4 + k * 0.55;
        Rg.push(L(line([[q[0], q[1]], [q[0] + Math.cos(a + 1.6) * q[2] * 0.85, q[1] + Math.sin(a + 1.6) * q[3] * 0.85]]), '#4f7a44', 0.4, 0.5));
      }
    }
    R.push(Rg);
  }
  // 16 small water lilies on pads
  {
    const Rg: Region = [];
    for (const [x, y] of [[80, 153], [264, 156], [40, 145]]) {
      for (let k = 0; k < 6; k++) Rg.push(F(petal(x, y, 4.5, 1.6, -Math.PI / 2 + (k - 2.5) * 0.45), '#fbf3f1', 0.95, '#d9b2b8'));
      Rg.push(F(ell(x, y - 1, 1.3, 0.8), '#f1c64f', 1));
    }
    R.push(Rg);
  }
  // 17 willow bough (top-left corner)
  R.push([F('M-4 -4C30 2 62 5 96 3C116 2 128 -1 140 -4L140 -6L-4 -6Z', '#5b4a3c', 0.92), F('M-4 -6L-4 22C4 14 10 6 22 2Z', '#5b4a3c', 0.9)]);
  // 18 willow strands
  {
    const Rg: Region = [];
    for (let k = 0; k < 13; k++) {
      const x = 4 + k * 10 + r() * 4, y0 = k < 3 ? 8 - k * 2 : 3 + r() * 2;
      const len = 40 + r() * 45 - Math.abs(k - 6) * 2;
      Rg.push(L(sm([[x, y0], [x + 2, y0 + len * 0.4], [x + 5 + r() * 4, y0 + len]], false), '#7d955a', 0.7, 0.9));
    }
    R.push(Rg);
  }
  // 19 willow leaves
  {
    const Rg: Region = [];
    for (let k = 0; k < 13; k++) {
      const x = 4 + k * 10 + r() * 4;
      for (let j = 0; j < 3; j++) {
        const y = 16 + j * 19 + r() * 10;
        if (y > 80) continue;
        Rg.push(F(leaf(x + 2 + j, y, 6 + r() * 3, 1.3, Math.PI / 2 + (r() - 0.5) * 0.8 + (j % 2 ? 0.5 : -0.5)), j % 2 ? '#93b46b' : '#7fa35c', 0.9, null));
      }
    }
    R.push(Rg);
  }
  // 20, 21 lotus buds
  for (const [x, yb, yt] of [[62, 178, 126], [258, 176, 130]]) {
    R.push([
      L(sm([[x - 3, yb], [x - 1, (yb + yt) / 2], [x, yt + 4]], false), '#6c8f55', 1.4, 0.95),
      F('M' + x + ' ' + (yt - 14) + 'C' + (x + 7) + ' ' + (yt - 6) + ' ' + (x + 6) + ' ' + (yt + 4) + ' ' + x + ' ' + (yt + 5) + 'C' + (x - 6) + ' ' + (yt + 4) + ' ' + (x - 7) + ' ' + (yt - 6) + ' ' + x + ' ' + (yt - 14) + 'Z', '@petal', 0.95, '#c9567b'),
      G(leaf(x - 1, yt + 3, 12, 2, -Math.PI / 2 - 0.15), '#ffffff', 0.35),
    ]);
  }
  // 22 standing leaf
  R.push([
    L(sm([[104, 176], [102, 155], [100, 132]], false), '#6c8f55', 1.4, 0.95),
    F('M84 126C90 120 112 119 118 125C114 133 92 135 84 126Z', '#78a462', 0.92),
    F('M84 126C92 129 110 129 118 125C112 122 92 121 84 126Z', '#a8c98a', 0.85, null),
  ]);
  // 23 half-open lotus (right)
  R.push([
    L(sm([[230, 178], [228, 160], [226, 146]], false), '#6c8f55', 1.4, 0.95),
    F(petal(226, 146, 13, 5, -Math.PI / 2 - 0.55), '#f5bccb', 0.92, '#cf6f8f'),
    F(petal(226, 146, 13, 5, -Math.PI / 2 + 0.55), '#f5bccb', 0.92, '#cf6f8f'),
    F(petal(226, 147, 15, 5.5, -Math.PI / 2), '@petal', 0.95, '#c9567b'),
  ]);
  // 24 birds
  R.push([L(bird(88, 52, 5), '#6c6a85', 0.9), L(bird(102, 45, 4), '#6c6a85', 0.8), L(bird(115, 55, 3), '#6c6a85', 0.7)]);
  // 25 dragonfly
  R.push([
    F(ell(113, 82, 7, 4.5), '#cfe6ee', 0.55, '#7da2b8'),
    F(ell(127, 82, 7, 4.5), '#cfe6ee', 0.55, '#7da2b8'),
    F(ell(114, 87, 6, 3.5), '#cfe6ee', 0.5, '#7da2b8'),
    F(ell(126, 87, 6, 3.5), '#cfe6ee', 0.5, '#7da2b8'),
    L(line([[120, 79], [120, 100]]), '#3f6f94', 1.6, 0.95),
    F(ell(120, 78.5, 1.8, 1.8), '#2f5f84', 1),
  ]);
  // 26 main lotus: stem + pad
  R.push([
    F(pad(150, 183, 46, 11, -1.3), '#649454', 0.93),
    G(ell(138, 180, 24, 5.5), '#9cc584', 0.45),
    L(sm([[152, 183], [151, 166], [150, 150]], false), '#5f8a4a', 2.4, 0.95),
  ]);
  // 27 back petals
  {
    const Rg: Region = [];
    for (const a of [-2.8, -2.3, -0.84, -0.34]) Rg.push(F(petal(150, 148, 29, 9.5, a), '#f6c9d5', 0.92, '#d77c98'));
    for (const a of [-1.95, -1.19]) Rg.push(F(petal(150, 148, 33, 10.5, a), '#f3b4c6', 0.92, '#d77c98'));
    R.push(Rg);
  }
  // 28 golden seed pod + stamens
  {
    const Rg: Region = [F(ell(150, 134, 10, 4.8), '#f0c24a', 0.95, '#c8922e')];
    for (let k = 0; k < 11; k++) {
      const a = Math.PI + (k / 10) * Math.PI;
      Rg.push(L(line([[150 + Math.cos(a) * 7.5, 135 + Math.sin(a) * 2.5], [150 + Math.cos(a) * 12, 131.5 + Math.sin(a) * 5]]), '#e7a93a', 0.8, 0.9));
    }
    R.push(Rg);
  }
  // 29 front petals: the lotus in full bloom
  R.push([
    G(ell(150, 136, 52, 36), '@bloom', 0.9),
    F(petal(150, 151, 31, 11, -2.5), '@petal', 0.95, '#c9567b'),
    F(petal(150, 151, 31, 11, -0.64), '@petal', 0.95, '#c9567b'),
    F(petal(148, 152, 35, 11.5, -1.88), '@petal', 0.96, '#c9567b'),
    F(petal(152, 152, 35, 11.5, -1.26), '@petal', 0.96, '#c9567b'),
    F(petal(150, 153, 26, 9, -3.0), petalC, 0.9, '#c9567b'),
    F(petal(150, 153, 26, 9, -0.14), petalC, 0.9, '#c9567b'),
    G(leaf(146, 149, 21, 2.4, -1.85), '#ffffff', 0.35),
    G(leaf(154, 149, 21, 2.4, -1.29), '#ffffff', 0.3),
  ]);
  const defs = lin('sky', [[0, '#a9afd6'], [0.42, '#e7bfc8'], [0.78, '#f8d6b5'], [1, '#fbe6c2']]) +
    lin('water', [[0, '#f2ccbb'], [0.22, '#cbd2cf'], [0.6, '#92bac0'], [1, '#628fa2']]) +
    rad('glow', [[0, '#fff3d0', 1], [0.5, '#ffe2b4', 0.55], [1, '#ffd9ae', 0]]) +
    rad('bloom', [[0, '#ffe7ef', 0.9], [0.6, '#fbd0de', 0.35], [1, '#fbd0de', 0]]) +
    lin('petal', [[0, '#e8628d'], [0.55, '#f5a9c0'], [1, '#fdeef2']]);
  return { paper: '#f6efe1', defs, regions: R, seal: [278, 188] };
}


function circ(cx: number, cy: number, r: number): string {
  return ell(cx, cy, r, r);
}

/** Many small dots in one path. */
function dots(p: [number, number, number][]): string {
  return p.map((q) => ell(q[0], q[1], q[2], q[2])).join('');
}

/** Five-lobed maple leaf with toothed lobes and a short stem. */
function maple(cx: number, cy: number, rr: number, rot: number): string {
  const pts: Pt[] = [];
  const lobe = [1, 0.92, 0.62, 0.62, 0.92];
  for (let k = 0; k < 5; k++) {
    const a = rot - Math.PI / 2 + (k / 5) * Math.PI * 2;
    const L = lobe[k];
    const at = (da: number, m: number) => pts.push([cx + Math.cos(a + da) * rr * m, cy + Math.sin(a + da) * rr * m]);
    at(-0.42, L * 0.5);
    at(-0.2, L * 0.72);
    at(-0.16, L * 0.6);
    at(0, L);
    at(0.16, L * 0.6);
    at(0.2, L * 0.72);
    at(0.42, L * 0.5);
    at(0.63, 0.28);
  }
  const sa = rot + Math.PI / 2;
  return poly(pts) + 'M' + n1(cx) + ' ' + n1(cy) + 'L' + n1(cx + Math.cos(sa) * rr * 0.9) + ' ' + n1(cy + Math.sin(sa) * rr * 0.9 + 0.2) + 'L' + n1(cx + Math.cos(sa) * rr * 0.9 + 0.4) + ' ' + n1(cy + Math.sin(sa) * rr * 0.9) + 'Z';
}

/** Hanok-style curved roof: eave line sags between upturned tips; ridge on top. */
function roof(x0: number, x1: number, eaveY: number, ridgeY: number, lift: number, ridgeInset: number): string {
  const m = (x0 + x1) / 2, w = x1 - x0;
  return 'M' + n1(x0) + ' ' + n1(eaveY - lift) + 'C' + n1(x0 + w * 0.2) + ' ' + n1(eaveY + 1) + ' ' + n1(m - w * 0.2) + ' ' + n1(eaveY + 2) + ' ' + n1(m) + ' ' + n1(eaveY + 2) +
    'C' + n1(m + w * 0.2) + ' ' + n1(eaveY + 2) + ' ' + n1(x1 - w * 0.2) + ' ' + n1(eaveY + 1) + ' ' + n1(x1) + ' ' + n1(eaveY - lift) +
    'C' + n1(x1 - w * 0.06) + ' ' + n1(eaveY - lift - 2) + ' ' + n1(x1 - ridgeInset * 0.6) + ' ' + n1(ridgeY + 5) + ' ' + n1(x1 - ridgeInset) + ' ' + n1(ridgeY) +
    'L' + n1(x0 + ridgeInset) + ' ' + n1(ridgeY) + 'C' + n1(x0 + ridgeInset * 0.6) + ' ' + n1(ridgeY + 5) + ' ' + n1(x0 + w * 0.06) + ' ' + n1(eaveY - lift - 2) + ' ' + n1(x0) + ' ' + n1(eaveY - lift) + 'Z';
}

function teaHouse(): Painting {
  const r = rng(202);
  const R: Region[] = [];
  // 0 sky
  R.push([G(rect(0, 0, 300, 150), '@sky', 1), F(sm([[20, 30], [70, 25], [115, 29], [80, 33], [40, 34]], true), '#ffffff', 0.5, null), S(sm([[20, 30], [70, 25], [115, 29]], false))]);
  // 1 far mountains
  R.push([F(ridge([[-5, 92], [20, 80], [45, 84], [75, 70], [100, 78], [130, 72], [160, 82], [190, 73], [220, 64], [250, 75], [280, 70], [305, 79]], 150), '#a9bccb', 0.7)]);
  // 2 near hills
  R.push([F(ridge([[-5, 106], [40, 96], [80, 102], [130, 94], [175, 103], [230, 93], [270, 100], [305, 95]], 150), '#bdbf98', 0.78)]);
  // 3 ground
  R.push([G(rect(0, 146, 300, 54), '@ground', 1), S(sm([[0, 147], [100, 145], [200, 147], [300, 145]], false))]);
  // 4 trees behind the house
  {
    const Rg: Region = [];
    const cols = ['#c98b4a', '#a4a35d', '#d4a157', '#b97a45'];
    for (let k = 0; k < 9; k++) Rg.push(F(blob(30 + k * 22, 104 + r() * 6, 13 + r() * 6, 10 + r() * 4, r, 0.14), cols[k % 4], 0.78));
    R.push(Rg);
  }
  // 5 stone foundation
  R.push([F(poly([[46, 140], [194, 140], [198, 152], [42, 152]]), '#b4ab9c', 0.95),
    L('M50 146H190M70 140V152M98 140V146M126 146V152M154 140V146M180 146V152', '#8f8678', 0.5, 0.7)]);
  // 6 walls, posts and beam
  R.push([F(rect(56, 98, 128, 42), '#eadfc6', 0.95),
    F(rect(54, 96, 132, 4), '#6b4a35', 0.95),
    ...[56, 88, 120, 152, 181].map((x) => F(rect(x - 1.6, 96, 3.2, 45), '#7a5236', 0.95))]);
  // 7 paper doors with lattice
  {
    const Rg: Region = [];
    let lat = '';
    for (const [a, b] of [[58, 87], [90, 119], [122, 151], [154, 180]]) {
      Rg.push(F(rect(a + 2.5, 103, b - a - 5, 31), '#f7f0dd', 0.95, '#a8865f'));
      for (let x = a + 2.5 + 4.6; x < b - 3; x += 4.6) lat += 'M' + n1(x) + ' 103V134';
      for (let y = 109; y < 134; y += 6) lat += 'M' + n1(a + 2.5) + ' ' + y + 'H' + n1(b - 2.5);
    }
    Rg.push(L(lat, '#a07e57', 0.35, 0.8));
    R.push(Rg);
  }
  // 8 eave shadow
  R.push([F('M40 89H200L195 99H45Z', '#5e4231', 0.9)]);
  // 9 roof tiles
  {
    let tl = '';
    for (let x = 68; x <= 172; x += 6.5) tl += 'M' + n1(x) + ' 63L' + n1(x + (x - 120) * 0.42) + ' 93';
    R.push([F(roof(24, 216, 92, 62, 11, 46), '@roof', 0.97, '#3b4048'), L(tl, '#3d424a', 0.5, 0.55)]);
  }
  // 10 ridge cap and upturned ends
  R.push([F('M64 63L176 63L178 59Q181 56 184 55L183 59L176 60H64L57 59L56 55Q59 56 62 59Z', '#3a3f47', 0.95), F(rect(66, 58.5, 108, 3), '#4a5059', 0.9)]);
  // 11 veranda (maru)
  R.push([F(poly([[52, 136], [188, 136], [190, 141], [50, 141]]), '#a8794b', 0.95), L('M60 138.5H180', '#7d5636', 0.4, 0.6)]);
  // 12 stepping stones
  R.push([[124, 190, 13, 4.5], [129, 176, 11, 3.8], [132, 164, 9, 3.2], [134, 155, 7, 2.6]].map((q) => F(ell(q[0], q[1], q[2], q[3]), '#b9b2a6', 0.95)));
  // 13 grass tufts and small flowers
  {
    let g = '';
    for (const [x0, y0] of [[12, 186], [40, 172], [80, 192], [175, 186], [200, 170], [230, 194], [282, 178]]) {
      for (let k = 0; k < 5; k++) g += 'M' + n1(x0 + k * 2) + ' ' + y0 + 'q' + n1((k - 2) * 1.2) + ' -5 ' + n1((k - 2) * 2.4) + ' -' + n1(6 + r() * 4);
    }
    R.push([L(g, '#7d8f4f', 0.8, 0.9), F(dots([[18, 180, 1.4], [86, 186, 1.3], [206, 164, 1.4], [236, 188, 1.2]]), '#f2e7b0', 0.95, '#c8a95a')]);
  }
  // 14 persimmon trunk
  R.push([F('M247 200C252 172 249 142 254 112C256 104 260 104 262 112C262 142 267 172 273 200Z', '#6b4a33', 0.95), L('M256 190C257 170 255 150 258 128', '#4a3122', 0.6, 0.6)]);
  // 15 branches
  R.push([L(sm([[256, 124], [240, 100], [224, 76]], false), '#5e4230', 2.2), L(sm([[259, 116], [272, 88], [286, 60]], false), '#5e4230', 2.2),
    L(sm([[255, 136], [235, 122], [212, 110]], false), '#5e4230', 1.7), L(sm([[260, 108], [264, 76], [270, 44]], false), '#5e4230', 1.8)]);
  // 16 leaves (dark olive, behind)
  R.push([[230, 70, 22, 14], [270, 52, 24, 16], [287, 90, 18, 12], [218, 100, 16, 10], [250, 36, 16, 10], [245, 92, 14, 9], [292, 40, 12, 9]].map((q, k) => F(blob(q[0], q[1], q[2], q[3], r, 0.14, 12), k % 2 ? '#7c8a4a' : '#66763f', 0.7)));
  // 17 leaves (warm, front)
  R.push([[238, 80, 14, 9], [292, 70, 12, 8], [262, 96, 13, 8], [212, 92, 10, 7], [276, 36, 10, 7], [226, 58, 9, 6]].map((q, k) => F(blob(q[0], q[1], q[2], q[3], r, 0.14, 12), k % 2 ? '#c9582f' : '#de8a3c', 0.6)));
  // 18, 19 persimmons
  for (const set of [[[232, 85], [245, 72], [226, 104], [241, 97], [220, 70]], [[276, 62], [291, 82], [268, 93], [282, 101], [262, 50], [296, 56]]]) {
    const Rg: Region = [];
    for (const [x, y] of set) {
      Rg.push(F(circ(x, y, 4 + r() * 0.8), '@fruit', 0.97, '#b4561c'));
      Rg.push(F(leaf(x - 2.5, y - 3.6, 5, 1.2, -0.2), '#4f6a35', 0.95, null));
      Rg.push(G(circ(x - 1.3, y - 1, 1.2), '#fff2d0', 0.7));
    }
    R.push(Rg);
  }
  // 20 strings of dried persimmons under the left eave
  {
    const Rg: Region = [L('M43 92V122M50 93V124', '#7a5a3a', 0.5, 0.9)];
    for (const x of [43, 50]) for (let k = 0; k < 5; k++) Rg.push(F(ell(x, 97 + k * 5.6 + (x === 50 ? 1.5 : 0), 1.8, 2.4), '#c7652f', 0.95));
    R.push(Rg);
  }
  // 21 paper lantern at the right eave corner
  R.push([L('M206 84V92', '#5e4231', 0.6), F(ell(206, 99, 5, 7), '#f3e2b6', 0.95, '#b2462f'), F(rect(203, 91.5, 6, 1.6), '#b2462f', 0.95), F(rect(203, 105, 6, 1.6), '#b2462f', 0.95)]);
  // 22 low table
  R.push([F(ell(112, 133, 14, 2.4), '#8a5a33', 0.97), L('M101 134V137M123 134V137M112 135V137', '#6b4429', 0.9)]);
  // 23 tea cups
  R.push([F('M101 128.5h4.6l-.8 3.4h-3Z', '#e2ebe0', 0.97, '#7c9a8a'), F('M118 128.5h4.6l-.8 3.4h-3Z', '#e2ebe0', 0.97, '#7c9a8a')]);
  // 24 teapot
  R.push([F(ell(111, 128.6, 4.8, 3.4), '#8fae98', 0.97, '#4f6f5a'), L('M115.5 127.5l3.4-2.6', '#6f8f7a', 1.1), L('M106.5 127c-2 0-2.4 2.6 0 3', '#6f8f7a', 0.8), F(ell(111, 124.9, 1.6, 0.8), '#5f7f6a', 0.95)]);
  // 25 sleeping cat
  R.push([F(ell(70, 132.6, 9, 3.8), '#a39385', 0.97, '#6f6155'), F(ell(63.5, 131, 3.2, 2.7), '#a39385', 0.97, '#6f6155'),
    F('M61.4 129l.6-2.4 1.6 1.6ZM64.4 128.6l1.4-2 1 2Z', '#8d7d70', 0.95), L('M78 134c3 1 4-2 1.6-3.4', '#8d7d70', 1.2), L('M66 132.4c3-1 7-1 10 0', '#7f7064', 0.4, 0.7)]);
  // 26 magpie on a branch
  R.push([F(ell(222, 72.6, 5, 3), '#232328', 0.97, null), F(ell(223.4, 73.6, 2.6, 1.6), '#f4f2ec', 0.97, null), F(circ(217.4, 70.6, 2.1), '#232328', 0.97, null),
    L('M226.6 71.4l8.4-3.6', '#2c3a4a', 1.8), L('M215.4 70.6l-2.2.4', '#232328', 0.7), F(leaf(220, 71.2, 6, 1.6, 0.25), '#3d5a7a', 0.9, null)]);
  // 27 falling leaves
  R.push([[200, 128, 0.3], [228, 148, 1.4], [184, 112, 2.2], [246, 162, 0.8], [210, 182, 2.6], [170, 150, 1.9]].map((q) => F(leaf(q[0], q[1], 5.5, 1.8, q[2]), q[2] > 1.5 ? '#d65a33' : '#e59a3c', 0.92)));
  // 28 warm glow from the doors
  R.push([G(ell(120, 118, 70, 26), '@warm', 0.8), F(blob(136, 118, 9, 11, r, 0.1), '#fbe3a6', 0.5, null)]);
  // 29 steam rising from the teapot (crowning)
  R.push([
    G(ell(114, 100, 14, 26), '@steam', 0.6),
    L(sm([[118, 123], [116, 114], [121, 106], [116, 96], [121, 86], [117, 76]], false), '#ffffff', 2.4, 0.5),
    L(sm([[118, 123], [116, 114], [121, 106], [116, 96], [121, 86], [117, 76]], false), '#ffffff', 1.1, 0.95),
    L(sm([[115, 122], [111, 112], [114, 103], [109, 94], [112, 84]], false), '#ffffff', 0.9, 0.85),
    L(sm([[120, 122], [124, 113], [122, 104], [127, 96]], false), '#ffffff', 0.8, 0.8),
  ]);
  const defs = lin('sky', [[0, '#d9e6ea'], [0.7, '#f1ead8'], [1, '#f7ead2']]) +
    lin('ground', [[0, '#dcc79e'], [1, '#c6aa7b']]) +
    lin('roof', [[0, '#7a838f'], [1, '#4e545f']]) +
    rad('fruit', [[0, '#ffb35a'], [0.7, '#ef8429'], [1, '#d9661f']]) +
    rad('warm', [[0, '#ffe2a2', 0.8], [1, '#ffe2a2', 0]]) +
    rad('steam', [[0, '#ffffff', 0.7], [1, '#ffffff', 0]]);
  return { paper: '#f6efe1', defs, regions: R, seal: [24, 186] };
}

function bambooTrail(): Painting {
  const r = rng(303);
  const R: Region[] = [];
  const stalks = (xs: [number, number][], col: string, top = -2, bottom = 132): Sh[] => {
    let d = '', nodes = '';
    for (const [x, w] of xs) {
      d += rect(x - w / 2, top, w, bottom - top);
      for (let y = top + 14 + r() * 10; y < bottom - 4; y += 20 + r() * 6) nodes += 'M' + n1(x - w / 2) + ' ' + n1(y) + 'h' + n1(w);
    }
    return [F(d, col, 0.9), L(nodes, hexDarken(col, 0.72), 0.7, 0.8)];
  };
  const leaves = (cx: number, cy: number, n: number, len: number, col: string, droop: number): Sh => {
    let d = '';
    for (let k = 0; k < n; k++) {
      const a = droop + (r() - 0.5) * 1.9;
      d += leaf(cx + (r() - 0.5) * 8, cy + (r() - 0.5) * 6, len * (0.75 + r() * 0.4), len * 0.12, a);
    }
    return F(d, col, 0.88);
  };
  // 0 background light
  R.push([G(rect(0, 0, 300, 200), '@bg', 1)]);
  // 1 far bamboo
  {
    let d = '';
    for (let x = 62; x < 250; x += 7 + r() * 6) d += rect(x, -2, 1.6 + r() * 1.4, 124 + r() * 6);
    R.push([F(d, '#c5d7ab', 0.75, null), S('M60 120H250')]);
  }
  // 2 ground
  R.push([F(ridge([[-5, 128], [60, 124], [120, 121], [180, 122], [240, 125], [305, 127]], 200), '#cdc394', 0.95)]);
  // 3 path
  R.push([F('M104 200C126 170 148 140 155 119L165 119C170 140 192 170 220 200Z', '#e6d6ad', 0.96, '#bba878'), G('M140 200C150 172 158 142 160 120L163 120C166 145 172 172 182 200Z', '#f3e8c8', 0.5)]);
  // 4, 5 mid stalks
  R.push(stalks([[34, 4], [52, 3.5], [70, 4], [86, 3], [101, 2.6]], '#9cbd7c'));
  R.push(stalks([[198, 2.6], [212, 3.2], [229, 4], [246, 3.4], [262, 4]], '#9cbd7c'));
  // 6 light rays
  R.push([G('M118 -2H146L184 128H170Z', '#fffbe0', 0.32), G('M166 -2H178L201 116H193Z', '#fffbe0', 0.28), G('M92 -2H100L140 120H134Z', '#fffbe0', 0.2)]);
  // 7, 8 bushes
  R.push([F(blob(22, 150, 32, 16, r, 0.15, 10), '#86a764', 0.88), F(blob(62, 140, 22, 12, r, 0.18), '#93b06c', 0.85)]);
  R.push([F(blob(262, 148, 34, 16, r, 0.15, 10), '#86a764', 0.88), F(blob(226, 140, 20, 11, r, 0.18), '#93b06c', 0.85)]);
  // 9 ferns
  {
    let d = '';
    for (const [x, y, s] of [[30, 182, 1], [272, 184, 1], [76, 192, 0.7]]) for (let k = 0; k < 7; k++) d += leaf(x, y, 18 * s, 2.6 * s, -Math.PI / 2 + (k - 3) * 0.42);
    R.push([F(d, '#6f9a55', 0.9)]);
  }
  // 10 leaves of the mid grove
  R.push([leaves(40, 18, 12, 11, '#a9c98a', 2.2), leaves(90, 30, 10, 10, '#a9c98a', 1.2), leaves(205, 22, 10, 10, '#a9c98a', 2.0), leaves(250, 34, 12, 11, '#a9c98a', 1.0)]);
  // 11, 12 near stalks with gradient
  R.push([...stalks([[6, 9], [25, 7], [45, 5.5]], '#6f9b4f', -2, 202).map((x) => ({ ...x, f: x.k === 'l' ? x.f : '@stalk' })), G(rect(3, -2, 2, 204), '#d8ebb8', 0.5)]);
  R.push([...stalks([[252, 6.5], [271, 9], [293, 6]], '#6f9b4f', -2, 202).map((x) => ({ ...x, f: x.k === 'l' ? x.f : '@stalk' })), G(rect(268, -2, 2.2, 204), '#d8ebb8', 0.45)]);
  // 13, 14 near leaves
  R.push([leaves(24, 40, 14, 18, '#4f7f3f', 0.6), leaves(10, 96, 10, 16, '#5b8a46', 0.9), leaves(48, 70, 9, 15, '#4f7f3f', 0.4)]);
  R.push([leaves(272, 30, 14, 18, '#4f7f3f', 2.5), leaves(290, 92, 10, 16, '#5b8a46', 2.2), leaves(252, 64, 9, 15, '#4f7f3f', 2.7)]);
  // 15 stone lantern
  R.push([F(rect(88, 166, 16, 5), '#a3a096', 0.95), F(rect(93, 150, 6, 16), '#aeaba1', 0.95), F(rect(89, 140, 14, 10), '#b6b3a9', 0.95),
    F('M84 140L96 132L108 140Z', '#9a978d', 0.95), F(circ(96, 130.5, 2), '#9a978d', 0.95), F(rect(93, 142.5, 6, 5), '#6d6a62', 0.9)]);
  // 16 pebbles along the path
  {
    const p: [number, number, number][] = [];
    for (let k = 0; k < 9; k++) { const t = k / 8; p.push([104 + 50 * t + (r() - 0.5) * 3, 198 - 78 * t, 1.6 - t * 0.9]); p.push([220 - 56 * t + (r() - 0.5) * 3, 198 - 78 * t, 1.6 - t * 0.9]); }
    R.push([F(dots(p), '#a59c86', 0.9)]);
  }
  // 17 moss
  R.push([[18, 170, 14, 4], [78, 160, 10, 3], [240, 166, 14, 4], [286, 160, 9, 3]].map((q) => F(blob(q[0], q[1], q[2], q[3], r, 0.25), '#9db56a', 0.75)));
  // 18 bamboo shoots
  R.push([F('M38 190L42 176L46 190Z', '#a58e5a', 0.95), F('M258 188L261 177L264 188Z', '#a58e5a', 0.95), F('M60 192L62 184L64 192Z', '#a58e5a', 0.95), L('M40 186l4-2M259.5 184l3-2', '#7d6a42', 0.6)]);
  // 19 fallen leaves on the path
  R.push([F([[130, 182, 0.4], [178, 176, 2.4], [150, 160, 1.2], [168, 146, 2.9], [190, 190, 1.8], [142, 138, 0.2]].map((q) => leaf(q[0], q[1], 6, 1.2, q[2])).join(''), '#d9c27a', 0.9)]);
  // 20 lantern light
  R.push([G(ell(96, 145, 16, 12), '@warm', 0.8), F(rect(93, 142.5, 6, 5), '#ffd98a', 0.95, null)]);
  // 21 small bird
  R.push([L(bird(120, 46, 5), '#4d5a48', 0.9), L(bird(132, 54, 3.5), '#4d5a48', 0.8)]);
  // 22 butterflies
  R.push([F(leaf(186, 96, 5, 2.4, -2.4) + leaf(186, 96, 5, 2.4, -0.7), '#f6ecb0', 0.95, '#c4a94e'), F(leaf(118, 110, 4, 2, -2.2) + leaf(118, 110, 4, 2, -0.9), '#fffaf0', 0.95, '#b7ab8a')]);
  // 23 traveller's robe
  R.push([F('M157 148C157 140 159 132 163 130C167 132 169 140 169 148Z', '#6f7f9a', 0.96), L('M160.5 148.5v2M165.5 148.5v2', '#4d5568', 1.1)]);
  // 24 head, bundle and staff
  R.push([F(circ(163, 127.5, 2.6), '#e8c9a8', 0.97), F(rect(165.6, 133, 4.6, 6), '#a8834f', 0.95), L('M171 129L174 151', '#6b5236', 0.9)]);
  // 25 shadow on the path
  R.push([F(ell(166, 151.5, 11, 2.2), '#8a8060', 0.35, null)]);
  // 26 sun dapples
  R.push([F(dots([[150, 170, 3], [172, 160, 2.2], [140, 186, 3.6], [186, 182, 2.6], [158, 140, 1.8]]), '#fff8d8', 0.55, null)]);
  // 27 overhanging leaves (top frame)
  R.push([leaves(70, 4, 10, 14, '#5b8a46', 1.4), leaves(130, 2, 8, 13, '#4f7f3f', 1.7), leaves(230, 5, 10, 14, '#5b8a46', 1.6)]);
  // 28 drifting leaves
  R.push([F(leaf(210, 70, 7, 1.4, 0.6) + leaf(142, 88, 6, 1.2, 2.2) + leaf(100, 64, 6, 1.2, 1.2), '#8db86a', 0.92)]);
  // 29 red paper umbrella (crowning)
  {
    let ribs = '';
    for (let k = 0; k <= 6; k++) { const x = 146 + k * 5.7; ribs += 'M163 108L' + n1(x) + ' ' + n1(123.5 - Math.abs(k - 3) * 0.6); }
    R.push([
      G(ell(163, 116, 30, 18), '@warm', 0.45),
      F('M145 124Q146 110 163 107Q180 110 181 124Q176 121.5 172 123Q167.5 120.6 163 122.4Q158.5 120.6 154 123Q150 121.5 145 124Z', '@umb', 0.97, '#8f2017'),
      L(ribs, '#f7d1b8', 0.4, 0.75),
      L('M163 106V131', '#5b3a24', 0.9),
      F(circ(163, 106.4, 1.3), '#5b3a24', 0.95),
    ]);
  }
  const defs = lin('bg', [[0, '#f3f1d6'], [0.55, '#dce7bd'], [1, '#c7d6a2']]) +
    lin('stalk', [[0, '#8db86a'], [0.45, '#6f9b4f'], [1, '#4f7d3b']], 1, 0) +
    rad('warm', [[0, '#ffe7a8', 0.9], [1, '#ffe7a8', 0]]) +
    lin('umb', [[0, '#e8503a'], [1, '#b52a20']]);
  return { paper: '#f6f1e2', defs, regions: R, seal: [282, 186] };
}

function mistyPeaks(): Painting {
  const r = rng(404);
  const R: Region[] = [];
  const mist = (cx: number, cy: number, rx: number, ry: number): Sh[] => mistShapes(cx, cy, rx, ry, r);
  // 0 sky
  R.push([G(rect(0, 0, 300, 200), '@sky', 1)]);
  // 1 pale sun
  R.push([G(circ(226, 40, 22), '#f6c1a8', 0.35), F(circ(226, 40, 13), '#e3836a', 0.72, null)]);
  // 2 far peaks
  R.push([F(ridge([[-5, 120], [14, 92], [30, 62], [42, 49], [55, 70], [70, 88], [90, 60], [102, 40], [115, 31], [127, 52], [140, 80], [160, 95], [184, 70], [198, 55], [212, 72], [230, 90], [254, 64], [268, 47], [283, 62], [305, 90]], 160), '#b9c4c5', 0.62)]);
  // 3 mist 1
  R.push([...mist(80, 96, 100, 8), ...mist(232, 100, 92, 7)]);
  // 4 far peaks 2
  R.push([F(ridge([[-5, 126], [22, 108], [48, 96], [68, 104], [96, 92], [122, 104], [150, 112], [178, 98], [204, 86], [226, 100], [252, 94], [280, 104], [305, 98]], 165), '#98a9a8', 0.72)]);
  // 5 mist 2
  R.push(mist(150, 118, 170, 8));
  // 6, 7 mid peaks
  R.push([F(ridge([[-5, 150], [5, 122], [20, 99], [37, 88], [54, 95], [70, 110], [88, 117], [110, 128], [135, 152]], 200), '#7e938b', 0.9), G(band([[12, 108], [24, 98], [37, 89], [52, 96], [64, 108]], 9), '#b3c4b8', 0.55)]);
  R.push([F(ridge([[168, 152], [188, 122], [207, 101], [227, 92], [245, 104], [262, 96], [281, 108], [305, 116]], 200), '#7b8f8c', 0.9), G(band([[196, 110], [210, 99], [227, 93], [242, 102], [252, 101]], 9), '#b3c4b8', 0.55)]);
  // 8 waterfall
  R.push([F('M146 104C147 120 146 140 148 162L153 162C152 140 153 120 151 104Z', '#f4f6f2', 0.92, '#b9c7c7')]);
  // 9 mist 3
  R.push([...mist(60, 150, 86, 6), ...mist(240, 152, 80, 6)]);
  // 10 river
  R.push([F(ridge([[-5, 166], [60, 161], [150, 163], [240, 159], [305, 164]], 200), '@water', 0.95)]);
  // 11, 12 near cliffs
  R.push([F(ridge([[-5, 128], [10, 118], [28, 112], [44, 121], [56, 138], [66, 158], [80, 176], [96, 201]], 201), '#56685f', 0.94)]);
  R.push([F(ridge([[214, 201], [227, 172], [240, 151], [256, 138], [272, 130], [290, 134], [305, 127]], 201), '#59695f', 0.94)]);
  // 13 brush texture (cun) strokes
  {
    let d = '';
    for (let k = 0; k < 16; k++) {
      const left = k < 8;
      const x = left ? 8 + r() * 44 : 236 + r() * 60, y = left ? 124 + r() * 50 : 140 + r() * 46;
      d += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(3 + r() * 3) + ' ' + n1(2 + r() * 3) + ' ' + n1(5 + r() * 4) + ' ' + n1(7 + r() * 6);
    }
    for (let k = 0; k < 8; k++) {
      const x = k < 4 ? 20 + r() * 60 : 196 + r() * 70, y = 100 + r() * 30;
      d += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(2 + r() * 2) + ' 3 ' + n1(3 + r() * 3) + ' ' + n1(6 + r() * 4);
    }
    R.push([L(d, '#3e4c47', 0.7, 0.6)]);
  }
  // 14 foreground rocks
  R.push([F(blob(120, 194, 26, 8, r, 0.2), '#8c9792', 0.92), F(blob(176, 196, 20, 6, r, 0.2), '#7f8a86', 0.92), F(blob(104, 184, 9, 4, r, 0.2), '#97a29d', 0.92)]);
  // 15 pine trunk
  R.push([L(sm([[40, 118], [44, 104], [56, 96], [62, 84], [76, 66]], false), '#5b4a3a', 3.6), L(sm([[44, 106], [36, 98], [28, 92]], false), '#5b4a3a', 1.8)]);
  // 16 pine branches
  R.push([L(sm([[58, 92], [80, 86], [102, 80]], false), '#5b4a3a', 1.5), L(sm([[66, 78], [88, 72], [112, 69]], false), '#5b4a3a', 1.4), L(sm([[72, 70], [80, 62], [86, 58]], false), '#5b4a3a', 1.1)]);
  // 17 pine needle pads
  R.push([[102, 78, 15, 4.6], [112, 67, 12, 4], [86, 57, 11, 3.6], [24, 89, 10, 3.6], [70, 62, 9, 3], [92, 85, 9, 3]].map((q) => F(blob(q[0], q[1], q[2], q[3], r, 0.12, 10), '#3f5f4a', 0.86)));
  // 18 small pine on the right cliff
  R.push([L('M276 131L280 112', '#5b4a3a', 1.8), F(blob(282, 112, 9, 3, r, 0.15), '#3f5f4a', 0.86), F(blob(277, 120, 8, 2.8, r, 0.15), '#3f5f4a', 0.86), F(blob(285, 104, 6, 2.2, r, 0.15), '#3f5f4a', 0.86)]);
  // 19 pavilion on the mid peak
  R.push([F(rect(227, 93, 15, 2), '#6a5a4a', 0.95), L('M229.5 93V86M239.5 93V86', '#5a4a3c', 1), F(roof(224, 245, 86.5, 81, 2.4, 6), '#4a4f58', 0.95)]);
  // 20 boat with fisherman
  R.push([F('M84 178Q100 184 118 177L115 181Q100 186 87 181Z', '#4f4337', 0.95), F('M100 177L98 169L103 169Z', '#4f4337', 0.95), F('M96 169.5L100.5 165.5L105 169.5Z', '#c9b48a', 0.95), L('M104 172L126 160', '#4f4337', 0.6)]);
  // 21 distant geese
  R.push([L(bird(170, 26, 3) + bird(178, 30, 3) + bird(186, 34, 2.8) + bird(162, 30, 2.8) + bird(154, 34, 2.6), '#5d6662', 0.7, 0.8)]);
  // 22 clouds
  R.push([F(sm([[22, 24], [60, 18], [98, 22], [70, 27], [40, 28]], true), '#ffffff', 0.6, null), F(sm([[240, 70], [272, 66], [300, 69], [276, 73]], true), '#ffffff', 0.6, null)]);
  // 23 shrubs on the near cliff
  R.push([F(dots([[30, 113, 3.4], [36, 112, 2.6], [250, 136, 3], [258, 134, 2.4], [292, 130, 2.6]]), '#46594d', 0.9)]);
  // 24 waterfall spray
  R.push([F(blob(150, 162, 14, 5, r, 0.2), '#ffffff', 0.75, null), F(dots([[140, 158, 1.2], [160, 157, 1], [156, 165, 1.1]]), '#ffffff', 0.85, null)]);
  // 25 steps up to the pavilion
  R.push([L('M222 132l4-4 2-4 4-3 1-4 3-3 2-4 2-3', '#c9b48a', 0.8, 0.85)]);
  // 26 reflections
  R.push([L('M20 172h30M70 176h22M196 170h28M236 178h34M112 186h18', '#ffffff', 0.7, 0.6)]);
  // 27 far crane
  R.push([F(leaf(244, 54, 10, 2.2, -2.6) + leaf(244, 54, 10, 2.2, -0.5), '#ffffff', 0.95, '#6d7672'), L('M240 55l-5 1.6', '#2a2a2a', 0.7)]);
  // 28 pine highlights
  R.push([G(blob(100, 76, 11, 2, r, 0.1), '#7f9f7a', 0.6), G(blob(110, 65.5, 9, 1.8, r, 0.1), '#7f9f7a', 0.6), G(blob(86, 56, 8, 1.6, r, 0.1), '#7f9f7a', 0.6),
    L('M92 78l3-3M98 79l3-3M104 78l3-3M106 67l3-3M112 66l3-3M82 56l3-3M88 56l3-3', '#2f4a3a', 0.5, 0.7)]);
  // 29 the crane in flight (crowning)
  R.push([
    G(ell(178, 56, 40, 22), '@halo', 0.7),
    F(leaf(180, 58, 44, 9, -2.55), '#ffffff', 0.97, '#7d8784'),
    F(leaf(182, 57, 40, 8, -0.62), '#fbfbf8', 0.97, '#7d8784'),
    F(leaf(150, 40, 12, 3.2, -2.55), '#2a2c2e', 0.92, null),
    F(leaf(210, 36, 11, 3, -0.62), '#2a2c2e', 0.92, null),
    F(ell(181, 59, 10, 4), '#ffffff', 0.98, '#7d8784'),
    L(sm([[173, 60], [164, 62], [156, 66]], false), '#23262a', 1.8),
    F(circ(155, 66.4, 1.9), '#23262a', 0.97, null),
    F(circ(155.6, 65, 0.9), '#d23a2c', 0.98, null),
    L('M153.5 67l-5 1.6', '#6b5a3a', 0.7),
    L('M190 61L208 67M190 60L208 65', '#3a3a3a', 0.7),
    F(leaf(190, 60, 5, 1.6, 0.3), '#2a2c2e', 0.9, null),
  ]);
  const defs = lin('sky', [[0, '#efe5cf'], [0.6, '#e8e6d8'], [1, '#dfe6df']]) +
    lin('water', [[0, '#c7d6d1'], [1, '#97b1ae']]) +
    rad('halo', [[0, '#ffffff', 0.85], [1, '#ffffff', 0]]) +
    lin4('mist', [[0, '#ffffff', 0], [0.25, '#ffffff', 1], [0.75, '#ffffff', 1], [1, '#ffffff', 0]], 0, 0, 1, 0);
  return { paper: '#f5efe0', defs, regions: R, seal: [282, 26] };
}

function sunsetHarbor(): Painting {
  const r = rng(505);
  const R: Region[] = [];
  // 0 sky
  R.push([G(rect(0, 0, 300, 120), '@sky', 1)]);
  // 1 glow over the horizon
  R.push([G(ell(150, 118, 160, 48), '@glow', 0.95), S(sm([[60, 96], [150, 86], [240, 96]], false))]);
  // 2 sea
  R.push([G(rect(0, 118, 300, 82), '@sea', 1), S('M0 118.5H300')]);
  // 3 setting sun
  R.push([G('M114 118A36 30 0 0 1 186 118Z', '@sun', 0.8), F('M131 118A19 19 0 0 1 169 118Z', '#ffd68c', 0.97, '#f0a058')]);
  // 4 high clouds
  R.push([F(sm([[10, 30], [60, 22], [120, 26], [150, 32], [100, 35], [40, 36]], true), '#c98aa6', 0.55, null), F(sm([[170, 16], [230, 12], [290, 18], [250, 23], [200, 23]], true), '#b98aae', 0.5, null)]);
  // 5 low clouds crossing the sun
  R.push([F(sm([[70, 98], [130, 94], [190, 97], [240, 100], [180, 103], [110, 103]], true), '#f2a77c', 0.6, null), F(sm([[118, 110], [150, 108], [186, 111], [150, 113]], true), '#f6b38a', 0.55, null)]);
  // 6 far headland (left)
  R.push([F(ridge([[-5, 118], [10, 109], [36, 105], [62, 110], [90, 117], [100, 119]], 119), '#6e5a7e', 0.85)]);
  // 7 sun path on the water
  {
    let d = '';
    for (let k = 0; k < 10; k++) { const y = 121 + k * 4 + k * k * 0.35, hl = 16 - k * 1.2 + r() * 3; d += 'M' + n1(150 - hl) + ' ' + n1(y) + 'H' + n1(150 + hl); }
    R.push([L(d, '#ffdc94', 1.5, 0.85)]);
  }
  // 8 wave lines
  {
    let d = '', e = '';
    for (let k = 0; k < 14; k++) { const x = r() * 280, y = 128 + r() * 66, l = 8 + r() * 14; (k % 2 ? d : e).concat(''); if (k % 2) d += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(l / 2) + ' -1.6 ' + n1(l) + ' 0'; else e += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(l / 2) + ' -1.6 ' + n1(l) + ' 0'; }
    R.push([L(d, '#ffffff', 0.7, 0.4), L(e, '#4f5b85', 0.7, 0.45)]);
  }
  // 9 right cliff
  R.push([F(ridge([[204, 201], [208, 142], [222, 119], [240, 104], [262, 96], [285, 98], [305, 93]], 201), '#4a3f5e', 0.95), G(ridge([[214, 140], [226, 120], [244, 106], [262, 100]], 160), '#7a5f7e', 0.4)]);
  // 10 grass on the cliff top
  R.push([F(sm([[222, 119], [240, 103], [262, 95], [285, 97], [305, 92], [305, 97], [284, 101], [262, 99], [241, 107], [224, 121]], true), '#4f6a4f', 0.9), L('M246 103l1-4M252 100l1-4M276 97l1-4M292 95l1-4', '#4f6a4f', 0.8)]);
  // 11 breakwater
  R.push([F(poly([[-2, 146], [104, 152], [108, 158], [-2, 156]]), '#6b6178', 0.95), L('M14 147v9M32 148v8.5M50 149v8M68 150v8M86 151v7', '#4f475c', 0.6, 0.7)]);
  // 12 pier posts and their reflections
  R.push([F(rect(112, 146, 2, 14) + rect(119, 147, 2, 13) + rect(126, 148, 2, 12), '#4a4058', 0.95), L('M113 162v6M120 162v5M127 162v4', '#4a4058', 1.2, 0.4)]);
  // 13 lighthouse body
  R.push([F(poly([[255, 97], [269, 97], [266, 52], [258, 52]]), '#f3ece4', 0.97, '#9b8a8a')]);
  // 14 lighthouse stripes
  R.push([F(poly([[256, 85], [268, 85], [267.3, 77], [256.7, 77]]) + poly([[257.4, 66], [266.6, 66], [266, 58], [258, 58]]), '#c8463a', 0.95)]);
  // 15 gallery and lamp room
  R.push([F(rect(254, 49, 16, 3), '#3e3448', 0.95), F(rect(258, 40, 8, 9), '#f7e2a0', 0.95, '#5b4a5a'), F('M257 40Q262 34 267 40Z', '#9b3a33', 0.95)]);
  // 16, 17 far sailboats
  R.push([F('M52 129H70L67 132H55Z', '#3d3550', 0.95), F('M61 128L61 112L70 127Z', '#f6e3d0', 0.95, '#8a6a78'), F('M60 128L60 116L54 127Z', '#f0d6c6', 0.9, '#8a6a78')]);
  R.push([F('M192 127H206L204 129.5H194Z', '#3d3550', 0.95), F('M199 126.5L199 114L206 126Z', '#f6e3d0', 0.95, '#8a6a78')]);
  // 18 fishing boat hull
  R.push([F('M96 164H150L144 174Q123 178 102 174Z', '#3d3550', 0.96), L('M100 167H146', '#c8463a', 1)]);
  // 19 cabin, mast and flag
  R.push([F(rect(108, 156, 14, 8), '#e9dccb', 0.95), F(rect(110, 158.5, 4, 3), '#7a8aa8', 0.9), L('M132 164V138', '#3d3550', 1.1), L('M132 140L118 162M132 140L146 163', '#3d3550', 0.4, 0.8), F('M132 138L141 140.5L132 143Z', '#c8463a', 0.95)]);
  // 20 boat reflections
  R.push([L('M100 178q8 2 16 0t16 0t16 0M58 134q4 1.4 8 0M196 132q4 1.4 8 0', '#2f2a44', 1.2, 0.5)]);
  // 21 houses on the shore below the cliff
  R.push([F(rect(212, 156, 14, 10) + rect(229, 152, 12, 14) + rect(244, 158, 13, 8), '#d9c3b0', 0.95)]);
  // 22 roofs
  R.push([F('M210 156L219 149L228 156Z', '#7e3b3a', 0.95), F('M227 152L235 145L243 152Z', '#3f4f74', 0.95), F('M242 158L250.5 152L259 158Z', '#7e3b3a', 0.95)]);
  // 23 foreground rocks
  R.push([F(blob(26, 192, 34, 12, r, 0.18, 10), '#3b3446', 0.95), F(blob(70, 197, 20, 7, r, 0.2), '#463d52', 0.95), G(blob(20, 186, 18, 4, r, 0.2), '#7a6a86', 0.5)]);
  // 24 moored rowboat
  R.push([F('M64 182Q80 188 98 182L95 187Q80 191 67 187Z', '#8a5a3e', 0.95), L('M64 184Q50 186 40 186', '#5a4a3a', 0.6)]);
  // 25 buoys
  R.push([F(circ(176, 150, 1.8) + circ(186, 158, 1.6) + circ(168, 162, 1.7), '#e05a3c', 0.95), G(circ(176, 149.4, 0.8) + circ(186, 157.5, 0.7), '#ffffff', 0.8)]);
  // 26 seagulls
  R.push([L(bird(84, 60, 6) + bird(100, 52, 4.5) + bird(196, 64, 5), '#f6efe8', 1.1, 0.95), L(bird(84, 60, 6), '#5b4a6a', 0.4, 0.5)]);
  // 27 lighthouse beam
  R.push([G('M262 44L140 20Q134 42 140 68Z', '@beam', 0.5), S('M262 44L140 20M262 44L140 68')]);
  // 28 window lights
  R.push([F(rect(216, 159, 3, 3) + rect(233, 157, 3, 3) + rect(248, 160, 3, 2.6), '#ffd27a', 0.95, null), G(ell(232, 160, 28, 8), '@lamp', 0.5)]);
  // 29 lamp glow (crowning)
  R.push([G(circ(262, 44, 34), '@lamp', 0.9), F(star4(262, 44, 9), '#fff6d4', 0.95, null), F(rect(259, 41.5, 6, 5), '#fff3c4', 0.97, null)]);
  const defs = lin('sky', [[0, '#5d5b8f'], [0.38, '#9b6f93'], [0.72, '#e48a6c'], [1, '#f6c46c']]) +
    lin('sea', [[0, '#f0a46c'], [0.3, '#b47c8a'], [1, '#5b6a95']]) +
    rad('glow', [[0, '#ffe7a6', 0.95], [0.6, '#ffc988', 0.4], [1, '#ffc988', 0]]) +
    rad('lamp', [[0, '#fff2bf', 0.95], [0.4, '#ffe08a', 0.5], [1, '#ffe08a', 0]]) +
    lin4('beam', [[0, '#fff3c4', 0], [1, '#fff3c4', 0.85]], 0, 0, 1, 0) +
    rad('sun', [[0, '#ffe9b0', 0.9], [1, '#ffe9b0', 0]]);
  return { paper: '#f6efe1', defs, regions: R, seal: [282, 186] };
}

/** Round paper lantern with caps; optional tassel. */
function lanternShapes(x: number, y: number, rx: number, ry: number, col: string, glow: boolean): Sh[] {
  const out: Sh[] = [];
  if (glow) out.push(G(ell(x, y, rx * 2.6, ry * 2.4), '@glow', 0.6));
  out.push(F(ell(x, y, rx, ry), col, 0.95, hexDarken(col, 0.6)));
  out.push(G(ell(x - rx * 0.25, y - ry * 0.2, rx * 0.45, ry * 0.6), '#fff1c6', 0.45));
  out.push(F(rect(x - rx * 0.5, y - ry - 1.4, rx, 1.8) + rect(x - rx * 0.5, y + ry - 0.4, rx, 1.8), '#3a2a2a', 0.95));
  out.push(L('M' + n1(x - rx * 0.92) + ' ' + n1(y) + 'h' + n1(rx * 1.84) + 'M' + n1(x - rx * 0.75) + ' ' + n1(y - ry * 0.55) + 'h' + n1(rx * 1.5) + 'M' + n1(x - rx * 0.75) + ' ' + n1(y + ry * 0.55) + 'h' + n1(rx * 1.5), hexDarken(col, 0.7), 0.4, 0.7));
  return out;
}

function lanternMarket(): Painting {
  const r = rng(606);
  const R: Region[] = [];
  // 0 night sky
  R.push([G(rect(0, 0, 300, 200), '@sky', 1)]);
  // 1 stars
  {
    const p: [number, number, number][] = [];
    for (let k = 0; k < 26; k++) p.push([r() * 300, r() * 70, 0.4 + r() * 0.6]);
    R.push([F(dots(p), '#fff4d6', 0.85, null)]);
  }
  // 2 far rooftops
  R.push([F('M-2 112V96L10 96Q22 86 34 96H46V90L58 90Q74 78 90 90H102V100L118 100Q132 90 146 100H160V92L174 92Q190 80 206 92H220V98L234 98Q248 88 262 98H276V94L288 94Q296 88 302 94V112Z', '#262b4c', 0.95)]);
  // 3 street
  R.push([G(rect(0, 148, 300, 52), '@street', 1), S('M0 148.5H300')]);
  // 4, 5 stall frames
  R.push([F(rect(4, 104, 2.6, 46) + rect(54, 104, 2.6, 46) + rect(62, 108, 2.6, 42) + rect(112, 108, 2.6, 42), '#4a3328', 0.95), F(rect(6, 112, 48, 26) + rect(64, 116, 48, 22), '#3a2b2e', 0.9)]);
  R.push([F(rect(186, 108, 2.6, 42) + rect(236, 108, 2.6, 42) + rect(244, 104, 2.6, 46) + rect(294, 104, 2.6, 46), '#4a3328', 0.95), F(rect(188, 116, 48, 22) + rect(246, 112, 48, 26), '#3a2b2e', 0.9)]);
  // 6, 7 striped awnings
  const awning = (x: number, y: number, w: number, a: string, b: string): Sh[] => {
    let sc = 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + 8);
    const n = 6;
    for (let k = n; k > 0; k--) sc += 'Q' + n1(x + (k - 0.5) * w / n) + ' ' + n1(y + 13) + ' ' + n1(x + (k - 1) * w / n) + ' ' + n1(y + 8);
    sc += 'Z';
    let st = '';
    for (let k = 0; k < n; k += 1) if (k % 2 === 0) st += 'M' + n1(x + k * w / n) + ' ' + y + 'h' + n1(w / n) + 'v8q' + n1(-w / n / 2) + ' 5 ' + n1(-w / n) + ' 0Z';
    return [F(sc, a, 0.95), F(st, b, 0.9, null)];
  };
  R.push([...awning(2, 100, 56, '#f2e3c4', '#c0443a'), ...awning(60, 104, 56, '#f2e3c4', '#c98a2e')]);
  R.push([...awning(184, 104, 56, '#f2e3c4', '#3f6f8a'), ...awning(242, 100, 56, '#f2e3c4', '#c0443a')]);
  // 8 counters
  R.push([F(rect(2, 138, 56, 8) + rect(60, 138, 56, 8) + rect(184, 138, 56, 8) + rect(242, 138, 56, 8), '#7a5236', 0.95), L('M2 140H58M60 140H116M184 140H240M242 140H298', '#a5774c', 0.5)]);
  // 9 goods
  {
    const p: [number, number, number][] = [];
    for (const [x0, n] of [[10, 9], [190, 8]]) for (let k = 0; k < n; k++) p.push([x0 + (k % 5) * 7 + (k > 4 ? 3.5 : 0), k > 4 ? 131.6 : 135, 3]);
    R.push([F(dots(p), '#f08a2e', 0.95, '#a8541a'), F(ell(80, 134, 9, 4) + ell(98, 134, 7, 4), '#9fbf6a', 0.95), F(ell(262, 134, 10, 4) + ell(282, 134, 8, 4), '#c8a25a', 0.95, '#8a6a3a')]);
  }
  // 10 warm light pools
  R.push([G(ell(60, 160, 70, 14), '@glow', 0.55), G(ell(240, 160, 70, 14), '@glow', 0.55), S('M10 160q50 6 100 0M190 160q50 6 100 0')]);
  // 11 lantern strings
  R.push([L(sm([[-2, 34], [75, 50], [150, 56], [225, 50], [302, 34]], false), '#1b1b2e', 0.7), L(sm([[-2, 56], [75, 70], [150, 76], [225, 70], [302, 56]], false), '#1b1b2e', 0.7)]);
  // 12, 13 small lanterns along the strings
  for (const [y0, sag, n] of [[34, 22, 11], [56, 20, 9]]) {
    const Rg: Region = [];
    const cols = ['#e2483a', '#f0a43a', '#e86a3a', '#f2c94a'];
    const glows: Sh[] = [];
    for (let k = 1; k <= n; k++) {
      const x = k * 300 / (n + 1), t = x / 300, y = y0 + sag * 4 * t * (1 - t) + 4;
      if (Math.abs(x - 150) < 18 && n === 9) continue;
      glows.push(G(ell(x, y, 8, 8), '@glow', 0.55));
      Rg.push(F(ell(x, y, 3.2, 3.8), cols[k % 4], 0.95));
    }
    Rg.unshift(...glows);
    R.push(Rg);
  }
  // 14, 15 crowd silhouettes
  const people = (xs: number[]): Sh => {
    let d = '';
    for (const x of xs) { const h = 16 + r() * 5; d += 'M' + n1(x - 4) + ' 168C' + n1(x - 4) + ' ' + n1(168 - h * 0.6) + ' ' + n1(x + 4) + ' ' + n1(168 - h * 0.6) + ' ' + n1(x + 4) + ' 168Z' + ell(x, 168 - h * 0.6 - 3.2, 2.6, 2.9); }
    return F(d, '#2a2238', 0.92, null);
  };
  R.push([people([20, 32, 46, 88, 100])]);
  R.push([people([200, 214, 256, 270, 284])]);
  // 16 steam from the food stall
  R.push([L(sm([[80, 126], [77, 118], [82, 110], [78, 100]], false) + sm([[92, 126], [95, 117], [90, 108], [94, 98]], false), '#ffffff', 1, 0.6)]);
  // 17 signboards
  R.push([F(rect(24, 84, 9, 15) + rect(266, 84, 9, 15), '#6b4a33', 0.95, '#3a2a20'), F(rect(26, 86.5, 5, 10) + rect(268, 86.5, 5, 10), '#d9b56a', 0.6, null)]);
  // 18, 19 lanterns at the stalls
  R.push([...lanternShapes(14, 118, 4, 5, '#e2483a', true), ...lanternShapes(86, 120, 4, 5, '#e2483a', true)]);
  R.push([...lanternShapes(212, 120, 4, 5, '#e2483a', true), ...lanternShapes(286, 118, 4, 5, '#f0a43a', true)]);
  // 20 reflections on the wet street
  R.push([L('M14 152v14M86 154v12M212 154v12M286 152v14M150 152v20M44 152v8M256 152v8', '#ffb35a', 1.4, 0.35)]);
  // 21 child with a small lantern
  R.push([F('M146 184C146 176 154 176 154 184Z' + ell(150, 172.6, 2.6, 2.8), '#2a2238', 0.95, null), L('M154 178L159 174', '#2a2238', 0.8), G(circ(160, 178, 7), '@glow', 0.8), F(ell(160, 178.4, 2.2, 2.6), '#ffcf6a', 0.97, '#c0443a')]);
  // 22 banners and streamers
  R.push([F('M120 92L128 92L128 108L124 104L120 108Z', '#3f6f8a', 0.9), F('M172 92L180 92L180 108L176 104L172 108Z', '#c0443a', 0.9), L('M118 92H182', '#1b1b2e', 0.5)]);
  // 23, 24 sky lanterns drifting up
  R.push([G(circ(64, 14, 9), '@glow', 0.7), F('M60.6 10H67.4L66.6 18H61.4Z', '#ffc35a', 0.95, '#c0703a')]);
  R.push([G(circ(236, 18, 8), '@glow', 0.7), F('M233 14.4H239L238.3 21.6H233.7Z', '#ffc35a', 0.95, '#c0703a'), G(circ(204, 8, 5), '@glow', 0.6), F('M202.4 6H205.6L205.2 10H202.8Z', '#ffd27a', 0.95, '#c0703a')]);
  // 25 tassels under the mid lanterns
  R.push([L('M14 124v6M86 126v6M212 126v6M286 124v6', '#c0443a', 0.9)]);
  // 26 cat on a rooftop
  R.push([F(ell(64, 87.4, 5, 2.6) + ell(59.4, 85.4, 2.2, 2), '#1c1e33', 0.97, null), F('M58 84l.6-2.4 1.4 1.6ZM60.2 83.8l1.2-2 .9 2.1Z', '#1c1e33', 0.97, null), L('M69 87q4-1 3-5', '#1c1e33', 1)]);
  // 27, 28 big lanterns
  R.push([L('M40 47V54', '#1b1b2e', 0.6), ...lanternShapes(40, 64, 9, 10, '#d83a30', true), L('M40 75v9', '#c0443a', 1.3)]);
  R.push([L('M260 47V54', '#1b1b2e', 0.6), ...lanternShapes(260, 64, 9, 10, '#d83a30', true), L('M260 75v9', '#c0443a', 1.3)]);
  // 29 grand central lantern (crowning)
  R.push([
    G(circ(150, 92, 44), '@glow', 0.85),
    L('M150 76V80', '#1b1b2e', 0.8),
    ...lanternShapes(150, 94, 15, 14, '#d42f2a', false),
    F(rect(141, 78.6, 18, 2.4) + rect(141, 107.4, 18, 2.4), '#e0b04a', 0.95, '#8a6a2a'),
    L('M150 110v12M147 110v10M153 110v10', '#e0b04a', 0.9),
    F(circ(150, 94, 4), '#ffe9a8', 0.85, null),
  ]);
  const defs = lin('sky', [[0, '#151f42'], [0.55, '#2c2b57'], [1, '#4a3a61']]) +
    lin('street', [[0, '#5e4854'], [1, '#382c3a']]) +
    rad('glow', [[0, '#ffd27a', 0.85], [0.45, '#ff9a4a', 0.35], [1, '#ff9a4a', 0]]);
  return { paper: '#f3ece0', defs, regions: R, seal: [282, 186] };
}

function mapleValley(): Painting {
  const r = rng(707);
  const R: Region[] = [];
  const canopy = (cx: number, cy: number, n: number, spread: number, cols: string[], size: number): Sh[] =>
    Array.from({ length: n }, (_, k) => {
      const t = k / n, sz = size * (1.15 - 0.55 * t) * (0.8 + r() * 0.4);
      return F(blob(cx + (r() - 0.5) * spread * (1 - t * 0.4), cy + (r() - 0.5) * spread * 0.5, sz, sz * (0.62 + r() * 0.2), r, 0.16, 12), cols[k % cols.length], 0.58 + 0.2 * t);
    });
  // 0 sky
  R.push([G(rect(0, 0, 300, 120), '@sky', 1), F(sm([[160, 22], [210, 17], [262, 21], [220, 25]], true), '#ffffff', 0.6, null)]);
  // 1 far mountains
  R.push([F(ridge([[-5, 78], [30, 60], [60, 66], [96, 48], [130, 62], [160, 54], [196, 66], [230, 50], [264, 60], [305, 52]], 130), '#9fb3c4', 0.7)]);
  // 2 mid mountains with autumn colour
  R.push([F(ridge([[-5, 96], [36, 80], [72, 90], [108, 76], [146, 92], [180, 82], [220, 94], [260, 80], [305, 90]], 140), '#c9a467', 0.85)]);
  // 3 mist
  R.push(mistShapes(150, 100, 170, 6, r));
  // 4 valley floor
  R.push([G(rect(0, 104, 300, 96), '@floor', 1), S('M0 106Q150 100 300 106')]);
  // 5 stream
  R.push([F('M140 104C134 114 138 124 130 134C120 150 100 164 88 200L218 200C200 170 178 152 174 136C170 124 162 114 154 104Z', '@stream', 0.95, '#6f9fb8')]);
  // 6 stream banks
  R.push([F(dots([[94, 184, 4], [104, 168, 3], [116, 156, 2.6], [126, 142, 2], [210, 184, 4], [194, 166, 3], [182, 152, 2.4], [174, 140, 2]]), '#a7a49a', 0.9)]);
  // 7, 8 far forests
  {
    const a: Sh[] = [], b: Sh[] = [];
    for (let k = 0; k < 14; k++) {
      const x = 8 + k * 21 + r() * 8, y = 92 + r() * 10;
      (k % 2 ? a : b).push(F(blob(x, y, 8 + r() * 4, 5 + r() * 2, r, 0.2), k % 2 ? '#d98b3a' : '#c4502f', 0.82));
    }
    R.push(a); R.push(b);
  }
  // 9 evergreens
  {
    let d = '';
    for (const [x, y, s] of [[30, 106, 1], [52, 102, 0.8], [238, 104, 1], [262, 108, 0.9], [112, 100, 0.7], [196, 100, 0.7]]) d += 'M' + x + ' ' + n1(y - 14 * s) + 'L' + n1(x + 5 * s) + ' ' + y + 'L' + n1(x - 5 * s) + ' ' + y + 'Z';
    R.push([F(d, '#3f6046', 0.9)]);
  }
  // 10, 11 mid trees
  R.push(canopy(46, 122, 9, 50, ['#e2b33f', '#e0873a', '#c95a2e'], 13));
  R.push(canopy(250, 122, 9, 50, ['#e0873a', '#e2b33f', '#c95a2e'], 13));
  // 12 stream ripples
  R.push([L('M118 176h20M150 186h26M134 160h16M158 148h10M146 122h8', '#e8f4f8', 0.8, 0.8)]);
  // 13 rocks in the stream
  R.push([F(blob(150, 170, 7, 3, r, 0.2) + blob(174, 190, 9, 3.4, r, 0.2) + blob(160, 150, 4, 2, r, 0.2), '#8f8f86', 0.95), G(blob(149, 168.6, 4, 1.2, r, 0.2), '#ffffff', 0.5)]);
  // 14, 15 foreground banks
  R.push([F(ridge([[-5, 160], [30, 156], [70, 166], [96, 184], [104, 201]], 201), '#a9a457', 0.92)]);
  R.push([F(ridge([[204, 201], [214, 182], [240, 166], [270, 160], [305, 162]], 201), '#a9a457', 0.92)]);
  // 16 path to the bridge
  R.push([F('M0 180C40 172 90 156 122 136L128 138C98 160 48 180 0 191Z', '#e3cf9c', 0.92)]);
  // 17 far pavilion
  R.push([F(rect(194, 84, 12, 1.8), '#6a5446', 0.95), L('M196 84V79M204 84V79', '#5a4638', 0.9), F(roof(191, 209, 79.4, 75, 1.8, 5), '#5a4f52', 0.95)]);
  // 18 deer by the stream
  R.push([F(ell(226, 154, 7, 3.2) + ell(219.4, 151, 2, 3.4), '#9a6a42', 0.95), L('M221 157v5M231 157v5M224 157v5M229 157v5', '#7a5232', 0.8), F(ell(218, 147.6, 2.2, 1.6), '#9a6a42', 0.95), L('M217 146l-2-3M219 146l1-3.4', '#6a4a2a', 0.5)]);
  // 19 leaves floating on the stream
  R.push([F(maple(130, 180, 2.6, 0.4) + maple(160, 160, 2.2, 1.2) + maple(176, 184, 2.6, 2.2) + maple(144, 146, 1.8, 0.8), '#d8452f', 0.95)]);
  // 20 bridge reflection
  R.push([F('M126 137Q152 156 178 137L176 140Q152 158 128 140Z', '#c8524a', 0.4, null), S('M126 137Q152 156 178 137')]);
  // 21 bridge arch
  R.push([F('M122 136Q152 110 182 136L177 137.6Q152 116 127 137.6Z', '#d0402f', 0.97, '#7e2018')]);
  // 22 bridge railing
  R.push([L('M125 129Q152 104 179 129', '#b43426', 1.2), L('M130 131V125.6M139 125V119.4M147 121.4V116M157 121.4V116M165 125V119.4M174 131V125.6', '#b43426', 1.1)]);
  // 23 big maple trunk
  R.push([F('M-4 200C6 170 10 140 8 110C14 96 22 86 34 76L38 80C28 92 22 104 20 116C22 146 18 176 14 200Z', '#4f3a2c', 0.95), L('M18 108C30 98 44 92 60 90M12 136C4 128 -2 124 -6 122', '#4f3a2c', 2)]);
  // 24 big maple canopy
  R.push(canopy(36, 58, 11, 74, ['#c9362a', '#d84a2e', '#b52f28', '#e0603a'], 18));
  // 25 canopy highlights
  R.push(canopy(44, 50, 7, 64, ['#ef8a3a', '#f2b24a', '#e86a32'], 9));
  // 26 falling leaves
  R.push([F([[90, 60, 3, 0.4], [120, 80, 2.6, 1.6], [70, 110, 3, 2.4], [104, 40, 2.4, 0.9], [200, 140, 2.2, 1.1], [60, 140, 2.6, 2.9]].map((q) => maple(q[0], q[1], q[2], q[3])).join(''), '#e0582e', 0.95)]);
  // 27 sun rays
  R.push([G('M300 -2L300 36L130 116L112 108Z', '@ray', 0.35)]);
  // 28 person on the bridge
  R.push([F('M149 121C149 115 155 115 155 121Z', '#3f5f7a', 0.95, null), F(circ(152, 112.6, 1.8), '#e8c9a8', 0.97), F('M148.6 111.6L152 108.6L155.4 111.6Z', '#c9a46a', 0.95)]);
  // 29 foreground branch of brilliant red maple leaves (crowning)
  {
    const Rg: Region = [L(sm([[302, 6], [270, 16], [240, 30], [214, 40]], false), '#4f3a2c', 2), L(sm([[270, 16], [262, 34], [250, 50]], false), '#4f3a2c', 1.2), L(sm([[240, 30], [228, 50]], false), '#4f3a2c', 1)];
    let d1 = '', d2 = '';
    for (const [x, y, s, a] of [[214, 42, 8, 0.3], [226, 50, 7, 1.1], [240, 34, 8, 2.4], [250, 52, 8, 0.8], [262, 36, 7, 1.9], [272, 20, 8, 0.2], [286, 14, 7, 1.2], [256, 22, 6, 2.8], [232, 26, 6, 0.6], [292, 26, 6, 2.2]]) {
      if (s >= 7.5) d1 += maple(x, y, s, a); else d2 += maple(x, y, s, a);
    }
    Rg.push(F(d1, '#d8302a', 0.95, '#7e1a14'), F(d2, '#ee6a2e', 0.95, '#8a2a14'));
    R.push(Rg);
  }
  const defs = lin('sky', [[0, '#cfe0ea'], [1, '#f4e4c6']]) +
    lin('floor', [[0, '#d8c48e'], [1, '#b7ab68']]) +
    lin4('mist', [[0, '#ffffff', 0], [0.25, '#ffffff', 1], [0.75, '#ffffff', 1], [1, '#ffffff', 0]], 0, 0, 1, 0) +
    lin('stream', [[0, '#b7d4e0'], [1, '#6f9fb8']]) +
    lin4('ray', [[0, '#fff6d6', 0.9], [1, '#fff6d6', 0]], 1, 0, 0, 1);
  return { paper: '#f6efe1', defs, regions: R, seal: [282, 186] };
}

function starlitGarden(): Painting {
  const r = rng(808);
  const R: Region[] = [];
  // 0 night sky
  R.push([G(rect(0, 0, 300, 140), '@sky', 1)]);
  // 1 milky way
  R.push([F(sm([[150, -10], [200, 20], [250, 60], [300, 90], [306, 110], [270, 90], [210, 50], [160, 10]], true), '#b9b6e8', 0.1, null),
    G(blob(200, 34, 46, 12, r, 0.2, 10, 0.62), '#c9c4f0', 0.1), G(blob(258, 72, 40, 10, r, 0.2, 10, 0.62), '#c9c4f0', 0.1), G(blob(232, 52, 30, 6, r, 0.2, 10, 0.62), '#ffffff', 0.1)]);
  // 2 star field
  {
    const p: [number, number, number][] = [];
    for (let k = 0; k < 40; k++) p.push([r() * 300, r() * 120, 0.35 + r() * 0.6]);
    R.push([F(dots(p), '#f3f0ff', 0.85, null)]);
  }
  // 3 far hills
  R.push([F(ridge([[-5, 128], [40, 116], [90, 124], [140, 112], [190, 122], [240, 110], [305, 120]], 140), '#1d2747', 0.95)]);
  // 4 garden wall with tiled cap
  R.push([F(rect(-2, 128, 304, 12), '#2b3354', 0.95), F('M-2 128H302L298 124H2Z', '#1a2040', 0.95), L('M20 132v8M60 132v8M100 132v8M140 132v8M180 132v8M220 132v8M260 132v8', '#3a4468', 0.5)]);
  // 5 trees behind the wall
  R.push([F(blob(30, 118, 22, 14, r, 0.2) + blob(270, 116, 26, 16, r, 0.2) + blob(130, 122, 14, 8, r, 0.2), '#1b2a3e', 0.92)]);
  // 6 lawn
  R.push([G(rect(0, 140, 300, 60), '@lawn', 1), S('M0 140.5H300')]);
  // 7 pond
  R.push([F('M40 168C40 152 110 148 160 150C220 152 262 158 262 170C262 184 200 190 150 190C100 190 40 184 40 168Z', '@pond', 0.97, '#3a5a88')]);
  // 8 pond rocks
  R.push([F(blob(42, 170, 9, 5, r, 0.2) + blob(56, 182, 7, 4, r, 0.2) + blob(258, 176, 9, 5, r, 0.2) + blob(244, 186, 7, 3.6, r, 0.2) + blob(160, 191, 8, 3, r, 0.2), '#4a5670', 0.95)]);
  // 9 lotus pads
  R.push([F(pad(90, 172, 9, 2.6, -1.2) + pad(110, 180, 7, 2, -2) + pad(200, 166, 8, 2.4, -1) + pad(220, 176, 10, 2.8, -1.8), '#2f5a4c', 0.95)]);
  // 10 pine (right)
  R.push([L(sm([[286, 200], [282, 160], [276, 120], [272, 90]], false), '#2a2522', 3), F(blob(268, 92, 18, 5, r, 0.12) + blob(290, 110, 14, 4.4, r, 0.12) + blob(262, 120, 14, 4.4, r, 0.12) + blob(284, 76, 12, 4, r, 0.12), '#263a35', 0.95)]);
  // 11 plum tree trunk (left)
  R.push([L(sm([[14, 200], [20, 170], [16, 140], [30, 116], [52, 96]], false), '#3a2c2c', 3), L(sm([[22, 132], [44, 124], [70, 120]], false) + sm([[30, 116], [26, 92], [36, 72]], false), '#3a2c2c', 1.6), L(sm([[44, 124], [56, 110]], false) + sm([[52, 96], [74, 92]], false), '#3a2c2c', 1)]);
  // 12 plum blossoms
  {
    let d = '';
    for (const [x, y] of [[52, 96], [60, 108], [70, 120], [36, 72], [30, 86], [74, 92], [44, 124], [56, 110], [26, 98], [64, 98], [40, 80], [80, 116]]) {
      for (let k = 0; k < 5; k++) d += ell(x + Math.cos(k * 1.257) * 1.6, y + Math.sin(k * 1.257) * 1.6, 1.3, 1.3);
    }
    R.push([F(d, '#f6d6e2', 0.9, '#c9849c'), F(dots([[52, 96, 0.6], [70, 120, 0.6], [36, 72, 0.6], [74, 92, 0.6]]), '#f2c94a', 0.95, null)]);
  }
  // 13 stepping stones
  R.push([F(ell(140, 196, 9, 2.6) + ell(176, 192, 8, 2.4) + ell(204, 186, 7, 2.2), '#5a6480', 0.95)]);
  // 14 pavilion platform
  R.push([F(rect(196, 120, 46, 5), '#4a4058', 0.95), F(rect(194, 125, 50, 3), '#3a3248', 0.95)]);
  // 15 pillars with warm light inside
  R.push([G(rect(200, 102, 38, 18), '#ffcf7a', 0.35), F(rect(200, 100, 2.4, 20) + rect(218, 100, 2.4, 20) + rect(236, 100, 2.4, 20), '#5a3a34', 0.95)]);
  // 16 pavilion roof
  R.push([F(roof(190, 248, 101, 88, 4, 14), '#2e2a40', 0.97, '#14121e')]);
  // 17 roof finials and a hanging lantern
  R.push([F(circ(219, 86.6, 1.6), '#2e2a40', 0.97), L('M228 101v4', '#2e2a40', 0.6), F(ell(228, 108, 2.4, 3), '#ffc35a', 0.97, '#a8542a')]);
  // 18 stone lantern
  R.push([F(rect(66, 160, 12, 4) + rect(70, 148, 4, 12), '#6a7088', 0.95), F(rect(66, 140, 12, 8), '#6a7088', 0.95), F('M62 140L72 133L82 140Z', '#555b74', 0.95), F(rect(69.4, 142, 5.2, 4.4), '#ffd27a', 0.95, null)]);
  // 19 shrubs
  R.push([F(blob(30, 158, 16, 8, r, 0.2) + blob(110, 150, 12, 5, r, 0.2) + blob(250, 150, 14, 6, r, 0.2), '#22363a', 0.95)]);
  // 20 fireflies
  {
    const p: [number, number, number][] = [];
    for (let k = 0; k < 9; k++) p.push([30 + r() * 240, 120 + r() * 50, 0.9]);
    R.push([G(dots(p.map((q) => [q[0], q[1], 3.4] as [number, number, number])), '#d8f07a', 0.25), F(dots(p), '#efff9a', 0.95, null)]);
  }
  // 21 moon reflection
  R.push([F(ell(96, 168, 12, 3.4), '#f6e8b8', 0.65, null), L('M84 174h24M88 178h16M92 182h8', '#f6e8b8', 0.8, 0.5)]);
  // 22 moonlight shimmer
  R.push([L('M120 160h22M170 170h30M60 176h16M140 182h20M200 180h18', '#c9d6f2', 0.6, 0.5)]);
  // 23 thin clouds
  R.push([F(sm([[40, 64], [90, 60], [140, 63], [100, 67], [60, 68]], true), '#7f8cbf', 0.35, null), F(sm([[150, 34], [190, 31], [228, 34], [190, 37]], true), '#7f8cbf', 0.3, null)]);
  // 24 bright stars
  R.push([F(star4(170, 20, 3.4) + star4(250, 40, 2.8) + star4(30, 24, 2.6) + star4(210, 70, 2.2) + star4(130, 48, 2), '#fffbe8', 0.95, null)]);
  // 25 shooting star
  R.push([L('M230 16L268 6', '#ffffff', 0.9, 0.85), F(circ(230, 16, 1.2), '#ffffff', 0.97, null)]);
  // 26 owl on the pine
  R.push([F(ell(268, 84, 4.4, 5.6), '#5a4a3a', 0.97, '#2a2018'), F('M264 80l1-3 2 2ZM272 80l-1-3-2 2Z', '#5a4a3a', 0.97), F(circ(266.4, 82, 1.3) + circ(269.6, 82, 1.3), '#f2c94a', 0.97, null), F(circ(266.4, 82, 0.5) + circ(269.6, 82, 0.5), '#1a1410', 1, null)]);
  // 27 moon halo
  R.push([G(circ(96, 50, 46), '@halo', 0.9), S(ell(96, 50, 34, 34))]);
  // 28 lantern glow pools
  R.push([G(ell(72, 150, 22, 12), '@warm', 0.8), G(ell(219, 112, 34, 16), '@warm', 0.7), G(ell(228, 108, 8, 8), '@warm', 0.9)]);
  // 29 full moon (crowning)
  R.push([F(circ(96, 50, 21), '@moon', 0.98, '#d9c48a'), G(circ(90, 46, 4) + circ(103, 56, 3) + circ(100, 42, 2.4), '#e3d29e', 0.55), G(circ(90, 44, 12), '#ffffff', 0.25)]);
  const defs = lin('sky', [[0, '#0e1634'], [0.6, '#22305d'], [1, '#384879']]) +
    lin('pond', [[0, '#2e4c78'], [1, '#1a2d50']]) +
    lin('lawn', [[0, '#1d3436'], [1, '#14262a']]) +
    rad('halo', [[0, '#fff6d8', 0.55], [0.5, '#c9d4ff', 0.15], [1, '#c9d4ff', 0]]) +
    rad('warm', [[0, '#ffd27a', 0.8], [1, '#ffd27a', 0]]) +
    rad('moon', [[0, '#fffbea'], [0.7, '#fbefc4'], [1, '#f0dda2']]);
  return { paper: '#f3ede2', defs, regions: R, seal: [282, 186] };
}

const BUILDERS: (() => Painting)[] = [dawnPond, teaHouse, bambooTrail, mistyPeaks, sunsetHarbor, lanternMarket, mapleValley, starlitGarden];
const CACHE: (Painting | undefined)[] = [];

function painting(chapter: number): Painting {
  const i = ((chapter % BUILDERS.length) + BUILDERS.length) % BUILDERS.length;
  if (!CACHE[i]) CACHE[i] = BUILDERS[i]();
  return CACHE[i]!;
}

let autoId = 0;

function op(o: number | undefined, attr: string): string {
  return o !== undefined && o < 1 ? ' ' + attr + '="' + Math.round(o * 100) / 100 + '"' : '';
}

/** One <path> per shape: CSS shows it as a pencil outline until its region is painted. */
function shapeSVG(s: Sh, prefix: string): string {
  const fill = s.f.charAt(0) === '@' ? 'url(#' + prefix + s.f.slice(1) + ')' : s.f;
  const d = ' d="' + s.d + '" pathLength="1"';
  if (s.k === 's') return '<path class="s"' + d + '/>';
  if (s.k === 'l') return '<path class="l"' + d + ' stroke="' + fill + '" stroke-width="' + (s.w || 1) + '"' + op(s.o, 'stroke-opacity') + '/>';
  if (s.sk === false) return '<path class="g"' + d + ' fill="' + fill + '"' + op(s.o, 'fill-opacity') + '/>';
  let edge = s.e;
  if (edge === undefined) edge = s.f.charAt(0) === '#' ? hexDarken(s.f, 0.68) : null;
  return '<path class="f"' + d + ' fill="' + fill + '"' + op(s.o, 'fill-opacity') + (edge ? ' stroke="' + edge + '"' : '') + '/>';
}

/**
 * Painting for a chapter with its first `revealed` regions painted.
 * Returns an <svg class="pnt"> string (viewBox 0 0 300 200, scales to its container width).
 */
export function paintingSVG(chapter: number, revealed: number, opts?: { idPrefix?: string }): string {
  const P = painting(chapter);
  const prefix = (opts && opts.idPrefix ? opts.idPrefix : 'pn' + autoId++) + 'c' + chapter + '-';
  const rev = Math.max(0, Math.min(PAINTING_REGIONS, Math.floor(revealed)));
  let out = '<svg class="pnt' + (rev >= PAINTING_REGIONS ? ' done' : '') + '" viewBox="0 0 300 200" width="300" height="200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img">';
  out += '<defs>' + P.defs.split('§').join(prefix) +
    '<pattern id="' + prefix + 'tx" width="37" height="29" patternUnits="userSpaceOnUse"><path d="M3 5l7 1M20 3l4 3M30 12l5-1M8 17l6 2M22 22l-3 4M2 26l5-2M15 10l1 4M27 18l3 3" stroke="#a89474" stroke-width=".35" fill="none" stroke-opacity=".5"/></pattern>' +
    '</defs>';
  out += '<rect width="300" height="200" fill="' + P.paper + '"/>';
  for (let i = 0; i < PAINTING_REGIONS; i++) {
    const reg = P.regions[i] || [];
    let body = '';
    for (const sh of reg) body += shapeSVG(sh, prefix);
    out += '<g class="rg' + (i < rev ? ' on' : '') + '" data-i="' + i + '">' + body + '</g>';
  }
  // Paper grain over everything, then the artist's seal (shown once the painting is complete).
  out += '<rect width="300" height="200" fill="url(#' + prefix + 'tx)" opacity=".55" pointer-events="none"/>';
  const [sx, sy] = P.seal;
  out += '<g class="seal"><rect x="' + (sx - 7) + '" y="' + (sy - 7) + '" width="14" height="14" rx="2" fill="#c63b2d" fill-opacity=".88"/>' +
    '<path d="M' + (sx - 4) + ' ' + (sy - 3.5) + 'h8M' + (sx - 4) + ' ' + (sy + 3.5) + 'h8M' + sx + ' ' + (sy - 3.5) + 'v7M' + (sx - 4) + ' ' + sy + 'h3M' + (sx + 1) + ' ' + sy + 'h3" stroke="#f8e7dc" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>';
  out += '</svg>';
  return out;
}

/** Animate (or just set) region i from sketch to paint: pencil line draws in, then the colour washes in (~900 ms). */
export function revealRegion(svg: SVGSVGElement, i: number, animate: boolean): void {
  const g = svg.querySelector('.rg[data-i="' + i + '"]');
  if (!g) return;
  if (animate) {
    g.classList.remove('anim');
    void (g as SVGGElement).getBoundingClientRect();
    g.classList.add('on', 'anim');
  } else g.classList.add('on');
  if (svg.querySelectorAll('.rg.on').length >= PAINTING_REGIONS) {
    if (animate) setTimeout(() => svg.classList.add('done'), 700);
    else svg.classList.add('done');
  }
}

export const PAINTING_CSS = `
.pnt{display:block;width:100%;height:auto}
.pnt path{stroke-linecap:round;stroke-linejoin:round}
.pnt .l,.pnt .s{fill:none}
.pnt .f{stroke-opacity:.38;stroke-width:.7}
.pnt .s{stroke:#8c8273;stroke-width:.6;stroke-opacity:.16}
.pnt .rg:not(.on) path{fill:none;stroke:#8c8273;stroke-opacity:.8;stroke-width:.6}
.pnt .rg:not(.on) .g{display:none}
.pnt .seal{opacity:0;transition:opacity .6s ease .2s}
.pnt.done .seal{opacity:1}
.pnt .rg.anim path{stroke-dasharray:1;animation:pnt-draw .95s ease-out both}
.pnt .rg.anim .g{stroke-dasharray:none;animation:pnt-fade .6s .35s ease-out both}
.pnt .rg.anim{transform-box:fill-box;transform-origin:50% 60%;animation:pnt-bloom .9s ease-out both}
@keyframes pnt-draw{0%{stroke-dashoffset:1;stroke:#4d3f33;stroke-opacity:1;stroke-width:.9;fill-opacity:0}38%{stroke-dashoffset:0;stroke:#4d3f33;stroke-opacity:1;stroke-width:.9;fill-opacity:0}100%{stroke-dashoffset:0}}
@keyframes pnt-fade{0%{opacity:0}100%{opacity:1}}
@keyframes pnt-bloom{0%,35%{transform:scale(.985)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){.pnt .rg.anim,.pnt .rg.anim path,.pnt .rg.anim .g{animation-duration:.01s;animation-delay:0s}}
`;
