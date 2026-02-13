const canvas = document.getElementById('fractalCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const wrap = document.getElementById('canvasWrap');
const selectionBox = document.getElementById('selectionBox');

const controls = {
  resetBtn: document.getElementById('resetBtn'),
  undoBtn: document.getElementById('undoBtn'),
  saveBtn: document.getElementById('saveBtn'),
  panMode: document.getElementById('panMode'),
  iterSlider: document.getElementById('iterSlider'),
  iterValue: document.getElementById('iterValue'),
  qualitySlider: document.getElementById('qualitySlider'),
  qualityValue: document.getElementById('qualityValue'),
  paletteSelect: document.getElementById('paletteSelect'),
  centerReadout: document.getElementById('centerReadout'),
  zoomReadout: document.getElementById('zoomReadout'),
  iterReadout: document.getElementById('iterReadout'),
  paletteReadout: document.getElementById('paletteReadout'),
  statusLine: document.getElementById('statusLine')
};

const state = {
  centerRe: -0.5,
  centerIm: 0,
  scale: 0.003,
  maxIter: 500,
  quality: 1,
  palette: 'classic',
  workers: [],
  renderId: 0,
  pendingTasks: [],
  totalTasks: 0,
  doneTasks: 0,
  renderStartMs: 0,
  undoStack: [],
  isSpaceDown: false,
  drag: null
};

const bandCanvas = document.createElement('canvas');
const bandCtx = bandCanvas.getContext('2d', { alpha: false });

initWorkers();
bindEvents();
applyURLView();
resizeCanvas();
renderScene();

function initWorkers() {
  const workerCount = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker('worker.js');
    const entry = { worker, busy: false };
    worker.onmessage = (e) => handleBandMessage(entry, e.data);
    state.workers.push(entry);
  }
}

function bindEvents() {
  window.addEventListener('resize', () => {
    resizeCanvas();
    renderScene();
  });

  controls.iterSlider.addEventListener('input', () => {
    state.maxIter = clamp(Number(controls.iterSlider.value), 50, 2000);
    updateReadouts();
    renderScene();
  });

  controls.qualitySlider.addEventListener('input', () => {
    state.quality = clamp(Number(controls.qualitySlider.value), 0.25, 1);
    updateReadouts();
    renderScene();
  });

  controls.paletteSelect.addEventListener('change', () => {
    state.palette = controls.paletteSelect.value;
    updateReadouts();
    renderScene();
  });

  controls.resetBtn.addEventListener('click', () => {
    pushUndo();
    resetView();
    renderScene();
  });

  controls.undoBtn.addEventListener('click', undoView);
  controls.saveBtn.addEventListener('click', saveViewURL);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    pushUndo();
    const factor = Math.exp(e.deltaY * 0.0014);
    zoomAtPoint(e.offsetX, e.offsetY, factor);
    renderScene();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.shiftKey) {
      e.preventDefault();
      pushUndo();
      zoomAtPoint(e.offsetX, e.offsetY, 2);
      renderScene();
      return;
    }
    if (e.button !== 0) return;

    const panMode = controls.panMode.checked || state.isSpaceDown;
    if (panMode) {
      state.drag = { type: 'pan', x: e.clientX, y: e.clientY, moved: false };
      return;
    }

    state.drag = {
      type: 'rect',
      startX: e.offsetX,
      startY: e.offsetY,
      currentX: e.offsetX,
      currentY: e.offsetY
    };
    selectionBox.classList.remove('hidden');
    drawSelectionBox();
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.drag) return;
    if (state.drag.type === 'pan') {
      const dx = e.clientX - state.drag.x;
      const dy = e.clientY - state.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) state.drag.moved = true;
      state.centerRe -= dx * state.scale;
      state.centerIm -= dy * state.scale;
      state.drag.x = e.clientX;
      state.drag.y = e.clientY;
      updateReadouts();
      renderScene();
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    state.drag.currentX = clamp(e.clientX - bounds.left, 0, canvas.width);
    state.drag.currentY = clamp(e.clientY - bounds.top, 0, canvas.height);
    drawSelectionBox();
  });

  window.addEventListener('mouseup', () => {
    if (!state.drag) return;

    if (state.drag.type === 'pan') {
      if (state.drag.moved) pushUndo();
      state.drag = null;
      renderScene();
      return;
    }

    const { startX, startY, currentX, currentY } = state.drag;
    state.drag = null;
    selectionBox.classList.add('hidden');

    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    if (w < 6 || h < 6) return;

    pushUndo();
    zoomToRect(startX, startY, currentX, currentY);
    renderScene();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      state.isSpaceDown = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') state.isSpaceDown = false;
  });
}

