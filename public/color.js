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
  { id: 'octo1',    src: '/assets/octo1.png',    label: 'Octopus' },
  { id: 'shrimp1',  src: '/assets/shrimp1.png',  label: 'Shrimp' },
  { id: 'squid1',   src: '/assets/squid1.png',   label: 'Squid' },
  { id: 'seastar1', src: '/assets/seastar1.png', label: 'Sea Star' },
];

const PALETTE = [
  // Reds
  '#ff3b30', '#ff6b6b', '#cc0000', '#e91e63',
  // Oranges
  '#ff9500', '#ff7a59', '#ff6d00', '#d2691e',
  // Yellows
  '#ffcc00', '#ffe14d', '#ffd34e', '#ffaa00',
  // Greens
  '#34c759', '#8fd14f', '#a4e884', '#00695c',
  // Cyans / teals
  '#00c7be', '#7ee7ff', '#40e0d0', '#00bfff',
  // Blues
  '#007aff', '#3b82f6', '#1e3a8a', '#003f7f',
  // Purples
  '#5856d6', '#8b5cf6', '#af52de', '#6a0dad',
  // Pinks
  '#ff2d55', '#ff85a2', '#ffb6c1', '#ff69b4',
  // Earth / browns
  '#a2845e', '#8b4513', '#d2b48c', '#3e2723',
  // Neutrals
  '#000000', '#666666', '#c0c0c0', '#ffffff',
];

const HF_TRANSFORMERS_JS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';
const RMBG_MODEL_ID = 'briaai/RMBG-1.4';
const ENHANCER_LOAD_TIMEOUT_MS = 15000;
const ENHANCER_RUN_TIMEOUT_MS = 12000;

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
const submitBtn = document.getElementById('submit');
const submitHintEl = document.getElementById('submitHint');

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
  {
    id: 'crown',
    label: 'Crown',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M10 70 L15 30 L35 55 L50 20 L65 55 L85 30 L90 70 Z"
        fill="#ffd34e" stroke="#8f5a00" stroke-width="3"/>
      <rect x="10" y="70" width="80" height="12" fill="#ffb347" stroke="#8f5a00" stroke-width="3"/>
      <circle cx="25" cy="76" r="3" fill="#ff3b6e"/>
      <circle cx="50" cy="76" r="3" fill="#6ee2ff"/>
      <circle cx="75" cy="76" r="3" fill="#34c759"/>
    </svg>`,
  },
  {
    id: 'bolt',
    label: 'Lightning bolt',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M55 5 L20 55 L42 55 L35 95 L80 40 L56 40 Z"
        fill="#ffe14d" stroke="#8f5a00" stroke-width="3"/>
    </svg>`,
  },
  {
    id: 'bubble',
    label: 'Bubble',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="42" fill="rgba(180,230,255,.55)" stroke="#0a7fa3" stroke-width="3"/>
      <circle cx="38" cy="36" r="10" fill="white" opacity=".8"/>
      <circle cx="60" cy="28" r="5" fill="white" opacity=".8"/>
    </svg>`,
  },
  {
    id: 'smile',
    label: 'Smiley',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="#ffd34e" stroke="#8f5a00" stroke-width="4"/>
      <circle cx="36" cy="40" r="5" fill="#222"/>
      <circle cx="64" cy="40" r="5" fill="#222"/>
      <path d="M30 58 Q50 80 70 58" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'glitterburst',
    label: 'Glitter burst',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g>
        <path d="M50 5 L53 45 L93 50 L53 55 L50 95 L47 55 L7 50 L47 45 Z" fill="#ffe14d" stroke="#c48c00" stroke-width="2"/>
        <circle cx="22" cy="22" r="5" fill="#ff85a2"/>
        <circle cx="78" cy="22" r="5" fill="#6ee2ff"/>
        <circle cx="22" cy="78" r="5" fill="#8b5cf6"/>
        <circle cx="78" cy="78" r="5" fill="#34c759"/>
        <circle cx="14" cy="50" r="3.5" fill="#ff3b6e"/>
        <circle cx="86" cy="50" r="3.5" fill="#ffd34e"/>
        <circle cx="50" cy="14" r="3.5" fill="#7ee7ff"/>
        <circle cx="50" cy="86" r="3.5" fill="#ff9500"/>
      </g>
    </svg>`,
  },
  {
    id: 'confetti',
    label: 'Confetti',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g stroke="#333" stroke-width="1.5">
        <rect x="18" y="22" width="10" height="14" fill="#ff3b6e" transform="rotate(20 23 29)"/>
        <rect x="70" y="18" width="10" height="14" fill="#ffd34e" transform="rotate(-25 75 25)"/>
        <rect x="46" y="10" width="10" height="14" fill="#34c759" transform="rotate(15 51 17)"/>
        <rect x="10" y="58" width="10" height="14" fill="#6ee2ff" transform="rotate(-15 15 65)"/>
        <rect x="74" y="62" width="10" height="14" fill="#8b5cf6" transform="rotate(20 79 69)"/>
        <rect x="40" y="66" width="10" height="14" fill="#ff9500" transform="rotate(-10 45 73)"/>
        <rect x="30" y="40" width="10" height="14" fill="#ff85a2" transform="rotate(35 35 47)"/>
      </g>
    </svg>`,
  },
  {
    id: 'moon',
    label: 'Moon',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M65 20 A35 35 0 1 0 65 80 A28 28 0 1 1 65 20 Z"
        fill="#fff4b8" stroke="#6b5100" stroke-width="3"/>
    </svg>`,
  },
  {
    id: 'anchor',
    label: 'Anchor',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g fill="none" stroke="#333" stroke-width="5" stroke-linecap="round">
        <circle cx="50" cy="18" r="8"/>
        <line x1="50" y1="26" x2="50" y2="82"/>
        <line x1="36" y1="42" x2="64" y2="42"/>
        <path d="M20 70 Q30 88 50 82 Q70 88 80 70"/>
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
let backgroundRemovalPipelinePromise = null;
let backgroundRemovalUnavailable = false;
const MIN_DECORATED_PIXELS = 120;
let hasMeaningfulDecorationState = false;
let strokeNeedsDecorationRecount = false;

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
    scheduleBackgroundRemovalWarmup();
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
  setMeaningfulDecorationState(false);

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

function setMeaningfulDecorationState(ready) {
  hasMeaningfulDecorationState = ready;
  updateSubmitState();
}

function recountMeaningfulDecoration() {
  try {
    const d = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height).data;
    let count = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 12) continue;
      if (d[i] + d[i + 1] + d[i + 2] >= WHITE_THRESHOLD) continue;
      count++;
      if (count >= MIN_DECORATED_PIXELS) {
        setMeaningfulDecorationState(true);
        return true;
      }
    }
    setMeaningfulDecorationState(false);
    return false;
  } catch {
    setMeaningfulDecorationState(false);
    return false;
  }
}

