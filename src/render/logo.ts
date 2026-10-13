/*
 * Inkbloom emblem: a falling drop of ink that blooms into three watercolour petals (red, yellow,
 * blue). Where two petals overlap they mix (orange, violet, green) and where all three meet a
 * pale "bloom" opens with a small sparkle. Pure inline SVG, scales to any size, no text.
 */

let seq = 0;

const C = {
  R: '#e0482f', Y: '#f2b81c', B: '#2f62c4',
  O: '#f0862a', P: '#8e44a8', G: '#2ea25f',
  ink: '#25304a', bloom: '#fff6e2',
};

/** Slightly organic circle (watercolour edge) as a smooth closed path (cubic segments). */
function petal(cx: number, cy: number, r: number, phase: number): string {
  const n = 16;
  const pts: number[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const m = 1 + 0.018 * Math.sin(3 * a + phase) + 0.008 * Math.sin(5 * a + phase * 2);
    pts.push([cx + Math.cos(a) * r * m, cy + Math.sin(a) * r * m]);
  }
  const f = (v: number) => v.toFixed(2);
  let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (let k = 0; k < n; k++) {
    const p0 = pts[(k - 1 + n) % n], p1 = pts[k], p2 = pts[(k + 1) % n], p3 = pts[(k + 2) % n];
    d += 'C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + f(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
  }
  return d + 'Z';
}

/**
 * The emblem as an inline SVG string (viewBox 0 0 120 120, transparent background).
 * Ids are unique per call, so several copies can live on one page.
 */
export function logoMarkSVG(): string {
  const id = 'ibm' + (seq++).toString(36);
  const cx = 60, cy = 68, rr = 25, off = 15.5;
  const pos = [
    [cx - off * 0.866, cy - off * 0.5], // R (upper left)
    [cx + off * 0.866, cy - off * 0.5], // Y (upper right)
    [cx, cy + off],                     // B (bottom)
  ];
  const pR = petal(pos[0][0], pos[0][1], rr, 0.3);
  const pY = petal(pos[1][0], pos[1][1], rr, 2.1);
  const pB = petal(pos[2][0], pos[2][1], rr, 4.4);
  const drop = 'M60 6C63.5 13 68 18.5 68 24.5A8 8 0 0 1 52 24.5C52 18.5 56.5 13 60 6Z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<clipPath id="' + id + 'r"><path d="' + pR + '"/></clipPath>' +
    '<clipPath id="' + id + 'y"><path d="' + pY + '"/></clipPath>' +
    '<clipPath id="' + id + 'b"><path d="' + pB + '"/></clipPath>' +
    '<radialGradient id="' + id + 'g" cx=".36" cy=".32" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></radialGradient>' +
    '<radialGradient id="' + id + 'w"><stop offset="0" stop-color="' + C.bloom + '"/><stop offset=".7" stop-color="' + C.bloom + '" stop-opacity=".9"/><stop offset="1" stop-color="' + C.bloom + '" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="' + id + 'd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5fa0"/><stop offset="1" stop-color="' + C.ink + '"/></linearGradient>' +
    '</defs>' +
    // three primary petals, each with a soft light wash
    '<g stroke-width="1.9" stroke-linejoin="round" stroke-opacity=".9">' +
    '<path d="' + pR + '" fill="' + C.R + '" stroke="#b2331f"/>' +
    '<path d="' + pY + '" fill="' + C.Y + '" stroke="#c48a0e"/>' +
    '<path d="' + pB + '" fill="' + C.B + '" stroke="#1f4592"/>' +
    '</g>' +
    '<g fill="url(#' + id + 'g)"><path d="' + pR + '"/><path d="' + pY + '"/><path d="' + pB + '"/></g>' +
    '<g fill="#fff" fill-opacity=".14">' +
    '<path d="' + petal(pos[0][0] - 5, pos[0][1] - 4, rr * 0.6, 1.2) + '"/>' +
    '<path d="' + petal(pos[1][0] + 3, pos[1][1] - 5, rr * 0.58, 3.1) + '"/>' +
    '<path d="' + petal(pos[2][0] - 2, pos[2][1] + 5, rr * 0.6, 5.0) + '"/>' +
    '</g>' +
    // pairwise mixes (kept saturated: the "bloom" reward)
    '<path d="' + pY + '" fill="' + C.O + '" clip-path="url(#' + id + 'r)"/>' +
    '<path d="' + pB + '" fill="' + C.P + '" clip-path="url(#' + id + 'r)"/>' +
    '<path d="' + pB + '" fill="' + C.G + '" clip-path="url(#' + id + 'y)"/>' +
    // the bloom where all three meet
    '<g clip-path="url(#' + id + 'r)"><g clip-path="url(#' + id + 'y)"><path d="' + pB + '" fill="' + C.bloom + '"/></g></g>' +
    // darker wet edges of the mixes
    '<g fill="none" stroke-width="1.7" stroke-opacity=".6">' +
    '<path d="' + pY + '" stroke="#b85a10" clip-path="url(#' + id + 'r)"/>' +
    '<path d="' + pR + '" stroke="#b85a10" clip-path="url(#' + id + 'y)"/>' +
    '<path d="' + pB + '" stroke="#5f2a70" clip-path="url(#' + id + 'r)"/>' +
    '<path d="' + pR + '" stroke="#5f2a70" clip-path="url(#' + id + 'b)"/>' +
    '<path d="' + pB + '" stroke="#1f6a3e" clip-path="url(#' + id + 'y)"/>' +
    '<path d="' + pY + '" stroke="#1f6a3e" clip-path="url(#' + id + 'b)"/>' +
    '</g>' +
    // falling drop (light rim keeps it readable on dark backgrounds) and two splash droplets
    '<path d="' + drop + '" fill="url(#' + id + 'd)" stroke="#fff6e2" stroke-opacity=".85" stroke-width="1.4"/>' +
    '<ellipse cx="57.4" cy="21.5" rx="2" ry="3.4" fill="#fff" fill-opacity=".6" transform="rotate(-20 57.4 21.5)"/>' +
    '<circle cx="33" cy="31" r="2.4" fill="' + C.R + '"/><circle cx="88" cy="30" r="2.1" fill="' + C.Y + '"/><circle cx="27" cy="39" r="1.4" fill="' + C.R + '" fill-opacity=".8"/>' +
    // sparkle in the bloom
    '<circle cx="' + cx + '" cy="' + (cy - 0.5) + '" r="7" fill="url(#' + id + 'w)"/>' +
    '<path d="M60 60.5Q61 66.5 67 67.5Q61 68.5 60 74.5Q59 68.5 53 67.5Q59 66.5 60 60.5Z" fill="#fff"/>' +
    '</svg>';
}
