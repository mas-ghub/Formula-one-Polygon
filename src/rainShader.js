/* ============ Windshield Rain — adapted from "Heartfelt" ============
   Original GLSL by Martijn Steinrucken (BigWings), 2017 — Shadertoy: ltffzl
   License: CC BY-NC-SA 3.0. The heart/story timeline from the original demo
   has been removed; the droplet/streak noise functions are otherwise as
   authored. This version renders the real 3D scene into a texture and
   refracts it through the drops (true glass distortion), driven by the
   current weather intensity and the player's speed, with a discrete
   lightning-flash input for thunderstorms. */
import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D uScene;
uniform float uTime;
uniform vec2 uResolution;
uniform float uRainAmount;
uniform float uCarSpeed;
uniform float uLightning;
varying vec2 vUv;

#define S(a, b, t) smoothstep(a, b, t)

vec3 N13(float p) {
  vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
}
float N(float t) { return fract(sin(t*12345.564)*7658.76); }
float Saw(float b, float t) { return S(0., b, t)*S(1., b, t); }

vec2 DropLayer2(vec2 uv, float t) {
  vec2 UV = uv;
  uv.y += t*0.75;
  vec2 a = vec2(6., 1.);
  vec2 grid = a*2.;
  vec2 id = floor(uv*grid);
  float colShift = N(id.x);
  uv.y += colShift;
  id = floor(uv*grid);
  vec3 n = N13(id.x*35.2+id.y*2376.1);
  vec2 st = fract(uv*grid)-vec2(.5, 0);
  float x = n.x-.5;
  float y = UV.y*20.;
  float wiggle = sin(y+sin(y));
  x += wiggle*(.5-abs(x))*(n.z-.5);
  x *= .7;
  float ti = fract(t+n.z);
  y = (Saw(.85, ti)-.5)*.9+.5;
  vec2 p = vec2(x, y);
  float d = length((st-p)*a.yx);
  float mainDrop = S(.4, .0, d);
  float r = sqrt(S(1., y, st.y));
  float cd = abs(st.x-x);
  float trail = S(.23*r, .15*r*r, cd);
  float trailFront = S(-.02, .02, st.y-y);
  trail *= trailFront*r*r;
  y = UV.y;
  float trail2 = S(.2*r, .0, cd);
  float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
  y = fract(y*10.)+(st.y-.5);
  float dd = length(st-vec2(x, y));
  droplets = S(.3, 0., dd);
  float m = mainDrop+droplets*r*trailFront;
  return vec2(m, trail);
}

float StaticDrops(vec2 uv, float t) {
  uv *= 40.;
  vec2 id = floor(uv);
  uv = fract(uv)-.5;
  vec3 n = N13(id.x*107.45+id.y*3543.654);
  vec2 p = (n.xy-.5)*.7;
  float d = length(uv-p);
  float fade = Saw(.025, fract(t+n.z));
  float c = S(.3, 0., d)*fract(n.z*10.)*fade;
  return c;
}

vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
  float s = StaticDrops(uv, t)*l0;
  vec2 m1 = DropLayer2(uv, t)*l1;
  vec2 m2 = DropLayer2(uv*1.85, t)*l2;
  float c = s+m1.x+m2.x;
  c = S(.3, 1., c);
  return vec2(c, max(m1.y*l0, m2.y*l1));
}

// Stand-in for the original's textureLod glass defocus (no WebGL2/LOD
// extension here) — a small multi-tap blur scaled by fog/trail thickness.
vec3 blurScene(vec2 uv, float amount) {
  if (amount <= 0.0008) return texture2D(uScene, uv).rgb;
  vec3 col = texture2D(uScene, uv).rgb * 3.0;
  float total = 3.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634;
    vec2 o = vec2(cos(a), sin(a)) * amount;
    col += texture2D(uScene, clamp(uv+o, 0.0, 1.0)).rgb;
    total += 1.0;
  }
  return col/total;
}

