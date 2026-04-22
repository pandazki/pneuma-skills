---
name: contextual-illustrator
description: >
  How to generate and edit images from any Pneuma mode. Covers OpenAI GPT-Image-2
  (default) and Google Gemini 3 Pro Image, auto-routed between fal.ai and OpenRouter
  based on which API key is configured. Use this skill whenever the active mode
  asks for an image — hero banners, inline illustrations, icons, mood imagery,
  diagrams with legible text, mockups, UI screenshots, or a mask-based edit.
  The mode's own skill describes the aesthetic and where to save files; this skill
  tells you *which model to pick and which flags to pass*.
---

# Contextual Illustrator

Shared image generation and editing for Pneuma. Two scripts live under this skill, and modes opt into them via their manifest.

```
.claude/skills/contextual-illustrator/
├── SKILL.md                         ← you are here
├── .env                             ← FAL_KEY / OPENROUTER_API_KEY (populated by installer)
└── scripts/
    ├── generate_image.mjs           ← text-to-image + GPT-Image-2 URL+mask edit
    └── edit_image.mjs               ← annotation-driven local-file edit (Gemini vision)
```

Each script prints a single JSON object to stdout on success — fields `backend`, `model`, `files` (local paths), `urls` (remote URLs), `description`. The consuming mode reads that JSON and records what it needs (e.g. writing a manifest.json entry).

## Model Picking

| Model | Pick when | Backends |
|---|---|---|
| `gpt-image-2` (default) | General use. Very strong at **legible text, typography, labels, signage, UI mockups with real copy, diagrams with text, and precise mask-based edits**. | fal.ai only |
| `gemini-3-pro` | Painterly or artistic illustrations, broad stylistic range, Gemini-specific aesthetic. Also the only option when only OpenRouter is configured. | fal.ai or OpenRouter |

Rules of thumb:
- **Default to `gpt-image-2`** unless the user specifically asks for Gemini or the style calls for it.
- Want to edit an existing image by URL (replace a region, restyle with a reference) → `gpt-image-2` with `--image-urls` (optional `--mask-url`).
- Have a local file you want to modify with highlighter-style reasoning → `edit_image.mjs` (Gemini vision via OpenRouter).
- Only `OPENROUTER_API_KEY` configured → you must use `--model gemini-3-pro`; the script will error out otherwise.

## Environment

- Script auto-loads keys from `{SKILL_PATH}/.env` first, then walks up from cwd.
- `FAL_KEY` → fal.ai (required for default `gpt-image-2`; also supports Gemini 3 Pro).
- `OPENROUTER_API_KEY` → OpenRouter (Gemini 3 Pro only).
- Running the script without keys prints a helpful error. Do NOT write keys into prompts or commit them to the workspace — the installer wrote them into `{SKILL_PATH}/.env`, which is gitignored by Pneuma's default `.gitignore`.

Missing key? Ask the user to restart the mode and provide one at launch, or to add the value to `{SKILL_PATH}/.env` manually.

## Generate: Text-to-Image (default: gpt-image-2)

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your detailed prompt here" \
  --aspect-ratio 16:9 \
  --quality high \
  --output-format png \
  --output-dir <workspace-relative-path>/images \
  --filename-prefix hero-banner
```

Common options:

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--model` | `gpt-image-2`, `gemini-3-pro` | `gpt-image-2` | See Model Picking above |
| `--num-images` | 1–4 | 1 | Multiple for variations |
| `--aspect-ratio` | `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`, `2:3`, `9:16` | `1:1` | For `gpt-image-2` this maps to a fal.ai preset (`landscape_16_9`, `square_hd`, …) |
| `--output-format` | `png`, `jpeg`, `webp` | `png` | `png` for illustrations, `jpeg` for photos |
| `--output-dir` | path | `.` | Always save into the mode's own content directory |
| `--filename-prefix` | string | `illustration` | Use descriptive names reflecting purpose |
| `--backend` | `fal`, `openrouter` | auto | Force a specific backend |

