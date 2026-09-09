# POLYGON GP — current game status / what is already done

**Last updated:** 2026-09-09  
**Visible app version in `index.html`:** `v1.0.0 · BUILD 20260908.18`  
**Validation after latest edits:** `npm run build` ✅, `npm run lint` ✅  
**Note:** Playwright was not used for the latest work.

This document is intended as the working handover: what exists now, where it lives, and what is safe to build on next.

---

## 1. Project shape

POLYGON GP is a browser-based, low-poly Formula 1 style racing game using Three.js and Vite.

Main files:

| File | Purpose |
|---|---|
| `index.html` | All main HTML, HUD, title/settings UI, app version display and runtime error overlay. |
| `src/game.js` | Main game loop and most systems: scene, world build, physics, AI, camera, HUD, race control, audio, particles. |
| `src/tracks.js` | Track definitions, fallback point layouts, circuit metadata, water/tunnel/banking/width data. |
| `src/circuitData.js` | Loads pre-downloaded OpenF1 circuit telemetry, with live fallback and procedural fallback. |
| `src/carGeometry.js` | F1 car geometry, wheel/axle/brake geometry, driver mesh, steering HUD helpers. |
| `src/teamLivery.js` | Team accent-colour mapping. |
| `src/quality.js` | Graphics quality presets and adaptive quality manager. |
| `src/postfx.js` | Post-processing path / bloom and grading support. |
| `src/godRays.js` | Instanced crepuscular ray system. |
| `src/rainShader.js` | Rain-on-glass/refraction shader pass. |
| `src/snowShader.js` | Snow overlay shader. |
| `src/tiltControls.js` | Mobile gyro/tilt driving controls. |
| `src/gyroLab.js` | Gyro calibration UI/lab. |
| `src/webcamDrive.js` | Webcam driving input support. |
| `tools/*.mjs` | Headless verification and preview scripts. |
| `scripts/fetch-openf1-data.mjs` | Downloads/refreshes OpenF1 track and driver data into `public/data/`. |

Run commands:

```bash
npm install
npm run dev      # Vite dev server on port 3000
npm run build    # Production build
npm run lint     # TypeScript no-emit check
```

---

## 2. Tracks and world content

### Done

The game currently includes **25 circuits**:

1. Monza
2. Silverstone
3. Spa-Francorchamps
4. Monaco
5. Red Bull Ring
6. Suzuka
7. Albert Park
8. Shanghai
9. Bahrain International Circuit
10. Jeddah Corniche
11. Miami International Autodrome
12. Circuit Gilles Villeneuve
13. Circuit de Barcelona-Catalunya
14. Hungaroring
15. Circuit Zandvoort
16. Madring
17. Baku City Circuit
18. Sepang
19. Marina Bay
20. Circuit of the Americas
21. Autódromo Hermanos Rodríguez
22. Interlagos
23. Las Vegas Strip Circuit
24. Lusail International Circuit
25. Yas Marina

Track systems already present:

- Real-circuit telemetry loading from pre-downloaded OpenF1 data in `public/data/circuits/`.
- Procedural fallback layouts in `src/tracks.js` when real data is unavailable.
- Per-track metadata: location, meeting name, lap record, 2024 fastest lap, descriptions.
- Per-track road width.
- Per-track banking/camber.
- Per-track runoff width.
- Elevation-aware terrain and road surface.
- Road mesh, runoff, kerbs, walls, barriers, tyre stacks, sponsor boards, DRS boards.
- Terrain blending away from the road so elevated circuits do not look like floating roads.
- Polygon-offset ordering to reduce z-fighting between ground, runoff, road, kerbs and decals.
- Water features for appropriate tracks: Monaco harbour, Baku, Singapore, Jeddah, Montreal, Yas Marina, Miami, Albert Park/Suzuka-style lakes where configured.
- Low-poly boats in harbour/marina water zones.
- Venue-specific landmark silhouettes, signs and local scenery cues.

### Monaco-specific status

Already done:

- Monaco has narrow street width and almost-flat street banking.
- Port Hercule water is placed along the harbour-side section.
- Tunnel section exists with tunnel roof, stone portal frames, hazard markers and warm tunnel lights.
- **Latest fix:** Monaco tunnel end shortened from `0.615` to `0.588` so the tunnel ceiling/lights stop before the daylight section after the tunnel.
- **Latest landmark update:** added/anchored Monaco landmarks for:
  - Casino Square.
  - Fairmont / Grand Hotel hairpin area.
  - Port Hercule.