void main() {
  vec2 UV = vUv;
  float rainAmount = clamp(uRainAmount, 0.0, 1.0);

  if (rainAmount <= 0.004 && uLightning <= 0.004) {
    gl_FragColor = vec4(texture2D(uScene, UV).rgb, 1.0);
    return;
  }

  vec2 uv = (UV-.5)*vec2(uResolution.x/uResolution.y, 1.0);
  float t = uTime*.2 + uCarSpeed*0.0015;

  float staticDrops = S(-.5, 1., rainAmount)*2.;
  float layer1 = S(.25, .75, rainAmount);
  float layer2 = S(.0, .5, rainAmount);

  vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
  // Screen-space derivative of the Heartfelt drop field: this is the glass
  // normal that bends the actual rendered circuit behind every bead.
  vec2 e = vec2(1.5/max(uResolution.x,uResolution.y), 0.);
  float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
  float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
  vec2 n = vec2(cx-c.x, cy-c.x)/max(e.x,0.00001);
  n=clamp(n*0.00034,vec2(-0.035),vec2(0.035));

  // Faithful Shadertoy-style optical hierarchy: a faintly defocused wet pane,
  // a sharp refracted scene inside beads, and softer running trails. Keeping
  // the background blur modest preserves braking markers for gameplay.
  float wetGlass=(0.00035+rainAmount*0.00075)*(1.0-c.x*0.78);
  wetGlass+=c.y*0.0008;
  vec3 col = blurScene(clamp(UV+n,0.0,1.0),wetGlass);

  // Fresnel rim and bright pin highlight make droplets read as water rather
  // than transparent distortion. Trails get a cooler, subtler sheen.
  float edge=S(0.02,0.22,c.x)*(1.0-S(0.55,0.95,c.x));
  float glint=pow(clamp(1.0-length(n)*18.0,0.0,1.0),18.0)*c.x;
  col+=vec3(0.52,0.68,0.82)*edge*0.09;
  col+=vec3(0.95,0.98,1.0)*glint*0.30;
  col=mix(col,col*vec3(0.82,0.91,1.03),clamp(c.y*0.32,0.0,0.32));

  // Discrete lightning strike, driven by the game's thunder scheduler
  col += uLightning*vec3(1.0, 1.0, 1.05)*1.5;

  // Lift storm-darkened areas so the track stays readable. This must be
  // proportional/additive, never a hard max() floor — a flat clamp collapses
  // every dark pixel to the exact same color and erases the car and road's
  // own shading entirely (they turn into a single featureless grey silhouette
  // instead of a lit car sitting on a lit road). Gamma brightens shadows more
  // than highlights while preserving relative detail, and the additive term
  // gives a visible lift even to true blacks.
  col = pow(max(col, 0.0), vec3(1.0 - 0.18*rainAmount));
  col += vec3(0.012, 0.015, 0.018)*rainAmount;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class RainShaderPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'HIGH';

    const size = this._targetSize();
    this.rt = new THREE.WebGLRenderTarget(size.w, size.h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.uniforms = {
      uScene: { value: this.rt.texture },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.w, size.h) },
      uRainAmount: { value: 0 },
      uCarSpeed: { value: 0 },
      uLightning: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  }

  _targetSize() {
    const el = this.renderer.domElement;
    const scale = this.quality === 'ULTRA' ? 1.0 : this.quality === 'HIGH' ? 0.85 : this.quality === 'MED' ? 0.65 : 0.5;
    return {
      w: Math.max(2, Math.floor((el.width || innerWidth) * scale)),
      h: Math.max(2, Math.floor((el.height || innerHeight) * scale)),
    };
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  resize() {
    const { w, h } = this._targetSize();
    this.rt.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  // Renders the real scene into the offscreen target used as the refraction source.
  renderScene(scene, camera) {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(prev);
  }

  // Draws the windshield composite (refracted scene + drops) to whatever the
  // renderer's current target is — call after renderScene(), with the render
  // target reset to the screen.
  composite(timeSec, rainAmount, carSpeed, lightning) {
    this.uniforms.uTime.value = timeSec;
    this.uniforms.uRainAmount.value = rainAmount;
    this.uniforms.uCarSpeed.value = carSpeed;
    this.uniforms.uLightning.value = lightning || 0;
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
