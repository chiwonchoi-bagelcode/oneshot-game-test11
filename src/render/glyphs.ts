/*
 * Colour-blind symbols. Each primary has one stroke and a mix is drawn as the union of its parts:
 *   R = vertical bar   Y = horizontal bar   B = diagonal '/'
 *   O = R+Y (plus)     P = R+B              G = Y+B           K = all three
 * Because mixing is a bitwise OR of colours, the glyph of a mix is the overlay of its parents.
 */

// Strokes in a unit box centred on 0 (x right, y down), extent about 1.6.
const BAR_V = [0, -0.8, 0, 0.8];
const BAR_H = [-0.8, 0, 0.8, 0];
const DIAG = [-0.6, 0.6, 0.6, -0.6];

function strokesFor(color: number): number[][] {
  const out: number[][] = [];
  if (color & 1) out.push(BAR_V);
  if (color & 2) out.push(BAR_H);
  if (color & 4) out.push(DIAG);
  return out;
}

/**
 * Draws the glyph of `color` (1..7) centred at (cx, cy) inside a `size` square.
 * Line width scales with size (min 1.4 px). Uses round caps; leaves the context state as it was
 * except for path, strokeStyle and lineWidth.
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, color: number, cx: number, cy: number, size: number, strokeColor: string): void {
  const st = strokesFor(color);
  if (!st.length) return;
  const h = size / 2;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1.4, size * 0.15);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of st) {
    ctx.moveTo(cx + s[0] * h, cy + s[1] * h);
    ctx.lineTo(cx + s[2] * h, cy + s[3] * h);
  }
  ctx.stroke();
}

/** Inline SVG of a glyph (stroke = currentColor) for DOM use: ink queue chips, tutorial cards. */
export function glyphSVG(color: number, size: number): string {
  const st = strokesFor(color);
  let d = '';
  for (const s of st) {
    const f = (v: number) => (12 + v * 10).toFixed(1).replace('.0', '');
    d += 'M' + f(s[0]) + ' ' + f(s[1]) + 'L' + f(s[2]) + ' ' + f(s[3]);
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
}
