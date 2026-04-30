---
name: pneuma-illustrate
description: >
  Pneuma Illustrate Mode workspace guidelines. Use for ANY task in this workspace:
  generating images, creating illustrations, editing visuals, managing content sets,
  organizing rows, crafting prompts, adjusting styles, or any image generation task.
  This skill defines the generation workflow, manifest format, prompt engineering,
  and content set organization for the AI illustration studio.
  Consult before your first edit in a new conversation.
---

# Pneuma Illustrate Skill

This is **Illustrate Mode**: AI-powered illustration creation with content sets and row-based organization. Your role is to help users create, curate, and manage AI-generated visual assets — generate images, manage content sets, craft prompts, run edit-and-variation workflows.

Read this skill before your first generation in a new conversation.

## Working with the viewer

The illustrate viewer is a row-based canvas. Each top-level directory is a **content set** (project) and renders as a stack of rows; the user navigates, selects images, and can scribble a highlighter mask on a region. You and the user communicate through five channels — read incoming context, embed locators in replies, call viewer actions when navigation helps, scaffold workspaces with confirmation, and switch content sets when starting a new project.

### Reading what the user sees

Before each turn the runtime injects a `<viewer-context>` block. Two shapes:

When an image is selected:
```xml
<viewer-context mode="illustrate" content-set="logo-designs" file="images/logo-v1.png">
Selected image: "Minimal Logo v1"
Row 1/3: "Initial Concepts" (4 items)
Prompt: "A minimalist geometric fox logo..."
Style: minimal
Tags: logo, geometric
</viewer-context>
```

When nothing is selected (project overview):
```xml
<viewer-context mode="illustrate" content-set="logo-designs">
Project: "Logo Project" (3 rows, 12 images)
Styles: minimal (5), watercolor (4), flat-vector (3)
Rows:
  1. "Initial Concepts" (4 items)
  2. "Warm Color Variations" (4 items)
  3. "Final Refinements" (4 items)
Tags: logo, geometric, warm, professional
</viewer-context>
```

The `content-set` attribute names the active project — that's where new images go unless the user asks otherwise. Use the rest to resolve "this image", "this row", "make it darker" without guessing.

User-driven gestures arrive as `<user-actions>` entries inside the next user message — for example:

```xml
<user-actions>
- user selected image "images/logo-v1.png" in row "Initial Concepts"
- user highlighted a region on "images/logo-v1.png" (annotation crop saved to /tmp/highlight-region.png)
</user-actions>
```

A highlighter entry means a region crop is already saved as a temp file — pass that path as `--annotation` to `edit_image.mjs` (see the edit workflow below).

### Locator cards

Embed `<viewer-locator data='{...}'></viewer-locator>` in chat so the user can jump to a result with one click. The `data` payload accepts these keys, alone or combined:

```html
<!-- Navigate to a specific image in the active content set -->
<viewer-locator data='{"file":"images/logo-fox-1.png"}'></viewer-locator>

<!-- Focus a whole row (e.g. after a batch generation) -->
<viewer-locator data='{"rowId":"row-1710000000000"}'></viewer-locator>

<!-- Switch the active content set -->
<viewer-locator data='{"contentSet":"marketing-assets"}'></viewer-locator>

<!-- Switch content set AND select a specific image in one click -->
<viewer-locator data='{"contentSet":"marketing-assets","file":"images/hero.png"}'></viewer-locator>
```

Drop a locator after every generation, edit, and variation so the canvas and the conversation stay synced.

### Viewer actions

For navigation that should happen without a click, POST to `$PNEUMA_API/api/viewer/action` with the action id. Three actions are available in illustrate:

| Action | Params | When to use |
|--------|--------|-------------|
| `navigate-to` | `{ "file": "images/logo-v1.png" }` | Jump the canvas to a specific image |
| `fit-view` | `{}` | Zoom out to show the entire content set |
| `zoom-to-row` | `{ "rowId": "row-1710000000000" }` | Frame a row after a batch generation |

Example — focus the row that just finished generating:

```bash
curl -X POST "$PNEUMA_API/api/viewer/action" \
  -H "Content-Type: application/json" \
  -d '{"actionId":"zoom-to-row","params":{"rowId":"row-1710000000000"}}'
```

Prefer locator cards for "here's the result, click to see it"; use viewer actions when the agent should drive the camera itself (e.g. fit-view after scaffolding a fresh project).

### Content sets

Illustrate uses **content sets** — each top-level directory in the workspace (`logo-designs/`, `marketing-assets/`, `blog-heroes/`, …) is a self-contained project with its own `manifest.json` + `images/`. The active set is in `<viewer-context>`'s `content-set` attribute and is what the user is currently looking at on the canvas.

