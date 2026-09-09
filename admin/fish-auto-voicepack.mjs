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
import { spawn } from 'node:child_process';

const API = process.env.FISH_AUDIO_API_KEY;
const MODEL = process.env.FISH_TTS_MODEL || 's2.1-pro-free';
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const queries = {
  commentator: ['british commentator', 'sports announcer', 'commentator', 'announcer', 'british male'],
  engineer: ['calm british', 'engineer', 'radio', 'british female', 'natural'],
  driver_radio: ['young male', 'radio', 'driver', 'british male', 'natural male'],
  driver_angry: ['angry male', 'shouting', 'sport male', 'driver', 'male']
};

function titleOf(m) { return String(m.title || m.name || '').toLowerCase(); }
function tagsOf(m) { return Array.isArray(m.tags) ? m.tags.join(' ').toLowerCase() : ''; }
function langsOf(m) { return Array.isArray(m.languages) ? m.languages.join(' ').toLowerCase() : ''; }
function idOf(m) { return m._id || m.id || m.reference_id || m.model_id; }

function scoreModel(role, m, used = new Set()) {
  let s = 0;
  const title = titleOf(m);
  const tags = tagsOf(m);
  const text = `${title} ${tags}`;
  const langs = langsOf(m);
  const id = idOf(m);
  if (!id) return -999999;
  if (used.has(id)) s -= role === 'engineer' ? 80 : 220;
  if (m.licensed === true) s += 120;
  if (langs.includes('en')) s += 80;
  if (langs.includes('en-gb') || text.includes('british') || text.includes('uk')) s += 60;
  if (text.includes('natural')) s += 35;
  if (text.includes('professional') || text.includes('premium')) s += 25;
  if (role === 'commentator') {
    if (/commentator|announcer|sport|sports|broadcast|presenter|narrator/.test(text)) s += 120;
    if (/excited|energetic|dramatic|shout|powerful/.test(text)) s += 80;
    if (/male|man|gentleman/.test(text) && !/female|woman/.test(text)) s += 45;
  } else if (role === 'engineer') {
    if (/calm|confident|radio|assistant|female|woman|clear/.test(text)) s += 80;
    if (/angry|shout|excited/.test(text)) s -= 35;
  } else if (role === 'driver_radio') {
    if (/male|man|young|radio|driver|casual|clear/.test(text)) s += 80;
    if (/commentator|announcer|narrator/.test(text)) s -= 60;
  } else if (role === 'driver_angry') {
    if (/angry|shout|energetic|male|man|sport|driver|dramatic/.test(text)) s += 95;
    if (/calm|soft|sleep/.test(text)) s -= 45;
  }
  return s;
}

async function searchModels(q) {
  const common = { page_size: '25', page_number: '1', title: q, language: 'en' };
  // Prefer explicitly licensed voices. Some free accounts currently return zero
  // for licensed=true; if so, fall back to accessible public models so the pack
  // can still be generated for local testing. The selection cache records what
  // happened so release rights can be checked before public/commercial use.
  for (const licensed of ['true', '']) {
    const params = new URLSearchParams(licensed ? { ...common, licensed } : common);
    const res = await fetch(`https://api.fish.audio/model?${params}`, { headers: { Authorization: `Bearer ${API}` } });
    if (!res.ok) throw new Error(`Fish Audio model search failed for "${q}" ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length || !licensed) return items.map(m => ({ ...m, __licensedSearch: !!licensed }));
  }
  return [];
}

async function pickVoice(role, used) {
  const override = process.env[`FISH_VOICE_${role.toUpperCase()}`];
  if (override) return { id: override, title: '(env override)', score: 999999 };
  const all = [];
  for (const q of queries[role]) {
    try {
      for (const m of await searchModels(q)) all.push(m);
    } catch (e) {
      console.warn(`Search skipped for ${role}/${q}: ${e.message}`);
    }
  }
  const seen = new Map();
  for (const m of all) {
    const id = idOf(m);
    if (id && !seen.has(id)) seen.set(id, m);
  }
  const ranked = [...seen.values()].map(m => ({ m, id: idOf(m), title: m.title || m.name || idOf(m), score: scoreModel(role, m, used) })).sort((a, b) => b.score - a.score);
  if (!ranked[0]) throw new Error(`No licensed English Fish voice found for ${role}. Set FISH_VOICE_${role.toUpperCase()} manually.`);
  return ranked[0];
}

function runGenerator(env) {
  return new Promise((resolve, reject) => {
    const args = ['admin/fish-generate-voicepack.mjs'];
    if (DRY) args.push('--dry-run');
    if (FORCE) args.push('--force');
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`generator exited with code ${code}`)));
  });
}

if (!API && !DRY) {
  console.error('Missing FISH_AUDIO_API_KEY. Create .env.local containing FISH_AUDIO_API_KEY=your_key, or put only the key text in fish-key.txt, then run npm run fish:auto.');
  process.exit(1);
}

if (DRY && !API) {
  await runGenerator({ FISH_TTS_MODEL: MODEL });
  process.exit(0);
}

await fs.mkdir('admin/fish-cache', { recursive: true });
const used = new Set();
const selected = {};
for (const role of ['commentator', 'engineer', 'driver_radio', 'driver_angry']) {
  const pick = await pickVoice(role, used);
  selected[role] = pick;
  used.add(pick.id);
  console.log(`${role}: ${pick.id}  ${pick.title}  score=${pick.score}`);
}
await fs.writeFile('admin/fish-cache/auto-selected-voices.json', JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, note: 'Auto-search prefers licensed=true. If Fish returned no licensed results, selected voices are accessible public models for local testing; verify usage rights before public/commercial release.', selected }, null, 2));

await runGenerator({
  FISH_TTS_MODEL: MODEL,
  FISH_VOICE_COMMENTATOR: selected.commentator.id,
  FISH_VOICE_ENGINEER: selected.engineer.id,
  FISH_VOICE_DRIVER_RADIO: selected.driver_radio.id,
  FISH_VOICE_DRIVER_ANGRY: selected.driver_angry.id
});
