# ClipCraft Seed — Pneuma Self-Introduction

A 19-second 16:9 brand intro for Pneuma, shipped as the default workspace
content the first time a user opens ClipCraft. The point is twofold:
greet new users with a polished piece of work that lives in the same
viewer they're about to use, and double as a worked example of the
mode's strongest technique — strict first-/last-frame video anchoring
with cross-shot continuity.

## The piece

| # | Title | Time | Duration | Type |
|---|-------|------|----------|------|
| 1 | Spark | 0:00 → 0:04 | 4s | strict first-last (logo breath) |
| 2 | Convergence | 0:04 → 0:12 | 8s | strict first-last (logo → 4-panel architecture) |
| 3 | Resolution | 0:12 → 0:19 | 7s | strict first-last (architecture → wordmark) |

Audio: 19s warm cinematic ambient BGM throughout, English VO at 0:13
("Pneuma. Where breath becomes craft."), captions track-aligned with VO.

## Why all three shots are strict first-/last-frame anchored

The classic problem with concatenating three independently generated
seedance clips is the cut at each boundary — even when the prompts
match, the model's interpretation drifts and the seam shows. The fix is
to share an anchor image at every boundary so the mp4 frames on either
side of the cut are pixel-identical:

```
shot1-start.png         shot2-start.png         shot2-end.png         shot3-end.png
       │                       │                       │                       │
       ▼ start                 ▼ end / start           ▼ end / start           ▼ end
[Shot 1: Spark]   ──→   [Shot 2: Convergence]   ──→   [Shot 3: Resolution]
       4s                       8s                       7s
```

`shot2-start.png` is shot 1's END anchor AND shot 2's START anchor →
boundary is invisible. `shot2-end.png` plays the same role at the 0:12
cut. The seed exists partly to demonstrate this technique to new users
and to the agent itself (see `references/reference-directives.md` and
the workflows doc).

## Anchor images (4)

All four were generated with `gpt-image-2` via fal.ai's edit endpoint
(`openai/gpt-image-2/edit`), passing the actual Pneuma logo
(`assets/brand/pneuma-logo.png`, the canonical mark from
`public/logo.png`) as the `image_urls` reference. Edit mode preserves
the logo's exact shape and color split across all anchors, which is the
whole reason the shots feel like the same piece rather than three
unrelated takes.

| File | Role | Notes |
|------|------|-------|
| `assets/images/shot1-start.png` | shot 1 start frame | Extracted from frame 0 of the original shot 1 mp4 (1280×720) — captures the logo's neutral state for shot 1's first-last loop. |
| `assets/images/shot2-start.png` | shot 1 end / shot 2 start | Logo glowing in the void with sparse particles. The pivotal anchor — appears on both sides of the 0:04 cut. |
| `assets/images/shot2-end.png` | shot 2 end / shot 3 start | Logo at center surrounded by four floating holographic panels with light streams connecting back to the trailing tips. |
| `assets/images/shot3-end.png` | shot 3 end | Logo upper-center with the wordmark "PNEUMA" in clean futuristic sans-serif beneath it. The brand finale. |

`assets/brand/pneuma-logo.png` is the source-of-truth logo — copied
into every workspace so the agent has the canonical mark to feed back
into future edits/variants.

## Video clips (3)

All three use `bytedance/seedance-2.0/image-to-video` via fal.ai with
`--no-audio` (BGM and VO are separate audio tracks). Output is
1280×720 @ 24fps; the composition canvas is 1920×1080 @ 30fps and the
playback engine scales per asset.

| Clip | Mode | Anchors | Prompt direction |
|------|------|---------|------------------|
| `shot1-spark.mp4` | from-image + end-image | shot1-start → shot2-start | One full inhale-exhale: trailing tips emit warm orange particles, halo expands then contracts, logo settles back to its starting steady state |
| `shot2-convergence.mp4` | from-image + end-image | shot2-start → shot2-end | Particles stream from the logo's tips, gather and condense into four floating translucent panels, gentle camera push-in |
| `shot3-resolution.mp4` | from-image + end-image | shot2-end → shot3-end | Panels fold back inward, light streams retract into the logo, wordmark "PNEUMA" materializes beneath it, camera gently pulls back |

## Audio + caption (3)

| Asset | Source | Notes |
|-------|--------|-------|
| `assets/audio/vo-tagline.mp3` | `fal-ai/gemini-3.1-flash-tts` | Voice `Kore`, style "calm cinematic narrator". 5.48s. Played 0:13 → 0:18.48. |
| `assets/bgm/pneuma-ambient.mp3` | `google/lyria-3-pro-preview` via OpenRouter | Warm cinematic ambient pad, slow swell, no drums. Asset is 60s; the timeline clip plays 0–19s with 0.6s fade-in / 1.2s fade-out. |
| Caption | inline `text` on subtitle clip | "Pneuma. Where breath becomes craft." Track-aligned with the VO clip. |

## Provenance graph (10 edges)

