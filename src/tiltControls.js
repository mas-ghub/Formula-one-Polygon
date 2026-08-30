/* ============ Mobile Tilt / Gyroscope & Accelerometer Controller ============ */

export const TILT_SENSITIVITY_LEVELS = [
  { id: 'low', label: 'LOW (1.0x)', mult: 1.0, lockDeg: 22.0 },
  { id: 'med', label: 'MED (1.8x)', mult: 1.8, lockDeg: 14.0 },
  { id: 'high', label: 'HIGH (2.6x)', mult: 2.6, lockDeg: 9.5 },
  { id: 'ultra', label: 'ULTRA (3.8x)', mult: 3.8, lockDeg: 6.0 }
];

export class TiltController {
  constructor() {
    this.enabled = false;
    this.hasPermission = false;
    this.calibrated = false;

    // Configurable parameters & persistence
    this.sensitivityIdx = 2; // HIGH (2.6x)
    this.customSens = 2.6;
    this.deadzone = 1.0; // degrees
    this.steerAxis = 'auto'; // 'auto' | 'beta' | 'gamma' | 'accel'
    this.invertSteer = false;
    this.invertPitch = false;
    this.throttleMode = 'touch'; // 'touch' (default for mobile F1) | 'auto' | 'tilt'

    // Neutral baseline resting angles (degrees)
    this.neutralSteer = 0;
    this.neutralPitch = 0;

    // Outputs for car physics
    this.steer = 0;    // -1.0 (full left) to +1.0 (full right)
    this.throttle = 0; // 0.0 to 1.0 (gas)
    this.brake = 0;    // 0.0 to 1.0 (brake)
    this.handBrake = false;
    this.drift = false;

    // Smoothed filter state
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.lastFilterTime = performance.now();

    // Raw sensor cache
    this.currentBeta = 0;
    this.currentGamma = 0;
    this.currentAlpha = 0;
    this.accX = 0;
    this.accY = 0;
    this.accZ = 0;
    this.lastRawSteer = 0;
    this.lastRawPitch = 0;
    this.lastSteerDeg = 0;
    this.sensorSource = 'Sensor Ready';

    // Simulated drag overrides for desktop test lab
    this.simulatedSteer = 0;
    this.simulatedPitch = 0;

    this.onOrientation = this.handleOrientation.bind(this);
    this.onMotion = this.handleMotion.bind(this);

    this.loadSettings();
  }

  loadSettings() {
    try {
      const data = localStorage.getItem('f1_gyro_settings_v4');
      if (data) {
        const s = JSON.parse(data);
        if (typeof s.sensitivityIdx === 'number') this.sensitivityIdx = s.sensitivityIdx;
        if (typeof s.customSens === 'number') this.customSens = s.customSens;
        if (typeof s.deadzone === 'number') this.deadzone = s.deadzone;
        if (typeof s.steerAxis === 'string') this.steerAxis = s.steerAxis;
        if (typeof s.invertSteer === 'boolean') this.invertSteer = s.invertSteer;
        if (typeof s.invertPitch === 'boolean') this.invertPitch = s.invertPitch;
        if (typeof s.throttleMode === 'string') this.throttleMode = s.throttleMode;
      }
    } catch (e) {
      console.warn('Could not load gyro settings:', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('f1_gyro_settings_v4', JSON.stringify({
        sensitivityIdx: this.sensitivityIdx,
        customSens: this.customSens,
        deadzone: this.deadzone,
        steerAxis: this.steerAxis,
        invertSteer: this.invertSteer,
        invertPitch: this.invertPitch,
        throttleMode: this.throttleMode
      }));
    } catch (e) {
      console.warn('Could not save gyro settings:', e);
    }
  }

  get isSupported() {
    return (
      typeof window !== 'undefined' &&
      ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window || 'ontouchstart' in window)
    );
  }

  get currentSensitivity() {
    return TILT_SENSITIVITY_LEVELS[this.sensitivityIdx] || TILT_SENSITIVITY_LEVELS[2];
  }

  setSensitivity(idx) {
    this.sensitivityIdx = Math.max(0, Math.min(TILT_SENSITIVITY_LEVELS.length - 1, idx));
    this.customSens = this.currentSensitivity.mult;
    this.saveSettings();
    this.updateUI();
    this.showToast(`GYRO SENSITIVITY: ${this.currentSensitivity.label}`);
  }

