# Kami Mode — Design Spec

**Date:** 2026-04-22
**Status:** Draft, awaiting user approval
**Branch:** `feat/kami-mode` (to be created)
**Target version:** 2.31.0

## 1. Goal

Add a new independent builtin mode, `kami`, that delivers the "paper aesthetic" of [tw93/kami](https://github.com/tw93/kami) inside Pneuma's live-preview workspace. It is **paper-canvas webcraft**: webcraft-style freedom to edit HTML / CSS / JS, but the viewer is locked to a single paper dimension chosen at creation time and the seed content is pre-styled with kami's design tokens.

Out of scope: kami's slide templates (`slides.py` / `slides-en.py`), PDF build verification pipeline (`scripts/build.py`), porting kami-as-typesetter wholesale. Slides will get the paper aesthetic in a later change to `slide` mode — explicitly excluded here.

## 2. Positioning

- Not a variant of `webcraft`. A **separate builtin mode** registered alongside it.
- Not a replacement for any existing mode.
- Design language: **adapted** from kami under MIT license. Credit is surfaced in manifest description, claudeMdSection, NOTICE file, and each ported reference file.

## 3. User-facing behavior

### 3.1 Creation flow

1. Launcher → "Built-in Modes" → Kami → **New Workspace**.
2. Launcher prompts two init params:
   - **Paper size** (select): `A4` / `A5` / `A3` / `Letter` / `Legal`. Default `A4`.
   - **Orientation** (select): `Portrait` / `Landscape`. Default `Portrait`.
3. User picks, launcher writes resolved `{ paperSize, orientation, pageWidthMm, pageHeightMm }` to `.pneuma/config.json`, installs seed content sets + skill, launches agent.
4. **Paper size is frozen at creation.** No in-workspace UI to change it. If the user wants a different size, they create a new workspace.

### 3.2 Viewer

- Single iframe preview, sized to the configured paper dimensions (mm → px at 96 dpi), centered on a warm letterbox background (`#d9d6ca` ish — darker-than-parchment so the sheet visually floats).
- Soft ring shadow matching kami's house style: `0 0 0 1px var(--ring-warm), 0 8px 24px rgba(20,20,19,0.08)`.
- Toolbar shows **one** locked preset (e.g. `A4 Portrait · 210 × 297 mm`) — replaces webcraft's Mobile / Tablet / Desktop row. Zoom slider (50% / 75% / 100% / 150%) stays functional.
- No multi-page visual pagination. Content that overflows one page extends downward. Kami's `@page` CSS still produces correct PDFs on print.
- Edit-mode (contentEditable h1–p, blur→save) and selection/annotation are preserved from webcraft.
- Impeccable design command sidebar (audit/critique/polish etc.) is **removed**. Its slot shows a short kami-flavored helper block; optionally a "Print to PDF" shortcut that fires `window.print()` in the iframe.

### 3.3 Content sets

A new kami workspace seeds four content sets, sharing `_shared/styles.css` + bundled fonts + diagram templates:

| Set | Derived from (kami repo) | Lang | Notes |
|---|---|---|---|
| `tesla-one-pager/` | `assets/demos/demo-tesla.html` | CN | Single-page dense layout |
| `musk-resume/` | `assets/demos/demo-musk-resume.html` | EN | Two-page resume |
| `kaku-portfolio/` | `assets/demos/demo-kaku.html` | CN | Six-page rich portfolio |
| `blank/` | new, written for this mode | agnostic | `.page` scaffold with tokens loaded and one placeholder heading |

Each set has a `manifest.json` (matching webcraft's content-set shape) and a short `README.md` that cites the upstream kami demo.

## 4. Architecture

### 4.1 Directory layout

```
modes/kami/
├── manifest.ts                 # ModeManifest — paperSize + orientation select params
├── domain.ts                   # Copy of webcraft/domain.ts (Site model)
├── pneuma-mode.ts              # Frontend registration — imports KamiPreview
├── NOTICE.md                   # MIT + TsangerJinKai02 + OFL attribution
├── viewer/
│   ├── KamiPreview.tsx         # Forked from WebPreview.tsx; single locked paper preset
│   └── scaffold.ts             # Copy of webcraft scaffold.ts
├── seed/
│   ├── _shared/
│   │   ├── styles.css          # kami tokens + --page-width/--page-height vars
│   │   └── assets/
│   │       ├── fonts/          # Newsreader, Inter 400/500/600, JetBrains Mono, TsangerJinKai02
│   │       └── diagrams/       # architecture.html, flowchart.html, quadrant.html
│   ├── tesla-one-pager/
│   │   ├── index.html
│   │   ├── manifest.json
│   │   └── README.md
│   ├── musk-resume/
│   ├── kaku-portfolio/
│   └── blank/
│       ├── index.html
│       ├── manifest.json
│       └── README.md
├── skill/
│   ├── SKILL.md                # Condensed pneuma-kami skill (this repo's adaptation)
│   └── references/
│       ├── design.md           # Ported from kami references/ with attribution header
│       ├── design.en.md
│       ├── writing.md
│       ├── writing.en.md
│       ├── diagrams.md
│       └── diagrams.en.md
├── showcase/                   # New showcase materials (not ported from kami)
└── WORK-REPORT.md              # Implementation log
```

Nothing under `skill/references/` or `seed/_shared/` is mode-local invention: it's kami's work, carried over with attribution. Everything under `viewer/` and `manifest.ts` + `pneuma-mode.ts` is Pneuma-layer adaptation.

### 4.2 ModeManifest shape

```ts
const kamiManifest: ModeManifest = {
  name: "kami",
  version: "1.0.0",
  displayName: "Kami",
  description: "Paper-canvas web design with warm parchment aesthetic — design language adapted from tw93/kami (MIT)",
  icon: "<svg …/>",  // new paper-corner icon

  skill: {
    sourceDir: "skill",
    installName: "pneuma-kami",
    claudeMdSection: `## Pneuma Kami Mode

You are running inside **Pneuma**, a co-creation workspace. This is **Kami Mode**:
paper-canvas web design. The viewer renders your content as a single paper sheet
— size locked to {{paperSize}} {{orientation}} ({{pageWidthMm}} × {{pageHeightMm}}mm)
at workspace creation.

Design language adapted from tw93/kami (MIT) — credit in NOTICE.md. For
aesthetic rules, file layout, and do/don't specifics, consult the
\`pneuma-kami\` skill.

### Core Rules
- Edit HTML/CSS/JS directly; live preview in the iframe
- Keep canvas warm (#f5f4ed, never pure white)
- Single accent color (ink blue #1B365D); no gradients, no drop shadows
- Serif (TsangerJinKai02 / Newsreader) weight locked at 500
- Do not change paper size — it is locked in .pneuma/config.json
- Do not edit _shared/styles.css tokens casually; aesthetic drift compounds fast
- When importing raw content, create a new content set (follow kami's writing.md)`,
  },

  viewer: {
    watchPatterns: [ /* same as webcraft */ ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    site:   { kind: "aggregate-file", config: { patterns: ["**/*.html", "**/manifest.json"], load: loadSite, save: saveSite } },
    assets: { kind: "file-glob",      config: { patterns: [ /* css, js, svg, images, fonts — same as webcraft */ ] } },
    config: { kind: "json-file",      config: { path: ".pneuma/config.json", parse: JSON.parse, serialize: (v) => JSON.stringify(v, null, 2) } },  // NEW — feeds paperSize to viewer
  },

  init: {
    contentCheckPattern: "**/manifest.json",
    seedFiles: {
      "modes/kami/seed/_shared/":            "_shared/",
      "modes/kami/seed/tesla-one-pager/":    "tesla-one-pager/",
      "modes/kami/seed/musk-resume/":        "musk-resume/",
      "modes/kami/seed/kaku-portfolio/":     "kaku-portfolio/",
      "modes/kami/seed/blank/":              "blank/",
    },
    params: [
      { name: "paperSize",   label: "Paper size",  type: "select", options: ["A4","A5","A3","Letter","Legal"], defaultValue: "A4" },
      { name: "orientation", label: "Orientation", type: "select", options: ["Portrait","Landscape"],          defaultValue: "Portrait" },
    ],
    deriveParams: (p) => {
      const sizes: Record<string, [number, number]> = {
        A4: [210, 297], A5: [148, 210], A3: [297, 420],
        Letter: [216, 279], Legal: [216, 356],
      };
      const [w, h] = sizes[p.paperSize as string];
      const landscape = p.orientation === "Landscape";
      return { pageWidthMm: landscape ? h : w, pageHeightMm: landscape ? w : h };
    },
  },

  evolution: {
    directive: `Learn the user's document design preferences from conversation history.
Focus on: content density (dense one-pager vs breathable long-doc), bilingual
tone (CN/EN writing), section patterns, diagram usage, whether they tend to
deviate from kami's defaults or stick close to them.
Augment the skill with personalized typesetting guidance that respects kami's
aesthetic constraints.`,
  },
};
```

### 4.3 Core change — `InitParam.type = "select"`

The user-facing requirement "直接在创建的时候选，默认 A4" cannot be served cleanly by the current `"number" | "string"` init-param types. Minimal targeted extension:

**`core/types/mode-manifest.ts`:**
```ts
export interface InitParam {
  name: string;
  label: string;
  description?: string;
  type: "number" | "string" | "select";    // + "select"
  options?: string[];                        // new — required when type === "select"
  defaultValue: number | string;
  sensitive?: boolean;
}
```

**`src/components/Launcher.tsx`** (the param-prompt form) renders `<select>` with `options` when `type === "select"`, styled to match existing `cc-*` tokens.

**`bin/cli.ts`** (non-interactive param resolver) accepts the default verbatim for select types, or validates against `options` if overridden via flag.

Validation: a select param with missing or empty `options` is a manifest error, surfaced at mode load.

No other runtime touches needed. `server/skill-installer.ts` already handles `{{name}}` substitution for all init param types.

### 4.4 Paper-size CSS mechanics

`seed/_shared/styles.css` (kami tokens + paper vars, installer substitutes placeholders on first install):

```css
:root {
  --page-width:  {{pageWidthMm}}mm;
  --page-height: {{pageHeightMm}}mm;
  --parchment: #f5f4ed;  --ivory: #faf9f5;  --warm-sand: #e8e6dc;
  --brand: #1B365D;  --brand-light: #2D5A8A;
  --near-black: #141413;  /* … full kami token set */
  --serif: "TsangerJinKai02", "Newsreader", "Source Han Serif SC", "Songti SC", Georgia, serif;
  --sans:  "Inter", "TsangerJinKai02", -apple-system, "PingFang SC", sans-serif;
  --mono:  "JetBrains Mono", "SF Mono", Consolas, monospace;
}

@page { size: {{pageWidthMm}}mm {{pageHeightMm}}mm; margin: 14mm 16mm; background: #f5f4ed; }
@media print { body { background: #f5f4ed; -webkit-print-color-adjust: exact; } }

html, body { margin: 0; padding: 0; background: #d9d6ca; }
body { color: var(--near-black); font-family: var(--sans); font-size: 14px; line-height: 1.55; }

.page {
  width: var(--page-width);
  min-height: var(--page-height);
  margin: 0 auto;
  background: var(--parchment);
  padding: 88px 64px 120px;
  box-shadow: 0 0 0 1px var(--ring-warm), 0 8px 24px rgba(20,20,19,0.08);
}
```

Seed HTMLs use `<link rel="stylesheet" href="../_shared/styles.css">` + wrap content in `<div class="page">…</div>`.

### 4.5 Viewer diffs from `WebPreview.tsx`

`modes/kami/viewer/KamiPreview.tsx` is forked (not extended) from `modes/webcraft/viewer/WebPreview.tsx`. Three targeted diffs:

1. **Preset row replaced.** `VIEWPORT_PRESETS` becomes a single entry computed from the `config` source. The toolbar still renders — it just has one tab showing the paper label.
2. **Letterbox background + paper shadow.** The iframe container background is `#d9d6ca`; the iframe itself gets kami's ring-shadow.
3. **Impeccable sidebar removed.** The sidebar slot becomes a compact kami helper panel: paper size indicator, "Print to PDF" shortcut (`postMessage` → `iframe.contentWindow.print()`), and a short text block with the aesthetic reminders.

Edit-mode and selection/annotation scripts are preserved unchanged. Scaffold logic (`scaffold.ts`) is copied with one tweak: when it synthesizes an `index.html` for an unscaffolded content set, it inserts `<div class="page">` and the `../_shared/styles.css` link.

## 5. Attribution plan

MIT-licensed reuse requires preserving copyright and license text. Concrete placement:

1. **`modes/kami/NOTICE.md`** — full text of kami's MIT license with tw93's copyright line; TsangerJinKai02 personal-use caveat with tsanger.cn link for commercial licensing; SIL OFL 1.1 notices for Newsreader / Inter / JetBrains Mono.
2. **`manifest.ts` → `description`** — includes `"design language adapted from tw93/kami (MIT)"`. Visible in launcher card + marketplace listings.
3. **`manifest.ts` → `claudeMdSection`** — one-line credit at the top of the injected block. Seen by the agent every session.
4. **`skill/SKILL.md`** — credit paragraph directly under the title. Seen by the agent on every skill read.
5. **`skill/references/*.md`** — each ported reference file gets a 3-line HTML comment header: source repo, original file path, MIT license reference.
6. **Seed content set READMEs** — `tesla-one-pager/README.md`, `musk-resume/README.md`, `kaku-portfolio/README.md` each cite the kami demo they were derived from.

Fonts: OFL fonts bundled under OFL terms. TsangerJinKai02 `.ttf` bundled under its free-for-personal-use license, with prominent note in NOTICE.md that commercial use requires a separate license.

## 6. File changes — what this plan touches

### 6.1 New files
- Everything under `modes/kami/**` (see 4.1 tree).

### 6.2 Modified files
- `core/types/mode-manifest.ts` — extend `InitParam.type` with `"select"` + optional `options`.
- `src/components/Launcher.tsx` — render `<select>` for select-type params.
- `bin/cli.ts` — non-interactive resolver validates select params against `options`.
- `core/mode-loader.ts` — register `"kami"` in the builtin modes list.
- `package.json` — bump version `2.30.1` → `2.31.0`.
- `CLAUDE.md` — update `**Version:**`, builtin modes list, mode directory tree.
- `CHANGELOG.md` — new `2.31.0` section.

### 6.3 Not modified
- `server/skill-installer.ts` — existing `{{name}}` substitution handles all new params.
- `server/index.ts` — no new routes needed.
- `modes/webcraft/**` — untouched; kami is independent.
- `modes/slide/**` — explicitly out of scope.

## 7. Known gotchas / decisions logged

- **TsangerJinKai02 license.** Personal-use free, commercial requires tsanger.cn license. We bundle it and surface the caveat prominently (NOTICE + README). This matches kami's own approach.
- **Paper size ≠ layout.** A4 portrait at 96 dpi is 794 × 1123 px, which is narrower than webcraft's Tablet preset (768 × 1024). Existing webcraft scaffolds that assume desktop widths will look cramped on A4 — kami seed content is authored for the paper width, not the browser width.
- **`@page` vs on-screen letterbox.** Browsers ignore `@page` outside of print. The on-screen paper shape comes from `.page { width: var(--page-width); min-height: var(--page-height) }`, not from `@page`. Both are declared so print and screen agree.
- **No multi-page visual stack.** If a content set's HTML overflows one `--page-height`, it extends downward as a single long sheet on screen. Printing paginates it via `@page`. Users who want visual pagination should either shorten the content or accept scrolling — we do not bundle `paged.js` for MVP.
- **Config source uses existing `json-file` kind.** Confirmed in `core/types/source.ts` — the built-in `json-file` provider takes `{ path, parse, serialize }` and emits typed events to the viewer. No new source kind needed.
- **Icon.** Paper-corner glyph (folded sheet). Hand-tuned SVG in `manifest.ts`.
- **Fonts bundle size.** TsangerJinKai02-W04.ttf is ~9 MB. Kami accepts this for print quality. Our seed installs get the same hit. If it's a blocker, post-MVP we can split into a "fonts-cn" opt-in download; default seed stays as-is for parity with kami.

## 8. Acceptance checklist

- [ ] New workspace with default A4 Portrait renders all three demo content sets at correct paper dimensions, matching kami's visual output.
- [ ] Paper size select dropdown appears in launcher with the 5 sizes + orientation toggle.
- [ ] Chosen size persists in `.pneuma/config.json` and drives `--page-width` / `--page-height`.
- [ ] `window.print()` in the iframe produces a PDF with the correct page size + margins.
- [ ] Attribution to tw93/kami appears in: manifest description, claudeMdSection header, SKILL.md header, NOTICE.md, and each `skill/references/*.md` header.
- [ ] Version bumped to 2.31.0; CHANGELOG entry added; CLAUDE.md updated (version + builtin modes list + mode directory tree).
- [ ] Existing webcraft workspace unaffected — open an existing webcraft session, verify nothing changed.
- [ ] `bun test` passes.
- [ ] Visual verification via chrome-devtools-mcp: dev server up, kami mode loads, all three demo content sets render without regression vs kami's own `assets/demos/` screenshots.

## 9. Not in this plan

- Kami slide templates — separate change against `slide` mode.
- PDF build verification (`scripts/build.py` equivalent) — live preview + `window.print()` is the verification surface for MVP.
- Multi-page visual pagination via paged.js / Vivliostyle — v2.
- Per-content-set paper size override — v2.
- Custom paper size (freeform mm input) — v2.
- Mid-workspace paper-size change UI — not planned; feature is intentionally locked.