Rules:
- **New project → new content set directory.** Don't dump unrelated work into an existing set; create `<descriptive-name>/manifest.json` + `<descriptive-name>/images/` instead.
- Write all images for a turn into the active content set unless the user explicitly switches.
- Switch sets by emitting a `contentSet` locator (see above) — the viewer changes the active project on click.
- Each content set's `manifest.json` is independent — never cross-reference rows across sets.

### Scaffold

Scaffold initializes a fresh workspace: it writes a content-set directory with a starter `manifest.json` (rows + placeholder items) ready for your first generation pass. **Always confirm with the user before scaffolding** — it clears `**/images/*` and `**/manifest.json` across the workspace.

Params:

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | yes | Project / content set title (e.g. `"Logo Designs"`) — also used as the directory name (kebab-cased) |
| `images` | string | yes | JSON array of `{ title, prompt, aspectRatio? }` — one entry per starter image |

Example `images` payload:

```json
[
  { "title": "Geometric Fox v1", "prompt": "A minimalist geometric fox logo, flat vector, orange on dark", "aspectRatio": "1:1" },
  { "title": "Geometric Fox v2", "prompt": "A minimalist geometric fox logo, alternate angle", "aspectRatio": "1:1" },
  { "title": "Wordmark Variant", "prompt": "Wordmark companion to the fox logo, sans-serif", "aspectRatio": "16:9" }
]
```

After scaffolding, the canvas shows a placeholder row; run the generation script per item to fill it in.

## Architecture

- Each top-level directory is a **content set** (project) with `manifest.json` + `images/`
- `manifest.json` — Row-based index tracking all generated images (rows → items)
- `images/` — Generated image files

## Core Rules

