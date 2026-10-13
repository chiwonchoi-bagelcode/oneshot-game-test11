/* Generates the shared hanji paper texture (256×256, transparent fibres) once at boot. */
export function makePaperTexture(): string {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // soft mottling
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size, y = rnd() * size, r = 10 + rnd() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.025 + rnd() * 0.03;
    grd.addColorStop(0, `rgba(150,120,80,${a})`);
    grd.addColorStop(1, 'rgba(150,120,80,0)');
    g.fillStyle = grd;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save();
      g.translate(ox, oy);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  // fibres
  g.lineCap = 'round';
  for (let i = 0; i < 160; i++) {
    const x = rnd() * size, y = rnd() * size, len = 6 + rnd() * 22, a = rnd() * Math.PI;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '120,95,60' : '255,255,255'},${0.05 + rnd() * 0.08})`;
    g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * 6, y + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * 6, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // grain
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = rnd();
    if (n < 0.06) {
      img.data[i] = 110; img.data[i + 1] = 90; img.data[i + 2] = 60;
      img.data[i + 3] = Math.max(img.data[i + 3], 14 + n * 160);
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
