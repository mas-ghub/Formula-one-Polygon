#!/usr/bin/env node
import fs from 'node:fs/promises';

const API = process.env.FISH_AUDIO_API_KEY;
if (!API) {
  console.error('Missing FISH_AUDIO_API_KEY. Create an API key in fish.audio/app and run: FISH_AUDIO_API_KEY=... node admin/fish-search-voices.mjs commentator');
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
