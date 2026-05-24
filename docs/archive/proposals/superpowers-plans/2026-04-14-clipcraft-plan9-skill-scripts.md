# ClipCraft Plan 9 — Skill Scripts + Commands (subsumes Plan 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port legacy ClipCraft's 4 generator MCPs into plain local CLI scripts bundled inside the mode's skill, rewrite SKILL.md following [anthropics/skills/skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) best practices, and add viewer-side `commands[]` so the user can click buttons that send natural-language requests into the agent chat (like webcraft's design commands).

**Architecture:** Zero runtime changes. The scripts are argv-parsing CLIs that call fal.ai / OpenRouter and write asset files to the workspace. The agent invokes them via the Bash tool, then edits `project.json` via Edit to register the asset + provenance — the file-watch + Source re-hydrate path already makes the viewer reflect the change. Viewer UI exposes a row of `viewerApi.commands[]` buttons; clicking one sends a short natural-language message into the chat, the agent interprets + executes.

**Why no Mode API / routes / MCP:**
- Scripts-in-skill is the simplest possible tool surface: agent already knows Bash, no new protocol
- Current architecture already supports `viewerApi.commands[]` (User → Viewer → Agent via ⑥) — we just use it
- Skill-creator's progressive-disclosure model (metadata → SKILL.md body → bundled resources) fits scripts + reference docs perfectly
- Deferring runtime abstractions until a second mode actually needs them

**Tech Stack:** Bun + Node, fal.ai (nano-banana-2 image + veo3.1 video), OpenRouter (openai/gpt-audio TTS + google/lyria-3-pro-preview BGM)

---

## File Structure

**Create under `modes/clipcraft/skill/`:**

```
skill/
├── SKILL.md                          # Full rewrite — skill-creator shape
├── scripts/
│   ├── generate-image.mjs            # fal.ai nano-banana-2 (generate + edit)
│   ├── generate-video.mjs            # fal.ai veo3.1 (text→video + image→video)
│   ├── generate-tts.mjs              # OpenRouter openai/gpt-audio (SSE streaming)
│   └── generate-bgm.mjs              # OpenRouter google/lyria-3-pro-preview (SSE streaming)
└── references/
    ├── project-json.md               # Schema ref (extracted from old SKILL.md)
    ├── workflows.md                  # End-to-end example flows
    └── asset-ids.md                  # Id stability + naming conventions
```

**Modify:**
- `modes/clipcraft/manifest.ts` — add `viewerApi.commands[]`, drop the stale "Bootstrap scaffold" claudeMdSection.
- `docs/superpowers/plans/NEXT.md` — move Plan 9 to Completed; mark Plan 10 as subsumed.

**Delete:** nothing. Legacy scripts under `modes/clipcraft-legacy/scripts/` stay untouched (legacy mode still needs them).

---

## Script design — shared contract

Every script:
- Is a **plain argv CLI**, not an MCP server. No JSON-RPC wrapper, no stdin loop.
- Reads API keys from `process.env` (`FAL_KEY` for fal.ai, `OPENROUTER_API_KEY` for OpenRouter). Legacy's ambiguous `API_KEY` is dropped — each script docs its specific env var in its own `--help` and in SKILL.md.
- On success: writes the output file, prints the output path (relative or absolute as given) on stdout, exits 0.
- On failure: prints an error message to stderr, exits non-zero.
- Creates the parent directory of `--output` if missing (`mkdirSync recursive: true`).
- No thumbnails, no side-effects beyond the one output file — simpler than legacy.

**Why this shape:** the agent composes provenance itself via Edit on `project.json`, so the script only needs to handle the thing a Bash subprocess can do best — calling a provider API and saving bytes. Schema knowledge lives in `SKILL.md` + `references/project-json.md`, not in the scripts.

---

## Task 1: Port `generate-image.mjs`

