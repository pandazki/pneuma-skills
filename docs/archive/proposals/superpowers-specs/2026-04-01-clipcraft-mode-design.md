# ClipCraft Mode — AI Video Production Studio

**Date:** 2026-04-01
**Status:** Approved
**Inspired by:** [medeo.app](https://medeo.app)

## Summary

ClipCraft is a pneuma mode for AI-orchestrated video production. Users describe their video vision in natural language, and the agent decomposes the work into scenes, calls external AI APIs (image generation, video generation, TTS, BGM) via MCP tools, and assembles results into a storyboard that the viewer renders as a timeline-based video editor.

**Formula:** `Storyboard JSON + MCP Generation Tools + Timeline Viewer`

## Design Approach: Storyboard-First

Three approaches were considered:

| | A: Storyboard-First | B: Script-Driven | C: Timeline-First (NLE) |
|---|---|---|---|
| Data model | `storyboard.json` with scene slots | Annotated screenplay markdown | Multi-track timeline JSON |
| Viewer | Scene cards + preview + asset panel | Script view + inline previews | Full NLE with tracks |
| Fit for pneuma | Excellent | Good | Poor (viewer too complex) |

**Selected: Approach A** — Storyboard JSON is the perfect fit for pneuma's core loop (agent writes files → viewer renders). Each scene is an independent unit with typed slots (visual, audio, caption), enabling granular regeneration and iteration.

## Architecture

```
Layer 4: ClipCraft Mode     — ModeManifest (skill + viewer + MCP tools)
Layer 3: Storyboard Viewer  — Scene cards, timeline strip, video preview, asset panel
Layer 2: Agent + MCP Tools  — Orchestrates generation pipeline via tool calls
Layer 1: Pneuma Shell       — WS bridge, file watcher, HTTP server
```

## Data Model

### Workspace Structure

```
workspace/
├── project.json              # Project metadata (title, aspect ratio, style)
├── storyboard.json           # Scene sequence — the source of truth
├── assets/
│   ├── reference/            # User-uploaded reference images
│   ├── images/               # AI-generated images (character sheets, scenes)
│   ├── clips/                # AI-generated video clips
│   ├── audio/                # TTS / voiceover audio files
│   └── bgm/                  # Background music files
├── scripts/
│   ├── generate_image.mjs    # Image generation MCP server
│   ├── generate_video.mjs    # Video generation MCP server
│   ├── generate_tts.mjs      # Text-to-speech MCP server
│   └── search_bgm.mjs       # BGM search/download MCP server
└── export/                   # Rendered output
```

### project.json

```json
{
  "title": "My Video Project",
  "aspectRatio": "16:9",
  "resolution": { "width": 1920, "height": 1080 },
  "fps": 30,
  "style": {
    "captionFont": "Inter",
    "captionPosition": "bottom",
    "captionStyle": "outline"
  }
}
```

### storyboard.json

The core data model. Each scene has typed slots with generation status tracking.

```json
{
  "version": 1,
  "scenes": [
    {
      "id": "scene-001",
      "order": 1,
      "duration": 5.0,
      "visual": {
        "type": "video",
        "status": "ready",
        "source": "assets/clips/scene-001.mp4",
        "prompt": "An elderly professor with wild white hair in a cozy lab...",
        "model": "kling-3-omni",
        "thumbnail": "assets/images/scene-001-thumb.jpg"
      },
      "audio": {
        "type": "tts",
        "status": "ready",
        "text": "Welcome to my channel, today we explore...",
        "voice": "en-us-narrator-1",
        "source": "assets/audio/scene-001.mp3",
        "model": "elevenlabs"
      },
      "caption": "Welcome to my channel, today we explore...",
      "transition": { "type": "crossfade", "duration": 0.5 }
    }
  ],
  "bgm": {
    "source": "assets/bgm/lofi-hiphop.mp3",
    "title": "A Soul Hip Hop Violin",
    "volume": 0.3,
    "fadeIn": 1.0,
    "fadeOut": 2.0
  },
  "characterRefs": [
    {
      "id": "prof-einstein",
      "name": "The Professor",
      "referenceSheet": "assets/reference/professor-sheet.png",
      "description": "Elderly professor, wild white hair, warm eyes, tweed vest"
    }
  ]
}
```

**Status lifecycle:** `"pending"` → `"generating"` → `"ready"` | `"error"`

The viewer renders different UI per status: placeholder (pending), spinner (generating), thumbnail/player (ready), error message + retry button (error).

## Viewer Design

The viewer has three zones within the pneuma editor layout:

### Zone 1: Video Preview (top)
- Plays scenes in sequence as a continuous video
- Shows current scene indicator
- Aspect ratio toggle (16:9, 9:16, 1:1)
- Playback controls (play/pause, seek, speed)
- When a scene's visual is `"generating"`, shows a placeholder with the prompt text

### Zone 2: Scene Strip (middle)
- Horizontal scrolling row of scene cards
- Each card shows: thumbnail (or status indicator), duration badge, scene number
- Click to select → sends `<viewer-context>` with scene details to agent
- Drag to reorder (stretch goal)
- "+" button to add scene (triggers agent command)

### Zone 3: Track Overview (bottom)
- Simplified multi-track display (read-only, no drag editing):
  - **Tt** — Caption/subtitle track (text blocks per scene)
  - **Video** — Thumbnail filmstrip
  - **Audio** — Voiceover waveform visualization
  - **BGM** — Background music waveform, extends full duration
- Playhead synced with preview
- Time markers

### Asset Sidebar (toggleable)
- Tab: Characters (reference sheets)
- Tab: Generated (all generated assets grouped by type)
- Tab: Uploaded (user reference files)

## MCP Tool Architecture

Four MCP servers, each wrapping one generation capability. Registered via `manifest.skill.mcpServers`. Each server is a Node.js stdio process that the agent calls as tools.

### clipcraft-imagegen

**Tools:**
- `generate_image` — Text-to-image generation
  - Params: `prompt`, `width`, `height`, `style`, `reference_image?`, `output_path`
  - Returns: `{ path, thumbnail_path }`
- `edit_image` — Edit existing image with instructions
  - Params: `source_path`, `instructions`, `output_path`
- `upscale_image` — Upscale/enhance image
  - Params: `source_path`, `scale`, `output_path`

**Providers:** fal.ai (Flux), OpenRouter (DALL-E, Midjourney proxy), Replicate

### clipcraft-videogen

**Tools:**
- `generate_video_from_text` — Text-to-video
  - Params: `prompt`, `duration`, `aspect_ratio`, `output_path`
  - Returns: `{ path, duration, thumbnail_path }`
- `generate_video_from_image` — Image-to-video (animate a still)
  - Params: `image_path`, `prompt`, `duration`, `output_path`
- `extend_video` — Extend existing video clip
  - Params: `source_path`, `duration`, `prompt`, `output_path`

**Providers:** fal.ai (Kling, Minimax, Wan), Replicate (Runway), direct API

### clipcraft-tts

**Tools:**
- `generate_speech` — Text-to-speech synthesis
  - Params: `text`, `voice_id`, `speed`, `output_path`
  - Returns: `{ path, duration }`
- `list_voices` — List available voices
  - Returns: `{ voices: [{ id, name, language, preview_url }] }`

**Providers:** ElevenLabs, OpenAI TTS, Fish Audio

### clipcraft-bgm

**Tools:**
- `search_music` — Search stock music by mood/genre
  - Params: `query`, `mood?`, `genre?`, `duration_min?`, `duration_max?`
  - Returns: `{ tracks: [{ id, title, artist, duration, preview_url }] }`
- `download_track` — Download a music track
  - Params: `track_id`, `output_path`
- `generate_music` — AI music generation
  - Params: `prompt`, `duration`, `output_path`

**Providers:** Freesound (free), Suno (AI gen), Pixabay Audio

### Provider Abstraction

Each MCP server reads `PROVIDER` and `API_KEY` from environment. Internally routes to the correct API adapter. Adding a new provider = adding an adapter function, no manifest changes needed.

## Agent Skill

### SKILL.md Structure

```
skill/
├── SKILL.md                    # Main skill: workflow, storyboard protocol, patterns
├── rules/
│   ├── storyboard-protocol.md  # How to read/write storyboard.json
│   ├── scene-generation.md     # Scene generation strategies
│   ├── character-consistency.md # Character reference management
│   ├── audio-workflow.md       # TTS + BGM patterns
│   ├── error-recovery.md       # Degradation strategies
│   └── export-assembly.md      # Export workflow
└── references/
    ├── prompt-engineering.md    # Tips for image/video prompt crafting
    └── aspect-ratios.md        # Common aspect ratios and use cases
```

### Core Workflow (taught to agent via skill)

1. **Understand** — Parse user's creative vision, identify style/mood/audience
2. **Script** — Break down into scenes with narration text
3. **Character Setup** — Generate reference sheets for recurring characters
4. **Generate Visuals** — Per-scene: write placeholder → call MCP tool → update storyboard
5. **Generate Audio** — Per-scene TTS for narration, search/generate BGM
6. **Assemble** — Update storyboard with all assets, set transitions and timing
7. **Review** — Present to user, iterate on feedback per-scene

### Storyboard Protocol

The agent follows a strict protocol when modifying `storyboard.json`:
1. Read current state
2. Write scene with `status: "generating"` (viewer shows spinner)
3. Call MCP tool to generate asset
4. On success: update to `status: "ready"` + `source` path
5. On failure: update to `status: "error"` + `errorMessage`, attempt fallback

### Error Recovery Strategies

- Image-to-video fails → fallback to text-to-video
- Content moderation blocks → rephrase prompt without likeness references
- API rate limit → queue and retry with backoff
- Provider down → suggest user switch provider in config

## Manifest Configuration

### Init Params

```typescript
params: [
  { name: "aspectRatio", label: "Default aspect ratio", type: "string", defaultValue: "16:9" },
  { name: "imageProvider", label: "Image generation provider", type: "string", defaultValue: "fal" },
  { name: "imageApiKey", label: "Image provider API key", type: "string", defaultValue: "", sensitive: true },
  { name: "videoProvider", label: "Video generation provider", type: "string", defaultValue: "fal" },
  { name: "videoApiKey", label: "Video provider API key", type: "string", defaultValue: "", sensitive: true },
  { name: "ttsProvider", label: "TTS provider", type: "string", defaultValue: "openai" },
  { name: "ttsApiKey", label: "TTS API key", type: "string", defaultValue: "", sensitive: true },
  { name: "bgmProvider", label: "BGM provider", type: "string", defaultValue: "freesound" },
  { name: "bgmApiKey", label: "BGM API key", type: "string", defaultValue: "", sensitive: true },
]
```

### ViewerApi

```typescript
viewerApi: {
  workspace: {
    type: "single",
    multiFile: true,
    ordered: true,
    hasActiveFile: false,
  },
  actions: [
    { id: "play-preview", label: "Play", category: "ui", agentInvocable: true },
    { id: "pause-preview", label: "Pause", category: "ui", agentInvocable: true },
    { id: "select-scene", label: "Select Scene", category: "navigate", agentInvocable: true,
      params: { sceneId: { type: "string", description: "Scene ID", required: true } } },
    { id: "set-aspect-ratio", label: "Set Aspect Ratio", category: "ui", agentInvocable: true,
      params: { ratio: { type: "string", description: "16:9, 9:16, or 1:1", required: true } } },
  ],
  commands: [
    { id: "regenerate-scene", label: "Regenerate Scene", description: "Regenerate the selected scene's visual" },
    { id: "add-scene-after", label: "Add Scene After", description: "Insert a new scene after selection" },
    { id: "remove-scene", label: "Remove Scene", description: "Delete the selected scene" },
    { id: "regenerate-audio", label: "Regenerate Audio", description: "Re-generate TTS for selected scene" },
  ],
  locatorDescription: 'Navigate to scene: data=\'{"scene":"scene-001"}\'. Auto-play from scene: data=\'{"scene":"scene-001","autoplay":true}\'.',
}
```

## Export Strategy

### Phase 1 (MVP): ffmpeg Script

Agent generates `export/render.sh` that uses ffmpeg to:
1. Concatenate video clips with transitions
2. Mix voiceover audio per scene
3. Overlay BGM at specified volume
4. Burn in captions/subtitles
5. Output final video file

User runs the script manually. Requires ffmpeg installed.

### Phase 2: Server-side Export

Add `/api/export` route that executes ffmpeg on the server. Viewer gets an "Export" button.

### Phase 3: Remotion Rendering (stretch)

Convert storyboard.json to Remotion compositions for frame-accurate rendering with animated transitions, text effects, etc.

## Differentiation from Medeo

| | Medeo | ClipCraft |
|---|---|---|
| Runtime | Cloud SaaS | Local + your own API keys |
| Models | Fixed vendor selection | User picks any provider |
| Cost | Credits with platform markup | Direct API costs |
| Data | Cloud storage | Local files, git-trackable |
| Extensibility | Closed | MCP tools, fully extensible |
| Editing | Full NLE timeline | Storyboard + agent iteration |
| Offline | No | Viewer works offline, generation needs API |

## Scope for MVP Demo

For the initial demo implementation:

1. **Manifest + Skill** — Full manifest.ts, SKILL.md with workflow rules
2. **Viewer** — Video preview + scene strip + track overview (no drag editing)
3. **MCP Servers** — At minimum `clipcraft-imagegen` (fal.ai) and `clipcraft-tts` (OpenAI). Video gen and BGM can be stubs that the agent knows about.
4. **Seed Files** — Default project.json + empty storyboard.json + scripts/
5. **Data Model** — Full storyboard.json schema implemented in viewer
6. **Export** — Agent-generated ffmpeg script

Post-MVP:
- Full video generation MCP server
- BGM search/generation
- Drag-to-reorder scenes
- Asset panel with character management
- Server-side export
- Voice cloning
