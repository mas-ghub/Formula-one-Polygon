# TESTING.md — the whole project, described so an agent can test it

This file is a *complete* description of the current build: what the game is,
how every system works, exactly which files to read, and which commands prove
that each part of it is right. It is written for an automated agent, so every
claim below is paired with the measurement or command that verifies it. Where
something is **not** verified, that is said out loud.

---

## 1. What this is

`Formula-one-Polygon` ("POLYGON GP") is a browser 3-D arcade F1 game. There is
no bundler-driven React app in the gameplay path: the game is one plain ES
module, `src/game.js` (4,848 lines), loaded directly by `index.html` line 945:
`<script type="module" src="/src/game.js"></script>`. Vite is only a dev server and a
build step.

* **25 circuits**, drawn from the *real racing line* of an actual Grand Prix,
  pre-downloaded to `public/data/circuits/<circuit_key>.json` (23 files; some
  tracks share a key, some fall back to a procedural oval — see §7).
* **20-car grid** with the 2026 driver roster, real team liveries, a Sky-style
  timing tower, and speech commentary.
* **Full weather + time-of-day**: 5 presets × 3 times of day, wet-road
  shading, thunder, snow that accumulates, night with lamp pools on the tarmac.
* **Mobile gyro/tilt steering** with a calibration lab.
* Title screen runs the whole field as an attract mode under a broadcast camera
  director; the same physics and AI as a race.

```
npm install
npm run dev      # vite --port=3000 --host=0.0.0.0
npm run build    # production bundle into dist/
npm run lint     # tsc --noEmit  (currently exits 0 — see §8.1)
```

---

## 2. File map

| path | lines | what it owns |
|---|---|---|
| `src/game.js` | 4848 | everything: scene, terrain, cars, physics, AI, HUD, audio, weather |
| `src/tracks.js` | 448 | 25 circuits (check: `grep -c "name: '" src/tracks.js` → 25): `name`, `pts` fallback, `openf1CircuitKey`, `runoff`, `grass`, colors |
| `src/circuitData.js` | 152 | `loadRealCircuits()` — local JSON → live OpenF1 → nothing (sets `def.realPts`) |
| `src/rainShader.js` | 231 | windshield droplet/refraction pass (renders the scene to its own RT) |
| `src/snowShader.js` | 109 | screen-space flake overlay + `uBurst` gust (now actually wired in, §6.5) |
| `src/postfx.js` | 133 | EffectComposer chain: MSAA RT → bloom → **custom ACES grade pass** |
| `src/quality.js` | 225 | `QUALITY_PRESETS` (LOW/MED/HIGH/ULTRA) + `QualityManager.apply/resolvedLevel()` |
| `src/tiltControls.js` | 592 | gyro/tilt state machine, sensor permission watchdog |
| `src/gyroLab.js` | 511 | in-game calibration UI |
| `src/teamLivery.js` | 28 | `accentFor(team)` |
| `index.html` | 949 | all HUD markup + inline CSS; chips at `#hWx`, `#hCam`, `#hQualityChip`, `#hTiltChip`, `#hTowerChip` |
| `scripts/fetch-openf1-data.mjs` | – | re-downloads `public/data/` |
| `tools/*.mjs` | – | the headless verification suite (§8) |

---

## 3. Where to find things in `src/game.js`

Line numbers are from this revision (`src/game.js` = 4,848 lines) and will drift.
The *anchor* column is the stable thing — grep for the string, never hard-code a
number into a patch script.

