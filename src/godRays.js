/* ============ God rays — crepuscular shafts over the circuit ============
   The user has never SEEN a god ray in this app, so this is built to be
   impossible to miss on a clear golden hour and still discoverable at noon
   — while staying cheap enough to keep: a single InstancedMesh of tapered,
   slanted shafts anchored beside the road (grandstands, trees, buildings
   are the implied blockers), one draw call, one tiny shader.

   Each anchor is a beam that runs from above the scenery down along the
   sun direction, its plane pivoted about the beam axis to face the camera
   (cylindrical billboard), so it reads as a volume, not a sprite. The
   whole set breathes with a slow moving band along each beam, and a
   noise-varying brightness per instance keeps it organic.

   Visibility is driven from game.js per frame: killed outright at night,
   in rain/snow and in fog, strongest when the sun is low, and blooming as
   the camera swings toward the sun. */

import * as THREE from 'three';

const VERT = `
attribute float aPhase;
varying vec2 vUv;
varying float vPh;
void main(){
  vUv = uv; vPh = aPhase;
  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #endif
}`;

const FRAG = `
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
varying float vPh;
void main(){
  float edge = 1.0 - abs(vUv.x);            // soft sides
  edge = pow(edge, 1.6);
  float fade = pow(1.0 - vUv.y, 1.35);      // bright at the top, dying to the ground
  float band = 0.68 + 0.32 * sin(vUv.y * 22.0 + vPh + uTime * 0.45);   // moving light fingers
  float a = uIntensity * edge * fade * band;
  gl_FragColor = vec4(vec3(1.0, 0.946, 0.83) * a, a);
}`;

export class GodRays {
  constructor() {
    this.mesh = null;
    this.anchors = [];
    this.intensity = 0;
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._g = new THREE.Vector3(); this._toCam = new THREE.Vector3();
    this._camH = new THREE.Vector3(); this._camFwd = new THREE.Vector3();
  }

  /** Anchors run along the circuit on alternating sides, above the wall line. */
  build(world, samples, N, terrainHeightAt, wallDist) {
    const step = Math.max(40, Math.round(N / 22));
    const idx = [];
    for (let i = 6; i < N - 4; i += step) idx.push(i);
    const count = idx.length;
    this.anchors.length = 0;

    // Tapered unit beam: x = ±(0.45 + 2.35t), y = 0 .. -1 (top at origin).
    const SEG = 8, pos = [], uv = [], idcs = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG, w = 0.45 + 2.35 * t;
      pos.push(-w, -t, 0, w, -t, 0);
      uv.push(-1, t, 1, t);
    }
    for (let k = 0; k < SEG; k++) {
      const a = k * 2;
      idcs.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idcs);
    const ph = new Float32Array(count);
    for (let k = 0; k < count; k++) ph[k] = Math.random() * Math.PI * 2;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    this.mat.toneMapped = false;

    const mesh = new THREE.InstancedMesh(geo, this.mat, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;

    for (let k = 0; k < count; k++) {
      const s = samples[idx[k] % N];
      const side = k % 2 ? 1 : -1;
      const lat = (wallDist + 7 + (idx[k] * 7919 % 9)) * side;
      const x = s.p.x + s.n.x * lat, z = s.p.z + s.n.z * lat;
      const gy = terrainHeightAt ? terrainHeightAt(x, z) : s.p.y;
      const h = 10 + (idx[k] * 104729 % 10);           // 10–20 m above ground
      this.anchors.push({
        x, z, gy, top: gy + h, h,
        w: 3.0 + ((idx[k] * 31) % 17) / 10             // 3.0–4.6 beam width
      });
    }
    world.add(mesh);
    this.mesh = mesh;
    this.intensity = 0;
  }

  /** gate: 0..1 from the caller (0 = night/rain/fog), sunVec points TO sun. */
  update(dt, camera, sunVec, gate) {
    if (!this.mesh) return;
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;

    // Low sun rakes the shafts across; keep a whisper at high sun so the
    // effect is discoverable on a clear day, full drama toward dusk.
    const sunFactor = Math.min(1, Math.max(0.16, 1.38 - sunVec.y));
    // Bloom as the camera swings toward the sun (horizontal component).
    camera.getWorldDirection(this._camFwd);
    this._camH.set(sunVec.x, 0, sunVec.z).normalize();
    const toward = Math.pow(Math.max(0, this._camFwd.x * this._camH.x + this._camFwd.z * this._camH.z), 1.6);
    const target = 0.62 * gate * sunFactor * (0.22 + 0.78 * toward);

    this.intensity += (target - this.intensity) * Math.min(1, dt * 3);
    const I = this.intensity;
    this.mat.uniforms.uIntensity.value = I;
    this.mesh.visible = I > 0.012;
    if (!this.mesh.visible) return;

    // World direction the beams run: from the sun down to the track.
    this._g.copy(sunVec).negate().normalize();
    const el = Math.max(0.09, sunVec.y);
    const m = this._m, x = this._x, y = this._y, z = this._z, toCam = this._toCam;
    for (let k = 0; k < this.anchors.length; k++) {
      const a = this.anchors[k];
      toCam.set(camera.position.x - a.x, camera.position.y - a.top, camera.position.z - a.z);
      x.crossVectors(this._g, toCam);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0); else x.normalize();
      z.crossVectors(x, this._g).normalize();
      const len = Math.min(a.h / el + 8, 48); // reaches the ground + margin, capped
      x.multiplyScalar(a.w);
      y.copy(this._g).multiplyScalar(-len);   // local -Y runs along the beam
      m.makeBasis(x, y, z);
      m.setPosition(a.x, a.top, a.z);
      this.mesh.setMatrixAt(k, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
