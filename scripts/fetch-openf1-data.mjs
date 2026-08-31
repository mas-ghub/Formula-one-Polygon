/* ============ One-off OpenF1 data fetcher ============
   Downloads real circuit racing lines and driver headshots from OpenF1 and
   writes them into public/data/ so the game loads them as local static
   files instead of hitting the OpenF1 API (and its aggressive rate limit)
   every time someone plays. Re-run this occasionally to refresh the roster
   or pick up a circuit that had no lap data last time (e.g. a brand new
   track before its first race has been run).

   Usage: node scripts/fetch-openf1-data.mjs
*/
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKS } from '../src/tracks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CIRCUITS_DIR = path.join(ROOT, 'public', 'data', 'circuits');
const DRIVERS_DIR = path.join(ROOT, 'public', 'data', 'drivers');

const SESSION_CANDIDATES = 4;
const MAX_RETRIES = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error(`Rate limited too many times: ${url}`);
}

async function fetchLapCircuitPts(sessionKey) {
  const laps = await fetchJSON(`https://api.openf1.org/v1/laps?session_key=${sessionKey}`);
  if (!Array.isArray(laps) || !laps.length) return null;
  const clean = laps.filter(l => l.lap_duration && !l.is_pit_out_lap && l.lap_number > 1);
  if (!clean.length) return null;
  clean.sort((a, b) => a.lap_duration - b.lap_duration);
  const lap = clean[0];

  const from = new Date(lap.date_start);
  const to = new Date(from.getTime() + lap.lap_duration * 1000 + 300);
  const url = `https://api.openf1.org/v1/location?session_key=${sessionKey}`
    + `&driver_number=${lap.driver_number}`
    + `&date>=${encodeURIComponent(from.toISOString())}`
    + `&date<${encodeURIComponent(to.toISOString())}`;
  const loc = await fetchJSON(url);
  if (!Array.isArray(loc) || loc.length < 20) return null;

  loc.sort((a, b) => new Date(a.date) - new Date(b.date));
  let elevMin = Infinity;
  for (const p of loc) elevMin = Math.min(elevMin, p.z / 10);
  const pts = loc.map(p => [p.x / 10, p.z / 10 - elevMin, p.y / 10]);
  return smoothClosedPath(pts, 5);
}

// Real GPS/telemetry position has sample-to-sample jitter that a raw
// point-to-point track surface reproduces as jagged terrain and, on a
// close-together section (e.g. a hairpin or pit straight), can even nudge
// the path across itself. A small centered moving average (wrapping around
// the closed lap) smooths that out while leaving the actual track shape and
// elevation profile intact.
function smoothClosedPath(pts, windowSize) {
  const n = pts.length, half = Math.floor(windowSize / 2);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sz = 0;
    for (let k = -half; k <= half; k++) {
      const p = pts[(i + k + n) % n];
      sx += p[0]; sy += p[1]; sz += p[2];
    }
    const c = half * 2 + 1;
    out[i] = [sx / c, sy / c, sz / c];
  }
  return out;
}

async function fetchCircuitPts(circuitKey) {
  const sessions = await fetchJSON(`https://api.openf1.org/v1/sessions?circuit_key=${circuitKey}&session_type=Race`);
  if (!Array.isArray(sessions) || !sessions.length) return null;
  sessions.sort((a, b) => new Date(b.date_start) - new Date(a.date_start));
  for (const session of sessions.slice(0, SESSION_CANDIDATES)) {
    try {
      const pts = await fetchLapCircuitPts(session.session_key);
      if (pts) return { pts, meetingKey: session.meeting_key, sessionKey: session.session_key };
    } catch { /* try the next most recent session */ }
    await sleep(300);
  }
  return null;
}

async function fetchCircuits() {
  await mkdir(CIRCUITS_DIR, { recursive: true });
  console.log(`Fetching ${TRACKS.length} circuits from OpenF1...`);
  const results = { ok: 0, missing: [] };
  for (const def of TRACKS) {
    if (!def.openf1CircuitKey) continue;
    process.stdout.write(`  ${def.name} (circuit_key=${def.openf1CircuitKey})... `);
    try {
      const data = await fetchCircuitPts(def.openf1CircuitKey);
      if (!data) {
        console.log('no usable lap data, skipped');
        results.missing.push(def.name);
        continue;
      }
      const file = path.join(CIRCUITS_DIR, `${def.openf1CircuitKey}.json`);
      await writeFile(file, JSON.stringify(data.pts));
      console.log(`ok (${data.pts.length} points)`);
      results.ok++;
    } catch (err) {
      console.log(`failed: ${err.message}`);
      results.missing.push(def.name);
    }
    await sleep(250);
  }
  console.log(`Circuits done: ${results.ok} saved, ${results.missing.length} skipped (${results.missing.join(', ') || 'none'})`);
}

async function downloadImage(url, destFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destFile, buf);
}

async function fetchDrivers() {
  await mkdir(DRIVERS_DIR, { recursive: true });
  console.log('Fetching current driver roster from OpenF1...');
  const data = await fetchJSON('https://api.openf1.org/v1/drivers?session_key=latest');
  const seen = new Set();
  const manifest = [];
  for (const d of data) {
    if (!d.driver_number || seen.has(d.driver_number)) continue;
    seen.add(d.driver_number);
    let color = d.team_colour ? `#${d.team_colour}` : '#888888';
    if (color === '#null') color = '#888888';
    const entry = {
      name: d.full_name || d.broadcast_name || `${d.first_name} ${d.last_name}`,
      code: d.name_acronym || (d.last_name ? d.last_name.substring(0, 3).toUpperCase() : 'DRV'),
      team: d.team_name || 'F1 Team',
      color, colB: color,
      num: d.driver_number,
      headshot: null,
    };
    if (d.headshot_url) {
      const destFile = path.join(DRIVERS_DIR, `${d.driver_number}.png`);
      try {
        await downloadImage(d.headshot_url, destFile);
        entry.headshot = `/data/drivers/${d.driver_number}.png`;
        process.stdout.write(`  #${d.driver_number} ${entry.name}: image ok\n`);
      } catch (err) {
        process.stdout.write(`  #${d.driver_number} ${entry.name}: image failed (${err.message})\n`);
      }
    }
    manifest.push(entry);
    await sleep(120);
  }
  await writeFile(path.join(DRIVERS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Drivers done: ${manifest.length} saved to public/data/drivers/manifest.json`);
}

await fetchCircuits();
await fetchDrivers();
console.log('All done. Commit public/data/ so players never have to hit OpenF1 live.');