- Existing Monaco signage/beacon content remains.

Potential future Monaco work:

- Do a visual pass on exact left/right side placement of every Monaco landmark after driving one full lap manually.
- Add more Monaco-specific geometry around swimming pool, Rascasse and Tabac if needed.

---

## 3. Cars, teams and grid

### Done

- Full F1-style car mesh with low-poly geometry.
- Separate car body, wheels/axles, brakes, driver, helmet, steering yoke and DRS flap pieces.
- Team-colour liveries and accent colours.
- 2026-style roster data in `src/game.js` fallback array.
- Local driver data/headshots can be loaded from `public/data/drivers/manifest.json`.
- Driver headshots appear in the timing tower where available.
- Player profile: player name and optional driver photo are persisted locally.
- Tyre compound system:
  - Dry compounds: soft / medium / hard.
  - Weather compounds: intermediate / wet depending on weather.
  - Tyre visuals are swapped when weather changes.
- DRS flap visual animation and DRS gameplay logic.
- Brake discs glow/embers under hard braking.
- Suspension/bounce/jitter visual motion.
- Steering wheel and driver animation.
- Helmet/cockpit presentation and mirror/cockpit details.

### Latest grid-order change

The AI cars are **no longer spawned in raw team-list order**.

Added `raceOrderDrivers(source, count)` in `src/game.js`:

- Builds a qualifying-style order from driver skill plus random variation.
- Avoids adjacent team-mates when possible.
- Produces a mixed grid instead of predictable pairs such as 2 McLaren, 2 Ferrari, 2 Mercedes.
- Still lets stronger drivers generally start nearer the front.

Future option:

- Add a selectable menu option for `Team order / Mixed qualifying / Random grid` if you want more control.

---

## 4. Driving, physics and AI

### Done

- Heading-based car physics rather than pure rail movement.
- Throttle, brake, steering and drift input.
- Speed, drag, grip and cornering limit handling.
- Road height sampling keeps cars on the actual road/terrain surface.
- Suspension compression/rebound on bumps, landings and impacts.
- Wet/snow grip modifiers.
- Kerb rumble and wet kerb slipperiness.
- Off-track, gravel and recovery behaviour.
- AI racing line and corner-speed logic.
- AI overtaking, defending, slipstream and DRS use.
- Humanised AI traits:
  - aggression,
  - defence,
  - risk/mistake tendency.
- Pressure/mistake behaviours such as missed apex, hesitation and brake-lock style events.
- Pack racing and position tracking.
- Title-screen attract mode uses the same cars/physics/AI rather than a fake animation.

---

## 5. Race control and rules

### Done

Rules are grouped into presets:

| Preset | Behaviour |
|---|---|
| Basic | Arcade mode, stewarding mostly off. |
| Sporting | Track limits, contact, moving under braking, pit lane, VSC, flags, jump start, unsafe rejoin and DRS rules. |
| Full FIA | Sporting plus blue flags. |

Implemented systems:

- Track-limits warnings/penalties.
- Off-track overtake / give-place-back handling.
- Contact penalty support.
- Moving under braking detection.
- Pit-lane request/limiter/speed checks.
- Jump-start checks.
- Unsafe rejoin checks.
- Virtual Safety Car deployment after major incidents/wrecks.
- VSC speed/delta/gap/overtake checks.
- Blue flag warnings/penalties in Full FIA.
- Penalty seconds added into final classification.
- Race messages and speech lines for key rule events.

---

## 6. Weather, time of day and lighting

### Weather presets done

- Sunny.
- Drizzle.
- Rain.
- Fog.
- Snow.

Weather affects:

- Sky colours.
- Sun/hemi light levels.
- Fog density.
- Exposure.
- Grip.
- Wet road look.
- Rain/snow visual intensity.
- Tyre compound selection.

### Rain done

- Rain shader with screen-space droplet/refraction pass.
- Rain intensity changes with weather and player speed.
- Wet-road visual response.
- Thunder/lightning events during rain.

### Snow done

- Snow overlay shader.
- Snow accumulation/melt state.
- Snow blanket on ground and partial road cover.
- Grip reduction when snow builds up.
- Snow gust bursts.

### Time-of-day done

- Day.
- Dusk.
- Night.
- Sun elevation/azimuth changes by time of day.
- Night lamps and emissive lighting.
- Dusk/night exposure and atmosphere differences.

