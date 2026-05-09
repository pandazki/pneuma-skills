# Storyboard Design — Pneuma's 设定 + 分镜 method

`storyboard-workflow.md` covers the **mechanics** (sketch → anchor → clip, command shapes, JSON edits). This document covers the **design method** — Pneuma's native flow for thinking through a storyboard before generating it.

Most agents skip straight to "generate N sketches with one-line prompts". The result is a slideshow of unrelated images: characters look different per panel, the palette wanders, the camera arc is accidental, the story doesn't read. The fix isn't to imitate Pixar pre-production page layouts — it's to **separate world-building from shot-listing** and let both inform every per-panel prompt.

The Pneuma flow has two passes before any image generates:

**Pass 1 — 设定 (world-building)**: project metadata, flow intention, camera grammar, color palette, character design. The "creative bible". Lives once per project; every later step references it.

**Pass 2 — 分镜 (shot list)**: numbered panels, each citing the 设定 layers. The execution plan. Each panel becomes one previewFrame on the timeline.

Then **Pass 3** (per-panel sketch generation) and the rest of `storyboard-workflow.md` proceed with rich prompts derived from the 设定 + 分镜.

Five layers in 设定:

1. **Project metadata** — title, format, duration, tone tag
2. **Flow intention** — the emotional thread metaphor + per-panel beat label
3. **Camera grammar** — the pacing arc (close → wide, low → high, intimate → energetic)
4. **Color palette** — 3–5 named mood swatches that anchor the visual identity
5. **Character design + casting** — for any recurring person, lock the look + casting reference upfront

These five layers are Pneuma-native — they're how an *agent* thinks about a project, not how a Pixar storyboard artist arranges paper. They happen to map cleanly onto pro pre-production conventions (which is good — it means film-literate users find the output familiar) but the artifacts produced are JSON, markdown, and individual asset files, not a single hand-drawn page.

## When to design at this depth

| Brief shape | Design depth |
|---|---|
| "make a 4s panda rolling over" | None — just generate. Single shot, no narrative. |
| "make a 10s opening for my podcast" | Light — palette + tone tag + 2–3 panels. |
| "make a 30s mini-story with a chef" | Full — all 5 layers + 6–10 panels. Worked example below. |
| "make a 60s ad with a recurring character across scenes" | Full + character sheet first (see `references/character-consistency.md`) |

If you're not sure, ask: "do you want me to design a quick few-panel version, or write a full pre-production brief first?" Most users will say light; the full version is for ambitious projects where the cost of an unguided seedance run would dwarf the cost of pre-production thinking.

## The five layers, with templates

### 1. Project metadata

A one-block YAML-ish header at the top of your design notes:

```
TITLE: <project name>
FORMAT: 16:9 / 9:16 / 1:1
DURATION: ~Ns
TONE: <2–4 adjectives, ideally with one tension — "fast, playful, musical mischief"; "calm, contemplative, slightly melancholy">
SHOT NUMBERING: 1.1.1, 1.1.2, … (scene.beat.panel)
```

Numbering matters — it gives every panel a stable, citable id (`1.1.4`) you can use in chat: "let me re-do 1.1.4". Stick with it across sessions.

### 2. Flow intention

A single-sentence emotional metaphor + a per-panel breath/beat label.

The Remy & Linguini sample uses **breath as the metaphor**: "Each action is a breath. Move with awareness, like a dance." Then each panel is labeled `Inhale.` or `Exhale.` Pick a metaphor that suits your project — "breath" for meditative cooking, "heartbeat" for a romance, "footsteps" for a journey, "page turns" for a writer's day, etc. The metaphor should be one sentence and shape every later choice.

Per-panel labels: 2–4 words. "Inhale. Center. Calm mind." / "Exhale. Spark. Ignite."

### 3. Camera grammar (the pacing arc)

A 1–3 line description of how the camera evolves across the timeline. Common arcs:

- **Intimate → energetic → harmonious**: "Start close for intimacy, open up for energy. Use low angles for fire & power. End wide with harmony & gratitude." (Remy & Linguini)
- **Wide → close → wide** (the classic establish/pursue/release)
- **Static → motion → static** (settling → action → resolution)
- **Low → high → eye-level** (subordinate → dominant → equal)

Per-panel shot type: `CLOSE-UP` / `MEDIUM WIDE` / `WIDE` / `WIDE/LOW ANGLE` / `OVERHEAD` / `SIDE PROFILE` / `TWO-SHOT` / `EXTREME CLOSE-UP`. Bake this into every sketch prompt.

### 4. Color palette

3–5 named swatches, each with: visual color description + mood label.

Example (Remy & Linguini "Kitchen Moments"):
- Warm Fire — red-orange
- Earthy Food — brown
- Soft Steam — gray
- Metal Kitchen — dark slate
- Natural Herbs — sage green

Each panel should explicitly cite which palette colors dominate it. Sketches don't carry color (they're black-and-white line art) but the *anchor* generation in Stage 3 absolutely should — and the consistency comes from naming the palette upfront.

For ClipCraft's planning sketches: still document the palette. It informs anchor prompts later and keeps the user oriented.

