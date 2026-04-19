// ---------- Config ----------
// Aquarium animals. The `id` becomes the stored species and drives behavior
// (habitat, locomotion, ecosystem role) on the aquarium side.
const FISH = [
  { id: 'fish1',    src: '/assets/fish1.png',    label: 'Goldie' },
  { id: 'fish2',    src: '/assets/fish2.png',    label: 'Angel' },
  { id: 'fish3',    src: '/assets/fish3.png',    label: 'Clown' },
  { id: 'fish4',    src: '/assets/fish4.png',    label: 'Blue Tang' },
  { id: 'fish5',    src: '/assets/fish5.png',    label: 'Tropical' },
  { id: 'puffer1',  src: '/assets/Puffer1.png',  label: 'Puffer' },
  { id: 'seahorse1',src: '/assets/seahorse1.png',label: 'Seahorse' },
  { id: 'eel1',     src: '/assets/eel1.png',     label: 'Eel' },
  { id: 'stingray1',src: '/assets/stingray1.png',label: 'Sting Ray' },
  { id: 'seaslug1', src: '/assets/seaslug1.png', label: 'Sea Slug' },
  { id: 'shark1',   src: '/assets/shark1.png',   label: 'Shark' },
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
const colorsEl = document.getElementById('colors');
const sizeEl = document.getElementById('size');
const sizeLabel = document.getElementById('sizeLabel');
const toastEl = document.getElementById('toast');
const fishSelectEl = document.getElementById('fishSelect');
const fishGridEl = document.getElementById('fishGrid');
const acceptBtn = document.getElementById('acceptFish');
const coloringViewEl = document.getElementById('coloringView');
const changeFishBtn = document.getElementById('changeFish');

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
let currentFish = null;         // chosen from the fish-select screen
let pendingFish = null;         // highlighted but not yet accepted
let currentColor = PALETTE[0];
let currentTool = 'brush';
let brushSize = 18;
let drawing = false;
let lastPt = null;
const undoStack = [];
const UNDO_LIMIT = 25;

// Sparkle / rainbow brush state
let sparkleHue = 0;

// Sticker state
const STICKERS = [
  {
    id: 'eye',
    label: 'Googly eye',
    // Circle with dark pupil + highlight
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="white" stroke="#222" stroke-width="5"/>
      <circle cx="58" cy="58" r="20" fill="#111"/>
      <circle cx="52" cy="52" r="5" fill="white"/>
    </svg>`,
  },
  {
    id: 'heart',
    label: 'Heart',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50 85 C50 85, 8 58, 8 34 C8 18, 24 10, 36 22 C42 28, 48 34, 50 40 C52 34, 58 28, 64 22 C76 10, 92 18, 92 34 C92 58, 50 85, 50 85 Z"
        fill="#ff3b6e" stroke="#80002a" stroke-width="4"/>
    </svg>`,
  },
  {
    id: 'star',
    label: 'Star',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50 6 L62 40 L96 45 L70 68 L78 98 L50 82 L22 98 L30 68 L4 45 L38 40 Z"
        fill="#ffd34e" stroke="#8f5a00" stroke-width="4"/>
    </svg>`,
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50 5 L55 45 L95 50 L55 55 L50 95 L45 55 L5 50 L45 45 Z"
        fill="#6ee2ff" stroke="#005a7a" stroke-width="3"/>
    </svg>`,
  },
  {
    id: 'rainbow',
    label: 'Rainbow star',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff3b30"/>
          <stop offset="0.33" stop-color="#ffcc00"/>
          <stop offset="0.66" stop-color="#34c759"/>
          <stop offset="1" stop-color="#5856d6"/>
        </linearGradient>
      </defs>
      <path d="M50 6 L62 40 L96 45 L70 68 L78 98 L50 82 L22 98 L30 68 L4 45 L38 40 Z"
        fill="url(#rg)" stroke="#222" stroke-width="3"/>
    </svg>`,
  },
  {
    id: 'flower',
    label: 'Flower',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g stroke="#703a00" stroke-width="3">
        <circle cx="50" cy="22" r="16" fill="#ff85a2"/>
        <circle cx="22" cy="42" r="16" fill="#ff85a2"/>
        <circle cx="78" cy="42" r="16" fill="#ff85a2"/>
        <circle cx="34" cy="72" r="16" fill="#ff85a2"/>
        <circle cx="66" cy="72" r="16" fill="#ff85a2"/>
        <circle cx="50" cy="50" r="14" fill="#ffd34e"/>
      </g>
    </svg>`,
  },
];

const stickerPanel = document.getElementById('stickerPanel');
const stickersEl = document.getElementById('stickers');
const stickerImages = new Map();
let currentSticker = null;
let stickerPreview = null;
const STICKER_CANVAS_SIZE = 120; // size in canvas px when placed

// ---------- Fish-select screen ----------
FISH.forEach((f) => {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'fish-card';
  card.dataset.fishId = f.id;
  card.innerHTML = `<img src="${f.src}" alt="${f.label}" /><span>${f.label}</span>`;
  card.addEventListener('click', () => {
    document.querySelectorAll('.fish-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    pendingFish = f;
    acceptBtn.disabled = false;
  });
  fishGridEl.appendChild(card);
});
acceptBtn.addEventListener('click', () => {
  if (!pendingFish) return;
  enterColoringView(pendingFish);
});
changeFishBtn.addEventListener('click', () => {
  // Bail out back to the selection screen without submitting.
  if (anyPaintApplied() && !confirm('Go back? Your current coloring will be lost.')) return;
  returnToSelectView();
});

function enterColoringView(fish) {
  currentFish = fish;
  // Fade the select screen out, swap, fade the coloring view in.
  fishSelectEl.classList.add('leaving');
  setTimeout(() => {
    fishSelectEl.hidden = true;
    fishSelectEl.classList.remove('leaving');
    coloringViewEl.hidden = false;
    coloringViewEl.classList.add('entering');
    requestAnimationFrame(() => coloringViewEl.classList.remove('entering'));
    loadFish(fish);
  }, 350);
}

function returnToSelectView() {
  // Reset coloring state so the next guest starts clean.
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  undoStack.length = 0;
  const nameInput = document.getElementById('fishName');
  if (nameInput) nameInput.value = '';
  document.querySelectorAll('.fish-card').forEach((c) => c.classList.remove('active'));
  pendingFish = null;
  currentFish = null;
  acceptBtn.disabled = true;

  coloringViewEl.classList.add('entering');
  setTimeout(() => {
    coloringViewEl.hidden = true;
    coloringViewEl.classList.remove('entering');
    fishSelectEl.hidden = false;
    fishSelectEl.classList.add('leaving');
    requestAnimationFrame(() => fishSelectEl.classList.remove('leaving'));
  }, 300);
}

function anyPaintApplied() {
  try {
    const d = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
    if (currentTool === 'fill') canvas.style.cursor = 'cell';
    else if (currentTool === 'sticker') canvas.style.cursor = 'copy';
    else canvas.style.cursor = 'crosshair';
    // Show the sticker picker only when the sticker tool is selected.
    if (stickerPanel) stickerPanel.hidden = (currentTool !== 'sticker');
    // If switching away from sticker, tear down any in-flight preview.
    if (currentTool !== 'sticker' && stickerPreview) {
      stickerPreview.el.remove();
      stickerPreview = null;
    }
  });
});

