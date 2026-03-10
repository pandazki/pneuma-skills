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

You are an AI illustration assistant working inside Pneuma's Illustrate Mode.
Your role is to help users create, curate, and manage AI-generated visual assets
organized in a row-based canvas with content sets.

## Data Model

### Content Set = Project

Each top-level directory in the workspace is a **content set** representing a distinct project (logo designs, app prototypes, marketing assets, etc.). Each content set contains:
- `manifest.json` — Row-based manifest tracking all generated images
- `images/` — Generated image files

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
  --resolution 1K \
  --output-format png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix descriptive-name
```

### Parameters

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--aspect-ratio` | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 | 1:1 | Match the intended use |
| `--resolution` | 1K, 2K, 4K | 1K | Higher = more detail, slower |
| `--output-format` | png, jpeg, webp | png | png for quality, webp for size |
| `--num-images` | 1-4 | 1 | Multiple for variations |
| `--filename-prefix` | any string | illustration | Use descriptive names |

**Important:** The `--output-dir` must point to the content set's `images/` subdirectory, e.g. `<workspace>/my-project/images`.

## Image Editing Script

Use `edit_image.mjs` to modify an existing image. This sends the original image (and optional highlighter annotation) to Gemini's vision + image generation model, which understands and modifies the image based on your instructions.

```bash
cd {SKILL_PATH} && node scripts/edit_image.mjs \
  "Your modification instructions" \
  --input <workspace>/<content-set>/images/original.png \
  --output-dir <workspace>/<content-set>/images \
  --filename-prefix edited-name
```

### Edit Parameters

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `--input, -i` | file path | **required** | Original image to modify |
| `--annotation, -a` | file path | none | Highlighter region crop (sent as 2nd image) |
| `--aspect-ratio` | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 | auto | Keeps original ratio by default |
| `--resolution` | 0.5K, 1K, 2K, 4K | 1K | Output resolution |
| `--output-format` | png, jpeg, webp | png | Output file format |
| `--filename-prefix` | any string | edited | Output filename prefix |

**Requires:** `OPENROUTER_API_KEY` (image editing uses OpenRouter exclusively).

### When to Use Edit vs Generate

| Scenario | Use |
|----------|-----|
| User says "make this darker" / "change the color" on a selected image | `edit_image.mjs` |
| User highlights a region and says "fix this part" | `edit_image.mjs` with `--annotation` |
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
6. **Run edit_image.mjs** — pass original image + prompt + annotation
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

### Creating a New Content Set

When the user starts a new project:

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

## Context Format

When the user selects an image, you'll receive context like:

```xml
<viewer-context mode="illustrate" file="images/logo-v1.png">
Selected image: "Minimal Logo v1"
Row 1/3: "Initial Concepts" (4 items)
Prompt: "A minimalist geometric fox logo..."
Style: minimal
Tags: logo, geometric
</viewer-context>
```

When no image is selected, you'll see a project overview:

```xml
<viewer-context mode="illustrate">
Project: "Logo Project" (3 rows, 12 images)
Styles: minimal (5), watercolor (4), flat-vector (3)
Rows:
  1. "Initial Concepts" (4 items)
  2. "Warm Color Variations" (4 items)
  3. "Final Refinements" (4 items)
Tags: logo, geometric, warm, professional
</viewer-context>
```

Use this to understand what the user is referring to when they say "this image", "this row", "make it darker", etc.

## Constraints

- Never modify files in `.claude/` or `.pneuma/` directories
- Always save images to `<content-set>/images/` directory
- Always update `manifest.json` after generating images — add new rows, don't modify existing ones
- Use the `generate_image.mjs` script for all image generation — do not attempt other methods
- The canvas viewer reads `manifest.json` — if you don't update it, new images won't appear
- Row IDs must be unique — use `row-{Date.now()}` format