GPT-Image-2–specific:

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--quality` | `low`, `medium`, `high` | `high` | Directly affects cost — drop to `medium` for drafts |
| `--image-size` | preset name (`landscape_4_3`, `square_hd`, …) **or** `WxH` (e.g. `1024x1024`) | — | Overrides `--aspect-ratio` mapping |

Constraint for explicit `WxH`: both dimensions multiples of 16, max edge 3840px, aspect ratio ≤ 3:1, total pixels between 655,360 and 8,294,400.

Gemini 3 Pro–specific:

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--resolution` | `1K`, `2K`, `4K` | `1K` | `1K` for web/inline, `2K` for print/hero |
| `--safety-tolerance` | `1`–`6` | `4` | fal.ai only. 1 = strictest, 6 = loosest |
| `--seed` | integer | — | fal.ai only |

## Generate: Edit an Existing Image (gpt-image-2)

When the source image is already a URL (you uploaded it, or it came from the web), GPT-Image-2's edit endpoint is the most precise option. Add `--image-urls` (and optionally `--mask-url`) to the same script — it automatically switches to `openai/gpt-image-2/edit`:

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Same scene, but replace the headline text with 'Hello World'" \
  --image-urls https://example.com/source.png \
  --mask-url https://example.com/mask.png \
  --output-dir <workspace-relative-path>/images \
  --filename-prefix edited-hero
```

The output JSON includes `"endpoint": "openai/gpt-image-2/edit"` so the caller can tell which code path ran.

## Edit: Annotation-Driven (local file + highlighter)

For the case where the user is pointing at a region on a local image — typically with the viewer's highlighter tool — `edit_image.mjs` sends the original image plus an optional annotation crop to Gemini's vision+image model. This is **not** a replacement for GPT-Image-2 edit; it's complementary.

```bash
cd {SKILL_PATH} && node scripts/edit_image.mjs \
  "The user has circled a region in the second image. Make that area's edges sharper and colors more saturated." \
  --input <workspace-relative-path>/images/original.png \
  --annotation /tmp/highlight-region.png \
  --output-dir <workspace-relative-path>/images \
  --filename-prefix original-fixed
```

Requires `OPENROUTER_API_KEY`.

## Crafting Prompts in Context

Before you call either script, reason through:

1. **Purpose** — hero / inline illustration / icon / diagram / decorative?
2. **Content alignment** — what concepts should the image convey? What's in the surrounding text?
3. **Existing visuals** — match their color palette, rendering style, and mood for consistency.
4. **Audience & tone** — technical → clean/minimal; marketing → vibrant; editorial → warm/restrained.
5. **Placement & size** — determines aspect ratio and whether the image needs text/legibility.

A good prompt includes: subject, style, composition/framing, mood/atmosphere, technical details (lighting, medium). Default style when no context exists is **elegant minimal** — soft muted palette, clean composition, restrained detail, generous whitespace, understated elegance. Append descriptors like `soft muted colors, clean minimal composition, subtle texture, elegant and understated, restrained palette` to reinforce the default.

When generating a *series*, record the style descriptors you used on the first image and reuse them verbatim on subsequent calls. Consistency beats cleverness.

## Isolation (Optional but Recommended)

For noisy generation sessions (many images, long prompts), delegate to a sub-agent via the Task tool so the main conversation stays clean. Pass the sub-agent: the relevant context summary, the style descriptors to maintain, and the exact output path(s) to write to. The main agent integrates the returned JSON.

## API Reference

**Endpoints**:
- Gemini 3 Pro Image Preview — `google/gemini-3-pro-image-preview` (OpenRouter) / `fal-ai/gemini-3-pro-image-preview` (fal.ai queue)
- OpenAI GPT-Image-2 — `openai/gpt-image-2` and `openai/gpt-image-2/edit` (fal.ai queue only)

**Aspect ratios**: `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`, `2:3`, `9:16`. For `gpt-image-2` the ratio is mapped to a fal.ai preset (`landscape_16_9`, `landscape_4_3`, `square_hd`, `portrait_4_3`, `portrait_16_9`); override with `--image-size`.

**Output formats**: `png`, `jpeg`, `webp`.

**Safety tolerance (Gemini on fal.ai)**: `1` (strictest) to `6` (loosest), default `4`.
