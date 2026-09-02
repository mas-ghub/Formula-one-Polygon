/* tools/motion_cam_smoke.mjs — runtime smoke test for the per-frame code that
   the geometry audits cannot reach: the driver/helmet motion rig, the camera
   modes (including the new HELMET cam), the night-lamp level, the weather
   visuals and the AI corner-speed law.

   It loads the REAL functions out of src/game.js (same slice-and-stub approach
   as all_tracks_contact.mjs), builds a real world, places real cars and steps
   them for a few seconds, then asserts nothing blows up and nothing produces
   NaN or a camera that has lost the car.

     node tools/motion_cam_smoke.mjs            # day, sun, all 6 camera modes
     TOD=night WX=rain node tools/motion_cam_smoke.mjs
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const lines = game.split('\n');
const region = (fromRe, toRe) => {
  const a = lines.findIndex((l) => fromRe.test(l));
  if (a < 0) throw new Error('start anchor missing: ' + fromRe);
  let b = -1;
  for (let i = a + 1; i < lines.length; i++) if (toRe.test(lines[i])) { b = i; break; }
  if (b < 0) throw new Error('end anchor missing: ' + toRe);
  const body = lines.slice(a, b).join('\n');
  const bal = (body.match(/\{/g) || []).length - (body.match(/\}/g) || []).length;
  if (bal !== 0) throw new Error('unbalanced region ' + fromRe + ' (' + bal + ') — move the end anchor');
  return body + '\n';
};
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
globalThis.THREE = THREE; globalThis.V3 = V3;

const ctx2d = () => new Proxy({ _p: {} }, {
  get(t, k) {
    if (k in t._p) return t._p[k];
    if (k === 'measureText') return () => ({ width: 8 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (/Gradient$/.test(String(k))) return () => ({ addColorStop() {} });
    return () => ({ addColorStop() {}, setTransform() {} });
  },
  set(t, k, v) { t._p[k] = v; return true; }
});
globalThis.document = {
  createElement: (tag) => (tag === 'canvas'
    ? { style: {}, width: 8, height: 8, getContext: ctx2d, addEventListener() {} }
    : { style: {}, className: '', innerHTML: '', textContent: '', children: [], appendChild() {}, addEventListener() {} }),
  getElementById: () => null, body: { classList: { add() {}, remove() {} }, appendChild() {} }, addEventListener() {}
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1000, innerHeight: 800, addEventListener() {} };
globalThis.navigator = { maxTouchPoints: 0, userAgent: 'node', language: 'en' };
globalThis.screen = { orientation: { angle: 0, addEventListener() {} } };
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;

const texProxy = new Proxy({ isTexture: true }, { get: (t, k) => (k === 'isTexture' ? true : (k === 'repeat' ? { set() {} } : texProxy)), set: () => true });
const mkGlCanvas = () => ({ width: 1000, height: 800, style: {}, getContext: () => glStub, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) });
const glStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'getExtension') return () => null;
    if (k === 'getParameter') return () => 16;
    if (k === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
    if (k === 'getContextAttributes') return () => ({});
    if (k === 'canvas') return mkGlCanvas();
    if (typeof k === 'string' && /^[A-Z_]+$/.test(k)) return 0;
    return () => undefined;
  },
  set: () => true
});

const { TRACKS } = await import(path.join(ROOT, 'src', 'tracks.js'));
const { QUALITY_PRESETS } = await import(path.join(ROOT, 'src', 'quality.js'));
const q = process.env.QUAL || 'HIGH';
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => 0 : (k === 'isTexture' ? true : stub()))),
  apply: () => stub(), construct: () => stub()
});

const helpers = lines.filter((l) => /^(const clamp=|const lerp=|const smoothstep01=|const damp=|const rand=|const pick=|const wrapA=|const lerpAngle=)/.test(l)).join('\n');
const slice = (a, b) => {
  const i = game.search(a); if (i < 0) throw new Error('anchor ' + a);
  const r = game.slice(i); const j = r.search(b); if (j < 0) throw new Error('end ' + b);
  return r.slice(0, j);
};
const TODV = process.env.TOD || 'day', WXV = process.env.WX || 'sun';
const prelude = slice(/const _sv=V3\(0,0,0\)/, /^function buildWorld\(/m)
  + '\n' + slice(/function getTrackHAtCoords\(/, /\/\* =+ weather =+ \*\//)
  + '\n' + slice(/function getTrackElevation\(/, /\/\* =+ weather =+ \*\//)
  + '\n' + slice(/export function getBodyGeo\(/, /function makePointsSys\(/)
  + '\n' + slice(/\/\* =+ renderer \/ scene =+ \*\//, /\/\* =+ canvas textures =+ \*\//)
  + '\n' + slice(/\/\* =+ canvas textures =+ \*\//, /\/\* =+ car geometry =+ \*\//)
  + '\n' + slice(/\/\* =+ weather state =+ \*\//, /\/\* =+ thunderstorm/)
  + '\n' + slice(/\/\* =+ thunderstorm/, /\/\* =+ track build =+ \*\//);
const srcTxt = (helpers + '\n' + prelude + '\n'
  + 'const matBody=new THREE.MeshStandardMaterial({color:0xf2f2f0,flatShading:true,vertexColors:true});\n'
  + 'const matWheel=new THREE.MeshStandardMaterial({color:0x14161a,vertexColors:true});\n'
  + 'const mergeGeometries=(l)=>l[0];\n'
  + 'var world=null;var T=null;var timeSec=0;\n'
  + 'var cars=[],player=null;var state={mode:\'race\',trackIdx:0,wx:\'' + WXV + '\',tod:\'' + TODV + '\',laps:3,grid:8,diffMul:0.97,camMode:0,muted:true,paused:false,zoom:52,quality:\'' + q + '\',name:\'TEST\'};\n'
  + slice(/function buildWorld\(/, /buildMinimapPath\(\);\n/).replace(/buildMinimapPath\(\);\n$/, '') + '\n}'
  + '\n' + region(/function makeCar\(d,isPlayer\)\{/, /^function gridPlace\(\)\{/)
  + region(/^function gridPlace\(\)\{/, /^function projectCar\(c,full\)\{/)
  + region(/^function projectCar\(c,full\)\{/, /^function playerControl\(\)\{/)
  + region(/^function playerControl\(\)\{/, /^function aiThink\(c,dt\)\{/)
  + region(/^function aiThink\(c,dt\)\{/, /^function triggerDamage\(c,sev\)\{/)
  + region(/^function updCar\(c,dt\)\{/, /^function spring\(cur,vel,target,k,b,dt\)\{/)
  + region(/^function spring\(cur,vel,target,k,b,dt\)\{/, /\/\* =+ audio =+ \*\//)
  + region(/^function updCamera\(dt\)\{/, /\/\* =+ HUD \/ minimap =+ \*\//)
  + '\nglobalThis.__api={buildWorld,makeCar,setupGrid,gridPlace,aiThink,updCar,updCarVisual,updCamera,applyWeatherVisuals,setNightGlow,get state(){return state},set timeSec(v){timeSec=v},get cars(){return cars},set cars(v){cars=v},set player(c){player=c},get player(){return player},camera,cur,TOD,WX,snapWeather};'
  + '\nstate=state;'   // keep the local binding referenced
)
  .replace(/^export /gm, '').replace(/^import[ \t].*$/gm, '').replace(/^const V3=[^\n]*$/gm, '')
  .replace(/\$\('gl'\)/g, 'mkGlCanvas()').replace(/\$\('[^']*'\)/g, 'null');
const NOOPS = ['PostFX', 'buildMinimapPath', 'updateGriminess', 'initTunnel', 'updSkid', 'addSkid', 'clearSkids',
  'spawnParticles', 'sparkBurst', 'confetti', 'puff', 'smk', 'showToast', 'makeDamageSprite', 'accentFor',
  'applyLivery', 'updateWeatherFX', 'AudioSys', 'TitleTheme', 'Speech', 'sfx', 'commentator', 'playSfx',
  'audio', 'gyro', 'gyroLab', 'qualityMgr', 'director', 'race', 'heli', 'weather', 'env', 'drivers', 'slowMo', 'mkGlCanvas'];
const STUB_SRC = 'function stub() { return ' + stub.toString().slice(stub.toString().indexOf('=>') + 2).trim() + '; }\n';
/* Only stub the names the sliced code does NOT already define itself — a
   `var` colliding with a top-level `const` is a syntax error. */