function hasMeaningfulDecoration() {
  return hasMeaningfulDecorationState;
}

function isMeaningfulPaintColor(color) {
  const { r, g, b } = hexToRgb(color);
  return (r + g + b) < WHITE_THRESHOLD;
}

function currentActionAddsMeaningfulDecoration() {
  if (currentTool === 'sticker' || currentTool === 'sparkle' || currentTool === 'glitter') return true;
  if (currentTool === 'brush' || currentTool === 'fill') return isMeaningfulPaintColor(currentColor);
  return false;
}

function currentActionNeedsDecorationRecount() {
  if (currentTool === 'eraser') return true;
  return (currentTool === 'brush' || currentTool === 'fill') && !isMeaningfulPaintColor(currentColor);
}

function currentStrokeNeedsDecorationRecount() {
  if (hasMeaningfulDecorationState) return currentActionNeedsDecorationRecount();
  return currentActionAddsMeaningfulDecoration();
}

function updateSubmitState() {
  const ready = hasMeaningfulDecorationState;
  if (submitBtn) submitBtn.disabled = !ready;
  if (submitHintEl) {
    submitHintEl.textContent = ready
      ? 'Your fish is ready for the aquarium.'
      : 'Add some color, glitter, or stickers before sending your fish.';
  }
}

function scheduleBackgroundRemovalWarmup() {
  const warm = () => { void getBackgroundRemovalPipeline(); };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout: 1800 });
  } else {
    setTimeout(warm, 400);
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getBackgroundRemovalPipeline() {
  if (backgroundRemovalUnavailable) return null;
  if (!backgroundRemovalPipelinePromise) {
    backgroundRemovalPipelinePromise = (async () => {
      const { pipeline } = await import(HF_TRANSFORMERS_JS_URL);
      const options = navigator.gpu ? { device: 'webgpu' } : {};
      return pipeline('background-removal', RMBG_MODEL_ID, options);
    })().catch((error) => {
      backgroundRemovalUnavailable = true;
      backgroundRemovalPipelinePromise = null;
      console.warn('background removal unavailable', error);
      return null;
    });
  }
  return backgroundRemovalPipelinePromise;
}

function dataUrlToBlob(dataUrl) {
  const [header, body = ''] = dataUrl.split(',', 2);
  const mime = (header.match(/^data:(.*?);base64$/) || [])[1] || 'image/png';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function resizeDataUrl(dataUrl, maxEdge) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(width * scale));
      out.height = Math.max(1, Math.round(height * scale));
      const outCtx = out.getContext('2d');
      outCtx.drawImage(img, 0, 0, out.width, out.height);
      resolve(out.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function rawImageToDataUrl(rawImage) {
  const rgba = rawImage.clone().rgba();
  const out = document.createElement('canvas');
  out.width = rgba.width;
  out.height = rgba.height;
  const outCtx = out.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height);
  outCtx.putImageData(imgData, 0, 0);
  return out.toDataURL('image/png');
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function alphaCoverage(dataUrl) {
  const img = await loadImageFromDataUrl(dataUrl);
  const probe = document.createElement('canvas');
  probe.width = img.naturalWidth || img.width;
  probe.height = img.naturalHeight || img.height;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  probeCtx.drawImage(img, 0, 0);
  const pixels = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  let opaque = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 8) opaque++;
  }
  return opaque;
}