  cycleSensitivity() {
    this.setSensitivity((this.sensitivityIdx + 1) % TILT_SENSITIVITY_LEVELS.length);
  }

  swapSteerAxis() {
    if (this.steerAxis === 'auto') {
      this.steerAxis = 'beta';
    } else if (this.steerAxis === 'beta') {
      this.steerAxis = 'gamma';
    } else if (this.steerAxis === 'gamma') {
      this.steerAxis = 'accel';
    } else {
      this.steerAxis = 'auto';
    }
    this.calibrated = false;
    this.saveSettings();
    this.updateUI();
    const names = {
      auto: 'AUTO ORIENTATION',
      beta: 'LANDSCAPE (β AXIS)',
      gamma: 'PORTRAIT (γ AXIS)',
      accel: '3D ACCELEROMETER'
    };
    this.showToast(`STEER AXIS: ${names[this.steerAxis] || this.steerAxis.toUpperCase()}`);
  }

  toggleInvertSteer() {
    this.invertSteer = !this.invertSteer;
    this.saveSettings();
    this.updateUI();
    this.showToast(`STEERING INVERT: ${this.invertSteer ? 'ON' : 'OFF'}`);
  }

  async requestPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        this.hasPermission = (res === 'granted');
      } else {
        this.hasPermission = true;
      }
    } catch (err) {
      console.warn('Orientation permission notice:', err);
      this.hasPermission = true;
    }
    return this.hasPermission;
  }

  async enable() {
    await this.requestPermission();

    this.enabled = true;
    this.calibrated = false;
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.lastFilterTime = performance.now();

    window.addEventListener('deviceorientation', this.onOrientation, true);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this.onOrientation, true);
    }
    window.addEventListener('devicemotion', this.onMotion, true);

    document.body.classList.add('tilt-mode');
    this.updateUI();
    return true;
  }

  disable() {
    this.enabled = false;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.handBrake = false;
    this.drift = false;

    window.removeEventListener('deviceorientation', this.onOrientation, true);
    if ('ondeviceorientationabsolute' in window) {
      window.removeEventListener('deviceorientationabsolute', this.onOrientation, true);
    }
    window.removeEventListener('devicemotion', this.onMotion, true);

    document.body.classList.remove('tilt-mode');
    this.updateUI();
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    } else {
      return await this.enable();
    }
  }

  calibrate() {
    this.neutralSteer = this.lastRawSteer;
    this.neutralPitch = this.lastRawPitch;
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.calibrated = true;
    this.showToast('🎯 NEUTRAL ZERO CALIBRATED');
  }

  getScreenAngle() {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle;
    }
    if (typeof window.orientation === 'number') {
      return window.orientation;
    }
    return window.innerWidth > window.innerHeight ? 90 : 0;
  }

  /**
   * Process raw sensor inputs into clean steering and throttle/brake angles
   */
  processSensors() {
    const isLandscape = (typeof window !== 'undefined') ? (window.innerWidth > window.innerHeight) : true;
    const angle = this.getScreenAngle();

    let rawSteer = 0; // degrees
    let rawPitch = 0; // degrees

    if (this.steerAxis === 'accel') {
      // 3D Accelerometer Gravity Vector
      const g = 9.81;
      if (isLandscape || angle === 90 || angle === -90 || angle === 270) {
        const sign = (angle === 270 || angle === -90) ? 1 : -1;
        rawSteer = sign * (this.accY / g) * 45;
        rawPitch = (this.accX / g) * 45;
      } else {
        rawSteer = (this.accX / g) * 45;
        rawPitch = (this.accY / g) * 45;
      }
    } else if (this.steerAxis === 'beta') {
      // Force Beta axis (Pitch) for steering
      rawSteer = -this.currentBeta;
      rawPitch = this.currentGamma;
    } else if (this.steerAxis === 'gamma') {
      // Force Gamma axis (Roll) for steering
      rawSteer = this.currentGamma;
      rawPitch = this.currentBeta;
    } else {
      // DEFAULT: 'auto'
      // When phone is in Landscape (widescreen), rotating the steering wheel alters BETA!
      // When phone is in Portrait, rotating the steering wheel alters GAMMA!
      if (isLandscape || angle === 90 || angle === 270 || angle === -90) {
        const sign = (angle === 270 || angle === -90) ? 1 : -1;
        rawSteer = sign * this.currentBeta;
        rawPitch = this.currentGamma;
      } else {
        rawSteer = this.currentGamma;
        rawPitch = this.currentBeta;
      }
    }

    this.lastRawSteer = rawSteer;
    this.lastRawPitch = rawPitch;

    // Auto-calibrate baseline on initial sensor event if not calibrated yet
    if (!this.calibrated && (Math.abs(rawSteer) > 0.05 || Math.abs(rawPitch) > 0.05)) {
      this.neutralSteer = rawSteer;
      this.neutralPitch = rawPitch;
      this.calibrated = true;
    }

    this.computeOutputs(rawSteer, rawPitch);
  }

  computeOutputs(rawSteer, rawPitch) {
    const now = performance.now();
    const dt = Math.min(0.08, (now - this.lastFilterTime) / 1000 || 0.016);
    this.lastFilterTime = now;

    // --- 1. STEERING CALCULATION ---
    let steerDelta = rawSteer - this.neutralSteer;
    if (this.invertSteer) steerDelta = -steerDelta;

    this.lastSteerDeg = steerDelta;

    const deadzone = this.deadzone; // e.g. 1.0°
    const maxLockDeg = (this.currentSensitivity.lockDeg || 9.5) / (this.customSens / (this.currentSensitivity.mult || 2.6));

    let targetSteer = 0;
    if (Math.abs(steerDelta) > deadzone) {
      const sign = Math.sign(steerDelta);
      const span = Math.max(1.0, maxLockDeg - deadzone);
      const norm = Math.min(1.0, (Math.abs(steerDelta) - deadzone) / span);
      // Smooth progressive steering curve
      targetSteer = sign * (norm * norm * (3 - 2 * norm));
    }

    // Override if interactive drag testing on canvas
    if (Math.abs(this.simulatedSteer) > 0.001) {
      targetSteer = this.simulatedSteer;
    }

    // Fast responsive filter (36 rad/s)
    const alphaSteer = 1 - Math.exp(-dt * 36);
    this.smoothSteer += (targetSteer - this.smoothSteer) * alphaSteer;
    this.steer = Math.max(-1.0, Math.min(1.0, this.smoothSteer));

    // --- 2. THROTTLE / BRAKE PITCH CALCULATION ---
    let targetThrottle = 0;
    let targetBrake = 0;

    if (this.throttleMode === 'touch') {
      targetThrottle = 0;
      targetBrake = 0;
    } else if (this.throttleMode === 'auto') {
      targetThrottle = 1.0;
      targetBrake = 0;
    } else {
      // Dynamic Pitch Gas / Brake
      let pitchDelta = rawPitch - this.neutralPitch;
      if (this.invertPitch) pitchDelta = -pitchDelta;

      const pitchDz = 3.0; // degrees deadband
      const pitchMax = 15.0; // degrees for 100% gas / brake

      if (this.handBrake) {
        targetThrottle = 0;
        targetBrake = 1.0;
      } else if (pitchDelta > pitchDz) {
        // Tilting top of phone away / down -> Gas
        const norm = Math.min(1.0, (pitchDelta - pitchDz) / (pitchMax - pitchDz));
        targetThrottle = norm * norm;
        targetBrake = 0;
      } else if (pitchDelta < -pitchDz) {
        // Tilting top of phone towards face / up -> Brake
        const norm = Math.min(1.0, (-pitchDelta - pitchDz) / (pitchMax - pitchDz));
        targetThrottle = 0;
        targetBrake = norm * norm;
      }
    }

    // Desktop simulation override
    if (Math.abs(this.simulatedPitch) > 0.001) {
      if (this.simulatedPitch > 0) {
        targetThrottle = this.simulatedPitch;
        targetBrake = 0;
      } else {
        targetThrottle = 0;
        targetBrake = -this.simulatedPitch;
      }
    }

    const alphaPitch = 1 - Math.exp(-dt * 24);
    this.smoothThrottle += (targetThrottle - this.smoothThrottle) * alphaPitch;
    this.smoothBrake += (targetBrake - this.smoothBrake) * alphaPitch;

    this.throttle = Math.max(0, Math.min(1.0, this.smoothThrottle));
    this.brake = Math.max(0, Math.min(1.0, this.smoothBrake));
  }

  handleOrientation(e) {
    if (!this.enabled) return;
    if (e.beta === null && e.gamma === null) return;

    this.sensorSource = 'DeviceOrientation (Gyro)';
    this.currentBeta = e.beta || 0;
    this.currentGamma = e.gamma || 0;
    this.currentAlpha = e.alpha || 0;

    this.processSensors();
  }

  handleMotion(e) {
    if (!this.enabled) return;
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null) return;

    this.accX = acc.x || 0;
    this.accY = acc.y || 0;
    this.accZ = acc.z || 0;

    if (this.sensorSource === 'Sensor Ready') {
      this.sensorSource = 'DeviceMotion (Accel)';
    }

    if (this.steerAxis === 'accel' || (!this.currentBeta && !this.currentGamma)) {
      this.processSensors();
    }
  }

  showToast(msg) {
    const t = document.getElementById('camToast');
    if (t) {
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
    }
  }

  updateUI() {
    const btnTouch = document.getElementById('btnTouchMode');
    const btnTilt = document.getElementById('btnTiltMode');
    if (btnTouch && btnTilt) {
      btnTouch.classList.toggle('sel', !this.enabled);
      btnTilt.classList.toggle('sel', this.enabled);
    }

    const hChip = document.getElementById('hTiltChip');
    if (hChip) {
      const axisName = this.steerAxis === 'auto' ? 'AUTO' : (this.steerAxis === 'beta' ? 'β' : (this.steerAxis === 'gamma' ? 'γ' : 'ACC'));
      hChip.textContent = this.enabled ? `GYRO [${axisName}]` : 'GYRO OFF';
      hChip.classList.toggle('active', this.enabled);
      if (this.enabled) {
        hChip.style.borderColor = '#00f0ff';
        hChip.style.color = '#00f0ff';
      } else {
        hChip.style.borderColor = '';
        hChip.style.color = '';
      }
    }

    const pBtn = document.getElementById('pTiltToggle');
    if (pBtn) {
      const axisName = this.steerAxis === 'auto' ? 'AUTO' : (this.steerAxis === 'beta' ? 'LANDSCAPE (β)' : (this.steerAxis === 'gamma' ? 'PORTRAIT (γ)' : 'ACCEL 3D'));
      pBtn.textContent = this.enabled ? `GYRO TILT: ON [${axisName}]` : 'GYRO TILT: OFF';
      pBtn.classList.toggle('on', this.enabled);
    }

    const gauge = document.getElementById('tiltGauge');
    if (gauge) {
      gauge.classList.toggle('show', this.enabled);
    }
  }

  updateHUD() {
    if (!this.enabled) return;
    const pip = document.getElementById('tiltBarPip');
    const status = document.getElementById('tiltThrottleStatus');
    if (!pip || !status) return;

    const offset = Math.max(0, Math.min(92, (this.steer + 1.0) * 46));
    pip.style.transform = `translateX(${offset}px)`;

    if (this.handBrake) {
      status.textContent = 'HAND BRAKE';
      status.style.color = '#ff5348';
    } else if (this.throttle > 0.04) {
      status.textContent = `GAS ${Math.round(this.throttle * 100)}%`;
      status.style.color = '#8be08a';
    } else if (this.brake > 0.04) {
      status.textContent = `BRAKE ${Math.round(this.brake * 100)}%`;
      status.style.color = '#ff5348';
    } else {
      const lockPct = Math.round(Math.abs(this.steer) * 100);
      const axis = this.steerAxis === 'auto' ? 'AUTO' : (this.steerAxis === 'beta' ? 'β' : (this.steerAxis === 'gamma' ? 'γ' : 'ACC'));
      status.textContent = lockPct > 3 ? `${this.steer < 0 ? '◄ LEFT' : 'RIGHT ►'} ${lockPct}% [${axis}]` : `STEER CENTERED [${axis}]`;
      status.style.color = '#00f0ff';
    }
  }
}