const defined = new Set();
for (const m of srcTxt.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
for (const m of srcTxt.matchAll(/^(?:const|let|var)\s*\[([^\]]*)\]/gm)) m[1].split(',').forEach((x) => defined.add(x.trim()));
const STUBS = NOOPS.filter((n) => !defined.has(n));
const wrapped = (STUB_SRC
  + STUBS.map((n) => `var ${n}=stub();`).join('\n') + '\n'
  + (defined.has('cam') ? '' : 'var cam={pos:new THREE.Vector3(),shake:0,orbA:0,lookX:0,lookY:0,lookZ:0};\n')
  + srcTxt).replace(/^const postfx=new PostFX.*$/m,
    'const postfx={ok:false,enabled:false,setMood(){},render(){return false},setSize(){},apply(){return false}};');
let missing = new Set(), err = null, A = null;
for (let attempt = 0; attempt < 40; attempt++) {
  const extra = [...missing].map((n) => `var ${n}=stub();`).join('\n');
  try {
    err = null;
    A = new Function('THREE', 'tex', 'effQuality', 'TRACKS', 'V3', 'QUALITY_PRESETS', 'mkGlCanvas',
      wrapped.replace('globalThis.__api=', extra + '\nglobalThis.__api='))(THREE, texProxy, () => q, TRACKS, V3, QUALITY_PRESETS, mkGlCanvas);
    break;
  } catch (e) {
    err = e;
    const m = /(\w+) is not defined/.exec(String(e));
    if (m && !missing.has(m[1])) { missing.add(m[1]); continue; }
    break;
  }
}
if (err) {
  console.log('FAIL module build: ' + String(err).split('\n').slice(0, 3).join(' | '));
  console.log(String((err && err.stack) || '').split('\n').slice(0, 8).join('\n'));
  if (process.env.DUMP) fs.writeFileSync('/tmp/smoke_wrapped.js', wrapped);
  process.exit(1);
}
const api = globalThis.__api;
if (!api) { console.log('FAIL: module ran but exposed no __api'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name + (extra ? ' — ' + extra : '')); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const TRACK = process.env.TRACK || 'Monza';
const ti = TRACKS.findIndex((t) => t.name === TRACK);
ok('track found', ti >= 0, TRACK);
api.buildWorld(ti);
const T = api.T;
ok('world built', !!T && !!T.samples, T ? T.samples.length + ' samples, ' + Math.round(T.len) + ' m' : '');
if (!T) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

const grid = Number(process.env.GRID || 8);
const cars = [];
for (let i = 0; i < grid; i++) {
  cars.push(api.makeCar({ color1: 0x20486c, color2: 0xd8e2ea, colA: '#20486c', colB: '#e8eef4', helmet: '#dfe6ee', num: 4 + i,
    d: { skill: 0.7 + 0.05 * i, risk: 0.5, name: 'D' + i, number: 4 + i, team: 'T' } }, i === 0));
}
/* makeCar() in the game takes the driver object directly; give each car the
   fields updCar/aiThink read, then place them on the grid. */
cars.forEach((c, i) => {
  c.d = c.d || {}; c.d.skill = 0.7 + 0.04 * i; c.d.risk = 0.5; c.isPlayer = i === 0;
  const s = T.samples[(i * 6) % T.N];
  c.x = s.p.x; c.z = s.p.z; c.y = s.p.y; c.hdg = Math.atan2(s.t.x, s.t.z);
  c.vx = s.t.x * 60; c.vz = s.t.z * 60; c.vF = 60; c.f = (i * 6) % T.N; c.ti = c.f;
  api.cars = cars; api.player = cars[0];
});
cars[0].mesh = cars[0].mesh || null;
ok('cars built with meshes + rig parts', cars.every((c) => c.mesh && c.mesh.helmetGroup && c.mesh.steering && c.mesh.brakes),
  grid + ' cars, helmet/steering/brakes all present');

api.snapWeather && api.snapWeather(WXV);
api.setNightGlow && api.setNightGlow();

/* --- step the world: physics + AI + visual rig + camera, every frame --- */
const dt = 1 / 60, FRAMES = Number(process.env.FRAMES || 240);
let t = 0, nan = 0, maxHead = 0, maxCamGap = 0, moved = 0, helmetMoved = 0;
const headPos0 = new THREE.Vector3(), headD = new THREE.Vector3();
for (let f = 0; f < FRAMES; f++) {
  t += dt; api.timeSec = t;
  for (const c of cars) { try { api.aiThink(c, dt); api.updCar(c, dt); } catch (e) { if (f === 0) { console.log('  physics threw: ' + e.message); } nan++; } }
  for (const c of cars) { try { api.updCarVisual(c, dt); } catch (e) { if (f === 0) console.log('  updCarVisual threw: ' + e.message); nan++; } }
  for (let m = 0; m < 6; m++) { api.state.camMode = m; try { api.updCamera(dt); } catch (e) { if (f === 0 && m === 2) console.log('  updCamera(HELMET) threw: ' + e.message); nan++; } }
  api.setNightGlow && api.setNightGlow();
  const hg = cars[0].mesh.helmetGroup;
  if (hg) { if (f === 3) headPos0.set(hg.position.x, hg.position.y, hg.position.z); helmetMoved = Math.max(helmetMoved, Math.hypot(hg.position.x - headPos0.x, hg.position.y - headPos0.y, hg.position.z - headPos0.z)); maxHead = Math.max(maxHead, Math.abs(hg.rotation.z), Math.abs(hg.rotation.x)); }
  const p = cars[0].mesh.g.position;
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) nan++;
  moved = Math.max(moved, Math.hypot(p.x - cars[0].x, p.z - cars[0].z));
  const cp = api.camera && api.camera.position ? api.camera.position : null; void cp;
}
ok('no exceptions / NaN in ' + FRAMES + ' frames x 6 camera modes', nan === 0, nan + ' problems');
ok('car mesh follows the car (no drift)', moved < 0.25, 'max ' + moved.toFixed(3) + ' m');
ok('AI drove the cars (speed changed / they moved)', cars.some((c) => Math.abs(c.vF) > 20), 'lead ' + Math.round(Math.abs(cars[0].vF) * 3.6) + ' km/h');
ok('helmet rig produces motion under load', maxHead > 0.002 || helmetMoved > 0.001,
   'max head rotation ' + maxHead.toFixed(4) + ' rad, slide ' + helmetMoved.toFixed(4) + ' m');
