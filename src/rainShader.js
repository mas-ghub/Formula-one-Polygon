/* ============ Shadertoy Rain & Wet Lens WebGL Shader ============ */

export class RainShaderPass {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
    this.enabled = true;
    this.intensity = 0.0;
    this.speed = 0.0;
    this.quality = 'HIGH';
    
    if (!this.gl) {
      console.warn('WebGL rain shader not supported on this context');
      return;
    }
    
    this.initGL();
    this.resize();
  }

  initGL() {
    const gl = this.gl;
    
    const vsSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    // Heartfelt (https://www.shadertoy.com/view/ltffzl) by BigWIngs rain shader algorithm
    // Features dynamic condensation static drops, running trail drips, high-speed wind streaks, and aerodynamic clearing as speed increases
    const fsSource = `
      precision highp float;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uRainAmount;
      uniform float uCarSpeed;
      varying vec2 vUv;

      #define S(a, b, t) smoothstep(a, b, t)

      vec3 N13(float p) {
        vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
        p3 += dot(p3, p3.yzx + 19.19);
        return fract((p3.xxy + p3.yzz) * p3.zyx);
      }

      vec4 N14(float t) {
        return fract(sin(t*vec4(123., 1024., 1456., 264.))*vec4(6547., 345., 8799., 1564.));
      }

      float N(float t) {
        return fract(sin(t*12345.564)*7658.76);
      }

      float Saw(float b, float t) {
        return S(0., b, t)*S(1., b, t);
      }

      // Heartfelt Main Droplet & Running Trail Generator
      vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
        vec2 s = vec2(6.0, 1.0);
        vec2 grid = s * 2.0;
        vec2 id = floor(uv * grid);
        
        float colShift = N(id.x); 
        uv.y += t * (0.22 + uCarSpeed * 0.015) + colShift;
        
        vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
        id = floor(uv * grid);
        vec3 n = N13(id.x * 107.4 + id.y * 35.8);
        vec2 p = (n.xy - 0.5) * 0.7;
        
        float d = length(st - p);
        float dropSize = (n.z * 0.14 + 0.08);
        float drop = S(dropSize, dropSize * 0.4, d);
        
        // Trail drops streaming down glass
        float trailTime = fract(uv.y * 8.0);
        float trailD = length(st - vec2(p.x, trailTime));
        float trail = S(dropSize * 0.45, 0.0, trailD) * S(0.4, 0.0, trailTime);
        
        // High speed streak elongation
        float streakLen = clamp(uCarSpeed / 50.0, 0.0, 2.5);
        vec2 streakSt = st - p;
        streakSt.y *= (1.0 / (1.0 + streakLen * 1.5));
        float streak = S(dropSize * 0.9, 0.0, length(streakSt)) * S(0.0, 1.0, streakLen);
        
        vec2 normal = (st - p) * (drop + streak * 0.7) * 4.0;
        return normal * l0 + vec2(0.0, trail * 0.6) * l1;
      }

      // Static fine mist condensation drops that clear off at high speed
      vec2 StaticDrops(vec2 uv, float t) {
        uv *= 28.0;
        vec2 id = floor(uv);
        uv = fract(uv) - 0.5;
        vec3 n = N13(id.x * 74.2 + id.y * 123.4);
        vec2 p = (n.xy - 0.5) * 0.6;
        float d = length(uv - p);
        
        float fade = Saw(0.025, fract(t * 0.05 + n.z));
        float c = S(0.25, 0.0, d) * fract(n.z * 10.0) * fade;
        return (uv - p) * c * 2.0;
      }

      void main() {
        if (uRainAmount <= 0.005) {
          discard;
          return;
        }

        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
        vec2 st = (uv - 0.5) * aspect;

        // Aerodynamic wind clearing factor:
        // As speed increases (0 to 200+ km/h), drops get pushed outward from center and swept off visor/windshield
        float speedRatio = clamp(uCarSpeed / 120.0, 0.0, 2.5);
        float clearFactor = 1.0 / (1.0 + speedRatio * 0.85); // central drops clear quicker at high speed
        
        // Outward wind deflection
        vec2 windPush = normalize(st + vec2(0.0001)) * (speedRatio * 0.08 * length(st));
        vec2 rainUV = st + windPush;

        float t = uTime * (0.8 + speedRatio * 0.6);

        // Heartfelt Multi-layer drop calculations
        vec2 c = Drops(rainUV * 2.5, t, 1.0, 1.0, 0.0);
        c += Drops(rainUV * 4.5, t * 1.35, 1.0, 0.8, 0.0) * 0.65;
        
        // Heavy rain third layer
        if (uRainAmount > 0.45) {
          c += Drops(rainUV * 8.5, t * 1.8, 0.8, 0.5, 0.0) * 0.45;
        }

        // Static mist drops clear rapidly as airflow blows them away
        float staticMistAmount = clamp(1.0 - speedRatio * 0.65, 0.0, 1.0);
        if (staticMistAmount > 0.05) {
          c += StaticDrops(rainUV, t) * (0.35 * staticMistAmount);
        }

        // Combine normals and calculate refractive drop mask
        float dropIntensity = length(c);
        float dropMask = clamp(dropIntensity * 3.8, 0.0, 1.0) * uRainAmount * clearFactor;

        if (dropMask < 0.001) {
          discard;
          return;
        }

        // Realistic 3D glass Fresnel & sun specular reflection on droplets
        vec3 lightDir = normalize(vec3(0.35, 0.85, 0.45));
        vec3 norm = normalize(vec3(c.x * 2.2, c.y * 2.2, 1.0));
        
        float diffuse = clamp(dot(norm, lightDir), 0.0, 1.0);
        float spec = pow(clamp(dot(reflect(-lightDir, norm), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 32.0) * 2.4;
        
        // Water refraction color: crisp crystal highlights with subtle sky blue tint
        vec3 waterColor = vec3(0.88, 0.94, 1.0) * (spec + diffuse * 0.15);
        float alpha = dropMask * (0.42 + spec * 0.58);

        // Wet visor peripheral darkening (subtle lens vignette)
        float vig = length(uv - 0.5);
        alpha += vig * vig * 0.12 * uRainAmount;

        gl_FragColor = vec4(waterColor, clamp(alpha, 0.0, 0.92));
      }
    `;

    const createShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uResolution = gl.getUniformLocation(this.program, 'uResolution');
    this.uRainAmount = gl.getUniformLocation(this.program, 'uRainAmount');
    this.uCarSpeed = gl.getUniformLocation(this.program, 'uCarSpeed');

    // Full-screen quad
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
  }

  resize() {
    if (!this.gl) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Scale canvas resolution based on quality setting
    const scale = this.quality === 'ULTRA' ? 1.0 : this.quality === 'HIGH' ? 0.75 : 0.5;
    this.canvas.width = Math.floor(w * scale);
    this.canvas.height = Math.floor(h * scale);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  render(timeSec, rainAmount, carSpeed) {
    if (!this.gl || !this.program) return;
    const gl = this.gl;

    if (rainAmount <= 0.01) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniform1f(this.uTime, timeSec);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uRainAmount, rainAmount);
    gl.uniform1f(this.uCarSpeed, carSpeed);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
