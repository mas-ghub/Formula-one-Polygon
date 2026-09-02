/* ============ Graphics Quality Modes ============ */
import * as THREE from 'three';

// Each preset's `pixelRatio` is now a SUPERSAMPLE FACTOR applied over the
// display's own devicePixelRatio (clamped), not an absolute multiplier.
// An absolute number used to mean ULTRA on a 2× Retina laptop rendered at
// 3× the CSS pixel size = ~1.5× the physical retina pixel count — a huge,
// wasted ~17M-pixel buffer every frame that crushed high-refresh (120Hz)
// panels. Scaling from native keeps every tier distinct but lets a 120Hz
// screen actually hit its refresh rate.
export const QUALITY_PRESETS = {
  ULTRA: {
    label: 'ULTRA',
    // ULTRA spends its budget on scene detail, not a dangerously oversized
    // framebuffer. Retina already supplies ample native resolution.
    pixelRatio: 1.0,
    shadows: true,
    shadowSize: 2048,
    shadowType: 'soft',           // PCFSoftShadowMap — buttery, filmic shadow edges
    smokeParticles: 900,
    sparkParticles: 300,
    anisotropy: 16,
    rainShader: true,
    propDensity: 1.5
  },
  HIGH: {
    label: 'HIGH',
    pixelRatio: 0.9,
    shadows: true,
    shadowSize: 1536,
    shadowType: 'pcf',
    smokeParticles: 400,
    sparkParticles: 120,
    anisotropy: 8,
    rainShader: true,
    propDensity: 1.0
  },
  MED: {
    label: 'MED',
    pixelRatio: 0.95,
    shadows: true,
    shadowSize: 1024,
    shadowType: 'pcf',
    smokeParticles: 250,
    sparkParticles: 80,
    anisotropy: 4,
    rainShader: true,
    propDensity: 0.75
  },
  LOW: {
    label: 'LOW',
    pixelRatio: 0.6,
    shadows: false,
    shadowSize: 256,
    shadowType: 'none',
    smokeParticles: 120,
    sparkParticles: 40,
    anisotropy: 1,
    rainShader: false,
    propDensity: 0.4
  }
};

// A frame-rate window shorter than this (frames) ignores the FPS that drops
// on a cold start / while the JIT warms up or data loads.
const WARMUP_FRAMES = 60;

export class QualityManager {
  constructor(renderer, sunLight, rainPass) {
    this.renderer = renderer;
    this.sunLight = sunLight;
    this.rainPass = rainPass;
    this.current = 'AUTO';
    this.resolved = 'HIGH';       // the concrete tier actually in use
    this.autoLevel = null;        // AUTO ladder state
    this.fpsAcc = 0; this.fpsN = 0;
    this.autoDir = 0;
    this.resScale = 1.0;          // dynamic resolution multiplier
    this.targetFps = 60;          // detected display refresh rate
    this._safeRatios = new Map(); // measured framebuffer limits per viewport/tier
  }

  // Ask WebGL itself whether an RGBA colour + depth framebuffer of this exact
  // size is complete. This is a real allocation test, not a device-name guess.
  _probeFramebuffer(w, h) {
    const gl=this.renderer.getContext();
    const maxTex=gl.getParameter(gl.MAX_TEXTURE_SIZE)||0;
    const maxRb=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||maxTex;
    const vp=gl.getParameter(gl.MAX_VIEWPORT_DIMS)||[maxTex,maxTex];
    if(w<2||h<2||w>maxTex||h>maxTex||w>maxRb||h>maxRb||w>vp[0]||h>vp[1])return false;
    let fb=null,tex=null,depth=null,ok=false;
    try{
      for(let i=0;i<8&&gl.getError()!==gl.NO_ERROR;i++){} // discard stale GL flags
      fb=gl.createFramebuffer();tex=gl.createTexture();depth=gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE&&gl.getError()===gl.NO_ERROR;
    }catch(e){ok=false;}
    finally{
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindRenderbuffer(gl.RENDERBUFFER,null);
      if(fb)gl.deleteFramebuffer(fb);if(tex)gl.deleteTexture(tex);if(depth)gl.deleteRenderbuffer(depth);
    }
    return ok;
  }

  _measuredRatio(desired, mode) {
    const key=innerWidth+'x'+innerHeight+':'+mode+':'+desired.toFixed(2);
    if(this._safeRatios.has(key))return this._safeRatios.get(key);
    const gl=this.renderer.getContext(),vp=gl.getParameter(gl.MAX_VIEWPORT_DIMS)||[4096,4096];
    const hard=Math.min((gl.getParameter(gl.MAX_TEXTURE_SIZE)||4096)/innerWidth,(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||4096)/innerHeight,vp[0]/innerWidth,vp[1]/innerHeight);
    let ratio=Math.min(desired,hard);
    // Test the requested allocation, then walk down until this GPU confirms a
    // complete colour/depth target. LOW is the final universally safe floor.
    while(ratio>0.55&&!this._probeFramebuffer(Math.floor(innerWidth*ratio),Math.floor(innerHeight*ratio)))ratio*=0.8;
    ratio=Math.max(0.5,ratio);
    this._safeRatios.set(key,ratio);
    return ratio;
  }

  // Pick a sensible starting tier for the hardware so AUTO lands close out of
  // the gate, then the live monitor walks it up/down from there.
  autoDetect() {
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
    const area = innerWidth * innerHeight;
    if (isMobile || area < 620000 || dpr < 1.1) return 'MED';
    if (cores >= 8 && dpr >= 1.5) return 'ULTRA';
    if (cores >= 6) return 'HIGH';
    return 'MED';
  }

