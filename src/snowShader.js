/* ============ Falling Snow — screen-space overlay ============
   Adapted from the user's own Shadertoy-style snowfall shader: layered
   cellular noise (6 depth layers x 12 flake sizes) drifting and falling,
   each flake fading in/out with distance from its cell center. Unlike the
   rain pass this needs no refraction of the scene behind it — it's a pure
   alpha-blended overlay drawn straight on top of the already-rendered
   frame, so there's no render-target/composite dance, just one quad. */
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
uniform float uTime;
uniform vec2 uResolution;
uniform float uIntensity; // 0..1 — how much it's snowing (weather/accumulation gate)
uniform float uBurst;     // ~0.2..1.7 — gust multiplier, varies over time

varying vec2 vUv;

void main(){
  vec2 fragCoord = vUv * uResolution;
  float snow = 0.0;
  float gradient = (1.0 - fragCoord.y / uResolution.x) * 0.4;
  float speedMul = 0.5 + uBurst * 0.8;

  for (int k = 0; k < 6; k++) {
    // i starts at 1, not 0 — several terms below divide by float(i), and at
    // i=0 that's a division by zero. On some GPUs that quietly produces Inf
    // (then NaN once it hits sin()), which is exactly what made flakes
    // occasionally streak upward/sideways at high speed instead of drifting
    // down — a handful of pixels per frame going numerically haywire.
    for (int i = 1; i <= 12; i++) {
      float cellSize = 2.0 + (float(i) * 3.0);
      float downSpeed = (0.3 + (sin(uTime*0.4 + float(k + i*20)) + 1.0) * 0.00008) * speedMul;
      vec2 uv = (fragCoord.xy / uResolution.x)
        + vec2(0.01*sin((uTime+float(k*6185))*0.6+float(i))*(5.0/float(i)),
               downSpeed*(uTime+float(k*1352))*(1.0/float(i)));
      vec2 uvStep = (ceil(uv*cellSize - vec2(0.5,0.5)) / cellSize);
      float x = fract(sin(dot(uvStep.xy, vec2(12.9898+float(k)*12.0, 78.233+float(k)*315.156))) * 43758.5453 + float(k)*12.0) - 0.5;
      float y = fract(sin(dot(uvStep.xy, vec2(62.2364+float(k)*23.0, 94.674+float(k)*95.0))) * 62159.8432 + float(k)*12.0) - 0.5;

      float randomMagnitude1 = sin(uTime*2.5)*0.7/cellSize;
      float randomMagnitude2 = cos(uTime*2.5)*0.7/cellSize;

      float d = 5.0*distance((uvStep.xy + vec2(x*sin(y),y)*randomMagnitude1 + vec2(y,x)*randomMagnitude2), uv.xy);

      float omiVal = fract(sin(dot(uvStep.xy, vec2(32.4691,94.615))) * 31572.1684);
      if (omiVal < 0.08) {
        float newd = (x+1.0)*0.4*clamp(1.9-d*(15.0+(x*6.3))*(cellSize/1.4), 0.0, 1.0);
        snow += newd;
      }
    }
  }

  snow *= (0.3 + uIntensity*1.1) * (0.55 + uBurst*0.75);
  vec3 col = vec3(1.0) + gradient*vec3(0.4,0.8,1.0);
  float alpha = clamp(snow, 0.0, 1.0) * clamp(uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

export class SnowShaderPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uIntensity: { value: 0 },
      uBurst: { value: 0.3 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    this.resize();
  }

  resize() {
    const el = this.renderer.domElement;
    this.uniforms.uResolution.value.set(el.width || innerWidth, el.height || innerHeight);
  }

  // Draws straight on top of whatever's already in the current render
  // target — call after the main scene (and rain pass, if any) has rendered.
  composite(timeSec, intensity, burst) {
    this.uniforms.uTime.value = timeSec;
    this.uniforms.uIntensity.value = intensity;
    this.uniforms.uBurst.value = burst;
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.autoClear = prevAutoClear;
  }
}
