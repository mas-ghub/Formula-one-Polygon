// tools/ai_pace_calib.mjs — calibrate AI corner speed against the car's OWN
// physics instead of a magic constant.
//
// Why this exists: the AI used to brake for corners with  tv = sqrt(21/c),
// while the very same car's yaw authority is  cap = 46*grip/speed, i.e. a
// grip-limited corner speed of sqrt(46*grip/c). The two numbers never met, so
// AI cars crawled into every bend far below what the car can physically hold —
// "the AI really slows down on the bends" — and the live gap in the timing
// tower (derived from speed) drifted with it.
//
// This harness reproduces the game's track sampling (from the SAME
// public/data/circuits/*.json points the browser loads), the game's yaw and
// lateral-grip model, and the game's AI driver, then sweeps the corner-speed
// law so the replacement can be picked on measurements: lap time, the share
// of lap time spent crawling, and wall contacts.
//
//   node tools/ai_pace_calib.mjs                    (all default tracks, sweep)
//   LAW=grip TRACKS=Monza node tools/ai_pace_calib.mjs
import fs from 'fs';
import * as THREE from 'three';
import {TRACKS} from '../src/tracks.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const PH = {top: 79, eng: 20, brk: 26, drag: 0.00115};
const LAT = 46;                      // game.js: cap = 46*grip/v
const GLAT = 8.8;                    // game.js: vR *= exp(-8.8*grip*dt)
const G = 9.80665;

/* ---------- track sampling, same maths as buildWorld() ---------- */
function buildSamples(def, N = 840) {
  let pts;
  const key = def.openf1CircuitKey;
  const file = key ? 'public/data/circuits/' + key + '.json' : null;
  if (file && fs.existsSync(file)) pts = JSON.parse(fs.readFileSync(file, 'utf8')).map(p => V3(p[0], p[1] || 0, p[2]));
  else pts = def.pts.map(p => V3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const raw = curve.getSpacedPoints(N); raw.length = N;
  const samples = []; let len = 0;
  for (let i = 0; i < N; i++) {
    const p = raw[i], pn = raw[(i + 1) % N], pp = raw[(i - 1 + N) % N];
    const t = V3(pn.x - pp.x, pn.y - pp.y, pn.z - pp.z).normalize();
    samples.push({p, t, n: V3(t.z, 0, -t.x), curv: 0, v: 80, line: 0});
    len += raw[i].distanceTo(raw[(i + 1) % N]);
  }
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 1 + N) % N], c = samples[(i + 1) % N];
    const d = Math.atan2(c.t.x, c.t.z) - Math.atan2(a.t.x, a.t.z);
    samples[i].curv = Math.atan2(Math.sin(d), Math.cos(d)) / (len / N * 2);
  }
  for (let k = 0; k < 3; k++) for (let i = 0; i < N; i++)
    samples[i].curv = (samples[(i - 1 + N) % N].curv + samples[i].curv * 2 + samples[(i + 1) % N].curv) / 4;
  for (let k = 0; k < 2 * N; k++) { const i = (2 * N - 1 - k) % N, nj = (i + 1) % N;
    samples[i].v = Math.min(samples[i].v, Math.sqrt(samples[nj].v ** 2 + 2 * 23 * (len / N))); }
  for (let i = 0; i < N; i++) samples[i].line = clamp(samples[i].curv * 260, -4.2, 4.2);
  for (let k = 0; k < 3; k++) for (let i = 0; i < N; i++)
    samples[i].line = (samples[(i - 1 + N) % N].line + samples[i].line * 2 + samples[(i + 1) % N].line) / 4;
  const halfW = 7.0, runoffW = def.runoff !== undefined ? def.runoff : 6.5;
  return {samples, len, N, segLen: len / N, halfW, collideLat: halfW + runoffW * 0.66 - 0.45};
}

const smp = (T, f) => T.samples[((Math.floor(f) % T.N) + T.N) % T.N];