// Build sticker picker: preload each as an Image so placement draws immediately.
STICKERS.forEach((s, i) => {
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(s.svg);
  const img = new Image();
  img.src = url;
  stickerImages.set(s.id, img);
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'sticker-swatch' + (i === 0 ? ' active' : '');
  sw.title = s.label;
  sw.innerHTML = `<img src="${url}" alt="${s.label}" />`;
  sw.addEventListener('click', () => {
    document.querySelectorAll('.sticker-swatch').forEach(x => x.classList.remove('active'));
    sw.classList.add('active');
    currentSticker = s.id;
  });
  stickersEl.appendChild(sw);
});
currentSticker = STICKERS[0].id;

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

  if (currentTool === 'sticker') {
    pushUndo();
    beginStickerPreview(ev);
    return;
  }

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
  sparkleHue = (sparkleHue + 17) % 360; // start each stroke at a fresh hue
  strokeAt(p, p);
  applyMask();
  render();
});

canvas.addEventListener('pointermove', (ev) => {
  if (stickerPreview) {
    updateStickerPreview(ev);
    return;
  }
  if (!drawing) return;
  const p = canvasPoint(ev);
  strokeAt(lastPt, p);
  applyMask();
  lastPt = p;
  render();
});

function endStroke(ev) {
  if (stickerPreview) {
    commitStickerPreview(ev);
    try { canvas.releasePointerCapture(ev.pointerId); } catch {}
    return;
  }
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
  } else if (currentTool === 'sparkle') {
    paintCtx.globalCompositeOperation = 'source-over';
    // Rotate the hue along the stroke so each segment is a new color.
    sparkleHue = (sparkleHue + 12) % 360;
    paintCtx.strokeStyle = `hsl(${sparkleHue}, 90%, 55%)`;
  } else {
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.strokeStyle = currentColor;
  }
  paintCtx.beginPath();
  paintCtx.moveTo(a.x, a.y);
  paintCtx.lineTo(b.x, b.y);
  paintCtx.stroke();

  // Sparkle mode: scatter a few small glitter dots around the stroke end.
  if (currentTool === 'sparkle') emitSparkles(b);

  paintCtx.globalCompositeOperation = 'source-over';
}

