/* ============ Real Circuit Geometry from OpenF1 ============
   Each track in tracks.js ships a hand-drawn fallback polygon (`pts`) so the
   game always has something to render immediately. This module replaces that
   approximation with the real racing line, attaching it as `def.realPts` —
   an array of [worldX, worldY(elevation), worldZ] triples in meters.
   buildWorld() in game.js prefers `realPts` when present and falls back to
   `pts` otherwise.

   Data source priority:
   1. public/data/circuits/<circuit_key>.json — pre-downloaded by
      `node scripts/fetch-openf1-data.mjs` and served locally. Instant, no
      network dependency on OpenF1, no rate limiting. This is what ships to
      players.
   2. A live fetch straight from the OpenF1 API — only reached for a circuit
      that has no local file yet (e.g. it was added to tracks.js after the
      last data-fetch run), so the game still works before someone re-runs
      the fetch script.
   3. The hand-drawn `pts` fallback, if neither of the above produced data. */

const CACHE_VERSION = 'v2';
const SESSION_CANDIDATES = 3;
const MAX_CONCURRENT = 1; // OpenF1's free tier rate-limits aggressively — go fully serial
const MAX_RETRIES = 4;

async function fetchJSON(url, timeoutMs = 6000) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 429 && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('HTTP 429 (rate limited)');
}

async function loadLocalCircuit(circuitKey) {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/circuits/${circuitKey}.json`);
    if (!res.ok) return null;
    const pts = await res.json();
    return Array.isArray(pts) && pts.length > 20 ? pts : null;
  } catch {
    return null;
  }
}

async function fetchLapCircuitPts(sessionKey) {
  const laps = await fetchJSON(`https://api.openf1.org/v1/laps?session_key=${sessionKey}`);
  if (!Array.isArray(laps) || !laps.length) return null;

  // Skip lap 1 (grid start, not a clean flying lap) and any pit-out laps,
  // then take the fastest remaining lap — most likely a clean racing line.
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
  const loc = await fetchJSON(url, 10000);
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

async function fetchLiveCircuitPts(circuitKey) {
  const sessions = await fetchJSON(`https://api.openf1.org/v1/sessions?circuit_key=${circuitKey}&session_type=Race`);
  if (!Array.isArray(sessions) || !sessions.length) return null;
  sessions.sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

  for (const session of sessions.slice(0, SESSION_CANDIDATES)) {
    try {
      const pts = await fetchLapCircuitPts(session.session_key);
      if (pts) return pts;
    } catch { /* try the next most recent session */ }
  }
  return null;
}

async function loadRealCircuit(def) {
  if (!def.openf1CircuitKey) return;
  const key = def.openf1CircuitKey;

  const local = await loadLocalCircuit(key);
  if (local) { def.realPts = local; return; }

  const cacheKey = `openf1_circuit_${CACHE_VERSION}_${key}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) { def.realPts = JSON.parse(cached); return; }
  } catch { /* ignore corrupt cache */ }

  try {
    const pts = await fetchLiveCircuitPts(key);
    if (pts && pts.length > 20) {
      def.realPts = pts;
      try { localStorage.setItem(cacheKey, JSON.stringify(pts)); } catch { /* storage full/unavailable */ }
    } else {
      console.warn(`No usable circuit data (local or live) for ${def.name}, using fallback layout.`);
    }
  } catch (err) {
    console.warn(`OpenF1 live circuit fetch failed for ${def.name}, using fallback layout:`, err.message);
  }
}

export async function loadRealCircuits(tracks) {
  const queue = [...tracks];
  const workers = Array.from({ length: MAX_CONCURRENT }, async () => {
    let def;
    while ((def = queue.shift())) {
      await loadRealCircuit(def);
    }
  });
  await Promise.allSettled(workers);
}
