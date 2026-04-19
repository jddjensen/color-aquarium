// ---------- Config ----------
const FISH = [
  { id: 'fish1',    src: '/assets/fish1.png',    label: 'Goldie' },
  { id: 'fish2',    src: '/assets/fish2.png',    label: 'Angel' },
  { id: 'fish3',    src: '/assets/fish3.png',    label: 'Clown' },
  { id: 'puffer1',  src: '/assets/Puffer1.png',  label: 'Puffer' },
  { id: 'seahorse1',src: '/assets/seahorse1.png',label: 'Seahorse' },
];

const PALETTE = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e',
  '#000000', '#ffffff', '#ff85a2', '#7ee7ff', '#c7f27a',
];

// Pixels this dark (sum of rgb) on the line art are treated as "line" (fill barrier).
const LINE_THRESHOLD = 360; // ~ < 120 per channel average
// Pixels this bright on composite count as unpainted white paper when exporting.
const WHITE_THRESHOLD = 735; // ~ > 245 per channel average

// ---------- DOM ----------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const picker = document.getElementById('picker');
const colorsEl = document.getElementById('colors');
const sizeEl = document.getElementById('size');
const sizeLabel = document.getElementById('sizeLabel');
const toastEl = document.getElementById('toast');

// Offscreen layers (sized to canvas)
const artCanvas   = document.createElement('canvas'); // the fish line art
const paintCanvas = document.createElement('canvas'); // user's painting
const maskCanvas  = document.createElement('canvas'); // where painting is allowed (inside fish)
const artCtx   = artCanvas.getContext('2d', { willReadFrequently: true });
const paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
const maskCtx  = maskCanvas.getContext('2d', { willReadFrequently: true });

artCanvas.width = paintCanvas.width = maskCanvas.width = canvas.width;
artCanvas.height = paintCanvas.height = maskCanvas.height = canvas.height;

// ---------- State ----------
let currentFish = FISH[0];
let currentColor = PALETTE[0];
let currentTool = 'brush';
let brushSize = 18;
let drawing = false;
let lastPt = null;
const undoStack = [];
const UNDO_LIMIT = 25;

// ---------- Setup UI ----------
FISH.forEach((f, i) => {
  const btn = document.createElement('button');
  btn.innerHTML = `<img src="${f.src}" alt="${f.label}" />`;
  btn.title = f.label;
  if (i === 0) btn.classList.add('active');
  btn.addEventListener('click', () => {
    document.querySelectorAll('.picker button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadFish(f);
  });
  picker.appendChild(btn);
});

PALETTE.forEach((c, i) => {
  const sw = document.createElement('div');
  sw.className = 'swatch' + (i === 0 ? ' active' : '');
  sw.style.background = c;
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    currentColor = c;
  });
  colorsEl.appendChild(sw);
});

document.querySelectorAll('.tool-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentTool = b.dataset.tool;
    canvas.style.cursor = currentTool === 'fill' ? 'cell' : 'crosshair';
  });
});

sizeEl.addEventListener('input', () => {
  brushSize = +sizeEl.value;
  sizeLabel.textContent = brushSize;
});

document.getElementById('clear').addEventListener('click', () => {
  if (!confirm('Start over? Your coloring will be erased.')) return;
  pushUndo();
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  render();
});

document.getElementById('undo').addEventListener('click', () => {
  if (!undoStack.length) return;
  const data = undoStack.pop();
  paintCtx.putImageData(data, 0, 0);
  render();
});

document.getElementById('submit').addEventListener('click', submit);

// ---------- Load fish ----------
function loadFish(fish) {
  currentFish = fish;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // Fit image into canvas preserving aspect ratio, centered.
    const cw = canvas.width, ch = canvas.height;
    const scale = Math.min(cw / img.width, ch / img.height) * 0.92;
    const dw = img.width * scale, dh = img.height * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;

    artCtx.clearRect(0, 0, cw, ch);
    artCtx.fillStyle = 'white';
    artCtx.fillRect(0, 0, cw, ch);
    artCtx.drawImage(img, dx, dy, dw, dh);

    paintCtx.clearRect(0, 0, cw, ch);
    buildPaintMask();
    undoStack.length = 0;
    render();
  };
  img.src = fish.src;
}