### 5. Character design + casting

For each recurring human / creature character:

```
NAME: <character name>
ARCHETYPE: <2-3 traits — "Focused. Disciplined. Mindful.">
CASTING REFERENCE: <real-world actor whose face / build / energy you're modeling>
AGE / HEIGHT (optional): <if relevant>
KEY SIGNATURE: <one visual detail that should never change — "always wears a leather apron"; "round wire-rim glasses"; "salt-and-pepper beard">
```

Generate a **character sheet** before any panel that includes the character (see `references/character-consistency.md` — the photo-body / sketch-head 16:9 sheet workflow for photoreal humans). Reference the same sheet across all subsequent panels and anchor generations.

For non-photoreal characters (animated, stylized), generate a 4-panel pose sheet (front / 3/4 / side / detail) at fixed style and reference that everywhere.

## Per-panel template

Every panel in your shot list:

```
<NN>  <SHOT TYPE>           "<short evocative title>"
       <Inhale|Exhale|beat>  
       Camera: <angle / framing detail>
       Action: <one sentence — subject + verb + key detail>
       Mood: <palette colors that dominate, 1-2 named tags>
       Character: <which character sheet, if any>
```

Worked example (Remy & Linguini panel 06):

```
06    WIDE / LOW ANGLE       "Flow with Fire"
       Exhale. Power. Heat.
       Camera: low angle from the burner level, both chefs framed against the flame
       Action: both chefs working over open flame, arms moving in tandem
       Mood: Warm Fire dominates, Metal Kitchen as silhouette
       Character: Young Chef + Big Chef (both on sheet)
```

## Translating panels into sketch generation prompts

The skill workflow's `--style sketch` invocation should now be **multi-line, derived from the panel template**, not a single sentence. Format:

```
"<SHOT TYPE> of <action sentence>. Camera: <angle>. Featuring <character refs if any>.
Tone: <palette tags + tone>. Style: clean black-and-white pencil sketch, line art."
```

Example prompt for panel 06:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "WIDE LOW-ANGLE shot of two chefs working over an open flame, arms moving in tandem.
   Camera: low angle from burner level, framing the flames between them.
   Featuring The Young Chef (focused, disciplined, Timothée-Chalamet build, leather apron)
   and The Big Chef (grounded, warm-hearted, Zach-Galifianakis build, beard).
   Mood: warm fire (red-orange) dominates, metal kitchen as cool silhouette.
   Style: pre-production storyboard pencil sketch." \
  --style sketch --aspect-ratio 16:9 \
  --output-dir assets/sketches \
  --filename-prefix shot-06
```

Notice this is dramatically richer than `"chefs cooking near a fire"`. Every layer above shows up. Cost is identical (~$0.01).

## Delivery options

The 设定 + 分镜 design always exists in **structured form** (markdown notes, JSON metadata on Assets, rich per-panel prompts). The question is whether to ALSO produce a human-friendly **summary artifact** the user can scroll / share / mood-board with. Three levels:

### A — Structured-only (default for short projects, ≤4 panels)

设定 lives in a `storyboard.md` doc next to `project.json`; per-panel prompts carry the rich context inline; sketches go straight to previewFrames. The user sees the timeline strip + draft export. No additional artifact. Lowest cost, fastest iteration.

### B — Structured + sectioned summary (default for medium projects, 5–8 panels)

Same as A plus: agent emits a markdown summary in chat with the full 设定 + shot list as a foldable block, so the user can read the plan before approving the sketch run. No image artifact. Costs nothing extra; just discipline.

### C — Structured + composite "storyboard page" image (ambitious projects, 8+ panels or multi-character)

Same as B plus: agent generates a **single composite image** of the full storyboard page (title bar, panel grid, side notes panel, palette swatches, character casting card) as a one-shot creative artifact. The user gets a paper-document-feel deliverable for review, mood-boarding, or sharing.

Important: **the composite image is a presentation surface, not the source of truth.** The agent has already designed the storyboard structurally; the image just renders that design in pre-production-page form. Don't generate the image first and try to derive the design from it.

Sketch prompt for the composite (adapt to your project):

```
A hand-drawn animation storyboard page on cream/off-white paper, titled "<TITLE>: <SCENE>" in handwritten capital letters at the top left. The layout is a professional pre-production document with <N> numbered storyboard panels arranged in a <ROWS>x<COLS> grid on the right two-thirds of the page.

Left side panel: NOTES / FLOW INTENTIONS — "<your flow metaphor sentence>". CAMERA / STORY NOTES — "<your camera arc>". COLOR PALETTE — <N> colored swatches in crosshatched pencil/crayon style: <palette list>.

Each numbered panel: pencil sketch + handwritten capital-letter title + Inhale/Exhale beat label + camera annotation + brief action text. Red ink frame borders around each panel. Blue arrow annotations between panels for camera flow. <If characters: include photorealistic 3D character renders inset on the right with casting card>.

Bottom right: "PAGE 1 OF <N>"

