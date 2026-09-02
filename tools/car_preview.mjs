// tools/car_preview.mjs — render makeCarMesh() in isolation with a scanline
// z-buffer rasteriser and write PNGs, so the new model detail can be *seen*
// headlessly instead of guessed at from code review.
//   node tools/car_preview.mjs          -> /tmp/car/*.png + geometry report
import fs from 'fs';
import zlib from 'zlib';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const lerp = (a, b, t) => a + (b - a) * t;

const src = fs.readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
const cut = (a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('anchor missing: ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('end missing: ' + b);
  return src.slice(i, j);
};
// Take the car-model code verbatim from the game so what is rendered is what
// ships: materials + geometry builders + driver + assembly.
const SRC = [
  "const clamp=(v,a,b)=>v<a?a:v>b?b:v;",
  cut('function ctex(c,rep){', 'function part(geo,color,x,y,z'),
  cut('function part(geo,color,x,y,z', 'let axleGeo=null, brakeGeo=null;'),
  cut('let axleGeo=null, brakeGeo=null;', 'function makeCarMesh'),
  cut('function makeCarMesh', '/* ============ particles'),
  "\nreturn{makeCarMesh,makeDriverMesh};",
].join('\n').replace(/^export /gm, '');
// Canvas texture painting cannot run headlessly, so the two texture-painting
// blocks are dropped and their entry points stubbed with a line of stub code.
// Every line of GEOMETRY code (part/noseGeo/getBodyGeo/getAxleGeo/driver/
// makeCarMesh) is taken verbatim from src/game.js and left untouched.
const drop = (txt, from, to) => {
  const i0 = txt.indexOf(from), i1 = txt.indexOf(to, i0);
  if (i0 < 0 || i1 < 0) throw new Error('cut anchors not found: ' + from);
  const ls = txt.lastIndexOf('\n', i0);
  return txt.slice(0, ls + 1) + "const " + from + " " + txt.slice(i1 + to.length);
};
let SRC2 = SRC.replace(/^export /gm, '');
// asphalt/grass/tyre/wall/canvas helpers  ==>  drop up to the stub of ctex
SRC2 = SRC2.slice(0, SRC2.indexOf('const[ac,ag]=mkCanvas')) +
  "const ac=null,ag=null,gc=null,gg=null,cc=null,cg=null,glc=null,glg=null,wtc=null,wtg=null,tyc=null,tyg=null,bc=null,bgc=null,kc=null,kg=null,pc=null,pg=null;" +
  "const grassT=null,grassBumpT=null,tyreT=null,softT=null;\n" +
  "function numTex(){return null;}\nfunction bannerTex(){return null;}\nfunction makeDamageSprite(){return new THREE.Group();}\n" +
  SRC2.slice(SRC2.indexOf('function tint(geo,color'));
SRC2 = "const rand=(a,b)=>a+(b-a)*0.5;\n" +
  "const matStub=(o)=>new THREE.MeshStandardMaterial(Object.assign({vertexColors:true,flatShading:true},o||{}));\nconst matBody=matStub();const matWheel=matStub();const woodLegMat=matStub();\n" +
  SRC2;
const noop = () => {};
const fakeCtx = new Proxy({}, {get: () => noop, set: () => true, has: () => true});
const fakeDoc = {createElement: () => ({width: 0, height: 0, getContext: () => fakeCtx})};
const mod = new Function('THREE', 'mergeGeometries', 'lerp', 'renderer', 'document', SRC2
)(THREE, mergeGeometries, (a, b, t) => a + (b - a) * t, {capabilities: {getMaxAnisotropy: () => 1}}, fakeDoc);

const car = mod.makeCarMesh({colA: '#3a7ec8', colB: '#e8eef4', helmet: '#e8eef4', num: 44});
car.g.add(mod.makeDriverMesh(0x20486c,0xe8eef4).driverGroup);
car.g.updateMatrixWorld(true);

/* ---- geometry report ---- */
let tris = 0, meshes = 0;
const box = new THREE.Box3();
const isFx = o => !!(o.userData && o.userData.fx);   // headlight beams are not bodywork
car.g.traverse(o => {
  if (!o.isMesh || isFx(o)) return;
  meshes++;
  const g = o.geometry;
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  box.expandByObject(o);
});
console.log('car meshes: ' + meshes + '  triangles: ' + Math.round(tris));
console.log('bbox  x:[' + box.min.x.toFixed(2) + ',' + box.max.x.toFixed(2) + ']  y:[' + box.min.y.toFixed(2) + ',' + box.max.y.toFixed(2) + ']  z:[' + box.min.z.toFixed(2) + ',' + box.max.z.toFixed(2) + ']');
const H = new THREE.Box3().setFromObject(car.helmetGroup);
console.log('helmet bbox y:[' + H.min.y.toFixed(2) + ',' + H.max.y.toFixed(2) + ']  z:[' + H.min.z.toFixed(2) + ',' + H.max.z.toFixed(2) + ']');
console.log('extras: brakes=' + !!car.brakes + ' steering=' + !!car.steering + ' driverGroup=' + !!car.driverGroup);
// clearance between the helmet crown and the hoop above it, measured by raycast
const ray = new THREE.Raycaster();
const c0 = new THREE.Vector3((H.min.x + H.max.x) / 2, H.max.y + 0.01, (H.min.z + H.max.z) / 2);
car.g.updateMatrixWorld(true);
ray.set(new THREE.Vector3(c0.x, c0.y, 0.30), new THREE.Vector3(0, 1, 0)); ray.far = 4;
const hits = ray.intersectObject(car.body, true).filter(h => h.distance > 0.001);
console.log('hoop above crown: ' + (hits.length ? hits[0].distance.toFixed(3) + ' m of clearance' : 'NOTHING ABOVE (open)'));
// is the hoop a closed curve? count hoop material fragments above the cockpit
const over = (() => { let n = 0; for (let z = -0.4; z <= 0.6; z += 0.2) for (const x of [-0.62, -0.3, 0, 0.3, 0.62]) { ray.set(new THREE.Vector3(x, 0.9, z), new THREE.Vector3(0, -1, 0)); ray.far = 1.2; if (ray.intersectObject(car.body, true).length) n++; } return n; })();
console.log('halo sample hits over the cockpit (z -0.4..0.6): ' + over + '/35 (a half hoop scores low, a real closed hoop high)');

/* ---- rasteriser ---- */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const idat = zlib.deflateSync(raw, {level: 6});
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([t, data])) : 0); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const LIGHT = new THREE.Vector3(-0.45, 0.72, 0.52).normalize();
const LIGHT2 = new THREE.Vector3(0.7, 0.25, -0.6).normalize();
function render(camPos, lookAt, fov, W, Hd, bgTop, bgBot) {
  const fwd = lookAt.clone().sub(camPos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const f = (Hd * 0.5) / Math.tan(fov * Math.PI / 360);
  const rgb = Buffer.alloc(W * Hd * 3), zb = new Float64Array(W * Hd).fill(Infinity);
  for (let y = 0; y < Hd; y++) { const t = y / Hd; const r = Math.round(lerp(bgTop[0], bgBot[0], t)), g = Math.round(lerp(bgTop[1], bgBot[1], t)), b = Math.round(lerp(bgTop[2], bgBot[2], t)); for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; } }
  const trisAll = [];
  car.g.traverse(o => {
    if (!o.isMesh || isFx(o)) return;
    const g = o.geometry, pos = g.attributes.position, col = g.attributes.color, idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k += 3) {
      const v = [0, 1, 2].map(j => (idx ? idx.getX(k + j) : k + j));
      const P = v.map(j => new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j)).applyMatrix4(o.matrixWorld));
      trisAll.push({P, n: new THREE.Vector3().crossVectors(P[1].clone().sub(P[0]), P[2].clone().sub(P[0])).normalize(), c: col ? [0, 1, 2].map(j => [col.getX(j), col.getY(j), col.getZ(j)]) : [[.6, .6, .6], [.6, .6, .6], [.6, .6, .6]]});
    }
  });
  for (const t of trisAll) {
    const sc = t.P.map(P => {
      const d = P.clone().sub(camPos); const z = d.dot(fwd);
      return {x: (d.dot(right) / Math.max(0.05, z)) * f + W / 2, y: Hd / 2 - (d.dot(up) / Math.max(0.05, z)) * f, z};
    });
    if (sc.some(s => !isFinite(s.z) || s.z <= 0.05)) continue;
    const minx = Math.max(0, Math.floor(Math.min(...sc.map(s => s.x)))), maxx = Math.min(W - 1, Math.ceil(Math.max(...sc.map(s => s.x))));
    const miny = Math.max(0, Math.floor(Math.min(...sc.map(s => s.y)))), maxy = Math.min(Hd - 1, Math.ceil(Math.max(...sc.map(s => s.y))));
    const e = (a, b, px, py) => (px - a.x) * (b.y - a.y) - (py - a.y) * (b.x - a.x);
    const d2 = (px, py) => { const vx = sc[1].x - sc[0].x, vy = sc[1].y - sc[0].y, wx = px - sc[0].x, wy = py - sc[0].y, cx = sc[2].x - sc[0].x, cy = sc[2].y - sc[0].y; const den = vx * cy - vy * cx; if (Math.abs(den) < 1e-9) return [-1, -1, -1]; const u = (wx * cy - wy * cx) / den; return [1 - u - (wy - u * cy) / vy || 0, u, 0]; };
    void d2; void e;
    const faceLight = 0.30 + 0.78 * Math.max(0, t.n.dot(LIGHT)) + 0.22 * Math.max(0, t.n.dot(LIGHT2));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const cx2 = px + 0.5, cy2 = py + 0.5;
      const cr=(ax,ay,bx,by)=>ax*by-ay*bx;
      const ar2=cr(sc[1].x-sc[0].x,sc[1].y-sc[0].y,sc[2].x-sc[0].x,sc[2].y-sc[0].y);
      if(Math.abs(ar2)<1e-9) continue;
      const g0=cr(sc[1].x-cx2,sc[1].y-cy2,sc[2].x-cx2,sc[2].y-cy2)/ar2;
      const g1=cr(sc[2].x-cx2,sc[2].y-cy2,sc[0].x-cx2,sc[0].y-cy2)/ar2;
      const g2=1-g0-g1;
      if(g0<0||g1<0||g2<0) continue;
      const i0=py*W+px, zz=sc[0].z*g0+sc[1].z*g1+sc[2].z;
      if(zz>=zb[i0]) continue; zb[i0]=zz;
      const nn=t.n.clone(); if(nn.dot(fwd)>0) nn.negate();   // light both windings
      const spec=Math.pow(Math.max(0,nn.dot(LIGHT.clone().add(fwd).normalize())),14)*0.55;
      const shade=(0.40+0.86*Math.max(0,nn.dot(LIGHT))+0.20*Math.max(0,nn.dot(LIGHT2))+spec)
                 *(0.88+0.12*(g0*g0+g1*g1+g2*g2)*1.5);
      const c=[0,1,2].map(ci=>{const v=Math.min(1,shade*(t.c[0][ci]*g0+t.c[1][ci]*g1+t.c[2][ci]*g2));return Math.round(255*(v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055));});
      const i=i0*3; rgb[i]=c[0]; rgb[i+1]=c[1]; rgb[i+2]=c[2];
    }
  }
  return rgb;
}
const OUT = process.env.OUT || '/tmp/car';
fs.mkdirSync(OUT, { recursive: true });
const A = new THREE.Vector3(0, 0.45, 0.05);
const views = [
  ['side', new THREE.Vector3(-6.4, 1.5, 0.15), 22],
  ['front34', new THREE.Vector3(-4.3, 2.1, 5.0), 22],
  ['rear34', new THREE.Vector3(4.1, 2.0, -5.0), 22],
  ['halo_top', new THREE.Vector3(0.35, 4.0, 3.3), 18],
];
const W = Number(process.env.W || 900), Hd = Number(process.env.HD || 420);
for (const [name, cp, fov] of views) {
  const rgb = render(cp, A, fov, W, Hd, [36, 44, 58], [14, 16, 22]);
  fs.writeFileSync(`${OUT}/${name}.png`, png(W, Hd, rgb));
}
console.log('wrote ' + views.map(v => v[0] + '.png').join(', ') + ' to ' + OUT);