function resetView() {
  state.centerRe = -0.5;
  state.centerIm = 0;
  state.scale = 3.5 / canvas.width;
  updateReadouts();
}

function resizeCanvas() {
  const bounds = wrap.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width));
  const height = Math.max(240, Math.floor(bounds.height));
  if (canvas.width === width && canvas.height === height) return;

  const oldWidth = canvas.width || width;
  canvas.width = width;
  canvas.height = height;
  state.scale = state.scale * (oldWidth / width);
  state.scale = clamp(state.scale, 1e-16, 0.05);
  updateReadouts();
}

function renderScene() {
  state.renderId += 1;
  state.pendingTasks = [];
  state.totalTasks = 0;
  state.doneTasks = 0;
  state.renderStartMs = performance.now();

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const previewScale = Math.max(0.2, Math.min(0.5, state.quality * 0.6));
  const passScales = previewScale < state.quality ? [previewScale, state.quality] : [state.quality];

  passScales.forEach((passScale, passIndex) => {
    const iw = Math.max(1, Math.floor(canvas.width * passScale));
    const ih = Math.max(1, Math.floor(canvas.height * passScale));
    const bandHeight = Math.max(8, Math.floor(40 * passScale));

    for (let y = 0; y < ih; y += bandHeight) {
      const bandH = Math.min(bandHeight, ih - y);
      state.pendingTasks.push({
        type: 'renderBand',
        renderId: state.renderId,
        x0: 0,
        y0: y,
        width: iw,
        height: bandH,
        internalWidth: iw,
        internalHeight: ih,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        centerRe: state.centerRe,
        centerIm: state.centerIm,
        scale: state.scale,
        maxIter: state.maxIter,
        palette: state.palette,
        passIndex
      });
      state.totalTasks += 1;
    }
  });

  controls.statusLine.textContent = 'Rendering… 0%';
  state.workers.forEach((entry) => { entry.busy = false; });
  dispatchWork();
}

function dispatchWork() {
  for (const entry of state.workers) {
    if (entry.busy) continue;
    const task = state.pendingTasks.shift();
    if (!task) continue;
    entry.busy = true;
    entry.worker.postMessage(task);
  }
}

function handleBandMessage(entry, data) {
  entry.busy = false;
  if (data.renderId !== state.renderId) {
    dispatchWork();
    return;
  }

  bandCanvas.width = data.width;
  bandCanvas.height = data.height;
  bandCtx.putImageData(new ImageData(data.pixels, data.width, data.height), 0, 0);

  const ratioX = canvas.width / data.internalWidth;
  const ratioY = canvas.height / data.internalHeight;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    bandCanvas,
    0,
    0,
    data.width,
    data.height,
    data.x0 * ratioX,
    data.y0 * ratioY,
    data.width * ratioX,
    data.height * ratioY
  );

  state.doneTasks += 1;
  const percent = Math.floor((state.doneTasks / state.totalTasks) * 100);
  controls.statusLine.textContent = `Rendering… ${percent}%`;

  if (state.doneTasks >= state.totalTasks) {
    const ms = Math.round(performance.now() - state.renderStartMs);
    controls.statusLine.textContent = `Done in ${ms} ms`;
  }

  dispatchWork();
}