### God rays status

God rays are implemented in `src/godRays.js` as one instanced mesh set per circuit.

Latest fix/update:

- Fixed shader colour output so rays are not double-dimmed by alpha.
- Increased base visibility/intensity.
- Increased ray density slightly while keeping the system instanced.
- Disabled depth testing for the shafts so they do not disappear too easily behind scenery.
- Re-anchored rays higher in the sky/canopy area, lengthened them, and made every shaft fall along actual light travel direction `-sunVec` so they visually stream down from the sun toward the track.
- Still skipped on the lowest prop-density quality tier for performance safety.

Best conditions to see them:

- Clear/dry weather.
- Dusk or low sun.
- Camera facing somewhat toward the sun.

---

## 7. Scenery and trackside presentation

### Done

- Trackside buildings for street circuits.
- Grandstands and sponsor hoardings.
- DRS boards and other race-signage cues.
- Barriers/walls and tyre stacks.
- Grass tufts and mowed striping.
- Shrubs, ferns, flowers and sapling rows.
- Birds with body/head/beak/tail and flapping/gliding animation.
- Display-jet fly-bys with smoke trails and turbine audio.
- Venue-specific silhouette objects: towers, pagodas, torii, ferris wheels, palms, mountains, windmills, etc.

### Latest tree update

Trees were upgraded because the old ones looked too primitive.

What changed:

- Conifers now use stacked canopy layers instead of one simple cone.
- Broadleaf trees use multiple merged lobe shapes instead of one simple ball.
- Poplars use a taller combined canopy silhouette.
- Trunks are slightly improved.
- Added two cheap diagonal branch strokes per tree.
- Added per-tree lean/rotation/scale variation.
- Kept performance by using merged low-poly canopy geometry and instanced meshes.

Performance note:

- The new trees add a few extra instanced draws for branches, but avoid individual per-tree mesh creation.
- The main tree counts still obey the existing `propDensity` quality budget.

---

## 8. Crash, damage, fire and particles

### Done

- Light damage / mechanical recovery state.
- Severe terminal wreck state.
- Wrecked car slowdown and race-ending player crash handling.
- Bodywork debris shedding.
- Sparks for wall impacts, underbody strikes and heavy contact.
- Damaged-car smoke and spark trail.
- Crash camera / game-over presentation.
- VSC deployment after AI wrecks.

### Latest fire/explosion update

The previous crash ignition looked too much like a huge bloomy orange explosion.

What changed:

- Fire particle system now uses normal alpha blending instead of additive blending.
- Initial ignition particle count and size reduced.
- Flame colour moved toward smaller yellow/orange fuel-fire licks.
- Dark smoke/soot particle count increased.
- Ongoing wreck fire emits smaller flames plus darker rising smoke.
- The result should read more like burning fuel with dark smoke, not a glowing explosion cloud.

---

## 9. HUD, menus and presentation

### Done

- Title screen with live racing attract mode.
- Settings menu for track/weather/time/laps/grid/difficulty/quality/rules/controls.
- Race HUD with speed, gear, DRS, lap/position info and messages.
- Sky F1 style timing tower with driver names, teams, gaps and headshots.
- Clickable HUD chips for common options.
- Minimap path.
- Countdown/lights-out sequence.
- Finish/results flow.
- Runtime error overlay that includes the app version/build string.

---

## 10. Camera system

### Done

Camera modes include:

- Chase.
- Hood.
- Immersive.
- Helmet.
- TV.
- Orbit.
- Top.

Additional camera systems:

- Title-screen broadcast director.
- Trackside/TV-style camera cuts.
- Helmet/cockpit camera.
- Camera shake from impacts, kerbs and rumble.
- FOV/speed response.
- Crash camera sequence.
- Wing mirror rendering is performance-managed by alternating mirror updates rather than rendering both every frame.

---

## 11. Audio and speech

### Done

- Web Speech API commentary/radio lines.
- Male/female voice selection/scoring.
- Excitement-based rate/pitch changes.
- Personalised driver-name encouragement.
- Race start, overtakes, crashes, penalties, VSC, blue flags and finish lines.
- Engine audio layers.
- Grid/start-line engine bed.
- Rival engine doppler/presence.
- Thunder audio.
- Tunnel-style engine audio treatment for Monaco.
- Jet fly-by audio.
- Crash/thump and kerb/rumble style feedback.
- Menu/attract music bed.

---

