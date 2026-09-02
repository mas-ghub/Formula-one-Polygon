/* Scene audit: builds the real world for a track (same code path as the game)
   and reports, per object, how far its lowest point sits off the surface it
   should be standing on. Anything with a positive "float" is a hovering
   prop/mesh; anything strongly negative is buried. */
import fs from 'fs';
import * as THREE from '/home/user/Formula-one-Polygon/node_modules/three/build/three.module.js';

const ROOT = '/home/user/Formula-one-Polygon';
const SRC = ROOT + '/src/game.js';
const game = fs.readFileSync(SRC, 'utf8');
const slice = (a, b) => { const i = game.search(a); const r = game.slice(i); const j = r.search(b); return r.slice(0, j); };
const helpers = game.split('\n').filter(l => /^(const clamp=|const lerp=|const smoothstep01=|const effQuality=)/.test(l)).join('\n');
const hashBlock = slice(/const HASH_PAD=/, /const minTrackDist=/);
const block = hashBlock + '\n' + slice(/\/\/ GROUND \/ TERRAIN/, /\/\/ 1\. Road Tarmac Ribbon/);

globalThis.THREE = THREE;
globalThis.document = { createElement: () => ({ style: {}, getContext: () => ({}) }), getElementById: () => null, body: { classList: { add() {}, remove() {} } } };
globalThis.window = { devicePixelRatio: 1, innerWidth: 1000, innerHeight: 800 };
const tex = { repeat: { set() {} }, anisotropy: 0 };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TRACKS = (await import(SRC.replace('game.js', 'tracks.js'))).TRACKS;
const name = process.env.TRACK || 'Spa-Francorchamps';
const q = process.env.QUAL || 'HIGH';
const def = { ...TRACKS.find(t => t.name === name) };
const file = `${ROOT}/public/data/circuits/${def.openf1CircuitKey}.json`;
if (fs.existsSync(file)) def.realPts = JSON.parse(fs.readFileSync(file, 'utf8'));
const pts = def.realPts ? def.realPts.map(p => V3(p[0], p[1], p[2])) : def.pts.map(p => V3(p[0], 0, p[1]));
const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
const N = 840, raw = curve.getSpacedPoints(N); raw.length = N;
if (!def.realPts) {
  const ge = new Function('u', 'n', slice(/function getTrackElevation\(/m, /\/\/ Scenery \(trees/) + '\nreturn getTrackElevation(u,n);');
  for (let i = 0; i < N; i++) raw[i].y = ge(i / N, name);
}
let trackMinY = Infinity, trackMaxY = -Infinity, len = 0; const samples = [];
for (let i = 0; i < N; i++) { trackMinY = Math.min(trackMinY, raw[i].y); trackMaxY = Math.max(trackMaxY, raw[i].y); }
for (let i = 0; i < N; i++) {
  const p = raw[i], pn = raw[(i + 1) % N], pp = raw[(i - 1 + N) % N];
  const t = V3(pn.x - pp.x, pn.y - pp.y, pn.z - pp.z).normalize();
  samples.push({ p, t, n: V3(t.z, 0, -t.x), curv: 0, cum: len }); len += raw[i].distanceTo(raw[(i + 1) % N]);
}
let cx = 0, cz = 0; for (const s of samples) { cx += s.p.x; cz += s.p.z; } cx /= N; cz /= N;
let rad = 0; for (const s of samples) rad = Math.max(rad, Math.hypot(s.p.x - cx, s.p.z - cz)); rad += 180;
const halfW = 7.0, runoffW = def.runoff !== undefined ? def.runoff : 6.5, wallDist = halfW + runoffW * 0.66;
const T = { N, def, samples, len, halfW, segLen: len / N, canopyMats: [], flags: [], tvCams: [], lampMats: [], latLimit: wallDist + 0.25 };
const world = new THREE.Group();
new Function('THREE', 'effQuality', 'grassT', 'grassBumpT', 'world', 'T', 'samples', 'N', 'def', 'raw', 'trackMinY', 'trackMaxY', 'cx', 'cz', 'rad', 'halfW', 'wallDist', 'idx',
  `${helpers}\nconst V3=(x,y,z)=>new THREE.Vector3(x,y,z);\n${block}`)(THREE, () => q, tex, tex, world, T, samples, N, def, raw, trackMinY, trackMaxY, cx, cz, rad, halfW, wallDist, def.openf1CircuitKey || 1);

// Ground height under a point, from the very grid that is rendered.
const H = (x, z) => T.terrainHeightAt(x, z);
const roadH = (x, z) => T.trueTrackHeightAt(x, z);
const box = new THREE.Box3();
const rows = [];
world.updateMatrixWorld(true);
for (const o of world.children) {
  if (!o.isMesh && !o.isInstancedMesh) continue;
  if (o === T.groundMesh) continue;
  const isGround = o.material === T.groundMat;
  box.makeEmpty(); box.setFromObject(o);
  if (!isFinite(box.min.y)) continue;
  if (isGround) { rows.push({ name: 'GROUND', n: 1, float: 0, bury: 0, y0: box.min.y, y1: box.max.y, ground: true }); continue; }
  // sample the surface under the object's footprint
  const cxx = (box.min.x + box.max.x) / 2, czz = (box.min.z + box.max.z) / 2;
  const near = T.nearestTrackY(cxx, czz);
  const surf = near.dist < wallDist + 2 ? roadH(cxx, czz) : H(cxx, czz);
  rows.push({
    name: (o.name || o.material?.type || o.geometry?.type) + '@' + Math.round(cxx) + ',' + Math.round(czz),
    n: o.isInstancedMesh ? o.count : 1, float: box.min.y - surf, bury: surf - box.max.y,
    y0: box.min.y, y1: box.max.y
  });
}
// cars: the same contact test the renderer uses
const CAR_LIFT = parseFloat(/g\.position\.set\(c\.x,c\.y\+([\d.]+),c\.z\)/.exec(game)?.[1] ?? '0');
const WHEEL_R = parseFloat(/CylinderGeometry\(0\.37,0\.37,0\.34/.test(game) ? '0.37' : '0.34');
{
  // wheels sit at y=+WHEEL_R inside the group, so their contact point is the
  // group origin; the group origin is placed c.y+CAR_LIFT above the tarmac,
  // and the tarmac skin itself is drawn +0.05 over the centreline.
  const contact = CAR_LIFT - 0.05;
  console.log(`CAR: group lift +${CAR_LIFT} vs tarmac skin +0.05 → wheels ${contact >= 0 ? 'float ' + contact.toFixed(3) + ' m ABOVE' : 'embed ' + (-contact).toFixed(3) + ' m INTO'} the road`);
}
console.log(`\n${name} [${q}] — object contact audit (positive = floating above the surface it stands on)`);
const g = rows.filter(r => !r.ground).sort((a, b) => Math.abs(b.float) - Math.abs(a.float));
for (const r of g.slice(0, 14)) console.log(`  float ${r.float.toFixed(2).padStart(7)} m  ${r.name}`);
const bad = g.filter(r => r.float > 0.35 || r.float < -1.2);
console.log(`  ${bad.length} of ${g.length} objects off their footing by >0.35 m`);
for (const r of rows) if (r.ground) console.log(`  ground mesh y ${r.y0.toFixed(1)} … ${r.y1.toFixed(1)} (road ${trackMinY.toFixed(1)} … ${trackMaxY.toFixed(1)})`);