function zoomAtPoint(x, y, factor) {
  const point = screenToComplex(x, y);
  const nextScale = clamp(state.scale * factor, 1e-16, 0.05);
  state.centerRe = point.re - (x - canvas.width / 2) * nextScale;
  state.centerIm = point.im - (y - canvas.height / 2) * nextScale;
  state.scale = nextScale;
  updateReadouts();
}

function zoomToRect(x1, y1, x2, y2) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rectW = maxX - minX;
  const rectH = maxY - minY;
  const factor = Math.max(rectW / canvas.width, rectH / canvas.height);

  const center = screenToComplex(centerX, centerY);
  state.centerRe = center.re;
  state.centerIm = center.im;
  state.scale = clamp(state.scale * factor, 1e-16, 0.05);
  updateReadouts();
}

function screenToComplex(x, y) {
  return {
    re: state.centerRe + (x - canvas.width / 2) * state.scale,
    im: state.centerIm + (y - canvas.height / 2) * state.scale
  };
}

function drawSelectionBox() {
  if (!state.drag || state.drag.type !== 'rect') return;
  const x = Math.min(state.drag.startX, state.drag.currentX);
  const y = Math.min(state.drag.startY, state.drag.currentY);
  const width = Math.abs(state.drag.currentX - state.drag.startX);
  const height = Math.abs(state.drag.currentY - state.drag.startY);

  selectionBox.style.left = `${x}px`;
  selectionBox.style.top = `${y}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

function pushUndo() {
  state.undoStack.push({ centerRe: state.centerRe, centerIm: state.centerIm, scale: state.scale });
  if (state.undoStack.length > 20) state.undoStack.shift();
}

function undoView() {
  const prev = state.undoStack.pop();
  if (!prev) return;
  state.centerRe = prev.centerRe;
  state.centerIm = prev.centerIm;
  state.scale = prev.scale;
  updateReadouts();
  renderScene();
}

function saveViewURL() {
  const params = new URLSearchParams({
    re: state.centerRe.toString(),
    im: state.centerIm.toString(),
    scale: state.scale.toString(),
    iter: state.maxIter.toString(),
    q: state.quality.toString(),
    pal: state.palette
  });
  const url = `${location.origin}${location.pathname}?${params}`;
  navigator.clipboard.writeText(url)
    .then(() => { controls.statusLine.textContent = 'Share URL copied to clipboard.'; })
    .catch(() => {
      controls.statusLine.textContent = 'Clipboard unavailable. Copy from prompt.';
      window.prompt('Copy URL', url);
    });
}

function applyURLView() {
  const params = new URLSearchParams(location.search);
  state.centerRe = clamp(Number(params.get('re') ?? state.centerRe), -2.5, 1.5);
  state.centerIm = clamp(Number(params.get('im') ?? state.centerIm), -2, 2);
  state.scale = clamp(Number(params.get('scale') ?? state.scale), 1e-16, 0.05);
  state.maxIter = clamp(Number(params.get('iter') ?? state.maxIter), 50, 2000);
  state.quality = clamp(Number(params.get('q') ?? state.quality), 0.25, 1);

  const pal = params.get('pal');
  if (['classic', 'ocean', 'sunset'].includes(pal)) state.palette = pal;

  controls.iterSlider.value = String(state.maxIter);
  controls.qualitySlider.value = state.quality.toFixed(2);
  controls.paletteSelect.value = state.palette;
  updateReadouts();
}

function updateReadouts() {
  controls.iterValue.textContent = String(state.maxIter);
  controls.qualityValue.textContent = `${state.quality.toFixed(2)}x`;
  controls.centerReadout.textContent = `Center: (${state.centerRe.toFixed(8)}, ${state.centerIm.toFixed(8)})`;
  controls.zoomReadout.textContent = `Zoom: ${(3.5 / (state.scale * Math.max(canvas.width, 1))).toExponential(3)}x`;
  controls.iterReadout.textContent = `Iterations: ${state.maxIter}`;
  controls.paletteReadout.textContent = `Palette: ${state.palette}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
