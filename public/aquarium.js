const aq = document.getElementById('aquarium');
const countEl = document.getElementById('count');
const bubblesLayer = document.getElementById('bubbles');
const causticsCanvas = document.getElementById('caustics');

/** @type {Map<string, Fish>} */
const fishById = new Map();
let currentDay = null;
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

// Honor the user's system-level motion preference.
const REDUCE_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
let REDUCE_MOTION = REDUCE_MOTION_QUERY.matches;
if (REDUCE_MOTION_QUERY.addEventListener) {
  REDUCE_MOTION_QUERY.addEventListener('change', (e) => { REDUCE_MOTION = e.matches; });
}

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
// crawler (sea slug — barely moves), predator (shark — large, solo).
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
};
const DEFAULT_TRAITS = { locomotion: 'swimmer', yMinF: 0.15, yMaxF: 0.80, speedMul: 1.0 };

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

const caustics = initCaustics(causticsCanvas);

class Fish {
  constructor(meta) {
    this.id = meta.id;
    this.url = meta.url;
    this.createdAt = meta.createdAt;
    this.name = (meta.name || '').trim();
    this.species = (meta.species || '').toLowerCase();
    this.traits = SPECIES_TRAITS[this.species] || DEFAULT_TRAITS;
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

    // Depth tier: near / mid / far.
    const r = this.rand();
    if (r < 0.35) { this.depth = 'far';  this.depthScale = 0.75; this.depthSpeed = 0.75; }
    else if (r < 0.75) { this.depth = 'mid'; this.depthScale = 1.0; this.depthSpeed = 1.0; }
    else { this.depth = 'near'; this.depthScale = 1.22; this.depthSpeed = 1.08; }

    this.el = document.createElement('div');
    this.el.className = 'fish-sprite depth-' + this.depth;
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
    this.splashY = 90 + this.rand() * 100;

    this.baseSpeed = (45 + this.rand() * 45) * this.depthSpeed * (this.traits.speedMul || 1);
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
  }