## 12. Input systems

### Done

Keyboard:

- Accelerate/brake.
- Steering.
- Drift.
- DRS.
- Camera cycle.
- Reset.
- Fullscreen.
- Mute.
- Pause.

Mobile/control systems:

- Gyro/tilt driving support.
- Permission/watchdog flow for sensors.
- Calibration lab.
- Webcam driving support module exists.

---

## 13. Graphics quality/performance systems

### Done

Quality presets:

- LOW.
- MED.
- HIGH.
- ULTRA.
- AUTO/adaptive quality.

Quality systems include:

- Pixel-ratio/render-scale handling.
- Capability probing for framebuffer safety.
- Shadow quality/size changes.
- Prop density scaling.
- Smoke/spark particle budgets.
- Anisotropy scaling.
- Rain shader control.
- Cockpit detail control.
- Dynamic quality management based on performance.

Performance-minded implementations already in place:

- Instanced scenery.
- Merged geometries for cars/trees/props where possible.
- Shared/cached geometry for car body and wheels.
- Quality-gated expensive systems.
- Mirror render throttling.
- Offscreen/post-processing safety checks.

---

## 14. Data and offline behaviour

### Done

- Driver and circuit data can be pre-downloaded into `public/data/`.
- Game loads local data first.
- Live OpenF1 fallback exists when local data is missing.
- Procedural track fallback exists if data cannot be loaded.
- Driver manifest/headshot loading has cache-busting support.
- Local storage is used for player profile and cached driver data.

---

## 15. Verification / useful checks

Commands recently run successfully:

```bash
npm run build
npm run lint
```

Useful project tools already present:

```bash
node tools/verify_realism.mjs
node tools/scene_audit.mjs
node tools/terrain_check.mjs
node tools/car_preview.mjs
node tools/render_preview.mjs
node tools/contact_report.mjs
node tools/all_tracks_contact.mjs
node tools/wheel_preview.mjs
node tools/motion_cam_smoke.mjs
node tools/ai_pace_calib.mjs
```

Do **not** use Playwright if you want to keep following the latest instruction from the previous request.

---

## 16. Latest code changes made on 2026-09-09

Files modified:

- `src/game.js`
- `src/godRays.js`
- `src/tracks.js`
- `README.md`
- `GAME_STATUS.md`

Summary:

1. Better trees while preserving performance.
2. Mixed qualifying-style AI grid order instead of team-pair order.
3. God rays fixed/made more visible.
4. Monaco tunnel end corrected so tunnel lights stop after the tunnel.
5. Monaco landmark pass for Casino / Fairmont / Port Hercule.
6. Crash ignition changed from bloomy explosion to smaller fire plus dark smoke.
7. Added the first full circuit-drivability pass for all 25 tracks.
8. Fixed a runtime crash from the new merged tree canopies by normalising geometry UV/index attributes before `mergeGeometries()`.
9. Darkened/neutralised asphalt so normal roads read black and shiny rather than blue/grey, and removed baked repeating white/grid markings from the road texture.
10. Increased driver radio/moaning frequency: all drivers now have generic complaint radio, not just Lewis, and rage triggers sooner after player contact.
11. Added admin-side Fish Audio voice-pack tooling plus runtime voicepack playback/fallback support. The PWA loads generated clips from `public/audio/voicepack/manifest.json`; if none exist it falls back to Web Speech.
12. Reworked god rays so they read as true sun shafts: higher sky anchors, longer sun-to-track shafts along `-sunVec`, stronger upper-source fade and clearer dry/dusk visibility.
13. Improved title-screen helicopter quality behaviour: LOW/MED favour closer race cameras, while HIGH/ULTRA helicopter shots fly lower, tighter and more car-led instead of exposing ugly far-terrain flyovers.
14. Fixed the title rain/quality clash: helicopter/TV/orbit title cameras no longer render through the windshield rain shader; only title hood/halo shots use visor rain. World rain and wet road remain visible.
15. Added stronger car road-height safety: physics no longer targets below the road skin, and car visuals now sample the four wheel contact patches plus centre/front/rear so cars should not sink into crests or cambered edges.
16. Reworked display jet fly-by: it now starts behind the player/pack, screams overhead into the screen, flies faster/lower, and uses a layered turbine roar plus delayed pressure thump.
17. Retuned engine audio away from thin high-pitched sewing-machine tones toward a lower V6 body, stronger exhaust pulse, more intake load and less whiny top harmonic.
18. Build and lint both pass.