/* ---------- the car: game.js physics for real ---------- */
function step(c, T, dt, grip) {
  const base = 3.2 - 1.9 * clamp(Math.abs(c.vF) / PH.top, 0, 1);
  const cap = LAT * grip / Math.max(Math.abs(c.vF), 2);
  const yawF = clamp(0.4 + Math.abs(c.vF) / 3.8, 0.4, 1) * (c.vF < -0.5 ? -1 : 1);
  c.hdg -= c.steer * Math.min(base, cap) * yawF * dt;
  const fx = Math.sin(c.hdg), fz = Math.cos(c.hdg), rx = -fz, rz = fx;
  let vF = c.vx * fx + c.vz * fz, vR = c.vx * rx + c.vz * rz;
  let aF = 0;
  if (c.throttle > 0) aF += c.throttle * PH.eng * Math.max(0, 1 - Math.pow(clamp(vF / PH.top, 0, 1), 3));
  if (c.brake > 0) aF -= c.brake * PH.brk * grip;
  aF -= PH.drag * vF * Math.abs(vF) + vF * 0.045;
  vF += aF * dt;
  vR *= Math.exp(-GLAT * grip * dt);
  c.vx = fx * vF + rx * vR; c.vz = fz * vF + rz * vR;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.vRv = vR;
  // projectCar()
  let bi = c.ti, bd = 1e18;
  for (let k = -46; k <= 46; k++) { const i = ((c.ti + k) % T.N + T.N) % T.N;
    const p = T.samples[i].p, d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
    if (d < bd) { bd = d; bi = i; } }
  c.ti = ((bi % T.N) + T.N) % T.N;
  const s = T.samples[c.ti], dx = c.x - s.p.x, dz = c.z - s.p.z;
  c.f = (c.ti + (dx * s.t.x + dz * s.t.z) / T.segLen + T.N) % T.N;
  c.lat = dx * s.n.x + dz * s.n.z;
  if (Math.abs(c.lat) > T.collideLat) {
    const sgn = Math.sign(c.lat), over = Math.abs(c.lat) - T.collideLat;
    c.x -= s.n.x * sgn * over; c.z -= s.n.z * sgn * over; c.lat = sgn * T.collideLat;
    const vn = c.vx * s.n.x + c.vz * s.n.z;
    if (vn * sgn > 0) { c.vx -= s.n.x * vn * 1.3; c.vz -= s.n.z * vn * 1.3; c.vx *= 0.96; c.vz *= 0.96; c.walls++; }
  }
  c.vF = vF;
}

/* ---------- the AI driver from updAI, with the law under test ---------- */
function drive(c, T, cfg) {
  const fi = c.f, vF = c.vF;
  const s = smp(T, fi + 8);
  let latT = -s.line;
  if (vF < 14) latT = 0;
  const des = Math.atan2(s.p.x + s.n.x * latT - c.x, s.p.z + s.n.z * latT - c.z);
  const diff = wrapA(des - c.hdg);
  const dTerm = clamp((diff - c.pDiff) / 0.0083 * 0.05, -0.35, 0.35);
  c.pDiff = diff;
  c.steer = clamp(-diff * 2.7 - dTerm, -1, 1);
  let cmax = 0, sv = 1e9;
  const look = 6 + Math.floor(vF * 0.5);
  for (let k = 2; k < look; k += 3) {
    const i = ((Math.floor(fi) + k) % T.N + T.N) % T.N;
    cmax = Math.max(cmax, Math.abs(T.samples[i].curv));
    sv = Math.min(sv, T.samples[i].v);
  }
  const gripLimit = Math.sqrt(LAT * cfg.grip / Math.max(cmax, 1e-4));
  let tv;
  if (cfg.law === 'old') tv = Math.sqrt(21 / Math.max(cmax, 1e-4));
  else if (cfg.law === 'samples') tv = Math.min(gripLimit, sv);
  else tv = gripLimit;
  tv *= cfg.scale * (0.9 + 0.09 * cfg.skill) * cfg.diffMul;
  tv = Math.min(tv, PH.top * (0.86 + cfg.skill * 0.13));
  const dv = tv - vF;
  c.throttle = dv > 0.5 ? 1 : dv < -1.5 ? 0 : 0.45;
  c.brake = dv < -4 ? clamp(-dv * 0.14, 0, 1) : 0;
  c.tv = tv;
}

