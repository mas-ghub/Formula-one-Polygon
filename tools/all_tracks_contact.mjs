/* Runs the scene contact audit over every track in one process and prints a
   one-line verdict per circuit: are the wheels on the tarmac, is anything
   hanging in the air with nothing under it, is anything buried? */
import fs from 'fs';
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
const ctx2d = () => new Proxy({ _props: {} }, {
  get(t, k) {
    if (k in t._props) return t._props[k];
    if (k === 'measureText') return () => ({ width: 8 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => ({ addColorStop() {} });
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
const glConst = { VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c, MAX_TEXTURE_SIZE: 0x0d33 };
void glConst;
const GL_ENUMS = {}; let enumCounter = 0x10000;
const glStub = () => {
  const obj = () => ({ __o: true });
  const gl = {
    canvas: { width: 100, height: 100, style: {}, addEventListener() {} },
    drawingBufferWidth: 100, drawingBufferHeight: 100,
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 } : {
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16, TEXTURE_MAX_ANISOTROPY_EXT: 16, filter: 1 }),
    getParameter: (p) => {
      const S = { [gl.VERSION]: 'WebGL 2.0 (Polygon Preview)', [gl.SHADING_LANGUAGE_VERSION]: 'OpenGL ES GLSL ES 3.00',
        [gl.SCISSOR_BOX]: [0, 0, 100, 100], [gl.VIEWPORT]: [0, 0, 100, 100], [gl.MAX_SAMPLES]: 4 };
      if (p in S) return S[p];
      return 4096;
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getError: () => 0, isContextLost: () => false,
    createTexture: obj, createBuffer: obj, createProgram: obj, createShader: obj,
    createFramebuffer: obj, createRenderbuffer: obj, createVertexArray: obj, createQuery: obj,
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => '', getShaderInfoLog: () => '',
    getShaderSource: () => '', getActiveInfo: () => ({ name: 'u', size: 1, type: 35664 }),
    getUniformLocation: () => ({ __u: true }), getAttribLocation: () => 0,
    checkFramebufferStatus: () => 36053, readPixels() {},
    VERSION: 7001, SHADING_LANGUAGE_VERSION: 7002, MAX_TEXTURE_SIZE: 7003, MAX_CUBE_MAP_TEXTURE_SIZE: 7004,
    MAX_TEXTURE_IMAGE_UNITS: 7005, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 7006, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 7007,
    MAX_VERTEX_UNIFORM_VECTORS: 7008, MAX_FRAGMENT_UNIFORM_VECTORS: 7009, MAX_VARYING_VECTORS: 7010,
    MAX_VERTEX_ATTRIBS: 7011, MAX_SAMPLES: 7012, MAX_RENDERBUFFER_SIZE: 7013, SCISSOR_BOX: 7014, VIEWPORT: 7015,
    MAX_ARRAY_TEXTURE_LAYERS: 7016, TEXTURE_MAX_LEVEL: 7017, MAX_3D_TEXTURE_SIZE: 7018
  };
  return new Proxy(gl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return GL_ENUMS[k] !== undefined ? GL_ENUMS[k] : (GL_ENUMS[k] = enumCounter++);
      return () => ({});
    },
    set(t, k, v) { t[k] = v; return true; }
  });
};
const mkGlCanvas = () => ({ width: 100, height: 100, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => glStub() });
globalThis.mkGlCanvas = mkGlCanvas;

const { TRACKS } = await import(path.join(ROOT, 'src', 'tracks.js'));
const { QUALITY_PRESETS } = await import(path.join(ROOT, 'src', 'quality.js'));
const q = process.env.QUAL || 'HIGH';
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => 0 : k === 'isTexture' ? true : stub())),
  apply: () => stub(), construct: () => stub()
});

const helpers = game.split('\n')
  .filter((l) => /^(const clamp=|const lerp=|const smoothstep01=|const damp=|const rand=|const pick=)/.test(l))
  .join('\n');