Style: Mixed media — loose graphite/pencil sketches with red ink frame borders, blue arrow annotations, handwritten capital-letter notes. Authentic film pre-production document feel, clean white background, slight paper texture.
```

Cost: ~$0.10 for the page image + the usual per-panel cost.

#### Future: split-from-composite

A planned engineering utility (`scripts/split-storyboard-page.mjs`, not yet shipped) will take a generated composite + a grid descriptor (`{ cols, rows, marginTopPx, marginLeftPx, panelW, panelH }`) and emit per-panel PNG crops + a character-card crop, registering each as its own image asset. That would let Option C double-duty: produce the human-friendly composite AND seed the per-panel previewFrames in one generation pass. Until that lands, Option C is presentation-only and per-panel sketches are still generated independently.

## Worked example — minimal and full versions

### Minimal: 4-beat attic morning routine (8 seconds)

```
TITLE: Attic Morning
FORMAT: 16:9
DURATION: 8s
TONE: calm, contemplative, slightly nostalgic
SHOT NUMBERING: 1.1.1 to 1.1.4
FLOW INTENTION: "Each action is a breath of attention. The room wakes up with the writer."

CAMERA ARC: Establish wide → narrow to intimate hands → settle into work
COLOR PALETTE:
  - Golden Honey (warm afternoon light)
  - Tobacco Wood (the desk, books, old leather)
  - Sage Green (plants, fountain pen ink)

PANELS:
  1.1.1  WIDE                   "Threshold"          Inhale. Arrive.
         Camera: eye-level, dormer window backlight
         Action: the studio, empty, sunlight pooling on the desk
         Mood: Golden Honey + Tobacco Wood
  
  1.1.2  CLOSE-UP                "First Warmth"      Exhale. Reach.
         Camera: over-the-shoulder, hand foreground
         Action: hand reaches for the ceramic mug
         Mood: Golden Honey
  
  1.1.3  MEDIUM CLOSE             "Open Page"        Inhale. Settle.
         Camera: slightly downward at desk level
         Action: open notebook with fountain pen mid-stroke
         Mood: Tobacco Wood + Sage Green (ink)
  
  1.1.4  WIDE / OVERHEAD          "Workspace"        Exhale. Begin.
         Camera: high overhead, full desk + chair
         Action: full desk in working order — laptop, papers, plants
         Mood: All three palette anchors visible
```

This is what you'd write before generating any sketches. Each panel becomes a `--style sketch` invocation with the template-derived rich prompt above.

### Full reference example

A real-world Pixar pre-production page (Remy & Linguini "Kitchen Moments", 12 panels in a 4×3 grid + character casting card + flow intention + camera notes + 5-swatch palette) was the inspiration for thinking about Option C. Don't slavishly copy its visual format — Pneuma is generating structured project state, not paper documents. But the sample's *layered design* is exactly what's worth copying: every panel cites the metadata, the flow intention, and the characters, so the storyboard reads as one coherent piece.

The Pneuma equivalent of that sample's depth: ~12 entries in `storyboard.md`, each fitting the panel template above; one character sheet PNG per recurring character; one palette swatch image (or just the markdown swatch list); per-panel sketches placed at beat times on the timeline. Optional: a single composite render via Option C.

## Workflow integration

When the user gives a multi-shot brief:

1. **Reply with a written design pass first** (the YAML-ish header + flow intention + camera arc + palette + per-panel template). Don't generate any image yet.
2. **Confirm with the user**: "this is the plan. Adjust anything before I generate?"
3. **(Optional) Generate the full pre-production page** if Option C is requested or the project warrants it.
4. **Generate per-panel sketches** using the rich template-derived prompts.
5. **Place each sketch on the timeline** as a previewFrame at its beat time.
6. **Draft export** so the user can scrub.
7. **Iterate per panel as needed** (regenerate, reposition, swap fidelity).
8. **Promote to anchors** at gen boundaries when the storyboard is approved.
9. **Run seedance** per the standard `storyboard-workflow.md` flow.

Steps 1–2 are the difference between "pile of disconnected sketches" and "designed storyboard". Don't skip them.

## Pitfalls

- **Generating before designing** — agent jumps to `--style sketch` invocations without writing the brief first. Result: sketches drift in style, characters look different per panel, the user doesn't know what they're reviewing. Always write the design pass first.
- **Forgetting to cite the palette / character / shot type in the sketch prompt** — the design layers exist in your notes but not in the gpt-image-2 prompt. Re-read every sketch prompt before invocation: does it carry the panel template's full context?
- **Treating shot numbers as ornamental** — they're load-bearing. Use `1.1.4` consistently in chat references, asset metadata, file naming, and locator card labels so the user can say "regen 1.1.4" and you know exactly what they mean.
- **Skipping the full-page brief on ambitious projects** — for 30s+ multi-shot work, the $0.10 spent on Option C pays itself back in coherence. Skip it on short single-beat work.

## See also

- `references/storyboard-workflow.md` — the mechanical workflow (commands, JSON edits, fidelity stages, draft exports)
- `references/character-consistency.md` — character sheet for photoreal humans
- `references/craft.md` — broader video craft principles