| system | anchor to grep | line |
|---|---|---|
| global state | `const state={mode:'boot'` | 32 |
| time-of-day table | `const TOD={` | 38 |
| weather presets | `const WX={` | 297 |
| speech voice scoring | `const score=v=>{let s=0` | 319 |
| renderer / lights | `new THREE.WebGLRenderer` | 394 |
| PostFX hook | `const postfx=new PostFX(` | 456 |
| canvas textures | `function ctex(c,rep){` | 461 |
| body geometry | `export function getBodyGeo(colA,colB){` | 710 |
| driver + helmet | `export function makeDriverMesh(colA, helmetCol){` | 798 |
| wheel/brake geometry | `export function getAxleGeo(){` | 874 |
| car assembly | `function makeCarMesh(d){` | 937 |
| weather FX (rain/snow particles) | `function updWeatherFX(dt){` | 1068 |
| weather → look | `function applyWeatherVisuals(){` | 1199 |
| night lamp level | `function setNightGlow(){` | 1239 |
| lightning | `function updLightning(dt)` | 1252 |
| track build | `function buildWorld(idx)` | 1282 |
| track sampling | `samples[i].curv=d/(len/N*2)` | 1310 |
| surface authority | `T.terrainSample=surfaceHeightAt` | 1803 |
| tarmac skin | `s.p.y+0.05` | 1812 |
| night lamp rigs | `T.nightMats=[]` | 2003 |
| physics constants | `const PH={top:79,eng:20,brk:26,drag:0.00115}` | 2578 |
| AI corner speed | `const tvLim=Math.min(` | 2829 |
| car physics | `const cap=46*grip/Math.max(Math.abs(sp0),2)` | 2960 |
| motion rig | `function updCarVisual(c,dt){` | 3134 |
| camera modes | `const CAM_NAMES=` | 43 |
| helmet cam | `/* Helmet cam — the camera rides ON` | 3725 |
| keyboard | `if(k==='KeyC')cycleCam();` | 4387 |
| render path | `if(!postfx.render(timeSec))renderer.render` | 4781 |

---

## 4. Controls (manual browser test)

* Keyboard: gas/brake `W`/`S` or `↑`/`↓`, steer `A`/`D` or `←`/`→`, drift `Shift`,
  DRS `E`, **`C` cycles the six camera modes**, `R` resets the player, `F`
  fullscreen, `M` mute, `P`/`Esc` pause.
* Touch: device tilt steers when the `GYRO` chip is armed (Settings ▸ Controls).
* HUD chips: weather `#hCamChip`/`#hWx` are clickable; `#hCamChip` cycles cameras.
* Settings screen segments: `tWeather` (5 presets), `tDiff`
  (`RELAXED/NORMAL/PRO` → `state.diffMul = 0.88 / 0.97 / 1.05`, line 4558-ish),
  `tGrid` (`10/14/20 CARS`), quality, laps, track.

---

## 5. The car: model, rig and animation

### 5.1 Geometry (built once, cached, merged)

`getBodyGeo(colA,colB)` merges ~60 `part()` boxes/cylinders into **one**
geometry per colour pair (cached in `bodyCache`), so a 20-car grid is a handful
of draw calls. Contents, all measured in the car's local frame (+Z is forward,
y=0 is the axle line):

* floor, survival cell, **drooping 2026 nose beak** (`noseGeo`, a tapered
  frustum whose front face is narrower *and* lower), front wing with two
  elements + endplates + pylons,
* **the halo**: a real closed hoop, not a decorative arc. It is a
  `THREE.TubeGeometry` (radius 0.05 = 50 mm tube) swept along a
  `CatmullRomCurve3` of 18 points that rises from the chassis mounts at
  (±0.60, 0.60, 0.28), over the crown at (0, **1.10**, 0.22), back down to the
  other mount; one forward load pillar with a foot plate to the bulkhead;
  aero winglets and mounting pads; a rear impact structure; cockpit surround
  with mirror stalks and a dashboard.
* sidepods, engine cover, gearbox, rear wing + **DRS flap** (separate mesh
  `drsGeo`, hinged), diffuser, rain light / brake light, exhaust.

`getAxleGeo()` returns `{axle, brakes}`: each wheel is tyre + alloy barrel +
gold centre nut + 5 radial spokes (so the spin is visible), **plus** the
uprights, pushrods, lower wishbones and brake ducts merged into the *axle*
geometry. The two discs are merged into a **separate** `brakeGeo` because they
must not spin with the wheel.

`makeDriverMesh()` returns `{driverGroup, helmetGroup}`: suit torso/arms/gloves
with harness straps, a **separate `steering` yoke mesh** (rim, spokes, lit
display, LED strip) exposed as `driverGroup.userData.steering` → `car.mesh.steering`,
and a helmet with sun visour, roof camera pod, HANS tether and centre stripe.

> **Attribute gotcha:** `mergeGeometries` refuses to merge geometries with
> different attribute sets, and `TubeGeometry` has no `uv`. That is what
> `ensureUV(geo)` (anchor `function ensureUV(geo)`) is for. Any new part added
> to a merged group must go through `part()`, which calls it.

### 5.2 Verified model facts

`node tools/car_preview.mjs` builds the real `makeCarMesh()` headlessly and
prints (values as of this write-up):