async function enhanceFishArtwork(dataUrl) {
  if (backgroundRemovalUnavailable) return dataUrl;
  try {
    const remover = await withTimeout(getBackgroundRemovalPipeline(), ENHANCER_LOAD_TIMEOUT_MS, 'background removal load');
    if (!remover) return dataUrl;
    const output = await withTimeout(remover(dataUrlToBlob(dataUrl)), ENHANCER_RUN_TIMEOUT_MS, 'background removal');
    const raw = Array.isArray(output) ? output[0] : output;
    if (!raw) return dataUrl;
    const refined = rawImageToDataUrl(raw);

    // If the inferred matte strips out too much of the drawing, prefer the
    // original export rather than sending a barely-visible fish to the tank.
    const [baseCoverage, refinedCoverage] = await Promise.all([
      alphaCoverage(dataUrl),
      alphaCoverage(refined),
    ]);
    if (refinedCoverage < baseCoverage * 0.45) return dataUrl;
    return refined;
  } catch (error) {
    console.warn('background removal failed', error);
    return dataUrl;
  }
}

function sanitizeSuggestedName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^A-Za-z0-9 '\-]/g, '')
    .slice(0, 20);
}

function sanitizeBio(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function describeFishArt(dataUrl, fish, userName) {
  try {
    const previewDataUrl = await resizeDataUrl(dataUrl, 384);
    const r = await fetch('/api/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: previewDataUrl,
        species: fish.id,
        speciesLabel: fish.label,
        name: userName,
      }),
    });
    if (!r.ok) throw new Error('describe failed');
    const data = await r.json();
    return {
      nameSuggestion: sanitizeSuggestedName(data.nameSuggestion || ''),
      bio: sanitizeBio(data.bio || ''),
    };
  } catch (error) {
    console.warn('fish description failed', error);
    return { nameSuggestion: '', bio: '' };
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
  setMeaningfulDecorationState(false);
});

document.getElementById('undo').addEventListener('click', () => {
  if (!undoStack.length) return;
  const data = undoStack.pop();
  paintCtx.putImageData(data, 0, 0);
  render();
  recountMeaningfulDecoration();
});
submitBtn?.addEventListener('click', submit);

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
    setMeaningfulDecorationState(false);
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
  strokeNeedsDecorationRecount = false;

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
    if (hasMeaningfulDecorationState) {
      if (currentActionNeedsDecorationRecount()) recountMeaningfulDecoration();
    } else if (currentActionAddsMeaningfulDecoration()) {
      setMeaningfulDecorationState(true);
    }
    return;
  }
  if (currentTool === 'glitter') {
    drawing = true;
    lastPt = p;
    strokeNeedsDecorationRecount = currentStrokeNeedsDecorationRecount();
    emitGlitter(p);
    applyMask();
    render();
    return;
  }
  drawing = true;
  lastPt = p;
  strokeNeedsDecorationRecount = currentStrokeNeedsDecorationRecount();
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
  if (currentTool === 'glitter') {
    emitGlitter(p);
  } else {
    strokeAt(lastPt, p);
  }
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
  if (strokeNeedsDecorationRecount) recountMeaningfulDecoration();
  strokeNeedsDecorationRecount = false;
  try { canvas.releasePointerCapture(ev.pointerId); } catch {}
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', endStroke);

