const aq = document.getElementById('aquarium');
const countEl = document.getElementById('count');
const bubblesLayer = document.getElementById('bubbles');
const causticsCanvas = document.getElementById('caustics');

/** @type {Map<string, Fish>} */
const fishById = new Map();
// Fish that have been culled locally (swam off during the periodic thin-out).
// Kept so the poller doesn't immediately recreate them from the server list.
// Cleared on day rollover alongside fishById.
const culledIds = new Set();
let currentDay = null;

// Every CULL_INTERVAL_MS, half of the school-mode fish are sent off-screen.
// Keeps the tank from growing unbounded at an event.
const CULL_INTERVAL_MS = 10 * 60 * 1000;
const CULL_FRACTION = 0.5;
// Short polling — guests watch the podium→TV handoff, low latency sells the magic.
const POLL_MS = 1200;

// Splash-in timings (ms) for a brand-new fish
const CINEMATIC_INTRO_MS = 650;   // camera/dim/banner ramp before fish appears
const SPLASH_FALL_MS = 550;
const SPLASH_BURST_MS = 650;
const FEATURE_SWIM_MS = 8000;
const CINEMATIC_HOLD_MS = CINEMATIC_INTRO_MS + SPLASH_FALL_MS + SPLASH_BURST_MS + 600; // dim+zoom held through splash, then a beat
const FEATURE_TOTAL_MS = CINEMATIC_INTRO_MS + SPLASH_FALL_MS + SPLASH_BURST_MS + FEATURE_SWIM_MS;

const NAME_SHOW_MS = 4500;
const BACKGROUND_DRIFT_DELAY_MS = 60 * 1000;
const BACKGROUND_DRIFT_BLEND_MS = 40 * 1000;
const BACKGROUND_SCHOOL_LANES = [0.28, 0.5, 0.72];
const SCHOOL_SURGE_MIN_FISH = 5;
const FEEDING_FRENZY_MIN_FISH = 4;
const LIGHT_PULSE_MIN_FISH = 3;

// Honor the user's system-level motion preference.
const REDUCE_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
let REDUCE_MOTION = REDUCE_MOTION_QUERY.matches;
if (REDUCE_MOTION_QUERY.addEventListener) {
  REDUCE_MOTION_QUERY.addEventListener('change', (e) => { REDUCE_MOTION = e.matches; });
}

// ---- Platform detection: scale down effects on phones / low-power devices ----
// The aquarium is primarily designed for a big TV / kiosk, but guests may also
// open it on their phone. Detect that and dial back the expensive bits
// (WebGL caustics, drop-shadows, ambient bubble cadence) so iPhones stay
// smooth without silently breaking the big-screen experience.
const DEVICE = (() => {
  const ua = navigator.userAgent || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid || matchMedia('(pointer: coarse)').matches;
  const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 560;
  const lowMemory = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const lowPower = isMobile && (isSmallScreen || lowMemory);
  return { isIOS, isAndroid, isMobile, isSmallScreen, lowMemory, lowPower };
})();
document.documentElement.classList.toggle('is-mobile', DEVICE.isMobile);
document.documentElement.classList.toggle('is-ios', DEVICE.isIOS);
document.documentElement.classList.toggle('is-low-power', DEVICE.lowPower);
// Low-power devices (iPhone 12 mini, older Androids) get the reduced-motion
// codepath automatically — fewer particles, no cinematic zoom, no WebGL.
if (DEVICE.lowPower) REDUCE_MOTION = true;

// ---- Day/night tint: warm→cool filter sweep by local hour ----
const TINT_KEYFRAMES = [
  { h: 0,  b: .78, hue: -8,  sat: .90, sep: .00 },
  { h: 5,  b: .82, hue: -6,  sat: .92, sep: .00 },
  { h: 7,  b: .96, hue:  8,  sat: 1.06, sep: .08 },
  { h: 10, b: 1.00, hue: 0,  sat: 1.00, sep: .00 },
  { h: 14, b: 1.02, hue: 0,  sat: 1.00, sep: .00 },
  { h: 18, b: 0.98, hue: 12, sat: 1.10, sep: .12 },
  { h: 20, b: 0.88, hue:  4, sat: 1.00, sep: .04 },
  { h: 22, b: 0.80, hue: -4, sat: 0.92, sep: .00 },
  { h: 24, b: 0.78, hue: -8, sat: 0.90, sep: .00 },
];
function lerp(a, b, t) { return a + (b - a) * t; }
function tintForHour(h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 0; i < TINT_KEYFRAMES.length - 1; i++) {
    const a = TINT_KEYFRAMES[i], c = TINT_KEYFRAMES[i + 1];
    if (h >= a.h && h <= c.h) {
      const t = (h - a.h) / (c.h - a.h);
      return {
        b: lerp(a.b, c.b, t),
        hue: lerp(a.hue, c.hue, t),
        sat: lerp(a.sat, c.sat, t),
        sep: lerp(a.sep, c.sep, t),
      };
    }
  }
  return TINT_KEYFRAMES[0];
}
function applyDayNightTint() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const t = tintForHour(h);
  const filter = `brightness(${t.b.toFixed(3)}) saturate(${t.sat.toFixed(3)}) sepia(${t.sep.toFixed(3)}) hue-rotate(${t.hue.toFixed(1)}deg)`;
  document.documentElement.style.setProperty('--tint', filter);
}
applyDayNightTint();
setInterval(applyDayNightTint, 60 * 1000);

// Cursor tracking for fish repulsion.
const cursor = { x: -9999, y: -9999, active: false };
window.addEventListener('pointermove', (e) => {
  cursor.x = e.clientX; cursor.y = e.clientY; cursor.active = true;
});
window.addEventListener('pointerleave', () => { cursor.active = false; });
window.addEventListener('blur', () => { cursor.active = false; });

const SPRITE_FACING = { x: -1, y: 0 };

// ---- deterministic pseudo-random from fish id ----
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS = ['wavy', 'darter', 'circler', 'glider', 'zigzag'];

// ---- Species traits: habitat, locomotion, ecosystem role ----
// yMinF/yMaxF are fractions of viewport height (0 = top, 1 = bottom).
// locomotion drives wiggle style: swimmer (default), floater (seahorse),
// slitherer (eel — heavy body wave), glider (sting ray — subtle flap),
// crawler (sea slug — barely moves), predator (shark — large, solo),
// walker (shrimp — scuttles on the floor, legs hop),
// clinger (sea star — almost motionless on the floor),
// jetter (octopus / squid — tentacle-pulse jet propulsion).
const SPECIES_TRAITS = {
  fish1:     { locomotion: 'swimmer',   yMinF: 0.18, yMaxF: 0.70, speedMul: 1.00 },
  fish2:     { locomotion: 'swimmer',   yMinF: 0.20, yMaxF: 0.72, speedMul: 1.00 },
  fish3:     { locomotion: 'swimmer',   yMinF: 0.15, yMaxF: 0.65, speedMul: 1.00 },
  fish4:     { locomotion: 'swimmer',   yMinF: 0.18, yMaxF: 0.68, speedMul: 1.00 },
  fish5:     { locomotion: 'swimmer',   yMinF: 0.20, yMaxF: 0.72, speedMul: 1.00 },
  puffer1:   { locomotion: 'swimmer',   yMinF: 0.28, yMaxF: 0.75, speedMul: 0.75 },
  seahorse1: { locomotion: 'floater',   yMinF: 0.25, yMaxF: 0.70, speedMul: 0.45 },
  eel1:      { locomotion: 'slitherer', yMinF: 0.70, yMaxF: 0.90, speedMul: 0.70, ampMul: 2.6, freqMul: 0.85 },
  stingray1: { locomotion: 'glider',    yMinF: 0.72, yMaxF: 0.90, speedMul: 0.70, ampMul: 0.30, flap: true },
  seaslug1:  { locomotion: 'crawler',   yMinF: 0.90, yMaxF: 0.97, speedMul: 0.20, ampMul: 0.25, freqMul: 0.45, glide: true },
  shark1:    { locomotion: 'predator',  yMinF: 0.35, yMaxF: 0.82, speedMul: 0.85, sizeMul: 1.75, intimidateRadius: 260 },
  // Sea star — barely moves, clings to the floor. Zero body wiggle.
  seastar1:  { locomotion: 'clinger',   yMinF: 0.90, yMaxF: 0.97, speedMul: 0.08, ampMul: 0.0,  sizeMul: 0.55 },
  // Shrimp — scuttles along the bottom, legs-in-motion hop via fast wigglePhase.
  shrimp1:   { locomotion: 'walker',    yMinF: 0.86, yMaxF: 0.96, speedMul: 0.35, ampMul: 0.0,  freqMul: 2.6, sizeMul: 0.58, legs: true },
  // Octopus — mid-depth jet propulsion, tentacle pulses (slow continuous).
  octo1:     { locomotion: 'jetter',    yMinF: 0.40, yMaxF: 0.85, speedMul: 0.55, ampMul: 0.0,  freqMul: 0.8, sizeMul: 0.95, jetPulse: true },
  // Squid — upper/mid water, faster bursty jets with snappier pulses.
  squid1:    { locomotion: 'jetter',    yMinF: 0.22, yMaxF: 0.68, speedMul: 0.85, ampMul: 0.0,  freqMul: 1.1, sizeMul: 0.90, jetPulse: true, burst: true },
};
const DEFAULT_TRAITS = { locomotion: 'swimmer', yMinF: 0.15, yMaxF: 0.80, speedMul: 1.0 };

// ---- Personalities: archetypes that tune existing behavior weights ----
// Each fish rolls one on spawn (deterministic by id) and it shifts how eagerly
// it socializes, flees, visits the glass, and idles. Numbers are multipliers
// over the baseline — nothing new is introduced behaviorally, the fish just
// leans one way. Keeps the tank feeling like individuals, not clones.
const PERSONALITIES = {
  shy:     { id: 'shy',     encounterK: 0.55, glassK: 0.45, scareMul: 1.45, cohesionK: 1.30, idleBoost: 1.15 },
  bold:    { id: 'bold',    encounterK: 1.55, glassK: 1.80, scareMul: 0.65, cohesionK: 0.85, idleBoost: 0.80 },
  curious: { id: 'curious', encounterK: 1.35, glassK: 1.90, scareMul: 1.00, cohesionK: 1.00, idleBoost: 0.95 },
  lazy:    { id: 'lazy',    encounterK: 0.60, glassK: 0.60, scareMul: 1.15, cohesionK: 1.10, idleBoost: 1.80 },
  leader:  { id: 'leader',  encounterK: 1.10, glassK: 1.00, scareMul: 0.80, cohesionK: 0.70, idleBoost: 0.90 },
};
const PERSONALITY_ORDER = ['shy', 'bold', 'curious', 'lazy', 'leader'];
const DEFAULT_PERSONALITY = PERSONALITIES.curious;

// Species that stake out a patch of tank and loosely patrol it instead of
// drifting anywhere. A soft radial spring holds them near their home center.
// Leaves schooling fish (swimmers) unrestricted — territories are a solo trait.
const TERRITORIAL_SPECIES = new Set(['shark1', 'eel1', 'octo1']);
const TERRITORY_RADIUS = 220;