function emitSparkles(p) {
  // A handful of tiny bright dots near the stroke end, colors offset from
  // the current rotating hue so they "glitter" against the stroke.
  const count = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = brushSize * (0.55 + Math.random() * 1.1);
    const x = p.x + Math.cos(angle) * radius;
    const y = p.y + Math.sin(angle) * radius;
    const size = 1.5 + Math.random() * (brushSize * 0.18);
    const hue = (sparkleHue + (Math.random() * 120 - 60) + 360) % 360;
    const light = 70 + Math.random() * 20;
    paintCtx.fillStyle = `hsl(${hue}, 95%, ${light}%)`;
    paintCtx.beginPath();
    paintCtx.arc(x, y, size, 0, Math.PI * 2);
    paintCtx.fill();
    // A bright white core on some dots for extra pop.
    if (Math.random() < 0.4) {
      paintCtx.fillStyle = 'rgba(255,255,255,.85)';
      paintCtx.beginPath();
      paintCtx.arc(x, y, Math.max(0.6, size * 0.45), 0, Math.PI * 2);
      paintCtx.fill();
    }
  }
}

// ---------- Sticker placement ----------
function beginStickerPreview(ev) {
  if (!currentSticker) return;
  const img = stickerImages.get(currentSticker);
  if (!img) return;
  const rect = canvas.getBoundingClientRect();
  // Display size: sticker canvas size scaled to displayed canvas.
  const displaySize = STICKER_CANVAS_SIZE * (rect.width / canvas.width);
  const el = document.createElement('div');
  el.className = 'sticker-preview';
  el.style.width = displaySize + 'px';
  el.style.height = displaySize + 'px';
  const im = document.createElement('img');
  im.src = img.src;
  el.appendChild(im);
  document.body.appendChild(el);
  stickerPreview = { el, displaySize };
  updateStickerPreview(ev);
}

function updateStickerPreview(ev) {
  if (!stickerPreview) return;
  const { el, displaySize } = stickerPreview;
  el.style.transform = `translate(${ev.clientX - displaySize / 2}px, ${ev.clientY - displaySize / 2}px)`;
}

function commitStickerPreview(ev) {
  if (!stickerPreview) return;
  const p = canvasPoint(ev);
  const img = stickerImages.get(currentSticker);
  stickerPreview.el.remove();
  stickerPreview = null;
  if (!img || !img.complete) return;
  const size = STICKER_CANVAS_SIZE;
  paintCtx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
  applyMask();
  render();
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

    // Kick off the swim-off animation and the "Look up!" banner in parallel.
    // The TV polls every ~1.2s and then runs a ~650ms cinematic ramp, so the
    // splash on the TV lands roughly when the iPad animation completes.
    const swim = swimAway(dataUrl);
    showLookUpBanner();
    await swim;

    // Hold the banner a bit longer so guests' eyes reach the TV in time for the splash.
    await wait(1400);
    hideLookUpBanner();

    toast(fishName
      ? `${fishName} is swimming in the aquarium!`
      : 'Your fish is swimming in the aquarium!');

    // New flow: once the fish is on its way, hand the iPad to the next guest
    // by returning to the fish-select screen.
    await wait(500);
    returnToSelectView();
  } catch (e) {
    console.error(e);
    hideLookUpBanner();
    toast('Oops — could not send your fish. Try again!');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function showLookUpBanner() {
  const el = document.getElementById('lookUpBanner');
  if (!el) return;
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
}
function hideLookUpBanner() {
  const el = document.getElementById('lookUpBanner');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
}

function swimAway(dataUrl) {
  // Honor reduced-motion by skipping the large swim-off animation.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return new Promise((r) => setTimeout(r, 300));
  }
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
// Don't pre-load a fish — the guest picks on the fish-select screen first.
// A fallback render keeps the coloring canvas visually neutral if it ever
// becomes visible before a fish is chosen.
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, canvas.width, canvas.height);