```
car meshes: 14  triangles: 3656
bbox  x:[-1.69,1.69]  y:[-0.01,1.15]  z:[-2.63,2.98]
helmet bbox y:[0.64,0.98]  z:[0.16,0.55]
extras: brakes=true steering=true driverGroup=true
hoop above crown: 0.079 m of clearance
halo sample hits over the cockpit (z -0.4..0.6): 25/35
wrote side.png, front34.png, rear34.png, halo_top.png to /tmp/car
```

The tool ignores meshes tagged `userData.fx` (headlight beam, light pool,
tail glow): they are additive optical effects, not bodywork, and counting them
inflated the reported bbox to 6.5 m wide and 19 m long.

* 3.38 m wide, 5.61 m long, 1.16 m tall — legal-ish F1 proportions.
* The helmet is *inside* the cockpit (`z` 0.16…0.55) and the hoop passes over
  it with 79 mm of clearance (measured by a raycast from the crown, not
  eyeballed).
* "25/35" counts solid material found by 35 downward rays across the cockpit
  roof band; a broken/half hoop scores much lower. Re-run the tool if you touch
  the halo — this is the check that the "half a hoop" bug is gone.
* The same tool rasterises the car to PNGs with its own z-buffer and lighting,
  so the model can be *looked at* headlessly (`OUT=/some/dir` to choose the
  folder; 900×420 by default, `W`/`HD` env vars to change).

### 5.3 The motion rig (`updCarVisual`)

Nothing here is a sine-wave "shake"; every term is measured from the physics
state (anchor `driver motion: the head is on a neck, not on a rail`):

| signal | formula | what it drives |
|---|---|---|
| `yawRate` | `(hdg − _py)/dt` | — |
| `yawG` | `clamp(vF · yawRate, ±40)` m/s² | lateral load in the cockpit |
| `acc` | `(vF − _pv)/dt` | longitudinal load (braking nod) |
| `bsl` | slope of the surface ahead of both front contact patches (`bumpAt`, rate-limited to 25 Hz) | road/kerb harshness |
| `road` | `sin(47t)·vib + bsl·0.035`, `vib` scales with speed³ and ×3.1 on kerbs | helmet vertical buzz |
| kerb impulse | on rising edge of `onCurb`: `velocity −= 0.055` into a damped spring (`k=190, b=13`) | the shell hops, suspension eats it |

The head is then driven by three **damped springs** (`function spring(cur,vel,target,k,b,dt)`):
roll `k=58 b=7.4` toward `gLat·0.30 + gLon·0.05`, pitch `k=46 b=6.6` toward
`gLon·0.20`, yaw `k=34 b=6.0` toward the driver looking into the corner
(`−steer·0.30 + gLat·0.16`). The torso is a slower, blunted spring; the helmet
also *slides* in the seat (2.2 cm laterally, 1.8 cm fore/aft) and the steering
wheel gets a kick term `+road·2.2` on top of `-steer·2.1` scaled down with
speed. Brake discs heat: `c.brakeHeat` grows with brake pressure, decays at
0.42/s, and drives `brakeMat.emissiveIntensity = heat·3.4`.

How to test: drive with the **HELMET** camera (see §6.1) — the view should
roll into corners, snap forward on braking, ring once after a kerb strike and
buzz harder the faster you go. Park still and nothing should move.

---

## 6. Cameras

`CAM_NAMES=['CHASE','HOOD','HELMET','TV','ORBIT','TOP']` (line 42) and
`state.camMode` is the index. `cycleCam()` (anchor `function cycleCam()`) uses
`% CAM_NAMES.length`, so adding a mode only requires inserting into the array
**and** shifting the `state.camMode===N` branches in `updCamera` (they are
literal integers: `0` chase, `2` helmet, `1` hood/T-cam, `3` trackside TV,
`4` orbit, `5` top-down — the top-down zoom gate `if (state.camMode === 5)`).

### 6.1 HELMET cam (`state.camMode === 2`)

It is not a chase cam placed near the head: it reads the *same* helmet
transform the motion rig writes, so the camera inherits the springs:

* height comes from `p.mesh.helmetGroup.position.y` (which the hop spring
  modulates), damped at 16/s;
* `lean`/`nod`/`look` are taken from `helmetGroup.rotation` at 0.72/0.72/0.55
  of their value, i.e. **less than 1:1 and low-passed on purpose** — a faithful
  headcam is unwatchable at 300 km/h. The comment above the block says so; do
  not "fix" it by copying the rotations 1:1.
