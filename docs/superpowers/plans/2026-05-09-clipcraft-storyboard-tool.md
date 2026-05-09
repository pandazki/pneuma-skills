# `storyboard.mjs` — compose-and-slice tool implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `modes/_shared/scripts/storyboard.mjs` — a CLI tool
that generates a single composite storyboard image via gpt-image-2,
then slices it into N individual panel images via ffmpeg, emitting
JSON metadata for the agent to register in `project.json`. This is
the engine layer for Path C (see
`modes/clipcraft/skill/references/storyboard-workflow.md`).

**Architecture:**

1. CLI parses `--aspect`, `--panels`, `--prompt|--prompt-file`,
   `--out-dir`, `--name`, `--ref` (repeatable), `--no-annotations`,
   `--keep-composite`.
2. Pure helper module computes grid layout (rows × cols) from
   `panels` + video aspect. 8 panels follows video orientation
   (4×2 for 16:9, 2×4 for 9:16). All layouts:
   `4=2×2, 6=3×2 or 2×3, 8=4×2 or 2×4, 9=3×3, 12=4×3 or 3×4,
    16=4×4`. Reject non-grid panel counts (5/7/10/11/13/14/15).
3. gpt-image-2 size selector picks the closest
   {1024×1024, 1024×1536, 1536×1024} for the chosen grid.
4. Bbox computation: each cell = exact video aspect (so panel slices
   match the target video aspect ratio). Composite has uniform inner
   padding around the grid; cells are uniformly sized; outer
   margins absorb the gpt-image-2 size mismatch.
5. Prompt assembly: prelude (grid + annotation color system +
   faithfulness directive) + user prompt body. `--no-annotations`
   removes the color-system block.
6. fal.ai gpt-image-2 call (queue API; same pattern as
   `generate_image.mjs`). Refs become `image_urls` for the edit
   endpoint when at least one is provided; otherwise t2i.
7. ffmpeg crop (one `-vf crop=W:H:X:Y` invocation per panel).
8. Stdout JSON: `{ composite, grid, panels[], finalPrompt,
   suggestedAssets, suggestedProvenance }`. Stderr: progress logs.

**Tech Stack:** Node.js (Bun-compatible), zero runtime deps. ffmpeg
shelled out via `child_process.spawnSync`. Tests via `bun:test`.

**No project.json mutation.** The agent reads stdout JSON and
decides what to register / place. This stays consistent with how
`generate_image.mjs` works today.

**Reuse policy:** copy-paste the env-loading and `falSubscribe`
helpers from `generate_image.mjs` into `storyboard.mjs`. Do NOT
extract a shared module — keeps blast radius zero and matches the
"each script is self-contained" pattern of `_shared/scripts/`.

---

## File structure

- **Create:** `modes/_shared/scripts/storyboard.mjs`
  - All logic in one file (~400-500 LOC). Pure helpers exported via
    `export` so tests can import them.
- **Create:** `modes/_shared/scripts/__tests__/storyboard.test.ts`
  - Unit tests for grid layout, gpt-image-2 size selection, bbox
    computation, prompt assembly. NO API calls, NO ffmpeg shell-outs.
- **No changes** to `modes/clipcraft/manifest.ts` — the script is
  picked up automatically through the `_shared/scripts` mechanism
  (already declared in `sharedScripts`).

Wait — read `modes/clipcraft/manifest.ts` and check the
`sharedScripts` array. Currently it lists `["generate_image.mjs",
"edit_image.mjs"]`. Add `"storyboard.mjs"` to that array as part of
this work. (Tiny manifest edit.)

---

## Task 1: file skeleton + CLI argument parsing

**Files:**
- Create: `modes/_shared/scripts/storyboard.mjs`

- [ ] **Step 1:** Create the file with shebang, imports, and CLI
  arg parser using `parseArgs` from `node:util`. Export nothing
  yet — top-level await execution.

```javascript
#!/usr/bin/env node
/**
 * storyboard.mjs — compose-and-slice tool for ClipCraft Path C.
 *
 * Generates a composite N-cell storyboard image via gpt-image-2,
 * then slices it into N individual panel files via ffmpeg.
 *
 * See modes/clipcraft/skill/references/storyboard-workflow.md
 * (Path C section) for the conceptual workflow.
 *
 * Zero external deps — Node.js / Bun built-in APIs only. ffmpeg
 * must be available on PATH for slicing.
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASPECTS = ["9:16", "16:9", "1:1"];
const PANEL_COUNTS = [4, 6, 8, 9, 12, 16];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    aspect:           { type: "string" },
    panels:           { type: "string" },
    prompt:           { type: "string" },
    "prompt-file":    { type: "string" },
    "out-dir":        { type: "string", default: "." },
    name:             { type: "string", default: "panel" },
    ref:              { type: "string", multiple: true },
    "no-annotations": { type: "boolean", default: false },
    "keep-composite": { type: "boolean", default: true },
    quality:          { type: "string", default: "high" },
    "output-format":  { type: "string", default: "png" },
    help:             { type: "boolean", short: "h" },
  },
  allowPositionals: false,
});

if (values.help) { /* print usage to stderr, exit 0 */ }

// validate required: aspect, panels, (prompt OR prompt-file)
// validate panels is in PANEL_COUNTS
// validate aspect in ASPECTS
```

