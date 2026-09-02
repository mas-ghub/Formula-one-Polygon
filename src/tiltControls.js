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
    // 'unknown' → nothing asked yet, 'granted' → the browser let us listen,
    // 'live' → and the device is actually sending sensor events. The
    // difference between those two is the whole reason tilt "turns on" and
    // then does nothing on an iPad, so the UI reports them separately.
    this.gyroState = 'unknown';
    this.gyroError = '';
    this._permResult = null;
    this._sensorSeenAt = 0;
    this._watchdog = 0;

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

    // One-shot baseline capture latch (see processSensors)
    this._seenAny = false;

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

  /**
   * Ask the OS for motion/orientation access. Returns 'granted' | 'denied' |
   * 'not-needed' | 'unsupported' and NEVER claims success when the call
   * threw: the old code fell into catch and set hasPermission = true, so an
   * iPad with Motion & Orientation Access switched off believed it was live,
   * showed "GYROSCOPE ACTIVE", and the car never moved.
   */
  async requestPermission() {
    if (typeof window === 'undefined') { this._permResult = 'unsupported'; return 'unsupported'; }
    const DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    const ask = DOE && typeof DOE.requestPermission === 'function' ? DOE
      : (DME && typeof DME.requestPermission === 'function' ? DME : null);
    if (!ask && !DOE && !DME) {
      this._permResult = 'unsupported';
      this.gyroError = 'This browser has no motion sensors at all.';
      return 'unsupported';
    }
    if (!ask) { this._permResult = 'not-needed'; this.hasPermission = true; return 'not-needed'; }
    try {
      const res = await ask.requestPermission();
      this._permResult = res === 'granted' ? 'granted' : 'denied';
      this.hasPermission = res === 'granted';
      if (!this.hasPermission)
        this.gyroError = 'The browser refused motion access (iOS: Settings ▸ Safari ▸ Advanced ▸ "Motion & Orientation Access").';
      return this._permResult;
    } catch (err) {
      // A throw is a failure, not a pass. Usually a non-secure origin, a
      // missing user gesture, Low Power Mode or Focus blocking the sensor.
      console.warn('Orientation permission problem:', err);
      this._permResult = 'denied';
      this.hasPermission = false;
      this.gyroError = 'The permission request failed (' + ((err && err.name) || 'error') +
        '). Motion access needs the https:// address, an active tap, and no Low Power/Focus blocking.';
      return 'denied';
    }
  }

  /**
   * Start listening. Resolves true only when the sensor is actually feeding
   * us data: permission alone is not enough (an iPad with the OS switch off,
   * or any desktop without an IMU, grants and then sends nothing).
   */
  async enable() {
    const perm = await this.requestPermission();
    if (perm === 'denied' || perm === 'unsupported') {
      this.enabled = false;
      this.gyroState = 'error';
      this.updateUI();
      return false;
    }

    this.enabled = true;
    this.gyroState = 'pending';
    this.gyroError = '';
    // Every start is a fresh zero: holding the device level for a moment recentres
    // the steering, so an earlier session's angle can never bias this one.
    this.calibrated = false;
    this._seenAny = false;
    this.neutralSteer = 0;
    this.neutralPitch = 0;
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.lastFilterTime = performance.now();
    this._sensorSeenAt = 0;

    window.addEventListener('deviceorientation', this.onOrientation, true);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this.onOrientation, true);
    }
    window.addEventListener('devicemotion', this.onMotion, true);

    document.body.classList.add('tilt-mode');
    // a (re)start always clears the retry prompt; it comes back if the sensor
    // still refuses to talk
    const prompt = document.getElementById('gyroPrompt');
    if (prompt) prompt.classList.remove('show');
    this.updateUI();

    if (this._sensorSeenAt) { this.gyroState = 'live'; this.updateUI(); return true; }
    return await this.waitForSensor();
  }

  /**
   * Watchdog: a working IMU fires within a few frames. If nothing arrives
   * within ~1.4s, say so — and say why — instead of pretending to drive.
   */
  waitForSensor(timeoutMs = 1400) {
    return new Promise((resolve) => {
      clearTimeout(this._watchdog);
      const t0 = performance.now();
      const tick = () => {
        if (!this.enabled) return resolve(false);
        if (this._sensorSeenAt) { this.gyroState = 'live'; this.updateUI(); return resolve(true); }
        if (performance.now() - t0 > timeoutMs) {
          if (!this.gyroError)
            this.gyroError = 'No motion data from the device. On iPad/iPhone turn on Settings ▸ Safari ▸ Advanced ▸ "Motion & Orientation Access", leave Low Power Mode off, and reload; on a desktop or emulator there is no IMU to read.';
          this.disable();
          this.gyroState = 'error';
          this.updateUI();
          return resolve(false);
        }
        this._watchdog = setTimeout(tick, 100);
      };
      this._watchdog = setTimeout(tick, 120);
    });
  }

  disable() {
    clearTimeout(this._watchdog);
    this._watchdog = 0;
    if (this.gyroState === 'live' || this.gyroState === 'pending') this.gyroState = this.gyroError ? 'error' : 'unknown';
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
    }
    return await this.enable();
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
        rawPitch = sign * (this.accX / g) * 45;
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
        rawPitch = sign * this.currentGamma;
      } else {
        rawSteer = this.currentGamma;
        rawPitch = this.currentBeta;
      }
    }

    this.lastRawSteer = rawSteer;
    this.lastRawPitch = rawPitch;

    // Adopt the first reading after (re)start as the neutral pose. Note the
    // seenAny latch: while the watchdog is still probing whether a sensor
    // exists at all, the baseline must NOT be captured — otherwise the wake-up
    // jerk of a phone already held at an angle would silently become
    // "straight ahead", and every later correction would be ignored because
    // the old code only re-centred once the tilt exceeded 0.05°.
    if (!this.calibrated && this._seenAny) {
      this.neutralSteer = rawSteer;
      this.neutralPitch = rawPitch;
      this.calibrated = true;
    } else if (!this.calibrated) {
      this._seenAny = true;
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

    this._sensorSeenAt = performance.now();
    if (this.gyroState !== 'live') { this.gyroState = 'live'; this.updateUI(); }
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

    this._sensorSeenAt = performance.now();
    if (this.gyroState !== 'live') { this.gyroState = 'live'; this.updateUI(); }
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

  showToast(msg, ttl = 1400) {
    const t = document.getElementById('camToast');
    if (t) {
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('show'), ttl);
    }
  }

  updateUI() {
    const btnTouch = document.getElementById('btnTouchMode');
    const btnTilt = document.getElementById('btnTiltMode');
    if (btnTouch && btnTilt) {
      btnTouch.classList.toggle('sel', !this.enabled);
      btnTilt.classList.toggle('sel', this.enabled);
    }

    const axisName = this.steerAxis === 'auto' ? 'AUTO' : (this.steerAxis === 'beta' ? 'β' : (this.steerAxis === 'gamma' ? 'γ' : 'ACC'));
    // Four visibly different states — off, asking, live, broken — because
    // "on" and "working" are not the same thing and the old UI conflated them.
    const label = !this.enabled
      ? (this.gyroState === 'error' ? 'GYRO ERROR' : 'GYRO OFF')
      : (this.gyroState === 'live' ? `GYRO [${axisName}]` : 'GYRO PENDING');
    const tint = !this.enabled
      ? (this.gyroState === 'error' ? '#ff5348' : '')
      : (this.gyroState === 'live' ? '#00f0ff' : '#f2c14e');

    const hChip = document.getElementById('hTiltChip');
    if (hChip) {
      hChip.textContent = label;
      hChip.classList.toggle('active', this.gyroState === 'live');
      hChip.style.borderColor = tint;
      hChip.style.color = tint;
      hChip.title = this.gyroState === 'error' && this.gyroError ? this.gyroError : '';
    }

    const pBtn = document.getElementById('pTiltToggle');
    if (pBtn) {
      const longAxis = this.steerAxis === 'auto' ? 'AUTO' : (this.steerAxis === 'beta' ? 'LANDSCAPE (β)' : (this.steerAxis === 'gamma' ? 'PORTRAIT (γ)' : 'ACCEL 3D'));
      pBtn.textContent = this.enabled
        ? (this.gyroState === 'live' ? `GYRO TILT: LIVE [${longAxis}]` : 'GYRO TILT: WAITING FOR SENSOR…')
        : (this.gyroState === 'error' ? 'GYRO TILT: NO SENSOR — TAP TO RETRY' : 'GYRO TILT: OFF');
      pBtn.classList.toggle('on', this.gyroState === 'live');
      pBtn.title = this.gyroError || '';
    }

    const labNotice = document.getElementById('gyroLabCalNotice');
    if (labNotice) {
      labNotice.textContent = this.gyroState === 'error'
        ? (this.gyroError || 'No sensor data')
        : (this.gyroState === 'live' ? 'Gyroscope is live · tilt to steer'
          : (this.enabled ? 'Detecting motion sensor…' : 'Gyroscope off'));
      labNotice.style.color = this.gyroState === 'error' ? '#ff5348' : '#22c55e';
      labNotice.classList.add('show');
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