**Files:**
- Create: `modes/clipcraft/skill/scripts/generate-image.mjs`
- Reference (read only): `modes/clipcraft-legacy/scripts/clipcraft-imagegen.mjs`

**Context:** Legacy script uses fal.ai `nano-banana-2` (text→image) at `https://fal.run/fal-ai/nano-banana-2` and `nano-banana-2/edit` (image→image) at `https://fal.run/fal-ai/nano-banana-2/edit`. Port the fal.ai helpers and aspect-ratio mapping verbatim, drop the MCP JSON-RPC wrapper, turn into argv CLI.

- [ ] **Step 1: Draft the CLI interface**

```
Usage:
  node generate-image.mjs --prompt "..." --output assets/image/out.jpg \
    [--width 1920] [--height 1080] [--style "cinematic"]

  node generate-image.mjs edit --source-url "https://..." \
    --instructions "make it darker" --output assets/image/out.jpg

Env:
  FAL_KEY    — required; fal.ai API key
```

- [ ] **Step 2: Write the CLI**

Top-level structure:

```js
#!/usr/bin/env node

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

const FAL_GENERATE_URL = "https://fal.run/fal-ai/nano-banana-2";
const FAL_EDIT_URL = "https://fal.run/fal-ai/nano-banana-2/edit";
const ASPECT_RATIOS = [/* 7 entries copied from legacy line 78-86 */];

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function mapToAspectRatio(width, height) { /* copy from legacy */ }
function mimeFromExt(filePath) { /* copy from legacy */ }

async function falGenerate(prompt, aspectRatio, apiKey) { /* copy from legacy */ }
async function falEdit(instructions, imageUrl, apiKey) { /* copy from legacy */ }

async function downloadImage(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) die(`download failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
}

async function runGenerate(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");
  const { prompt, output, width, height, style } = args;
  if (!prompt) die("--prompt is required");
  if (!output) die("--output is required");
  const fullPrompt = style ? `${prompt}, ${style} style` : prompt;
  const aspectRatio = mapToAspectRatio(Number(width) || undefined, Number(height) || undefined);
  const result = await falGenerate(fullPrompt, aspectRatio, apiKey);
  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) die("fal.ai returned no image");
  await downloadImage(imageUrl, output);
  console.log(output);
}

async function runEdit(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");
  const { "source-url": sourceUrl, instructions, output } = args;
  if (!sourceUrl || !instructions || !output) {
    die("edit requires --source-url --instructions --output");
  }
  let url = sourceUrl;
  if (!url.startsWith("http")) {
    // local file → data URI
    const buf = readFileSync(url);
    url = `data:${mimeFromExt(url)};base64,${buf.toString("base64")}`;
  }
  const result = await falEdit(instructions, url, apiKey);
  const outUrl = result.images?.[0]?.url;
  if (!outUrl) die("fal.ai returned no edited image");
  await downloadImage(outUrl, output);
  console.log(output);
}

const argv = process.argv.slice(2);
const subcommand = argv[0] === "edit" ? "edit" : "generate";
const startIdx = subcommand === "edit" ? 1 : 0;
const { values } = parseArgs({
  args: argv.slice(startIdx),
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    style: { type: "string" },
    "source-url": { type: "string" },
    instructions: { type: "string" },
  },
  allowPositionals: false,
});

