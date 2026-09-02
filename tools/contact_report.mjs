/* Renders the real scene (terrain + road + all trackside scenery) with a tiny
   software rasteriser, so the game's look can be judged headlessly: holes in
   the ground, scenery floating above the hillside, a car hovering off its
   tarmac — all of it shows up in the output PNGs.
   Usage: node tools/render_preview.mjs [track name]      env QUAL=LOW|MED|HIGH|ULTRA
   The scene is built by running the game's own buildWorld() code, sliced out
   of src/game.js, against stubbed textures and DOM — no rendering shortcuts. */
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const slice = (a, b) => {
  const i = game.search(a); if (i < 0) throw new Error('anchor ' + a);
  const r = game.slice(i); const j = r.search(b); if (j < 0) throw new Error('end ' + b);
  return r.slice(0, j);
};
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
globalThis.THREE = THREE;
globalThis.V3 = V3;

/* ---- the outside world the module assumes: a canvas that draws nothing ---- */
/* Canvas 2D that accepts anything and draws nothing — the game's textures are
   procedural, so the preview only needs the calls not to throw. */
const ctx2d = () => new Proxy({ _props: {} }, {
  get(t, k) {
    if (k in t._props) return t._props[k];
    if (k === 'measureText') return () => ({ width: 8 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => ({ addColorStop() {} });
    if (k === 'createPattern') return () => ({ setTransform() {} });
    return () => ({ addColorStop() {}, setTransform() {} });
  },
  set(t, k, v) { t._props[k] = v; return true; }
});
globalThis.document = {
  createElement: (tag) => (tag === 'canvas'
    ? { style: {}, width: 8, height: 8, getContext: ctx2d, addEventListener() {} }
    : { style: {}, className: '', innerHTML: '', textContent: '', children: [], appendChild() {}, addEventListener() {} }),
  getElementById: () => null,
  body: { classList: { add() {}, remove() {} }, appendChild() {} },
  addEventListener() {}
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1000, innerHeight: 800, addEventListener() {} };
globalThis.navigator = { maxTouchPoints: 0, userAgent: 'node', language: 'en' };
globalThis.screen = { orientation: { angle: 0, addEventListener() {} } };
const tex = new Proxy({ __tex: true }, {
  get(t, k) {
    if (k === 'repeat' || k === 'offset') return { x: 0, y: 0, set() {} };
    if (k === 'clone') return () => tex;
    if (k in t) return t[k];
    return k === 'isTexture' ? true : tex;
  },
  set() { return true; }
});
globalThis.tex = tex;
/* A WebGL2 context just complete enough for three.js to construct a
   WebGLRenderer and query capabilities; nothing is ever drawn with it. */
const GL_ENUMS = {}; let enumCounter = 0x10000;
const glConst = { VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c, MAX_TEXTURE_SIZE: 0x0d33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d, MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd, MAX_VARYING_VECTORS: 0x8dfc, MAX_VERTEX_ATTRIBS: 0x8869, MAX_SAMPLES: 0x8d57, MAX_RENDERBUFFER_SIZE: 0x84e8, SCISSOR_BOX: 0x0c10, VIEWPORT: 0x0ba2 };
const glStub = () => {
  const num = () => 4096, obj = () => ({ __o: true });
  const gl = {
    canvas: { width: 100, height: 100, style: {}, addEventListener() {} },
    drawingBufferWidth: 100, drawingBufferHeight: 100,
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 } : {
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16, TEXTURE_MAX_ANISOTROPY_EXT: 16, filter: 1 }),
    getParameter: (p) => {
      const S = { [gl.VERSION]: 'WebGL 2.0 (Polygon Preview)', [gl.SHADING_LANGUAGE_VERSION]: 'OpenGL ES GLSL ES 3.00',
        [gl.SCISSOR_BOX]: [0, 0, 100, 100], [gl.VIEWPORT]: [0, 0, 100, 100], [gl.MAX_SAMPLES]: 4 };
      if (p in S) return S[p];
      return num();
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    VERSION: 7001, SHADING_LANGUAGE_VERSION: 7002, MAX_TEXTURE_SIZE: 7003, MAX_CUBE_MAP_TEXTURE_SIZE: 7004,
    MAX_TEXTURE_IMAGE_UNITS: 7005, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 7006, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 7007,
    MAX_VERTEX_UNIFORM_VECTORS: 7008, MAX_FRAGMENT_UNIFORM_VECTORS: 7009, MAX_VARYING_VECTORS: 7010,
    MAX_VERTEX_ATTRIBS: 7011, MAX_SAMPLES: 7012, MAX_RENDERBUFFER_SIZE: 7013, SCISSOR_BOX: 7014, VIEWPORT: 7015,
    MAX_ARRAY_TEXTURE_LAYERS: 7016, TEXTURE_MAX_LEVEL: 7017, MAX_3D_TEXTURE_SIZE: 7018, UNMASKED_RENDERER: 7019,
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getError: () => 0, isContextLost: () => false,
    createTexture: obj, createBuffer: obj, createProgram: obj, createShader: obj,
    createFramebuffer: obj, createRenderbuffer: obj, createVertexArray: obj, createQuery: obj,
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => '', getShaderInfoLog: () => '',
    getShaderSource: () => '', getActiveInfo: () => ({ name: 'u', size: 1, type: 35664 }),
    getUniformLocation: () => ({ __u: true }), getAttribLocation: () => 0,
    checkFramebufferStatus: () => 36053, readPixels() {}, getParameter_: num
  };
  const num2 = () => 4096; void num2;
  return new Proxy(gl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return GL_ENUMS[k] !== undefined ? GL_ENUMS[k] : (GL_ENUMS[k] = enumCounter++);
      return (...a) => { const r = {}; return r; };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
};
const mkGlCanvas = () => ({ width: 100, height: 100, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => glStub() });
globalThis.mkGlCanvas = mkGlCanvas;
/* Stub: a Proxy that swallows any call or property read and stays truthy. It
   is re-emitted into the eval'd scope by source text, so it must not refer to
   anything from this module. */
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => 0 : k === 'isTexture' ? true : stub())),
  apply: () => stub(), construct: () => stub()
});