Every asset has a provenance edge in `project.json` capturing model,
prompt, anchors, and any seedance/imagegen params. The graph is the
canonical record of how the seed was made and is required by the
hydration tests:

```
shot1-start (import) ──── shot1-spark    (derive: shot1-start →                shot2-start)
shot2-start (generate) ── shot2-convergence (derive: shot2-start → shot2-end)
shot2-end   (generate) ── shot3-resolution (derive: shot2-end   → shot3-end)
shot3-end   (generate)
vo-tagline  (generate)
bgm-pneuma  (generate)
caption-stub (import)
```

`shot2-start`, `shot2-end`, `shot3-end` were generated through
`gpt-image-2/edit` with the brand logo as the `image_urls` reference;
`shot1-start` was extracted from frame 0 of the first shot 1 mp4 so it
could be reused as a strict-anchor pair for the regenerated 4s opener.

## Workspace layout (after seeding)

```
<workspace>/
├── project.json                       # the canonical timeline + asset registry
└── assets/
    ├── brand/pneuma-logo.png          # source-of-truth Pneuma logo (reference for the agent)
    ├── images/
    │   ├── shot1-start.png            # shot 1 first-frame anchor
    │   ├── shot2-start.png            # shot 1 end / shot 2 start
    │   ├── shot2-end.png              # shot 2 end / shot 3 start
    │   └── shot3-end.png              # shot 3 end (logo + wordmark)
    ├── clips/
    │   ├── shot1-spark.mp4            # 4.04s 1280×720 24fps
    │   ├── shot2-convergence.mp4      # 8.04s 1280×720 24fps
    │   └── shot3-resolution.mp4       # 7.04s 1280×720 24fps
    ├── audio/vo-tagline.mp3           # 5.48s 24kHz mono
    └── bgm/pneuma-ambient.mp3         # 60s 44.1kHz stereo (clipped to 19s in the timeline)
```

## How to regenerate

The agent already knows how to do this — see `skill/SKILL.md` and
`skill/references/workflows.md`. The shorthand for someone reading
the source:

```bash
# 0. Decrypt API keys from ~/.pneuma/api-keys.json into your shell.
bun -e "import { getApiKeys } from './server/share.ts'; \
  const k = getApiKeys(); \
  console.log('export FAL_KEY=' + k.FAL_API_KEY); \
  console.log('export OPENROUTER_API_KEY=' + k.OPENROUTER_API_KEY);"

# 1. Upload the logo once, reuse the URL across all anchor images.
curl -sX POST https://rest.alpha.fal.ai/storage/upload/initiate \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content_type":"image/png","file_name":"pneuma-logo.png"}' > /tmp/init.json
curl -X PUT "$(jq -r .upload_url /tmp/init.json)" \
  -H "Content-Type: image/png" --data-binary @public/logo.png
LOGO_URL=$(jq -r .file_url /tmp/init.json)

# 2. Anchor images (gpt-image-2 edit, passes the logo as reference).
node modes/_shared/scripts/generate_image.mjs "<prompt>" \
  --model gpt-image-2 --quality high --image-size 1920x1080 \
  --image-urls "$LOGO_URL" \
  --output-dir modes/clipcraft/seed/assets/images \
  --filename-prefix shotN-{start,end}

# 3. Videos (seedance from-image with start + end anchors).
node modes/clipcraft/skill/scripts/generate-video.mjs from-image \
  --prompt "<prompt>" \
  --image-url <start.png> --end-image-url <end.png> \
  --duration 4 --aspect-ratio 16:9 --no-audio \
  --output assets/clips/<file>.mp4

# 4. VO + BGM.
node modes/clipcraft/skill/scripts/generate-tts.mjs --text "..." --voice Kore --output assets/audio/vo-tagline.mp3
node modes/clipcraft/skill/scripts/generate-bgm.mjs --prompt "..." --duration 19 --output assets/bgm/pneuma-ambient.mp3
```

Approximate cost end-to-end: ≤ $2 (4 anchor images + 4 seedance clips + 1
TTS + 1 BGM). seedance has a hard `--duration 4–15` minimum; if you need
shorter, generate at 4s and trim with the clip's `inPoint` / `outPoint`.

## `candidates/`

Earlier compositions live in `candidates/<name>/project.json` for A/B
comparison. Asset files are shared with the active seed — only the
timeline JSON differs. See `candidates/README.md` for the inventory.

When changing this seed:
- **Always** snapshot the current `project.json` into a new
  `candidates/<descriptor>/` folder before overwriting.
- If the new version requires asset files the candidate doesn't, those
  assets are additive (the candidate just won't reference them) — fine.
- If the new version *replaces* an asset file (different bytes for the
  same path), copy the old bytes into the candidate folder too so the
  candidate still plays back faithfully.

## Tests

`modes/clipcraft/__tests__/hydration-integration.test.ts` reads this
exact `project.json` and asserts asset registry, provenance edge count,
parent ids on the three video clips, track structure, and the caption
text. Any change here that affects asset ids, edge count, or the
caption text needs to update that test.