// If you add a new species, give it a custom arrival touch here too.
const SPECIES_ARRIVALS = {
  fish1:     { effect: 'glow',    path: 'playful', splashBand: [0.24, 0.34], endYF: 0.53, sway: 0.65 },
  fish2:     { effect: 'glow',    path: 'graceful', splashBand: [0.22, 0.32], endYF: 0.5,  sway: 0.45 },
  fish3:     { effect: 'bubbles', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.55, sway: 0.75 },
  fish4:     { effect: 'ribbon',  path: 'playful', splashBand: [0.22, 0.32], endYF: 0.52, sway: 0.58 },
  fish5:     { effect: 'glow',    path: 'playful', splashBand: [0.24, 0.34], endYF: 0.54, sway: 0.7 },
  puffer1:   { effect: 'bubbles', path: 'playful', splashBand: [0.28, 0.38], endYF: 0.6,  sway: 0.52, scaleMul: 1.04 },
  seahorse1: { effect: 'pearls',  path: 'floaty',  splashBand: [0.18, 0.28], endYF: 0.46, sway: 1.05, scaleMul: 0.94 },
  eel1:      { effect: 'ribbon',  path: 'slink',   splashBand: [0.7, 0.8],   endYF: 0.76, sway: 0.32, scaleMul: 0.96 },
  stingray1: { effect: 'sand',    path: 'glide',   splashBand: [0.72, 0.82], endYF: 0.74, sway: 0.2,  scaleMul: 1.08 },
  seaslug1:  { effect: 'silt',    path: 'heavy',   splashBand: [0.82, 0.9],  endYF: 0.86, sway: 0.18, scaleMul: 0.9 },
  shark1:    { effect: 'wake',    path: 'heavy',   splashBand: [0.34, 0.46], endYF: 0.48, sway: 0.12, scaleMul: 1.14, spotlight: 'predator' },
  seastar1:  { effect: 'sand',    path: 'heavy',   splashBand: [0.86, 0.92], endYF: 0.92, sway: 0.1,  scaleMul: 0.85 },
  shrimp1:   { effect: 'silt',    path: 'heavy',   splashBand: [0.82, 0.9],  endYF: 0.9,  sway: 0.22, scaleMul: 0.85 },
  octo1:     { effect: 'bubbles', path: 'floaty',  splashBand: [0.42, 0.55], endYF: 0.6,  sway: 0.55, scaleMul: 1.0 },
  squid1:    { effect: 'ribbon',  path: 'slink',   splashBand: [0.28, 0.4],  endYF: 0.46, sway: 0.5,  scaleMul: 0.95 },
};
const DEFAULT_ARRIVAL = { effect: 'glow', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.54, sway: 0.55, scaleMul: 1 };
const warnedArrivalSpecies = new Set();

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn('caustics shader compile failed', gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn('caustics program link failed', gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

function initCaustics(canvas) {
  if (!canvas) return null;

  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    stencil: false,
  });
  if (!gl) {
    canvas.classList.add('caustics-fallback');
    return null;
  }

  const vertexSource = `
    attribute vec2 aPos;
    void main() {
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;

    #define TAU 6.28318530718
    #define ITERATIONS 5

    // Classic caustics — iterated domain-warped trig creates the bright
    // filament/web pattern that real refracted sunlight makes on a pool
    // floor. Derived from the well-known TDM / Shadertoy caustics recipe.
    float causticNet(vec2 uv, float t) {
      vec2 p = mod(uv * TAU, TAU) - 250.0;
      vec2 i = p;
      float c = 1.0;
      float inten = 0.005;
      for (int n = 0; n < ITERATIONS; n++) {
        float ts = t * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(ts - i.x) + sin(ts + i.y),
                     sin(ts - i.y) + cos(ts + i.x));
        c += 1.0 / length(vec2(
          p.x / (sin(i.x + ts) / inten),
          p.y / (cos(i.y + ts) / inten)
        ));
      }
      c /= float(ITERATIONS);
      c = 1.17 - pow(c, 1.4);
      return max(0.0, pow(abs(c), 7.0));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      // Aspect-correct the sampling coords so the net doesn't stretch.
      vec2 p = vec2(uv.x * uResolution.x / uResolution.y, uv.y);

      float t = uTime * 0.35 + 23.0;

      // Two layers at different scales — richer texture without blowing out.
      float a = causticNet(p * 0.9, t);
      float b = causticNet(p * 1.7 + vec2(17.2, 8.3), t * 0.7) * 0.55;
      float brightness = max(a, b);

      // Depth falloff: strong at the surface (top), nearly invisible below.
      float depth = smoothstep(1.05, -0.2, uv.y);
      brightness *= depth;

      // Warm where sunlight enters, cooling to blue as it diffuses deeper.
      vec3 warmLight = vec3(1.0, 0.97, 0.84);
      vec3 coolLight = vec3(0.62, 0.90, 1.0);
      vec3 col = mix(coolLight, warmLight, smoothstep(0.2, 0.95, uv.y));

      float intensity = clamp(brightness, 0.0, 1.0);
      // Soft shoulder so peak filaments don't hotspot.
      intensity = 1.0 - pow(1.0 - intensity, 1.5);

      gl_FragColor = vec4(col * intensity, intensity * 0.85);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  if (!program) {
    canvas.classList.add('caustics-fallback');
    return null;
  }

  const positionLoc = gl.getAttribLocation(program, 'aPos');
  const timeLoc = gl.getUniformLocation(program, 'uTime');
  const resolutionLoc = gl.getUniformLocation(program, 'uResolution');
  const quad = gl.createBuffer();
  if (positionLoc < 0 || !timeLoc || !resolutionLoc || !quad) {
    canvas.classList.add('caustics-fallback');
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * dpr));
    const height = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * dpr));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  resize();
  canvas.classList.remove('caustics-fallback');

  return {
    resize,
    render(nowMs) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(timeLoc, nowMs * 0.001);
      gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

// Skip the WebGL caustics shader entirely on low-power devices — it costs a
// full-screen fragment pass every frame and dominates the iPhone thermal
// budget. The CSS fallback (caustics-fallback class) stays visually plausible.
const caustics = DEVICE.lowPower ? (causticsCanvas?.classList.add('caustics-fallback'), null)
                                 : initCaustics(causticsCanvas);

class Fish {
  constructor(meta) {
    this.id = meta.id;
    this.url = meta.url;
    this.createdAt = Number(meta.createdAt) || Date.now();
    this.name = (meta.name || '').trim();
    this.bio = (meta.bio || '').trim();
    this.species = (meta.species || '').toLowerCase();
    this.traits = SPECIES_TRAITS[this.species] || DEFAULT_TRAITS;
    this.arrivalProfile = SPECIES_ARRIVALS[this.species] || DEFAULT_ARRIVAL;
    if (this.species && !SPECIES_ARRIVALS[this.species] && !warnedArrivalSpecies.has(this.species)) {
      warnedArrivalSpecies.add(this.species);
      console.warn(`Add a custom SPECIES_ARRIVALS entry for "${this.species}" so it gets its own arrival moment.`);
    }
    this.locomotion = this.traits.locomotion;
    this.isPuffer = this.species === 'puffer1';
    this.isShark = this.species === 'shark1';
    this.isPrey = this.locomotion === 'swimmer' && !this.isShark;
    // Puff-up state: 0..1 scale overlay on the sprite.
    this.puffLevel = 0;
    this.puffTarget = 0;
    this.puffTimer = this.isPuffer ? (30 + Math.random() * 60) : Infinity;
    // Scare response (prey fish bolting from a nearby predator).
    this.scareTTL = 0;
    this.scareDir = { x: 0, y: 0 };

    this.rand = mulberry32(hashStr(meta.id));
    this.pattern = PATTERNS[Math.floor(this.rand() * PATTERNS.length)];

    // Age-driven depth: fresh fish feel foregrounded, then gradually settle
    // into a calmer back-of-tank school after about a minute.
    const r = this.rand();
    this.depthJitter = r;
    this.depth = 'mid';
    this.frontDepthScale = 1.14 + r * 0.14;
    this.backDepthScale = 0.68 + r * 0.12;
    this.depthSpeed = 0.94 + r * 0.14;

    this.el = document.createElement('div');
    this.el.className = 'fish-sprite depth-mid';
    this.flipEl = document.createElement('div');
    this.flipEl.className = 'fish-flip';
    this.pitchEl = document.createElement('div');
    this.pitchEl.className = 'fish-pitch';
    this.wiggleEl = document.createElement('div');
    this.wiggleEl.className = 'fish-wiggle';
    this.img = document.createElement('img');
    this.img.src = this.url;
    this.img.alt = 'fish';
    this.img.draggable = false;
    this.wiggleEl.appendChild(this.img);
    this.pitchEl.appendChild(this.wiggleEl);
    this.flipEl.appendChild(this.pitchEl);
    this.el.appendChild(this.flipEl);
    this.shadowEl = document.createElement('img');
    this.shadowEl.className = 'fish-shadow';
    this.shadowEl.src = this.url;
    this.shadowEl.alt = '';
    this.shadowEl.draggable = false;
    this.shadowEl.setAttribute('aria-hidden', 'true');
    this.shadowEl.style.opacity = '0';
    aq.appendChild(this.shadowEl);
    aq.appendChild(this.el);

    this.loaded = false;
    this.img.addEventListener('load', () => {
      this.loaded = true;
      this.naturalW = this.img.naturalWidth || 300;
      this.naturalH = this.img.naturalHeight || 200;
      if (this.naturalH > this.naturalW * 1.15) {
        this.isSeahorse = true;
        this.wiggleAmpBase *= 0.35;
        this.wiggleBase *= 0.6;
      }
      // Species-trait wiggle overrides (applied after seahorse-by-aspect detection).
      if (this.traits.ampMul !== undefined) this.wiggleAmpBase *= this.traits.ampMul;
      if (this.traits.freqMul !== undefined) this.wiggleBase *= this.traits.freqMul;
    });

    this.mode = 'featured';
    this.cinematicPending = false;
    this.phaseStart = performance.now();

    this.splashX = 80 + this.rand() * 160;
    const splashBand = this.arrivalProfile.splashBand || DEFAULT_ARRIVAL.splashBand;
    this.splashY = window.innerHeight * (splashBand[0] + this.rand() * Math.max(0.02, splashBand[1] - splashBand[0]));

    this.baseSpeed = (45 + this.rand() * 45) * this.depthSpeed * (this.traits.speedMul || 1);
    this.schoolBaseSize = (80 + this.rand() * 80) * (this.traits.sizeMul || 1);
    this.waveAmp = 14 + this.rand() * 22;
    this.wavePeriod = 1.6 + this.rand() * 2.2;
    this.wavePhase = this.rand() * Math.PI * 2;
    this.turnTimer = 0;
    // Tail-beat: very slow and very minimal — the body wiggle is a subtle
    // secondary motion, not the fish's main expression. Base tops out near
    // ~0.45 Hz with ~3° of sweep; species traits (eel, etc.) scale from here.
    this.wiggleBase = 0.25 + this.rand() * 0.20;     // 0.25 – 0.45 Hz base
    this.wiggleAmpBase = 0.04 + this.rand() * 0.03;  // 0.04 – 0.07 rad (2.3°–4°)
    this.wigglePhase = this.rand() * Math.PI * 2;
    this._wiggleFreq = this.wiggleBase;              // updated per frame
    this.dartCooldown = 0.8 + this.rand() * 1.6;
    this.dartPhase = 'cruise';
    this.circleTheta = this.rand() * Math.PI * 2;
    this.circleCenterX = 0;
    this.circleCenterY = 0;
    this.circleR = 80 + this.rand() * 60;
    this.circleOmega = (0.6 + this.rand() * 0.8) * (this.rand() < 0.5 ? -1 : 1);

    // Idle-state bookkeeping
    this.idleTimer = 2 + this.rand() * 4;
    this.idleDuration = 0;
    this.isIdle = false;
    this.bubbleTimer = 3 + this.rand() * 6;

    // Encounter system: occasional chase / orbit / curious interactions.
    this.encounterCooldown = 8 + this.rand() * 14;   // seconds before first attempt
    this.encounterState = null;                       // 'chase'|'fleeing'|'orbit'|'curious'
    this.encounterTarget = null;
    this.encounterTTL = 0;

    this.x = -9999;
    this.y = -9999;
    this.vx = -this.baseSpeed;
    this.vy = 0;
    this.size = 120;

    this.badge = document.createElement('span');
    this.badge.className = 'badge-new';
    this.badge.textContent = 'New!';
    aq.appendChild(this.badge);

    // Persistent name tag (shown briefly on entry, and on hover-near reveal)
    this.nameTag = null;
    if (this.name) {
      this.nameTag = document.createElement('div');
      this.nameTag.className = 'fish-name';
      this.nameTag.textContent = this.name;
      aq.appendChild(this.nameTag);
    }
    this.nameShowUntil = 0;

    this.splash = null;
    this.arrivalFx = null;
    this.arrivalFxTimer = null;
    this.arrivalMomentPlayed = false;
    this.glassCuriosityCooldown = 8 + this.rand() * 14;
    this.glassCuriosityTTL = 0;
    this.glassCuriosityTarget = null;

    // Occasional "swim behind" pass — when in a school, a fish may briefly
    // slip behind peers and coral instead of riding on top. Preference is to
    // stay in the foreground; this is the exception, not the rule.
    this.behindTTL = 0;
    this.behindCooldown = 22 + this.rand() * 45;

    // Fast-fish bubble trail throttling.
    this.speedBubbleTimer = 0;

    // Surface-ripple cooldown so a fish lingering near the surface doesn't
    // spam ripples every frame. One ripple every ~1.6s per fish is plenty
    // to read as "something broke the water."
    this.surfaceRippleCooldown = 0;
    this._wasNearSurface = false;

    // ---- Personality: deterministic archetype per fish id ----
    const pKey = PERSONALITY_ORDER[Math.floor(this.rand() * PERSONALITY_ORDER.length)];
    this.personality = PERSONALITIES[pKey] || DEFAULT_PERSONALITY;

    // ---- Banking on turns: track prior travel direction; when vx flips,
    // play a short roll so the body leans into the new direction. ----
    this._prevVxSign = 0;
    this.bankTTL = 0;
    this.bankDur = 0.55;
    this.bankDir = 0;

    // ---- Breathing: very slow, tiny body pulse. Offset per fish so they
    // don't breathe in unison. ----
    this.breatheOffset = this.rand() * Math.PI * 2;

    // ---- Idle hover: a dedicated phase for the pectoral-fin flutter so it
    // doesn't phase-lock with the main tail wiggle. ----
    this.hoverPhase = this.rand() * Math.PI * 2;

    // ---- Territory (solo species only) ----
    if (TERRITORIAL_SPECIES.has(this.species)) {
      const W = window.innerWidth, H = window.innerHeight;
      const yMin = (this.traits.yMinF || 0.1) * H;
      const yMax = (this.traits.yMaxF || 0.9) * H;
      this.home = {
        x: W * (0.22 + this.rand() * 0.56),
        y: yMin + this.rand() * Math.max(1, yMax - yMin),
        r: TERRITORY_RADIUS * (0.85 + this.rand() * 0.4),
      };
    } else {
      this.home = null;
    }

    // ---- Wake distortion element (created on demand when a fish goes fast) ----
    this.wakeEl = null;
  }

  startAsSchool() {
    this.mode = 'school';
    this.phaseStart = performance.now();
    this.badge.remove();
    cinematicEnd(this);
    this.clearArrivalFx();
    if (this.splash) { this.splash.remove(); this.splash = null; }
    const W = window.innerWidth, H = window.innerHeight;
    const targetSize = this.schoolTargetSize(Date.now());

    // Smooth shrink from the featured size down to the school size so the fish
    // doesn't visibly "pop" into the background while it begins its slow
    // lifecycle drift toward the rear school.
    this.schoolTransitionMs = 1500;
    this.schoolTransitionStart = performance.now();
    this.schoolTransitionFromSize = this.size || targetSize;

    // Hold the sprite above the coral overlay while its filter fades in,
    // so it doesn't visibly drop behind foreground elements mid-shrink.
    this.el.classList.add('school-settling');
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this.el.classList.remove('school-settling');
      this._settleTimer = null;
    }, this.schoolTransitionMs);

    if (this.x < -1000) {
      // Habitat-aware initial placement: bottom-dwellers start near the floor,
      // floaters in mid-column, swimmers anywhere in their preferred band.
      // If any same-species fish is already schooling, bias placement toward
      // one of them so new arrivals join their own kind.
      const sameKin = [];
      for (const other of fishById.values()) {
        if (other === this) continue;
        if (other.mode !== 'school' || !other.loaded) continue;
        if (this.species && other.species === this.species) sameKin.push(other);
      }
      if (sameKin.length) {
        const pick = sameKin[Math.floor(Math.random() * sameKin.length)];
        this.x = pick.x + (Math.random() - 0.5) * 140;
        this.y = pick.y + (Math.random() - 0.5) * 80;
        // Clamp to viewport / habitat.
        this.x = Math.max(0, Math.min(W - 50, this.x));
        const yMin = this.traits.yMinF * H;
        const yMax = this.traits.yMaxF * H;
        this.y = Math.max(yMin, Math.min(yMax, this.y));
      } else {
        this.x = Math.random() * W;
        const yMin = this.traits.yMinF * H;
        const yMax = this.traits.yMaxF * H;
        this.y = yMin + Math.random() * Math.max(1, (yMax - yMin));
      }
    }

    const dir = this.vx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(this.vx);
    this.vx = dir * this.baseSpeed;
    this.vy = (this.rand() - 0.5) * 12;

    this.circleCenterX = this.x;
    this.circleCenterY = this.y;

    // Show name tag for a few seconds when entering the school.
    if (this.nameTag) this.nameShowUntil = performance.now() + NAME_SHOW_MS;
  }

  ageMs(nowEpochMs) {
    return Math.max(0, nowEpochMs - this.createdAt);
  }

  backgroundProgress(nowEpochMs) {
    const raw = (this.ageMs(nowEpochMs) - BACKGROUND_DRIFT_DELAY_MS) / BACKGROUND_DRIFT_BLEND_MS;
    return Math.max(0, Math.min(1, raw));
  }

  layerState(nowEpochMs) {
    const raw = this.backgroundProgress(nowEpochMs);
    const progress = easeInOut(raw);
    const scale = this.frontDepthScale + (this.backDepthScale - this.frontDepthScale) * progress;
    return {
      progress,
      scale,
      zIndex: 7.6 + this.depthJitter * 0.45 + (4.1 + this.depthJitter * 0.35 - (7.6 + this.depthJitter * 0.45)) * progress,
      opacity: 0.99 + (0.84 - 0.99) * progress,
      saturate: 1.02 + (0.78 - 1.02) * progress,
      brightness: 1.0 + (0.84 - 1.0) * progress,
      blur: 0.04 + 0.62 * progress,
      shadowBlurAdd: 4.0 * progress,
      shadowOpacityMul: 1.0 + (0.72 - 1.0) * progress,
      dropShadowY: 8 + (4.5 - 8) * progress,
      dropShadowBlur: 16 + (10 - 16) * progress,
      dropShadowAlpha: 0.45 + (0.34 - 0.45) * progress,
    };
  }

  schoolTargetSize(nowEpochMs) {
    return this.schoolBaseSize * this.layerState(nowEpochMs).scale;
  }

  backgroundAnchor(W, H, nowEpochMs) {
    const seed = hashStr(this.species || this.id);
    const lane = BACKGROUND_SCHOOL_LANES[seed % BACKGROUND_SCHOOL_LANES.length];
    const yMin = Math.max(40, this.traits.yMinF * H);
    const yMax = Math.min(H - this.size - 20, this.traits.yMaxF * H);
    let habitatBias = 0.34;
    if (this.locomotion === 'floater') habitatBias = 0.48;
    else if (this.locomotion === 'predator') habitatBias = 0.42;
    else if (this.locomotion === 'slitherer') habitatBias = 0.72;
    else if (this.locomotion === 'glider') habitatBias = 0.8;
    else if (this.locomotion === 'crawler') habitatBias = 0.88;
    const sway = Math.sin(nowEpochMs * 0.00008 + seed * 0.001 + this.wavePhase) * (28 + this.depthJitter * 22);
    const bob = Math.cos(nowEpochMs * 0.00006 + seed * 0.0013 + this.wavePhase) * (10 + this.depthJitter * 6);
    return {
      x: W * lane + sway,
      y: yMin + (yMax - yMin) * habitatBias + bob,
    };
  }

  applyDepthVisuals(state) {
    const settling = this.el.classList.contains('school-settling');
    const behind = this.behindTTL > 0;
    let zIndex = settling ? Math.max(9, Math.round(state.zIndex)) : Math.round(state.zIndex);
    // Behind-pass: drop below peers (and below the coral overlay zIndex).
    if (behind && !settling) zIndex = Math.max(2, zIndex - 4);
    const blur = state.blur + (behind ? 0.9 : 0);
    const brightness = state.brightness * (behind ? 0.88 : 1);
    if (!this._appliedDepth
        || Math.abs(this._appliedDepth.progress - state.progress) > 0.01
        || this._appliedDepth.settling !== settling
        || this._appliedDepth.behind !== behind) {
      this.el.style.zIndex = String(zIndex);
      this.el.style.opacity = state.opacity.toFixed(3);
      this.el.style.filter =
        `drop-shadow(0 ${state.dropShadowY.toFixed(1)}px ${state.dropShadowBlur.toFixed(1)}px rgba(0,0,0,${state.dropShadowAlpha.toFixed(3)})) ` +
        `saturate(${state.saturate.toFixed(3)}) brightness(${brightness.toFixed(3)}) blur(${blur.toFixed(2)}px)`;
      this._appliedDepth = { progress: state.progress, settling, behind };
    }
  }

  applyBackgroundSchooling(dt, W, H, nowEpochMs) {
    const ageSchool = this.layer?.progress || 0;
    if (ageSchool <= 0) return;
    if (this.scareTTL > 0 || this.encounterState === 'chase' || this.encounterState === 'fleeing') return;
    // Territorial species have their own anchor (applyTerritory) — having
    // both pulls fight each other parks them in weird compromise spots.
    if (this.home) return;

    const anchor = this.backgroundAnchor(W, H, nowEpochMs);
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    const steer = ageSchool * ageSchool;
    const bottomDweller = this.locomotion === 'crawler' || this.locomotion === 'walker' || this.locomotion === 'clinger';
    const pull = (this.locomotion === 'predator' || bottomDweller) ? 0.18 : 0.3;
    this.vx += (anchor.x - myCx) * pull * steer * dt;
    this.vy += (anchor.y - myCy) * (pull * 1.2) * steer * dt;
  }

  clearArrivalFx() {
    if (this.arrivalFxTimer) {
      clearTimeout(this.arrivalFxTimer);
      this.arrivalFxTimer = null;
    }
    if (this.arrivalFx) {
      this.arrivalFx.remove();
      this.arrivalFx = null;
    }
  }

  spawnArrivalMoment() {
    if (REDUCE_MOTION || this.arrivalFx) return;
    const effect = this.arrivalProfile.effect || DEFAULT_ARRIVAL.effect;
    const el = document.createElement('div');
    el.className = `arrival-fx arrival-${effect}`;
    const count = effect === 'glow' ? 3 : effect === 'wake' ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const span = document.createElement('span');
      span.style.setProperty('--dx', `${(this.rand() - 0.5) * (effect === 'wake' ? 150 : 110)}px`);
      span.style.setProperty('--dy', `${-18 - this.rand() * 80}px`);
      span.style.setProperty('--delay', `${(i * 0.05).toFixed(2)}s`);
      span.style.setProperty('--dur', `${(0.9 + this.rand() * 0.7).toFixed(2)}s`);
      span.style.setProperty('--rot', `${(-30 + this.rand() * 60).toFixed(1)}deg`);
      span.style.setProperty('--scale', (0.7 + this.rand() * 0.8).toFixed(2));
      el.appendChild(span);
    }
    el.style.transform = `translate(${this.splashX}px, ${this.splashY}px)`;
    const fxLayer = (effect === 'sand' || effect === 'silt') ? tankFxBackLayer : tankFxFrontLayer;
    fxLayer.appendChild(el);
    this.arrivalFx = el;
    requestAnimationFrame(() => el.classList.add('show'));
    this.arrivalFxTimer = setTimeout(() => {
      if (!this.arrivalFx) return;
      this.arrivalFx.classList.add('done');
      const fx = this.arrivalFx;
      this.arrivalFx = null;
      this.arrivalFxTimer = null;
      setTimeout(() => fx.remove(), 700);
    }, effect === 'wake' ? 1900 : 1600);
  }

  stepGlassCuriosity(dt, tMs, W, H, events) {
    if (this.mode !== 'school') return;
    if (this.locomotion === 'crawler' || this.locomotion === 'walker' || this.locomotion === 'clinger') return;
    if (events?.feeding || events?.surge || this.isIdle) {
      this.glassCuriosityTTL = 0;
      this.glassCuriosityTarget = null;
      return;
    }
    if (this.glassCuriosityTTL > 0) {
      this.glassCuriosityTTL -= dt;
      if (this.nameTag) this.nameShowUntil = Math.max(this.nameShowUntil, tMs + 600);
      if (this.glassCuriosityTTL <= 0) {
        this.glassCuriosityTarget = null;
        this.glassCuriosityCooldown = (14 + this.rand() * 20) / this.personality.glassK;
        return;
      }
      const target = this.glassCuriosityTarget;
      if (!target) return;
      const cx = this.x + this.size * 0.5;
      const cy = this.y + this.size * 0.5;
      const dx = target.x - cx;
      const dy = target.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const pull = this.isShark ? 26 : this.locomotion === 'floater' ? 20 : 30;
      const pace = d < 40 ? 0.14 : 0.28;
      this.vx += (dx / d) * pull * pace * dt * Math.min(2.2, d / 70 + 0.5);
      this.vy += (dy / d) * pull * pace * dt * Math.min(2.0, d / 90 + 0.4);
      return;
    }
    this.glassCuriosityCooldown -= dt;
    if (this.glassCuriosityCooldown > 0) return;
    this.glassCuriosityCooldown = (10 + this.rand() * 18) / this.personality.glassK;
    if (this.rand() < 0.55) return;
    this.glassCuriosityTTL = 1.8 + this.rand() * 1.6;
    this.glassCuriosityTarget = {
      x: W * (0.38 + this.rand() * 0.24),
      y: clamp(this.y + (this.rand() - 0.5) * 120, H * 0.2, H * 0.68),
    };
  }

  applyTankSceneForces(dt, tMs, W, H, events) {
    if (!events) return;
    if (this.scareTTL > 0 || this.encounterState === 'chase' || this.encounterState === 'fleeing') return;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;

    const sceneBottomDweller = this.locomotion === 'crawler' || this.locomotion === 'walker' || this.locomotion === 'clinger';
    if (events.surge && !sceneBottomDweller) {
      const age = (tMs - events.surge.startedAt) / events.surge.duration;
      const pulse = Math.sin(Math.PI * Math.max(0, Math.min(1, age)));
      const participation = this.isShark ? 0.45 : this.locomotion === 'floater' ? 0.62 : 0.92;
      this.vx += events.surge.dx * participation * pulse * dt;
      this.vy += events.surge.dy * participation * pulse * dt;
    }

    if (events.feeding && !sceneBottomDweller) {
      const dx = events.feeding.x - myCx;
      const dy = events.feeding.y - myCy;
      const d = Math.hypot(dx, dy) || 1;
      const pull = this.isShark ? 32 : this.locomotion === 'floater' ? 24 : 42;
      const appetite = this.locomotion === 'glider' ? 0.72 : this.locomotion === 'slitherer' ? 0.6 : 1;
      this.vx += (dx / d) * pull * appetite * dt;
      this.vy += (dy / d) * pull * appetite * dt;
      if (this.nameTag && d < 140) this.nameShowUntil = Math.max(this.nameShowUntil, tMs + 700);
    }

    this.stepGlassCuriosity(dt, tMs, W, H, events);
  }

  ensureSplash() {
    if (this.splash) return;
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = '<span></span><span></span><span></span>';
    aq.appendChild(el);
    el.style.transform = `translate(${this.splashX}px, ${this.splashY}px)`;
    this.splash = el;
  }

  update(dtMs, tMs, scene) {
    if (!this.loaded) return;
    const nowEpochMs = scene.nowEpochMs;
    const W = window.innerWidth, H = window.innerHeight;
    const aspect = this.naturalW / this.naturalH;
    this.layer = this.layerState(nowEpochMs);

    // Tick the tail-beat phase from dt so freq changes don't cause the wave
    // position to jump — previously it was derived from wall-clock * freq,
    // which produced the "seizure" jitter whenever speed fluctuated.
    this.stepWigglePhase(dtMs / 1000);

    // Reset-hotspot triggers a graceful swim-off; once the sprite clears the
    // viewport it self-destroys.
    if (this.departing) {
      this.stepDeparting(dtMs / 1000, W, H, aspect);
      return;
    }

    if (this.mode === 'featured') {
      this.updateFeatured(tMs, W, H, aspect);
      this.updateNameTag(tMs);
      return;
    }

    const dt = dtMs / 1000;

    // Smooth shrink from the featured size to the final school size so newly
    // joined fish glide into the background instead of popping.
    const desiredSize = this.schoolTargetSize(nowEpochMs);
    if (this.schoolTransitionMs > 0) {
      const elapsed = tMs - this.schoolTransitionStart;
      if (elapsed >= this.schoolTransitionMs) {
        this.size = desiredSize;
        this.schoolTransitionMs = 0;
      } else {
        const u = elapsed / this.schoolTransitionMs;
        const e = easeInOut(u);
        this.size = this.schoolTransitionFromSize +
          (desiredSize - this.schoolTransitionFromSize) * e;
      }
    } else {
      const settle = Math.min(1, dt * (0.65 + this.layer.progress * 1.15));
      this.size += (desiredSize - this.size) * settle;
    }

    this.stepEncounter(dt, scene.schoolFish);

    // Prey fish notice predators and bolt on proximity.
    if (this.isPrey) this.applyPredatorScare(scene.predators);

    if (this.scareTTL > 0) {
      // Flee response dominates — skip personality / encounters / flocking.
      this.scareTTL -= dt;
      const sp = this.baseSpeed * 3.5;
      this.vx += (this.scareDir.x * sp - this.vx) * 4.0 * dt;
      this.vy += (this.scareDir.y * sp - this.vy) * 4.0 * dt;
    } else if (this.encounterState !== 'chase' && this.encounterState !== 'fleeing') {
      // Locomotion-specific behavior by species.
      switch (this.locomotion) {
        case 'crawler':   this.stepCrawler(dt); break;
        case 'walker':    this.stepWalker(dt); break;
        case 'clinger':   this.stepClinger(dt); break;
        case 'jetter':    this.stepJetter(dt, W, H); break;
        case 'predator':  this.stepPredator(dt, W, H); break;
        case 'floater':   this.stepFloater(dt, W, H); break;
        case 'slitherer': this.stepSlitherer(dt, W, H); break;
        case 'glider':    this.stepGlider(dt, W, H); break;
        default:          this.stepPersonality(dt, W, H);
      }
    }
    this.applyEncounterForce(dt);
    this.applyCursorRepulsion(dt);
    this.applyFlocking(dt, scene.schoolFish, scene.leaderBySpecies);
    this.applyBackgroundSchooling(dt, W, H, nowEpochMs);
    this.applyTerritory(dt);
    this.applyTankSceneForces(dt, tMs, W, H, scene.events);
    this.stepIdle(dt, tMs);
    this.stepBanking(dt);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const h = this.size;
    const w = h * aspect;

    if (this.x < -w * 0.25) { this.x = -w * 0.25; this.vx = Math.abs(this.vx); }
    if (this.x > W - w * 0.75) { this.x = W - w * 0.75; this.vx = -Math.abs(this.vx); }
    // Soft habitat clamping: each species prefers its own vertical band.
    // A gentle spring pulls strayed animals back into range; hard walls at the
    // absolute viewport edges prevent leaving the tank.
    const yMinHabitat = Math.max(40, this.traits.yMinF * H);
    const yMaxHabitat = Math.min(H - h - 20, this.traits.yMaxF * H);
    if (this.y < yMinHabitat) {
      const over = yMinHabitat - this.y;
      this.vy += Math.min(over, 40) * 1.5 * dt;
    } else if (this.y > yMaxHabitat) {
      const over = this.y - yMaxHabitat;
      this.vy -= Math.min(over, 40) * 1.5 * dt;
    }
    if (this.y < 20) { this.y = 20; this.vy = Math.abs(this.vy); }
    if (this.y > H - h - 10) { this.y = H - h - 10; this.vy = -Math.abs(this.vy); }

    this.renderSprite(this.x, this.y, w, h, this.vx, this.vy);
    this.updateNameTag(tMs);

    // Occasional bubble emission from the fish's head region.
    if (!REDUCE_MOTION) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleTimer = 4 + this.rand() * 8;
        this.emitBubble(w, h);
      }
    }

    this.stepBehindPass(dt);
    if (!REDUCE_MOTION) this.stepSpeedTrail(dt, w, h);
    if (!REDUCE_MOTION && !DEVICE.lowPower) this.stepWake(dt, w, h);
    this.stepSurfaceRipple(dt, w);

    // Puffer-only: rare puff-up behavior.
    if (this.isPuffer) this.stepPuff(dt);
  }

  // Surface ripples: if the top of the fish gets close to the waterline,
  // emit a ripple at the sprite's horizontal center. Ripples happen on
  // entry (immediate) and then at most every ~1.6s while still near.
  stepSurfaceRipple(dt, w) {
    if (this.surfaceRippleCooldown > 0) this.surfaceRippleCooldown -= dt;
    const surfaceY = SURFACE_WATERLINE_PX;
    const near = this.y < surfaceY + SURFACE_TRIGGER_PX;
    if (!near) {
      this._wasNearSurface = false;
      return;
    }
    // Entering the surface band — always pop one ripple. Lingering there
    // only adds another after the cooldown clears.
    if (!this._wasNearSurface || this.surfaceRippleCooldown <= 0) {
      const cx = this.x + w * 0.5;
      spawnSurfaceRipple(cx);
      this.surfaceRippleCooldown = 1.4 + Math.random() * 0.6;
    }
    this._wasNearSurface = true;
  }

  // Territorial fish (sharks, eels, octopi) hover near a personal home
  // point they claimed at spawn. Weak radial spring — easily overridden by
  // chase/scare — so it adds structure without caging them.
  applyTerritory(dt) {
    if (!this.home) return;
    if (this.scareTTL > 0) return;
    if (this.encounterState === 'chase' || this.encounterState === 'fleeing') return;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    const dx = this.home.x - myCx;
    const dy = this.home.y - myCy;
    const d = Math.hypot(dx, dy);
    if (d < this.home.r * 0.5) return;
    // Strengthen past the home radius; inside it, only a whisper.
    const over = Math.max(0, d - this.home.r * 0.5);
    const pull = Math.min(0.35, 0.06 + over / Math.max(1, this.home.r) * 0.22);
    this.vx += (dx / (d || 1)) * pull * over * dt;
    this.vy += (dy / (d || 1)) * pull * over * dt;
  }

  // Banking on turns: when horizontal travel direction flips, start a short
  // roll that eases through 0→peak→0 rotateY. Just the state machine here;
  // the actual rotation is applied in renderSprite.
  stepBanking(dt) {
    const sign = Math.abs(this.vx) < 14 ? 0 : (this.vx > 0 ? 1 : -1);
    if (sign !== 0 && this._prevVxSign !== 0 && sign !== this._prevVxSign) {
      // Fresh turn — arm a bank in the new direction.
      this.bankTTL = this.bankDur;
      this.bankDir = sign;
    }
    if (sign !== 0) this._prevVxSign = sign;
    if (this.bankTTL > 0) this.bankTTL = Math.max(0, this.bankTTL - dt);
  }

  // Wake distortion: a faint trailing wedge behind fast-moving fish. The
  // element is created lazily, positioned behind the sprite (opposite
  // travel), scaled by speed, and faded out when the fish slows down.
  // Skipped entirely on reduce-motion / low-power.
  stepWake(dt, w, h) {
    const speed = Math.hypot(this.vx, this.vy);
    const threshold = this.baseSpeed * 1.6;
    const active = speed > threshold;
    if (!active) {
      if (this.wakeEl) {
        this.wakeEl.style.opacity = '0';
      }
      return;
    }
    if (!this.wakeEl) {
      const el = document.createElement('div');
      el.className = 'fish-wake';
      aq.appendChild(el);
      this.wakeEl = el;
    }
    // Direction: wedge sits directly behind the fish opposite travel.
    const mag = speed || 1;
    const nx = this.vx / mag;
    const ny = this.vy / mag;
    const backX = -nx;
    const backY = -ny;
    const intensity = Math.min(1, (speed - threshold) / (this.baseSpeed * 1.8));
    const length = (h * 0.9) * (0.6 + intensity * 0.8);
    const thickness = Math.max(12, h * 0.32);
    const cx = this.x + w * 0.5 + backX * length * 0.55;
    const cy = this.y + h * 0.5 + backY * length * 0.55;
    const angle = Math.atan2(ny, nx) * 180 / Math.PI;
    this.wakeEl.style.width = `${length}px`;
    this.wakeEl.style.height = `${thickness}px`;
    this.wakeEl.style.opacity = String(0.18 + intensity * 0.32);
    this.wakeEl.style.transform =
      `translate(${cx - length / 2}px, ${cy - thickness / 2}px) rotate(${angle}deg)`;
    // Sit just above the background caustics but below normal fish sprites.
    this.wakeEl.style.zIndex = String(Math.max(2, Math.round((this.layer?.zIndex || 5) - 1)));
  }

  // Rare schooling exception: slip behind peers and coral for a moment.
  // Bottom-dwellers and predators never go behind — they'd just look misplaced.
  stepBehindPass(dt) {
    if (this.behindTTL > 0) {
      this.behindTTL -= dt;
      if (this.behindTTL <= 0) {
        this.behindTTL = 0;
        this.behindCooldown = 30 + this.rand() * 60;
      }
      return;
    }
    if (this.locomotion === 'predator' || this.locomotion === 'crawler'
        || this.locomotion === 'walker' || this.locomotion === 'clinger') return;
    // Only attempt once the fish has fully settled into the school.
    const settled = (this.layer?.progress || 0) > 0.2;
    if (!settled) return;
    this.behindCooldown -= dt;
    if (this.behindCooldown > 0) return;
    this.behindCooldown = 18 + this.rand() * 30;
    // Low probability each attempt — this is the exception, not the rule.
    if (this.rand() < 0.12) {
      this.behindTTL = 2.4 + this.rand() * 2.6;
    }
  }

  // Fast-moving fish push the water: puff little bubbles at the nose which
  // then join the ambient rise. Throttled and only triggers above a speed
  // threshold so the effect lands with scares, chases, and hard turns.
  stepSpeedTrail(dt, w, h) {
    this.speedBubbleTimer -= dt;
    if (this.speedBubbleTimer > 0) return;
    const speed = Math.hypot(this.vx, this.vy);
    const threshold = this.baseSpeed * 1.9;
    if (speed < threshold) {
      this.speedBubbleTimer = 0.05;
      return;
    }
    // Faster → more frequent. Cap the cadence so we don't spam the DOM.
    const overshoot = Math.min(1, (speed - threshold) / (this.baseSpeed * 2.2));
    this.speedBubbleTimer = 0.14 - overshoot * 0.08;
    this.emitSpeedBubble(w, h);
  }

  emitSpeedBubble(w, h) {
    const headOffsetX = this.vx > 0 ? w * 0.88 : w * 0.12;
    const bx = this.x + headOffsetX;
    const by = this.y + h * (0.38 + this.rand() * 0.18);
    const b = document.createElement('div');
    b.className = 'bubble-pop speed';
    const size = 3 + this.rand() * 3.5;
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    aq.appendChild(b);

    const start = performance.now();
    const dur = 700 + this.rand() * 450;
    // Small lateral kick opposite the travel direction, then it rises.
    const kickX = (this.vx > 0 ? -1 : 1) * (10 + this.rand() * 14);
    const driftX = (this.rand() - 0.5) * 18;
    const riseY = 55 + this.rand() * 35;
    const step = (now) => {
      const u = Math.min(1, (now - start) / dur);
      // Quick kick during the first 25% of life, then steady upward drift.
      const kickPhase = Math.min(1, u / 0.25);
      const x = bx + kickX * kickPhase + driftX * u;
      const y = by - riseY * u;
      const alpha = u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88);
      b.style.transform = `translate(${x}px, ${y}px) scale(${0.7 + u * 0.5})`;
      b.style.opacity = Math.max(0, alpha);
      if (u < 1) requestAnimationFrame(step);
      else b.remove();
    };
    requestAnimationFrame(step);
  }

  stepPuff(dt) {
    this.puffTimer -= dt;
    if (this.puffTimer <= 0 && this.puffTarget === 0) {
      this.puffTarget = 1;
      setTimeout(() => { this.puffTarget = 0; }, 1400 + this.rand() * 800);
      this.puffTimer = 60 + this.rand() * 120;
      this.isIdle = true;
      this.idleDuration = 1.8;
    }
    const speed = this.puffTarget > this.puffLevel ? 3.5 : 1.4;
    this.puffLevel += (this.puffTarget - this.puffLevel) * Math.min(1, speed * dt);
  }

  applyCursorRepulsion(dt) {
    if (!cursor.active) return;
    const cx = this.x + this.size * 0.6;
    const cy = this.y + this.size * 0.5;
    const dx = cx - cursor.x;
    const dy = cy - cursor.y;
    const dist = Math.hypot(dx, dy);
    const RADIUS = 160;
    if (dist < 1 || dist > RADIUS) return;
    const falloff = 1 - dist / RADIUS;
    const strength = 600 * falloff * falloff;
    this.vx += (dx / dist) * strength * dt;
    this.vy += (dy / dist) * strength * dt;
    // Fish scatter breaks any idle pause.
    this.isIdle = false;
    this.idleDuration = 0;
  }

  applyFlocking(dt, schoolFish, leaderBySpecies) {
    // Solitary / sedentary animals don't school.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler'
        || this.locomotion === 'walker' || this.locomotion === 'clinger'
        || this.locomotion === 'jetter') return;
    // Territorial fish keep to their own patch — skip flocking and leader pull.
    if (this.home) return;
    const ageSchool = this.layer?.progress || 0;
    // Species-weighted boids + extra same-species cohesion pass, so fish of
    // the same kind group into tight shoals while different species stay
    // loosely aware of each other.
    const NEIGHBOR = 170 + ageSchool * 70;
    const SAME_NEIGHBOR = 240 + ageSchool * 110;   // wider reach for same-species schooling
    const SEP = 55 - ageSchool * 8;
    let ax = 0, ay = 0;  // weighted alignment sum
    let cx = 0, cy = 0;  // weighted cohesion sum
    let sx = 0, sy = 0;  // separation (unweighted — personal space is universal)
    let wAlign = 0;
    let nSep = 0;
    // Same-species separate pass — extra alignment + cohesion pull.
    let sameVx = 0, sameVy = 0, sameCx = 0, sameCy = 0;
    let sameN = 0;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    for (const other of schoolFish) {
      if (other === this) continue;
      const ox = other.x + other.size * 0.5;
      const oy = other.y + other.size * 0.5;
      const dx = ox - myCx;
      const dy = oy - myCy;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) continue;
      const sameSpecies = this.species && this.species === other.species;
      if (d <= NEIGHBOR) {
        const w = sameSpecies ? (1.0 + ageSchool * 0.35) : (0.15 + ageSchool * 0.18);
        ax += other.vx * w; ay += other.vy * w;
        cx += ox * w; cy += oy * w;
        wAlign += w;
        if (d < SEP) {
          const push = (SEP - d) / SEP;
          sx -= (dx / d) * push;
          sy -= (dy / d) * push;
          nSep++;
        }
      }
      if (sameSpecies && d <= SAME_NEIGHBOR) {
        sameVx += other.vx;
        sameVy += other.vy;
        sameCx += ox;
        sameCy += oy;
        sameN++;
      }
    }
    const cohesionMul = this.personality.cohesionK;
    if (wAlign > 0) {
      ax /= wAlign; ay /= wAlign;
      const alignK = 0.55 + ageSchool * 0.14;
      const cohesionK = (0.24 + ageSchool * 0.18) * cohesionMul;
      this.vx += (ax - this.vx) * alignK * dt;
      this.vy += (ay - this.vy) * alignK * dt;
      cx = cx / wAlign - myCx;
      cy = cy / wAlign - myCy;
      this.vx += cx * cohesionK * dt;
      this.vy += cy * cohesionK * dt;
    }
    // Extra same-species pass: pulls the fish toward the school center and
    // aligns it more strongly with same-kind neighbors.
    if (sameN > 0) {
      sameVx /= sameN; sameVy /= sameN;
      sameCx = sameCx / sameN - myCx;
      sameCy = sameCy / sameN - myCy;
      this.vx += (sameVx - this.vx) * (0.35 + ageSchool * 0.2) * dt;
      this.vy += (sameVy - this.vy) * (0.35 + ageSchool * 0.2) * dt;
      this.vx += sameCx * (0.30 + ageSchool * 0.24) * cohesionMul * dt;
      this.vy += sameCy * (0.30 + ageSchool * 0.24) * cohesionMul * dt;
    }
    if (nSep > 0) {
      this.vx += sx * (90 - ageSchool * 14) * dt;
      this.vy += sy * (90 - ageSchool * 14) * dt;
    }
    // Group hierarchy: followers of a same-species leader align to the
    // leader's velocity harder than to the generic average, producing
    // visible lead-and-follow formations. The leader itself (and solitary
    // locomotions) get no pull.
    if (leaderBySpecies && this.species) {
      const leader = leaderBySpecies.get(this.species);
      if (leader && leader !== this) {
        const LEADER_NEIGHBOR = 360 + ageSchool * 140;
        const lx = leader.x + leader.size * 0.5;
        const ly = leader.y + leader.size * 0.5;
        const ldx = lx - myCx;
        const ldy = ly - myCy;
        const ld = Math.hypot(ldx, ldy);
        if (ld < LEADER_NEIGHBOR) {
          // Stronger alignment (1.5x the same-species pass) plus a soft
          // cohesion pull toward a trailing slot behind the leader, so
          // followers don't climb into its head.
          const align = (0.52 + ageSchool * 0.30) * cohesionMul;
          this.vx += (leader.vx - this.vx) * align * dt;
          this.vy += (leader.vy - this.vy) * align * dt;
          const lvMag = Math.hypot(leader.vx, leader.vy) || 1;
          const offset = 90 + this.depthJitter * 40;
          const slotX = lx - (leader.vx / lvMag) * offset;
          const slotY = ly - (leader.vy / lvMag) * offset;
          const coh = (0.22 + ageSchool * 0.18) * cohesionMul;
          this.vx += (slotX - myCx) * coh * dt;
          this.vy += (slotY - myCy) * coh * dt;
        }
      }
    }
    // Clamp speed so boids don't blow up. Chase/flee raises the ceiling so
    // fish can actually commit to a pursuit.
    const burst = (this.encounterState === 'chase' || this.encounterState === 'fleeing') ? 3.8 : 2.8;
    const speed = Math.hypot(this.vx, this.vy);
    const maxSpeed = this.baseSpeed * burst;
    if (speed > maxSpeed) {
      this.vx *= maxSpeed / speed;
      this.vy *= maxSpeed / speed;
    }
  }

  // ---------- Encounter system ----------
  // Fish occasionally notice each other and enter a brief interaction:
  // chase, orbit, or curious approach. Each type has its own steering force.
  stepEncounter(dt, schoolFish) {
    // Predators and bottom-dwellers don't play the social-encounter game.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler'
        || this.locomotion === 'walker' || this.locomotion === 'clinger') return;
    if (this.encounterState) {
      this.encounterTTL -= dt;
      const t = this.encounterTarget;
      // End if TTL expired or target vanished / left the school.
      if (!t || t.mode !== 'school' || !fishById.has(t.id) || this.encounterTTL <= 0) {
        this.endEncounter();
      }
      return;
    }
    this.encounterCooldown -= dt;
    if (this.encounterCooldown > 0) return;
    this.encounterCooldown = (8 + this.rand() * 18) / this.personality.encounterK;
    this.tryInitiateEncounter(schoolFish);
  }

  tryInitiateEncounter(schoolFish) {
    const MAX_DIST = 380;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    const candidates = [];
    for (const other of schoolFish) {
      if (other === this) continue;
      if (other.encounterState) continue;
      // Skip sharks (intimidating) and sea slugs (oblivious) as encounter partners.
      if (other.locomotion === 'predator' || other.locomotion === 'crawler'
          || other.locomotion === 'walker' || other.locomotion === 'clinger') continue;
      const ox = other.x + other.size * 0.5;
      const oy = other.y + other.size * 0.5;
      const d = Math.hypot(ox - myCx, oy - myCy);
      if (d > MAX_DIST) continue;
      candidates.push(other);
    }
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(this.rand() * candidates.length)];

    // Same species → friendly (orbit / curious). Different species → chase is on the table.
    const sameSpecies = this.species && this.species === target.species;
    const r = this.rand();
    let type, dur;
    if (sameSpecies) {
      if (r < 0.55) { type = 'orbit';   dur = 2.5 + this.rand() * 2.5; }
      else          { type = 'curious'; dur = 1.5 + this.rand() * 2.0; }
    } else {
      if      (r < 0.45) { type = 'chase';   dur = 2.0 + this.rand() * 2.5; }
      else if (r < 0.75) { type = 'curious'; dur = 1.8 + this.rand() * 2.0; }
      else               { type = 'orbit';   dur = 2.5 + this.rand() * 2.0; }
    }

    this.startEncounter(type, target, dur);
    if (type === 'chase') target.startEncounter('fleeing', this, dur);
    else if (type === 'orbit') target.startEncounter('orbit', this, dur);
    // 'curious' is one-sided — target is unaware.
  }

  startEncounter(type, target, dur) {
    this.encounterState = type;
    this.encounterTarget = target;
    this.encounterTTL = dur;
  }

  endEncounter() {
    this.encounterState = null;
    this.encounterTarget = null;
    this.encounterTTL = 0;
    // Stagger so interacting pairs don't immediately re-engage.
    this.encounterCooldown = (12 + this.rand() * 20) / this.personality.encounterK;
  }

  applyEncounterForce(dt) {
    if (!this.encounterState || !this.encounterTarget) return;
    const t = this.encounterTarget;
    const tCx = t.x + t.size * 0.5;
    const tCy = t.y + t.size * 0.5;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    const dx = tCx - myCx, dy = tCy - myCy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const sp = this.baseSpeed;
    switch (this.encounterState) {
      case 'chase': {
        const vxT = ux * sp * 2.0, vyT = uy * sp * 2.0;
        this.vx += (vxT - this.vx) * 2.6 * dt;
        this.vy += (vyT - this.vy) * 2.6 * dt;
        break;
      }
      case 'fleeing': {
        const vxT = -ux * sp * 2.3, vyT = -uy * sp * 2.3;
        this.vx += (vxT - this.vx) * 3.0 * dt;
        this.vy += (vyT - this.vy) * 3.0 * dt;
        break;
      }
      case 'orbit': {
        // Tangential velocity + soft radial spring so both partners circle
        // each other at a relatively stable distance.
        const desired = 90;
        const tangX = -uy, tangY = ux;
        const radErr = (d - desired);
        const vxT = tangX * sp * 0.9 + ux * radErr * 1.2;
        const vyT = tangY * sp * 0.9 + uy * radErr * 1.2;
        this.vx += (vxT - this.vx) * 1.8 * dt;
        this.vy += (vyT - this.vy) * 1.8 * dt;
        break;
      }
      case 'curious': {
        // Glide toward target, slow as we close, then drift gently past.
        const desired = 55;
        const approach = (d - desired) / Math.max(desired, 1);
        const clamped = Math.max(-0.8, Math.min(1.0, approach));
        const vxT = ux * sp * 0.9 * clamped;
        const vyT = uy * sp * 0.9 * clamped;
        this.vx += (vxT - this.vx) * 1.2 * dt;
        this.vy += (vyT - this.vy) * 1.2 * dt;
        break;
      }
    }
  }

  // ---------- Predator ecosystem ----------
  // Prey fish check for nearby sharks; on contact inside the shark's
  // intimidate radius they bolt directly away for 1.5–2.5s. Puffers inflate.
  applyPredatorScare(predators) {
    if (this.scareTTL > 0) return;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    for (const other of predators) {
      const r = other.traits.intimidateRadius || 220;
      const dx = (other.x + other.size * 0.5) - myCx;
      const dy = (other.y + other.size * 0.5) - myCy;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 0.001) continue;
      this.scareTTL = (1.5 + this.rand() * 1.0) * this.personality.scareMul;
      this.scareDir = { x: -dx / d, y: -dy / d };
      // Puffer defense: inflate when the shark gets close.
      if (this.isPuffer && this.puffTarget === 0) {
        this.puffTarget = 1;
        setTimeout(() => { this.puffTarget = 0; }, 1400 + this.rand() * 800);
        this.puffTimer = 60 + this.rand() * 120;
      }
      return;
    }
  }

  // ---------- Locomotion helpers ----------
  stepCrawler(dt) {
    // Sea slug: continuous slow glide punctuated by long pauses. Velocity
    // eases toward a target instead of snapping, so no jerky nudges.
    if (this._crawlState === undefined) {
      this._crawlState = 'walk';
      this._crawlStateTTL = 6 + this.rand() * 8;
      this._crawlDir = this.rand() < 0.5 ? -1 : 1;
    }
    this._crawlStateTTL -= dt;
    if (this._crawlStateTTL <= 0) {
      if (this._crawlState === 'walk') {
        // Coming off a walk: half the time pause, otherwise reverse and keep going.
        if (this.rand() < 0.55) {
          this._crawlState = 'pause';
          this._crawlStateTTL = 4 + this.rand() * 6;
        } else {
          this._crawlDir = -this._crawlDir;
          this._crawlStateTTL = 8 + this.rand() * 10;
        }
      } else {
        this._crawlState = 'walk';
        this._crawlStateTTL = 9 + this.rand() * 10;
        // Sometimes resume the other way after resting.
        if (this.rand() < 0.35) this._crawlDir = -this._crawlDir;
      }
    }

    // Target horizontal speed: slow but constant during walk, zero when paused.
    const walkSpeed = Math.max(10, this.baseSpeed * 1.3);
    const targetVx = this._crawlState === 'walk' ? this._crawlDir * walkSpeed : 0;
    // Tiny seabed hover using the shared wiggle phase so the slug's body ripple
    // and its vertical float stay in sync (reads as one breathing motion).
    const targetVy = Math.sin(this.wigglePhase) * 1.5;

    // Gentle lerp toward the target — no sudden velocity jumps.
    this.vx += (targetVx - this.vx) * 1.1 * dt;
    this.vy += (targetVy - this.vy) * 0.9 * dt;
  }

  stepWalker(dt) {
    // Shrimp: scuttles along the bottom. Short walking stretches, occasional
    // pauses, rare direction flips. Legs-in-motion hop is added by the
    // renderer from wigglePhase (traits.legs).
    if (this._walkState === undefined) {
      this._walkState = 'walk';
      this._walkStateTTL = 3 + this.rand() * 4;
      this._walkDir = this.rand() < 0.5 ? -1 : 1;
    }
    this._walkStateTTL -= dt;
    if (this._walkStateTTL <= 0) {
      if (this._walkState === 'walk') {
        if (this.rand() < 0.35) {
          this._walkState = 'pause';
          this._walkStateTTL = 1.5 + this.rand() * 2.5;
        } else {
          if (this.rand() < 0.4) this._walkDir = -this._walkDir;
          this._walkStateTTL = 4 + this.rand() * 5;
        }
      } else {
        this._walkState = 'walk';
        this._walkStateTTL = 3 + this.rand() * 4;
      }
    }
    const walkSpeed = Math.max(18, this.baseSpeed * 1.5);
    const targetVx = this._walkState === 'walk' ? this._walkDir * walkSpeed : 0;
    // Tiny vertical bob so the shrimp visibly "steps" while moving.
    const stepping = this._walkState === 'walk' ? 1 : 0.2;
    const targetVy = Math.sin(this.wigglePhase * 2) * 2.5 * stepping;
    this.vx += (targetVx - this.vx) * 1.4 * dt;
    this.vy += (targetVy - this.vy) * 1.0 * dt;
  }

  stepClinger(dt) {
    // Sea star: clings to the floor, mostly motionless. Rare slow slides
    // between long pauses. No vertical drift — stays pinned to the seabed.
    if (this._clingTTL === undefined) {
      this._clingTTL = 15 + this.rand() * 25;
      this._clingMoving = false;
      this._clingDir = this.rand() < 0.5 ? -1 : 1;
    }
    this._clingTTL -= dt;
    if (this._clingTTL <= 0) {
      if (this._clingMoving) {
        this._clingMoving = false;
        this._clingTTL = 18 + this.rand() * 30;
      } else {
        this._clingMoving = true;
        this._clingTTL = 5 + this.rand() * 8;
        if (this.rand() < 0.5) this._clingDir = -this._clingDir;
      }
    }
    const crawl = Math.max(3, this.baseSpeed * 0.25);
    const targetVx = this._clingMoving ? this._clingDir * crawl : 0;
    this.vx += (targetVx - this.vx) * 0.5 * dt;
    this.vy += (0 - this.vy) * 1.4 * dt;
  }

  stepJetter(dt, W, H) {
    // Octopus & squid: jet propulsion — calm drifting glide punctuated by
    // tentacle-pulse bursts. Squids (traits.burst) pulse harder and more
    // frequently than octopuses. The tentacle ripple itself is rendered
    // from wigglePhase (traits.jetPulse).
    const burst = !!this.traits.burst;
    if (this._jetPhase === undefined) {
      this._jetPhase = 'glide';
      this._jetTTL = 2 + this.rand() * 3;
      this._jetHeading = this.rand() * Math.PI * 2;
    }
    this._jetTTL -= dt;
    if (this._jetTTL <= 0) {
      if (this._jetPhase === 'glide') {
        this._jetPhase = 'pulse';
        this._jetTTL = burst ? 0.35 + this.rand() * 0.3 : 0.6 + this.rand() * 0.4;
        // Pick a new jet direction, biased horizontally so movement reads
        // as swimming rather than random drift.
        const horiz = (this.rand() < 0.5 ? -1 : 1);
        const drift = (this.rand() - 0.5) * 0.8;
        this._jetHeading = Math.atan2(drift, horiz);
      } else {
        this._jetPhase = 'glide';
        this._jetTTL = burst ? 1.6 + this.rand() * 2.0 : 2.8 + this.rand() * 3.0;
      }
    }
    const sp = this.baseSpeed;
    if (this._jetPhase === 'pulse') {
      const boost = burst ? 3.2 : 2.0;
      const vxT = Math.cos(this._jetHeading) * sp * boost;
      const vyT = Math.sin(this._jetHeading) * sp * boost * 0.6;
      this.vx += (vxT - this.vx) * 4.0 * dt;
      this.vy += (vyT - this.vy) * 4.0 * dt;
    } else {
      // Drift: bleed off the pulse speed but keep gentle tentacle-driven bob.
      this.vx *= Math.pow(0.5, dt);
      this.vy *= Math.pow(0.5, dt);
      this.vy += Math.sin(this.wigglePhase) * 4 * dt;
    }
  }

  stepPredator(dt) {
    // Shark: slow relentless cruise, occasional long turns.
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = 7 + this.rand() * 6;
      const keep = this.rand() < 0.8;
      const dir = keep ? Math.sign(this.vx || 1) : -Math.sign(this.vx || 1);
      this.vx = dir * this.baseSpeed * (0.9 + this.rand() * 0.3);
      this.vy = (this.rand() - 0.5) * 18;
    }
    this.wavePhase += dt * 0.9;
    this.vy += Math.sin(this.wavePhase) * 5 * dt;
  }

  stepFloater(dt) {
    // Seahorse: hovers with a gentle vertical bob, minor horizontal drift.
    this.wavePhase += dt * 1.4;
    this.vy += Math.sin(this.wavePhase) * 7 * dt;
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = 4 + this.rand() * 8;
      this.vx = (this.rand() - 0.5) * this.baseSpeed * 1.6;
    }
    this.vx *= Math.pow(0.7, dt);
  }

  stepSlitherer(dt, W, H) {
    // Eel: hugs the bottom, continuous horizontal motion with a slow
    // large-amplitude vertical wave along its body (body wiggle already
    // amplified via traits.ampMul). Reverses direction rarely.
    this.wavePhase += dt * 1.2;
    this.vy += Math.sin(this.wavePhase) * 10 * dt;
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = 6 + this.rand() * 8;
      if (this.rand() < 0.2) this.vx = -this.vx;
      else this.vx = Math.sign(this.vx || 1) * this.baseSpeed * (0.85 + this.rand() * 0.3);
    }
  }

  stepGlider(dt) {
    // Sting ray: smooth slow glide. Very gentle heading wander.
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = 5 + this.rand() * 6;
      const heading = Math.atan2(this.vy, this.vx || (this.rand() < 0.5 ? -1 : 1));
      const delta = (this.rand() - 0.5) * 0.5;
      const nh = heading + delta;
      this.vx = Math.cos(nh) * this.baseSpeed * (0.85 + this.rand() * 0.3);
      this.vy = Math.sin(nh) * this.baseSpeed * 0.4;
    }
    this.wavePhase += dt * 0.8;
    this.vy += Math.sin(this.wavePhase) * 3 * dt;
  }

  stepIdle(dt, tMs) {
    // Locomotions that already have their own pacing skip random idle pauses.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler'
        || this.locomotion === 'floater' || this.locomotion === 'glider'
        || this.locomotion === 'walker' || this.locomotion === 'clinger'
        || this.locomotion === 'jetter') return;
    if (this.isIdle) {
      this.idleDuration -= dt;
      if (this.idleDuration <= 0) {
        this.isIdle = false;
        this.idleTimer = 5 + this.rand() * 10;
      } else {
        // During idle: sharply damp velocity so fish nearly stops with gentle bob.
        this.vx *= Math.pow(0.08, dt);
        this.vy *= Math.pow(0.08, dt);
        this.vy += Math.sin(tMs / 500 + this.wigglePhase) * 3 * dt;
      }
      return;
    }
    this.idleTimer -= dt;
    if (this.idleTimer <= 0 && this.dartPhase !== 'dart') {
      // ~35% chance of an idle pause (higher for lazy personalities),
      // otherwise just a tail-flick micro-burst.
      const idleChance = 0.35 * this.personality.idleBoost;
      if (this.rand() < idleChance) {
        this.isIdle = true;
        this.idleDuration = (1.2 + this.rand() * 1.8) * this.personality.idleBoost;
      } else {
        const dir = Math.sign(this.vx || 1);
        this.vx = dir * this.baseSpeed * (1.8 + this.rand() * 0.6);
        this.vy += (this.rand() - 0.5) * 20;
      }
      this.idleTimer = (5 + this.rand() * 10) / this.personality.idleBoost;
    }
  }

  emitBubble(w, h) {
    // Emit from the "head" side (left of the sprite in image-space; flip if moving right).
    const headOffsetX = this.vx > 0 ? w * 0.85 : w * 0.15;
    const bx = this.x + headOffsetX;
    const by = this.y + h * 0.35;
    const b = document.createElement('div');
    b.className = 'bubble-pop';
    const size = 6 + this.rand() * 6;
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    aq.appendChild(b);

    const start = performance.now();
    const dur = 900 + this.rand() * 500;
    const driftX = (this.rand() - 0.5) * 30;
    const riseY = 70 + this.rand() * 50;
    const step = (now) => {
      const u = Math.min(1, (now - start) / dur);
      const x = bx + driftX * u;
      const y = by - riseY * u;
      const alpha = u < 0.15 ? u / 0.15 : (1 - (u - 0.15) / 0.85);
      b.style.transform = `translate(${x}px, ${y}px) scale(${0.8 + u * 0.4})`;
      b.style.opacity = Math.max(0, alpha);
      if (u < 1) requestAnimationFrame(step);
      else b.remove();
    };
    requestAnimationFrame(step);
  }

  updateFeatured(tMs, W, H, aspect) {
    // Parked in the cinematic queue behind another arrival — stay hidden.
    if (this.cinematicPending) {
      this.el.style.width = '10px';
      this.el.style.height = '10px';
      this.el.style.transform = 'translate(-9999px, -9999px)';
      return;
    }
    const rawT = tMs - this.phaseStart;

    // Phase 0: cinematic intro — keep fish off-screen while dim+banner+camera ramp up.
    if (rawT < CINEMATIC_INTRO_MS) {
      this.el.style.width = '10px';
      this.el.style.height = '10px';
      this.el.style.transform = 'translate(-9999px, -9999px)';
      return;
    }

    const t = rawT - CINEMATIC_INTRO_MS;
    const arrival = this.arrivalProfile;
    const scaleMul = arrival.scaleMul || 1;

    if (t < SPLASH_FALL_MS) {
      const u = t / SPLASH_FALL_MS;
      const bigH = Math.min(H * 0.48, 460) * scaleMul;
      const h = bigH;
      const w = h * aspect;
      const sx = -w - 80;
      const sy = -h - 40;
      const ex = this.splashX - w / 2;
      const ey = this.splashY - h / 2;
      const x = sx + (ex - sx) * easeOutQuad(u);
      const y = sy + (ey - sy) * (u * u);
      const vx = (ex - sx) * (1 - u) * 2;
      const vy = (ey - sy) * 2 * u;
      this.renderSprite(x, y, w, h, vx || 1, vy || 1);
      this.renderBadge(x + w / 2, y);
      this.x = x; this.y = y; this.vx = vx; this.vy = vy;
      this.size = h;
      return;
    }

    if (t < SPLASH_FALL_MS + SPLASH_BURST_MS) {
      if (!this.arrivalMomentPlayed) {
        this.arrivalMomentPlayed = true;
        this.spawnArrivalMoment();
      }
      this.ensureSplash();
      const u = (t - SPLASH_FALL_MS) / SPLASH_BURST_MS;
      const bigH = Math.min(H * 0.48, 460) * scaleMul;
      const h = bigH;
      const w = h * aspect;
      const x = this.splashX - w / 2;
      const y = this.splashY - h / 2 + Math.sin(u * Math.PI) * 6;
      if (this.splash) {
        const s = this.splash.querySelectorAll('span');
        s.forEach((el, i) => {
          const delay = i * 0.18;
          const local = Math.max(0, u - delay);
          const scale = 0.2 + local * 2.4;
          const alpha = Math.max(0, 1 - local * 1.2);
          el.style.transform = `translate(-50%, -50%) scale(${scale})`;
          el.style.opacity = alpha;
        });
      }
      this.renderSprite(x, y, w, h, 1, 0.1);
      this.renderBadge(x + w / 2, y);
      this.x = x; this.y = y; this.size = h;
      return;
    }

    if (this.splash) { this.splash.remove(); this.splash = null; }

    const elapsed = t - SPLASH_FALL_MS - SPLASH_BURST_MS;
    if (elapsed >= FEATURE_SWIM_MS) {
      this.startAsSchool();
      return;
    }
    const u = elapsed / FEATURE_SWIM_MS;
    const bigH = Math.min(H * 0.42, 400) * scaleMul * (1 - 0.12 * u);
    const h = bigH;
    const w = h * aspect;
    const startX = this.splashX - w / 2;
    const startY = this.splashY - h / 2;
    const endX = W * 0.5 - w / 2;
    const endY = H * (arrival.endYF || DEFAULT_ARRIVAL.endYF) - h / 2;
    const baseX = startX + (endX - startX) * easeInOut(u);
    const baseY = startY + (endY - startY) * easeInOut(u);

    let dx = 0, dy = 0;
    const tt = elapsed / 1000;
    const sway = arrival.sway || DEFAULT_ARRIVAL.sway;
    switch (arrival.path) {
      case 'graceful':
        dx = Math.cos(tt * 0.85 + this.wavePhase) * this.waveAmp * 0.45 * sway;
        dy = Math.sin(tt * 1.1 + this.wavePhase) * this.waveAmp * 0.7 * sway;
        break;
      case 'floaty':
        dx = Math.cos(tt * 0.65 + this.wavePhase) * this.waveAmp * 0.18 * sway;
        dy = Math.sin(tt * 1.7 + this.wavePhase) * this.waveAmp * 0.9 * sway;
        break;
      case 'slink':
        dx = Math.cos(tt * 1.45 + this.wavePhase) * this.waveAmp * 0.34 * sway;
        dy = Math.sin(tt * 2.2 + this.wavePhase) * this.waveAmp * 0.44 * sway;
        break;
      case 'glide':
        dx = Math.cos(tt * 0.55 + this.wavePhase) * this.waveAmp * 0.25 * sway;
        dy = Math.sin(tt * 0.95 + this.wavePhase) * this.waveAmp * 0.36 * sway;
        break;
      case 'heavy':
        dx = Math.cos(tt * 0.45 + this.wavePhase) * this.waveAmp * 0.14 * sway;
        dy = Math.sin(tt * 0.7 + this.wavePhase) * this.waveAmp * 0.22 * sway;
        break;
      case 'playful':
      default:
        dx = Math.cos(tt * 1.15 + this.wavePhase) * this.waveAmp * 0.52 * sway;
        dy = Math.sin(tt * 1.55 + this.wavePhase) * this.waveAmp * 0.68 * sway;
        break;
    }

    const x = baseX + dx;
    const y = baseY + dy;
    const vx = (endX - startX) / (FEATURE_SWIM_MS / 1000) + (dx - (this._prevDx || 0)) * 20;
    const vy = (endY - startY) / (FEATURE_SWIM_MS / 1000) + (dy - (this._prevDy || 0)) * 20;
    this._prevDx = dx; this._prevDy = dy;

    this.renderSprite(x, y, w, h, vx, vy);
    this.renderBadge(x + w / 2, y);
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.size = h;
  }

  stepPersonality(dt, W, H) {
    switch (this.pattern) {
      case 'wavy': {
        this.wavePhase += dt * (2 * Math.PI / this.wavePeriod);
        this.vy += (Math.cos(this.wavePhase) * this.waveAmp * 0.6 - this.vy) * 0.25;
        this.turnTimer -= dt;
        if (this.turnTimer <= 0) {
          this.turnTimer = 4 + this.rand() * 4;
          this.vx = Math.sign(this.vx || 1) * this.baseSpeed * (0.8 + this.rand() * 0.5);
          if (this.rand() < 0.25) this.vx = -this.vx;
        }
        break;
      }
      case 'zigzag': {
        this.wavePhase += dt * (2 * Math.PI / (this.wavePeriod * 0.7));
        const target = (triangleWave(this.wavePhase / (Math.PI * 2)) * 2 - 1) * this.waveAmp * 1.2;
        this.vy += (target - this.vy) * 0.25;
        this.turnTimer -= dt;
        if (this.turnTimer <= 0) {
          this.turnTimer = 3 + this.rand() * 3;
          if (this.rand() < 0.4) this.vx = -this.vx;
        }
        break;
      }
      case 'darter': {
        this.dartCooldown -= dt;
        if (this.dartCooldown <= 0) {
          if (this.dartPhase === 'cruise') {
            this.dartPhase = 'dart';
            this.dartCooldown = 0.35 + this.rand() * 0.25;
            const dir = Math.sign(this.vx || (this.rand() < 0.5 ? -1 : 1));
            this.vx = dir * this.baseSpeed * (2.8 + this.rand() * 0.8);
            this.vy = (this.rand() - 0.5) * this.baseSpeed * 1.5;
          } else {
            this.dartPhase = 'cruise';
            this.dartCooldown = 1.4 + this.rand() * 1.8;
            this.vx = Math.sign(this.vx) * this.baseSpeed * 0.4;
            this.vy *= 0.2;
          }
        }
        if (this.dartPhase === 'cruise') {
          this.wavePhase += dt * 3;
          this.vy += Math.sin(this.wavePhase) * 4 * dt;
        }
        break;
      }
      case 'circler': {
        this.circleTheta += this.circleOmega * dt;
        this.circleCenterX += Math.sign(this.vx || 1) * this.baseSpeed * 0.45 * dt;
        this.circleCenterY += Math.sin(this.circleTheta * 0.3) * 6 * dt;
        const targetX = this.circleCenterX + Math.cos(this.circleTheta) * this.circleR;
        const targetY = this.circleCenterY + Math.sin(this.circleTheta) * this.circleR * 0.6;
        const k = 2.2;
        this.vx += ((targetX - this.x) * k - this.vx) * 0.3;
        this.vy += ((targetY - this.y) * k - this.vy) * 0.3;
        if (this.circleCenterX < 60 || this.circleCenterX > W - 60) {
          this.vx = -this.vx;
        }
        break;
      }
      case 'glider':
      default: {
        this.turnTimer -= dt;
        if (this.turnTimer <= 0) {
          this.turnTimer = 2.5 + this.rand() * 3;
          const heading = Math.atan2(this.vy, this.vx || (this.rand() < 0.5 ? -1 : 1));
          const delta = (this.rand() - 0.5) * 0.8;
          const speed = this.baseSpeed * (0.85 + this.rand() * 0.35);
          const nh = heading + delta;
          this.vx = Math.cos(nh) * speed;
          this.vy = Math.sin(nh) * speed;
        }
        this.wavePhase += dt * 1.8;
        this.vy += Math.sin(this.wavePhase) * 6 * dt;
        break;
      }
    }
  }

  stepWigglePhase(dt) {
    // Tail-beat frequency: tiny lift from speed, tightly bounded so even
    // darting fish stay visibly calm.
    const speed = Math.hypot(this.vx, this.vy);
    const speedK = 1.0 + 0.35 * Math.tanh(speed / 140);
    const dartBoost = this.dartPhase === 'dart' ? 1.1 : 1;
    this._wiggleFreq = this.wiggleBase * speedK * dartBoost;
    this.wigglePhase += dt * this._wiggleFreq * Math.PI * 2;
  }

  renderSprite(x, y, w, h, vx, vy) {
    if (this.layer) this.applyDepthVisuals(this.layer);
    const speed = Math.hypot(vx, vy);
    // Very minimal amplitude variation with speed — we want the wiggle to
    // stay subtle regardless of how fast the animal is moving.
    const speedAmp = 0.9 + 0.2 * Math.tanh(speed / 140);
    const dartBoost = this.dartPhase === 'dart' ? 1.12 : 1;
    const shapeScale = this.isSeahorse ? 0.55 : 1;
    const ampRad = this.wiggleAmpBase * speedAmp * dartBoost * shapeScale;
    // Single sinusoid = clean sweep of the tail.
    const skewY = Math.sin(this.wigglePhase) * ampRad;

    // Flip hysteresis: only update facing when velocity is large enough to
    // commit to a direction. Prevents slow-moving animals (sea slug, seahorse)
    // from visually flickering when vx crosses zero near a stop.
    if (Math.abs(vx) > 8) {
      this._lastFlip = vx > 0 ? -1 : 1;
    } else if (this._lastFlip === undefined) {
      this._lastFlip = 1;
    }
    const flip = this._lastFlip;

    const mag = Math.hypot(vx, vy) || 1;
    const nx = vx / mag, ny = vy / mag;
    const cosA = -nx / flip;
    const sinA = -ny;
    const angle = Math.atan2(sinA, cosA);
    const MAX_PITCH = 0.5;
    const clamped = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, angle));

    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
    const puffScale = 1 + (this.puffLevel || 0) * 0.55;
    // Breathing: very slow ~0.5 Hz pulse, amplitude ~1.5%. Offset per fish
    // so the tank doesn't breathe in unison.
    const nowSec = performance.now() * 0.001;
    const breathe = 1 + Math.sin(nowSec * Math.PI + this.breatheOffset) * 0.015;
    const finalScale = puffScale * breathe;
    // Compensate translation so the fish puffs from its center, not top-left.
    const puffOffset = (finalScale - 1) * 0.5;
    let tx = x - w * puffOffset;
    let ty = y - h * puffOffset;
    // Depth parallax: when the cursor moves, settled (deeper) fish drift a
    // few pixels opposite the cursor so the tank gains volume. Fresh fish
    // in the foreground get almost none — they're "close to the glass."
    if (cursor.active && this.layer) {
      const cxScreen = window.innerWidth * 0.5;
      const cyScreen = window.innerHeight * 0.5;
      const nxc = (cursor.x - cxScreen) / Math.max(1, cxScreen);
      const nyc = (cursor.y - cyScreen) / Math.max(1, cyScreen);
      const amount = this.layer.progress * 4;
      tx += -nxc * amount;
      ty += -nyc * amount;
    }
    this.el.style.transform = `translate(${tx}px, ${ty}px) scale(${finalScale})`;
    // Banking: rotateY around the vertical axis during a turn.
    // Inline perspective() on the same transform avoids the ancestor
    // preserve-3d chain, which gets flattened by our drop-shadow filter.
    const bankNorm = this.bankTTL > 0 ? (this.bankTTL / this.bankDur) : 0;
    // Half-sine hump: 0→peak→0 across the bank life so the lean eases in
    // and recovers instead of snapping.
    const bankAmt = Math.sin(Math.PI * (1 - bankNorm)) * 14 * this.bankDir;
    const flipTransform = bankAmt !== 0
      ? `perspective(800px) scaleX(${flip}) rotateY(${bankAmt.toFixed(2)}deg)`
      : `scaleX(${flip})`;
    this.flipEl.style.transform = flipTransform;
    this.pitchEl.style.transform = `rotate(${clamped}rad)`;
    // Sting rays get a subtle vertical "wing flap" on top of the tail skew.
    // Sea slugs get an inchworm-style horizontal pulse (stretches while
    // moving forward, compresses during pauses) instead of a fish tail.
    const wiggleParts = [`skewY(${skewY}rad)`];
    if (this.traits && this.traits.flap) {
      const flap = 1 + Math.sin(this.wigglePhase * 0.6) * 0.07;
      wiggleParts.push(`scaleY(${flap})`);
    }
    if (this.traits && this.traits.glide) {
      // Stretch/compress along the body by ~5%, slower than wiggle, amplitude
      // scaled by how much the slug is currently moving.
      const moving = Math.min(1, Math.abs(vx) / 20);
      const glide = 1 + Math.sin(this.wigglePhase * 0.55) * 0.05 * (0.3 + 0.7 * moving);
      wiggleParts.push(`scaleX(${glide})`);
    }
    if (this.traits && this.traits.jetPulse) {
      // Octopus / squid tentacle pulse: body squeezes vertically while
      // tentacles billow out, then relaxes. Squids (burst) pulse harder.
      const burst = !!this.traits.burst;
      const pulseAmp = burst ? 0.14 : 0.09;
      const s = Math.sin(this.wigglePhase);
      const sy = 1 + s * pulseAmp;
      const sx = 1 - s * pulseAmp * 0.5;
      wiggleParts.push(`scaleY(${sy}) scaleX(${sx})`);
    }
    if (this.traits && this.traits.legs) {
      // Shrimp leg-step: small vertical hop driven by the fast wiggle phase,
      // damped while paused so stationary shrimp don't visibly bounce.
      const moving = Math.min(1, Math.abs(vx) / 14);
      const hop = -Math.abs(Math.sin(this.wigglePhase)) * 2.4 * (0.25 + 0.75 * moving);
      wiggleParts.push(`translateY(${hop.toFixed(2)}px)`);
    }
    // Refraction near the surface: fish in the top ~120 px of the tank look
    // like they're being viewed through moving water. A very small skewX
    // driven by the existing wiggle phase reads as rippled refraction.
    const REFRACTION_BAND = 120;
    if (y < REFRACTION_BAND) {
      const proximity = 1 - (y / REFRACTION_BAND);
      const skewX = Math.sin(this.wigglePhase * 1.1) * 0.055 * proximity;
      wiggleParts.push(`skewX(${skewX.toFixed(4)}rad)`);
    }
    // Idle pectoral-fin flutter: while paused, add a fast low-amplitude
    // body pulse. Real fish never stop moving — this sells the hover.
    // Driven off wall-clock time so it's frame-rate independent.
    if (this.isIdle) {
      const t = nowSec * 8 + this.hoverPhase;
      const flutterX = 1 + Math.sin(t) * 0.018;
      const flutterY = 1 + Math.cos(t * 1.3) * 0.012;
      wiggleParts.push(`scale(${flutterX.toFixed(4)}, ${flutterY.toFixed(4)})`);
    }
    this.wiggleEl.style.transform = wiggleParts.join(' ');
    this.renderShadow(x, y, w, h, vx);
  }

  renderShadow(x, y, w, h, vx) {
    const layer = this.layer || this.layerState(Date.now());
    const W = window.innerWidth;
    const H = window.innerHeight;
    const floorY = H - Math.max(62, Math.min(108, H * 0.12));
    const fishCx = x + w * 0.5;
    const fishCy = y + h * 0.55;
    const heightOffFloor = Math.max(0, floorY - fishCy);
    const lift = Math.min(1, heightOffFloor / Math.max(1, H * 0.6));
    const driftX = (W * 0.5 - fishCx) * 0.08;
    const stretchX = 0.92 + (1 - lift) * 0.14;
    const blur = 6 + lift * 12 + this.depthJitter * 1.6 + layer.shadowBlurAdd;
    const opacity = (0.1 + (1 - lift) * 0.09 + this.depthJitter * 0.02) * layer.shadowOpacityMul;
    const flip = vx > 0 ? -1 : 1;

    this.shadowEl.style.width = w + 'px';
    this.shadowEl.style.height = h + 'px';
    this.shadowEl.style.opacity = opacity.toFixed(3);
    this.shadowEl.style.filter = `brightness(0) saturate(0) blur(${blur.toFixed(1)}px)`;
    this.shadowEl.style.transform =
      `translate(${(x + driftX).toFixed(1)}px, ${(floorY - h).toFixed(1)}px) ` +
      `scaleX(${(flip * stretchX).toFixed(3)}) scaleY(0.25)`;
  }

  renderBadge(cx, topY) {
    this.badge.style.transform = `translate(${cx}px, ${topY}px)`;
  }

  updateNameTag(tMs) {
    if (!this.nameTag) return;
    const show = tMs < this.nameShowUntil;
    const cx = this.x + this.size * 0.5;
    const topY = this.y - 4;
    this.nameTag.style.transform = `translate(${cx}px, ${topY}px) translate(-50%, -100%)`;
    if (show && !this.nameTag.classList.contains('show')) this.nameTag.classList.add('show');
    else if (!show && this.nameTag.classList.contains('show')) this.nameTag.classList.remove('show');
  }

  // Graceful exit when the aquarium is reset: pick the nearest horizontal
  // edge and swim off-screen at boosted speed. Once out of view, the fish
  // tears itself down and drops from fishById.
  departToEdge({ cull = false } = {}) {
    if (this.departing) return;
    this.departing = true;
    this._cullOnDepart = cull;
    // Remove from the cinematic pipeline so queued fish don't block the exit.
    const qi = cinematicQueue.indexOf(this);
    if (qi >= 0) cinematicQueue.splice(qi, 1);
    this.cinematicPending = false;
    cinematicEnd(this);
    this.clearArrivalFx();
    if (this.splash) { this.splash.remove(); this.splash = null; }
    this.badge.remove();
    // Cancel every in-progress behavioral state.
    this.encounterState = null;
    this.encounterTarget = null;
    this.scareTTL = 0;
    this.isIdle = false;
    this.puffTarget = 0;
    this.bankTTL = 0;
    // Fade any active wake; the element is reaped in destroy().
    if (this.wakeEl) this.wakeEl.style.opacity = '0';
    // Choose exit side: whichever edge is closer.
    const W = window.innerWidth;
    const myCx = (this.x || 0) + (this.size || 100) * 0.5;
    this._departSign = myCx < W / 2 ? -1 : 1;
    this._departVy = (Math.random() - 0.5) * 40;
    // Featured-style highlight while departing looks nice; remove it so the
    // sprite rides its normal depth filter on the way out.
    this.el.classList.remove('featured-mode');
    this.el.classList.remove('school-settling');
    if (this.mode === 'featured') this.mode = 'school';
  }

  stepDeparting(dt, W, H, aspect) {
    // Aim for an exit speed that clears the viewport in ~2 seconds regardless
    // of screen size, so the reset is punchy but still visibly a swim-away.
    const exitSpeed = Math.max(400, W / 2.0);
    const targetVx = this._departSign * exitSpeed;
    this.vx += (targetVx - this.vx) * 2.8 * dt;
    this.vy += (this._departVy - this.vy) * 1.6 * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const h = this.size;
    const w = h * aspect;

    // Soft vertical wall so fish don't fly out the top/bottom while heading out.
    if (this.y < 20) { this.y = 20; this.vy = Math.abs(this.vy); }
    if (this.y > H - h - 10) { this.y = H - h - 10; this.vy = -Math.abs(this.vy); }

    this.renderSprite(this.x, this.y, w, h, this.vx, this.vy);
    this.updateNameTag(0);

    if (this.x < -w - 60 || this.x > W + 60) {
      if (this._cullOnDepart) culledIds.add(this.id);
      this.destroy();
      fishById.delete(this.id);
    }
  }

  destroy() {
    cinematicEnd(this);
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    this.clearArrivalFx();
    this.shadowEl.remove();
    this.el.remove();
    this.badge.remove();
    if (this.splash) this.splash.remove();
    if (this.nameTag) this.nameTag.remove();
    if (this.wakeEl) { this.wakeEl.remove(); this.wakeEl = null; }
  }
}

// ---------- math helpers ----------
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
function triangleWave(x) {
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}
function randBetween(min, max) {
  return min + Math.random() * (max - min);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const tankFxBackLayer = document.createElement('div');
tankFxBackLayer.className = 'tank-fx-layer tank-fx-back';
aq.appendChild(tankFxBackLayer);

const tankFxFrontLayer = document.createElement('div');
tankFxFrontLayer.className = 'tank-fx-layer tank-fx-front';
aq.appendChild(tankFxFrontLayer);

const lightBeamPulseEl = document.createElement('div');
lightBeamPulseEl.className = 'light-beam-pulse';
tankFxBackLayer.appendChild(lightBeamPulseEl);

// Water-surface ripple layer. The waterline sits 46px below the top of
// #aquarium — see .surface-waterline in style.css. Ripples spawn along it
// whenever a fish's top edge crosses within SURFACE_TRIGGER_PX of the
// waterline. Low-power devices skip ripples (DOM thrash).
const surfaceRipplesEl = document.getElementById('surfaceRipples');
const SURFACE_WATERLINE_PX = 46;
const SURFACE_TRIGGER_PX = 18;

function spawnSurfaceRipple(x) {
  if (!surfaceRipplesEl || REDUCE_MOTION || DEVICE.lowPower) return;
  const outer = document.createElement('div');
  outer.className = 'surface-ripple';
  outer.style.left = `${x}px`;
  const inner = document.createElement('div');
  inner.className = 'surface-ripple inner';
  inner.style.left = `${x}px`;
  surfaceRipplesEl.appendChild(outer);
  surfaceRipplesEl.appendChild(inner);
  // Ripple animation durations; inner ripple has a delay, so clean up after
  // the later of the two finishes. Match the CSS timings + a small buffer.
  setTimeout(() => { outer.remove(); }, 1500);
  setTimeout(() => { inner.remove(); }, 1500);
}

const tankEvents = {
  surge: null,
  feeding: null,
  lightUntil: 0,
  nextSurgeAt: performance.now() + randBetween(10000, 17000),
  nextFeedingAt: performance.now() + randBetween(14000, 22000),
  nextLightAt: performance.now() + randBetween(7000, 14000),
};

function triggerSchoolSurge(now, schoolFish) {
  if (schoolFish.length < SCHOOL_SURGE_MIN_FISH) {
    tankEvents.nextSurgeAt = now + randBetween(7000, 12000);
    return;
  }
  const angle = randBetween(-0.65, 0.65);
  tankEvents.surge = {
    startedAt: now,
    duration: 3800,
    until: now + 3800,
    dx: Math.cos(angle) * randBetween(95, 150),
    dy: Math.sin(angle) * randBetween(18, 45),
  };
  tankEvents.nextSurgeAt = now + randBetween(15000, 24000);
}

function triggerFeedingFrenzy(now, schoolFish) {
  if (schoolFish.length < FEEDING_FRENZY_MIN_FISH) {
    tankEvents.nextFeedingAt = now + randBetween(9000, 15000);
    return;
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  const el = document.createElement('div');
  el.className = 'feeding-fx';
  const particleCount = REDUCE_MOTION ? 6 : 12;
  for (let i = 0; i < particleCount; i++) {
    const span = document.createElement('span');
    span.style.setProperty('--dx', `${randBetween(-90, 90)}px`);
    span.style.setProperty('--drop', `${randBetween(-170, -70)}px`);
    span.style.setProperty('--delay', `${(i * 0.05).toFixed(2)}s`);
    span.style.setProperty('--dur', `${randBetween(1.0, 1.8).toFixed(2)}s`);
    el.appendChild(span);
  }
  const x = W * randBetween(0.26, 0.74);
  const y = H * randBetween(0.16, 0.32);
  el.style.transform = `translate(${x}px, ${y}px)`;
  tankFxFrontLayer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  tankEvents.feeding = {
    startedAt: now,
    duration: 5400,
    until: now + 5400,
    x,
    y,
    el,
  };
  tankEvents.nextFeedingAt = now + randBetween(18000, 26000);
}

function triggerLightBeamPulse(now, schoolFish) {
  if (schoolFish.length < LIGHT_PULSE_MIN_FISH) {
    tankEvents.nextLightAt = now + randBetween(6000, 11000);
    return;
  }
  lightBeamPulseEl.style.setProperty('--beam-x', `${randBetween(16, 82)}%`);
  lightBeamPulseEl.style.setProperty('--beam-tilt', `${randBetween(-8, 8).toFixed(1)}deg`);
  lightBeamPulseEl.classList.remove('show');
  void lightBeamPulseEl.offsetWidth;
  lightBeamPulseEl.classList.add('show');
  tankEvents.lightUntil = now + 5200;
  tankEvents.nextLightAt = now + randBetween(9000, 16000);
}

function advanceTankEvents(now, schoolFish) {
  if (tankEvents.surge && now >= tankEvents.surge.until) tankEvents.surge = null;
  if (tankEvents.feeding && now >= tankEvents.feeding.until) {
    tankEvents.feeding.el.remove();
    tankEvents.feeding = null;
  }
  if (tankEvents.lightUntil && now >= tankEvents.lightUntil) {
    tankEvents.lightUntil = 0;
    lightBeamPulseEl.classList.remove('show');
  }

  if (REDUCE_MOTION) return;
  if (!tankEvents.surge && now >= tankEvents.nextSurgeAt) triggerSchoolSurge(now, schoolFish);
  if (!tankEvents.feeding && now >= tankEvents.nextFeedingAt) triggerFeedingFrenzy(now, schoolFish);
  if (now >= tankEvents.nextLightAt) triggerLightBeamPulse(now, schoolFish);
}

// ---------- Cinematic spotlight controller ----------
// One shared dim overlay + banner. Any fish entering `featured` mode grabs the
// camera; when their splash phases end, the camera releases while the banner
// lingers until the fish merges into the school.
const cinematicDim = document.createElement('div');
cinematicDim.className = 'tv-dim';
document.body.appendChild(cinematicDim);

const cinematicBanner = document.createElement('div');
cinematicBanner.className = 'tv-banner';
const cinematicBannerTitle = document.createElement('div');
cinematicBannerTitle.className = 'tv-banner-title';
const cinematicBannerSub = document.createElement('div');
cinematicBannerSub.className = 'tv-banner-sub';
cinematicBanner.appendChild(cinematicBannerTitle);
cinematicBanner.appendChild(cinematicBannerSub);
document.body.appendChild(cinematicBanner);

const cinematicState = {
  bannerFish: null,
  zoomFish: null,
  zoomReleaseTimer: null,
};

function cinematicLabel(fish) {
  const name = (fish.name || '').trim();
  if (name) return `✨  ${name} has joined the tank!  ✨`;
  return `✨  A new fish has joined the tank!  ✨`;
}

function cinematicBannerData(fish) {
  const name = (fish.name || '').trim();
  return {
    title: name ? `${name} has joined the tank!` : 'A new fish has joined the tank!',
    subtitle: (fish.bio || '').trim(),
  };
}

function cinematicBegin(fish) {
  if (fish.cinematicActive) return;
  fish.cinematicActive = true;
  fish.el.classList.add('featured-mode');

  // Camera zoom + dim cut-out focused on splash point.
  cinematicState.zoomFish = fish;
  cinematicDim.style.setProperty('--dim-x', fish.splashX + 'px');
  cinematicDim.style.setProperty('--dim-y', fish.splashY + 'px');
  cinematicDim.classList.toggle('predator-arrival', fish.arrivalProfile.spotlight === 'predator');
  cinematicDim.classList.add('show');

  const W = window.innerWidth, H = window.innerHeight;
  // Transform origin must be in aquarium-local coords (= viewport, since #aquarium is fixed inset:0).
  aq.style.transformOrigin = `${fish.splashX}px ${fish.splashY}px`;
  aq.style.transform = 'scale(1.22)';

  // Banner belongs to the most recent fish.
  cinematicState.bannerFish = fish;
  const label = cinematicBannerData(fish);
  cinematicBannerTitle.textContent = `✨  ${label.title}  ✨`;
  cinematicBannerSub.textContent = label.subtitle;
  cinematicBannerSub.hidden = !label.subtitle;
  cinematicBanner.classList.toggle('has-subtitle', Boolean(label.subtitle));
  requestAnimationFrame(() => cinematicBanner.classList.add('show'));

  // Release camera + dim after the splash/hold window, independent of banner.
  if (cinematicState.zoomReleaseTimer) clearTimeout(cinematicState.zoomReleaseTimer);
  cinematicState.zoomReleaseTimer = setTimeout(() => {
    // Only release if this fish still owns the zoom (no newer fish took it).
    if (cinematicState.zoomFish === fish) {
      cinematicDim.classList.remove('show');
      cinematicDim.classList.remove('predator-arrival');
      aq.style.transform = '';
      cinematicState.zoomFish = null;
    }
    cinematicState.zoomReleaseTimer = null;
  }, CINEMATIC_HOLD_MS);
}

function cinematicEnd(fish) {
  if (!fish.cinematicActive) return;
  fish.cinematicActive = false;
  fish.el.classList.remove('featured-mode');

  // Banner follows the most recently announced fish; drop it only if this was it.
  if (cinematicState.bannerFish === fish) {
    cinematicState.bannerFish = null;
    cinematicBanner.classList.remove('show');
  }
  if (cinematicState.zoomFish === fish) {
    cinematicDim.classList.remove('show');
    cinematicDim.classList.remove('predator-arrival');
    aq.style.transform = '';
    cinematicState.zoomFish = null;
    if (cinematicState.zoomReleaseTimer) {
      clearTimeout(cinematicState.zoomReleaseTimer);
      cinematicState.zoomReleaseTimer = null;
    }
  }
}

// Multiple iPads can submit at once — stagger the arrivals so each gets its own
// on-screen moment instead of colliding in the spotlight. Fish are parked
// off-screen (cinematicPending=true) until their slot opens.
const cinematicQueue = [];
let cinematicQueueTimer = null;
let lastCinematicStartAt = -Infinity;
const MIN_CINEMATIC_GAP_MS = 2500;

function cinematicRequest(fish) {
  fish.cinematicPending = true;
  cinematicQueue.push(fish);
  scheduleCinematicAdvance();
}

function scheduleCinematicAdvance() {
  if (cinematicQueueTimer !== null) return;
  const now = performance.now();
  const wait = Math.max(0, MIN_CINEMATIC_GAP_MS - (now - lastCinematicStartAt));
  cinematicQueueTimer = setTimeout(() => {
    cinematicQueueTimer = null;
    cinematicAdvance();
  }, wait);
}

function cinematicAdvance() {
  while (cinematicQueue.length) {
    const fish = cinematicQueue.shift();
    // Drop fish that got removed (day reset, destroyed) before their turn.
    if (!fishById.has(fish.id)) continue;
    if (!fish.loaded) {
      // Not loaded yet — put it back and wait for load to retry.
      cinematicQueue.unshift(fish);
      fish.img.addEventListener('load', scheduleCinematicAdvance, { once: true });
      return;
    }
    fish.cinematicPending = false;
    fish.phaseStart = performance.now();
    lastCinematicStartAt = fish.phaseStart;
    cinematicBegin(fish);
    if (cinematicQueue.length) scheduleCinematicAdvance();
    return;
  }
}

// ---------- Ambient bubble stream ----------
function spawnBubble() {
  if (!bubblesLayer) return;
  const b = document.createElement('div');
  b.className = 'bubble';
  const size = 6 + Math.random() * 22;
  const dur = 8 + Math.random() * 10;
  const drift = (Math.random() - 0.5) * 120;
  b.style.width = size + 'px';
  b.style.height = size + 'px';
  b.style.left = (Math.random() * 100) + 'vw';
  b.style.setProperty('--drift', drift + 'px');
  b.style.animationDuration = dur + 's';
  bubblesLayer.appendChild(b);
  setTimeout(() => b.remove(), dur * 1000 + 200);
}
// Prime the screen with a few, then maintain a steady stream.
// Reduced motion: fewer, slower bubbles so the scene still breathes.
const AMBIENT_BUBBLE_INTERVAL_MS = REDUCE_MOTION ? 3200 : 900;
const AMBIENT_BUBBLE_PRIME = REDUCE_MOTION ? 2 : 6;
for (let i = 0; i < AMBIENT_BUBBLE_PRIME; i++) {
  setTimeout(spawnBubble, i * 400 + Math.random() * 800);
}
setInterval(spawnBubble, AMBIENT_BUBBLE_INTERVAL_MS);

// ---------- animation loop ----------
let lastFrame = performance.now();
function tick(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  const nowEpochMs = Date.now();
  const schoolFish = [];
  const predators = [];
  for (const fish of fishById.values()) {
    if (fish.mode !== 'school' || !fish.loaded) continue;
    schoolFish.push(fish);
    if (fish.isShark) predators.push(fish);
  }
  // Group hierarchies: pick a leader per species from the school.
  // Criteria: the 'leader' personality wins if present, otherwise the fish
  // with the largest rendered size. Ties broken by oldest (stable across
  // frames so followers don't jitter between candidates).
  const leaderBySpecies = new Map();
  for (const fish of schoolFish) {
    if (!fish.species) continue;
    // Leaders can only belong to flocking species.
    if (fish.locomotion === 'predator' || fish.locomotion === 'crawler'
        || fish.locomotion === 'walker' || fish.locomotion === 'clinger'
        || fish.locomotion === 'jetter') continue;
    const cur = leaderBySpecies.get(fish.species);
    if (!cur) { leaderBySpecies.set(fish.species, fish); continue; }
    const fIsLeader = fish.personality?.id === 'leader';
    const cIsLeader = cur.personality?.id === 'leader';
    if (fIsLeader && !cIsLeader) { leaderBySpecies.set(fish.species, fish); continue; }
    if (!fIsLeader && cIsLeader) continue;
    if (fish.size > cur.size + 0.5) { leaderBySpecies.set(fish.species, fish); continue; }
    if (Math.abs(fish.size - cur.size) < 0.5 && fish.createdAt < cur.createdAt) {
      leaderBySpecies.set(fish.species, fish);
    }
  }
  advanceTankEvents(now, schoolFish);
  if (caustics) caustics.render(now);
  const scene = { nowEpochMs, schoolFish, predators, events: tankEvents, leaderBySpecies };
  for (const fish of fishById.values()) fish.update(dt, now, scene);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- polling ----------
async function poll() {
  try {
    const r = await fetch('/api/fish', { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();

    if (currentDay && data.day !== currentDay) {
      for (const f of fishById.values()) f.destroy();
      fishById.clear();
      culledIds.clear();
    }
    currentDay = data.day;

    const serverIds = new Set();
    const firstLoad = fishById.size === 0;

    for (const meta of data.fish) {
      serverIds.add(meta.id);
      if (fishById.has(meta.id)) continue;
      // Skip fish that were culled locally — they've already swum off.
      if (culledIds.has(meta.id)) continue;
      const fish = new Fish(meta);
      if (firstLoad || REDUCE_MOTION) {
        // Reduced motion: skip the featured/splash cinematic and drop new
        // fish straight into the school. Announce with a gentle name-tag fade.
        const drop = () => {
          fish.startAsSchool();
          if (!firstLoad && fish.nameTag) {
            fish.nameShowUntil = performance.now() + NAME_SHOW_MS;
          }
        };
        if (fish.loaded) drop();
        else fish.img.addEventListener('load', drop, { once: true });
      } else {
        // Multiple iPads can submit simultaneously — queue arrivals so each
        // fish gets its own cinematic moment instead of colliding.
        cinematicRequest(fish);
      }
      fishById.set(meta.id, fish);
    }

    for (const [id, f] of fishById) {
      if (!serverIds.has(id)) {
        // Let already-departing fish finish their swim-off animation.
        if (f.departing) continue;
        f.destroy();
        fishById.delete(id);
      }
    }

    // Trim the culled-ids set to just IDs the server still knows about, so
    // it can't grow without bound across a long-running session.
    for (const id of culledIds) {
      if (!serverIds.has(id)) culledIds.delete(id);
    }

    countEl.textContent = `${fishById.size} fish today`;
  } catch (e) {
    console.warn('poll failed', e);
  }
}

poll();
setInterval(poll, POLL_MS);

// Periodic thin-out: every 10 minutes, about half of the tank's school fish
// swim off the sides and don't come back. Keeps long events from drowning in
// sprites without having to touch the server-side store.
function cullHalfSchool() {
  const eligible = [];
  for (const f of fishById.values()) {
    if (f.mode !== 'school') continue;
    if (f.departing || !f.loaded) continue;
    eligible.push(f);
  }
  if (eligible.length < 2) return;
  // Fisher-Yates partial shuffle: take the first N after shuffling.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const take = Math.max(1, Math.round(eligible.length * CULL_FRACTION));
  for (let i = 0; i < take; i++) {
    // Stagger the exits so the tank doesn't suddenly empty in one frame.
    const f = eligible[i];
    setTimeout(() => {
      if (!fishById.has(f.id) || f.departing) return;
      f.departToEdge({ cull: true });
    }, Math.floor(Math.random() * 4000));
  }
}
setInterval(cullHalfSchool, CULL_INTERVAL_MS);

// ---------- Hidden reset hotspot ----------
const resetBtn = document.getElementById('resetHotspot');
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset the aquarium and remove all fish for today?')) return;
    try {
      const r = await fetch('/api/reset', { method: 'POST' });
      if (!r.ok) throw new Error('reset failed');
      // Have every current fish swim off-screen; they self-destroy on exit.
      for (const f of fishById.values()) f.departToEdge();
      countEl.textContent = '0 fish today';
    } catch (e) {
      console.warn(e);
      alert('Reset failed. Please try again.');
    }
  });
}

function handleViewportResize() {
  if (caustics) caustics.resize();
  const W = window.innerWidth, H = window.innerHeight;
  for (const f of fishById.values()) {
    if (f.mode !== 'school') continue;
    f.x = Math.min(Math.max(f.x, 0), W - 50);
    f.y = Math.min(Math.max(f.y, 40), H - 80);
  }
}
window.addEventListener('resize', handleViewportResize);
// iOS Safari: the URL bar show/hide does not always fire a standard resize
// event on older versions. visualViewport.resize catches it reliably so the
// tank reflows when the browser chrome collapses.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleViewportResize);
}
window.addEventListener('orientationchange', handleViewportResize);