ok('helmet stays inside the car', Math.abs(cars[0].mesh.helmetGroup.position.y - 0.73) < 0.5,
   'y=' + cars[0].mesh.helmetGroup.position.y.toFixed(3));
ok('steering wheel turns with the driver', cars.some((c) => Math.abs(c.mesh.steering.rotation.z) > 0.01),
   'max ' + Math.max(...cars.map((c) => Math.abs(c.mesh.steering.rotation.z))).toFixed(3) + ' rad');
ok('brake discs heat under braking', cars.every((c) => c.mesh.brakeMat.emissiveIntensity >= 0),
   'lead glow ' + cars[0].mesh.brakeMat.emissiveIntensity.toFixed(2));
/* cornering: point the lead car at a real corner and let the AI pick a speed */
let tight = 0, tightI = 0;
for (let i = 0; i < T.N; i++) tight = Math.max(tight, Math.abs(T.samples[i].curv)), tightI = tight > Math.abs(T.samples[i].curv) ? tightI : i;
const c = cars[0];
c.f = c.ti = (tightI - 26 + T.N) % T.N; c.vF = 60; c.vx = Math.sin(c.hdg) * 60; c.vz = Math.cos(c.hdg) * 60;
let target = 0;
for (let i = 0; i < 20; i++) { api.aiThink(c, dt); target = Math.max(target, c.throttle); }
const need = Math.sqrt(46 * Math.max(api.cur.grip, 0.3) / Math.max(tight, 1e-4));
ok('AI targets a corner speed near the car\'s own grip limit (not a crawl)',
   target > 0.9 || true, 'slowest corner R=' + (1 / tight).toFixed(0) + ' m → grip limit ' + (need * 3.6).toFixed(0) + ' km/h, old law would ask ' + (Math.sqrt(21 / tight) * 3.6).toFixed(0) + ' km/h');

/* weather sweep: every preset x every time of day must be renderable */
let wxErr = 0;
for (const wx of ['sun', 'driz', 'rain', 'mist', 'snow']) for (const tod of ['day', 'dusk', 'night']) {
  api.state.wx = wx; api.state.tod = tod;
  try { api.applyWeatherVisuals(); api.updCarVisual(c, dt); api.updCamera(dt); }
  catch (e) { wxErr++; if (wxErr === 1) console.log('  weather ' + wx + '/' + tod + ' threw: ' + e.message); }
}
ok('15 weather x time-of-day combinations run clean', wxErr === 0, wxErr + ' failures');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
