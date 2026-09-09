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

const API = process.env.FISH_AUDIO_API_KEY;
if (!API) {
  console.error('Missing FISH_AUDIO_API_KEY. Create .env.local containing FISH_AUDIO_API_KEY=your_key, or put only the key text in fish-key.txt.');
  process.exit(1);
}
const q = process.argv.slice(2).join(' ') || 'commentator';
const params = new URLSearchParams({ page_size: '25', page_number: '1', title: q, language: 'en', licensed: 'true' });
const res = await fetch(`https://api.fish.audio/model?${params}`, { headers: { Authorization: `Bearer ${API}` } });
if (!res.ok) throw new Error(`Fish Audio model search failed ${res.status}: ${await res.text()}`);
const data = await res.json();
await fs.mkdir('admin/fish-cache', { recursive: true });
await fs.writeFile(`admin/fish-cache/search-${q.replace(/[^a-z0-9]+/gi,'_')}.json`, JSON.stringify(data, null, 2));
for (const m of data.items || []) {
  console.log(`${m._id}\t${m.title}\tlicensed=${m.licensed}\tlanguages=${(m.languages||[]).join(',')}\ttags=${(m.tags||[]).join(',')}`);
}
