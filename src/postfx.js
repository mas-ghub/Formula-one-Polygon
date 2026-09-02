/* Post-processing: bloom + film grade, driven by weather and time of day.
   The scene is rendered into a half-float target (three keeps render targets
   in linear space, so no tone mapping is baked in), bloomed while still
   linear, then graded — exposure, filmic shoulder, vignette, a hint of grain —
   by the final pass, which is the only thing that writes the screen. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GRADE_FRAG = `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uSat;
uniform float uTime;
varying vec2 vUv;
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
float lin2srgb(float c){ return c<0.0031308 ? c*12.92 : 1.055*pow(max(c,0.0),1.0/2.4)-0.055; }
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c *= uExposure;
  c = aces(c);                                   // filmic shoulder, no clipping
  vec2 d = vUv - 0.5;
  float vig = smoothstep(0.86, 0.18, dot(d, d) * 1.6);
  c *= mix(1.0, vig, uVignette);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);                     // a touch of desaturation in haze
  c = vec3(lin2srgb(c.r), lin2srgb(c.g), lin2srgb(c.b));
  float g = fract(sin(dot(vUv * 977.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * uGrain;
  gl_FragColor = vec4(c, 1.0);
}`;

class GradePass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null }, uExposure: { value: 1.12 }, uVignette: { value: 0.55 },
        uGrain: { value: 0.018 }, uSat: { value: 1.08 }, uTime: { value: 0 }
      },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: GRADE_FRAG
    });
    this.renderToScreen = true;
  }
}

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.ok = false; this.enabled = false; this.wanted = 'HIGH';
    this.mood = {};
  }
  setSize(w, h, pr) {
    this._w = w; this._h = h; this._pr = pr;
    if (this.ok) {
      // EffectComposer already applies its pixelRatio internally. Passing
      // physical pixels here multiplied Retina dimensions a second time (an
      // iPad could attempt enormous half-float/MSAA targets and create an
      // incomplete framebuffer). Keep the composer ratio in sync with the
      // renderer, then pass CSS pixels exactly once.
      this.composer.setPixelRatio(Math.max(0.5, pr || 1));
      this.composer.setSize(Math.max(2, w), Math.max(2, h));
      // Composer sizes each pass; calling bloom.setSize with physical pixels
      // again would duplicate that work and allocation.
    }
  }
  /** quality = resolved tier label. Returns whether the chain is live. */
  apply(quality) {
    this.wanted = quality;
    const want = quality === 'HIGH' || quality === 'ULTRA';
    if (want && !this.ok) this._init();
    this.enabled = want && this.ok;
    this._sync();
    return this.enabled;
  }
  _init() {
    const prevTone = this.renderer.toneMapping;
    try {
      // Keep the graded output honest: the renderer itself must not tone map
      // or colour-space-convert what the chain draws to the canvas.
      this.renderer.toneMapping = THREE.NoToneMapping;
      // The main canvas already has antialiasing. Multisampling this half-float
      // post target as well is a large, unnecessary allocation and exceeds
      // WebKit's renderbuffer budget on Retina iPads.
      const rt = new THREE.WebGLRenderTarget(2, 2, {
        type: THREE.HalfFloatType,
        samples: 0,
        depthBuffer: true
      });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.renderToScreen = false;
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.72, 0.9);
      this.grade = new GradePass();
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.grade);
      this.ok = true;
      if (this._w) this.setSize(this._w, this._h, this._pr);
    } catch (e) {
      this.ok = false; this.enabled = false;
      this.renderer.toneMapping = prevTone;
      if (typeof console !== 'undefined') console.warn('[postfx] disabled:', e && e.message);
    }
  }
  /** Weather-driven look: rain flattens and cools the highlights, night makes
      every light source bleed into the air, sun keeps the image crisp. */
  setMood(m) { this.mood = m || {}; this._sync(); }
  _sync() {
    if (!this.ok) return;
    const m = this.mood;
    const rain = m.rain || 0, night = m.night ? 1 : 0, wet = m.wet || 0;
    this.bloom.strength = 0.22 + rain * 0.26 + night * 0.5 + wet * 0.12;
    this.bloom.radius = 0.55 + rain * 0.32 + night * 0.16;
    this.bloom.threshold = 0.94 - rain * 0.2 - night * 0.22;
    const u = this.grade.uniforms;
    u.uExposure.value = m.exposure != null ? m.exposure : 1.1;
    u.uSat.value = 1.1 - rain * 0.16;                  // wet days are greyer
    u.uGrain.value = 0.014 + night * 0.02 + rain * 0.012;
    u.uVignette.value = 0.5 + night * 0.25;
    u.uTime.value = m.time || 0;
  }
  /** Draws the frame. Returns false if the caller must fall back to a plain
      renderer.render(). */
  render(timeSec) {
    if (!this.enabled || !this.ok) return false;
    try {
      if (this.grade) this.grade.uniforms.uTime.value = timeSec || 0;
      this.composer.render();
      return true;
    } catch (e) {
      this.enabled = false;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return false;
    }
  }
}