// ---------- Paint mask (prevents coloring the paper) ----------
// Flood-fill from every canvas edge through non-line pixels; everything reached
// is the "paper" outside the fish. The remaining pixels (interior + line art)
// make up the paintable area.
function buildPaintMask() {
  const w = artCanvas.width, h = artCanvas.height;
  const art = artCtx.getImageData(0, 0, w, h).data;
  const exterior = new Uint8Array(w * h);

  const isLine = (i) => (art[i] + art[i + 1] + art[i + 2]) < LINE_THRESHOLD;

  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }

  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const p = cy * w + cx;
    if (exterior[p]) continue;
    if (isLine(p * 4)) continue;
    exterior[p] = 1;
    stack.push(cx + 1, cy); stack.push(cx - 1, cy);
    stack.push(cx, cy + 1); stack.push(cx, cy - 1);
  }

  const mask = maskCtx.createImageData(w, h);
  const m = mask.data;
  for (let p = 0; p < exterior.length; p++) {
    const i = p * 4;
    if (!exterior[p]) {
      m[i] = m[i + 1] = m[i + 2] = 255;
      m[i + 3] = 255;
    } else {
      m[i + 3] = 0;
    }
  }
  maskCtx.putImageData(mask, 0, 0);
}

function applyMask() {
  paintCtx.save();
  paintCtx.globalCompositeOperation = 'destination-in';
  paintCtx.drawImage(maskCanvas, 0, 0);
  paintCtx.restore();
}

function isPaintable(x, y) {
  if (x < 0 || y < 0 || x >= maskCanvas.width || y >= maskCanvas.height) return false;
  const px = maskCtx.getImageData(x | 0, y | 0, 1, 1).data;
  return px[3] > 0;
}

// ---------- Render ----------
function render() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(paintCanvas, 0, 0);
  // Draw line art on top, multiply-blend keeps colors showing under light paper but dark lines stay dark.
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(artCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- Input ----------
function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
  return { x, y };
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  const p = canvasPoint(ev);
  pushUndo();
  if (currentTool === 'fill') {
    if (!isPaintable(p.x, p.y)) return;
    floodFill(Math.round(p.x), Math.round(p.y), currentColor);
    applyMask();
    render();
    return;
  }
  drawing = true;
  lastPt = p;
  strokeAt(p, p);
  applyMask();
  render();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drawing) return;
  const p = canvasPoint(ev);
  strokeAt(lastPt, p);
  applyMask();
  lastPt = p;
  render();
});