* `camera.up.set(sin(lean),cos(lean),0)` + `camera.rotateZ(lean*0.35)` gives
  the roll; the look-at target is `34 + vF·0.55` m down the road, yawed by the
  driver's own `look`, so it turns into corners before the car does.
* extra high-frequency buzz `(0.0009 + sp01·0.0055) · (3.2 on kerbs)` at
  ~51/64 Hz, and FOV climbs `70 → 86` with speed.

Test checklist: cycle `C` five times to reach `HELMET` (the `#hCam` chip must
read `HELMET`); verify no clipping through the halo (the camera sits 0.99 m in
world Y, the hoop inner surface is at 1.08 m); verify the view is stable when
stationary and lively at speed; verify kerb strikes are visible.

---

## 7. Terrain, roads and the contact model

This is the part that used to be wrong ("the cars look like they are flying").
The model, as built:

1. `baseY = trackMinY − 4`; a **fine height grid** covers the track corridor
   (`nearR = T.latLimit + 14`) and a **coarse ring band** covers everything out
   to `farPlane`, so terrain outside the fine grid is not an extrapolation.
2. `groundClearance(lat) = 0.05 + 2.15·(1−e^{−2.6t})·smoothstep01(1.15t)`,
   `t = clamp((|lat| − halfW)/max(2, wallDist − halfW), 0, 1)` — the ground is
   lifted under the road and falls away, which is what keeps the road from
   being a ribbon floating above a plane.
3. `buildSupportMaps` runs a FLOOR pass and a CEILING pass;
   `terrainHeightAt = max(min(h, cap), up)` plus a hard invariant clamp so no
   sample can exceed `wallDist`.
4. **One authority**: after the mesh is built, `terrainHeightAt`,
   `T.terrainSample` and `T.terrainHeightAt` are all set to `surfaceHeightAt`,
   which bilinearly samples the *actual drawn grid* (fine grid, else coarse
   grid). Props are grounded with it, so what you see is what things stand on.
5. Cars sit at `nearestTrackY(x,z).y + 0.05` and the tarmac skin is drawn at
   `s.p.y + 0.05` — the **same** coplanar lift on both sides of the contact,
   which cancels: the wheels touch the visible road exactly. Wheel radius is
   0.37 and the axle local y is 0.37, so a `+0.05` on one but not the other is
   instantly visible as 5 cm of air. Any new "lift" constant must be applied to
   both or neither.
6. Layered coplanar surfaces (ground / runoff / road / kerb / decals) use
   `polygonOffset` in that order, not Y gaps, because the real gaps are
   centimetres and the depth buffer cannot resolve them at circuit scale.

### Verified

```
$ node tools/all_tracks_contact.mjs | tail -3
...
25/25 tracks with every object touching the ground it stands on
car contact: group lift +0.05 · tarmac skin +0.05 → wheels 0.000 m off the visible road
```

It re-invokes the real `buildWorld(i)` for all 25 circuits headlessly, walks
every world-level mesh, samples the surface under a 9-point base ring and flags
`floating`/`sunk`. Object counts now include the new lamp rigs (e.g. Monza
153 world-level meshes). Per-track `terrain_check` (`TRACK=Monaco node
tools/terrain_check.mjs`) prints `inverted tris 0 · NaN 0` for the tracks
checked after this session's patches.

> Known pre-existing, unrelated: Monaco/Suzuka/Interlagos have a handful of
> mesh nodes that bury the road (up to 6.7 m at Monaco) because the *real*
> circuit data crosses itself; the tool calls these out and the audit
> deliberately does not count them as float/sink.

---

## 8. Lighting, sky, weather, post

### 8.1 Lighting / time of day

`DirectionalLight(0xfff1d0, 2.6)` with a 2048 map, `bias −0.0004`,
`normalBias 0.5`, rig re-aimed to the car each frame (`sunVec*300`);
`HemisphereLight`; `FogExp2`; PMREM env rebuilt by `refreshEnv()`.
`TOD = {day, dusk, night}` carries **light direction too** (`el`, `az`), so
dusk rakes sideways rather than only dimming; `applyWeatherVisuals()` computes
`SUNDIR`/`sunVec`, lerps sun colour toward 0xffb066 at low elevation, drives
`skyMat.uniforms.{haze,stars,topC,horC,sunC}` and sets
`renderer.toneMappingExposure = cur.exp·tod.expMul`.