- Always update `manifest.json` after generating — add placeholder items with `"status": "generating"` first, then update when done
- When the user asks for variations, create a new row below the original
- When the user asks to **modify** an existing image, use `edit_image.mjs` (not regenerate) to preserve composition
- When the user highlights a region with the highlighter tool, pass the crop as `--annotation` to the edit script
- **New project → new content set** directory rather than overwriting existing content
- Do not ask for confirmation on simple generations — just do them
- Never modify files in `.claude/` or `.pneuma/` directories
- Always save images to `<content-set>/images/`
- Row IDs must be unique — use `row-{Date.now()}` format
{{#imageGenEnabled}}

## AI Image Generation

- `scripts/generate_image.mjs` — Generate new images from text prompts (default model: `gpt-image-2`, strong at legible text/logos; opt in to `--model gemini-3-pro` for painterly work)
- `scripts/edit_image.mjs` — Modify an existing local image with an optional highlighter annotation (Gemini vision via OpenRouter)

**Workflow at a glance**: write placeholder row to `manifest.json` (status: "generating") → run script → update manifest with result. Detailed flags, prompt engineering, and the GPT-Image-2 URL+mask edit path are documented in the sections below.
{{/imageGenEnabled}}

## Data Model

### Row = Generation Batch

Each generation task creates a **row** of images. Rows are the primary organizational unit:
- A row groups images from a single generation task
- Rows have a descriptive `label` and unique `id`
- Items within a row share a common creative intent

### manifest.json Format

```json
{
  "title": "Logo Project",
  "description": "Logo designs for XX project",
  "rows": [
    {
      "id": "row-1710000000000",
      "label": "Initial Concepts",
      "items": [
        {
          "file": "images/logo-v1.png",
          "title": "Minimal Logo v1",
          "prompt": "A minimalist geometric fox logo...",
          "aspectRatio": "1:1",
          "resolution": "1K",
          "style": "minimal",
          "tags": ["logo", "geometric"],
          "createdAt": "2025-01-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

### Row Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique ID, use `row-{timestamp}` format |
| `label` | Yes | Descriptive label for the generation batch |
| `items` | Yes | Array of image entries |

### Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `file` | Yes | Path relative to content set directory (e.g. `images/logo-v1.png`) |
| `title` | Yes | Human-readable title |
| `prompt` | Yes | Full generation prompt (for reproducibility) |
| `aspectRatio` | No | Aspect ratio used |
| `resolution` | No | Resolution used |
| `style` | No | Style tag for grouping |
| `tags` | No | Array of tags for filtering |
| `createdAt` | No | ISO 8601 timestamp |
| `status` | No | `"generating"` while in progress, remove or set `"ready"` when done |

## Generation Workflow

Image generation takes time. To give the user immediate visual feedback, use a **two-step manifest update**:

### Step 1: Write placeholder items BEFORE generating

Before running the generation script, add the new row to `manifest.json` with `"status": "generating"` on each item. The viewer will show animated placeholder cards so the user knows work is in progress.

```json
{
  "id": "row-1710000000001",
  "label": "5 minimal logos — geometric fox",
  "items": [
    {
      "file": "images/logo-fox-1.png",
      "title": "Geometric Fox v1",
      "prompt": "A minimalist geometric fox logo...",
      "aspectRatio": "1:1",
      "status": "generating"
    },
    {
      "file": "images/logo-fox-2.png",
      "title": "Geometric Fox v2",
      "prompt": "A minimalist geometric fox logo, alternate angle...",
      "aspectRatio": "1:1",
      "status": "generating"
    }
  ]
}
```

### Step 2: Update items AFTER generation completes

After each image is generated, update the corresponding item in `manifest.json`:
- Remove the `"status"` field (or set to `"ready"`)
- Add `"createdAt"`, `"resolution"`, and any other metadata

The viewer watches `manifest.json` — each save triggers a live refresh. The placeholder card is replaced by the real image automatically.

### Full workflow

1. **Determine the content set** — Work in the appropriate project directory. Create a new content set if the user is starting a new project.
2. **Craft the prompts** — Write detailed, specific prompts following the prompt engineering guidelines below.
3. **Choose parameters** — Select appropriate aspect ratio, resolution, and format.
4. **Add placeholder row** — Write the new row to `manifest.json` with `"status": "generating"` on each item. The user sees placeholder cards immediately.
5. **Generate images** — Run the generation script. For batch generation, generate one at a time and update each item's status in manifest after it completes.
6. **Update manifest** — Remove `"status"` field and add metadata (`createdAt`, `resolution`, etc.) for each completed item.
7. **Report** — Briefly describe what was generated. The user sees results live on the canvas.

### Row ID Generation

Always use timestamp-based IDs for rows: `row-{Date.now()}`. This ensures uniqueness and natural chronological ordering.

### Row Label Guidelines

Write descriptive labels that capture what was generated:
- "5 minimal logos — geometric fox" (batch generation)
- "Hero illustration — sunset mountain" (single image)
- "Variations of Minimal Logo v1 — warm palette" (variations)
- "Color alternatives — blue and purple series" (style exploration)

## Image Generation Script

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your detailed prompt here" \
  --aspect-ratio 1:1 \
  --quality high \
  --output-format png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix descriptive-name
```

### Model Picking

| Model | Pick when | Backends |
|---|---|---|
| `gpt-image-2` (default) | General use. Especially strong at **legible typography, labels, wordmark logos, UI mockups with real copy, signage, diagrams with text**, and precise mask-based edits. | fal.ai only |
| `gemini-3-pro` | Painterly / watercolor / broad artistic illustration, Gemini-specific aesthetic, or when only OpenRouter is configured. | fal.ai or OpenRouter |

Default to `gpt-image-2` unless the user asks for Gemini or the style specifically calls for it. If the user only configured `OPENROUTER_API_KEY`, pass `--model gemini-3-pro` — `gpt-image-2` is fal.ai-only and will error out otherwise.

### Parameters

Common:

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--model` | `gpt-image-2`, `gemini-3-pro` | `gpt-image-2` | See model picking above |
| `--aspect-ratio` | `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`, `2:3`, `9:16` | `1:1` | Match the intended use. For `gpt-image-2` this maps to a fal.ai preset. |
| `--output-format` | `png`, `jpeg`, `webp` | `png` | `png` for quality, `webp` for size |
| `--num-images` | 1–4 | 1 | Multiple for variations |
| `--filename-prefix` | any string | `illustration` | Use descriptive names |

GPT-Image-2 only:

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--quality` | `low`, `medium`, `high` | `high` | Affects cost — drop to `medium` for drafts |
| `--image-size` | preset (`landscape_4_3`, `square_hd`, …) or `WxH` | — | Overrides `--aspect-ratio` mapping |
| `--image-urls` | one or more URLs | — | Switches to the edit endpoint |
| `--mask-url` | URL | — | Optional mask for edit endpoint |

Gemini 3 Pro only:

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--resolution` | `1K`, `2K`, `4K` | `1K` | Higher = more detail |
| `--safety-tolerance` | `1`–`6` | `4` | fal.ai only. 1 = strictest, 6 = loosest |
| `--seed` | integer | — | fal.ai only |

**Important:** `--output-dir` must point to the content set's `images/` subdirectory, e.g. `<workspace>/my-project/images`.

The script prints a JSON object to stdout on success with `backend`, `model`, `files` (local paths), `urls` (remote URLs), and `description`.

## Image Editing Scripts

Two edit paths are available — pick based on how the user pointed at the change:

### Path A: Annotation-Driven (`edit_image.mjs`)

Use when the source is a **local file** and the user's intent is best expressed by pointing at a region (e.g. they circled it with the highlighter tool). This sends the original image and an optional annotation crop to Gemini's vision + image model, which reasons about both in one pass.

```bash
cd {SKILL_PATH} && node scripts/edit_image.mjs \
  "Your modification instructions" \
  --input <workspace>/<content-set>/images/original.png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix edited-name
```

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--input, -i` | file path | **required** | Original image to modify |
| `--annotation, -a` | file path | none | Highlighter region crop (sent as 2nd image) |
| `--aspect-ratio` | same as generate, plus `1:4`, `4:1`, `1:8`, `8:1` | `auto` | Keeps original ratio by default |
| `--resolution` | `0.5K`, `1K`, `2K`, `4K` | `1K` | Output resolution |
| `--output-format` | `png`, `jpeg`, `webp` | `png` | Output file format |
| `--filename-prefix` | any string | `edited` | Output filename prefix |

Requires `OPENROUTER_API_KEY`.

### Path B: URL + Mask (GPT-Image-2 edit endpoint via `generate_image.mjs`)

Use when the source image is already a **URL** (uploaded, remote, or from a prior generation) and you want precise mask-driven edits — GPT-Image-2 preserves text and layout much better than Gemini vision in this case. Add `--image-urls` (and optionally `--mask-url`) to the generate script; it automatically routes to `openai/gpt-image-2/edit`:

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Same composition, replace the tagline with 'Hello World'" \
  --image-urls https://example.com/source.png \
  --mask-url https://example.com/mask.png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix edited-hero
```

### When to Use Edit vs Generate

| Scenario | Command |
|----------|---------|
| User says "make this darker" / "change the color" on a selected local image | `edit_image.mjs` |
| User highlights a region and says "fix this part" | `edit_image.mjs --annotation` |
| Source image is a URL and the change needs precise text/layout preservation | `generate_image.mjs --image-urls` (GPT-Image-2 edit) |
| User wants completely new images from a text description | `generate_image.mjs` |
| User wants variations of a concept (not tied to a specific image file) | `generate_image.mjs` with modified prompt |

### Edit with Highlighter Annotation

When the user uses the highlighter (Cmd+draw in select mode) to circle a region of an image, the viewer captures that region as a cropped image. To edit based on this:

1. **Save the annotation crop** to a temporary file (the viewer provides it as a data URL)
2. **Send both images** — original + annotation — to the edit script
3. **Explain in the prompt** what the highlighted region means and what change to make

```bash
cd {SKILL_PATH} && node scripts/edit_image.mjs \
  "The user has circled a region in the second image. Fix this area: make the edges sharper and the colors more saturated." \
  --input <workspace>/<content-set>/images/original.png \
  --annotation /tmp/highlight-region.png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix original-fixed
```

### Edit Prompt Tips

- **Be specific** about what to change: "Change the background from orange to deep blue" beats "make it different"
- **Reference the annotation** when present: "The highlighted region (second image) shows the area to fix"
- **Preserve intent**: Mention what to keep: "Keep the same composition and style, only change the color palette"
- **One change at a time** produces better results than asking for many simultaneous changes

### Edit Workflow

When the user selects an image and asks for modifications:

1. **Read the original item** from manifest.json to get the file path and metadata
2. **Determine input path** — construct full path: `<workspace>/<content-set>/images/<file>`
3. **If highlighter annotation exists** — save the region data URL to a temp file, pass as `--annotation`
4. **Add placeholder row** — create a new row in manifest with `"status": "generating"` on the item, labeled "Edit of [original title] — [change description]". The user sees a generating placeholder immediately.
5. **Craft the edit prompt** — describe the change clearly, referencing the annotation if present
6. **Run the edit** — `edit_image.mjs` for annotation-driven, or `generate_image.mjs --image-urls ... --mask-url ...` for URL+mask
7. **Update manifest** — remove `"status"` from the item and add metadata
8. **Keep the original** — don't modify or delete the original image/row

## Variation Workflow

When the user selects an image and asks for variations:

1. **Read the original item** from the row in manifest.json
2. **Modify the prompt** based on feedback (e.g., "make it darker" → adjust lighting/color descriptors)
3. **Generate with new filenames** — Append a suffix like `-v2`, `-warm`, `-alt`
4. **Create a new row below** — Label it "Variations of [original title]" or describe the change
5. **Keep the original row** — Don't modify previous rows unless explicitly asked

## Content Set Workflow

(For the conceptual model and switch-set locator, see **Working with the viewer → Content sets** above.)

### Creating a New Content Set

When the user starts a new project, prefer the scaffold action (see "Working with the viewer → Scaffold"). To do it by hand:

1. Create a new top-level directory with a descriptive name (e.g. `logo-project/`, `app-mockups/`)
2. Create `manifest.json` with title and empty rows
3. Create `images/` subdirectory
4. Generate the first batch and add as the first row

### Working Within a Content Set

- Each generation task adds a new row to the existing manifest
- Row order in the array = display order (newest typically at the bottom)
- Never overwrite existing rows — always append

### Organization Rules

- **One content set per project/theme** — logos in one, illustrations in another
- **Each row = one generation task** — don't mix unrelated generations in a single row
- **Row labels are descriptive** — "5 minimal logos", "Warm color variations of v2"
- **Images saved to `<content-set>/images/`** with descriptive names
- Use common **filename prefixes** for related items: `logo-minimal-v1.png`, `logo-minimal-v2.png`
- Add **tags** for easy filtering: `["logo", "geometric", "warm"]`
- Set **style** consistently for series: all icons share `"style": "flat-vector"`
- Keep **prompts** in manifest.json — they're documentation and enable re-generation

## Prompt Engineering

### Structure

Write prompts with these components in order:

1. **Subject** — What is the main subject? Be specific.
2. **Style** — Art style, medium, technique (e.g., "digital watercolor", "flat vector", "photorealistic")
3. **Composition** — Framing, perspective, layout (e.g., "close-up", "bird's eye view", "centered")
4. **Lighting** — Light quality and direction (e.g., "soft golden hour", "dramatic side lighting")
5. **Color palette** — Dominant colors and mood (e.g., "warm earth tones", "neon cyberpunk palette")
6. **Details** — Textures, atmosphere, background elements
7. **Quality modifiers** — "high quality", "detailed", "professional"

### Good Prompt Examples

**Icon/Logo:**
> "A minimalist geometric fox logo, flat vector style, orange and white on dark background, clean lines, symmetric, professional brand identity design"

**Scene Illustration:**
> "A cozy Japanese ramen shop at night, warm interior light spilling onto a rain-wet street, watercolor and ink style, muted warm palette with pops of red lantern light, atmospheric perspective, Studio Ghibli inspired"

**Technical Diagram:**
> "Clean isometric illustration of a cloud computing architecture, servers, databases, and API connections shown as colorful blocks connected by flowing lines, flat design style, tech blue and purple gradient palette, white background, infographic quality"

**Character:**
> "A friendly robot barista making coffee, retro-futuristic design with rounded chrome body, warm cafe environment, soft ambient lighting, Pixar-style 3D render, cheerful expression"

### Prompt Tips

- Be **specific** over generic — "a golden retriever puppy playing in autumn leaves" beats "a cute dog"
- Include **artistic medium** — it dramatically affects output style
- Mention **mood and atmosphere** — emotional context guides the model
- For **consistency** across a series, repeat core style descriptors in each prompt
- For **variations**, change only one dimension (color, angle, expression) at a time

## Style Consistency

When creating a series of related images:

1. **Define a style guide** — Establish color palette, art style, and mood upfront
2. **Use a template prompt** — Create a base prompt and vary only the subject
3. **Match aspect ratios** — Use the same ratio for images that will appear together
4. **Consistent lighting** — Keep the same lighting direction and quality
5. **Color harmony** — Stick to a defined palette across the series

### Style Template Example

For a set of team member avatars:
```
Base: "[Subject description], portrait style, soft studio lighting,
pastel gradient background, clean digital illustration, friendly expression,
professional but approachable, consistent rounded art style"

Then vary only: [Subject description]
- "A young woman software engineer with short curly hair and glasses"
- "A middle-aged man designer with a neat beard and warm smile"
```

## Batch Operations

When the user wants multiple images:

1. **Plan first** — List all images with titles and prompts before generating
2. **Generate sequentially** — One at a time, so the user can review and adjust
3. **Add all to one row** — A batch generation task is a single row with multiple items
4. **Offer adjustments** — After each image, briefly note it's done; continue to the next unless the user intervenes

## Constraints

- Always update `manifest.json` after generating images — add new rows, don't modify existing ones
- Use `generate_image.mjs` / `edit_image.mjs` for all image generation and editing — do not attempt other methods
- The canvas viewer reads `manifest.json` — if you don't update it, new images won't appear

(See **Core Rules** above for filesystem boundaries and row-ID format.)
