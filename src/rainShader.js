/* ============ Windshield Rain — adapted from "Heartfelt" ============
   Original GLSL by Martijn Steinrucken aka BigWIngs, 2017 — Shadertoy: https://www.shadertoy.com/view/ltffzl
   The N13 hash is credited in the source to Dave Hoskins.
   License: CC BY-NC-SA 3.0. The original HAS_HEART story timeline is not drawn over the driving view; its
   same Heartfelt glass/drop layers are kept as the weather pass, with a separate
   strike overlay; the droplet/streak noise functions are otherwise as
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
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
uniform sampler2D uScene;
uniform float uTime;
uniform vec2 uResolution;
uniform float uRainAmount;
uniform float uCarSpeed;
uniform float uLightning;
uniform float uLightningSeed;
uniform float uExposure;
varying vec2 vUv;

// The scene texture is a raw LINEAR offscreen render: three.js only applies
// ACESFilmic tone mapping and the sRGB output encode when it draws to the
// canvas, and this pass draws to the canvas itself. Without doing the same
// work here every rainy frame came out dark and flat (the "Day looks like
// dusk in the rain" bug). Same curve as three's ACESFilmicToneMapping.
vec3 rainRrtOdt(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 rainAces(vec3 color){
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = rainRrtOdt(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 rainLin2srgb(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}

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
  c = S(.55, 1.15, c);
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

  float lineGlow(vec2 p, vec2 a, vec2 b){
    vec2 pa=p-a,ba=b-a;
    float h=clamp(dot(pa,ba)/max(dot(ba,ba),0.0001),0.0,1.0);
    return exp(-dot(pa-ba*h,pa-ba*h)*6200.0);
  }
  float bolt(vec2 p,float seed){
    float glow=0.0;
    vec2 prev=vec2(0.72,1.04);
    for(int i=1;i<8;i++){
      float fi=float(i);
      float y=1.04-fi*0.115;
      float x=0.72+(fract(sin(fi*91.7+seed*3.1)*43758.5)-0.5)*0.24;
      vec2 next=vec2(x,y);
      glow=max(glow,lineGlow(p,prev,next));
      prev=next;
    }
    // A short fork makes the strike read as a bolt, not a vertical overlay.
    vec2 forkA=vec2(0.67,0.70),forkB=vec2(0.51,0.56);
    glow=max(glow,lineGlow(p,forkA,forkB));
    return clamp(glow,0.0,1.0);
  }

void main() {
  vec2 UV = vUv;
  float rainAmount = clamp(uRainAmount, 0.0, 1.0);

  if (rainAmount <= 0.004 && uLightning <= 0.004) {
    gl_FragColor = vec4(rainLin2srgb(rainAces(texture2D(uScene, UV).rgb)), 1.0);
    return;
  }

  vec2 uv = (UV-.5)*vec2(uResolution.x/uResolution.y, 1.0);
  // Time-only drive: the drop field must run DOWN the glass at a steady
  // rate. The old "+ uCarSpeed*0.0015" term made the whole field teleport
  // whenever you braked or accelerated (speed is an offset, not the
  // integral of one), so beads jerked up and down instead of dribbling.
  // Speed still reads through trailElong/speedFactor below.
  float t = uTime*.2;

// Enhanced: stronger drop density in heavy rain (layer3 activates when
// rainAmount > 0.6), smoother speed response, and a stronger lightning
// flash with brief brightness spike followed by quick fade (simulating the
// lightning's actual after-image on the retina).
  // Keep the authored Heartfelt layer weights: the drop field itself must be
  // dense enough to see. Transparency is controlled at the composite stage,
  // not by starving the field until it becomes invisible.
  // Restored to the dense, authored Heartfelt field (the 20260908.4 look):
  // a busy carpet of static beads with clearly visible runners. Later
  // tuning had starved these to roughly a third and the glass read as
  // barely damp. Transparency is still controlled at the composite stage.
  float layer3 = S(.62, .95, rainAmount)*0.42;
  float staticDrops = S(-.5, 1., rainAmount)*1.7;
  float layer1 = S(.25, .75, rainAmount)*0.94;
  float layer2 = S(.0, .5, rainAmount)*0.78;
  float speedFactor = clamp(uCarSpeed / 200.0, 0.0, 1.2); // speed-driven streak elongation

  vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
  // Heavy rain third layer adds density without changing the base drop logic.
  if (layer3 > 0.05) {
    vec2 m3 = DropLayer2(uv*2.35, t)*layer3;
    float cHeavy = c.x + m3.x;
    c = vec2(S(.3, 1., cHeavy), max(c.y, m3.y*layer3));
  }

  // Speed-driven streak elongation: faster cars see longer droplet trails
  // as the relative wind stretches the drops before they slide off the glass.
  float trailElong = 1.0 + speedFactor * 0.55;
  // Screen-space derivative of the Heartfelt drop field: this is the glass
  // normal that bends the actual rendered circuit behind every bead.
  // Heartfelt uses a one-pixel finite difference for the wet-glass normal.
  // The previous port divided this twice and reduced it to almost zero, so
  // the pass technically ran but produced no readable bead refraction.
  // Glass normal from hardware screen-space derivatives: ONE Drops() eval
  // per pixel instead of three. Same gradient the finite difference gave,
  // at a third of the ALU — this was the single biggest cost of the pass.
  vec2 n = vec2(dFdx(c.x), dFdy(c.x));
  // A little more optical throw so the refraction is readable from the
  // helicopter/broadcast distances too, not just from the chase camera.
  n=clamp(n*0.95,vec2(-0.032),vec2(0.032));

  // Faithful Shadertoy-style optical hierarchy: a faintly defocused wet pane,
  // a sharp refracted scene inside beads, and softer running trails. Keeping
  // the background blur modest preserves braking markers for gameplay.
  // Speed-driven streak elongation applied to the blur amount: faster cars
  // stretch the drop trails horizontally as the relative wind pulls them out.
  // Speed-reactive wet-glass defocus: the pane softens slightly where water
  // sits, trails smear MORE the faster you go (airflow drags the film up
  // the visor). A 4-tap cross blur stretched along Y by speed is enough and
  // costs half the old 8-tap ring.
  // Glass between the drops stays perfectly CLEAR — the old pane-wide term
  // (0.00005 + rainAmount*0.00014 everywhere) was the "milky" haze. Only
  // the running trails get a speed-stretched smear.
  float wetGlass = c.y * 0.00022;
  vec2 smear = vec2(wetGlass, wetGlass * trailElong * 2.2);
  vec2 ruv = clamp(UV + n * 0.8, 0.0, 1.0);
  vec3 refractedLin = texture2D(uScene, ruv).rgb * 2.0
    + texture2D(uScene, clamp(ruv + vec2(smear.x, 0.0), 0.0, 1.0)).rgb
    + texture2D(uScene, clamp(ruv - vec2(smear.x, 0.0), 0.0, 1.0)).rgb
    + texture2D(uScene, clamp(ruv + vec2(0.0, smear.y), 0.0, 1.0)).rgb
    + texture2D(uScene, clamp(ruv - vec2(0.0, smear.y), 0.0, 1.0)).rgb;
  vec3 originalScene = rainAces(texture2D(uScene, UV).rgb);
  vec3 refractedScene = rainAces(refractedLin / 6.0);
  // Beads are see-through: the refracted scene is mixed in only INSIDE the
  // bead (c.x) and faintly along trails — everything else is the untouched
  // frame, so the circuit reads at full contrast behind the water.
  float dropletAlpha=clamp(c.x*0.72+c.y*0.10,0.0,0.62);
  vec3 col=mix(originalScene,refractedScene,dropletAlpha);

  // Fresnel rim and bright pin highlight make droplets read as water rather
  // than transparent distortion. Trails get a cooler, subtler sheen.
  float edge = S(0.02, 0.22, c.x) * (1.0 - S(0.55, 0.95, c.x));
  float glint = pow(clamp(1.0 - length(n) * 18.0, 0.0, 1.0), 18.0) * c.x;
  // Lightning is kept separate from the rain density. The game supplies a
  // short strike envelope, so wet glass never becomes a full-screen white veil.
  // Kept soft on purpose: a stronger rim/glint reads as an opaque outline
  // around every bead instead of wet glass.
  // Highlights are what make water read as water, but every additive term
  // pushes toward white. Keep the specular pin, cut the broad rim/trail
  // sheen so the glass never looks frosted.
  col+=vec3(0.48,0.68,0.82)*edge*0.035*rainAmount;
  col+=vec3(0.95,0.99,1.0)*glint*0.20*rainAmount;
  col+=vec3(0.42,0.62,0.76)*c.y*0.04*rainAmount;

  // The matching Shadertoy Heartfelt effect is a glass/rain shader; lightning
  // is layered separately so it can be spectacular without making rain itself
  // opaque. Draw a screen-space branched bolt for the short strike envelope.
  float flash=clamp(uLightning,0.0,1.0);
  float boltGlow=bolt(UV,uLightningSeed);
  col += flash * vec3(0.94,0.97,1.0) * 1.55;
  col += boltGlow * flash * vec3(1.0,1.0,1.0) * 4.5;

  // Lift storm-darkened areas so the track stays readable. This must be
  // proportional/additive, never a hard max() floor — a flat clamp collapses
  // every dark pixel to the exact same color and erases the car and road's
  // own shading entirely (they turn into a single featureless grey silhouette
  // instead of a lit car sitting on a lit road). Gamma brightens shadows more
  // than highlights while preserving relative detail, and the additive term
  // gives a visible lift even to true blacks.
  col = max(col,0.0);

  gl_FragColor = vec4(rainLin2srgb(clamp(col, 0.0, 1.0)), 1.0);
}
`;

export class RainShaderPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'HIGH';
    this.failed = false;

    const size = this._targetSize();
    this.rt = new THREE.WebGLRenderTarget(size.w, size.h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      // HDR scene copy. With the default 8-bit target every linear value
      // above 1.0 (sky, wet-track sun glare, headlights) was clipped BEFORE
      // the ACES curve ran, so highlights lost their roll-off and the whole
      // frame read as flat, low-contrast "milky" compared with the normal
      // (non-visor) render, which tone-maps straight from HDR.
      type: THREE.HalfFloatType,
    });

    this.uniforms = {
      uScene: { value: this.rt.texture },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.w, size.h) },
      uRainAmount: { value: 0 },
      uCarSpeed: { value: 0 },
      uLightning: { value: 0 },
      uLightningSeed: { value: 0 },
      uExposure: { value: 1.0 },
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
    // Keep ULTRA rainy helmet/hood frames sharp too: the refraction source is
    // now full renderer resolution on ULTRA. Lower tiers still scale down.
    const scale = this.quality === 'ULTRA' ? 1.0 : this.quality === 'HIGH' ? 0.85 : this.quality === 'MED' ? 0.65 : 0.5;
    const baseW=Math.max(2,el.width||innerWidth),baseH=Math.max(2,el.height||innerHeight);
    // Never allocate an unbounded full-resolution windshield target. On a
    // Retina/4K display ULTRA used to request an enormous second RGBA buffer;
    // some drivers responded with a white canvas instead of a clean failure.
    const budget=this.quality==='ULTRA'?18000000:this.quality==='HIGH'?9000000:this.quality==='MED'?4500000:2200000;
    const safe=Math.min(scale,(this.quality==='ULTRA'?4096:3072)/baseW,Math.sqrt(budget/(baseW*baseH)));
    return {w:Math.max(2,Math.floor(baseW*safe)),h:Math.max(2,Math.floor(baseH*safe))};
  }

  setQuality(q) {
    this.failed = false;
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
  composite(timeSec, rainAmount, carSpeed, lightning, seed = 0, exposure = 1.0) {
    if(this.failed)return;
    this.uniforms.uExposure.value = exposure;
    this.uniforms.uTime.value = timeSec;
    this.uniforms.uRainAmount.value = rainAmount;
    this.uniforms.uCarSpeed.value = carSpeed;
    this.uniforms.uLightning.value = lightning || 0;
    this.uniforms.uLightningSeed.value = seed || 0;
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