  startAsSchool() {
    this.mode = 'school';
    this.phaseStart = performance.now();
    this.badge.remove();
    cinematicEnd(this);
    if (this.splash) { this.splash.remove(); this.splash = null; }
    const W = window.innerWidth, H = window.innerHeight;
    const baseSize = 80 + this.rand() * 80;
    const sizeMul = this.traits.sizeMul || 1;
    const targetSize = baseSize * this.depthScale * sizeMul;

    // Smooth shrink from the featured size down to the school size so the fish
    // doesn't visibly "pop" into the background. Filter / opacity transitions
    // (in CSS) cover the depth-class filter fade simultaneously.
    this.schoolTransitionMs = 1500;
    this.schoolTransitionStart = performance.now();
    this.schoolTransitionFromSize = this.size || targetSize;
    this.schoolTargetSize = targetSize;

    // Hold the sprite above the coral overlay while its filter fades in,
    // so it doesn't visibly drop behind foreground elements mid-shrink.
    this.el.classList.add('school-settling');
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this.el.classList.remove('school-settling');
      this._settleTimer = null;
    }, this.schoolTransitionMs);

    if (this.x < -1000) {
      this.x = Math.random() * W;
      // Habitat-aware initial placement: bottom-dwellers start near the floor,
      // floaters in mid-column, swimmers anywhere in their preferred band.
      const yMin = this.traits.yMinF * H;
      const yMax = this.traits.yMaxF * H;
      this.y = yMin + Math.random() * Math.max(1, (yMax - yMin));
    }

    const dir = this.vx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(this.vx);
    this.vx = dir * this.baseSpeed;
    this.vy = (this.rand() - 0.5) * 12;

    this.circleCenterX = this.x;
    this.circleCenterY = this.y;

    // Show name tag for a few seconds when entering the school.
    if (this.nameTag) this.nameShowUntil = performance.now() + NAME_SHOW_MS;
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

  update(dtMs, tMs) {
    if (!this.loaded) return;
    const W = window.innerWidth, H = window.innerHeight;
    const aspect = this.naturalW / this.naturalH;

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
    if (this.schoolTransitionMs > 0) {
      const elapsed = tMs - this.schoolTransitionStart;
      if (elapsed >= this.schoolTransitionMs) {
        this.size = this.schoolTargetSize;
        this.schoolTransitionMs = 0;
      } else {
        const u = elapsed / this.schoolTransitionMs;
        const e = easeInOut(u);
        this.size = this.schoolTransitionFromSize +
          (this.schoolTargetSize - this.schoolTransitionFromSize) * e;
      }
    }

    this.stepEncounter(dt);

    // Prey fish notice predators and bolt on proximity.
    if (this.isPrey) this.applyPredatorScare();

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
        case 'predator':  this.stepPredator(dt, W, H); break;
        case 'floater':   this.stepFloater(dt, W, H); break;
        case 'slitherer': this.stepSlitherer(dt, W, H); break;
        case 'glider':    this.stepGlider(dt, W, H); break;
        default:          this.stepPersonality(dt, W, H);
      }
    }
    this.applyEncounterForce(dt);
    this.applyCursorRepulsion(dt);
    this.applyFlocking(dt);
    this.stepIdle(dt, tMs);

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

    // Puffer-only: rare puff-up behavior.
    if (this.isPuffer) this.stepPuff(dt);
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

  applyFlocking(dt) {
    // Solitary / sedentary animals don't school.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler') return;
    // Species-weighted boids: same-species neighbors dominate the alignment /
    // cohesion averages so fish of the same kind naturally school tighter,
    // while different species still politely steer around each other.
    const NEIGHBOR = 150;
    const SEP = 55;
    let ax = 0, ay = 0;  // weighted alignment sum
    let cx = 0, cy = 0;  // weighted cohesion sum
    let sx = 0, sy = 0;  // separation (unweighted — personal space is universal)
    let wAlign = 0;
    let nSep = 0;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    for (const other of fishById.values()) {
      if (other === this || other.mode !== 'school' || !other.loaded) continue;
      const ox = other.x + other.size * 0.5;
      const oy = other.y + other.size * 0.5;
      const dx = ox - myCx;
      const dy = oy - myCy;
      const d = Math.hypot(dx, dy);
      if (d > NEIGHBOR || d < 0.001) continue;
      const sameSpecies = this.species && this.species === other.species;
      // Same-species: full weight. Different species: light social awareness.
      const w = sameSpecies ? 1.0 : 0.2;
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
    if (wAlign > 0) {
      ax /= wAlign; ay /= wAlign;
      // Tighter alignment + cohesion when same-species neighbors dominate the sum.
      const alignK = 0.55;
      const cohesionK = 0.24;
      this.vx += (ax - this.vx) * alignK * dt;
      this.vy += (ay - this.vy) * alignK * dt;
      cx = cx / wAlign - myCx;
      cy = cy / wAlign - myCy;
      this.vx += cx * cohesionK * dt;
      this.vy += cy * cohesionK * dt;
    }
    if (nSep > 0) {
      this.vx += sx * 90 * dt;
      this.vy += sy * 90 * dt;
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
  stepEncounter(dt) {
    // Predators and bottom-crawlers don't play the social-encounter game.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler') return;
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
    this.encounterCooldown = 8 + this.rand() * 18;
    this.tryInitiateEncounter();
  }

  tryInitiateEncounter() {
    const MAX_DIST = 380;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    const candidates = [];
    for (const other of fishById.values()) {
      if (other === this || other.mode !== 'school' || !other.loaded) continue;
      if (other.encounterState) continue;
      // Skip sharks (intimidating) and sea slugs (oblivious) as encounter partners.
      if (other.locomotion === 'predator' || other.locomotion === 'crawler') continue;
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
    this.encounterCooldown = 12 + this.rand() * 20;
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
  applyPredatorScare() {
    if (this.scareTTL > 0) return;
    const myCx = this.x + this.size * 0.5;
    const myCy = this.y + this.size * 0.5;
    for (const other of fishById.values()) {
      if (!other.isShark || other.mode !== 'school' || !other.loaded) continue;
      const r = other.traits.intimidateRadius || 220;
      const dx = (other.x + other.size * 0.5) - myCx;
      const dy = (other.y + other.size * 0.5) - myCy;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 0.001) continue;
      this.scareTTL = 1.5 + this.rand() * 1.0;
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
    // Predators / floaters / crawlers have their own pacing; skip random pauses.
    if (this.locomotion === 'predator' || this.locomotion === 'crawler'
        || this.locomotion === 'floater' || this.locomotion === 'glider') return;
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
      // ~35% chance of an idle pause, otherwise just a tail-flick micro-burst.
      if (this.rand() < 0.35) {
        this.isIdle = true;
        this.idleDuration = 1.2 + this.rand() * 1.8;
      } else {
        const dir = Math.sign(this.vx || 1);
        this.vx = dir * this.baseSpeed * (1.8 + this.rand() * 0.6);
        this.vy += (this.rand() - 0.5) * 20;
      }
      this.idleTimer = 5 + this.rand() * 10;
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

    if (t < SPLASH_FALL_MS) {
      const u = t / SPLASH_FALL_MS;
      const bigH = Math.min(H * 0.48, 460);
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
      this.ensureSplash();
      const u = (t - SPLASH_FALL_MS) / SPLASH_BURST_MS;
      const bigH = Math.min(H * 0.48, 460);
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
    const bigH = Math.min(H * 0.42, 400) * (1 - 0.12 * u);
    const h = bigH;
    const w = h * aspect;
    const startX = this.splashX - w / 2;
    const startY = this.splashY - h / 2;
    const endX = W * 0.5 - w / 2;
    const endY = H * 0.55 - h / 2;
    const baseX = startX + (endX - startX) * easeInOut(u);
    const baseY = startY + (endY - startY) * easeInOut(u);

    let dx = 0, dy = 0;
    const tt = elapsed / 1000;
    switch (this.pattern) {
      case 'wavy':
        dy = Math.sin(tt * (2 * Math.PI / this.wavePeriod) + this.wavePhase) * this.waveAmp;
        break;
      case 'zigzag':
        dy = (triangleWave(tt / (this.wavePeriod * 0.6) + this.wavePhase) * 2 - 1) * this.waveAmp;
        break;
      case 'darter': {
        const cycle = 1.2;
        const p = (tt % cycle) / cycle;
        const burst = p < 0.3 ? easeOutQuad(p / 0.3) : 1 - easeOutQuad((p - 0.3) / 0.7);
        dx = (burst - 0.5) * this.waveAmp * 1.2;
        dy = Math.sin(tt * 3) * 6;
        break;
      }
      case 'circler':
        dx = Math.cos(tt * 1.2 + this.wavePhase) * this.waveAmp * 0.9;
        dy = Math.sin(tt * 1.2 + this.wavePhase) * this.waveAmp * 0.9;
        break;
      case 'glider':
      default:
        dy = Math.sin(tt * 0.9 + this.wavePhase) * this.waveAmp * 0.6;
        dx = Math.cos(tt * 0.6 + this.wavePhase) * this.waveAmp * 0.3;
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
    // Compensate translation so the fish puffs from its center, not top-left.
    const puffOffset = (puffScale - 1) * 0.5;
    const tx = x - w * puffOffset;
    const ty = y - h * puffOffset;
    this.el.style.transform = `translate(${tx}px, ${ty}px) scale(${puffScale})`;
    this.flipEl.style.transform = `scaleX(${flip})`;
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
    this.wiggleEl.style.transform = wiggleParts.join(' ');
    this.renderShadow(x, y, w, h, vx);
  }

  renderShadow(x, y, w, h, vx) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const floorY = H - Math.max(62, Math.min(108, H * 0.12));
    const fishCx = x + w * 0.5;
    const fishCy = y + h * 0.55;
    const heightOffFloor = Math.max(0, floorY - fishCy);
    const lift = Math.min(1, heightOffFloor / Math.max(1, H * 0.6));
    const driftX = (W * 0.5 - fishCx) * 0.08;
    const stretchX = 0.92 + (1 - lift) * 0.14;
    const blur = 6 + lift * 12 + (this.depth === 'far' ? 2.5 : 0);
    const opacity = 0.1 + (1 - lift) * 0.09 + (this.depth === 'near' ? 0.02 : 0);
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
  departToEdge() {
    if (this.departing) return;
    this.departing = true;
    // Remove from the cinematic pipeline so queued fish don't block the exit.
    const qi = cinematicQueue.indexOf(this);
    if (qi >= 0) cinematicQueue.splice(qi, 1);
    this.cinematicPending = false;
    cinematicEnd(this);
    if (this.splash) { this.splash.remove(); this.splash = null; }
    this.badge.remove();
    // Cancel every in-progress behavioral state.
    this.encounterState = null;
    this.encounterTarget = null;
    this.scareTTL = 0;
    this.isIdle = false;
    this.puffTarget = 0;
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
      this.destroy();
      fishById.delete(this.id);
    }
  }

  destroy() {
    cinematicEnd(this);
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    this.shadowEl.remove();
    this.el.remove();
    this.badge.remove();
    if (this.splash) this.splash.remove();
    if (this.nameTag) this.nameTag.remove();
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

// ---------- Cinematic spotlight controller ----------
// One shared dim overlay + banner. Any fish entering `featured` mode grabs the
// camera; when their splash phases end, the camera releases while the banner
// lingers until the fish merges into the school.
const cinematicDim = document.createElement('div');
cinematicDim.className = 'tv-dim';
document.body.appendChild(cinematicDim);

const cinematicBanner = document.createElement('div');
cinematicBanner.className = 'tv-banner';
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

function cinematicBegin(fish) {
  if (fish.cinematicActive) return;
  fish.cinematicActive = true;
  fish.el.classList.add('featured-mode');

  // Camera zoom + dim cut-out focused on splash point.
  cinematicState.zoomFish = fish;
  cinematicDim.style.setProperty('--dim-x', fish.splashX + 'px');
  cinematicDim.style.setProperty('--dim-y', fish.splashY + 'px');
  cinematicDim.classList.add('show');

  const W = window.innerWidth, H = window.innerHeight;
  // Transform origin must be in aquarium-local coords (= viewport, since #aquarium is fixed inset:0).
  aq.style.transformOrigin = `${fish.splashX}px ${fish.splashY}px`;
  aq.style.transform = 'scale(1.22)';

  // Banner belongs to the most recent fish.
  cinematicState.bannerFish = fish;
  cinematicBanner.textContent = cinematicLabel(fish);
  requestAnimationFrame(() => cinematicBanner.classList.add('show'));

  // Release camera + dim after the splash/hold window, independent of banner.
  if (cinematicState.zoomReleaseTimer) clearTimeout(cinematicState.zoomReleaseTimer);
  cinematicState.zoomReleaseTimer = setTimeout(() => {
    // Only release if this fish still owns the zoom (no newer fish took it).
    if (cinematicState.zoomFish === fish) {
      cinematicDim.classList.remove('show');
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
  if (caustics) caustics.render(now);
  for (const fish of fishById.values()) fish.update(dt, now);
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
    }
    currentDay = data.day;

    const serverIds = new Set();
    const firstLoad = fishById.size === 0;

    for (const meta of data.fish) {
      serverIds.add(meta.id);
      if (fishById.has(meta.id)) continue;
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

    countEl.textContent = `${fishById.size} fish today`;
  } catch (e) {
    console.warn('poll failed', e);
  }
}

poll();
setInterval(poll, POLL_MS);

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

window.addEventListener('resize', () => {
  if (caustics) caustics.resize();
  const W = window.innerWidth, H = window.innerHeight;
  for (const f of fishById.values()) {
    if (f.mode !== 'school') continue;
    f.x = Math.min(Math.max(f.x, 0), W - 50);
    f.y = Math.min(Math.max(f.y, 40), H - 80);
  }
});
