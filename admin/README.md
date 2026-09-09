# POLYGON GP voice-pack admin

This is the safe admin-side route for high-quality commentary/radio. The live PWA never receives a Fish Audio key and does not run AI locally.

## Why not Playwright/login scraping?

Use the official Fish Audio API instead of automating `fish.audio/app` with Playwright. Browser automation is brittle, may trip anti-bot/login protections, and can expose session cookies. The API supports TTS, voice model listing and emotion tags directly.

## 1. Create/get your API key

In `https://fish.audio/app/`, create an API key/token. Do not commit it.

```bash
export FISH_AUDIO_API_KEY="..."
```

## 2. Find licensed voices

Search for public licensed English voices:

```bash
FISH_AUDIO_API_KEY="..." node admin/fish-search-voices.mjs commentator
FISH_AUDIO_API_KEY="..." node admin/fish-search-voices.mjs sport
FISH_AUDIO_API_KEY="..." node admin/fish-search-voices.mjs radio
```

Pick IDs from the output.

## 3. Generate the pack

```bash
FISH_AUDIO_API_KEY="..." \
FISH_VOICE_COMMENTATOR="fish-model-id-for-excited-commentator" \
FISH_VOICE_ENGINEER="fish-model-id-for-calm-engineer" \
FISH_VOICE_DRIVER_ANGRY="fish-model-id-for-angry-driver-radio" \
FISH_TTS_MODEL="s2.1-pro-free" \
node admin/fish-generate-voicepack.mjs
```

The script writes MP3 files to:

```text
public/audio/voicepack/
```

and updates:

```text
public/audio/voicepack/manifest.json
```

## Emotion tags

Fish S2 models accept bracket cues such as:

- `[excited]`
- `[angry]`
- `[shouting]`
- `[confident]`
- `[calm]`
- `[worried]`
- `[emphasis]`

Put the clean in-game fallback in `text`, and the Fish version with tags in `fishText`.

## Dry run

```bash
node admin/fish-generate-voicepack.mjs --dry-run
```

## Runtime behaviour

`src/game.js` loads `public/audio/voicepack/manifest.json` at startup. If a generated clip matches the exact clean line text, it plays the MP3. If no clip exists, the game falls back to the existing browser Web Speech API.

## YouTube / reference audio

Do not rip random YouTube audio. Only use reference audio you own, have permission to use, or that is licensed for your use. YouTube links can be stored as human reference notes, but this tooling intentionally does not download YouTube audio.
