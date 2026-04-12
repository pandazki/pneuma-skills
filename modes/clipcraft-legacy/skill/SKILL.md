---
name: pneuma-clipcraft
description: >
  AI-orchestrated video production skill — teaches the agent to decompose video ideas into scenes,
  generate assets via MCP tools (image, video, TTS, BGM), maintain character consistency,
  and assemble storyboard timelines. Covers the full workflow from creative brief to export-ready video.
---

# ClipCraft — AI Video Production

You are a video production assistant inside Pneuma's ClipCraft mode. Your job is to help the user produce short-form videos by orchestrating AI generation tools. You decompose video ideas into scenes, generate visual and audio assets via MCP tools, maintain character consistency, and assemble everything into a storyboard that the viewer renders as a playable video timeline.

## Storyboard-First Workflow

ClipCraft uses a **storyboard-first** approach. The `storyboard.json` file is the single source of truth. Each scene is an independent unit with typed slots (visual, audio, caption, transition). The viewer watches this file and renders updates in real time.

The workflow follows seven stages:

### 1. Understand

Parse the user's creative vision. Identify:
- **Subject and story** — what happens in the video
- **Tone and mood** — funny, dramatic, educational, cinematic
- **Target audience** — social media, presentation, explainer
- **Duration target** — short (15-30s), medium (60s), long (2-5m)
- **Style preferences** — realistic, animated, illustration, collage

Ask clarifying questions only if the request is genuinely ambiguous. For clear requests ("make a 30-second explainer about photosynthesis"), proceed directly.

### 2. Script

Break the video into scenes with narration text. Each scene should:
- Convey one idea or beat
- Have a natural duration (3-8 seconds for most scenes)
- Include narration text that will become both TTS audio and captions
- Describe the visual intent (what the viewer sees)

Present the scene breakdown to the user before generating. Example:

```
Scene 1 (5s): Opening — wide shot of a sunlit forest canopy
  Narration: "Every leaf is a tiny solar panel."

Scene 2 (6s): Zoom into leaf cross-section diagram
  Narration: "Inside each leaf, chloroplasts capture photons..."

Scene 3 (4s): Closing — time-lapse of plant growing
  Narration: "From light to life — that's photosynthesis."
```

### 3. Character Setup

If the video features recurring characters (people, mascots, presenters):
1. Define each character in `storyboard.json` under `characterRefs`
2. Generate a reference sheet image (multi-angle or key expressions)
3. Reference the character by name and description in all subsequent scene prompts

See [rules/character-consistency.md](rules/character-consistency.md) for the full workflow.

### 4. Generate Visuals

For each scene, decide between image or video generation, then:
1. Write the scene to `storyboard.json` with `visual.status: "generating"` (viewer shows spinner)
2. Call the appropriate MCP tool (`generate_image` or `generate_video_from_text`/`generate_video_from_image`)
3. On success: update `visual.status: "ready"`, set `visual.source` and `visual.thumbnail`
4. On failure: update `visual.status: "error"`, set `visual.errorMessage`, attempt fallback

See [rules/scene-generation.md](rules/scene-generation.md) for prompt crafting and strategy.

### 5. Generate Audio

For each scene with narration:
1. Set `audio.status: "generating"` in the scene
2. Call `generate_speech` with the narration text
3. Update `audio.status: "ready"`, set `audio.source` and `audio.duration`
4. Adjust `scene.duration` if TTS audio is longer than the planned duration

For background music:
1. Search for suitable tracks via `search_music` or `generate_music`
2. Download and set in `storyboard.bgm`
3. Set volume to 0.2-0.3 (music should sit under narration)
4. Add fade-in (1s) and fade-out (2s) for polish

### 6. Assemble

Review the complete storyboard:
- Verify all scenes have `status: "ready"` on their assets
- Set appropriate transitions between scenes (crossfade for smooth flow, cut for energy)
- Ensure scene durations align with audio durations
- Check total duration matches the user's target

### 7. Review

Present the assembled video to the user via locator cards. Iterate on feedback:
- "Make scene 3 more dramatic" — regenerate that scene's visual only
- "The narration is too fast" — regenerate TTS with slower speed
- "Add a scene between 2 and 3" — insert a new scene, shift orders
- "Change the music" — search for alternatives, update BGM

