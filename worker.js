// Worker does heavy escape-time math off the UI thread so interactions stay responsive.
self.onmessage = (event) => {
  const task = event.data;
  if (task.type !== 'renderBand') return;

  const {
    renderId,
    x0,
    y0,
    width,
    height,
    internalWidth,
    internalHeight,
    canvasWidth,
    canvasHeight,
    centerRe,
    centerIm,
    scale,
    maxIter,
    palette
  } = task;

  const pixels = new Uint8ClampedArray(width * height * 4);
  const ratioX = canvasWidth / internalWidth;
  const ratioY = canvasHeight / internalHeight;

  for (let row = 0; row < height; row++) {
    const py = y0 + row;
    for (let col = 0; col < width; col++) {
      const px = x0 + col;

      // Map internal render pixel -> screen pixel -> complex plane.
      const sx = (px + 0.5) * ratioX;
      const sy = (py + 0.5) * ratioY;
      const cRe = centerRe + (sx - canvasWidth / 2) * scale;
      const cIm = centerIm + (sy - canvasHeight / 2) * scale;

      // Escape-time iteration for Mandelbrot: z(n+1) = z(n)^2 + c.
      let zRe = 0;
      let zIm = 0;
      let zRe2 = 0;
      let zIm2 = 0;
      let i = 0;

      while (i < maxIter && zRe2 + zIm2 <= 4) {
        zIm = 2 * zRe * zIm + cIm;
        zRe = zRe2 - zIm2 + cRe;
        zRe2 = zRe * zRe;
        zIm2 = zIm * zIm;
        i++;
      }

      const p = (row * width + col) * 4;
      if (i >= maxIter) {
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 255;
        continue;
      }

      // Smooth coloring uses a continuous iteration count for smoother gradients.
      const logZn = Math.log(zRe2 + zIm2) / 2;
      const nu = Math.log(logZn / Math.log(2)) / Math.log(2);
      const smoothIter = i + 1 - nu;
      const t = Math.max(0, Math.min(1, smoothIter / maxIter));

      const [r, g, b] = paletteColor(palette, t);
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }
  }

  self.postMessage({ renderId, x0, y0, width, height, internalWidth, internalHeight, pixels }, [pixels.buffer]);
};

function paletteColor(name, t) {
  if (name === 'ocean') {
    return hslToRgb(200 + 130 * t, 75, 25 + 55 * t);
  }
  if (name === 'sunset') {
    return hslToRgb(320 - 210 * t, 88, 35 + 45 * t);
  }
  return hslToRgb(290 + 360 * t, 80, 30 + 50 * t);
}

function hslToRgb(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}