/* ---- track data: the same curve the game builds from ---- */
const TRACKS = (await import(path.join(ROOT, 'src', 'tracks.js'))).TRACKS;
const name = process.argv[2] || 'Spa-Francorchamps';
const q = process.env.QUAL || 'HIGH';
const { QUALITY_PRESETS } = await import(path.join(ROOT, 'src', 'quality.js'));
const idx = TRACKS.findIndex((t) => t.name === name);
if (idx < 0) { console.error('no track named ' + name); process.exit(2); }
const def = { ...TRACKS[idx] };
const dataFile = path.join(ROOT, 'public', 'data', 'circuits', def.openf1CircuitKey + '.json');
if (fs.existsSync(dataFile)) def.realPts = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

/* ---- assemble the module slice: the real renderer/scene/light setup plus
   buildWorld, so what we rasterise is literally what the game builds. ---- */
const helpers = game.split('\n')
  .filter((l) => /^(const clamp=|const lerp=|const smoothstep01=|const damp=|const rand=|const pick=)/.test(l))
  .join('\n');
const srcTxt = [
  helpers,
  slice(/function getTrackElevation\(/, /\/\* =+ weather =+ \*\//),                 // procedural elevation profiles
  slice(/function getTrackHAtCoords\(/, /\/\* =+ weather =+ \*\//),          // prop anchoring helpers
  slice(/const _sv=V3\(0,0,0\)/, /^function buildWorld\(/m),       // scratch vectors, sampleF, fixWinding
  slice(/export function getBodyGeo\(/, /function makePointsSys\(/), // car mesh builders
  slice(/\/\* =+ renderer \/ scene =+ \*\//, /\/\* =+ canvas textures =+ \*\//), // renderer, scene, sky, env
  slice(/\/\* =+ canvas textures =+ \*\//, /\/\* =+ car geometry =+ \*\//),      // asphalt/grass/kerb textures
  slice(/\/\* =+ weather state =+ \*\//, /\/\* =+ thunderstorm/),               // rain/wetness state
  'var world=null;var T=null;var timeSec=0;var samples=[];',
  slice(/function buildWorld\(/, /buildMinimapPath\(\);\n/).replace(/buildMinimapPath\(\);\n$/, '') + '\n}',
  '\nbuildWorld(' + idx + ');',
  '\nglobalThis.__out={T,world,scene,renderer};'
].join('\n')
  .replace(/^export /gm, '')
  .replace(/^const postfx=new PostFX.*$/m, 'const postfx={ok:false,enabled:false,setMood(){},render(){return false},setSize(){},apply(){return false}};')
  .replace(/^import[ \t].*$/gm, '')
  .replace(/^const V3=[^\n]*$/gm, '')
  .replace(/\$\('gl'\)/g, 'mkGlCanvas()')
  .replace(/\$\('[^']*'\)/g, 'null');
/* Anything the sliced region still calls that lives outside it: swallow it. */
const NOOPS = ['PostFX','buildMinimapPath', 'updateGriminess', 'initTunnel', 'updSkid', 'addSkid', 'clearSkids',
  'spawnParticles', 'sparkBurst', 'confetti', 'puff', 'smk', 'showToast', 'makeDamageSprite', 'accentFor', 'applyLivery', 'updateWeatherFX',
  'Speech', 'sfx', 'commentator', 'playSfx', 'state', 'audio', 'gyro', 'gyroLab', 'qualityMgr',
  'cam', 'director', 'cars', 'player', 'race', 'heli', 'weather', 'env', 'drivers'];
const STUB_SRC = 'function stub() { return ' + stub.toString().slice(stub.toString().indexOf('=>') + 2).trim() + '; }\n';
const wrapped = (STUB_SRC
  + NOOPS.map((n) => `var ${n}=stub();`).join('\n') + '\n'
  + srcTxt);
if (process.env.DUMP) fs.writeFileSync('/tmp/wrapped.js', wrapped);
let missing = new Set(), lastErr = null;
for (let attempt = 0; attempt < 30; attempt++) {
  const extra = [...missing].map((n) => `var ${n}=stub();`).join('\n');
  try {
    lastErr = null;
    new Function('THREE', 'tex', 'effQuality', 'TRACKS', 'V3', 'getComputedStyle', 'devicePixelRatio', 'QUALITY_PRESETS',
      wrapped.replace('globalThis.__out=', extra + '\nglobalThis.__out='))(THREE, tex, () => q, TRACKS, V3, () => ({ getPropertyValue: () => '12px' }), 1, QUALITY_PRESETS);
    break;
  } catch (e) {
    lastErr = e;
    const m = /(\w+) is not defined/.exec(String(e));
    if (m && !missing.has(m[1])) { missing.add(m[1]); continue; }
    break;
  }
}
if (lastErr) console.log(String(lastErr.stack).split('\n').slice(0,14).join('\n'));
const out = globalThis.__out;
if (!out) { console.log('preview build stopped early:', String(lastErr).split('\n').slice(0, 8).join('\n')); process.exit(1); }
const world = out.world, T = out.T, samples = out.samples;
const track = out.T.samples;
let trackMinY = Infinity, trackMaxY = -Infinity;
for (const sm of track) { trackMinY = Math.min(trackMinY, sm.p.y); trackMaxY = Math.max(trackMaxY, sm.p.y); }
console.log(`samples ${track.length} · road y ${trackMinY.toFixed(1)}..${trackMaxY.toFixed(1)} · len ${T.len ? T.len.toFixed(0) : '?'} m`);
let cx = 0, cz = 0; for (const sm of track) { cx += sm.p.x; cz += sm.p.z; } cx /= track.length; cz /= track.length;

/* ---------------- contact audit ---------------- */
/* Every object in the world is measured against the surface it should be
   standing on: tarmac if it sits inside the track corridor, the rendered
   heightfield everywhere else. Positive = floating, negative = buried. */
const H = (x, z) => T.terrainHeightAt(x, z);
const roadH = (x, z) => T.trueTrackHeightAt(x, z);
const box = new THREE.Box3();
const rows = [];
world.updateMatrixWorld(true);
const skip = new Set([T.hf && '__ground']);
let idx2 = 0;
world.children.forEach((o) => {
  if (o.isMesh || o.isInstancedMesh) audit(o);
});
function audit(o) {
  if (!o.isMesh && !o.isInstancedMesh) return;
  if (o.material === T.groundMat) return;               // the land itself
  // Meshes inside a group are positioned relative to something that is already
  // grounded (a flag on a post, a lamp on a gantry) — measuring them on their
  // own reports every fitting on a pole as "floating". Only world-level
  // objects get audited.
  if (o.parent && o.parent !== world) return;
  if (o.geometry?.type === 'PlaneGeometry' && o.scale.x > 500) return;  // horizon
  box.makeEmpty(); box.setFromObject(o);
  if (!isFinite(box.min.y)) return;
  const cxx = (box.min.x + box.max.x) / 2, czz = (box.min.z + box.max.z) / 2;
  // Honest contact test: a prop is grounded if SOME point of its base meets
  // the surface, and floating only if NONE of them do. A flood mast or a
  // grandstand has a wide footprint and the land is not level across it, so the
  // base is sampled all round and both the best and worst corner are reported.
  let near = { dist: 1e9 };
  const surfAt = (x, z) => (T.nearestTrackY(x, z).dist < T.latLimit ? roadH(x, z) : H(x, z));
  let hi = -1e9, lo = 1e9;
  for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
    const x = box.min.x + (box.max.x - box.min.x) * a / 2;
    const z = box.min.z + (box.max.z - box.min.z) * b / 2;
    const nd = T.nearestTrackY(x, z);
    if (nd.dist < near.dist) near = nd;
    const v = box.min.y - surfAt(x, z);
    if (v > hi) hi = v; if (v < lo) lo = v;
  }
  const surf = surfAt(cxx, czz);
  if (near.dist > T.latLimit + 260) return;              // out in the empty far land
  rows.push({ x: cxx, z: czz, y: box.min.y, top: box.max.y,
    name: (o.name || '') + (o.isInstancedMesh ? ' INST' + o.count : '') + ' ' +
      (o.geometry ? o.geometry.type.replace('BufferGeometry', '') : '?') + '#' + (idx2++) + ' p:' + (o.parent ? (o.parent.type + (o.parent.isGroup ? '(children ' + o.parent.children.length + ')' : '')) : 'none') +
      '@' + Math.round(cxx) + ',' + Math.round(czz) + ' h' + (box.max.y - box.min.y).toFixed(1),
    n: o.isInstancedMesh ? o.count : 1, isPlane: /Plane/.test(String(o.geometry?.type)), mounted: !!(o.userData && o.userData.mounted),
    float: lo, bury: -hi, lo, hi,
    y0: box.min.y, y1: box.max.y, h: box.max.y - box.min.y, surf, d: near.dist
  });
}
world.traverse((o)=>{ if(o.isGroup&&o.children.length===9){ console.log("GROUP9 at",o.position.x.toFixed(1),o.position.y.toFixed(2),o.position.z.toFixed(1),"yaws",(o.rotation.y*57.3).toFixed(0),"children:",o.children.map(c=>c.geometry.type+"("+c.position.x.toFixed(1)+","+c.position.y.toFixed(1)+","+c.position.z.toFixed(1)+"|"+c.scale.y+")").join(" ").slice(0,400)); } });
const lift = parseFloat((game.match(/\.mesh\.g\.position\.set\(c\.x,c\.y\+?([0-9.]*)?,c\.z\)/)||[])[1] ?? '0');
const skin = parseFloat((/const rep=Math\.max[\s\S]{0,300}?s\.p\.y\+([\d.]+)/.exec(game) || [])[1] || '0');
console.log(`\ncontact report — ${name} [${q}]`);
console.log(`  car: group lift +${lift} vs tarmac skin +${skin} → wheels ${(lift - skin) >= 0 ? 'float ' + (lift - skin).toFixed(3) : 'embed ' + (skin - lift).toFixed(3)} m ${
  (lift - skin) >= 0 ? 'ABOVE' : 'INTO'} the road surface`);
/* Only objects that plausibly TOUCH the ground are meaningful here: a flag on
   a 6 m marshal post or a gantry light bar is not "floating" just because its
   base is high in the air. A mesh counts as grounded if any corner of its base is within half a metre of
   the surface it stands on — everything else is mounted on a pole, a roof or a
   gantry and has no business touching the earth. */
/* Ground-standing = things that must meet the earth. Panels on poles (flags,
   gantry banners, lamp heads) are excluded by their userData.mounted tag or
   by being thin planes; a plane that is supposed to lie flat is a different
   matter and is still audited. */
/* Ground-standing = anything whose lowest point is supposed to meet the
   earth. Objects mounted on a pole (flags, gantry lamps, TV boxes on a
   marshal post) hang at their own height on purpose: they are attached to a
   support that is itself grounded, so measure the support instead. Anything
   taller than a metre is treated as mounted on something. */
const grounded = rows.filter((r) => r.hi > -0.5 && r.h < 1.0 && !r.isPlane);
/* …and if it is hanging in the air, is something solid underneath it holding
   it up? A camera box on a marshal post or a lamp on a gantry is fine; a
   billboard with nothing below it is not. */
for (const r of grounded) {
  r.supported = rows.some((o) => o !== r && Math.hypot(o.x - r.x, o.z - r.z) < 4
    && o.y <= r.y + 0.5 && o.top >= r.y - 0.5);
}
const unsupported = grounded.filter((r) => !r.supported);
console.log(`  ${rows.length} meshes in the world, ${grounded.length} of them reach the ground`);

const g = unsupported.slice().sort((a, b) => b.float - a.float);
for (const r of g.slice(0, 10)) console.log(`  base ${r.float.toFixed(2).padStart(6)} m above the ground at EVERY corner (best ${(-r.bury).toFixed(2)} m)  d=${r.d.toFixed(0)}  ${r.name}`);
const bad = unsupported.filter((r) => r.float > 0.4);
const sunk = grounded.filter((r) => r.bury > 0.6);
console.log(`  ${bad.length} of ${grounded.length} ground-standing objects floating > 0.4 m with nothing under them · ${sunk.length} sunk > 0.6 m`);
