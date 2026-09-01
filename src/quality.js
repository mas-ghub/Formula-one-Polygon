/* ============ Graphics Quality Modes ============ */
import * as THREE from 'three';

export const QUALITY_PRESETS = {
  ULTRA: {
    label: 'ULTRA',
    pixelRatio: 2.5,
    shadows: true,
    shadowSize: 4096,
    shadowType: 'soft', // PCFSoftShadowMap — buttery, filmic shadow edges
    smokeParticles: 900,
    sparkParticles: 300,
    anisotropy: 16,
    rainShader: true,
    propDensity: 1.35
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
    this.current = 'HIGH';
  }

  apply(mode) {
    if (!QUALITY_PRESETS[mode]) mode = 'HIGH';
    this.current = mode;
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
}