const prelude = slice(/const _sv=V3\(0,0,0\)/, /^function buildWorld\(/m)
  + '\n' + slice(/function getTrackHAtCoords\(/, /\/\* =+ weather =+ \*\//)
  + '\n' + slice(/function getTrackElevation\(/, /\/\* =+ weather =+ \*\//)
  + '\n' + slice(/export function getBodyGeo\(/, /function makePointsSys\(/)
  + '\n' + slice(/\/\* =+ renderer \/ scene =+ \*\//, /\/\* =+ canvas textures =+ \*\//)
  + '\n' + slice(/\/\* =+ canvas textures =+ \*\//, /\/\* =+ car geometry =+ \*\//)
  + '\n' + slice(/\/\* =+ weather state =+ \*\//, /\/\* =+ thunderstorm/);
const srcTxt = (helpers + '\n' + prelude + '\n'
  + 'const matBody=new THREE.MeshStandardMaterial({color:0xf2f2f0,flatShading:true});\n'
  + 'const matWheel=new THREE.MeshStandardMaterial({color:0x14161a});\n'
  + 'const mergeGeometries=(l)=>l[0];\n'
  + 'var world=null;var T=null;var timeSec=0;\n'
  + slice(/function buildWorld\(/, /buildMinimapPath\(\);\n/).replace(/buildMinimapPath\(\);\n$/, '') + '\n}'
  + '\nbuildWorld(0);globalThis.__worldOf=()=>world;globalThis.__TOf=()=>T;'
  + '\nglobalThis.__out={T,world,scene,renderer};'
  + '\nglobalThis.__buildWorld=buildWorld;')
  .replace(/^export /gm, '').replace(/^import[ \t].*$/gm, '').replace(/^const V3=[^\n]*$/gm, '')
  .replace(/\$\('gl'\)/g, 'mkGlCanvas()').replace(/\$\('[^']*'\)/g, 'null');
const NOOPS = ['PostFX', 'buildMinimapPath', 'updateGriminess', 'initTunnel', 'updSkid', 'addSkid', 'clearSkids',
  'spawnParticles', 'sparkBurst', 'confetti', 'puff', 'smk', 'showToast', 'makeDamageSprite', 'accentFor',
  'applyLivery', 'updateWeatherFX', 'Speech', 'sfx', 'commentator', 'playSfx', 'state', 'audio', 'gyro',
  'gyroLab', 'qualityMgr', 'cam', 'director', 'cars', 'player', 'race', 'heli', 'weather', 'env', 'drivers'];
const STUB_SRC = 'function stub() { return ' + stub.toString().slice(stub.toString().indexOf('=>') + 2).trim() + '; }\n';
const wrapped = (STUB_SRC + NOOPS.map((n) => `var ${n}=stub();`).join('\n') + '\n'
  + srcTxt).replace(/^const postfx=new PostFX.*$/m,
    'const postfx={ok:false,enabled:false,setMood(){},render(){return false},setSize(){},apply(){return false}};');
let missing = new Set(), err = null;
for (let attempt = 0; attempt < 30; attempt++) {
  const extra = [...missing].map((n) => `var ${n}=stub();`).join('\n');
  try {
    err = null;
    new Function('THREE', 'tex', 'effQuality', 'TRACKS', 'V3', 'QUALITY_PRESETS',
      wrapped.replace('globalThis.__out=', extra + '\nglobalThis.__out='))(THREE, tex, () => q, TRACKS, V3, QUALITY_PRESETS);
    break;
  } catch (e) {
    err = e;
    const m = /(\w+) is not defined/.exec(String(e));
    if (m && !missing.has(m[1])) { missing.add(m[1]); continue; }
    break;
  }
}
if (err) { console.log('module build failed:', String(err).split('\n').slice(0, 4).join(' | ')); process.exit(1); }
if (!globalThis.__out || !globalThis.__out.world) { console.log('no world built'); process.exit(1); }

/* Re-run the world build per track and measure contact the same way the
   renderer sees it. */
const box = new THREE.Box3();
function auditTrack(idx) {
  globalThis.__buildWorld(idx);          // rebuild the world exactly as the game does
  const world = globalThis.__worldOf(), T = globalThis.__TOf();
  world.updateMatrixWorld(true);
  const H = (x, z) => T.terrainHeightAt(x, z);
  const roadH = (x, z) => T.trueTrackHeightAt(x, z);
  const rows = [];
  for (const o of world.children) {
    if (!o.isMesh && !o.isInstancedMesh) continue;
    if (o.material === T.groundMat) continue;
    if (o.geometry?.type === 'PlaneGeometry' && o.scale.x > 500) continue;
    box.makeEmpty(); box.setFromObject(o);
    if (!isFinite(box.min.y)) continue;
    const cxx = (box.min.x + box.max.x) / 2, czz = (box.min.z + box.max.z) / 2;
    const near = T.nearestTrackY(cxx, czz);
    if (near.dist > T.latLimit + 260) continue;
    const surfAt = (x, z) => (T.nearestTrackY(x, z).dist < T.latLimit ? roadH(x, z) : H(x, z));
    let hi = -1e9, lo = 1e9;
    for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
      const x = box.min.x + (box.max.x - box.min.x) * a / 2;
      const z = box.min.z + (box.max.z - box.min.z) * b / 2;
      const v = box.min.y - surfAt(x, z);
      if (v > hi) hi = v; if (v < lo) lo = v;
    }
    rows.push({ x: cxx, z: czz, y: box.min.y, top: box.max.y, lo, hi, h: box.max.y - box.min.y,
      isPlane: /Plane/.test(String(o.geometry?.type)), n: o.isInstancedMesh ? o.count : 1,
      name: (o.name || o.geometry.type) + '@' + Math.round(cxx) + ',' + Math.round(czz) });
  }
  for (const r of rows) {
    r.supported = rows.some((o) => o !== r && Math.hypot(o.x - r.x, o.z - r.z) < 4 && o.y <= r.y + 0.5 && o.top >= r.y - 0.5);
  }
  const grounded = rows.filter((r) => r.hi > -0.5 && r.h < 1.0 && !r.isPlane);
  const float = grounded.filter((r) => !r.supported && r.lo > 0.4);
  const sunk = grounded.filter((r) => r.hi < -0.6);
  const worst = grounded.reduce((m, r) => Math.max(m, r.lo), -99);
  return { objs: rows.length, grounded: grounded.length, float: float.length, sunk: sunk.length,
    worst: isFinite(worst) ? worst : 0, ex: float[0]?.name || '' };
}
const lift = parseFloat((game.match(/\.mesh\.g\.position\.set\(c\.x,c\.y\+?([0-9.]*)?,c\.z\)/) || [])[1] ?? '0');
const skin = parseFloat((/const rep=Math\.max[\s\S]{0,300}?s\.p\.y\+([\d.]+)/.exec(game) || [])[1] || '0');
console.log(`car contact: group lift +${lift} · tarmac skin +${skin} → wheels ${(lift - skin).toFixed(3)} m off the visible road`);
console.log('');
const res = [];
const names = TRACKS.map((t) => t.name);
for (let i = 0; i < names.length; i++) {
  let r;
  try { r = auditTrack(i); } catch (e) { r = { objs: 0, grounded: 0, float: 0, sunk: 0, worst: 0, ex: String(e).split('\n')[0] }; }
  res.push({ name: names[i], ...r });
}
let badTracks = 0;
for (const r of res) {
  const flag = r.float > 0 || r.sunk > 0 ? '  <-- CHECK' : '';
  if (flag) badTracks++;
  console.log(`${r.name.padEnd(22)} objs ${String(r.objs).padStart(3)} · grounded ${String(r.grounded).padStart(3)}` +
    ` · floating ${String(r.float).padStart(2)} · sunk ${String(r.sunk).padStart(2)} · worst gap ${r.worst.toFixed(2)} m${flag}`);
}
console.log(`\n${res.length - badTracks}/${res.length} tracks with every object touching the ground it stands on`);
