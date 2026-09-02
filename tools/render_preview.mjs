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

/* ---------------- tiny rasteriser: flat-shaded triangles + z-buffer -------- */
const W = 1200, H = 680;
function render(cam, target, sunDir, timeOfDay) {
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const zbuf = new Float32Array(W * H).fill(-1e9);
  const img = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {                       // sky gradient backdrop
    const t = y / H, r = 0.16 + 0.42 * t, g = 0.36 + 0.42 * t, b = 0.72 - 0.20 * t;
    for (let x = 0; x < W; x++) { const k = (y * W + x) * 3; img[k] = r; img[k + 1] = g; img[k + 2] = b; }
  }
  const proj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  let tris = 0, meshes = 0;
  world.updateMatrixWorld(true);
  world.traverse((o) => {
    if (!o.isMesh || !o.geometry?.index || !o.geometry.attributes.position) return;
    const mtl = o.material;
    if (mtl?.transparent && (mtl.opacity ?? 1) < 0.35) return;
    const pa = o.geometry.attributes.position.array, ia = o.geometry.index.array;
    const base = new THREE.Color((mtl && mtl.color) ? mtl.color : 0x9a9a9a);
    const cArr = o.geometry.attributes.color?.array;
    o.updateMatrixWorld(true);
    const m4 = o.matrixWorld;
    meshes++;
    for (let k = 0; k + 2 < ia.length; k += 3) {
      const A = ia[k] * 3, B = ia[k + 1] * 3, C = ia[k + 2] * 3;
      va.set(pa[A], pa[A + 1], pa[A + 2]).applyMatrix4(m4);
      vb.set(pa[B], pa[B + 1], pa[B + 2]).applyMatrix4(m4);
      vc.set(pa[C], pa[C + 1], pa[C + 2]).applyMatrix4(m4);
      e1.copy(vb).sub(va); e2.copy(vc).sub(va); nn.crossVectors(e1, e2);
      if (nn.lengthSq() < 1e-12) continue;
      nn.normalize();
      if (nn.dot(va.clone().sub(camPos)) > 0) continue;                 // backface cull
      const sky = 0.30 + 0.22 * Math.max(0, nn.y);                       // cheap hemi fill
      const key = Math.max(0, nn.dot(sunDir));
      const light = sky + (0.86 * key + 0.16 * key * key) * (timeOfDay === 'night' ? 0.12 : 1);
      const ch = [base.r, base.g, base.b];
      const col = [0, 1, 2].map((j) => (cArr ? cArr[A + j] : ch[j]) * light);
      const p0 = va.clone().applyMatrix4(proj), p1 = vb.clone().applyMatrix4(proj), p2 = vc.clone().applyMatrix4(proj);
      const s0 = [(p0.x * 0.5 + 0.5) * W, (1 - (p0.y * 0.5 + 0.5)) * H, p0.z];
      const s1 = [(p1.x * 0.5 + 0.5) * W, (1 - (p1.y * 0.5 + 0.5)) * H, p1.z];
      const s2 = [(p2.x * 0.5 + 0.5) * W, (1 - (p2.y * 0.5 + 0.5)) * H, p2.z];
      if (![s0, s1, s2].every((s) => isFinite(s[0]) && isFinite(s[1]))) continue;
      const minx = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(s0[0], s1[0], s2[0])));
      const miny = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(s0[1], s1[1], s2[1])));
      if (maxx <= minx || maxy <= miny) continue;
      const den = (s1[1] - s2[1]) * (s0[0] - s2[0]) + (s2[0] - s1[0]) * (s0[1] - s2[1]);
      if (Math.abs(den) < 1e-9) continue;
      tris++;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((s1[1] - s2[1]) * (px - s2[0]) + (s2[0] - s1[0]) * (py - s2[1])) / den;
        const v = ((s2[1] - s0[1]) * (px - s2[0]) + (s0[0] - s2[0]) * (py - s2[1])) / den;
        const w2 = 1 - u - v;
        if (u < -0.003 || v < -0.003 || w2 < -0.003) continue;
        const z = u * s0[2] + v * s1[2] + w2 * s2[2];
        const id = y * W + x;
        if (z <= zbuf[id]) continue;
        zbuf[id] = z;
        const fog = Math.min(0.85, Math.max(0, (va.distanceTo(camPos) - 320) / 900));   // aerial haze
        const kk = id * 3;
        const sky0 = img[kk], sky1 = img[kk + 1], sky2 = img[kk + 2];
        img[kk] = col[0] * (1 - fog) + sky0 * fog;
        img[kk + 1] = col[1] * (1 - fog) + sky1 * fog;
        img[kk + 2] = col[2] * (1 - fog) + sky2 * fog;
      }
    }
  });
  fs.writeFileSync(target, encodePNG(img, W, H));
  console.log(`${path.basename(target)}: ${tris.toLocaleString()} tris / ${meshes} meshes`);
}
function crc32(buf) {
  const t = crc32.t || (crc32.t = (() => { const a = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; a[n] = c >>> 0; } return a; })());
  let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      const v = Math.max(0, Math.min(1, rgb[(y * w + x) * 3 + c]));
      raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(Math.pow(v, 1 / 2.2) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- cameras: one from the cockpit chase rail, one looking down the whole lap ---- */
const outDir = process.env.OUT || '/tmp/preview';
fs.mkdirSync(outDir, { recursive: true });
const slug = name.replace(/\W+/g, '');
const sun = new THREE.Vector3(0.42, 0.55, 0.25).normalize();
let bi = 0, bg = 0;
for (let i = 0; i < track.length; i++) {
  const a = track[i].p, b = track[(i + 8) % track.length].p;
  const g = Math.abs(b.y - a.y) / Math.max(1, a.distanceTo(b));
  if (g > bg) { bg = g; bi = i; }
}
const s = track[Math.round(track.length * 0.35) % track.length]; void bi;
{ /* a stand-in car, exactly where the game would put one, to judge contact */
  const g = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.8), new THREE.MeshStandardMaterial({ color: 0xff2d1f }));
  g.position.set(s.p.x, s.p.y + parseFloat((/g\.position\.set\(c\.x,c\.y\+?([\d.]*)?,c\.z\)/.exec(game) || [])[1] || '0') + 0.275, s.p.z);
  g.rotation.y = Math.atan2(s.t.x, s.t.z);
  g.castShadow = true; world.add(g);
}
const cam1 = new THREE.PerspectiveCamera(62, W / H, 0.5, 6000);
cam1.position.set(s.p.x - s.t.x * 9 + s.n.x * 2.8, s.p.y + 2.7, s.p.z - s.t.z * 9 + s.n.z * 2.8);
cam1.lookAt(s.p.x + s.t.x * 24, s.p.y + 0.9, s.p.z + s.t.z * 24);
render(cam1, `${outDir}/chase_${slug}.png`, sun, 'day');
const bb = new THREE.Box3().setFromObject(world);
const bc = bb.getCenter(new THREE.Vector3()), br = bb.getSize(new THREE.Vector3()).length() * 0.5;
const cam2 = new THREE.PerspectiveCamera(55, W / H, 0.5, 12000);
cam2.position.set(bc.x + br * 0.9, bc.y + br * 0.75, bc.z + br * 1.15);
cam2.lookAt(bc);
render(cam2, `${outDir}/wide_${slug}.png`, sun, 'day');
const s2 = track[(Math.round(track.length * 0.35) + 90) % track.length];
const cam3 = new THREE.PerspectiveCamera(68, W / H, 0.5, 6000);
cam3.position.set(s2.p.x - s2.n.x * 26, s2.p.y + 8, s2.p.z - s2.n.z * 26);
cam3.lookAt(s2.p.x, s2.p.y + 1.5, s2.p.z);
render(cam3, `${outDir}/side_${slug}.png`, sun, 'day');
/* optional close-up: FRAC=0.63 renders a high three-quarter view at that lap
   fraction — handy for checking a specific corner, water zone or banking */
if (process.env.FRAC) {
  const f = parseFloat(process.env.FRAC);
  const s4 = track[Math.round(track.length * f) % track.length];
  const cam4 = new THREE.PerspectiveCamera(58, W / H, 0.5, 6000);
  cam4.position.set(s4.p.x - s4.t.x * 40 - s4.n.x * 55, s4.p.y + 55, s4.p.z - s4.t.z * 40 - s4.n.z * 55);
  cam4.lookAt(s4.p.x + s4.t.x * 10, s4.p.y, s4.p.z + s4.t.z * 10);
  render(cam4, `${outDir}/spot_${slug}.png`, sun, 'day');
}
console.log(`${name}: relief ${((trackMaxY - trackMinY) || 0).toFixed(0)} m · steepest ${(bg * 100).toFixed(0)}% · ${world.children.length} top-level objects`);
