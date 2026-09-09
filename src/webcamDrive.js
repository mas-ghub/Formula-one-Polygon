/* ============ Webcam Face-Drive Controller ============
   Drives the car with your face, for machines that have a camera:

     STEER  — turn your head: followed at the NOSE tip or the EYE line
              (selectable). Turning your head right steers right.
     GAS    — either OPEN YOUR MOUTH (the wider, the harder you push)
              or TILT YOUR HEAD (nose up = gas). Tilting the nose down
              brakes in both modes, so there is always a way to stop.
     Keys / tilt always win when touched; the face fills the rest.

   Landmarks come from Google's MediaPipe FaceLandmarker, loaded on demand
   from jsDelivr the first time the feature is switched on (no build weight,
   ~4 MB model on first use, cached by the browser afterwards). Detection
   runs on a tiny 320x240 stream at ~15 Hz, so the per-frame cost of the
   rest of the game is unchanged; the sim just reads the already-smoothed
   outputs. Nothing is uploaded: the stream never leaves this browser. */

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_URL = VISION_URL + '/wasm';
// Canonical compact FaceLandmarker model (mirrors listed in hit order).
const MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-assets/face_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float32/1/face_landmarker.task'
];

// Canonical FaceMesh indices (468-point topology, always present).
const LM = {
  nose: 1,            // nose tip
  lipTop: 13,         // inner upper lip
  lipBot: 14,         // inner lower lip
  forehead: 10, chin: 152,           // face height reference
  cheekL: 234, cheekR: 454,          // face width reference
  eyeLO: 33, eyeLI: 133, eyeRO: 362, eyeRI: 263 // eye corners
};
const DETECT_MS = 66;          // ~15 Hz — plenty for steering, rest interpolated
const STORE_KEY = 'f1_webcam_drive_v1';

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class WebcamDrive {
  constructor(opts = {}) {
    this.onStatus = opts.onStatus || (() => {});
    // 'off' | 'starting' | 'live' | 'error' — the sim only drives on 'live'.
    this.state = 'off';
    this.error = '';

    // Outputs for car physics (read by playerControl)
    this.steer = 0;      // -1 left … +1 right
    this.throttle = 0;   // 0…1 gas
    this.brake = 0;      // 0…1 brake (head tipped down)
    this.faceOk = false;

    // Settings
    this.steerSrc = 'nose';   // 'nose' | 'eyes'
    this.pedalMode = 'auto';  // 'auto' | 'tilt' | 'mouth'
    this.sens = 1.0;          // steering sensitivity multiplier
    this.invert = false;      // for cameras that deliver a mirrored image
    this.preview = true;
    this.wanted = false;      // user wants it on — resume automatically on restart

    // Internals
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this._vision = null;
    this._lastDetect = 0;
    this._rafAlive = false;
    this._faceLostAt = 0;
    this._cal = null;         // calibration accumulator
    this._base = null;        // {x,y,mouth} neutral pose
    this._calBlink = 0;
    this.loadSettings();
  }

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (s.steerSrc === 'eyes') this.steerSrc = 'eyes';
      if (s.pedalMode === 'tilt' || s.pedalMode === 'mouth' || s.pedalMode === 'auto') this.pedalMode = s.pedalMode;
      if (typeof s.sens === 'number') this.sens = Math.min(2, Math.max(0.4, s.sens));
      if (typeof s.invert === 'boolean') this.invert = s.invert;
      if (typeof s.preview === 'boolean') this.preview = s.preview;
      if (typeof s.wanted === 'boolean') this.wanted = s.wanted;
    } catch (e) { /* keep defaults */ }
  }
  saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        steerSrc: this.steerSrc, pedalMode: this.pedalMode, sens: this.sens,
        invert: this.invert, preview: this.preview, wanted: this.wanted
      }));
    } catch (e) { /* private browsing — live without persistence */ }
  }

  /** Turn on. Must be called from a user gesture (browser camera rule). */
  async enable() {
    if (this.state === 'live') return true;
    if (this.state === 'starting') return false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.state = 'error'; this.error = 'This browser has no camera API.';
      this.onStatus('FACE DRIVE — NO CAMERA API IN THIS BROWSER');
      return false;
    }
    this.state = 'starting';
    this.onStatus('FACE DRIVE — STARTING CAMERA…');
    try {
      // 1. Open the camera first (gesture context is freshest here).
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
        audio: false
      });
      if (!this.video) {
        this.video = document.createElement('video');
        this.video.playsInline = true; this.video.muted = true; this.video.autoplay = true;
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      // 2. Lazy-load the face model (once per session).
      if (!this.landmarker) {
        this.onStatus('FACE DRIVE — LOADING FACE MODEL (FIRST TIME)…');
        await this._loadModel();
      }
      this.state = 'live';
      this.wanted = true; this.saveSettings();
      this._faceLostAt = 0; this._base = null;
      this._startLoop();
      // Auto-calibrate as soon as a stable face shows up.
      this._cal = { n: 0, x: 0, y: 0, yaw: 0, mouth: 0, until: performance.now() + 1400 };
      this._calBlink = performance.now() + 1400;
      this.onStatus('FACE DRIVE LIVE — HOLD STILL: CALIBRATING NEUTRAL');
      return true;
    } catch (e) {
      this.state = 'error';
      this.wanted = false; this.saveSettings();
      const n = (e && e.name) || '';
      this.error =
        n === 'NotAllowedError' ? 'Camera permission denied — allow the webcam and retry.' :
        n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No webcam found on this machine.' :
        ((e && e.message) || 'Camera failed to start.');
      this._stopMedia();
      this.onStatus('FACE DRIVE — ' + this.error.toUpperCase());
      return false;
    }
  }

  async _loadModel() {
    if (!this._vision) {
      const mod = await import(/* @vite-ignore */ VISION_URL);
      this._vision = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      this._FaceLandmarker = mod.FaceLandmarker;
    }
    const mk = async (delegate) => {
      let lastErr = null;
      for (const url of MODEL_URLS) {
        try {
          return await this._FaceLandmarker.createFromOptions(this._vision, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.4, minTrackingConfidence: 0.4
          });
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('face model unavailable');
    };
    try { this.landmarker = await mk('GPU'); }
    catch (e) { this.landmarker = await mk('CPU'); }
  }

  disable() {
    this.wanted = false; this.saveSettings();
    this._stopMedia();
    this.state = 'off';
    this.steer = this.throttle = this.brake = 0;
    this.faceOk = false;
    this._paintOff();
  }

  _stopMedia() {
    this._rafAlive = false;
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    if (this.video) this.video.srcObject = null;
  }

  _startLoop() {
    if (this._rafAlive) return;
    this._rafAlive = true;
    const step = () => {
      if (!this._rafAlive) return;
      this._tick();
      const v = this.video;
      if (v && v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
      else setTimeout(step, DETECT_MS);
    };
    step();
  }

  _tick() {
    if (this.state !== 'live' || !this.landmarker || !this.video) return;
    if (document.hidden) { this._decay(0.86); return; }
    const now = performance.now();
    if (now - this._lastDetect < DETECT_MS) return;
    if (this.video.readyState < 2) return;
    this._lastDetect = now;

    let lms = null;
    try {
      const res = this.landmarker.detectForVideo(this.video, now);
      lms = res && res.faceLandmarks && res.faceLandmarks[0];
    } catch (e) { return; }

    if (!lms || lms.length < 200) {
      // Face lost: coast the outputs down quickly so the car does not keep a
      // stale command, but give the tracker a beat before dropping to zero.
      if (this.faceOk) this._faceLostAt = now;
      this.faceOk = false;
      if (now - this._faceLostAt > 800) this._decay(0.82);
      this._draw();
      return;
    }
    this.faceOk = true;

    const faceW = Math.max(0.02, dist2(lms[LM.cheekL], lms[LM.cheekR]));
    const faceH = Math.max(0.02, dist2(lms[LM.forehead], lms[LM.chin]));
    const sx = this.steerSrc === 'eyes'
      ? (lms[LM.eyeLO].x + lms[LM.eyeLI].x + lms[LM.eyeRO].x + lms[LM.eyeRI].x) / 4
      : lms[LM.nose].x;
    const ny = lms[LM.nose].y;
    const mouth = dist2(lms[LM.lipTop], lms[LM.lipBot]) / faceH;

    // Calibration: average the pose over the window, then drive.
    if (this._cal) {
      const c = this._cal;
      const calFaceCentreX = (lms[LM.cheekL].x + lms[LM.cheekR].x) * 0.5;
      c.n++; c.x += sx; c.y += ny; c.yaw += (calFaceCentreX - lms[LM.nose].x) / faceW; c.mouth += mouth;
      if (now > c.until && c.n >= 10) {
        this._base = { x: c.x / c.n, y: c.y / c.n, yaw: c.yaw / c.n, mouth: c.mouth / c.n };
        this._cal = null;
        this.onStatus('FACE DRIVE CALIBRATED — TURN FACE TO STEER');
      }
      this._draw(lms);
      return;
    }
    if (!this._base) {
      const calFaceCentreX = (lms[LM.cheekL].x + lms[LM.cheekR].x) * 0.5;
      this._cal = { n: 1, x: sx, y: ny, yaw: (calFaceCentreX - lms[LM.nose].x) / faceW, mouth, until: now + 1400 }; return; }
    const b = this._base;

    // Steering: combine actual head TURN/yaw with side movement. The previous
    // version mainly followed lateral translation, so turning your head could
    // feel backwards/weak depending on webcam mirroring. Yaw is measured by the
    // nose moving relative to the cheek centre: user turns right => nose moves
    // toward image-left on a normal selfie camera => positive steer/right.
    const faceCentreX = (lms[LM.cheekL].x + lms[LM.cheekR].x) * 0.5;
    const yawNow = (faceCentreX - lms[LM.nose].x) / faceW;
    const yawBase = b.yaw || 0;
    const moveD = (b.x - sx) / faceW;
    let d = (yawNow - yawBase) * 1.35 + moveD * 0.35;
    if (this.invert) d = -d;
    const dz = 0.020, span = 0.135 / this.sens;
    let tgt = 0;
    if (Math.abs(d) > dz) tgt = Math.max(-1, Math.min(1, (Math.abs(d) - dz) / Math.max(0.04, span - dz) * Math.sign(d)));
    this.steer += (tgt - this.steer) * 0.42;

    // Pedals.
    let gas = 0, brk = 0;
    const pitch = (b.y - ny) / faceH;       // + : nose above neutral (tilted up)
    if (this.pedalMode === 'mouth') {
      gas = Math.max(0, Math.min(1, (mouth - b.mouth - 0.016) / 0.085));
      brk = Math.max(0, Math.min(1, (-pitch - 0.055) / 0.06));
    } else if (this.pedalMode === 'tilt') {
      gas = Math.max(0, Math.min(1, (pitch - 0.045) / 0.075));
      brk = Math.max(0, Math.min(1, (-pitch - 0.045) / 0.065));
    } else {
      // Auto-gas mode is the practical face-control default: neutral/up keeps
      // the F1 car accelerating; tip the head down to brake, and keep holding
      // it down at low speed to use the game's reverse gear.
      brk = Math.max(0, Math.min(1, (-pitch - 0.040) / 0.070));
      gas = brk > 0.10 ? 0 : 1;
    }
    this.throttle += (gas - this.throttle) * 0.5;
    this.brake += (brk - this.brake) * 0.5;
    this._draw(lms);
  }

  _decay(f) {
    this.steer *= f; this.throttle *= f; this.brake *= f;
    if (Math.abs(this.steer) < 0.01) this.steer = 0;
    if (this.throttle < 0.01) this.throttle = 0;
    if (this.brake < 0.01) this.brake = 0;
  }

  /** Re-zero the neutral pose (hold your head still, mouth closed). */
  calibrate() {
    if (this.state !== 'live') { this.onStatus('START FACE DRIVE FIRST'); return; }
    this._cal = { n: 0, x: 0, y: 0, yaw: 0, mouth: 0, until: performance.now() + 1200 };
    this._calBlink = performance.now() + 1200;
    this.onStatus('HOLD STILL — CALIBRATING NEUTRAL POSE…');
  }

  /* ---- status drawing (HUD preview + menu preview share the painter) ---- */
  _paintOff() {
    for (const id of ['facePreview', 'tFaceCam']) {
      const c = document.getElementById(id);
      if (c) c.style.display = 'none';
    }
  }
  updateHUD() { this._draw(); }
  _draw(lms) {
    for (const id of ['facePreview', 'tFaceCam']) {
      const cv = document.getElementById(id);
      if (!cv || !cv.offsetParent) continue;
      if (this.state !== 'live') { cv.style.display = 'none'; continue; }
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, w, h);
      if (this.preview && this.video && this.video.readyState >= 2) {
        ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);       // mirror: natural feel
        try { ctx.drawImage(this.video, 0, 0, w, h); } catch (e) {}
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, w, h);
      }
      // Status dot: green tracking, amber face lost.
      ctx.fillStyle = this.faceOk ? '#43d675' : '#f2c14e';
      ctx.beginPath(); ctx.arc(9, 9, 4, 0, 7); ctx.fill();
      // Steering bar
      ctx.fillStyle = '#20242a'; ctx.fillRect(18, 5, w - 26, 8);
      ctx.fillStyle = '#00f0ff';
      const sw = (w - 26) / 2 * this.steer;
      ctx.fillRect(18 + (w - 26) / 2 + Math.min(0, sw), 5, Math.abs(sw), 8);
      // Gas + brake bars
      ctx.fillStyle = '#20242a'; ctx.fillRect(0, h - 6, w, 3); ctx.fillRect(0, h - 11, w, 3);
      ctx.fillStyle = '#43d675'; ctx.fillRect(0, h - 6, w * this.throttle, 3);
      ctx.fillStyle = '#e10600'; ctx.fillRect(0, h - 11, w * this.brake, 3);
      if (lms && this.preview) {
        ctx.fillStyle = '#7dc9ff';
        for (const i of [LM.nose, LM.lipTop, LM.lipBot, LM.eyeLO, LM.eyeRI]) {
          ctx.fillRect((1 - lms[i].x) * w - 1, lms[i].y * h - 1, 2.5, 2.5);
        }
      }
      if (!this.faceOk || performance.now() < this._calBlink) {
        ctx.fillStyle = '#f2f4f6'; ctx.font = '700 9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(this.faceOk ? 'CALIBRATING…' : 'FACE LOST', w / 2, h / 2 + 3);
      }
    }
  }
}
