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

    mat2 rot(float a) {
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c);
    }

    float caustic(vec2 p) {
      float t = uTime * 0.22;
      float glow = 0.0;
      p *= 2.8;
      for (int i = 0; i < 3; i++) {
        p += vec2(sin(p.y * 2.1 + t), cos(p.x * 1.7 - t)) * 0.28;
        float ridge = sin(p.x + sin(p.y + t)) + cos(p.y + cos(p.x - t));
        glow += abs(ridge);
        p = rot(0.9) * p * 1.32;
        t *= 1.17;
      }
      return pow(max(0.0, 1.75 - glow), 4.5);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      p.y += uTime * 0.03;

      float band = smoothstep(-0.55, 0.35, uv.y) * (1.0 - smoothstep(0.78, 1.02, uv.y));
      float c = caustic(p);
      c += caustic(p * 1.6 + vec2(1.7, -1.2)) * 0.35;
      c *= band;

      vec3 col = mix(vec3(0.08, 0.24, 0.34), vec3(0.76, 0.95, 1.0), c);
      float alpha = clamp(c * 0.34, 0.0, 0.34);
      gl_FragColor = vec4(col, alpha);
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
    this.isPuffer = this.species === 'puffer1';
    // Puff-up state: 0..1 scale overlay on the sprite.
    this.puffLevel = 0;
    this.puffTarget = 0;
    this.puffTimer = this.isPuffer ? (30 + Math.random() * 60) : Infinity;

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
    });

    this.mode = 'featured';
    this.cinematicPending = false;
    this.phaseStart = performance.now();

    this.splashX = 80 + this.rand() * 160;
    this.splashY = 90 + this.rand() * 100;

    this.baseSpeed = (45 + this.rand() * 45) * this.depthSpeed;
    this.waveAmp = 14 + this.rand() * 22;
    this.wavePeriod = 1.6 + this.rand() * 2.2;
    this.wavePhase = this.rand() * Math.PI * 2;
    this.turnTimer = 0;
    this.wiggleBase = 0.8 + this.rand() * 0.5;
    this.wiggleAmpBase = 0.08 + this.rand() * 0.06;
    this.wigglePhase = this.rand() * Math.PI * 2;
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
    this.size = baseSize * this.depthScale;

    if (this.x < -1000) {
      this.x = Math.random() * W;
      this.y = 80 + Math.random() * (H - 160);
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

    if (this.mode === 'featured') {
      this.updateFeatured(tMs, W, H, aspect);
      this.updateNameTag(tMs);
      return;
    }

    const dt = dtMs / 1000;
    this.stepPersonality(dt, W, H);
    this.applyCursorRepulsion(dt);
    this.applyFlocking(dt);
    this.stepIdle(dt, tMs);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const h = this.size;
    const w = h * aspect;

    if (this.x < -w * 0.25) { this.x = -w * 0.25; this.vx = Math.abs(this.vx); }
    if (this.x > W - w * 0.75) { this.x = W - w * 0.75; this.vx = -Math.abs(this.vx); }
    if (this.y < 40) { this.y = 40; this.vy = Math.abs(this.vy); }
    if (this.y > H - h - 20) { this.y = H - h - 20; this.vy = -Math.abs(this.vy); }

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
    // Gentle boids-style influence from nearby schoolmates.
    const NEIGHBOR = 130;
    const SEP = 55;
    let ax = 0, ay = 0;  // alignment
    let cx = 0, cy = 0;  // cohesion
    let sx = 0, sy = 0;  // separation
    let nAlign = 0, nSep = 0;
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
      ax += other.vx; ay += other.vy;
      cx += ox; cy += oy;
      nAlign++;
      if (d < SEP) {
        const push = (SEP - d) / SEP;
        sx -= (dx / d) * push;
        sy -= (dy / d) * push;
        nSep++;
      }
    }
    if (nAlign > 0) {
      ax /= nAlign; ay /= nAlign;
      this.vx += (ax - this.vx) * 0.45 * dt;
      this.vy += (ay - this.vy) * 0.45 * dt;
      cx = cx / nAlign - myCx;
      cy = cy / nAlign - myCy;
      this.vx += cx * 0.18 * dt;
      this.vy += cy * 0.18 * dt;
    }
    if (nSep > 0) {
      this.vx += sx * 90 * dt;
      this.vy += sy * 90 * dt;
    }
    // Clamp speed so boids don't blow up.
    const speed = Math.hypot(this.vx, this.vy);
    const maxSpeed = this.baseSpeed * 2.8;
    if (speed > maxSpeed) {
      this.vx *= maxSpeed / speed;
      this.vy *= maxSpeed / speed;
    }
  }

  stepIdle(dt, tMs) {
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

  renderSprite(x, y, w, h, vx, vy) {
    const speed = Math.hypot(vx, vy);
    const now = performance.now() / 1000;
    const freq = this.wiggleBase * (1.4 + Math.min(2.5, speed / 60));
    const phase = now * freq * Math.PI * 2 + this.wigglePhase;
    const speedScale = 0.6 + Math.min(1.6, speed / 80);
    const dartBoost = this.dartPhase === 'dart' ? 1.6 : 1;
    const shapeScale = this.isSeahorse ? 0.5 : 1;
    const ampRad = this.wiggleAmpBase * speedScale * dartBoost * shapeScale;
    const skewY = Math.sin(phase) * ampRad;
    const squashX = 1 + Math.cos(phase * 2) * 0.025;

    const movingRight = vx > 0;
    const flip = movingRight ? -1 : 1;

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
    this.wiggleEl.style.transform = `skewY(${skewY}rad) scaleX(${squashX})`;
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

  destroy() {
    cinematicEnd(this);
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
      for (const f of fishById.values()) f.destroy();
      fishById.clear();
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