The sky is a `ShaderMaterial` dome that draws a sun disc, a tight halo and a
wide scatter, plus stars at night and city light pollution near the horizon
under storm cloud.

### 8.2 Post

`src/postfx.js`: half-float RT with 4× MSAA (ULTRA) → `RenderPass` →
`UnrealBloomPass` → a **custom `GradePass`** (own ACES + vignette + grain +
desaturate + linear→sRGB, `renderToScreen=true`). The custom grade pass exists
because three only applies tone mapping / colour space to the *default*
framebuffer — rendering into a composer target and letting three handle it
double-darkens or washes out. `postfx.render(t)` returns `false` when it is not
in charge, and the game then renders normally. On rainy frames the whole chain
steps aside (`renderer.toneMapping=BASE_TONE`) because `RainShaderPass` renders
the scene itself into a linear target and composites an unscaled fullscreen
quad — it *depends* on the renderer's tone mapping. Any change to either must
keep exactly one tone-mapping owner per frame.

### 8.3 Weather (5 presets)

`WX` (line 296) now carries `sun`, `driz`, `rain`, `mist` (**FOG**) and `snow`,
each with `skyT skyH sunC sunI hS hG hI fog fogD exp grip rain snow wet`.
`state.wx` selects one; `snapWeather(k)` copies it into `cur` (and
`applyWeatherVisuals()` re-derives every look parameter from `cur`). The
settings segment and `#hWx` chip both list all five.

* **FOG** is deliberately a *different kind of bad* from rain: near-dry road,
  grip 0.9, but `fogD .0045` (≈9× sunny), no rain, and the night lamps come on
  (`nightLevel += cur.rain·0.3 + …` plus a base from the fog itself).
* **Rain**: `cur.rain` drives the rain particle mesh, wet-road
  `color 0x9a9da2→0x4c5157`, `roughness = 0.95 − wet·0.78`,
  `metalness = wet·0.32`, `envMapIntensity = 0.1 + wet·1.5` (mirror-slick
  asphalt), puddle opacity, spray, and the windshield shader.
* **Thunder**: `updLightning()` fires when `cur.wet ≥ 0.7`; the flash lifts
  `sunLight` **and** `hemi` **and** thins the fog (a flash that only moves the
  key light leaves the cars black between strikes), and the thunder is delayed
  0.15–2.2 s on purpose.
* **Snow** was previously a *documented but unwired* feature — `snowShader.js`
  was never instantiated. It now is (`snowPass = new SnowShaderPass(renderer)`),
  and `snowAccum` (builds at 0.055/s while snowing, melts at 0.035/s) drives
  flake intensity, gusts, road whitening (`T.roadMat.color.lerp(0xe9eef4, ·)`),
  and `cur.grip = cur.gripBase·(1 − snowAccum·0.4)` — grip never below 60 %.
  The snow particle drift uses the rain line system at 1/10 speed with lateral
  wander, so it does not look like slow rain.

Everything that consumes grip — the player's `cap = 46·grip/v`, the AI's corner
speed, brake distance — therefore agrees with what is drawn.

### 8.4 Night

`setNightGlow()` (anchor) computes one scalar `nightLevel` from time of day,
rain and snow, then: `nightPoolMat.opacity = L·0.5` and every lamp head
material's colour ramps to warm white. The rigs are added in `buildWorld`:
`max(14, min(26, len/240))` stations, masts on both sides, each with a double
lamp head and a 60×40 additive **pool of light on the tarmac** (that is what
night actually looks like at circuit scale — nobody sees a light cone).
Per-car lights (`beam`, `pool`, `tailGlow` in `makeCarMesh`) are driven in
`updCarVisual` by `nightLevel + (inTunnel ? 0.85 : 0) + cur.rain·0.4`: a wide
additive cone, a pool on the road ahead, and a red tail glow that scales up
under braking. Deliberately **no SpotLights** for cars — 20 cars × a real
spotlight blows the light budget and recompiles shaders; bloom + additive
geometry reads the same and is free.

---

## 9. Physics and the AI (read this before touching either)

```js
const PH={top:79, eng:20, brk:26, drag:0.00115};   // 79 m/s ≈ 284 km/h, drag-limited
base   = 3.2 − 1.9·|v|/top                          // steering rate authority
cap    = 46·grip / max(|v|,2)                       // yaw-rate limit, rad/s  → aLat ≤ 46 m/s²
vR    *= exp(−8.8·grip·dt)                          // lateral grip pulls slip out
```

