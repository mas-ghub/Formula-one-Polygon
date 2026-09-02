// Drives the real TiltController against a stub DOM/window to check the state
// machine: permission outcome, sensor watchdog, re-centring, and UI labels.
const listeners = {};
const els = {};
function mkEl(id) {
  return els[id] || (els[id] = {
    id, textContent: '', title: '', style: {}, _cls: new Set(),
    classList: {
      add(c) { els[id]._cls.add(c); }, remove(c) { els[id]._cls.delete(c); },
      toggle(c, on) { if (on) els[id]._cls.add(c); else els[id]._cls.delete(c); },
      contains(c) { return els[id]._cls.has(c); }
    }
  });
}
globalThis.document = { getElementById: mkEl, body: { classList: { add() {}, remove() {} } }, createElement: () => ({ style: {}, getContext: () => ({}) }) };
let orientEvents = true;
globalThis.window = {
  addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
  removeEventListener(n, f) { if (listeners[n]) listeners[n] = listeners[n].filter(x => x !== f); },
  innerWidth: 900, innerHeight: 500, DeviceOrientationEvent: null, DeviceMotionEvent: null,
  orientation: 90
};
globalThis.screen = { orientation: { angle: 90 } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.matchMedia = () => ({ matches: true });

const { TiltController } = await import('/home/user/Formula-one-Polygon/src/tiltControls.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fire = (t, e) => (listeners[t] || []).forEach(f => f(e));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + ' ' + extra); } };

function fresh(doe) {
  for (const k in listeners) delete listeners[k];
  globalThis.window.DeviceOrientationEvent = doe;
  globalThis.window.DeviceMotionEvent = doe ? { requestPermission: doe.requestPermission } : null;
  const t = new TiltController();
  t.enable = t.enable.bind(t);
  return t;
}

// 1. permission granted and the sensor talks
{
  const t = fresh({ requestPermission: async () => 'granted' });
  const p = t.enable();
  await sleep(30);
  // the stream is continuous in reality; the baseline is taken one frame after
  // the sensor is known alive, so hold the level pose for a moment…
  for (let i = 0; i < 4; i++) { fire('deviceorientation', { beta: 2, gamma: 1.2, alpha: 0 }); await sleep(20); }
  const ok = await p;
  // …then turn in (same numbers a wrist flick would produce)
  for (let i = 0; i < 12; i++) { fire('deviceorientation', { beta: 30, gamma: 1.2, alpha: 0 }); await sleep(30); }
  check('granted+live → enable() true', ok === true, String(ok));
  check('granted+live → state live', t.gyroState === 'live', t.gyroState);
  check('granted+live → chip cyan', els.hTiltChip.style.color === '#00f0ff' && /GYRO \[/.test(els.hTiltChip.textContent), els.hTiltChip.textContent);
  check('granted+live → steer driven by sensor', Math.abs(t.steer) > 0, String(t.steer));
}
// 1b. the retry prompt is cleared the moment the sensor goes live
{
  const t = fresh({ requestPermission: async () => 'granted' });
  mkEl('gyroPrompt').classList.add('show');
  const p = t.enable();
  await sleep(30);
  fire('deviceorientation', { beta: 1, gamma: 0, alpha: 0 });
  await p;
  check('live → retry prompt hidden', !els.gyroPrompt.classList.contains('show'), [...els.gyroPrompt._cls].join(','));
}

// 2. permission denied → no listeners, explicit error
{
  const t = fresh({ requestPermission: async () => 'denied' });
  const ok = await t.enable();
  check('denied → enable() false', ok === false, String(ok));
  check('denied → state error', t.gyroState === 'error', t.gyroState);
  check('denied → no listeners attached', !(listeners.deviceorientation || []).length);
  check('denied → chip says ERROR', /GYRO ERROR/.test(els.hTiltChip.textContent), els.hTiltChip.textContent);
  check('denied → reason mentions iOS switch', /Motion & Orientation/.test(t.gyroError), t.gyroError);
}
// 3. requestPermission throws (non-secure origin / Focus) → must NOT be treated as granted
{
  const t = fresh({ requestPermission: async () => { throw new TypeError('Permission blocked'); } });
  const ok = await t.enable();
  check('throwing request → enable() false', ok === false, String(ok));
  check('throwing request → hasPermission false', t.hasPermission === false, String(t.hasPermission));
  check('throwing request → state error', t.gyroState === 'error', t.gyroState);
  check('throwing request → error names the failure', /TypeError/.test(t.gyroError), t.gyroError);
}
// 4. granted but the device never sends anything (iPad with the OS switch off)
{
  const t = fresh({ requestPermission: async () => 'granted' });
  orientEvents = false;
  const p = t.enable();
  await sleep(30);
  check('no data yet → pending', t.gyroState === 'pending', t.gyroState);
  check('no data yet → chip PENDING', /GYRO PENDING/.test(els.hTiltChip.textContent), els.hTiltChip.textContent);
  const ok = await p;   // watchdog ~1.4 s
  check('watchdog → enable() false', ok === false, String(ok));
  check('watchdog → state error', t.gyroState === 'error', t.gyroState);
  check('watchdog → listeners detached', (listeners.deviceorientation || []).length === 0);
  check('watchdog → explains the iPad switch', /Motion & Orientation Access/.test(t.gyroError), t.gyroError);
  check('watchdog → prompt would show (error kept)', /NO SENSOR/.test(els.pTiltToggle.textContent), els.pTiltToggle.textContent);
}
// 5. browser without the iOS permission API (Android/desktop) → not-needed, watchdog decides
{
  const t = fresh({ requestPermission: undefined });
  const p = t.enable();
  await sleep(30);
  fire('devicemotion', { accelerationIncludingGravity: { x: 0.2, y: 9.79, z: 0.1 } });
  const ok = await p;
  check('no requestPermission API → live after accel event', ok === true && t.gyroState === 'live', t.gyroState);
}
// 6. re-enabling recentres the neutral baseline
{
  const t = fresh({ requestPermission: async () => 'granted' });
  const p = t.enable();
  await sleep(30);
  for (let i = 0; i < 4; i++) { fire('deviceorientation', { beta: 0, gamma: 0, alpha: 0 }); await sleep(20); } // held level
  await p;
  for (let i = 0; i < 12; i++) { fire('deviceorientation', { beta: -40, gamma: 0, alpha: 0 }); await sleep(30); } // wrenched over
  const before = t.steer;
  t.disable();
  const p2 = t.enable();
  await sleep(30);
  for (let i = 0; i < 6; i++) { fire('deviceorientation', { beta: -40, gamma: 0, alpha: 0 }); await sleep(25); } // same wrenched pose, new session → new zero
  await p2;
  await sleep(200);
  check('re-enable re-centres (same pose → straight ahead)', Math.abs(t.steer) < 0.05 && Math.abs(before) > 0.2, `before ${before.toFixed(2)} after ${t.steer.toFixed(2)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
