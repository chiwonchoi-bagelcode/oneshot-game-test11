/*
 * Hand-made SVG icon set (24×24 grid). Monochrome icons use currentColor; currency/item icons
 * have their own colours so they stay recognisable everywhere.
 */

function gearPath(): string {
  const cx = 12, cy = 12, teeth = 8, rOut = 10, rIn = 7.6;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    const pts = [
      [rIn, a0 - step * 0.5],
      [rIn, a0 - step * 0.28],
      [rOut, a0 - step * 0.18],
      [rOut, a0 + step * 0.18],
      [rIn, a0 + step * 0.28],
    ];
    for (const [r, a] of pts) {
      const x = (cx + Math.cos(a) * r).toFixed(2), y = (cy + Math.sin(a) * r).toFixed(2);
      d += (d ? 'L' : 'M') + x + ' ' + y;
    }
  }
  return d + 'Z';
}

const S = (body: string, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

const DROP = 'M12 2.8C12 2.8 5.6 9.9 5.6 14.2a6.4 6.4 0 0 0 12.8 0C18.4 9.9 12 2.8 12 2.8z';

export const ICONS = {
  coin: S(`<circle cx="12" cy="12" r="10" fill="#f5b83a"/><circle cx="12" cy="12" r="10" fill="none" stroke="#c98714" stroke-width="1.6"/><circle cx="12" cy="12" r="7" fill="#ffd36b" stroke="#e0a024" stroke-width="1.2"/><path d="M12 7.6s-3 3.4-3 5.3a3 3 0 0 0 6 0c0-1.9-3-5.3-3-5.3z" fill="#d48f1a"/><path d="M10.6 12.6a1.4 1.4 0 0 0 1 1.5" stroke="#ffe7a8" stroke-width="1" fill="none" stroke-linecap="round"/>`),
  hint: S(`<path d="M12 2.6a6.6 6.6 0 0 0-4 11.9c.7.6 1.1 1.3 1.1 2.1v.9h5.8v-.9c0-.8.4-1.5 1.1-2.1A6.6 6.6 0 0 0 12 2.6z" fill="#ffd45e" stroke="#d1951a" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.6 9.4a2.8 2.8 0 0 1 2.4-2.6" stroke="#fff4c8" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M9.2 18.6h5.6v1.1a1.9 1.9 0 0 1-1.9 1.9h-1.8a1.9 1.9 0 0 1-1.9-1.9z" fill="#6f6578"/><path d="M10 14.6l2-2.4 2 2.4" stroke="#d1951a" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  rewind: S(`<circle cx="12" cy="12" r="10" fill="#4b7fe0"/><g transform="translate(24 0) scale(-1 1)"><path d="M16.8 12a4.8 4.8 0 1 1-1.4-3.4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M15.6 5.4l-.2 3.6-3.6-.2" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`),
  seal: S(`<rect x="3" y="3" width="18" height="18" rx="3.5" fill="#d9442e"/><rect x="5.3" y="5.3" width="13.4" height="13.4" rx="2" fill="none" stroke="#fbe3d8" stroke-width="1.3"/><path d="M12 7.2s-3.6 3.9-3.6 6.1a3.6 3.6 0 0 0 7.2 0c0-2.2-3.6-6.1-3.6-6.1z" fill="#fbe3d8"/><path d="M10.6 13.6a1.5 1.5 0 0 0 1 1.4" stroke="#d9442e" stroke-width="1" fill="none" stroke-linecap="round"/>`),
  sealEmpty: S(`<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.4"/>`),
  gear: S(`<path d="${gearPath()}" fill="currentColor"/><circle cx="12" cy="12" r="3.3" fill="var(--ic-hole, #fffaf1)"/>`),
  close: S(`<path d="M6 6l12 12M18 6L6 18" ${stroke} stroke-width="2.8"/>`),
  back: S(`<path d="M15 4.5L7.5 12l7.5 7.5" ${stroke} stroke-width="2.8"/>`),
  next: S(`<path d="M9 4.5l7.5 7.5L9 19.5" ${stroke} stroke-width="2.8"/>`),
  pause: S(`<rect x="6" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/>`),
  play: S(`<path d="M7.5 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L9 3.94a1 1 0 0 0-1.5.86z" fill="currentColor"/>`),
  restart: S(`<path d="M19.4 12.6a7.5 7.5 0 1 1-2.2-6" ${stroke} stroke-width="2.6"/><path d="M18.6 3.2v4.4h-4.4" ${stroke} stroke-width="2.6"/>`),
  journey: S(`<path d="M3 6.2l5.6-2.2 6.8 2.4L21 4.2v13.6l-5.6 2.2-6.8-2.4L3 19.8z" fill="currentColor" opacity=".18"/><path d="M3 6.2l5.6-2.2 6.8 2.4L21 4.2v13.6l-5.6 2.2-6.8-2.4L3 19.8z" ${stroke}/><path d="M8.6 4v13.6M15.4 6.4V20" ${stroke} stroke-width="1.8"/><circle cx="12" cy="11" r="1.6" fill="currentColor"/>`),
  daily: S(`<rect x="3.2" y="4.6" width="17.6" height="16" rx="3" fill="currentColor" opacity=".18"/><rect x="3.2" y="4.6" width="17.6" height="16" rx="3" ${stroke}/><path d="M3.2 9.4h17.6M8 2.8v3.6M16 2.8v3.6" ${stroke}/><path d="M12 11.6s-2.6 2.9-2.6 4.6a2.6 2.6 0 0 0 5.2 0c0-1.7-2.6-4.6-2.6-4.6z" fill="currentColor"/>`),
  gallery: S(`<rect x="2.8" y="4" width="18.4" height="16" rx="2.6" fill="currentColor" opacity=".18"/><rect x="2.8" y="4" width="18.4" height="16" rx="2.6" ${stroke}/><path d="M4 17.6l5-5.4 3.6 3.6 2.6-2.6 4.6 4.4" ${stroke}/><circle cx="15.8" cy="8.8" r="1.8" fill="currentColor"/>`),
  shop: S(`<path d="M4 9.6h16v9.6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.2z" fill="currentColor" opacity=".18"/><path d="M4 9.6v9.6a1.6 1.6 0 0 0 1.6 1.6h12.8a1.6 1.6 0 0 0 1.6-1.6V9.6" ${stroke}/><path d="M3 9.2L4.8 3.6h14.4L21 9.2a2.4 2.4 0 0 1-4.5 1 2.4 2.4 0 0 1-4.5 0 2.4 2.4 0 0 1-4.5 0A2.4 2.4 0 0 1 3 9.2z" fill="currentColor"/><path d="M9.6 20.6v-5a2.4 2.4 0 0 1 4.8 0v5" ${stroke}/>`),
  lock: S(`<rect x="5" y="10.4" width="14" height="10.4" rx="2.6" fill="currentColor"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" ${stroke} stroke-width="2.4"/><circle cx="12" cy="15.4" r="1.6" fill="var(--ic-hole, #fffaf1)"/>`),
  check: S(`<path d="M4.8 12.6l4.6 4.6 9.8-10.4" ${stroke} stroke-width="3"/>`),
  plus: S(`<path d="M12 5v14M5 12h14" ${stroke} stroke-width="3.2"/>`),
  music: S(`<path d="M9 18.2V5.6l10.4-2.2v12.4" ${stroke}/><ellipse cx="6.6" cy="18.2" rx="2.8" ry="2.3" fill="currentColor"/><ellipse cx="17" cy="15.8" rx="2.8" ry="2.3" fill="currentColor"/>`),
  sound: S(`<path d="M3.6 9.2h3.6L12 5v14l-4.8-4.2H3.6z" fill="currentColor"/><path d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8M18 6a8.2 8.2 0 0 1 0 12" ${stroke}/>`),
  vibrate: S(`<rect x="7.6" y="3.2" width="8.8" height="17.6" rx="2.2" ${stroke}/><path d="M11 17.4h2" ${stroke}/><path d="M3.6 8.4v7.2M20.4 8.4v7.2M1.4 10.4v3.2M22.6 10.4v3.2" ${stroke} stroke-width="1.8"/>`),
  symbols: S(`<circle cx="12" cy="12" r="9" ${stroke}/><path d="M12 6.6v10.8M6.6 12h10.8M8.2 15.8l7.6-7.6" ${stroke} stroke-width="2"/>`),
  language: S(`<circle cx="12" cy="12" r="9" ${stroke}/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" ${stroke} stroke-width="1.8"/>`),
  tempo: S(`<path d="M8.4 3.6h7.2l3.6 16.8H4.8z" fill="currentColor" opacity=".18"/><path d="M8.4 3.6h7.2l3.6 16.8H4.8z" ${stroke}/><path d="M12 16.4l4.6-9.4" ${stroke}/><circle cx="12" cy="16.4" r="1.6" fill="currentColor"/>`),
  motion: S(`<path d="M4 12h3M17 12h3M12 4v3M12 17v3" ${stroke}/><circle cx="12" cy="12" r="3.4" fill="currentColor"/>`),
  info: S(`<circle cx="12" cy="12" r="9.4" fill="currentColor"/><path d="M12 10.8v6" stroke="var(--ic-hole, #fffaf1)" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.6" fill="var(--ic-hole, #fffaf1)"/>`),
  help: S(`<circle cx="12" cy="12" r="9.4" fill="currentColor"/><path d="M9.4 9.4a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1 .8-1 1.5v.6" stroke="var(--ic-hole, #fffaf1)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.5" fill="var(--ic-hole, #fffaf1)"/>`),
  gift: S(`<rect x="3.4" y="8.4" width="17.2" height="4.4" rx="1.2" fill="#e05a3f"/><rect x="4.8" y="12.8" width="14.4" height="8" rx="1.4" fill="#f07a5c"/><rect x="10.6" y="8.4" width="2.8" height="12.4" fill="#ffd36b"/><path d="M12 8.2C10.6 4.4 6.6 4.6 7.4 6.8c.6 1.4 3.2 1.6 4.6 1.4zM12 8.2c1.4-3.8 5.4-3.6 4.6-1.4-.6 1.4-3.2 1.6-4.6 1.4z" fill="#ffd36b" stroke="#d1951a" stroke-width="1"/>`),
  ad: S(`<rect x="2.6" y="5" width="18.8" height="14" rx="3.4" fill="currentColor"/><path d="M10 9v6l5.2-3z" fill="var(--ic-hole, #fffaf1)"/>`),
  streak: S(`<path d="M12 2.4c.6 3-1.8 4.6-3.6 7.2-1.4 2-2 3.6-2 5.2a5.6 5.6 0 0 0 11.2 0c0-3-1.8-5-2.8-6.2-.2 1.6-.8 2.6-1.8 3.2.4-3.2-.2-6.6-1-9.4z" fill="#f08a3a"/><path d="M12 12.4c-1.4 1.6-2.4 2.8-2.4 4.2a2.4 2.4 0 0 0 4.8 0c0-1.4-1-2.8-2.4-4.2z" fill="#ffd36b"/>`),
  brush: S(`<path d="M14.6 3.2l6.2 6.2-7.6 7.4-6-6z" fill="currentColor" opacity=".25"/><path d="M14.6 3.2l6.2 6.2-7.6 7.4-6-6z" ${stroke}/><path d="M7.2 10.8c-2.4 0-4.2 1.8-4.2 4.6 0 2.2-.6 3.4-1.2 4.4 3.8.6 8.6-.4 9.6-3.6" fill="currentColor"/>`),
  paper: S(`<path d="M5.6 2.8h9l4.8 4.8v12a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.6V4.4a1.6 1.6 0 0 1 1.6-1.6z" fill="currentColor" opacity=".18"/><path d="M5.6 2.8h9l4.8 4.8v12a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.6V4.4a1.6 1.6 0 0 1 1.6-1.6z" ${stroke}/><path d="M14.4 3v4.8h4.8M7.6 12.4h8.8M7.6 16h6" ${stroke} stroke-width="1.8"/>`),
  drop: S(`<path d="${DROP}" fill="currentColor"/>`),
  chest: S(`<path d="M3.4 10.2a5.2 5.2 0 0 1 5.2-5.2h6.8a5.2 5.2 0 0 1 5.2 5.2v1H3.4z" fill="#b5652f"/><rect x="3.4" y="11.2" width="17.2" height="8.6" rx="1.6" fill="#d98a45"/><path d="M3.4 11.2h17.2" stroke="#7a3f18" stroke-width="1.4"/><rect x="10.2" y="9.6" width="3.6" height="4.6" rx="1" fill="#ffd36b" stroke="#c98714" stroke-width="1"/>`),
  restore: S(`<path d="M4.6 12a7.4 7.4 0 0 1 12.8-5" ${stroke}/><path d="M19.4 12a7.4 7.4 0 0 1-12.8 5" ${stroke}/><path d="M17.6 3.4V7.4h-4M6.4 20.6v-4h4" ${stroke}/>`),
  doc: S(`<path d="M6 2.8h8.4L19 7.4v12.2a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V4.4A1.6 1.6 0 0 1 6 2.8z" ${stroke}/><path d="M8 11h8M8 14.6h8M8 18h5" ${stroke} stroke-width="1.8"/>`),
  hand: S(`<path d="M9.2 13.4V4.6a1.8 1.8 0 0 1 3.6 0v6.2l.2-.1a1.8 1.8 0 0 1 3 .9l.1.2a1.8 1.8 0 0 1 3 1.2v4.4a6.4 6.4 0 0 1-6.4 6.4h-.8a6.4 6.4 0 0 1-5.2-2.6l-2.9-4a1.8 1.8 0 0 1 2.7-2.4z" fill="#fff" stroke="#2b2733" stroke-width="1.6" stroke-linejoin="round"/><path d="M12.8 10.8v3.4M16 11.8v2.6" stroke="#2b2733" stroke-width="1.4" stroke-linecap="round"/>`),
  star: S(`<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/>`),
  trash: S(`<path d="M4.6 6.6h14.8M9.4 6.4V4.2h5.2v2.2M6.4 6.6l1 13.2a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l1-13.2" ${stroke}/>`),
  bug: S(`<ellipse cx="12" cy="13.6" rx="5.4" ry="6.6" fill="currentColor"/><path d="M12 7v13M6.6 11H3M17.4 11H21M6.6 15.6H3.4M17.4 15.6h3.2M9 4.4l1.4 2.4M15 4.4l-1.4 2.4" ${stroke} stroke-width="1.8"/>`),
  calendarCheck: S(`<rect x="3.2" y="4.6" width="17.6" height="16" rx="3" ${stroke}/><path d="M3.2 9.4h17.6M8 2.8v3.6M16 2.8v3.6" ${stroke}/><path d="M8.6 14.6l2.4 2.4 4.6-4.8" ${stroke}/>`),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): string {
  const s = ICONS[name];
  return cls ? s.replace('class="ic"', `class="ic ${cls}"`) : s;
}