So the *car's own* grip-limited corner speed for curvature `c` is
`sqrt(46·grip / c)` (≈4.7 G).

The AI's corner target used to be `tv = sqrt(21/cmax)` — a magic constant with
no relation to that model, i.e. ~30 % slower than the car can go, which is
exactly the "the AI really slows down for no reason" complaint. It is now
(line ~2739):

```js
const tvLim=Math.min(Math.sqrt(46*Math.max(cur.grip,0.3)/Math.max(cmax,1e-4)),vAhead);
let tv=tvLim*(0.88+c.d.skill*0.05)*state.diffMul;
tv=Math.min(tv,PH.top*(0.86+c.d.skill*0.13));
```

* `46` is **the car's own** lateral limit, so the AI asks for what the physics
  can deliver — no more crawling, and no asking for grip that does not exist.
* `vAhead` is the track's own braked-speed profile (`samples[].v`, propagated
  backwards at 23 m/s² while the circuit is built) so it brakes *early enough*
  for the next corner's exit, not just the entry.
* `cur.grip` makes the AI drive in the wet like a human: slower, because the
  limit really is lower.
* `0.88 + skill·0.05` keeps a 1.0-skill car at 0.93 of the limit and a weak
  one at 0.88 — a spread of *pace*, not of *physics*. `state.diffMul`
  (0.88/0.97/1.05) then multiplies the same limit for the difficulty setting.
* The `PH.top·(0.86+skill·0.13)` cap stays exactly as it was, because that is
  also what the player's straight-line pace is balanced against.

### Verified with

```
$ node tools/ai_pace_calib.mjs            # ~2 s, 5 tracks x 3 laws x 4 scales
Monza   lap length 5736 m   tightest R 30 m
  old      x1.00: lap 108.1 s  avg 190 km/h  crawling  3%  min  95 km/h  walls 0
  samples  x0.93: lap  96.6 s  avg 213 km/h  crawling  0%  min 108 km/h  walls 0
Monaco  lap length 3231 m   tightest R 9 m
  old      x1.00: lap  86.1 s  avg 133 km/h  crawling 32%  min   4 km/h  walls 23
  samples  x1.00: lap  70.4 s  avg 166 km/h  crawling  5%  min  75 km/h  walls  0
Silverstone lap 5776 m   tightest R 25 m
  old      x1.00: lap 127.1 s  avg 161 km/h  crawling 11%  min   3 km/h  walls 1529
  samples  x0.93: lap 102.8 s  avg 201 km/h  crawling  1%  min  63 km/h  walls   12
```