---

## Storyboard JSON Structure

The storyboard has four top-level fields:

```json
{
  "version": 1,
  "scenes": [...],
  "bgm": { ... } | null,
  "characterRefs": [...]
}
```

### Scene Object

```json
{
  "id": "scene-001",
  "order": 1,
  "duration": 5.0,
  "visual": {
    "type": "image" | "video",
    "status": "pending" | "generating" | "ready" | "error",
    "source": "assets/clips/scene-001.mp4",
    "prompt": "A wide shot of a sunlit forest canopy, cinematic lighting, 4K",
    "model": "kling-3-omni",
    "thumbnail": "assets/images/scene-001-thumb.jpg",
    "errorMessage": "Content moderation flagged the prompt"
  },
  "audio": {
    "type": "tts",
    "status": "pending" | "generating" | "ready" | "error",
    "text": "Every leaf is a tiny solar panel.",
    "voice": "alloy",
    "source": "assets/audio/scene-001.mp3",
    "model": "openai-tts",
    "duration": 3.2,
    "errorMessage": null
  },
  "caption": "Every leaf is a tiny solar panel.",
  "transition": {
    "type": "cut" | "crossfade" | "fade-to-black",
    "duration": 0.5
  }
}
```

See [rules/storyboard-protocol.md](rules/storyboard-protocol.md) for the full protocol on reading, writing, and updating the storyboard.

### BGM Object

```json
{
  "source": "assets/bgm/ambient-piano.mp3",
  "title": "Calm Piano Loop",
  "volume": 0.25,
  "fadeIn": 1.0,
  "fadeOut": 2.0
}
```

### CharacterRef Object

```json
{
  "id": "prof-einstein",
  "name": "The Professor",
  "referenceSheet": "assets/reference/professor-sheet.png",
  "description": "Elderly male professor, wild white hair, warm brown eyes, wearing a tweed vest over a white shirt"
}
```

---

## MCP Tool Reference

ClipCraft uses four MCP tool servers. Each is available as a set of callable tools during the session. Only tools whose API keys are configured will be available.

### clipcraft-imagegen

Image generation and editing.

| Tool | Purpose | Key Params |
|------|---------|------------|
| `generate_image` | Text-to-image | `prompt`, `width`, `height`, `style`, `reference_image?`, `output_path` |
| `edit_image` | Modify existing image | `source_path`, `instructions`, `output_path` |
| `upscale_image` | Enhance resolution | `source_path`, `scale`, `output_path` |

**When to use:** Scene backgrounds, character reference sheets, storyboard thumbnails, any still visual that does not need motion.

### clipcraft-videogen

Video clip generation.

| Tool | Purpose | Key Params |
|------|---------|------------|
| `generate_video_from_text` | Text-to-video | `prompt`, `duration`, `aspect_ratio`, `output_path` |
| `generate_video_from_image` | Animate a still image | `image_path`, `prompt`, `duration`, `output_path` |
| `extend_video` | Extend an existing clip | `source_path`, `duration`, `prompt`, `output_path` |

**When to use:** Scenes that benefit from motion — character actions, camera pans, transitions, dynamic sequences. Prefer `generate_video_from_image` when you already have a good still (better consistency than text-to-video).

### clipcraft-tts

Text-to-speech synthesis.

| Tool | Purpose | Key Params |
|------|---------|------------|
| `generate_speech` | Synthesize narration | `text`, `voice_id`, `speed`, `output_path` |
| `list_voices` | Browse available voices | (none) |

**When to use:** Every scene with narration text. Call `list_voices` once at the start of a session to know what is available. Match voice to content tone (warm narrator for educational, energetic for promos).

### clipcraft-bgm

Background music search and generation.

| Tool | Purpose | Key Params |
|------|---------|------------|
| `search_music` | Find stock music | `query`, `mood?`, `genre?`, `duration_min?`, `duration_max?` |
| `download_track` | Download a track | `track_id`, `output_path` |
| `generate_music` | AI music generation | `prompt`, `duration`, `output_path` |

**When to use:** After the scene structure is defined, so you know the target duration. Search first (stock music is faster and more predictable), generate only if nothing fits.

---

## Scene Generation Strategy

### Image vs Video Decision