// iOS Safari belt-and-suspenders: even with touch-action:none, a stray
// two-finger gesture or a long-press can still trigger the system's
// selection / zoom / callout behavior. Swallow those on the canvas.
canvas.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove',  (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
canvas.addEventListener('gesturestart', (e) => e.preventDefault());
canvas.addEventListener('gesturechange', (e) => e.preventDefault());
canvas.addEventListener('gestureend', (e) => e.preventDefault());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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

function emitGlitter(p) {
  // Pure glitter: dense cluster of multi-colored bright dots + star shapes,
  // no base stroke line. Goes wilder than the sparkle brush.
  const radius = brushSize * 1.5;
  const count = 8 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const x = p.x + Math.cos(angle) * r;
    const y = p.y + Math.sin(angle) * r;
    const size = 2 + Math.random() * (brushSize * 0.5);
    const hue = Math.random() * 360;
    paintCtx.fillStyle = `hsl(${hue}, 95%, 60%)`;
    paintCtx.beginPath();
    paintCtx.arc(x, y, size, 0, Math.PI * 2);
    paintCtx.fill();
    // Bright white core
    if (Math.random() < 0.65) {
      paintCtx.fillStyle = 'rgba(255,255,255,.92)';
      paintCtx.beginPath();
      paintCtx.arc(x, y, size * 0.45, 0, Math.PI * 2);
      paintCtx.fill();
    }
    // Some become 4-point sparkle stars
    if (Math.random() < 0.28) {
      drawGlintStar(x, y, size * 1.6);
    }
  }
}

function drawGlintStar(x, y, r) {
  paintCtx.save();
  paintCtx.fillStyle = 'rgba(255,255,255,.95)';
  paintCtx.beginPath();
  const points = 4;
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = (i % 2 === 0) ? r : r * 0.28;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) paintCtx.moveTo(px, py); else paintCtx.lineTo(px, py);
  }
  paintCtx.closePath();
  paintCtx.fill();
  paintCtx.restore();
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
  if (!hasMeaningfulDecorationState) recountMeaningfulDecoration();
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
  const btn = submitBtn;
  if (!btn) return;
  const nameInput = document.getElementById('fishName');
  const fishName = (nameInput?.value || '').trim().slice(0, 20);
  if (!hasMeaningfulDecoration() && !recountMeaningfulDecoration()) {
    toast('Color your fish first so it is not plain white.');
    return;
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Polishing scales...';
  try {
    const rawDataUrl = exportFishPng();
    const [enhancedResult, describeResult] = await Promise.allSettled([
      enhanceFishArtwork(rawDataUrl),
      describeFishArt(rawDataUrl, currentFish, fishName),
    ]);
    const dataUrl = enhancedResult.status === 'fulfilled' && enhancedResult.value
      ? enhancedResult.value
      : rawDataUrl;
    const describe = describeResult.status === 'fulfilled' && describeResult.value
      ? describeResult.value
      : { nameSuggestion: '', bio: '' };
    const savedName = fishName || describe.nameSuggestion || '';
    const savedBio = describe.bio || '';

    btn.textContent = 'Swimming away...';
    const r = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: dataUrl,
        name: savedName,
        species: currentFish.id,
        bio: savedBio,
      }),
    });
    if (!r.ok) throw new Error('submit failed');
    const saved = await r.json();
    const finalName = (saved.name || savedName || '').trim();

    // Kick off the swim-off animation and the "Look up!" banner in parallel.
    // The TV polls every ~1.2s and then runs a ~650ms cinematic ramp, so the
    // splash on the TV lands roughly when the iPad animation completes.
    const swim = swimAway(dataUrl);
    showLookUpBanner();
    await swim;

    // Hold the banner a bit longer so guests' eyes reach the TV in time for the splash.
    await wait(1400);
    hideLookUpBanner();

    toast(finalName
      ? `${finalName} is swimming in the aquarium!`
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
    btn.textContent = original;
    updateSubmitState();
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
