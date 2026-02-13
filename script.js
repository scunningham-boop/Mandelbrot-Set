const canvas = document.getElementById("mandelbrot");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

const iterationsInput = document.getElementById("iterations");
const iterationValue = document.getElementById("iterationValue");
const zoomFactorInput = document.getElementById("zoomFactor");
const resetButton = document.getElementById("resetButton");
const renderButton = document.getElementById("renderButton");
const viewInfo = document.getElementById("viewInfo");

const initialView = {
  minRe: -2.5,
  maxRe: 1.0,
  minIm: -1.25,
  maxIm: 1.25,
};

let view = { ...initialView };
let isDragging = false;
let dragStart = null;
let dragCurrent = null;

function toComplex(x, y) {
  const re = view.minRe + (x / (canvas.width - 1)) * (view.maxRe - view.minRe);
  const im = view.maxIm - (y / (canvas.height - 1)) * (view.maxIm - view.minIm);
  return { re, im };
}

function zoomAtPixel(x, y, zoomFactor) {
  const point = toComplex(x, y);
  const width = (view.maxRe - view.minRe) / zoomFactor;
  const height = (view.maxIm - view.minIm) / zoomFactor;

  view = {
    minRe: point.re - width / 2,
    maxRe: point.re + width / 2,
    minIm: point.im - height / 2,
    maxIm: point.im + height / 2,
  };
}

function applyDragZoom() {
  const left = Math.min(dragStart.x, dragCurrent.x);
  const right = Math.max(dragStart.x, dragCurrent.x);
  const top = Math.min(dragStart.y, dragCurrent.y);
  const bottom = Math.max(dragStart.y, dragCurrent.y);

  if (right - left < 5 || bottom - top < 5) {
    return;
  }

  const c1 = toComplex(left, top);
  const c2 = toComplex(right, bottom);
  view = {
    minRe: Math.min(c1.re, c2.re),
    maxRe: Math.max(c1.re, c2.re),
    minIm: Math.min(c1.im, c2.im),
    maxIm: Math.max(c1.im, c2.im),
  };
}

function pixelColor(iter, maxIter) {
  if (iter === maxIter) {
    return [0, 0, 0, 255];
  }

  const t = iter / maxIter;
  const r = Math.floor(9 * (1 - t) * t * t * t * 255);
  const g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
  const b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
  return [r, g, b, 255];
}

function renderMandelbrot() {
  const maxIter = Number(iterationsInput.value);
  const image = ctx.createImageData(canvas.width, canvas.height);
  const pixels = image.data;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const c = toComplex(x, y);
      let zr = 0;
      let zi = 0;
      let iter = 0;

      while (zr * zr + zi * zi <= 4 && iter < maxIter) {
        const temp = zr * zr - zi * zi + c.re;
        zi = 2 * zr * zi + c.im;
        zr = temp;
        iter += 1;
      }

      const idx = (y * canvas.width + x) * 4;
      const [r, g, b, a] = pixelColor(iter, maxIter);
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
  }

  ctx.putImageData(image, 0, 0);
  updateViewInfo(maxIter);
}

function updateViewInfo(maxIter) {
  const width = view.maxRe - view.minRe;
  viewInfo.textContent = `Real: [${view.minRe.toFixed(8)}, ${view.maxRe.toFixed(8)}] | Imaginary: [${view.minIm.toFixed(8)}, ${view.maxIm.toFixed(8)}] | Window width: ${width.toExponential(3)} | Iterations: ${maxIter}`;
}

function drawSelection() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!isDragging || !dragStart || !dragCurrent) {
    return;
  }

  const x = Math.min(dragStart.x, dragCurrent.x);
  const y = Math.min(dragStart.y, dragCurrent.y);
  const w = Math.abs(dragCurrent.x - dragStart.x);
  const h = Math.abs(dragCurrent.y - dragStart.y);

  overlayCtx.strokeStyle = "#80d8ff";
  overlayCtx.fillStyle = "rgba(128, 216, 255, 0.2)";
  overlayCtx.lineWidth = 2;
  overlayCtx.fillRect(x, y, w, h);
  overlayCtx.strokeRect(x, y, w, h);
}

function getCanvasPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("mousedown", (event) => {
  isDragging = true;
  dragStart = getCanvasPosition(event);
  dragCurrent = dragStart;
  drawSelection();
});

window.addEventListener("mousemove", (event) => {
  if (!isDragging) {
    return;
  }
  dragCurrent = getCanvasPosition(event);
  drawSelection();
});

window.addEventListener("mouseup", () => {
  if (!isDragging) {
    return;
  }

  isDragging = false;
  drawSelection();

  if (dragStart && dragCurrent) {
    const distance = Math.hypot(dragCurrent.x - dragStart.x, dragCurrent.y - dragStart.y);
    if (distance > 5) {
      applyDragZoom();
      renderMandelbrot();
    }
  }

  dragStart = null;
  dragCurrent = null;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
});

canvas.addEventListener("click", (event) => {
  if (isDragging) {
    return;
  }

  const position = getCanvasPosition(event);
  const baseZoom = Number(zoomFactorInput.value) || 2;
  const zoom = event.shiftKey ? 1 / baseZoom : baseZoom;
  zoomAtPixel(position.x, position.y, zoom);
  renderMandelbrot();
});

iterationsInput.addEventListener("input", () => {
  iterationValue.textContent = iterationsInput.value;
});

renderButton.addEventListener("click", renderMandelbrot);

resetButton.addEventListener("click", () => {
  view = { ...initialView };
  renderMandelbrot();
});

iterationValue.textContent = iterationsInput.value;
renderMandelbrot();
