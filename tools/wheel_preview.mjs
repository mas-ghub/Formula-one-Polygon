// tools/wheel_preview.mjs — rasterise getAxleGeo() headlessly to PNGs so the
// bevelled shoulders + tread blocks can be *seen* rather than guessed.
//   node tools/wheel_preview.mjs
import fs from 'fs';
import zlib from 'zlib';
import * as THREE from 'three';
import { getAxleGeo } from '../src/carGeometry.js';

const geo = getAxleGeo();
geo.computeBoundingBox();
let tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
console.log('axle triangles: ' + Math.round(tris) + '  verts: ' + geo.attributes.position.count);

/* ---- software rasteriser (flat lambert-ish shading, vertex colours) ---- */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const LIGHT = new THREE.Vector3(-0.4, 0.6, 0.7).normalize();
const LIGHT2 = new THREE.Vector3(0.7, 0.4, -0.2).normalize();

function render(camPos, lookAt, fov, W, H) {
  const pos = geo.attributes.position, col = geo.attributes.color, idx = geo.index;
  const n = idx ? idx.count : pos.count;
  // pre-transform triangles to world (identity matrix — geometry is in place)
  const trisArr = [];
  for (let k = 0; k < n; k += 3) {
    const v = [0, 1, 2].map(j => (idx ? idx.getX(k + j) : k + j));
    const P = v.map(j => new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j)));
    const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
    const N = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const C = col ? [0, 1, 2].map(j => new THREE.Color().fromBufferAttribute(col, v[j])) : [new THREE.Color(0x808080), new THREE.Color(0x808080), new THREE.Color(0x808080)];
    trisArr.push({ P, N, C });
  }
  const fwd = lookAt.clone().sub(camPos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const f = (H * 0.5) / Math.tan(fov * Math.PI / 360);
  const rgb = Buffer.alloc(W * H * 3), zb = new Float64Array(W * H).fill(Infinity);
  for (let i = 0; i < trisArr.length; i++) {
    const { P, N, C } = trisArr[i];
    const sc = P.map(P => { const d = P.clone().sub(camPos); const z = d.dot(fwd); return { x: (d.dot(right) / Math.max(0.05, z)) * f + W / 2, y: H / 2 - (d.dot(up) / Math.max(0.05, z)) * f, z }; });
    if (sc.some(s => !isFinite(s.z) || s.z <= 0.05)) continue;
    const minx = Math.max(0, Math.floor(Math.min(...sc.map(s => s.x)))), maxx = Math.min(W - 1, Math.ceil(Math.max(...sc.map(s => s.x))));
    const miny = Math.max(0, Math.floor(Math.min(...sc.map(s => s.y)))), maxy = Math.min(H - 1, Math.ceil(Math.max(...sc.map(s => s.y))));
    const ar2 = (sc[1].x - sc[0].x) * (sc[2].y - sc[0].y) - (sc[1].y - sc[0].y) * (sc[2].x - sc[0].x);
    if (Math.abs(ar2) < 1e-9) continue;
    let nn = N; if (nn.dot(fwd) > 0) nn = N.clone().negate();
    const shade = 0.45 + 0.62 * Math.max(0, nn.dot(LIGHT)) + 0.18 * Math.max(0, nn.dot(LIGHT2));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      const g0 = ((sc[1].x - cx) * (sc[2].y - cy) - (sc[1].y - cy) * (sc[2].x - cx)) / ar2;
      const g1 = ((sc[2].x - cx) * (sc[0].y - cy) - (sc[2].y - cy) * (sc[0].x - cx)) / ar2;
      const g2 = 1 - g0 - g1;
      if (g0 < 0 || g1 < 0 || g2 < 0) continue;
      const z = sc[0].z * g0 + sc[1].z * g1 + sc[2].z * g2;
      const i0 = py * W + px;
      if (z >= zb[i0]) continue; zb[i0] = z;
      const r = C[0].r * g0 + C[1].r * g1 + C[2].r * g2;
      const g = C[0].g * g0 + C[1].g * g1 + C[2].g * g2;
      const b = C[0].b * g0 + C[1].b * g1 + C[2].b * g2;
      const i = i0 * 3;
      rgb[i] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, r * shade), 1 / 2.2)));
      rgb[i + 1] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, g * shade), 1 / 2.2)));
      rgb[i + 2] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, b * shade), 1 / 2.2)));
    }
  }
  return rgb;
}

const OUT = process.env.OUT || '/tmp/wheel';
fs.mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W || 700), H = Number(process.env.H || 700);
const views = [
  // down the axle — the wheel's circular face (rim, spokes, bevel edge)
  ['face', new THREE.Vector3(2.4, 0.1, 0), new THREE.Vector3(0, 0, 0), 38],
  // side-on — both wheels edge-on (tread profile, bevel shoulder, blocks)
  ['side', new THREE.Vector3(0, 0.1, 2.2), new THREE.Vector3(0, 0, 0), 38],
  // three-quarter — shoulder roll + tread blocks wrapping the corner
  ['threeq', new THREE.Vector3(1.5, 1.1, 1.6), new THREE.Vector3(0, 0, 0), 38],
];
for (const [name, cp, look, fov] of views) {
  const rgb = render(cp, look, fov, W, H);
  fs.writeFileSync(`${OUT}/${name}.png`, png(W, H, rgb));
  console.log('wrote ' + OUT + '/' + name + '.png');
}