| Scenario | Use Image | Use Video |
|----------|-----------|-----------|
| Static establishing shot | Yes | |
| Character portrait / close-up | Yes | |
| Diagram or infographic | Yes | |
| Character walking or gesturing | | Yes |
| Camera pan or zoom | | Yes |
| Action sequence | | Yes |
| Ambient scene (rain, fire, clouds) | | Yes |
| Budget-conscious production | Yes | |

When in doubt, generate an image first and then use `generate_video_from_image` to add subtle motion. This two-step approach gives better results than text-to-video alone because the image anchors the visual composition.

### Prompt Crafting

Structure prompts with these elements in order:

1. **Subject** — who/what is in the frame
2. **Action** — what is happening (for video)
3. **Setting** — environment and background
4. **Lighting** — time of day, light quality
5. **Camera** — angle, distance, movement (for video)
6. **Style** — artistic style, rendering quality
7. **Character reference** — include character description from `characterRefs` if applicable

Example prompt for a scene image:
> "An elderly professor with wild white hair and a tweed vest stands at a chalkboard in a warm, wood-paneled lecture hall. Golden afternoon light streams through tall windows. Medium shot, eye level. Cinematic photography style, shallow depth of field, 4K quality."

Example prompt for a scene video:
> "An elderly professor with wild white hair gestures enthusiastically while explaining a concept at a chalkboard. Camera slowly pushes in from medium shot to close-up. Warm golden lighting, wood-paneled lecture hall. Cinematic style, smooth motion."

See [rules/scene-generation.md](rules/scene-generation.md) for detailed guidance.

### Aspect Ratio

Match the project's aspect ratio (`project.json`) for all scene generation:
- **16:9** — YouTube, presentations, widescreen (1920x1080)
- **9:16** — TikTok, Reels, Shorts, vertical mobile (1080x1920)
- **1:1** — Instagram posts, square format (1080x1080)
- **4:3** — Classic format, some presentations (1440x1080)

Always pass the correct dimensions to generation tools. Do not mix aspect ratios within a project unless the user explicitly requests it.

---

## Character Consistency

For videos with recurring characters, use `characterRefs` to maintain visual consistency:

1. **Define the character** — add to `characterRefs` with a detailed description
2. **Generate a reference sheet** — use `generate_image` with a multi-angle prompt
3. **Reference in every scene** — include the character's description verbatim in each scene prompt
4. **Use image-to-video** — generate a still of the character first, then animate

See [rules/character-consistency.md](rules/character-consistency.md) for the full protocol.

---

## Audio Workflow

### TTS Narration

1. Call `list_voices` once to see available options
2. Pick a voice that matches the content tone
3. Generate speech for each scene's narration text
4. After generation, check the returned `duration` and adjust `scene.duration` if the audio is longer than planned
5. Use consistent voice across all scenes (same `voice_id`)

### BGM Selection

1. After defining all scenes, calculate total video duration
2. Search for tracks matching the mood: `search_music({ query: "calm piano", mood: "relaxed", duration_min: totalDuration })`
3. Preview tracks (the viewer can play preview URLs)
4. Download the selected track
5. Set BGM volume to 0.2-0.3 (narration should be clearly audible over music)
6. Add fadeIn (1s) and fadeOut (2s) for a polished feel

### Volume Balancing

- Narration: 1.0 (full volume, this is the primary audio)
- BGM: 0.2-0.3 (background, under narration)
- If a scene has no narration, BGM can be louder (0.5-0.6)
- Scene transitions: BGM continues smoothly, narration cuts with the scene

---

## Error Recovery

Generation can fail for several reasons. Always have a fallback plan:

| Failure | Recovery |
|---------|----------|
| Content moderation blocks prompt | Rephrase: remove celebrity names, explicit content. Use fictional character descriptions |
| Image-to-video fails | Fall back to text-to-video with the same prompt |
| Video generation fails entirely | Use a static image with Ken Burns effect (note this in export) |
| TTS generation fails | Skip audio for now, mark scene, inform user |
| API rate limit | Queue remaining generations, inform user of delay |
| Provider down | Suggest switching provider in project settings |
| Budget/credits exhausted | Inform user, suggest lower-cost alternatives |

See [rules/error-recovery.md](rules/error-recovery.md) for detailed fallback chains.

---

## Viewer Interaction

### Locator Cards

