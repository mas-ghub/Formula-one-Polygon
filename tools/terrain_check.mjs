import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __ROOT__=path.dirname(path.dirname(fileURLToPath(import.meta.url)))+path.sep;
import * as THREE from '../node_modules/three/build/three.module.js';

const SRC = path.join(__ROOT__, 'src/game.js');
const game = fs.readFileSync(SRC, 'utf8');
const slice = (startRe, endRe, name) => {
  const a = game.search(startRe); if (a < 0) throw new Error('start ' + name);
  const rest = game.slice(a); const b = rest.search(endRe);
  if (b < 0) throw new Error('end ' + name);
  return rest.slice(0, b);
};
const helpers = game.split('\n').filter(l => /^(const clamp=|const lerp=|const smoothstep01=)/.test(l)).join('\n');
const hashBlock = slice(/const HASH_PAD=/, /const minTrackDist=/, 'hash');
const block = hashBlock + '\n' + slice(/\/\/ GROUND \/ TERRAIN/, /\/\/ 1\. Road Tarmac Ribbon/, 'terrain');

globalThis.THREE = THREE;
globalThis.document = { createElement: () => ({ style: {}, getContext: () => ({}) }), getElementById: () => null, body: { classList: { add() {}, remove() {} } } };
globalThis.window = { devicePixelRatio: 1, innerWidth: 1000, innerHeight: 800 };
const tex = { repeat: { set() {} }, anisotropy: 0 };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const TRACKS = (await import(new URL('../src/tracks.js', import.meta.url).href)).TRACKS;
const name = process.env.TRACK || 'Spa-Francorchamps';
const q = process.env.QUAL || 'HIGH';
const def = { ...TRACKS.find(t => t.name === name) };
const file = path.join(__ROOT__, 'public/data/circuits', `${def.openf1CircuitKey}.json`);
if (fs.existsSync(file)) def.realPts = JSON.parse(fs.readFileSync(file, 'utf8'));
const pts = def.realPts ? def.realPts.map(p => V3(p[0], p[1], p[2])) : def.pts.map(p => V3(p[0], 0, p[1]));
const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
const N = 840, raw = curve.getSpacedPoints(N); raw.length = N;
if (!def.realPts) { const ge = new Function('u', 'n', slice(/function getTrackElevation\(/m, /\/\/ Scenery \(trees/, 'elev') + '\nreturn getTrackElevation(u,n);'); for (let i = 0; i < N; i++) raw[i].y = ge(i / N, name); }
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
const fn = new Function('THREE', 'V3', 'effQuality', 'grassT', 'grassBumpT', 'world', 'T', 'samples', 'N', 'def', 'raw', 'trackMinY', 'trackMaxY', 'cx', 'cz', 'rad', 'halfW', 'wallDist', 'idx',
  `${helpers}\n${block}`);
const t0 = performance.now();
fn(THREE, V3, () => q, tex, tex, world, T, samples, N, def, raw, trackMinY, trackMaxY, cx, cz, rad, halfW, wallDist, def.openf1CircuitKey || 1);
const ms = performance.now() - t0;

const g = T.hf;
const meshes = world.children.filter(o => o.isMesh && o.geometry.attributes.normal && o.material === T.groundMat);
const tris = meshes.reduce((a, m) => a + m.geometry.index.count / 3, 0);
const verts = meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
console.log(`${name} [${q}] relief ${(trackMaxY - trackMinY).toFixed(0)} m · ${ms.toFixed(0)} ms · grid ${g.w}×${g.h} @ ${g.dx.toFixed(1)} m · ${verts.toLocaleString()} v / ${tris.toLocaleString()} t`);

// reference: the PREVIOUS terrain model (flat 50 m plane grid, constant 1.7 m
// clearance, no support raise) measured the same way
const oldNear = (x, z) => {
  let bestD2 = 1e18, bestY = trackMinY;
  for (let i = 0; i < N; i += 2) {
    const a = samples[i].p, b = samples[(i + 2) % N].p;
    const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / l2; t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestY = a.y + (b.y - a.y) * t; }
  }
  const dist = Math.sqrt(bestD2), nearR2 = T.latLimit + 9, farR2 = nearR2 + 430;
  const u = Math.max(0, Math.min(1, (dist - nearR2) / (farR2 - nearR2))), sm = u * u * (3 - 2 * u);
  return bestY - 1.7 + (trackMinY - 4 - (bestY - 1.7)) * sm;
};
const gs = Math.max(4600, rad * 2.4), cell = gs / 92;
const oldGrid = (x, z) => {
  const i0 = Math.floor((x - cx) / cell), j0 = Math.floor((z - cz) / cell);
  const x0 = cx + i0 * cell, z0 = cz + j0 * cell;
  const tx = Math.max(0, Math.min(1, (x - x0) / cell)), tz = Math.max(0, Math.min(1, (z - z0) / cell));
  const a = oldNear(x0, z0), b = oldNear(x0 + cell, z0), c = oldNear(x0, z0 + cell), d = oldNear(x0 + cell, z0 + cell);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
};
const measure = (H) => {
  let fl = 0, rise = 0, ownMax = -9, sum = 0, n = 0;
  for (let i = 0; i < N; i += 2) {
    const s = samples[i];
    const f = s.p.y - H(s.p.x, s.p.z); sum += f; n++;
    if (f > fl) fl = f;
    for (const lat of [0, halfW, halfW + 1.4, wallDist, T.latLimit, T.latLimit + 8]) for (const sg of [1, -1]) {
      const x = s.p.x + s.n.x * lat * sg, z = s.p.z + s.n.z * lat * sg;
      const r = H(x, z) - T.trueTrackHeightAt(x, z);
      if (r > rise) rise = r;
    }
  }
  return { fl, rise, ownMax, mean: sum / n };
};
const O = measure(oldGrid);
let float = 0, floatAt = null, rise = 0, ownMax = -9, steps = 0, maxStep = 0;
for (let i = 0; i < N; i++) {
  const s = samples[i];
  const f = s.p.y - T.terrainHeightAt(s.p.x, s.p.z);
  if (f > float) { float = f; floatAt = { x: s.p.x, z: s.p.z, y: s.p.y }; }
  for (const lat of [0, halfW, halfW + 1.4, wallDist, T.latLimit, T.latLimit + 8]) for (const sg of [1, -1]) {
    const x = s.p.x + s.n.x * lat * sg, z = s.p.z + s.n.z * lat * sg;
    const r = T.terrainHeightAt(x, z) - T.trueTrackHeightAt(x, z);
    if (r > rise) rise = r;
    const cl2 = 0.9 + 1.3 * Math.min(1, Math.max(0, (T.nearestTrackY(x, z).dist - T.latLimit) / Math.max(1, wallDist - T.latLimit)));
    const own2 = T.terrainHeightAt(x, z) - (T.trueTrackHeightAt(x, z) - cl2);
    if (own2 > ownMax) ownMax = own2;
  }
}
// rendered-mesh check: no grid node that lies inside a road's own corridor may
// sit above that road, and no road sample may sit more than its clearance above
// the grid node beneath it.
let buriedCount = 0, buriedMax = 0, atB = null;
{
  let buried = 0, buriedMax = 0, at = null;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const k = j * g.w + i;
    if (g.data[k] < -1e8) continue;
    const x = g.x0 + g.dx * i, z = g.z0 + g.dz * j;
    // skip a covered section: the ground over a tunnel IS the hill, by design
    const tp = i / g.w, tq = j / g.h;
    if (def.tunnel) { let inTun = false; for (let q2 = 0; q2 < N; q2 += 4) { const t = q2 / N; if (t < def.tunnel.from || t > def.tunnel.to) continue; const sp = samples[q2].p; if (Math.hypot(sp.x - x, sp.z - z) < wallDist) inTun = true; } if (inTun) continue; }
    // the stretch that owns this cell — the one whose bed the terrain is
    // built from — is the only one a heightfield can honour, so that is the
    // ribbon a "burial" has to be measured against
    const r = T.nearestTrackY(x, z);
    if (r.dist > wallDist) continue;
    const over = g.data[k] - r.y;
    if (over > 0.05) {
     let tt = 0, bd = 1e9; for (let q4 = 0; q4 < N; q4 += 2) { const sp2 = samples[q4].p; const dd2 = Math.hypot(sp2.x - x, sp2.z - z); if (dd2 < bd) { bd = dd2; tt = q4 / N; } }
     if (def.tunnel && tt > def.tunnel.from - 0.01 && tt < def.tunnel.to + 0.01) continue;
     }
    if (over > 0.05) { buried++; if (over > buriedMax) { buriedMax = over; at = [x, z, r.dist, r.y, g.data[k], T.trueTrackHeightAt(x, z)]; } }
  }
  buriedCount = buried; buriedMax = buriedMax; atB = at;
  console.log(`  mesh nodes burying a road: ${buried} (max ${buriedMax.toFixed(2)} m)${at ? ' at ' + at.map(v => v.toFixed(1)).join(' / ') : ''}`);
}
for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
  const k = j * g.w + i, v = g.data[k];
  if (i + 1 < g.w) { const d = Math.abs(v - g.data[k + 1]) / g.dx; if (d > maxStep) maxStep = d; if (d > 1.1) steps++; }
  if (j + 1 < g.h) { const d = Math.abs(v - g.data[k + g.w]) / g.dz; if (d > maxStep) maxStep = d; if (d > 1.1) steps++; }
}
let inv = 0, nan = 0;
for (const m of meshes) {
  const pa = m.geometry.attributes.position.array, ia = m.geometry.index.array;
  for (let k = 0; k < ia.length; k += 3) {
    const a = ia[k] * 3, b = ia[k + 1] * 3, c = ia[k + 2] * 3;
    const crY = (pa[b + 2] - pa[a + 2]) * (pa[c] - pa[b]) - (pa[b] - pa[a]) * (pa[c + 2] - pa[b + 2]);
    if (crY < -1e-6) inv++;
  }
  for (let k = 0; k < pa.length; k++) if (!isFinite(pa[k])) nan++;
}
// mean gap along the centreline, and a rough "how much of the lap looks like it
// is on a ramp" figure: fraction of samples where the ground under the road is
// more than 3 m low
let sum = 0, over3 = 0;
for (let i = 0; i < N; i += 2) { const s = samples[i]; const d = s.p.y - T.terrainHeightAt(s.p.x, s.p.z); sum += d; if (d > 3) over3++; }
const NN = measure(T.terrainHeightAt);
console.log(`  float   max ${float.toFixed(2)} m · ground above the bed it chose ${ownMax.toFixed(2)} m · mean ${(sum / (N / 2)).toFixed(2)} m · samples>3m: ${over3} · grass above own road ${(rise > 0 ? rise.toFixed(2) : '0.00')} m`);
console.log(`  (old)   max ${O.fl.toFixed(2)} m · mean ${O.mean.toFixed(2)} m · grass above own road ${O.rise > 0 ? O.rise.toFixed(2) : '0.00'} m`);
console.log(`  verdict: float ${NN.fl <= O.fl ? 'BETTER' : 'worse'} · burial ${NN.rise <= O.rise ? 'BETTER' : 'worse'} (smaller is better for float; burial only happens at genuine overcrossings on both)`);
console.log(`  steep node pairs ${steps} (max grade ${(maxStep * 100).toFixed(0)}%) · inverted tris ${inv} · NaN ${nan}`);
console.log(`SUMMARY float=${float.toFixed(2)} mean=${(sum/(N/2)).toFixed(2)} over3=${over3} buried=${buriedCount} bmax=${buriedMax.toFixed(2)} steep=${steps} grade=${(maxStep*100).toFixed(0)} inv=${inv} nan=${nan} ms=${ms.toFixed(0)} tris=${tris} cell=${T.hf.dx.toFixed(1)} grid=${T.hf.w}x${T.hf.h}`);
if (process.env.WORST && floatAt) {
  console.log(`  worst float at (${floatAt.x.toFixed(0)},${floatAt.z.toFixed(0)}) roadY ${floatAt.y.toFixed(2)}`);
  let bd = 1e9, by = 0;
  for (let q5 = 0; q5 < N; q5++) { const sp = samples[q5].p; const d = Math.hypot(sp.x - floatAt.x, sp.z - floatAt.z); if (d < bd) { bd = d; by = sp.y; } }
  const gph = T.hf; const gi = Math.round((floatAt.x - gph.x0) / gph.dx), gj = Math.round((floatAt.z - gph.z0) / gph.dz);
  console.log(`   nearest sample to it: d ${bd.toFixed(1)} m roadY ${by.toFixed(2)} (float there ${(by - T.terrainHeightAt(samples[0].p.x, samples[0].p.z)).toFixed(2)}); node neighbours y: ${[[-1,0],[0,0],[1,0],[0,-1],[0,1]].map(([a,b]) => gph.data[(gj+b)*gph.w+gi+a].toFixed(1)).join(' ')}`);
  for (let q6 = 0; q6 < N; q6 += 4) { const sp = samples[q6].p; const d = Math.hypot(sp.x - floatAt.x, sp.z - floatAt.z); if (d < 26) console.log(`     lap ${q6} d=${d.toFixed(1)} roadY=${sp.y.toFixed(1)}`); }
 }