  resolvedLevel() { return this.resolved; }

  // Probe the display's real refresh rate by timing requestAnimationFrame
  // intervals (the minimum gap reflects one vsync). Defaults to 60 on any
  // failure so the tuner always has a sane target.
  detectRefresh() {
    return new Promise(resolve => {
      let last = performance.now(), min = Infinity, n = 0, done = false;
      const finish = () => {
        if (done) return; done = true;
        if (!isFinite(min) || min <= 0) { resolve(60); return; }
        const raw = Math.round(1000 / min);
        const snap = [30, 45, 50, 60, 75, 90, 120, 144, 165, 240]
          .reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
        resolve(snap);
      };
      const probe = ts => {
        const dt = ts - last; last = ts;
        if (n > 1 && dt > 0 && dt < min) min = dt;
        if (++n >= 50) { finish(); return; }
        requestAnimationFrame(probe);
      };
      requestAnimationFrame(probe);
      // Safety: never hang the boot waiting for the probe.
      setTimeout(finish, 1200);
    });
  }

  async init() {
    this.targetFps = await this.detectRefresh();
    // Leave a little headroom under the panel's hard limit so the tuner has
    // room to settle just below the refresh ceiling.
    this.targetFps = Math.max(30, this.targetFps * 0.94);
  }

  apply(mode) {
    if (mode === 'AUTO') {
      const starting = this.autoLevel || this.autoDetect();
      this.applyConcrete(starting);
      this.current = 'AUTO'; // stay in AUTO so the FPS autotuner keeps running
      return QUALITY_PRESETS[starting];
    }
    this.applyConcrete(mode);
    this.current = mode;
    return QUALITY_PRESETS[mode];
  }

  applyConcrete(mode) {
    if (!QUALITY_PRESETS[mode]) mode = 'HIGH';
    this.resolved = mode; // note: doesn't touch this.current (AUTO tracking)
    const cfg = QUALITY_PRESETS[mode];

    // Effective pixel ratio = native dpr × the tier's supersample factor × the
    // dynamic resolution scale, clamped to sane bounds. This is what lets the
    // tuner trade a little resolution to keep a 120Hz panel at 120fps.
    const dpr = window.devicePixelRatio || 1;
    const requested=clamp(dpr*cfg.pixelRatio*this.resScale,0.5,3);
    const eff=this._measuredRatio(requested,mode);
    this.renderer.setPixelRatio(eff);
    const meterChip=document.getElementById('hQualityChip');
    if(meterChip)meterChip.title=`${cfg.label}: measured ${eff.toFixed(2)}× render scale`;

    // Shadow maps — ULTRA uses soft (PCFSoft) shadows at 4K resolution;
    // HIGH/MED get plain PCF; LOW turns shadows off entirely.
    if (cfg.shadows) {
      this.renderer.shadowMap.enabled = true;
      // PCFSoftShadowMap was removed/deprecated by current three.js. PCF is
      // supported across WebGL implementations and avoids the warning.
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    } else {
      this.renderer.shadowMap.enabled = false;
      this.sunLight.castShadow = false;
    }

    this.setRainQuality(mode);

    const chip = document.getElementById('hQualityChip');
    if (chip) chip.textContent = cfg.label;

    return cfg;
  }

  setRainQuality(mode) {
    if (this.rainPass) this.rainPass.setQuality(mode);
  }

  // Live FPS-driven auto-tuning — active only while the UI mode is AUTO.
  // Aim is a stable frame rate at the detected refresh rate. It first trades
  // internal resolution (resScale) up/down — smooth, no tier jump — and only
  // steps to a different discrete tier when resolution alone can't close the
  // gap. This is what lets a 120Hz M5 Max / 4080 laptop / phone all use their
  // own best performance instead of one-fixed-quality-for-everyone.
  sample(fps) {
    if (this.current !== 'AUTO') return;
    if (this.fpsN < WARMUP_FRAMES) { this.fpsAcc += fps; this.fpsN++; return; }
    this.fpsAcc += fps; this.fpsN++;
    if (this.fpsN < WARMUP_FRAMES + 30) return; // evaluate over ~30 frames
    const avg = this.fpsAcc / this.fpsN;
    this.fpsAcc = 0; this.fpsN = WARMUP_FRAMES;

    const target = this.targetFps || 60;
    const low = target * 0.86, high = target * 0.96;

    if (avg < low) {
      // Slower than we want — drop internal resolution first.
      this.resScale = Math.max(0.5, this.resScale - 0.08);
      this.applyConcrete(this.autoLevel || this.resolved);
      if (this.resScale <= 0.51) this.stepAuto(-1, true);
    } else if (avg > high) {
      // Plenty of headroom — push resolution up to sharpen the image.
      this.resScale = Math.min(1.7, this.resScale + 0.08);
      this.applyConcrete(this.autoLevel || this.resolved);
      if (this.resScale >= 1.69) this.stepAuto(1, true);
    }
  }

  stepAuto(dir, resetRes) {
    if (this.current !== 'AUTO') return;
    const order = ['LOW', 'MED', 'HIGH', 'ULTRA'];
    let i = order.indexOf(this.autoLevel || 'MED');
    i = Math.max(0, Math.min(order.length - 1, i + dir));
    if (order[i] === this.autoLevel) return;
    this.autoLevel = order[i];
    if (resetRes) this.resScale = 1.0;
    this.applyConcrete(this.autoLevel);
    this.current = 'AUTO';
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