After generating or modifying scenes, include locator cards so the user can jump to what changed:

```
<viewer-locator label="Scene 1 — Forest Canopy" data='{"scene":"scene-001"}' />
```

Auto-play from a specific scene:
```
<viewer-locator label="Play from Scene 3" data='{"scene":"scene-003","autoplay":true}' />
```

Always include locator cards after:
- Generating a new scene
- Regenerating an existing scene's visual or audio
- Adding or reordering scenes
- Completing the full storyboard assembly

### Viewer Context

When the user interacts with the viewer, their messages include a `<viewer-context>` block:

```xml
<viewer-context mode="clipcraft">
Project: "My Explainer Video" (16:9, 1920x1080, 30fps)
Scenes: 5 total, 32.0s duration
Selected: scene-003 (6.0s)
  Visual: video, ready, assets/clips/scene-003.mp4
  Audio: tts, ready, "Inside each leaf, chloroplasts capture photons..." (3.8s)
  Caption: "Inside each leaf, chloroplasts capture photons..."
  Transition: crossfade (0.5s)
BGM: "Calm Piano Loop" (0.25 volume)
Characters: The Professor (prof-einstein)
</viewer-context>
```

Use this context to understand:
- Which scene the user is referring to ("this scene", "the current one")
- Current project settings (aspect ratio, fps)
- Asset status across all scenes
- What still needs generation

When no scene is selected, the context shows a project overview instead.

### Viewer Commands

The user can trigger commands from the viewer UI. These arrive as messages you should handle:
- **Regenerate Scene** — regenerate the selected scene's visual
- **Add Scene After** — create a new scene after the selected one
- **Remove Scene** — delete the selected scene and update orders
- **Regenerate Audio** — re-generate TTS for the selected scene

---

## Export

When the user is satisfied with the storyboard, generate an ffmpeg export script.

Create `export/render.sh` that:
1. Concatenates video clips (or uses images with duration) in scene order
2. Applies transitions between scenes (crossfade, fade-to-black)
3. Mixes per-scene voiceover audio at the correct timestamps
4. Overlays BGM at the specified volume with fade-in/fade-out
5. Burns in caption text at the configured position and style
6. Outputs the final video as `export/output.mp4`

Template structure:
```bash
#!/bin/bash
set -e

# ClipCraft Export Script
# Generated for: "My Explainer Video"
# Duration: 32.0s | Resolution: 1920x1080 | FPS: 30

OUTPUT_DIR="export"
mkdir -p "$OUTPUT_DIR"

# Step 1: Prepare scene inputs (image→video conversion for still scenes)
# Step 2: Concatenate scenes with transitions
# Step 3: Mix audio tracks (narration per scene + BGM)
# Step 4: Combine video + audio
# Step 5: Burn in captions (optional)

echo "Export complete: $OUTPUT_DIR/output.mp4"
```

The user runs this script manually. Require ffmpeg to be installed.

For scenes using static images, generate a video segment with:
```bash
ffmpeg -loop 1 -i assets/images/scene-001.jpg -c:v libx264 -t 5.0 -pix_fmt yuv420p -vf "scale=1920:1080" scene-001.mp4
```

---

## Constraints

- Never modify files in `.claude/`, `.pneuma/`, or `node_modules/`
- Save all generated assets under `assets/` with descriptive filenames
- Keep `storyboard.json` as the single source of truth — the viewer reads only this file
- Scene IDs must be stable: use format `scene-NNN` (zero-padded to 3 digits)
- Always write placeholder entries with `"status": "generating"` before starting generation
- Update `storyboard.json` incrementally — do not rewrite the entire file for single-scene changes when possible
- Do not ask for confirmation on simple, single-scene generations — just do them
- Do ask for confirmation before regenerating all scenes or making structural changes to the storyboard

## Rules Reference

Read these files on demand when the topic is relevant:

| Topic | File |
|-------|------|
| Storyboard read/write protocol | [rules/storyboard-protocol.md](rules/storyboard-protocol.md) |
| Scene generation strategies | [rules/scene-generation.md](rules/scene-generation.md) |
| Character consistency | [rules/character-consistency.md](rules/character-consistency.md) |
| Error recovery and fallbacks | [rules/error-recovery.md](rules/error-recovery.md) |
