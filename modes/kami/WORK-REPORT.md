# Kami Mode — Work Report

## Summary

Added a new Pneuma built-in mode called **Kami** that brings paper-canvas web design to the workspace — every document lives on a fixed-size paper sheet (A4 / A5 / A3 / Letter / Legal, portrait or landscape), locked at workspace creation, styled with warm-parchment editorial aesthetics.

**Key Outcome:** Users get a paper-sized iframe preview floating on a warm letterbox, with typography and tokens adapted from [tw93/kami](https://github.com/tw93/kami) (MIT). Download artifacts — PDF, PNG / ZIP, self-contained HTML — all match the chosen paper size.

---

## What Was Built

### Mode skeleton

```
modes/kami/
├── manifest.ts                           # ModeManifest — paperSize + orientation select params
├── pneuma-mode.ts                        # Frontend registration + content-set resolver
├── domain.ts                             # Copy of webcraft domain (Site model)
├── NOTICE.md                             # MIT + font attribution for tw93/kami
├── viewer/
│   └── KamiPreview.tsx                   # Paper-locked viewer (fork of WebPreview)
├── seed/
│   ├── _shared/
│   │   ├── styles.css                    # kami tokens + {{pageWidthMm}} vars
│   │   └── assets/
│   │       ├── fonts/*.woff2|.ttf        # 6 bundled fonts
│   │       └── diagrams/*.html           # 3 inline-SVG diagram templates
│   ├── tesla-one-pager/                  # CN one-pager demo
│   ├── musk-resume/                      # EN 2-page resume demo
│   ├── kaku-portfolio/                   # CN 6-page portfolio demo
│   └── blank/                            # Empty .page starter
├── skill/
│   ├── SKILL.md                          # pneuma-kami skill (condensed)
│   └── references/                       # 6 kami reference docs, attribution-headed
├── showcase/
│   ├── showcase.json                     # Launcher gallery metadata
│   ├── prompts.md                        # Image-generation prompts (4 × 16:9)
│   └── hero.png, paper-locked.png,
│       typography.png, export.png        # Generated from prompts.md
└── WORK-REPORT.md                        # (this file)
```

### Core platform changes

- `core/types/mode-manifest.ts` — `InitParam.type` extended with a third variant `"select"`, plus an optional `options: string[]` field. Enables the launcher's paper-size / orientation dropdowns.
- `bin/pneuma.ts` — `promptInitParams` renders `p.select` for `"select"`-type params; `saveConfig` now runs AFTER `deriveParams` so enriched fields (e.g. `pageWidthMm`, `pageHeightMm`) persist to `.pneuma/config.json`.
- `src/components/Launcher.tsx` — imports `InitParam` from `core/types` (was a local stub); renders `<select>` for the new type.
- `core/mode-loader.ts` — registers `kami` in the builtin modes table.
- `server/routes/export.ts` — new `/export/kami` + `/export/kami/download` endpoints (dedicated paper-canvas export page: no viewport presets, letterbox-wrapped HTML, per-page PNG / ZIP / PDF via snapdom + fflate + jspdf). `inlineAssets` resolves CSS `url()` refs against the stylesheet's own directory instead of the HTML's baseDir — fixes font paths for cross-directory stylesheets.
- `vite.config.ts` — adds `/vendor` to the dev proxy so `/vendor/snapdom.js` reaches the backend instead of Vite's SPA fallback.
- `README.md` — kami row in Built-in Modes table + Acknowledgements paragraph crediting tw93.
- `CHANGELOG.md` — 2.31.0 entry.
- Version bumped 2.30.1 → 2.31.0.

### Attribution surfaces

Six places credit tw93/kami (MIT):
1. `modes/kami/NOTICE.md` — full license text + font terms
2. `manifest.ts` description
3. `manifest.ts` claudeMdSection header
4. `skill/SKILL.md` top-level credit block
5. `skill/references/*.md` — 3-line HTML-comment header each
6. Seed `README.md` per demo content set
7. Viewer — small `"Design adapted from tw93/kami ↗"` link anchored bottom-right of the preview area
8. `README.md` Acknowledgements paragraph

---

## How the paper size locks

1. Launcher prompts two `select` params: **Paper size** (`A4 / A5 / A3 / Letter / Legal`, default A4), **Orientation** (`Portrait / Landscape`, default Portrait).
2. `manifest.init.deriveParams` maps the chosen size + orientation to `pageWidthMm` / `pageHeightMm` and spreads them alongside the raw params.
3. `bin/pneuma.ts` persists the enriched object to `.pneuma/config.json`.
4. The skill installer substitutes `{{paperSize}}`, `{{orientation}}`, `{{pageWidthMm}}`, `{{pageHeightMm}}` into seed files — notably `_shared/styles.css`, which renders the `--page-width` / `--page-height` CSS vars + `@page { size: Xmm Ymm }` rule.
5. `KamiPreview.tsx` reads `.pneuma/config.json` via the `config` source and uses the mm values to build a single locked viewport preset, labeled like **"A4 Portrait · 210 × 297 mm"**.
6. Export (`/export/kami`) reads the same config; PDF pages, PNG dimensions, and HTML letterbox all match the locked size.

---

## Known follow-ups

- **Upstream webcraft fix:** `handleTextEdit`'s body replacement uses a string replacement that interprets `$1` / `$3` as capture-group back-references. I fixed this in the kami fork but the webcraft preview has the same bug — worth porting back when someone's in that area.
- **PDF font embedding:** snapdom's `embedFonts: true` does not always surface `@font-face` rules in the captured SVG when called cross-iframe. Workaround in-flight: inject data-URI font faces into the iframe's head before capture (see `server/routes/export.ts`, `capturePages()`).
- **Template library port:** only the three README demos are seeded. Could also port kami's `assets/templates/*.html` (letter, long-doc templates) if users want more starting points.
