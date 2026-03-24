# /showcase — Generate Mode Showcase Materials

Generate showcase marketing images and metadata for a Pneuma mode's launcher gallery.

## Input

The user provides a mode name (e.g. `remotion`, `draw`). If not specified, ask.

## Step 1: Analyze the Mode

Read the mode's manifest and skill to understand:
- `modes/<name>/manifest.ts` — displayName, description, icon, key features
- `modes/<name>/skill/` — what the mode does, its workflow, unique capabilities
- `modes/<name>/showcase/showcase.json` — existing showcase data (if any)

Identify **3 key selling points** — the features that would make someone want to try this mode. Think from a user's perspective: what's exciting? what's unique?

## Step 2: Write showcase.json

Create `modes/<name>/showcase/showcase.json`:

```json
{
  "tagline": "Short punchy tagline (5-10 words)",
  "hero": "hero.png",
  "highlights": [
    {
      "title": "Feature Name",
      "description": "1-2 sentence description of the feature and why it matters.",
      "media": "feature-name.png",
      "mediaType": "image"
    }
  ]
}
```

**Rules:**
- Tagline: short, evocative, no period at end
- 3 highlights (occasionally 4 for complex modes)
- Titles: 2-4 words, punchy, title case
- Descriptions: concrete, benefit-focused, 1-2 sentences
- Media filenames: kebab-case, descriptive

## Step 3: Generate Showcase Images

Generate **4 images** (1 hero + 3 highlights) using your illustration capabilities.

**Image specs:**
- Dimensions: 1376×768 pixels (16:9)
- Save to: `modes/<name>/showcase/`

**Visual style — "Ethereal Tech Dark Mockup":**

Each image is a **conceptual UI mockup on a dark canvas** that communicates one key idea at a glance. Study the reference images in existing showcase directories for the exact aesthetic:

- **Background:** Deep dark (#09090b to #18181b), subtle radial gradient warmth
- **Content:** Stylized UI mockups, not real screenshots — simplified, idealized representations of the mode's interface
- **Orange accent:** #f97316 for interactive elements (buttons, highlights, selection states, arrows)
- **Composition patterns used across modes:**
  - "Input → Output" with an orange arrow (Draw: text prompt → diagram)
  - "Before → After" split comparison (WebCraft: AI Slop vs Impeccable)
  - "Dashboard overview" with cards and stats (Evolve: proposals + metrics)
  - "Canvas with toolbar" showing the workspace (Slide: canvas + thumbnails)
  - "Feature callout" with zoomed-in UI detail (Doc: select mode highlighting)
- **Bottom key message:** Some images include a one-line italic caption at the bottom summarizing the concept
- **Chat bubbles:** Some images show a small chat exchange to illustrate the human-agent interaction
- **Glass/depth effects:** Subtle glassmorphism on panels, rounded corners, soft shadows
- **Typography:** Clean sans-serif, clear hierarchy, white text on dark

**Hero image:** Overview of the mode — what does the workspace look like in action? Show the most impressive/representative state.

**Highlight images:** Each focuses on ONE feature. The image should be self-explanatory — someone should understand the feature just by looking at it, even without reading the title.

## Step 4: Verify

After generating all images:
1. Confirm all files exist in `modes/<name>/showcase/`
2. Verify `showcase.json` references match actual filenames
3. Commit: `git add modes/<name>/showcase/ && git commit -m "feat(<name>): add showcase materials"`

## Reference

Study these existing showcase directories for inspiration:
- `modes/webcraft/showcase/` — design commands, anti-slop comparison, responsive preview
- `modes/draw/showcase/` — prompt→diagram, hand-drawn canvas, bidirectional selection
- `modes/slide/showcase/` — canvas with thumbnails, drag-reorder, export options
- `modes/evolve/showcase/` — evolution dashboard, analysis, proposals

Read the images directly to understand the exact visual style before generating.
