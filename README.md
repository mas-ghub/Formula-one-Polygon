# POLYGON GP — Low-Poly Grand Prix

A browser-based, low-poly F1 racing game built with Three.js. Real circuit
layouts, a full 2026-calendar roster, dynamic weather (rain, thunderstorms
and accumulating/melting snow) with a day/dusk/night time-of-day control, a
Sky F1–style timing tower with live driver photos, and a title screen where
the whole grid actually races itself under a live broadcast-style camera
director.

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
  to ~22% of full intensity flat-out.
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