### 2026-09-09 circuit-drivability pass

Added a per-circuit driving-feel layer in `src/game.js`:

- `DRIVE_PROFILES` gives each venue its baseline character.
- `CORNER_ZONES` adds named sections and local multipliers.
- `driveFeelFor()` bakes a feel profile onto every track sample when the world is built.
- `carFeel()` lets physics, AI and visuals read the current section cheaply.

What the new feel layer affects:

- Track grip.
- Top-speed character / drag level.
- Braking strength.
- Lateral grip and high-speed aero confidence.
- Kerb harshness/effectiveness.
- Road bump/camera shake.
- AI confidence.
- AI mistake risk.
- Overtaking willingness/space.
- Slipstream strength/range.

Examples now encoded:

- **Monaco**: lower top speed, more drag, bumpy street surface, weak overtaking confidence, risky kerbs, Fairmont hairpin speed restriction, tunnel relief and Nouvelle Chicane braking risk.
- **Spa-Francorchamps**: Eau Rouge/Raidillon compression/risk, Kemmel slipstream/top-speed boost, Pouhon aero commitment and La Source overtaking.
- **Silverstone**: Maggotts/Becketts high-speed aero commitment, Stowe braking and Club kerbs.
- **Monza**: low drag, strong slipstream, aggressive chicane kerbs and Parabolica commitment.
- **Baku / Vegas / Jeddah**: wall-lined high-speed street character, giant slipstream straights and punishing tight sections.
- **Suzuka**: Esses rhythm, Degner risk and 130R high-speed aero commitment.

Player-facing addition:

- A small corner/section callout appears when entering named track-character zones during a race, e.g. `EAU ROUGE / RAIDILLON`, `FAIRMONT HAIRPIN`, `MAGGOTTS AND BECKETTS`.

---

## 17. Sensible next development targets

These are not necessarily bugs; they are good next places to improve.

### High value visual passes

- Manual Monaco drive-through to fine-tune exact side/position of landmarks.
- More circuit-specific landmark detail at corners, not just general skyline silhouettes.
- Further tree variation only if performance measurements remain healthy.
- More convincing smoke wind drift from burning wrecks.
- Better wet spray from tyres and cars ahead.

### Gameplay/racing

- Optional grid mode selector: team order / mixed qualifying / random.
- More qualifying/session structure if wanted.
- Pit-stop gameplay beyond pit-lane limiter/speed rules.
- Tyre wear and compound performance differences.
- More AI racecraft around narrow street circuits.

### Presentation

- Add a proper change-log panel on the title screen.
- Add a debug/status page showing current quality tier, prop count and frame timing.
- More radio variety per named driver/team.
- More track intro voice lines.

### Technical cleanup

- `src/game.js` is very large; future work could split systems into modules:
  - world builder,
  - particles/fire,
  - race control,
  - AI,
  - cameras,
  - HUD,
  - audio.
- README and TESTING docs can be kept shorter if this file becomes the main living status doc.

### Future online / account system, no-cost first plan

Keep this out of the current game pass for now, but plan it as follows:

- **Login/profile:** start with a free-tier backend such as Supabase Auth, Firebase Auth, or a very small Cloudflare Workers + D1 setup. Use it for driver profile, display name, stats and saved settings.
- **Free multiplayer prototype:** use WebRTC peer-to-peer rooms for small private races, with only a tiny signalling service on a free tier. This keeps traffic mostly off the server.
- **Public race rooms later:** Supabase Realtime / Firebase / Cloudflare Durable Objects can work for prototypes, but real public matchmaking may eventually exceed free-tier limits. Design room messages compactly from day one.
- **Authoritative racing:** for fairness, the long-term version should not trust every client completely. Start with ghost/time-trial leaderboards or small peer-hosted rooms, then move to server-authoritative checks only if the player base needs it.
- **PWA/offline:** keep the current game playable without login. Login should enhance profiles/multiplayer, not block single-player.

---

## 18. Current known caveats

- Exact landmark placement should still be judged in-game by manually driving the tracks.
- God rays are condition-dependent: they are intentionally weaker/hidden in rain, snow, fog and night.
- Some circuit data may still fall back if local telemetry is missing or stale.
- The production bundle is large enough to trigger Vite's chunk-size warning, but the build succeeds.
- `npm install` reported existing dependency audit warnings; no audit fix was applied because that can introduce unrelated changes.
