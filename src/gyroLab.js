/* ============ 3D Gyro Calibration & Interactive Test Lab ============ */
import * as THREE from 'three';
import { getBodyGeo, makeDriverMesh, getAxleGeo } from './game.js';

export class GyroCalibrationLab {
  constructor(tiltController) {
    this.tiltCtrl = tiltController;
    this.isOpen = false;
    this.container = null;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.carGroup = null;
    this.axleF = null;
    this.axleR = null;
    this.driverGroup = null;
    this.helmetGroup = null;
    this.rearBrakeLight = null;
    this.speedParticles = null;
    this.stripes = [];
    this.animId = null;
    this.lastTime = performance.now();
    this.simSpeed = 0;
    this.wheelRot = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
  }

  init() {
    this.container = document.getElementById('gyroLabModal');
    this.canvas = document.getElementById('gyroLabCanvas');
    if (!this.container || !this.canvas) return;

    this.setupThreeScene();
    this.bindUIEvents();
  }

  setupThreeScene() {
    const width = this.canvas.clientWidth || 400;
    const height = this.canvas.clientHeight || 280;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.032);

    // Camera positioned BEHIND the car (looking forward in the +Z direction down the track)
    // Car nose is at +Z (2.62), Rear wing is at -Z (-2.35)
    // Camera is at z = -5.4 looking towards z = +3.5
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.95, -5.4);
    this.camera.lookAt(0, 0.45, 3.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;

    // Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 1.3);
    this.scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight.position.set(4, 9, -3);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 2.4);
    rimLight.position.set(-5, 4, 6);
    this.scene.add(rimLight);

    // Rear F1 rain / brake light at -Z rear wing
    const rearRedLight = new THREE.PointLight(0xff2020, 0.8, 6);
    rearRedLight.position.set(0, 0.5, -2.1);
    this.scene.add(rearRedLight);
    this.rearBrakeLight = rearRedLight;

    // Test Track Floor
    const floorGeo = new THREE.PlaneGeometry(32, 70, 20, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x11141b,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Longitudinal Track Grid Lines
    const gridMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.25 });
    const gridLines = new THREE.Group();
    for (let x = -7.5; x <= 7.5; x += 1.5) {
      const gGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.02, -30),
        new THREE.Vector3(x, 0.02, 35)
      ]);
      gridLines.add(new THREE.Line(gGeo, gridMat));
    }
    this.scene.add(gridLines);

    // Moving asphalt road markings
    this.stripes = [];
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.7 });
    for (let z = -25; z <= 30; z += 4.0) {
      const sMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.22), stripeMat);
      sMesh.rotation.x = -Math.PI / 2;
      sMesh.position.set(0, 0.03, z);
      this.scene.add(sMesh);
      this.stripes.push(sMesh);
    }

    // 3D Formula 1 Car Model (Car nose points to +Z, facing away from camera)
    this.carGroup = new THREE.Group();
    
    // Body Mesh (White & Racing Red livery)
    const matBody = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.55
    });
    const bodyGeo = getBodyGeo('#f5f5f2', '#e10600');
    const bodyMesh = new THREE.Mesh(bodyGeo, matBody);
    bodyMesh.castShadow = true;
    this.carGroup.add(bodyMesh);

    // Articulated Driver & Helmet
    const { driverGroup, helmetGroup } = makeDriverMesh('#f5f5f2', '#e10600');
    this.driverGroup = driverGroup;
    this.helmetGroup = helmetGroup;
    this.carGroup.add(driverGroup);

    // Axles & Wheels
    const matWheel = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.15
    });
    this.axleF = new THREE.Mesh(getAxleGeo(), matWheel);
    this.axleF.rotation.order = 'YXZ';
    this.axleF.position.set(0, 0.37, 1.62); // Front axle at +Z
    this.axleF.castShadow = true;

    this.axleR = new THREE.Mesh(getAxleGeo(), matWheel);
    this.axleR.position.set(0, 0.37, -1.62); // Rear axle at -Z
    this.axleR.castShadow = true;

    this.carGroup.add(this.axleF, this.axleR);
    this.carGroup.position.set(0, 0, 0);
    this.scene.add(this.carGroup);

    // Speed Trail Particles
    this.createSpeedParticles();
  }

  createSpeedParticles() {
    const count = 70;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 7;
      positions[i * 3 + 1] = Math.random() * 2.2 + 0.1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30 + 5;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.09,
      transparent: true,
      opacity: 0.65
    });
    this.speedParticles = new THREE.Points(pGeo, pMat);
    this.scene.add(this.speedParticles);
  }

  bindUIEvents() {
    const btnOpenTitle = document.getElementById('btnOpenGyroLab');
    const btnOpenPause = document.getElementById('pOpenGyroLab');
    const btnClose = document.getElementById('gyroLabClose');
    const btnSave = document.getElementById('gyroLabSave');
    const btnCal = document.getElementById('gyroLabCalibrateBtn');

    if (btnOpenTitle) btnOpenTitle.onclick = () => this.open();
    if (btnOpenPause) btnOpenPause.onclick = () => this.open();
    if (btnClose) btnClose.onclick = () => this.close();
    if (btnSave) btnSave.onclick = () => this.close();
    if (btnCal) btnCal.onclick = () => {
      this.tiltCtrl.calibrate();
      this.pulseCalibrateUI();
    };

    // Steer Axis Mode Selector (Auto / Beta / Gamma / Accel)
    const axisSeg = document.getElementById('gyroLabAxisSeg');
    if (axisSeg) {
      [...axisSeg.children].forEach(btn => {
        btn.onclick = () => {
          this.tiltCtrl.steerAxis = btn.dataset.axis || 'auto';
          this.tiltCtrl.saveSettings();
          this.updateControlsUI();
        };
      });
    }

    // Invert Steer & Invert Pitch toggles
    const tglInvertSteer = document.getElementById('gyroLabInvertSteer');
    if (tglInvertSteer) {
      tglInvertSteer.onclick = () => {
        this.tiltCtrl.invertSteer = !this.tiltCtrl.invertSteer;
        this.tiltCtrl.saveSettings();
        this.updateControlsUI();
      };
    }

    const tglInvertPitch = document.getElementById('gyroLabInvertPitch');
    if (tglInvertPitch) {
      tglInvertPitch.onclick = () => {
        this.tiltCtrl.invertPitch = !this.tiltCtrl.invertPitch;
        this.tiltCtrl.saveSettings();
        this.updateControlsUI();
      };
    }

    // Throttle Scheme Mode (Tilt vs Touch vs Auto)
    const throttleModeSeg = document.getElementById('gyroLabThrottleMode');
    if (throttleModeSeg) {
      [...throttleModeSeg.children].forEach(btn => {
        btn.onclick = () => {
          this.tiltCtrl.throttleMode = btn.dataset.mode || 'tilt';
          this.tiltCtrl.saveSettings();
          this.updateControlsUI();
        };
      });
    }

    // Sensitivity presets
    const sensSeg = document.getElementById('gyroLabSensSeg');
    if (sensSeg) {
      [...sensSeg.children].forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx, 10);
          this.tiltCtrl.setSensitivity(idx);
          this.updateControlsUI();
        };
      });
    }

    // Sensitivity precision slider
    const sensSlider = document.getElementById('gyroLabSensSlider');
    if (sensSlider) {
      sensSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.tiltCtrl.customSens = val;
        this.tiltCtrl.saveSettings();
        const lbl = document.getElementById('gyroLabSensVal');
        if (lbl) lbl.textContent = `${val.toFixed(1)}x`;
      };
    }

    // Deadzone slider
    const dzSlider = document.getElementById('gyroLabDeadzoneSlider');
    if (dzSlider) {
      dzSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.tiltCtrl.deadzone = val;
        this.tiltCtrl.saveSettings();
        const lbl = document.getElementById('gyroLabDeadzoneVal');
        if (lbl) lbl.textContent = `${val.toFixed(1)}°`;
      };
    }

    // Pointer drag testing on the canvas for desktop simulation
    this.canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = (e.clientX - this.dragStartX) / (this.canvas.clientWidth * 0.32);
      const dy = -(e.clientY - this.dragStartY) / (this.canvas.clientHeight * 0.32);
      this.tiltCtrl.simulatedSteer = Math.max(-1, Math.min(1, dx));
      this.tiltCtrl.simulatedPitch = Math.max(-1, Math.min(1, dy));
      this.tiltCtrl.processSensors();
    });
    const endDrag = () => {
      this.isDragging = false;
      this.tiltCtrl.simulatedSteer = 0;
      this.tiltCtrl.simulatedPitch = 0;
      this.tiltCtrl.processSensors();
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    // Resize observer for canvas
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.handleResize()).observe(this.canvas);
    }
  }

  pulseCalibrateUI() {
    const btn = document.getElementById('gyroLabCalibrateBtn');
    const toast = document.getElementById('gyroLabCalNotice');
    if (btn) {
      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 500);
    }
    if (toast) {
      toast.textContent = '✓ CURRENT POSITION SET AS NEUTRAL (0°, 0°)';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }
  }

  handleResize() {
    if (!this.renderer || !this.camera || !this.canvas) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async open() {
    this.isOpen = true;
    if (this.container) this.container.classList.remove('hidden');
    await this.tiltCtrl.enable();
    this.updateControlsUI();
    this.handleResize();
    this.lastTime = performance.now();
    this.loop();
  }

  close() {
    this.isOpen = false;
    if (this.container) this.container.classList.add('hidden');
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  updateControlsUI() {
    const axisSeg = document.getElementById('gyroLabAxisSeg');
    if (axisSeg) {
      [...axisSeg.children].forEach(btn => {
        btn.classList.toggle('sel', btn.dataset.axis === this.tiltCtrl.steerAxis);
      });
    }

    const tglInvertSteer = document.getElementById('gyroLabInvertSteer');
    if (tglInvertSteer) {
      tglInvertSteer.textContent = `STEER INVERT: ${this.tiltCtrl.invertSteer ? 'ON (FLIPPED)' : 'OFF (NORMAL)'}`;
      tglInvertSteer.classList.toggle('active', this.tiltCtrl.invertSteer);
    }

    const tglInvertPitch = document.getElementById('gyroLabInvertPitch');
    if (tglInvertPitch) {
      tglInvertPitch.textContent = `PITCH/GAS INVERT: ${this.tiltCtrl.invertPitch ? 'ON (FLIPPED)' : 'OFF (NORMAL)'}`;
      tglInvertPitch.classList.toggle('active', this.tiltCtrl.invertPitch);
    }

    const throttleModeSeg = document.getElementById('gyroLabThrottleMode');
    if (throttleModeSeg) {
      [...throttleModeSeg.children].forEach(btn => {
        btn.classList.toggle('sel', btn.dataset.mode === this.tiltCtrl.throttleMode);
      });
    }

    const sensSeg = document.getElementById('gyroLabSensSeg');
    if (sensSeg) {
      [...sensSeg.children].forEach((btn, i) => {
        btn.classList.toggle('sel', i === this.tiltCtrl.sensitivityIdx);
      });
    }

    const sensSlider = document.getElementById('gyroLabSensSlider');
    const sensVal = document.getElementById('gyroLabSensVal');
    if (sensSlider) sensSlider.value = this.tiltCtrl.customSens || this.tiltCtrl.currentSensitivity.mult;
    if (sensVal) sensVal.textContent = `${(this.tiltCtrl.customSens || this.tiltCtrl.currentSensitivity.mult).toFixed(1)}x`;

    const dzSlider = document.getElementById('gyroLabDeadzoneSlider');
    const dzVal = document.getElementById('gyroLabDeadzoneVal');
    if (dzSlider) dzSlider.value = this.tiltCtrl.deadzone;
    if (dzVal) dzVal.textContent = `${this.tiltCtrl.deadzone.toFixed(1)}°`;
  }

  loop() {
    if (!this.isOpen) return;
    this.animId = requestAnimationFrame(() => this.loop());

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Get current outputs from TiltController
    const steer = this.tiltCtrl.steer;
    const throttle = this.tiltCtrl.throttle;
    const brake = this.tiltCtrl.brake;

    // Simulated speed in km/h
    const targetSpeed = throttle > 0.02 ? throttle * 220 : (brake > 0.02 ? 0 : 35);
    this.simSpeed += (targetSpeed - this.simSpeed) * Math.min(1, dt * 6);

    // 1. Articulate Front Wheel Steering Angle
    // When steer > 0 (steer right), front wheels steer right
    const steerAngle = steer * 0.45;
    this.axleF.rotation.y += (steerAngle - this.axleF.rotation.y) * Math.min(1, dt * 24);

    // Continuous Wheel Rotation
    this.wheelRot += (this.simSpeed / 3.6) / 0.37 * dt;
    this.axleF.rotation.x = this.wheelRot;
    this.axleR.rotation.x = this.wheelRot;

    // 2. Chassis Lateral Roll into Turn & Pitch Squat/Dive (when viewed from behind)
    const targetRoll = -steer * 0.08;   // Leaning chassis under cornering G
    const targetPitch = (throttle * -0.04) + (brake * 0.07); // Squat on acceleration, dive on braking
    const targetYaw = steer * 0.14;    // Nose heading into corner

    this.carGroup.rotation.z += (targetRoll - this.carGroup.rotation.z) * Math.min(1, dt * 14);
    this.carGroup.rotation.x += (targetPitch - this.carGroup.rotation.x) * Math.min(1, dt * 14);
    this.carGroup.rotation.y += (targetYaw - this.carGroup.rotation.y) * Math.min(1, dt * 14);

    // 3. Driver Helmet & Neck Dynamics
    if (this.helmetGroup) {
      const helmetTurn = steer * 0.35; // Driver looks into the corner apex
      const helmetLean = -steer * 0.12; // Lateral G-force lean
      const helmetPitch = (throttle * 0.05) - (brake * 0.12); // Brake nod & acceleration pushback
      this.helmetGroup.rotation.y += (helmetTurn - this.helmetGroup.rotation.y) * Math.min(1, dt * 18);
      this.helmetGroup.rotation.z += (helmetLean - this.helmetGroup.rotation.z) * Math.min(1, dt * 16);
      this.helmetGroup.rotation.x += (helmetPitch - this.helmetGroup.rotation.x) * Math.min(1, dt * 18);
    }

    // 4. Rear Rain/Brake Light Flash
    if (this.rearBrakeLight) {
      this.rearBrakeLight.intensity = brake > 0.05 ? 3.5 : (this.simSpeed < 5 ? 0.8 : 0.2);
    }

    // 5. Road Markings & Speed Particles Motion (flowing under the car from +Z towards -Z)
    const moveDist = (this.simSpeed * 0.09) * dt;
    this.stripes.forEach(s => {
      s.position.z -= moveDist * 14;
      if (s.position.z < -25) s.position.z += 55;
    });

    if (this.speedParticles) {
      const pos = this.speedParticles.geometry.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[i * 3 + 2] -= moveDist * 20;
        if (pos[i * 3 + 2] < -25) pos[i * 3 + 2] += 55;
      }
      this.speedParticles.geometry.attributes.position.needsUpdate = true;
    }

    // 6. Update Lab Live Diagnostic Gauges & Telemetry Readouts
    this.updateLiveDiagnostics(steer, throttle, brake);

    this.renderer.render(this.scene, this.camera);
  }

  updateLiveDiagnostics(steer, throttle, brake) {
    const steerBar = document.getElementById('labSteerPip');
    const steerVal = document.getElementById('labSteerVal');
    const gasBar = document.getElementById('labGasBar');
    const gasVal = document.getElementById('labGasVal');
    const brakeBar = document.getElementById('labBrakeBar');
    const brakeVal = document.getElementById('labBrakeVal');
    const rawSensor = document.getElementById('labRawSensor');
    const orientStatus = document.getElementById('labOrientStatus');

    if (steerBar) {
      // steer: -1.0 (full left) to +1.0 (full right) -> 0% to 100%
      const pct = (steer + 1.0) * 50;
      steerBar.style.left = `${pct}%`;
    }
    if (steerVal) {
      const lockPct = Math.round(Math.abs(steer) * 100);
      if (lockPct < 3) {
        steerVal.textContent = 'CENTERED (0%)';
        steerVal.style.color = '#00f0ff';
      } else {
        steerVal.textContent = `${steer < 0 ? '◄ LEFT' : 'RIGHT ►'} ${lockPct}%`;
        steerVal.style.color = steer < 0 ? '#38bdf8' : '#a855f7';
      }
    }

    if (gasBar) gasBar.style.width = `${Math.round(throttle * 100)}%`;
    if (gasVal) gasVal.textContent = `${Math.round(throttle * 100)}%`;

    if (brakeBar) brakeBar.style.width = `${Math.round(brake * 100)}%`;
    if (brakeVal) brakeVal.textContent = `${Math.round(brake * 100)}%`;

    if (rawSensor) {
      const b = Math.round(this.tiltCtrl.currentBeta);
      const g = Math.round(this.tiltCtrl.currentGamma);
      const ax = (this.tiltCtrl.accX || 0).toFixed(1);
      const ay = (this.tiltCtrl.accY || 0).toFixed(1);
      rawSensor.textContent = `RAW: β=${b}° γ=${g}° | Accel: [${ax}, ${ay}]`;
    }

    if (orientStatus) {
      const degDiff = Math.round(this.tiltCtrl.lastSteerDeg || 0);
      const axis = this.tiltCtrl.steerAxis.toUpperCase();
      orientStatus.textContent = `STEER Δ: ${degDiff > 0 ? '+' : ''}${degDiff}° | AXIS: ${axis}`;
    }
  }
}