`crawling` = share of lap time under 0.35·top speed (28 km/h); `min` = slowest speed
reached; `walls` = barrier contacts. "min 4 km/h at Monaco" and "11 % crawling
at Silverstone" from the old law are the bug, in two numbers — the AI was
almost stopping. Note `walls` is measured with a deliberately simple look-ahead
steering controller (no traffic avoidance, which the game's AI has), so use it
only as a *relative* signal between laws, and `lap`/`min`/`crawling` as the
absolute ones. The tool is a closed
loop: it drives a car with the game's own yaw/lateral model and the game's own
AI steering law, on the same 840-sample circuit geometry the renderer uses
(read from `public/data/circuits/*.json` when present), and it counts wall
contacts so a faster law can be rejected if it cannot be held.

**Lap-time consistency:** the timing tower's gap is
`(leader.key − c.key)·T.segLen / max(|vF|,15)` — distance behind, divided by
*actual* speed. Because the AI target is now a real speed the cars actually
achieve, that estimate stops drifting; there is no separate predicted-lap
model in the game that could disagree. If you change either the physics limit
or the AI law, re-run `ai_pace_calib.mjs` and keep both files' numbers
consistent — that tool is the contract.

---

## 10. Controls input (gyro/tilt)

`src/tiltControls.js` is a 4-state machine (`off → pending → armed → error`),
with `waitForSensor(timeoutMs=1400)` polling `_sensorSeenAt` every 120 ms, a
watchdog that names the exact iOS setting to change (Settings ▸ Safari ▸
Advanced ▸ Motion & Orientation Access), the iOS ≥ 17.1 "standalone only"
grant rule, Low-Power/Focus blockers, and a hard requirement on an HTTPS or
`localhost` origin. The `#hTiltChip` HUD chip reads `GYRO [axis]`,
`GYRO PENDING` or `GYRO ERROR`.

```
$ node tools/gyro_controls_test.mjs
23 passed, 0 failed
```

---

## 11. Audio and speech

`AudioSys` is a WebAudio graph built once (engine osc → distortion → filters →
compressor; skid noise; wind; rain ambience; a "grid" bed; thunder). Engine
pitch is driven by `rpm`, the grid bed aggregates **all** cars' rpm before
lights-out, and `beep()`/`thump()`/`clank()` cover start and contact.

Commentary uses the Web Speech API. `Speech.refresh()` scores available voices
(preferring `en-GB`, then `natural/premium/google/neural/enhanced`, then
male-sounding names for a broadcast baritone) and picks the best; rate and
pitch track the drama (fastest at lights-out and a win, calmer for "you are
leading, keep it clean"). `Speech.say(text, interrupt, {rate,pitch})`.

To test: race in Safari/Chrome with the tab focused; check the commentator
lines up over the lights-out and a crash, that muting with `M` silences
everything including the engine bed, and that voice selection survives a page
reload. There is **no headless test for audio** — this section must be verified
by a human or by stubbing `AudioContext`.

---

## 12. The headless test suite (run all of it after any change)

The sandbox has no GPU and no browser, so every check re-runs the *real* game
code headlessly by slicing it out of `src/game.js` and executing it against
stubbed DOM/WebGL. That is deliberate: a tool that re-implements the logic
proves nothing.

| command | what it proves | expected |
|---|---|---|
| `node --check src/game.js` | file parses | silent |
| `npx vite build` | whole app bundles (resolves every import) | `✓ built in Ns` |
| `npx tsc --noEmit` (`npm run lint`) | type-check of the project | exit 0 |
| `node tools/all_tracks_contact.mjs` | **all 25 tracks**: no floating/sunk object, wheels exactly on the road | `25/25 tracks …` + `wheels 0.000 m` |
| `TRACK=Monaco node tools/terrain_check.mjs` | per-track terrain health: `inverted tris 0 · NaN 0`, float/burial vs baseline | those two lines, `NaN 0` always |
| `node tools/gyro_controls_test.mjs` | tilt/gyro state machine, permission watchdog | `23 passed, 0 failed` |
| `node tools/ai_pace_calib.mjs` | AI corner law vs car physics. Knobs: `LAWS=old,grip,samples` `SCALES=0.93` `TRACKS=Monza,Monaco` `SKILL=1 DIFF=0.97 GRIP=0.62` | new law laps faster than `old`, `crawling` ≈0, `min` speed well above 0, `walls` no worse |
| `node tools/car_preview.mjs` | car model geometry + renders 4 PNGs you can look at | counts above; `hoop above crown: 0.079 m`, `25/35` |
| `TRACK=Spa-Francorchamps node tools/render_preview.mjs` | chases/wide/side renders of a whole world (flat-shaded z-buffer) | writes `/tmp/preview/*.png` |
| `node tools/contact_report.mjs` | single-track version of the audit with per-object table | `floating 0` |

Notes that will save you an hour:

* `tools/render_preview.mjs` and `tools/all_tracks_contact.mjs` share a
  harness: a fake DOM, a Proxy'd WebGL context, a `tex` proxy, and a
  `NOOPS` list of module-level names the sliced region calls. If you add a
  module-level dependency to a sliced function, add the *name* to `NOOPS` (or
  pass it in), and never stub a real `game.js` function — that produced 40+60
  phantom "floating object" reports here once.
* Both tools must call `buildWorld(0)` inside the wrapped module and expose
  `globalThis.__worldOf()/__TOf()`, then read them **after each rebuild**, or
  every track reports identical numbers.
* The `sed '…/m'` / `awk '[…'` idioms fail in this shell; use `sed -n "A,Bp"`.
* Track names must match `src/tracks.js` exactly (`Baku City Circuit`,
  `Yas Marina`, `Spa-Francorchamps`; there is no bare `Baku`/`Abu Dhabi`).
* A crash behind a pipe prints nothing and still exits 0 — re-run without the
  pipe before concluding "0 findings".
* Patching `src/game.js` is done with node scripts that `rep(old,new,tag)` and
  throw on a miss, then `node --check`. Match **one-space** indentation and
  prefer whole-line anchors; multi-line exact matches break on trailing space.

---

## 13. Manual test plan (what to actually do in a browser)

1. `npm run dev`, open the preview URL, wait for the title attract mode: 20
   cars racing, broadcast cuts, no car hovering or sunk, terrain continuous at
   the edge of the corridor.
2. Start a 3-lap race on **Monza** at `SUNNY`, `NORMAL`, `20 CARS`.
   * Watch a corner from `CHASE`: the AI should arrive fast and *then* brake,
     not crawl. Compare `#hTime` deltas — gaps should not balloon on every
     corner exit.
3. Press `C` until `#hCam` reads `HELMET`. Verify: head-roll into corners, chin
   forward on braking, a visible ring after riding a kerb, buzz at 300 km/h,
   still image when stopped, no clipping through the halo, and that the halo
   reads as a closed ring over the visor (not a half hoop).
4. kerb test: put two wheels on a kerb — the car should skip, the helmet should
   ring once, and the tail light should come on as you lift.
5. Weather: cycle all five presets from Settings. `FOG` must hide the corner
   you are braking for but not the grip; `RAIN` must show wet reflections,
   spray, droplets, and lightning with delayed thunder; `SNOW` must start with
   thin cover and, after ~30 s of running, show white road and noticeably less
   grip (test by locking the rears in a slow corner).
6. Time of day: `NIGHT`. Lamp pools must sit on the tarmac (not floating), the
   lamp heads must be lit, and every car must show a beam cone + red tail glow
   that brightens under braking; a 2-lap run in a tunnel section (if the track
   has one) must light the beams at midday too.
7. Quality: cycle `LOW → ULTRA`. LOW must drop bloom resolution and turn off
   rain/snow shaders without blacking the screen (the tone-mapping hand-back in
   §8.2 is what protects this).
8. Mobile: on an HTTPS URL or `localhost`, arm `GYRO`, drive with tilt only,
   then force the pending path (deny the permission) and confirm the chip reads
   `GYRO PENDING`/`GYRO ERROR` with the right instructions.

---

## 14. Known limits / things an agent may mistake for bugs

* No GPU or browser in this sandbox: nothing above has been verified *in a
  browser* by the agent that wrote it. The raster previews are geometry-and
  shading approximations — good for silhouettes, contact and float, useless for
  bloom/tonemap judgement.
* Monaco/Interlagos/Suzuka have a few road-burying mesh nodes inherited from the
  real circuit data's self-crossings. Not new, not caused by the grounding code.
* `tools/contact_report.mjs`'s "ownMax" line still prints the *old* clearance
  formula (harmless, it is only a reference column); the authoritative verdict
  comes from `all_tracks_contact.mjs`.
* `tools/scene_audit.mjs` is stale — ignore it.
* `terrain_check.mjs` reports "steep node pairs … max grade 263%" on Monaco/Spa:
  those are the corridor-edge cells where the fine grid meets the ring band on a
  real 40 m+ elevation swing; `inverted tris 0` and `NaN 0` are the pass
  criteria, not the grade figure.
* If you re-add an artificial clearance to cars, the ground or the tarmac, you
  must add it to **all** layers or none; that is precisely the bug that made the
  cars look like they were flying.

## 15. What changed most recently (context for reviewing a diff)

1. **Model detail**: halo rebuilt as a closed tube-swept hoop + front pillar,
   winglets, pads, rear impact structure, cockpit surround, mirrors, dash;
   suspension uprights/pushrods/wishbones/brake ducts added to the axle; discs
   split into a non-spinning `brakeGeo`; separate `steering` yoke mesh; helmet
   visour/camera pod/HANS/stripe; `ensureUV` so merged parts never drop an
   attribute.
2. **Motion**: the spring-driven head/torso/wheel rig in §5.3, replacing a
   hand-waved `sin(t·31)` nod.
3. **HELMET camera** added as `camMode 2`, all later modes renumbered
   (TV 3, ORBIT 4, TOP 5, top-down zoom gate 5).
4. **AI corner speed** re-derived from the car's own grip limit (§9), with the
   calibration harness in `tools/ai_pace_calib.mjs`.
5. **Night**: lamp rigs + shared additive light pools + per-car beam/pool/tail
   glow driven by one `nightLevel`.
6. **Weather**: `FOG` and `SNOW` presets added and the previously orphaned
   `snowShader.js` wired in with accumulation that drives grip and road colour.
7. Everything re-verified: `25/25` contact audit, `23/23` gyro, `inverted tris
   0 · NaN 0` terrain, clean `vite build` and clean `tsc --noEmit`, car preview
   numbers as printed in §5.2.
