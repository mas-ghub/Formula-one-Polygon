# POLYGON GP — Low-Poly Grand Prix

**Current visible version:** `v0.9.7 · BUILD 20260902.8`

The version is displayed in the title-screen footer and included automatically
in every in-game error report, making stale deployments and cached builds easy
to identify. Update both the semantic version and build identifier for each
published test build.

A browser-based, low-poly F1 racing game built with Three.js. Real circuit
layouts, the full 2026 F1 grid with true team liveries, dynamic weather
(sunny, drizzle, rain and thunderstorms) with a day/dusk/night time-of-day
control, a Sky F1–style timing tower with live driver photos, track-limits
enforcement ("give the place back" for off-track overtakes), and a title
screen where the whole grid actually races itself under a live
broadcast-style camera director.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # tsc --noEmit
```

## Real circuit data

Every track in `src/tracks.js` carries an `openf1CircuitKey`. Rather than
hand-drawn circuit shapes, the game uses the **real racing line** driven
during an actual Grand Prix, sourced from the [OpenF1](https://openf1.org)
API's car `location` telemetry (x/y/z position, sampled several times a
second during a real lap).

**Data is pre-downloaded, not fetched live from players' browsers.** Hitting
OpenF1 live for 25 circuits at once tends to trip its rate limit (`429`), so
a one-off script fetches everything ahead of time:

```bash
node scripts/fetch-openf1-data.mjs
```

This writes:
- `public/data/circuits/<circuit_key>.json` — the real lap points for each
  circuit (`[x, elevation, z]` in meters).
- `public/data/drivers/manifest.json` + `public/data/drivers/<number>.png` —
  the current driver roster with locally-saved headshot photos.

`public/data/` is committed to the repo, so the game loads it as ordinary
static files — instant, offline-friendly, and immune to OpenF1's rate limit.

## Circuit realism (v0.9.5)

Tracks are no longer identical ribbons of tarmac with different shapes — each
one carries its own physical character, declared per track in `src/tracks.js`:

- **`width`** — full tarmac width in metres. Monaco is a genuine squeeze at
  9.5 m (barely two cars side by side), Baku and Singapore run ~11 m street
  canyons, while Silverstone spreads out to 15 m. The road mesh, kerbs,
  run-off, racing line amplitude and the AI's overtaking envelope all follow
  it automatically.
- **`bank`** — maximum corner banking in degrees. Corners are cambered: the
  outside edge rises with curvature (heavily smoothed so the road twists into
  a bowl gradually). Zandvoort gets its real ~16–18° Hugenholtz/Luyendyk speed
  banks, Jeddah's T13 its 12% banking, street circuits stay nearly flat. The
  banking is on the *physics* surface, not just the visuals — cars sit flush
  on the camber, visibly roll with it, and gain up to ~35% cornering grip on
  the steepest bowls, so a banked sweep really is faster than a flat one.
- **`water`** — waterside zones `[{ from, to, w, side, boats }]` in lap
  fractions. Monaco's Port Hercule (inside the lap, with moored boats),
  Singapore's Marina Bay, Baku's Caspian promenade, Jeddah's Corniche lagoon,
  Montreal's rowing basin, the Yas Marina and Miami's famous fake marina all
  get a sheet of animated, reflective water just past the barriers; harbour
  zones are dressed with low-poly boats. (Albert Park and Suzuka keep their
  infield `lake`.)
- **Grass** — the verges now have real 3-D instanced grass tufts (with
  per-tuft colour variation around the circuit's own `grass` tint) plus mowed
  light/dark striping in the turf texture, so the trackside reads as groomed
  lawn instead of a flat green wash.

`node tools/verify_realism.mjs` checks all of it against the real built
world: per-track width, measured banking on the physics surface, water
geometry, boat count and tuft count.
Re-run the script occasionally to pick up roster changes or a circuit that
had no lap data last time (a brand-new track before its first race, for
example — as of this writing that's Madrid/Madring, plus Sepang and Marina
Bay depending on data availability).

If a circuit or the driver manifest is ever missing locally (e.g. a new
track was added to `tracks.js` but the script hasn't been re-run), the game
falls back to a **live** OpenF1 fetch at runtime (`src/circuitData.js`), and
if that also fails, to a simple procedural oval so the game never breaks.

## Weather

A weather preset (Sunny/Drizzle/Rain/Snow) blends live into a `cur` state
each frame; a separate Day/Dusk/Night time-of-day multiplier layers on top
for lighting mood independent of the weather itself.

**Rain** — `src/rainShader.js` renders the 3D scene into an offscreen render
target, then composites it back to the screen through a droplet/refraction
shader adapted from Martijn Steinrucken's ["Heartfelt"](https://www.shadertoy.com/view/ltffzl)
(CC BY-NC-SA 3.0) — real refraction of the actual rendered track through the
drops, not just an overlay.
- Rain amount scales with the weather preset *and* the player's speed —
  drops build up when slow, and clear off the glass at speed (wind), fading
  to ~52% of full intensity flat-out so the effect remains visible at speed.
- **Thunderstorms**: during rain, `updLightning()` schedules random lightning
  strikes — a screen flash plus a genuine brief boost to the scene's sun/hemi
  lighting — paired with a `AudioSys.thunder()` crack-and-rumble sound that's
  deliberately delayed after the flash (0.15–2.2s) to simulate distance,
  the way real thunder lags behind lightning.

**Snow** — `src/snowShader.js` is a pure screen-space alpha overlay (layered
cellular-noise flakes, no scene capture needed) composited on top of
whatever just rendered. Snow doesn't just fall, it *accumulates*: `snowAccum`
builds while it's snowing and melts back down otherwise, driving the opacity
of a white blanket mesh laid over the ground and a lighter partial-cover
mesh over the road (real traffic keeps the racing line clearer), and cutting
`cur.grip` down to as low as 60% once fully settled. Gusts periodically push
a `snowGustCur` multiplier up for a burst of heavier snowfall.

Both weather shaders turn off automatically on `LOW` graphics quality, and
on the title screen.

## Feel — car suspension & terrain

- Cars carry a lightweight spring (`c.bounceOff`/`c.bounceVel`): landings and
  wall impacts compress it and it rebounds and settles, plus a faint
  speed-linked jitter for road-surface vibration — instead of snapping
  instantly to the track surface.
- The ground is a heightfield, not a flat plane: it matches the track's real
  elevation right next to the road and blends smoothly down to a flat
  baseline further out, so a hilly real circuit reads as rolling terrain
  rather than a road floating over flat ground like a bridge.
- Ground, runoff, road and curbs sit only centimeters apart in world space —
  not enough for the depth buffer to reliably resolve at real-circuit
  distances — so each layer also carries a GPU-level `polygonOffset` bias
  (ground behind runoff behind road behind curbs/decals) to guarantee
  correct draw order regardless of camera distance, instead of relying on
  the tiny Y gap alone.

## Other notable features

- **Timing tower** (top-left during a race): Sky F1–style rolling leaderboard
  with live gaps and each driver's real headshot, rebuilt incrementally so a
  photo's `<img>` is never re-fetched unless it actually changes.
- **Attract mode**: the title screen isn't a static flyover — the whole grid
  actually races itself (same AI/physics as a real race, laps looping
  forever), and a `director` object cuts between a helicopter establishing
  shot, a chase cam, a trackside TV camera and a slow orbit on the current
  leading pack, like a real broadcast director.
- **Speech**: commentary/announcer voice via the Web Speech API, with rate
  and pitch that track the excitement of the moment instead of one flat
  tone — lights-out and a race win speak fastest and highest-pitched, a
  crash or a jump spikes rate with impact severity, "you're leading, keep it
  clean" and attract-mode track commentary stay calm and measured. Entering
  your driver name also triggers a warm, personalized encouragement line
  (slower rate, warmer pitch, to sound less robotic).
- **Start-line audio**: the countdown mixes in a broadband engine bed
  aggregated from the whole grid's rpm (not just your own car) so the grid
  sounds properly loud before lights out, plus a beep on each starting light
  and a distinct tone at lights-out.

## Current gameplay additions (September 2026)

- **Elevation-aware terrain:** the landscape is a real heightfield supporting
  the circuit instead of a flat plane beneath an elevated road. Track, props,
  scenery and collision sampling share the same height authority.
- **Continuous FIA kerbs:** red/white rumble strips sit in the outer metre of
  the tarmac, follow road elevation, produce strong suspension/camera rumble
  and low mechanical audio, and become substantially more slippery when wet.
- **Improved car presentation:** cleaner rounded tyres/rims without duplicated
  protruding suspension geometry, correctly placed brake discs, animated
  driver/head movement and a road-safe helmet camera with speed-responsive FOV.
- **Humanised opponents:** driver aggression and defence affect overtaking and
  inside-line blocking; pressure can provoke occasional persistent missed-apex,
  throttle-hesitation or brake-lock mistakes without intentional ramming.
- **Damage:** light impacts reduce power for five seconds and display an
  animated recovery spanner. Severe impacts cause terminal damage, shed visible
  bodywork debris and end the player's race. Contact and bottoming sparks are
  short-lived white-hot metal flecks rather than large orange clouds.
- **Local driver identity:** the player can enter a name and take or choose a
  portrait. The image is cropped/compressed to 256×256 and stored only in the
  browser under `polygon_gp_driver_profile_v1`; it is shown as the player's
  timing-tower headshot and remains available to an installed PWA offline.
  Camera and upload are separate controls: Camera uses the front-facing webcam
  or phone camera through `getUserMedia`, with a live mirrored preview and an
  explicit shutter; Upload opens the device file/photo picker.
- **Tablet stability and controls:** iOS motion permission has explicit
  pending/live/error handling and retry UI. Retina render-target dimensions,
  post-processing MSAA and mobile pixel ratio are constrained to avoid WebGL
  framebuffer exhaustion. HIGH/ULTRA obey a total-pixel/maximum-texture budget
  and resize every render target immediately when quality changes. The optional
  multi-pass bloom/grade chain is currently disabled because affected Safari/
  WebGL drivers silently returned a black image even with a complete 8-bit
  framebuffer; HIGH/ULTRA still retain their terrain, shadow, weather and prop
  upgrades through the standard ACES renderer. Render scale is capability-
  negotiated rather than guessed from a device name: the game reads WebGL's
  texture/renderbuffer/viewport limits and creates a real RGBA+depth framebuffer
  at the requested size, accepting it only when the driver reports COMPLETE and
  no GL error. Failed requests step down and the measured result is cached per
  viewport and tier. Shadow maps remain capped at 2K and ULTRA terrain at 30k
  nodes. PMREM blur stays within Three.js's supported 20-sample kernel.
  The gyro retry is a compact, non-blocking notice in the upper-right rather
  than a large prompt covering the centre of the driving view.
- **Rain:** the Heartfelt Shadertoy-derived refraction is used without the old
  canvas blobs overlaid on top, preserving sharp beads, trails and wet-glass
  distortion at racing speed.
- **Trackside presentation:** sponsor hoardings sit safely beyond the barrier,
  run parallel to the road and use a dedicated correctly oriented print plane
  (not mirrored BoxGeometry UVs), with high-anisotropy filtering and a gentle
  light lift for clean readability in rain and at dusk. Recognisable modelled birds have bodies, heads, beaks and tails plus
  shoulder-pivoted wings that alternate energetic flap sequences with glides.
  Birds follow continuous cross-circuit fly-by paths and are recycled only when
  more than 650 m away, so they recede to tiny silhouettes instead of vanishing.
  Rare display-jet fly-bys begin as a close overhead sight ahead of the player,
  accelerate away at 135–175 m/s until tiny beyond 1 km, and carry a loud
  filtered turbine pass. Swept delta wings, twin fins and changing body/accent
  colours distinguish each visit. Three outlets leave long-lived red/white/blue,
  orange/white/green or purple/white/cyan display-smoke ribbons.
- **Commentary mood:** race commentary starts from a happy, enthusiastic
  baseline and adds regular positive atmosphere calls between action events;
  speed, close racing, weather and incidents raise the delivery further.
- **Engine sound field:** the player's engine uses a layered V6-style firing
  spectrum (fundamental, intake harmonic, subdued exhaust pulse, mechanical
  edge, load movement and rev-limiter flutter) instead of one arcade sweep.
  The four nearest rivals receive independent pitch, filtering, stereo pan and
  smooth distance attenuation, so packs build and fade naturally.
- **Encoding-safe UI:** menu country markers use compact ISO-style codes, and
  source/UI text has been repaired from double-decoded UTF-8 so punctuation,
  accents, arrows and symbols render correctly instead of mojibake.

- **Visible diagnostics:** uncaught JavaScript errors, rejected promises,
  internal `console.error` reports and WebGL context loss open an in-game error
  report with Copy, Keep Playing and Reload actions. A five-second splash
  watchdog also guarantees a failed or blocked splash can never leave the app
  hidden behind a permanent blank screen.

Online multiplayer is intentionally not implemented yet; that remains future
work and will require a shared backend such as Firestore.

## Roadmap

- **Offline play** — make the game work fully offline (service worker +
  cache/manifest so it installs as a PWA and loads with no network at all).
  `public/data/` is already local/static, so this is mainly about caching
  the app shell (`index.html`, `src/`, fonts) and the data folder.

## Project layout

```
src/
  game.js          main game loop, physics, rendering, HUD
  tracks.js        circuit metadata + fallback polygons
  circuitData.js   loads real circuit shapes (local → live OpenF1 → oval)
  rainShader.js    windshield rain/lightning shader pass
  snowShader.js    screen-space falling-snow overlay shader pass
  tiltControls.js  mobile tilt/gyro steering
  gyroLab.js       gyro calibration test lab
  quality.js       graphics quality presets
scripts/
  fetch-openf1-data.mjs   downloads circuits + driver photos into public/data/
public/data/       pre-downloaded OpenF1 circuit/driver data (committed)
```