- [ ] **Step 2:** Print clear usage on `--help` or missing required
  flags. Exit 1 on missing required, 0 on `--help` requested.

- [ ] **Step 3:** Resolve prompt: if `--prompt-file`, read it; else
  use `--prompt`. Error if both missing.

- [ ] **Step 4:** Commit the skeleton.

```bash
git add modes/_shared/scripts/storyboard.mjs
git commit -m "feat(clipcraft scripts): storyboard.mjs skeleton + CLI parsing"
```

---

## Task 2: grid layout helper + tests

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs` (add exported function)
- Create: `modes/_shared/scripts/__tests__/storyboard.test.ts`

- [ ] **Step 1:** Write the failing test first. Create
  `__tests__/storyboard.test.ts` and import `pickGrid` from the
  storyboard module (won't exist yet — will fail import).

```typescript
import { describe, expect, test } from "bun:test";
import { pickGrid } from "../storyboard.mjs";

describe("pickGrid", () => {
  test("4 panels → 2x2 regardless of aspect", () => {
    expect(pickGrid(4, "16:9")).toEqual({ rows: 2, cols: 2 });
    expect(pickGrid(4, "9:16")).toEqual({ rows: 2, cols: 2 });
    expect(pickGrid(4, "1:1")).toEqual({ rows: 2, cols: 2 });
  });

  test("6 panels → 3x2 for landscape, 2x3 for portrait", () => {
    expect(pickGrid(6, "16:9")).toEqual({ rows: 2, cols: 3 });
    expect(pickGrid(6, "9:16")).toEqual({ rows: 3, cols: 2 });
    expect(pickGrid(6, "1:1")).toEqual({ rows: 2, cols: 3 });
  });

  test("8 panels → 4x2 for landscape, 2x4 for portrait", () => {
    expect(pickGrid(8, "16:9")).toEqual({ rows: 2, cols: 4 });
    expect(pickGrid(8, "9:16")).toEqual({ rows: 4, cols: 2 });
  });

  test("9 panels → 3x3 always", () => {
    expect(pickGrid(9, "16:9")).toEqual({ rows: 3, cols: 3 });
    expect(pickGrid(9, "9:16")).toEqual({ rows: 3, cols: 3 });
  });

  test("12 panels → 4x3 for landscape, 3x4 for portrait", () => {
    expect(pickGrid(12, "16:9")).toEqual({ rows: 3, cols: 4 });
    expect(pickGrid(12, "9:16")).toEqual({ rows: 4, cols: 3 });
  });

  test("16 panels → 4x4 always", () => {
    expect(pickGrid(16, "16:9")).toEqual({ rows: 4, cols: 4 });
    expect(pickGrid(16, "9:16")).toEqual({ rows: 4, cols: 4 });
  });

  test("rejects unsupported panel counts", () => {
    expect(() => pickGrid(5, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(7, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(10, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(13, "16:9")).toThrow(/panel count/i);
  });

  test("rejects unknown aspect", () => {
    expect(() => pickGrid(4, "21:9")).toThrow(/aspect/i);
  });
});
```

- [ ] **Step 2:** Run test to verify it fails (import error or
  function not found):

```
bun test modes/_shared/scripts/__tests__/storyboard.test.ts
```

Expected: FAIL — `pickGrid is not defined` or import error.

- [ ] **Step 3:** Implement `pickGrid` in `storyboard.mjs`:

```javascript
const GRID_TABLE = {
  4:  { rows: 2, cols: 2 },              // square
  6:  { landscape: { rows: 2, cols: 3 }, portrait: { rows: 3, cols: 2 } },
  8:  { landscape: { rows: 2, cols: 4 }, portrait: { rows: 4, cols: 2 } },
  9:  { rows: 3, cols: 3 },              // square
  12: { landscape: { rows: 3, cols: 4 }, portrait: { rows: 4, cols: 3 } },
  16: { rows: 4, cols: 4 },              // square
};

/**
 * Pick a grid layout for the requested panel count + video aspect.
 * For aspect-flexible panel counts (6, 8, 12), grid orientation
 * matches the video orientation (16:9 → wide grid, 9:16 → tall
 * grid). For 1:1, treat as landscape.
 */
export function pickGrid(panels, aspect) {
  if (!ASPECTS.includes(aspect)) {
    throw new Error(`Unsupported aspect '${aspect}'. Choices: ${ASPECTS.join(", ")}`);
  }
  const entry = GRID_TABLE[panels];
  if (!entry) {
    throw new Error(`Unsupported panel count ${panels}. Supported: ${PANEL_COUNTS.join(", ")}`);
  }
  if (entry.rows && entry.cols) return entry;
  const orientation = aspect === "9:16" ? "portrait" : "landscape";
  return entry[orientation];
}
```

- [ ] **Step 4:** Run tests to verify they pass:

```
bun test modes/_shared/scripts/__tests__/storyboard.test.ts
```

Expected: PASS — all 7 test cases.

- [ ] **Step 5:** Commit.

```bash
git add modes/_shared/scripts/storyboard.mjs modes/_shared/scripts/__tests__/storyboard.test.ts
git commit -m "feat(clipcraft scripts): storyboard.mjs grid layout helper + tests"
```

---

## Task 3: gpt-image-2 size selection + tests

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`
- Modify: `modes/_shared/scripts/__tests__/storyboard.test.ts`

- [ ] **Step 1:** Write failing tests. Append to the test file:

```typescript
import { pickImageSize } from "../storyboard.mjs";

describe("pickImageSize", () => {
  test("portrait 9:16 video chooses 1024x1536", () => {
    expect(pickImageSize({ rows: 4, cols: 2 }, "9:16")).toEqual({
      preset: "portrait_16_9",
      width: 1024,
      height: 1536,
    });
  });

  test("landscape 16:9 video chooses 1536x1024", () => {
    expect(pickImageSize({ rows: 2, cols: 4 }, "16:9")).toEqual({
      preset: "landscape_16_9",
      width: 1536,
      height: 1024,
    });
  });

  test("1:1 video with square grid chooses 1024x1024", () => {
    expect(pickImageSize({ rows: 2, cols: 2 }, "1:1")).toEqual({
      preset: "square_hd",
      width: 1024,
      height: 1024,
    });
  });

  test("9:16 with 3x3 grid still chooses portrait", () => {
    // square grid + portrait aspect → portrait composite
    expect(pickImageSize({ rows: 3, cols: 3 }, "9:16")).toEqual({
      preset: "portrait_16_9",
      width: 1024,
      height: 1536,
    });
  });
});
```

- [ ] **Step 2:** Run tests, verify they fail.

- [ ] **Step 3:** Implement `pickImageSize` in `storyboard.mjs`:

```javascript
const IMAGE_SIZES = {
  square_hd:        { preset: "square_hd",        width: 1024, height: 1024 },
  landscape_16_9:   { preset: "landscape_16_9",   width: 1536, height: 1024 },
  portrait_16_9:    { preset: "portrait_16_9",    width: 1024, height: 1536 },
};

/**
 * Pick the gpt-image-2 output size for a chosen grid + video aspect.
 * The composite always matches the video orientation, regardless of
 * the grid's internal aspect ratio. The cells inside the composite
 * land at exact video aspect by construction (see computeBboxes).
 */
export function pickImageSize(grid, aspect) {
  if (aspect === "9:16") return IMAGE_SIZES.portrait_16_9;
  if (aspect === "16:9") return IMAGE_SIZES.landscape_16_9;
  if (aspect === "1:1")  return IMAGE_SIZES.square_hd;
  throw new Error(`Unsupported aspect '${aspect}'`);
}
```

- [ ] **Step 4:** Run tests, verify pass.

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs gpt-image-2 size selection + tests"
```

---

## Task 4: bbox computation + tests

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`
- Modify: `modes/_shared/scripts/__tests__/storyboard.test.ts`

- [ ] **Step 1:** Write failing tests:

```typescript
import { computeBboxes } from "../storyboard.mjs";

describe("computeBboxes", () => {
  test("4 panels in 2x2 grid on 1024x1024 (1:1) video", () => {
    const grid = { rows: 2, cols: 2 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "1:1");
    expect(result.cellWidth).toBe(result.cellHeight); // 1:1
    expect(result.panels).toHaveLength(4);
    // All cells should be the same size
    const cellW = result.panels[0].bbox.w;
    const cellH = result.panels[0].bbox.h;
    for (const p of result.panels) {
      expect(p.bbox.w).toBe(cellW);
      expect(p.bbox.h).toBe(cellH);
    }
    // panels numbered left-to-right top-to-bottom
    expect(result.panels[0].row).toBe(0);
    expect(result.panels[0].col).toBe(0);
    expect(result.panels[1].row).toBe(0);
    expect(result.panels[1].col).toBe(1);
    expect(result.panels[2].row).toBe(1);
    expect(result.panels[2].col).toBe(0);
    expect(result.panels[3].row).toBe(1);
    expect(result.panels[3].col).toBe(1);
  });

  test("6 panels in 3x2 grid on 1024x1024 (16:9 video)", () => {
    // 3 cols x 2 rows, each cell is 16:9
    const grid = { rows: 2, cols: 3 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "16:9");
    // Each cell aspect = 16:9 = 1.778
    for (const p of result.panels) {
      const ratio = p.bbox.w / p.bbox.h;
      expect(ratio).toBeCloseTo(16 / 9, 1);
    }
  });

  test("9:16 cells in portrait composite 1024x1536", () => {
    const grid = { rows: 4, cols: 3 };
    const imgSize = { width: 1024, height: 1536 };
    const result = computeBboxes(grid, imgSize, "9:16");
    expect(result.panels).toHaveLength(12);
    for (const p of result.panels) {
      const ratio = p.bbox.w / p.bbox.h;
      expect(ratio).toBeCloseTo(9 / 16, 1);
    }
  });

  test("panels indexed 1..N in numbering order", () => {
    const grid = { rows: 2, cols: 2 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "1:1");
    expect(result.panels.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  test("bbox coordinates are non-negative integers within image", () => {
    const grid = { rows: 3, cols: 2 };
    const imgSize = { width: 1024, height: 1536 };
    const result = computeBboxes(grid, imgSize, "9:16");
    for (const p of result.panels) {
      expect(Number.isInteger(p.bbox.x)).toBe(true);
      expect(Number.isInteger(p.bbox.y)).toBe(true);
      expect(p.bbox.x).toBeGreaterThanOrEqual(0);
      expect(p.bbox.y).toBeGreaterThanOrEqual(0);
      expect(p.bbox.x + p.bbox.w).toBeLessThanOrEqual(imgSize.width);
      expect(p.bbox.y + p.bbox.h).toBeLessThanOrEqual(imgSize.height);
    }
  });
});
```

- [ ] **Step 2:** Run tests, verify failure.

- [ ] **Step 3:** Implement `computeBboxes`. The algorithm:

  - Cell aspect = video aspect (W:H).
  - Available content area = whole image (margin = 0 for v1; gpt-
    image-2's composite includes its own gutter).
  - Compute the largest cell size that fits a `cols × rows` grid of
    that aspect inside the image:
    - `maxCellW = floor(imgW / cols)`
    - `maxCellH = floor(imgH / rows)`
    - Constrain by aspect: pick smaller of `maxCellW`,
      `maxCellH × (videoW / videoH)`.
    - Pick smaller of `maxCellH`,
      `maxCellW × (videoH / videoW)`.
    - Use `Math.floor` for both.
  - Total grid width = `cellW × cols`. Center horizontally:
    `marginX = floor((imgW - cellW × cols) / 2)`.
  - Total grid height = `cellH × rows`. Center vertically:
    `marginY = floor((imgH - cellH × rows) / 2)`.
  - For each row/col index, compute bbox:
    - `x = marginX + col × cellW`
    - `y = marginY + row × cellH`
    - `w = cellW`
    - `h = cellH`
  - Numbering: `index = row × cols + col + 1` (1-based).

```javascript
/**
 * Compute panel bounding boxes for a grid laid out inside the
 * composite image. Each cell is exact video aspect ratio. Grid is
 * centered with uniform margins absorbing any size mismatch.
 */
export function computeBboxes(grid, imgSize, aspect) {
  const [vw, vh] = aspect.split(":").map(Number);
  const cellAspect = vw / vh;

  const maxCellW = Math.floor(imgSize.width / grid.cols);
  const maxCellH = Math.floor(imgSize.height / grid.rows);

  // Cell must satisfy: cellW / cellH = cellAspect
  // Constrain by both maxCellW and maxCellH:
  let cellW = maxCellW;
  let cellH = Math.floor(cellW / cellAspect);
  if (cellH > maxCellH) {
    cellH = maxCellH;
    cellW = Math.floor(cellH * cellAspect);
  }

  const totalW = cellW * grid.cols;
  const totalH = cellH * grid.rows;
  const marginX = Math.floor((imgSize.width - totalW) / 2);
  const marginY = Math.floor((imgSize.height - totalH) / 2);

  const panels = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      panels.push({
        index: row * grid.cols + col + 1,
        row,
        col,
        bbox: {
          x: marginX + col * cellW,
          y: marginY + row * cellH,
          w: cellW,
          h: cellH,
        },
      });
    }
  }

  return { cellWidth: cellW, cellHeight: cellH, marginX, marginY, panels };
}
```

- [ ] **Step 4:** Run tests, verify pass.

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs bbox computation + tests"
```

---

## Task 5: prompt assembly + tests

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`
- Modify: `modes/_shared/scripts/__tests__/storyboard.test.ts`

- [ ] **Step 1:** Write failing tests:

```typescript
import { assemblePrompt } from "../storyboard.mjs";

describe("assemblePrompt", () => {
  test("includes grid + cell aspect + numbering instruction", () => {
    const grid = { rows: 3, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "Six dance moves",
      grid,
      aspect: "9:16",
      includeAnnotations: false,
    });
    expect(out).toMatch(/3.{1,3}rows/i);
    expect(out).toMatch(/2.{1,3}col/i);
    expect(out).toMatch(/9:16/);
    expect(out).toMatch(/1.{0,5}6/); // numbering
    expect(out).toMatch(/Six dance moves/);
  });

  test("includes annotation color system when enabled", () => {
    const grid = { rows: 2, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "x",
      grid,
      aspect: "1:1",
      includeAnnotations: true,
    });
    expect(out).toMatch(/red/i);
    expect(out).toMatch(/blue/i);
    expect(out).toMatch(/green/i);
    expect(out).toMatch(/orange/i);
    expect(out).toMatch(/purple/i);
    expect(out).toMatch(/black/i);
  });

  test("excludes annotations when disabled", () => {
    const grid = { rows: 2, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "x",
      grid,
      aspect: "1:1",
      includeAnnotations: false,
    });
    // No "annotation color system" preamble
    expect(out).not.toMatch(/annotation color system/i);
    // But the basic grid prelude should still be there
    expect(out).toMatch(/CONSISTENCY RULE/i);
  });

  test("includes faithfulness and consistency directives by default", () => {
    const out = assemblePrompt({
      userPrompt: "x",
      grid: { rows: 2, cols: 2 },
      aspect: "1:1",
      includeAnnotations: false,
    });
    expect(out).toMatch(/CONSISTENCY RULE.*STRICT/i);
  });
});
```

- [ ] **Step 2:** Run tests, verify failure.

- [ ] **Step 3:** Implement `assemblePrompt`:

```javascript
const ANNOTATION_BLOCK = `
Annotations baked into each panel use this color vocabulary:
  - RED solid arrows: body movement / posture changes
  - BLUE dashed arrows: camera movement / framing arcs
  - GREEN brackets: key framing intersections (rule of thirds)
  - ORANGE sun-ray glyphs: lighting source + shadow direction
  - PURPLE eighth-note glyphs: emotional / musical beat markers
  - BLACK typewriter margin notes: lens / technical specs
Annotations should be visually clear without obscuring the subject.
`.trim();

/**
 * Assemble the final prompt: grid prelude + (optional annotation
 * color system) + faithfulness directive + user's per-panel content.
 */
export function assemblePrompt({ userPrompt, grid, aspect, includeAnnotations }) {
  const N = grid.rows * grid.cols;
  const orientation = aspect === "9:16" ? "portrait" : aspect === "16:9" ? "landscape" : "square";
  const lines = [
    `A clean storyboard sheet, ${grid.rows} rows by ${grid.cols} columns of numbered panels (${N} total).`,
    `Each cell is exactly ${aspect} aspect ratio (the target video aspect ratio). Composite orientation: ${orientation}.`,
    `Panels numbered 1 through ${N}, left-to-right top-to-bottom. Thin gutter between cells, neutral background.`,
    "",
  ];

  if (includeAnnotations) {
    lines.push(ANNOTATION_BLOCK, "");
  }

  lines.push(
    "CONSISTENCY RULE (STRICT): Character look, wardrobe, palette, and lighting language remain identical across all panels. No reinterpretation panel-to-panel.",
    "",
    "Per-panel content:",
    "",
    userPrompt,
  );

  return lines.join("\n");
}
```

- [ ] **Step 4:** Run tests, verify pass.

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs prompt assembly + tests"
```

---

## Task 6: env loading + falSubscribe (copied from generate_image.mjs)

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`

- [ ] **Step 1:** Copy the following functions verbatim from
  `modes/_shared/scripts/generate_image.mjs` into `storyboard.mjs`:
  - `findEnvFile` (lines 24-39)
  - `loadEnvKeys` (lines 41-71)
  - `falSubscribe` (lines 119-180)
  - `downloadFalImages` (lines 182-203, but **rename** the
    file-saving logic — for storyboard.mjs, only one image is
    downloaded — the composite — and saved to a fixed name
    `composite.<format>`)

  Adapt `downloadFalImages` to a simpler `downloadComposite`:

```javascript
async function downloadComposite(result, outputFormat, outputDir, tag) {
  mkdirSync(outputDir, { recursive: true });
  const images = Array.isArray(result.images) ? result.images : [];
  if (images.length === 0) {
    console.error(`ERROR: fal.ai returned no images for ${tag}`);
    process.exit(1);
  }
  const url = images[0].url;
  const filepath = join(outputDir, `composite.${outputFormat}`);
  const imgResp = await fetch(url);
  if (!imgResp.ok) {
    console.error(`ERROR: download failed ${imgResp.status} for ${url}`);
    process.exit(1);
  }
  writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
  console.error(`[${tag}] composite saved: ${filepath}`);
  return { filepath, url };
}
```

- [ ] **Step 2:** Add `generateComposite()` that wraps the
  fal.ai call:

```javascript
async function generateComposite({
  apiKey, finalPrompt, imageSize, refs, quality, outputFormat, outputDir,
}) {
  const isEdit = Array.isArray(refs) && refs.length > 0;
  const appId = isEdit ? "openai/gpt-image-2/edit" : "openai/gpt-image-2";
  const tag = isEdit ? "fal:gpt-image-2/edit" : "fal:gpt-image-2";

  const payload = {
    prompt: finalPrompt,
    num_images: 1,
    quality,
    output_format: outputFormat,
    image_size: imageSize.preset,
  };
  if (isEdit) {
    // Resolve refs to URLs. For local file paths, would need uploading;
    // for v1, accept HTTP/data URLs only and error on file:// or local
    // paths to keep the script simple. The agent can use base64 data
    // URLs or pre-uploaded URLs.
    payload.image_urls = refs;
  }

  const result = await falSubscribe({ apiKey, appId, payload, tag });
  const { filepath, url } = await downloadComposite(result, outputFormat, outputDir, tag);
  return { compositePath: filepath, compositeUrl: url, endpoint: appId };
}
```

  **Important:** the `--ref` argument accepts local file paths in
  the CLI for ergonomics, but `generateComposite` only supports
  remote URLs. Add a CLI-time validation step that errors if any
  `--ref` is a local path — directing the user to upload the ref
  first. (Future work: auto-upload via fal.ai's storage endpoint.
  Out of scope for v1.)

- [ ] **Step 3:** Manually validate by importing into Node REPL or
  running the script with `--help`. No automated test for this step.

- [ ] **Step 4:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs env loading + fal.ai gpt-image-2 call"
```

---

## Task 7: ffmpeg slicing

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`

- [ ] **Step 1:** Add `sliceComposite()` that runs one
  `ffmpeg crop` invocation per panel:

```javascript
function sliceComposite({ compositePath, panels, outputDir, baseName, format }) {
  const slices = [];
  for (const panel of panels) {
    const filename = `${baseName}-${String(panel.index).padStart(2, "0")}.${format}`;
    const outPath = join(outputDir, filename);
    const { x, y, w, h } = panel.bbox;
    const args = [
      "-y",
      "-i", compositePath,
      "-vf", `crop=${w}:${h}:${x}:${y}`,
      "-frames:v", "1",
      outPath,
    ];
    const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    if (res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString() : "";
      console.error(`ERROR: ffmpeg crop failed for panel ${panel.index}:\n${stderr}`);
      process.exit(1);
    }
    console.error(`[slice] panel ${panel.index} → ${outPath}`);
    slices.push({ ...panel, path: outPath });
  }
  return slices;
}
```

- [ ] **Step 2:** Verify ffmpeg is available before slicing. Add
  a precheck:

```javascript
function ensureFfmpeg() {
  const res = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (res.status !== 0) {
    console.error("ERROR: ffmpeg not found on PATH. Install ffmpeg.");
    process.exit(1);
  }
}
```

  Call `ensureFfmpeg()` once near startup (after parsing args, before
  the network call).

- [ ] **Step 3:** No automated tests for ffmpeg integration (would
  require a fixture image + ffmpeg binary). Manual smoke test in
  Task 9.

- [ ] **Step 4:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs ffmpeg slicing"
```

---

## Task 8: stdout JSON output

**Files:**
- Modify: `modes/_shared/scripts/storyboard.mjs`

- [ ] **Step 1:** Add `buildStdoutJson()`:

```javascript
function buildStdoutJson({
  compositePath, compositeUrl, endpoint, grid, imageSize,
  finalPrompt, panels, refs, baseName, aspect, panelCount,
}) {
  const compositeAssetId = `asset-storyboard-composite-${Date.now()}`;
  const compositeAsset = {
    id: compositeAssetId,
    type: "image",
    uri: compositePath,
    name: `Storyboard composite (${grid.rows}x${grid.cols})`,
    metadata: {
      width: imageSize.width,
      height: imageSize.height,
      grid,
      panelCount,
      videoAspect: aspect,
    },
    tags: ["storyboard", "composite"],
    status: "ready",
    createdAt: Date.now(),
  };

  const compositeProvenance = {
    toAssetId: compositeAssetId,
    fromAssetId: null,
    operation: {
      type: "generate",
      actor: "agent",
      agentId: "claude-clipcraft-storyboard",
      timestamp: Date.now(),
      params: {
        model: "gpt-image-2",
        provider: "fal.ai",
        endpoint,
        prompt: finalPrompt,
        imageSize: imageSize.preset,
        imageUrls: refs ?? [],
        quality: "high",
        videoAspect: aspect,
        grid,
        panelCount,
      },
    },
  };

  const sliceAssets = panels.map((p) => ({
    id: `asset-${baseName}-${String(p.index).padStart(2, "0")}`,
    type: "image",
    uri: p.path,
    name: `Panel ${p.index}`,
    metadata: {
      fidelity: "sketch",  // default fidelity; agent can override
      width: p.bbox.w,
      height: p.bbox.h,
      panelIndex: p.index,
      row: p.row,
      col: p.col,
    },
    tags: ["storyboard", "panel"],
    status: "ready",
    createdAt: Date.now(),
  }));

  const sliceProvenance = panels.map((p, i) => ({
    toAssetId: sliceAssets[i].id,
    fromAssetId: compositeAssetId,
    operation: {
      type: "slice",
      actor: "agent",
      agentId: "claude-clipcraft-storyboard",
      timestamp: Date.now(),
      params: {
        tool: "ffmpeg",
        bbox: p.bbox,
        row: p.row,
        col: p.col,
        index: p.index,
      },
    },
  }));

  return {
    composite: { path: compositePath, url: compositeUrl, assetId: compositeAssetId },
    grid,
    imageSize: imageSize.preset,
    videoAspect: aspect,
    panelCount,
    panels: panels.map((p, i) => ({
      index: p.index,
      row: p.row,
      col: p.col,
      bbox: p.bbox,
      path: p.path,
      assetId: sliceAssets[i].id,
    })),
    finalPrompt,
    suggestedAssets: [compositeAsset, ...sliceAssets],
    suggestedProvenance: [compositeProvenance, ...sliceProvenance],
  };
}
```

- [ ] **Step 2:** Wire it all together in the main top-level
  `await` block:

```javascript
ensureFfmpeg();
const keys = loadEnvKeys();
if (!keys.FAL_KEY) {
  console.error("ERROR: FAL_KEY not found");
  process.exit(1);
}

const grid = pickGrid(panelCount, aspect);
const imageSize = pickImageSize(grid, aspect);
const finalPrompt = assemblePrompt({
  userPrompt, grid, aspect, includeAnnotations: !values["no-annotations"],
});

const outDir = resolve(values["out-dir"]);
mkdirSync(outDir, { recursive: true });

console.error(`[storyboard] grid=${grid.rows}x${grid.cols}, image=${imageSize.preset}, panels=${panelCount}`);

const composite = await generateComposite({
  apiKey: keys.FAL_KEY,
  finalPrompt,
  imageSize,
  refs: values.ref ?? [],
  quality: values.quality,
  outputFormat: values["output-format"],
  outputDir: outDir,
});

const { panels } = computeBboxes(grid, imageSize, aspect);
const slices = sliceComposite({
  compositePath: composite.compositePath,
  panels,
  outputDir: outDir,
  baseName: values.name,
  format: values["output-format"],
});

const out = buildStdoutJson({
  compositePath: composite.compositePath,
  compositeUrl: composite.compositeUrl,
  endpoint: composite.endpoint,
  grid, imageSize, finalPrompt,
  panels: slices,
  refs: values.ref ?? [],
  baseName: values.name,
  aspect, panelCount,
});

if (!values["keep-composite"]) {
  // delete composite file
  // (using rmSync, also remove the metadata block from suggestedAssets)
  // … out-of-scope for v1; default keepComposite=true
}

console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 3:** Add a JSON-shape integration test. Mock the API
  call (see snippet below) and validate the JSON output structure
  is correct without hitting the network:

```typescript
import { buildStdoutJson } from "../storyboard.mjs";

describe("buildStdoutJson", () => {
  test("structure matches contract", () => {
    const out = buildStdoutJson({
      compositePath: "/tmp/sb/composite.png",
      compositeUrl: "https://example.com/composite.png",
      endpoint: "openai/gpt-image-2",
      grid: { rows: 2, cols: 2 },
      imageSize: { preset: "square_hd", width: 1024, height: 1024 },
      finalPrompt: "test prompt",
      panels: [
        { index: 1, row: 0, col: 0, bbox: { x: 0, y: 0, w: 512, h: 512 }, path: "/tmp/sb/panel-01.png" },
        { index: 2, row: 0, col: 1, bbox: { x: 512, y: 0, w: 512, h: 512 }, path: "/tmp/sb/panel-02.png" },
        { index: 3, row: 1, col: 0, bbox: { x: 0, y: 512, w: 512, h: 512 }, path: "/tmp/sb/panel-03.png" },
        { index: 4, row: 1, col: 1, bbox: { x: 512, y: 512, w: 512, h: 512 }, path: "/tmp/sb/panel-04.png" },
      ],
      refs: [],
      baseName: "panel",
      aspect: "1:1",
      panelCount: 4,
    });

    expect(out.composite.assetId).toBeTruthy();
    expect(out.panels).toHaveLength(4);
    expect(out.panels[0].assetId).toBeTruthy();
    expect(out.panels[0].assetId).toContain("panel-01");
    expect(out.suggestedAssets).toHaveLength(5); // 1 composite + 4 panels
    expect(out.suggestedProvenance).toHaveLength(5);

    // Composite has fromAssetId: null
    expect(out.suggestedProvenance[0].fromAssetId).toBeNull();
    // Slices have fromAssetId pointing at composite
    expect(out.suggestedProvenance[1].fromAssetId).toBe(out.composite.assetId);
    expect(out.suggestedProvenance[1].operation.type).toBe("slice");
    expect(out.suggestedProvenance[1].operation.params.bbox).toBeTruthy();

    // Final prompt is preserved
    expect(out.finalPrompt).toBe("test prompt");
  });
});
```

- [ ] **Step 4:** Run all tests, verify pass.

```
bun test modes/_shared/scripts/__tests__/storyboard.test.ts
```

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(clipcraft scripts): storyboard.mjs stdout JSON output + integration test"
```

---

## Task 9: register storyboard.mjs in clipcraft manifest

**Files:**
- Modify: `modes/clipcraft/manifest.ts`

- [ ] **Step 1:** Add `"storyboard.mjs"` to the `sharedScripts`
  array:

```typescript
sharedScripts: ["generate_image.mjs", "edit_image.mjs", "storyboard.mjs"],
```

- [ ] **Step 2:** Re-run mode tests to confirm no regression:

```
bun test modes/clipcraft
```

Expected: all 134 tests still pass.

- [ ] **Step 3:** Commit.

```bash
git commit -am "feat(clipcraft): register storyboard.mjs in shared scripts"
```

---

## Task 10: smoke test (manual, requires FAL_KEY)

**Files:** none (manual test only)

- [ ] **Step 1:** Set up a temp workspace:

```bash
mkdir -p /tmp/sb-smoke
cd /tmp/sb-smoke
```

- [ ] **Step 2:** Write a simple prompt file:

```
PANEL 1: A panda waking up in a sunlit attic.
PANEL 2: Panda stretches arms wide.
PANEL 3: Panda sips coffee at a desk.
PANEL 4: Panda starts typing on laptop, satisfied smile.
```

- [ ] **Step 3:** Invoke storyboard.mjs:

```bash
FAL_KEY=$YOUR_FAL_KEY \
  node /Users/pandazki/Codes/pneuma-skills/.claude/worktrees/clipcraft-enhance/modes/_shared/scripts/storyboard.mjs \
    --aspect 16:9 \
    --panels 4 \
    --prompt-file /tmp/sb-smoke/prompt.md \
    --out-dir /tmp/sb-smoke/out \
    --name panda
```

- [ ] **Step 4:** Verify outputs:
  - `composite.png` exists in `/tmp/sb-smoke/out/`, ~1024x1024
  - `panda-01.png` through `panda-04.png` exist
  - Each panel slice has correct aspect ratio (~16:9 ≈ 1.78)
  - Stdout JSON includes 1 composite asset + 4 panel assets, 5
    provenance edges total
  - `finalPrompt` is the assembled prompt with grid prelude +
    annotation block + faithfulness directive + user prompt

- [ ] **Step 5:** If smoke test passes, mark Task 10 complete.

- [ ] **Step 6:** No git changes from smoke test.

---

## Self-Review (run after all tasks complete)

- [ ] Spec coverage: every CLI flag named in the
  storyboard-workflow.md Path C section actually works.
- [ ] No placeholders in the script.
- [ ] All exported function signatures match the test imports.
- [ ] `bun test modes/_shared/scripts` passes.
- [ ] `bun test modes/clipcraft` passes.
- [ ] Manual smoke test produces a real composite + 4 slices.
- [ ] Stdout JSON shape matches the storyboard-workflow.md
  contract (composite asset id, panel asset ids, suggestedAssets
  + suggestedProvenance arrays).
