#!/usr/bin/env node
import { readFileSync } from 'node:fs';
function loadEnvFile(file){
  try{
    const txt=readFileSync(file,'utf8');
    for(const raw of txt.split(/\r?\n/)){
      const line=raw.trim();
      if(!line||line.startsWith('#'))continue;
      const eq=line.indexOf('=');
      if(eq<1)continue;
      const k=line.slice(0,eq).trim();
      let v=line.slice(eq+1).trim();
      if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
      if(!(k in process.env))process.env[k]=v;
    }
  }catch{}
}
loadEnvFile('.env.local');
loadEnvFile('.env');
function loadFishKeyFile(file){
  try{
    const key=readFileSync(file,'utf8').trim();
    if(key&&!key.includes('=')&&!process.env.FISH_AUDIO_API_KEY)process.env.FISH_AUDIO_API_KEY=key;
  }catch{}
}
loadFishKeyFile('fish-key.txt');
loadFishKeyFile('admin/fish-key.txt');
loadFishKeyFile('.fish-key');
import fs from 'node:fs/promises';
import path from 'node:path';

const API = process.env.FISH_AUDIO_API_KEY;
const MODEL = process.env.FISH_TTS_MODEL || 's2.1-pro-free';
const OUT_DIR = 'public/audio/voicepack';
const LINES_FILE = process.env.VOICE_LINES_FILE || 'admin/voice-lines.json';
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');

const voices = {
  commentator: process.env.FISH_VOICE_COMMENTATOR,
  engineer: process.env.FISH_VOICE_ENGINEER || process.env.FISH_VOICE_COMMENTATOR,
  driver_radio: process.env.FISH_VOICE_DRIVER_RADIO || process.env.FISH_VOICE_DRIVER_ANGRY || process.env.FISH_VOICE_COMMENTATOR,
  driver_angry: process.env.FISH_VOICE_DRIVER_ANGRY || process.env.FISH_VOICE_DRIVER_RADIO || process.env.FISH_VOICE_COMMENTATOR
};

function speechKey(text){
  let h=2166136261>>>0;
  const s=String(text||'').replace(/\[[^\]]+\]\s*/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h.toString(16).padStart(8,'0');
}

if (!API && !DRY) {
  console.error('Missing FISH_AUDIO_API_KEY. Create .env.local containing FISH_AUDIO_API_KEY=your_key, or put only the key text in fish-key.txt. Use --dry-run to only build the planned manifest.');
  process.exit(1);
}

const lines = JSON.parse(await fs.readFile(LINES_FILE, 'utf8'));
await fs.mkdir(OUT_DIR, { recursive: true });
const manifest = { version: `fish-${new Date().toISOString()}`, provider: 'fish.audio', model: MODEL, generatedAt: new Date().toISOString(), clips: [] };

for (const line of lines) {
  const voiceId = voices[line.voice || line.role] || line.reference_id;
  if (!voiceId && !DRY) {
    console.warn(`skip ${line.id}: no voice id for voice=${line.voice || line.role}`);
    continue;
  }
  const roleDir = line.role || 'commentator';
  await fs.mkdir(path.join(OUT_DIR, roleDir), { recursive: true });
  const file = `${roleDir}/${line.id}.mp3`;
  const outPath = path.join(OUT_DIR, file);
  const key = speechKey(line.text);
  manifest.clips.push({ key, id: line.id, event: line.event, role: line.role, track: line.track || null, text: line.text, file, priority: line.priority || 5, cooldown: line.cooldown || 1.25, volume: line.volume ?? 1 });
  if (DRY) continue;
  try { if (!FORCE) { await fs.access(outPath); console.log(`exists ${file}`); continue; } } catch {}
  const body = {
    text: line.fishText || line.text,
    reference_id: voiceId,
    temperature: line.temperature ?? 0.78,
    top_p: line.top_p ?? 0.72,
    prosody: { speed: line.speed ?? 1.06, volume: line.volumeDb ?? 0, normalize_loudness: true },
    chunk_length: 300,
    normalize: true,
    format: 'mp3',
    sample_rate: 44100,
    mp3_bitrate: 128,
    latency: 'normal',
    max_new_tokens: 1024,
    repetition_penalty: 1.2,
    min_chunk_length: 50,
    condition_on_previous_chunks: true,
    early_stop_threshold: 1,
    features: ['quality-guard']
  };
  console.log(`generate ${file}: ${line.fishText || line.text}`);
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API}`, 'Content-Type': 'application/json', model: MODEL },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Fish TTS failed for ${line.id} ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}
if (DRY) {
  await fs.mkdir('admin/fish-cache', { recursive: true });
  await fs.writeFile('admin/fish-cache/planned-manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`dry-run wrote admin/fish-cache/planned-manifest.json with ${manifest.clips.length} planned entries`);
} else {
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`wrote ${path.join(OUT_DIR, 'manifest.json')} with ${manifest.clips.length} entries`);
}
