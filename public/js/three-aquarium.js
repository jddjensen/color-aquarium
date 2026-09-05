import * as THREE from '/vendor/three.module.min.js';

const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWave;
  uniform float uPulse;
  varying vec2 vUv;
  varying float vShimmer;
  void main() {
    vUv = uv;
    vec3 p = position;
    float edge = pow(abs(uv.x - 0.5) * 2.0, 1.7);
    float swim = sin(uTime * 5.0 + uv.x * 8.0);
    p.y += swim * uWave * edge;
    p.z += cos(uTime * 3.2 + uv.x * 5.0) * uWave * 0.7 * edge;
    p.x *= 1.0 + sin(uTime * 2.4) * uPulse;
    vShimmer = 0.5 + 0.5 * sin(uTime * 1.7 + uv.y * 7.0 + uv.x * 3.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uDepth;
  varying vec2 vUv;
  varying float vShimmer;
  void main() {
    vec4 texel = texture2D(uMap, vUv);
    if (texel.a < 0.01) discard;
    float depthLight = mix(0.72, 1.08, uDepth);
    float sheen = 0.96 + vShimmer * 0.08;
    vec3 color = texel.rgb * depthLight * sheen;
    color += vec3(0.03, 0.08, 0.10) * vShimmer * (1.0 - uDepth);
    gl_FragColor = vec4(color, texel.a * uOpacity);
  }
`;

export function createThreeAquarium(canvas, { enabled = true } = {}) {
  if (!canvas || !enabled) return fallback();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.warn('Three.js aquarium unavailable; using DOM sprites.', error);
    return fallback();
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 1000);
  camera.position.z = 100;
  const entries = new Map();

  function resize() {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
  }
  resize();

  function addFish(id, image) {
    if (entries.has(id)) return true;
    try {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const geometry = new THREE.PlaneGeometry(1, 1, 20, 4);
      const uniforms = {
        uMap: { value: texture },
        uTime: { value: 0 },
        uWave: { value: 0.025 },
        uPulse: { value: 0.01 },
        uOpacity: { value: 1 },
        uDepth: { value: 1 },
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      entries.set(id, { mesh, geometry, material, texture, uniforms });
      return true;
    } catch (error) {
      console.warn('Could not create Three.js fish.', id, error);
      return false;
    }
  }

  function updateFish(id, state) {
    const entry = entries.get(id);
    if (!entry) return;
    const { mesh, uniforms } = entry;
    mesh.visible = state.visible !== false;
    mesh.position.set(state.x + state.width / 2, state.y + state.height / 2, state.z || 0);
    mesh.scale.set(state.width * (state.flip || 1), state.height, 1);
    mesh.rotation.z = state.rotation || 0;
    mesh.rotation.y = state.bank || 0;
    uniforms.uWave.value = Math.max(0.008, Math.min(0.09, Math.abs(state.wave || 0.02)));
    uniforms.uPulse.value = Math.max(0, Math.min(0.08, state.pulse || 0.01));
    uniforms.uOpacity.value = state.opacity ?? 1;
    uniforms.uDepth.value = state.depth ?? 1;
  }

  function removeFish(id) {
    const entry = entries.get(id);
    if (!entry) return;
    scene.remove(entry.mesh);
    entry.geometry.dispose();
    entry.material.dispose();
    entry.texture.dispose();
    entries.delete(id);
  }

  function render(now) {
    for (const entry of entries.values()) entry.uniforms.uTime.value = now * 0.001;
    renderer.render(scene, camera);
  }

  return {
    active: true,
    addFish,
    updateFish,
    removeFish,
    resize,
    render,
    stats: () => ({ fish: entries.size, calls: renderer.info.render.calls, textures: renderer.info.memory.textures }),
  };
}

function fallback() {
  return {
    active: false,
    addFish: () => false,
    updateFish() {},
    removeFish() {},
    resize() {},
    render() {},
    stats: () => ({ fish: 0, calls: 0, textures: 0 }),
  };
}
