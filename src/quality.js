/* ============ Graphics Quality Modes ============ */

export const QUALITY_PRESETS = {
  ULTRA: {
    label: 'ULTRA',
    pixelRatio: 2.0,
    shadows: true,
    shadowSize: 2048,
    smokeParticles: 700,
    sparkParticles: 200,
    anisotropy: 8,
    rainShader: true
  },
  HIGH: {
    label: 'HIGH',
    pixelRatio: 1.5,
    shadows: true,
    shadowSize: 1024,
    smokeParticles: 400,
    sparkParticles: 120,
    anisotropy: 4,
    rainShader: true
  },
  MED: {
    label: 'MED',
    pixelRatio: 1.0,
    shadows: true,
    shadowSize: 512,
    smokeParticles: 250,
    sparkParticles: 80,
    anisotropy: 2,
    rainShader: true
  },
  LOW: {
    label: 'LOW',
    pixelRatio: 1.0,
    shadows: false,
    shadowSize: 256,
    smokeParticles: 120,
    sparkParticles: 40,
    anisotropy: 1,
    rainShader: false
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

    // Pixel ratio
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);
    this.renderer.setPixelRatio(dpr);

    // Shadow maps
    if (cfg.shadows) {
      this.renderer.shadowMap.enabled = true;
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
