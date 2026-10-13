/*
 * Title screen: logo over slowly blooming watercolour washes (multiply blending mixes them like
 * real pigment). One tap starts; first-time players go straight into level 1.
 */
import { h, onTap } from '../ui/dom.ts';
import { go, type Screen } from '../ui/router.ts';
import { logoMarkSVG } from '../render/logo.ts';
import { t, onLangChange } from '../i18n/i18n.ts';
import { audio } from '../audio/index.ts';
import { nextLevelIndex, clearedCount } from '../state/progress.ts';

const COLORS = ['#e5483b', '#f3b72c', '#2f6fd6'];

interface Bloom { x: number; y: number; r: number; max: number; c: string; born: number; life: number }

export function createTitleScreen(): Screen {
  const canvas = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%' } }) as HTMLCanvasElement;
  const mark = h('div.title-mark', { html: logoMarkSVG() });
  const name = h('h1.title-name', { text: t('app.name') });
  const tag = h('div.title-tag', { text: t('app.tagline') });
  const tap = h('div.title-tap', { text: t('app.tapToStart') });
  const el = h('section.title-screen', null, canvas, h('div.title-center', null, mark, name, tag), tap);
  const style = h('style', {
    text: `
.title-screen { background: var(--paper); }
.title-center { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: calc(var(--safe-top) + 20px) 24px 0; }
.title-mark { width: 148px; height: 148px; filter: drop-shadow(0 10px 18px rgba(90,50,20,.25)); animation: mark-in 900ms cubic-bezier(.2,1.2,.3,1) both; }
.title-mark svg { width: 100%; height: 100%; display: block; }
.title-name { margin: 10px 0 0; font-size: 52px; font-weight: 900; letter-spacing: -0.04em; color: var(--ink); line-height: 1; animation: rise 700ms 150ms ease both; }
.title-tag { font-size: 17px; font-weight: 700; color: var(--ink-2); letter-spacing: .02em; animation: rise 700ms 300ms ease both; }
.title-tap { position: relative; z-index: 1; margin: 0 auto calc(var(--safe-bottom) + 64px); padding: 14px 26px; border-radius: 28px; background: rgba(255,250,242,.85); box-shadow: inset 0 0 0 2px var(--line); font-size: 17px; font-weight: 800; color: var(--ink); animation: breathe 1.8s ease-in-out infinite, rise 700ms 600ms ease both; }
@keyframes mark-in { from { opacity: 0; transform: scale(.6) rotate(-10deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
`,
  });
  el.appendChild(style);

  const ctx = canvas.getContext('2d')!;
  let blooms: Bloom[] = [];
  let raf = 0;
  let last = 0;
  let nextSpawn = 0;
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = el.clientWidth;
    H = el.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(now: number) {
    const c = COLORS[Math.floor(Math.random() * 3)];
    const edge = Math.random();
    const x = edge < 0.5 ? Math.random() * W : (Math.random() < 0.5 ? -20 : W + 20);
    const y = edge < 0.5 ? (Math.random() < 0.5 ? H * (0.05 + Math.random() * 0.2) : H * (0.75 + Math.random() * 0.25)) : Math.random() * H;
    blooms.push({ x, y, r: 0, max: 90 + Math.random() * 120, c, born: now, life: 9000 + Math.random() * 5000 });
    if (blooms.length > 9) blooms.shift();
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30 fps is plenty for slow washes
    last = now;
    if (now > nextSpawn) {
      spawn(now);
      nextSpawn = now + 1400 + Math.random() * 1200;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    for (const b of blooms) {
      const age = (now - b.born) / b.life;
      if (age > 1) continue;
      const grow = 1 - Math.pow(1 - Math.min(1, age * 2.2), 3);
      const r = b.max * grow;
      const alpha = Math.min(1, age * 6) * (1 - Math.max(0, (age - 0.6) / 0.4)) * 0.42;
      const g = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r);
      g.addColorStop(0, hexA(b.c, alpha * 0.55));
      g.addColorStop(0.82, hexA(b.c, alpha * 0.75));
      g.addColorStop(1, hexA(b.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    blooms = blooms.filter((b) => now - b.born < b.life);
  }

  let started = false;
  onTap(el, () => {
    if (started) return;
    started = true;
    audio.unlock();
    const first = clearedCount() === 0;
    if (first) go('play', { index: 0 }, { resetHistory: true });
    else go('journey', undefined, { resetHistory: true });
  });

  onLangChange(() => {
    name.textContent = t('app.name');
    tag.textContent = t('app.tagline');
    tap.textContent = t('app.tapToStart');
  });

  return {
    id: 'title',
    el,
    show() {
      started = false;
      resize();
      const now = performance.now();
      blooms = [];
      for (let i = 0; i < 5; i++) {
        spawn(now - i * 1800);
      }
      nextSpawn = now + 600;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      void nextLevelIndex;
    },
    hide() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
