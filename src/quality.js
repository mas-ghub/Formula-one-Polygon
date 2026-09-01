/* ============ Graphics Quality Modes ============ */
import * as THREE from 'three';

export const QUALITY_PRESETS = {
  ULTRA: {
    label: 'ULTRA',
    pixelRatio: 3,
    shadows: true,
    shadowSize: 4096,
    shadowType: 'soft', // PCFSoftShadowMap — buttery, filmic shadow edges
    smokeParticles: 900,
    sparkParticles: 300,
    anisotropy: 16,
    rainShader: true,
    propDensity: 1.5
  },
  HIGH: {
    label: 'HIGH',
    pixelRatio: 1.5,
    shadows: true,
    shadowSize: 2048,
    shadowType: 'pcf',
    smokeParticles: 400,
    sparkParticles: 120,
    anisotropy: 8,
    rainShader: true,
    propDensity: 1.0
  },
  MED: {
    label: 'MED',
    pixelRatio: 1.0,
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
    pixelRatio: 0.65,
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

export class QualityManager {
  constructor(renderer, sunLight, rainPass) {
    this.renderer = renderer;
    this.sunLight = sunLight;
    this.rainPass = rainPass;
    this.current = 'AUTO';
    this.resolved = 'HIGH';   // the concrete tier actually in use
    this.autoLevel = null;    // AUTO ladder state
    this.fpsAcc = 0; this.fpsN = 0; this.autoDir = 0;
  }

  // Pick a sensible starting tier for the hardware so AUTO lands close out of
  // the gate, then the live FPS monitor (sample) walks it up/down from there.
  autoDetect() {
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
    const area = innerWidth * innerHeight;
    // Phones / small screens / low-DPI → don't waste the frame budget.
    if (isMobile || area < 620000 || dpr < 1.1) return 'MED';
    // Desktop & tablet with a modern crisp display and lots of cores.
    if (cores >= 8 && dpr >= 1.5) return 'ULTRA';
    if (cores >= 6) return 'HIGH';
    return 'MED';
  }

  resolvedLevel() { return this.resolved; }

  apply(mode) {
    if (mode === 'AUTO') {
      const starting = this.autoLevel || this.autoDetect();
      this.applyConcrete(starting);
      this.current = 'AUTO'; // stay in AUTO so the FPS autotuner keeps running
      return QUALITY_PRESETS[starting];
    }
    return this.applyConcrete(mode);
  }
  applyConcrete(mode) {
    if (!QUALITY_PRESETS[mode]) mode = 'HIGH';
    this.current = mode;
    this.resolved = mode;
    const cfg = QUALITY_PRESETS[mode];

    // Pixel ratio — an absolute render-resolution multiplier, not capped to
    // the display's own devicePixelRatio, so every tier is visibly different
    // even on a standard (non-Retina/scaled) monitor: LOW genuinely renders
    // at reduced resolution, ULTRA supersamples far above native.
    this.renderer.setPixelRatio(Math.min(cfg.pixelRatio, 3));

    // Shadow maps — ULTRA uses soft (PCFSoft) shadows at 4K resolution;
    // HIGH/MED get plain PCF; LOW turns shadows off entirely.
    if (cfg.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = cfg.shadowType === 'soft'
        ? THREE.PCFSoftShadowMap
        : THREE.PCFShadowMap;
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

    if (this.rainPass) {
      this.rainPass.setQuality(mode);
    }

    // Update UI chips
    const chip = document.getElementById('hQualityChip');
    if (chip) chip.textContent = cfg.label;

    return cfg;
  }

  // Live FPS-based auto-tuning — only active while the UI mode is AUTO.
  // Averages a short window and, if it's consistently below target, steps a
  // tier down (or up when there's healthy headroom) so the resolved level
  // always fits whatever device you're on.
  sample(fps) {
    if (this.current !== 'AUTO') return;
    this.fpsAcc += fps; this.fpsN++;
    if (this.fpsN < 40) return;
    const avg = this.fpsAcc / this.fpsN;
    this.fpsAcc = 0; this.fpsN = 0;
    if (avg < 48) this.autoDir = Math.min(this.autoDir - 1, -1);
    else if (avg > 58) this.autoDir = Math.max(this.autoDir + 1, 1);
    else this.autoDir = 0;
    if (this.autoDir <= -1 || this.autoDir >= 1) {
      this.stepAuto(this.autoDir);
      this.autoDir = 0;
    }
  }
  stepAuto(dir) {
    const order = ['LOW', 'MED', 'HIGH', 'ULTRA'];
    let i = order.indexOf(this.autoLevel || 'MED');
    i = Math.max(0, Math.min(order.length - 1, i + dir));
    if (order[i] === this.autoLevel) return;
    this.autoLevel = order[i];
    this.applyConcrete(this.autoLevel);
    this.current = 'AUTO';
  }
}