try {
  if (subcommand === "edit") await runEdit(values);
  else await runGenerate(values);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
```

- [ ] **Step 3: Smoke test**

```bash
cd /tmp/clipcraft-plan9-smoke
FAL_KEY=$FAL_KEY node /path/to/modes/clipcraft/skill/scripts/generate-image.mjs \
  --prompt "a tiny panda peeking from bamboo" --width 1280 --height 720 \
  --output assets/image/test.jpg
```

Expected: prints `assets/image/test.jpg`, exits 0, file exists with non-zero size.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/skill/scripts/generate-image.mjs
git commit -m "feat(clipcraft/skill): port imagegen as plain argv CLI (fal.ai nano-banana-2)"
```

---

## Task 2: Port `generate-video.mjs`

**Files:**
- Create: `modes/clipcraft/skill/scripts/generate-video.mjs`
- Reference: `modes/clipcraft-legacy/scripts/clipcraft-videogen.mjs`

**Context:** Legacy uses `fal.run/fal-ai/veo3.1` (text→video) and `fal.run/fal-ai/veo3.1/image-to-video`. Response: `{ video: { url, content_type } }`. veo3.1 is expensive and blocks up to ~120s — the CLI should NOT default `--duration` to avoid accidental cost; require explicit value.

- [ ] **Step 1: CLI interface**

```
Usage:
  node generate-video.mjs --prompt "..." --duration 4s|6s|8s \
    --output assets/video/out.mp4 \
    [--aspect-ratio 16:9|9:16] [--resolution 720p|1080p] [--no-audio]

  node generate-video.mjs from-image --prompt "..." --image-url <url|path> \
    --duration 4s|6s|8s --output assets/video/out.mp4

Env:
  FAL_KEY    — required; fal.ai API key

NOTE: veo3.1 is ~$0.20-0.60/sec of video. Each call blocks 30-120+ seconds.
```

- [ ] **Step 2: Implement**

Mirror Task 1's structure but with video URLs, `falTextToVideo(prompt, params, apiKey)` and `falImageToVideo(prompt, imageUrl, params, apiKey)` helpers, and a `downloadVideo(url, path)` (same as downloadImage — just reads binary and writes). The response shape is `{ video: { url } }` not `{ images: [...] }`, so the extraction differs.

Exit 1 if `--duration` is missing — intentional safety catch.

- [ ] **Step 3: Smoke test — SKIP by default**

veo3.1 is expensive; don't smoke-test during the plan execution unless the user explicitly green-lights it. A dry-run `--help` check is enough:

```bash
node generate-video.mjs --help 2>&1 | head   # quick arg-parse sanity
```

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/skill/scripts/generate-video.mjs
git commit -m "feat(clipcraft/skill): port videogen as plain argv CLI (fal.ai veo3.1)"
```

---

## Task 3: Port `generate-tts.mjs`

**Files:**
- Create: `modes/clipcraft/skill/scripts/generate-tts.mjs`
- Reference: `modes/clipcraft-legacy/scripts/clipcraft-tts.mjs`

**Context:** OpenRouter SSE streaming, model `openai/gpt-audio`, 60s timeout. The streaming helper in legacy (`streamAudioRequest`) collects `delta.audio.data` base64 chunks and concatenates. Output is PCM16 WAV — save as `.wav`.

- [ ] **Step 1: CLI interface**

```
Usage:
  node generate-tts.mjs --text "..." --output assets/audio/out.wav [--voice alloy]

Env:
  OPENROUTER_API_KEY  — required
```

- [ ] **Step 2: Implement** — copy `streamAudioRequest` verbatim from legacy, then a single `runTts({ text, voice, output })` that calls it with the openai/gpt-audio body and writes `Buffer.from(audioBase64, "base64")` to `output`.

- [ ] **Step 3: Smoke test**

```bash
OPENROUTER_API_KEY=$OPENROUTER_API_KEY node /path/to/generate-tts.mjs \
  --text "Hello from ClipCraft Plan 9" --output /tmp/test-tts.wav
```

Expected: prints `/tmp/test-tts.wav`, exits 0, file exists and plays.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/skill/scripts/generate-tts.mjs
git commit -m "feat(clipcraft/skill): port TTS as plain argv CLI (OpenRouter openai/gpt-audio)"
```

---

## Task 4: Port `generate-bgm.mjs`

**Files:**
- Create: `modes/clipcraft/skill/scripts/generate-bgm.mjs`
- Reference: `modes/clipcraft-legacy/scripts/clipcraft-bgm.mjs`

**Context:** Same SSE streaming pattern as TTS, but model `google/lyria-3-pro-preview`, 180s timeout. lyria returns MP3 chunks — save as `.mp3`.

- [ ] **Step 1: CLI interface**

```
Usage:
  node generate-bgm.mjs --prompt "..." --output assets/audio/out.mp3 [--duration 30]

Env:
  OPENROUTER_API_KEY  — required
```

- [ ] **Step 2: Implement** — copy the streaming helper from legacy's `clipcraft-bgm.mjs` (slightly different timeout + model), then save as `.mp3`.

- [ ] **Step 3: Smoke test**

```bash
OPENROUTER_API_KEY=$OPENROUTER_API_KEY node /path/to/generate-bgm.mjs \
  --prompt "ambient lo-fi piano loop" --output /tmp/test-bgm.mp3
```

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/skill/scripts/generate-bgm.mjs
git commit -m "feat(clipcraft/skill): port BGM as plain argv CLI (OpenRouter lyria-3-pro)"
```

---

## Task 5: Write `references/project-json.md`

**Files:**
- Create: `modes/clipcraft/skill/references/project-json.md`

**Context:** The current SKILL.md body has a solid schema section (lines 18-89). Lift it into a dedicated reference doc so SKILL.md can stay short while the agent still has the full schema on-demand.

- [ ] **Step 1: Structure**

```markdown
# project.json Schema Reference

> Full type definitions live in `modes/clipcraft/persistence.ts`.

## Minimum shape

## Top-level fields

## assets[]
- id, type, uri, name, metadata, createdAt, tags?, status?
- Metadata rules: physical media props ONLY (no prompts/params)

## provenance[]
- Edge shape: toAssetId, fromAssetId, operation
- operation.type reference
- operation.params conventions (model, prompt, seed, durationMs, costUsd, providerJobId)
- Actor rules (agent vs human)
- When to use fromAssetId (derive) vs null (generate from nothing)

## composition.tracks[]
- Track shape: id, type, name, clips, muted, volume, locked, visible
- Clip shape: id, assetId, startTime, duration, inPoint, outPoint, text?
- Time is seconds, not frames

## Title + other metadata

## Id stability rules
(point at `references/asset-ids.md` for the detailed rules)

## Common gotchas
- Never edit `$schema` field
- createdAt must be stable across round-trips
- Empty uri is legal for pending/generating assets
- `fromAssetId: null` means "generated from nothing", not "no lineage"
```

- [ ] **Step 2: Write the content** — most of it already exists in current SKILL.md lines 18-89, just cleaned up and grouped into the headers above. Drop "Plan 3a / Plan 3c" references — these are historical and not useful to the agent at runtime.

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/skill/references/project-json.md
git commit -m "docs(clipcraft/skill): extract project.json schema into reference doc"
```

---

## Task 6: Write `references/workflows.md`

**Files:**
- Create: `modes/clipcraft/skill/references/workflows.md`

**Context:** Three worked examples the agent can pattern-match when the user asks for a generation task. Each example shows: (1) pick a target path, (2) run the CLI, (3) register the asset in project.json via Edit, (4) optionally place on the timeline.

- [ ] **Step 1: Three example flows**

```markdown
# ClipCraft Workflows

Pattern-match these when the user asks for a generation task. Every
flow follows the same shape: call a script, register the output as an
asset, optionally place it on the timeline.

## Workflow 1 — Generate a new video clip

User: "Make a 4-second shot of a panda eating bamboo for the intro."

1. Pick a stable, semantic asset id: `asset-panda-intro`.
2. Pick an output path: `assets/video/panda-intro.mp4`.
3. Run the generator:
   ```bash
   node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs \
     --prompt "close-up of a giant panda happily eating bamboo, warm natural light" \
     --duration 4s \
     --aspect-ratio 16:9 \
     --output assets/video/panda-intro.mp4
   ```
4. Edit `project.json`:
   - Add to `assets[]`:
     ```json
     {
       "id": "asset-panda-intro",
       "type": "video",
       "uri": "assets/video/panda-intro.mp4",
       "name": "Panda intro",
       "metadata": { "duration": 4 },
       "createdAt": 1712934000000,
       "status": "ready"
     }
     ```
   - Add to `provenance[]`:
     ```json
     {
       "toAssetId": "asset-panda-intro",
       "fromAssetId": null,
       "operation": {
         "type": "generate",
         "actor": "agent",
         "agentId": "clipcraft-videogen",
         "timestamp": 1712934000000,
         "params": {
           "model": "fal-ai/veo3.1",
           "prompt": "close-up of a giant panda...",
           "duration": "4s",
           "aspect_ratio": "16:9"
         }
       }
     }
     ```
5. Place on the video track by adding a clip:
   ```json
   {
     "id": "clip-panda-intro",
     "assetId": "asset-panda-intro",
     "startTime": 0,
     "duration": 4,
     "inPoint": 0,
     "outPoint": 4
   }
   ```

The viewer picks up the edit automatically — no reload needed.

## Workflow 2 — Regenerate a variant

User: "Try another take of the intro, make the panda look sleepier."

1. Pick a sibling asset id: `asset-panda-intro-v2`.
2. Run the generator with the adjusted prompt.
3. Add the new asset + a provenance edge with `fromAssetId: "asset-panda-intro"` and `operation.type: "derive"` — this establishes the sibling relationship so the variant switcher shows both options.
4. Either point the existing clip at the new asset (`clip.assetId = "asset-panda-intro-v2"`) or leave it and let the user pick via the variant switcher.

## Workflow 3 — Add narration for a subtitle

User: "Narrate the caption track."

For each subtitle clip in a subtitle track:
1. Run TTS on the clip's `text`:
   ```bash
   node .claude/skills/pneuma-clipcraft/scripts/generate-tts.mjs \
     --text "$CAPTION_TEXT" --output assets/audio/narration-${SCENE_ID}.wav
   ```
2. Register the asset + provenance (type: `generate`, model: `openai/gpt-audio`).
3. Add an audio clip to the existing audio track (or create one) with `startTime` + `duration` matching the subtitle clip's timing.

The result: every caption gets a matching voice-over track.
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/skill/references/workflows.md
git commit -m "docs(clipcraft/skill): add three end-to-end workflow examples"
```

---

## Task 7: Write `references/asset-ids.md`

**Files:**
- Create: `modes/clipcraft/skill/references/asset-ids.md`

Short doc (≤60 lines) covering:

- Id naming: prefer semantic names (`asset-panda-intro`, `clip-scene1-video`) over random UUIDs
- Uniqueness: clip ids are unique across ALL tracks in the composition (not per-track)
- Id stability: edits to `project.json` preserve ids; don't rename unless deleting + replacing
- Variants: use a suffix convention (`-v1`, `-v2`) or a sub-id convention (`asset-forest`, `asset-forest-sunset`) — either works as long as provenance edges link them
- Track + scene ids are also explicit and persist across edits

- [ ] Write the doc
- [ ] Commit: `docs(clipcraft/skill): add asset-ids reference`

---

## Task 8: Rewrite `SKILL.md` following skill-creator anatomy

**Files:**
- Modify: `modes/clipcraft/skill/SKILL.md` (full replace)

**Context:** The skill-creator template says:
- Frontmatter has `name` + `description`; description should be **pushy** to combat undertriggering ("Use whenever the user mentions video production / AIGC assets / timeline editing, even if they don't explicitly say 'ClipCraft'...")
- Body under ~500 lines; reference bundled resources clearly
- Imperative tone, explain WHY instead of heavy-handed MUSTs
- Progressive disclosure: body is enough for simple tasks, references/ loaded on demand

- [ ] **Step 1: New SKILL.md**

Draft structure (~250 lines):

```markdown
---
name: pneuma-clipcraft
description: AI-orchestrated video production on @pneuma-craft. Use whenever the user wants to generate, edit, or compose video clips, audio tracks, captions, or BGM — including text-to-video / image-to-video generation, TTS narration, music generation, provenance tracking, and timeline composition. Also use when editing `project.json` by hand, registering assets, or working with the ClipCraft exploded/dive-in timeline views. Do not assume the user knows the schema — they usually don't.
---

# ClipCraft

ClipCraft is a video-production mode where the **source of truth is a
structured domain model**, not a file. The in-memory model is an
event-sourced craft store from `@pneuma-craft`: an Asset registry, a
Composition with Tracks and Clips, and a Provenance DAG that tracks
how each asset was generated (and from what). The file `project.json`
at the workspace root is a projection of the store — when you edit it
with Write/Edit, the viewer auto-re-hydrates. No reload, no refresh
signal.

ClipCraft is built for **AIGC workflows**: assets are generated, not
uploaded. You orchestrate image / video / TTS / BGM generation by
running bundled scripts, then record the lineage in `project.json`.

## Domain vocabulary (2-minute version)

- **Asset** — an addressable piece of media. Has an `id`, `type`, `uri`, `name`, `metadata`, `status`, `createdAt`.
- **Track** — a horizontal lane in the timeline. `type`: `video` / `audio` / `subtitle`.
- **Clip** — a span on a track that references an asset via `assetId`. Has `startTime`, `duration`, `inPoint`, `outPoint` (all in seconds). Subtitle clips also carry `text` directly.
- **Scene** — a logical chunk of the composition that groups clips across tracks. Purely a human organization aid.
- **Provenance edge** — `{ toAssetId, fromAssetId, operation }`. Captures "how was this asset created". `fromAssetId: null` means generated from nothing; a real id means derived from another asset.
- **Composition** — the top-level container: settings (width/height/fps), tracks, transitions, duration.

Full schema in `references/project-json.md`. Id rules in `references/asset-ids.md`.

## Generation scripts

Four bundled CLI scripts wrap the provider APIs. Call them via the Bash
tool; they write files and print the output path on stdout.

| Script | Purpose | Provider | Env var |
|---|---|---|---|
| `scripts/generate-image.mjs` | Text→image + image→image edit | fal.ai nano-banana-2 | `FAL_KEY` |
| `scripts/generate-video.mjs` | Text→video + image→video | fal.ai veo3.1 (~$0.20-0.60/sec) | `FAL_KEY` |
| `scripts/generate-tts.mjs` | Text→speech | OpenRouter openai/gpt-audio | `OPENROUTER_API_KEY` |
| `scripts/generate-bgm.mjs` | Text→background music | OpenRouter google/lyria-3-pro-preview | `OPENROUTER_API_KEY` |

All scripts share the same shape:

- `--output <path>` is always required and is workspace-relative.
- API keys come from `process.env`. If a key is missing, the script exits 1 with a clear error.
- On success: prints the output path on stdout, exits 0.
- On failure: prints an error on stderr, exits non-zero.

Run `node .claude/skills/pneuma-clipcraft/scripts/<script>.mjs --help`
(or just look at the script's argv-parse block) for the full arg list.

## Typical workflow

1. **Read** the current `project.json` to understand the composition.
2. **Generate** assets by running one of the scripts with Bash.
3. **Register** each new asset in `project.json`:
   - Add an entry to `assets[]` with a stable semantic id.
   - Add a matching edge to `provenance[]` with `operation.type: "generate"` and `operation.params` filled out.
4. **Place** assets on the timeline by adding clips to the relevant track.
5. The viewer auto-reflects every edit — no reload needed.

Full worked examples for the three most common flows are in
`references/workflows.md`. When the user asks for a generation task,
pattern-match the closest example first.

## Viewer commands

Users can click command buttons in the viewer (Generate image,
Regenerate variant, Add narration, Add BGM, Export). Clicks arrive as
short natural-language messages in the chat. Interpret them
conversationally — read the viewer context to see what the user
currently has selected, then execute the corresponding workflow.

Don't treat command messages as rigid tool calls. They're hints about
what the user wants next, often with a clip or scene pre-selected.

## Gotchas

- **Metadata is for physical properties only.** Put `width`, `height`,
  `duration`, `fps`, `codec`, `sampleRate`, `channels` in
  `asset.metadata`. Put `prompt`, `model`, `seed`, `cost` etc. in
  `provenance.operation.params`.
- **`createdAt` must be stable.** When editing an existing asset, keep
  its `createdAt` unchanged — hydration relies on it.
- **Empty uri is legal** for `pending` or `generating` assets. Set the
  uri when the script finishes and the file exists.
- **Never edit `$schema`.** It's always `"pneuma-craft/project/v1"`.
- **Time is in seconds.** Not frames. `fps` only matters for
  playback/export.
- **`fromAssetId: null` means "from nothing"**, not "no lineage known".
  If you don't have an origin, that's still the correct value.

## See also

- `references/project-json.md` — full schema
- `references/workflows.md` — three end-to-end examples
- `references/asset-ids.md` — id naming + stability rules
- Legacy mode docs (`modes/clipcraft-legacy/skill/`) — deprecated, but may be referenced if you're asked about pre-craft workflows
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/skill/SKILL.md
git commit -m "docs(clipcraft/skill): rewrite SKILL.md following skill-creator best practices"
```

---

## Task 9: Declare `viewerApi.commands[]` in `manifest.ts`

**Files:**
- Modify: `modes/clipcraft/manifest.ts`

**Context:** `ViewerApiConfig.commands` is already part of the contract — see `core/types/mode-manifest.ts:164`. Each command declares `{ id, label, description? }`; the runtime renders buttons in the viewer and, on click, sends a natural-language notification to the agent via ⑥.

- [ ] **Step 1: Design the command set**

Commands should read as conversational user requests, not RPC call sites. Keep labels short (toolbar real estate), put the actual hint phrasing in `description` so skill installer injects it into CLAUDE.md.

```ts
viewerApi: {
  commands: [
    {
      id: "generate-image",
      label: "Generate image",
      description:
        "Generate a new image asset for the current selection. The user may have a clip selected or be working in a scene — read the viewer context to figure out what they want.",
    },
    {
      id: "generate-video",
      label: "Generate video",
      description:
        "Generate a new video clip. veo3.1 is expensive — ask for confirmation if the request is vague.",
    },
    {
      id: "regenerate-variant",
      label: "Try another take",
      description:
        "The user wants a variant of the currently selected clip's asset. Look up the existing provenance, generate a sibling with small prompt tweaks, and register it as a derived asset so the variant switcher shows both options.",
    },
    {
      id: "add-narration",
      label: "Add narration",
      description:
        "Generate TTS narration for the currently selected subtitle clip (or the whole caption track if nothing specific is selected). Match the audio clip timing to the subtitle clip timing.",
    },
    {
      id: "add-bgm",
      label: "Add BGM",
      description:
        "Add background music. Ask the user for a mood/style if they haven't said. Generate, register, and add as a clip on a new or existing audio track.",
    },
    {
      id: "export-video",
      label: "Export video",
      description:
        "Export the project as an MP4. Plan 8 will bundle an export script; until then, explain to the user that export isn't wired up yet.",
    },
  ],
},
```

- [ ] **Step 2: Also clean the claudeMdSection**

Replace the stale "Bootstrap scaffold" paragraph with a short current-state pointer:

```ts
claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace. This is **ClipCraft Mode** — AI-orchestrated video production on \`@pneuma-craft\`.

Your domain knowledge lives in the \`pneuma-clipcraft\` skill. Read \`.claude/skills/pneuma-clipcraft/SKILL.md\` at session start; reference \`references/project-json.md\` when editing \`project.json\`, \`references/workflows.md\` when the user asks for a generation task, and the \`scripts/\` directory for the four bundled generator CLIs.`,
```

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/manifest.ts
git commit -m "feat(clipcraft): add viewerApi.commands + refresh claudeMdSection"
```

---

## Task 10: Browser verification

- [ ] **Step 1: Start a fresh session**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bun run dev clipcraft --workspace /tmp/clipcraft-plan9-verify --port 17999 --no-open --debug
```

Then open http://localhost:17999/?mode=clipcraft&layout=editor.

- [ ] **Step 2: Verify skill install**

```bash
ls /tmp/clipcraft-plan9-verify/.claude/skills/pneuma-clipcraft/
# Expected: SKILL.md, scripts/, references/
ls /tmp/clipcraft-plan9-verify/.claude/skills/pneuma-clipcraft/scripts/
# Expected: generate-image.mjs generate-video.mjs generate-tts.mjs generate-bgm.mjs
```

- [ ] **Step 3: Verify command buttons render**

Look at the viewer — it should have a row or toolbar of 6 command buttons (Generate image / Generate video / Try another take / Add narration / Add BGM / Export video). Click each and confirm that a user message lands in the chat panel with the command's description text.

- [ ] **Step 4: Manual dry-run of a cheap generator**

Ensure `OPENROUTER_API_KEY` is set in the server shell. In the chat panel, ask the agent: "Narrate the first subtitle clip". Expected agent actions:
1. Reads `project.json`, finds the first subtitle clip's text
2. Calls `node .claude/skills/pneuma-clipcraft/scripts/generate-tts.mjs --text "..." --output assets/audio/narration-1.wav`
3. Edits `project.json` to register the asset + provenance + add an audio clip
4. Viewer reflects the new waveform on the audio track

If anything fails, capture the exact error and fix in-plan. Don't skip this step — it's the whole point of the plan.

- [ ] **Step 5: Update NEXT.md**

Move Plan 9 from `Upcoming` to `Completed` with a one-paragraph summary. Note that Plan 10 (skill rewrite) was subsumed into Plan 9. Plan 8 stays in `Upcoming`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/NEXT.md
git commit -m "docs(plans): mark Plan 9 complete (subsumes Plan 10)"
```

---

## Scope deferred / out of scope

- **Runtime abstractions** (Mode API / backend routes / unified RPC) — deferred until a second mode actually needs the same pattern.
- **Viewer-initiated direct generation** (button that calls the script without bouncing through the agent) — deliberately not in scope; every generation goes through the chat so the user can see it and course-correct.
- **Async status streaming** — scripts block synchronously. Long videogen calls (up to 120s) will block the agent's Bash tool call; that's acceptable for v1.
- **Eval / test harness** for the skill — skill-creator recommends evals for "objectively verifiable" skills, but ClipCraft generations are subjective. Skipping evals is fine for v1.
- **Export** — Plan 8.
- **MCP protocol surface** — intentionally dropped; scripts are plain CLIs invoked via Bash.

---

## Definition of done

- 10 tasks committed
- Four generator scripts live under `modes/clipcraft/skill/scripts/` and print output paths on success
- `SKILL.md` + three `references/` docs under `modes/clipcraft/skill/`
- `manifest.ts` declares 6 `viewerApi.commands[]`
- `bun run dev clipcraft` starts clean; skill-installer copies scripts to `.claude/skills/pneuma-clipcraft/`; clicking a command button sends a chat message; at least one cheap generator (TTS) runs end-to-end and results in a viewer update
- `docs/superpowers/plans/NEXT.md` marks Plan 9 complete; Plan 8 remains as the last upcoming plan