function endStroke(ev) {
  if (!drawing) return;
  drawing = false;
  lastPt = null;
  try { canvas.releasePointerCapture(ev.pointerId); } catch {}
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', endStroke);

function strokeAt(a, b) {
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.lineWidth = brushSize;
  if (currentTool === 'eraser') {
    paintCtx.globalCompositeOperation = 'destination-out';
    paintCtx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.strokeStyle = currentColor;
  }
  paintCtx.beginPath();
  paintCtx.moveTo(a.x, a.y);
  paintCtx.lineTo(b.x, b.y);
  paintCtx.stroke();
  paintCtx.globalCompositeOperation = 'source-over';
}

// ---------- Flood fill (bounded by line art) ----------
function hexToRgb(hex) {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3
    ? v.split('').map(c => c + c).join('')
    : v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function floodFill(x, y, colorHex) {
  const w = paintCanvas.width, h = paintCanvas.height;
  if (x < 0 || y < 0 || x >= w || y >= h) return;

  const art = artCtx.getImageData(0, 0, w, h).data;
  const paintImg = paintCtx.getImageData(0, 0, w, h);
  const paint = paintImg.data;
  const { r, g, b } = hexToRgb(colorHex);

  // Barrier: line art is dark (close to black).
  const isLine = (i) => (art[i] + art[i + 1] + art[i + 2]) < LINE_THRESHOLD;

  const startIdx = (y * w + x) * 4;
  if (isLine(startIdx)) return;

  const visited = new Uint8Array(w * h);
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const p = cy * w + cx;
    if (visited[p]) continue;
    const i = p * 4;
    if (isLine(i)) continue;
    visited[p] = 1;

    paint[i] = r; paint[i + 1] = g; paint[i + 2] = b; paint[i + 3] = 255;

    stack.push([cx + 1, cy]);
    stack.push([cx - 1, cy]);
    stack.push([cx, cy + 1]);
    stack.push([cx, cy - 1]);
  }
  paintCtx.putImageData(paintImg, 0, 0);
}

// ---------- Undo ----------
function pushUndo() {
  try {
    const snap = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
    undoStack.push(snap);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  } catch {}
}

// ---------- Submit: export only the fish (transparent paper) ----------
function exportFishPng() {
  const w = canvas.width, h = canvas.height;

  // Composite paint + line art onto an offscreen canvas (opaque white bg).
  const comp = document.createElement('canvas');
  comp.width = w; comp.height = h;
  const cctx = comp.getContext('2d');
  cctx.fillStyle = 'white';
  cctx.fillRect(0, 0, w, h);
  cctx.drawImage(paintCanvas, 0, 0);
  cctx.globalCompositeOperation = 'multiply';
  cctx.drawImage(artCanvas, 0, 0);
  cctx.globalCompositeOperation = 'source-over';

  // Cut out only the paper around the fish using the paintable mask —
  // unpainted interior stays opaque white (no transparent holes inside).
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(maskCanvas, 0, 0);
  cctx.globalCompositeOperation = 'source-over';

  const img = cctx.getImageData(0, 0, w, h);

  // Crop to non-transparent bounds so the fish isn't surrounded by empty space.
  const bounds = opaqueBounds(img);
  if (!bounds) return comp.toDataURL('image/png');
  const pad = 6;
  const cw = Math.min(w, bounds.maxX - bounds.minX + 1 + pad * 2);
  const ch = Math.min(h, bounds.maxY - bounds.minY + 1 + pad * 2);
  const ox = Math.max(0, bounds.minX - pad);
  const oy = Math.max(0, bounds.minY - pad);

  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(comp, ox, oy, cw, ch, 0, 0, cw, ch);
  return out.toDataURL('image/png');
}

function opaqueBounds(img) {
  const { width: w, height: h, data: d } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

async function submit() {
  const btn = document.getElementById('submit');
  const nameInput = document.getElementById('fishName');
  const fishName = (nameInput?.value || '').trim().slice(0, 20);
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Swimming away...';
  try {
    const dataUrl = exportFishPng();
    const r = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, name: fishName, species: currentFish.id }),
    });
    if (!r.ok) throw new Error('submit failed');

    // Animate the fish swimming off toward the "See the Aquarium" link.
    await swimAway(dataUrl);

    toast(fishName
      ? `${fishName} is swimming in the aquarium!`
      : 'Your fish is swimming in the aquarium!');
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    if (nameInput) nameInput.value = '';
    undoStack.length = 0;
    render();
  } catch (e) {
    console.error(e);
    toast('Oops — could not send your fish. Try again!');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function swimAway(dataUrl) {
  return new Promise((resolve) => {
    const rect = canvas.getBoundingClientRect();
    const link = document.querySelector('.topbar a');
    const targetRect = link ? link.getBoundingClientRect()
                            : { left: window.innerWidth - 80, top: 20, width: 40, height: 40 };

    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const maxW = Math.min(rect.width * 0.85, 540);
      const scale = Math.min(maxW / img.naturalWidth, (rect.height * 0.85) / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;

      const startX = rect.left + (rect.width - w) / 2;
      const startY = rect.top + (rect.height - h) / 2;

      const el = document.createElement('img');
      el.src = dataUrl;
      el.className = 'swim-away';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.transform = `translate(${startX}px, ${startY}px) rotate(0deg) scale(1)`;
      document.body.appendChild(el);

      const endX = targetRect.left + targetRect.width / 2 - 20;
      const endY = targetRect.top + targetRect.height / 2 - 20;
      const goingRight = endX > startX;
      const flip = goingRight ? -1 : 1; // sprite faces left naturally

      requestAnimationFrame(() => {
        el.style.transform =
          `translate(${endX}px, ${endY}px) scale(0.12) scaleX(${flip}) rotate(${goingRight ? -8 : 8}deg)`;
        el.classList.add('go');
      });
      setTimeout(() => { el.remove(); resolve(); }, 1750);
    };
    img.onerror = () => resolve();
  });
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

// ---------- Go ----------
loadFish(FISH[0]);
