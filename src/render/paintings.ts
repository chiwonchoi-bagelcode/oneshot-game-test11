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

const BUILDERS: (() => Painting)[] = [dawnPond];
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