function run(T, cfg, laps = 2) {
  const s0 = T.samples[0];
  const c = {x: s0.p.x, z: s0.p.z, hdg: Math.atan2(s0.t.x, s0.t.z), vx: s0.t.x * 30, vz: s0.t.z * 30,
    vF: 30, vRv: 0, ti: 0, f: 0, lat: 0, steer: 0, throttle: 1, brake: 0, pDiff: 0, walls: 0, lap: 0};
  const dt = 1 / 120; let t = 0, prevF = 0, lapStart = 0, lapT = null;
  let crawl = 0, slow = 0, fast = 0, minV = 1e9, sumV = 0, n = 0, steerMax = 0, sat = 0;
  for (let i = 0; i < Math.round(600 / dt); i++) {
    drive(c, T, cfg); step(c, T, dt, cfg.grip);
    t += dt;
    const v = Math.abs(c.vF);
    sumV += v; n++; minV = Math.min(minV, v);
    if (v < 0.35 * PH.top) crawl += dt;
    if (v > 0.8 * PH.top) fast += dt;
    steerMax = Math.max(steerMax, Math.abs(c.steer));
    if (Math.abs(c.steer) > 0.98) sat += dt;
    if (prevF > T.N * 0.8 && c.f < T.N * 0.2 && i > 240) { c.lap++; if (c.lap === 1) lapStart = t; else { lapT = t - lapStart; break; } }
    prevF = c.f;
  }
  return {lapT, walls: c.walls, avgV: sumV / n, crawlFrac: crawl / t, fastFrac: fast / t, minV, steerMax, satFrac: sat / t};
}

const tracks = (process.env.TRACKS || 'Monza,Monaco,Silverstone,Suzuka,Spa-Francorchamps').split(',');
const laws = (process.env.LAWS || 'old,samples,grip').split(',');
const scales = (process.env.SCALES || '0.7,0.8,0.9,1.0').split(',').map(Number);
console.log('car grip limit: aLat<=' + LAT + ' m/s^2 (' + (LAT / G).toFixed(2) + ' G)   yaw cap=' + LAT + "*grip/v   lateral decay=" + GLAT + '*grip');
for (const name of tracks) {
  const def = TRACKS.find(t => t.name === name); if (!def) { console.log('!! unknown ' + name); continue; }
  const T = buildSamples(def);
  let cmax = 0, vLow = 1e9; for (const s of T.samples) { cmax = Math.max(cmax, Math.abs(s.curv)); vLow = Math.min(vLow, s.v); }
  console.log('\n' + name + '   lap length ' + T.len.toFixed(0) + ' m   tightest R ' + (1 / cmax).toFixed(0) + ' m   physics slowest point ' + (vLow * 3.6).toFixed(0) + ' km/h');
  for (const law of laws) for (const scale of scales) {
    const r = run(T, {law, scale, skill: Number(process.env.SKILL || 1), diffMul: Number(process.env.DIFF || 0.97), grip: Number(process.env.GRIP || 1)});
    const ref = T.len / (r.avgV || 1);
    console.log('  ' + law.padEnd(8) + ' x' + scale.toFixed(2) + ':  lap ' + (r.lapT ? r.lapT.toFixed(1) : ' -- ') + ' s   avg ' + (r.avgV * 3.6).toFixed(0) + ' km/h   crawling ' + (r.crawlFrac * 100).toFixed(0) + '%   fast ' + (r.fastFrac * 100).toFixed(0) + '%   min ' + (r.minV * 3.6).toFixed(0) + ' km/h   walls ' + r.walls + '   full-lock ' + (r.satFrac * 100).toFixed(0) + '%');
  }
}
