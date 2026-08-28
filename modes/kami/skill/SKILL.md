---
name: pneuma-kami
description: Paper-canvas web design. Edit HTML/CSS/JS; viewer renders your content as a single paper sheet at the size locked at workspace creation. Design language adapted from tw93/kami (MIT). Triggers when the user mentions 纸张排版, 一页纸, 简历, 作品集, 白皮书, 正式信件, "make a resume", "portfolio", "one-pager", "white paper", "letter", "typeset this".
---

# Pneuma Kami Mode

> **Credit.** This mode's design language, tokens, seed templates, and
> reference documents are adapted from [tw93/kami](https://github.com/tw93/kami)
> under the MIT License. See `../NOTICE.md` for full attribution.

## What this mode is

Paper-canvas web design. The viewer renders your content as a single
paper sheet. Size is **{{paperSize}} {{orientation}}**
({{pageWidthMm}} × {{pageHeightMm}} mm), locked at workspace creation
in `.pneuma/config.json`. **Do not change paper size** — if the user
wants a different size, they must create a new workspace.

You edit HTML / CSS / JS files inside each content set directly with the
Edit and Write tools. The iframe preview reflects changes live.

## Working with the viewer

The kami viewer renders the active HTML file as a single paper sheet at
the locked paper size, inside an iframe with a paper-style chrome (page
tabs along the bottom for multi-page documents, viewport presets,
view / edit / select / annotate mode toggles, an Export menu). Everything
below is how you (the agent) coordinate with that surface.

### Reading what the user sees

Each user message may arrive wrapped in two channels — read them before
acting:

- `<viewer-context>` — the live preview state at send time. For kami
  this includes `mode="kami"`, the active HTML `file="..."` (full
  workspace path, e.g. `kaku-portfolio/page-3.html`), and a page label
  like `Viewing page 3/6: "Projects"` derived from the content set's
  `manifest.json`. When the user clicks an element in the page, you also
  get `Selected: <selector>`, an `Address:` line (a machine-readable
  [ViewerAddress](#vieweraddress--naming-an-object-in-the-preview) you
  can paste straight into a `capture` call or a `<viewer-locator>` card),
  `Element: <accessible name>`, `Tag: <h2>`, `Classes: ...`,
  `Context: <nearby text>`, and `Accessibility: ...`. In
  **Annotate** mode the block lists multiple annotated elements with the
  user's per-element `Feedback:` comment. Resolve deictic phrases like
  "this heading", "tighten this section", "the figure here" against
  these fields first.

  Example:

  ```
  <viewer-context mode="kami" file="kaku-portfolio/page-3.html" content-set="kaku-portfolio">
  Viewing page 3/6: "Projects"
  Selected: h2.section-title
    Address: {"contentSet":"kaku-portfolio","page":"page-3.html","selector":"h2.section-title"}
    Element: Projects
    Tag: <h2>
    Classes: section-title
    Context: Projects 2024 — selected work
  </viewer-context>
  ```

- `<user-actions>` — discrete UI actions the user took since their last
  turn. Kami emits one kind: `edit-text` — inline text edits made
  directly inside the iframe in **Edit** mode (the user double-clicked a
  text node and rewrote it). The action's `description` includes the
  before → after diff per element, so treat it as a record of changes
  the user already committed; don't re-apply them.

  ```
  <user-actions>
    <action time="12s ago" id="edit-text">Edited text on "kaku-portfolio/page-3.html":
      <h2>: "项目" → "Projects"
      <p>: "2024 年精选" → "Selected work, 2024"</action>
  </user-actions>
  ```

  After an `edit-text` action, **re-read `.pneuma/kami-fit.json`** —
  text rewrites can flip a page's status from `fits` to `overflow`.

If neither block is present, the user has nothing specifically selected;
default to the most recently edited file or ask.

### ViewerAddress — naming an object in the preview

Kami has **one** vocabulary for "which object in the viewer". The same
shape — a **ViewerAddress** — is what a `<viewer-locator>` card points at,
what the `capture` action screenshots, and what a `<viewer-context>`
selection reports back to you. Learn it once; it works across all three.

| Key | Half | Meaning |
|---|---|---|
| `contentSet` | coarse | Top-level directory acting as a switchable paper (e.g. `kaku-portfolio`, `pneuma-one-pager`). |
| `page` | coarse | HTML page path inside the content set (e.g. `index.html`, `page-3.html`). Alias `file` is accepted. |
| `selector` | fine | A CSS selector resolved inside the rendered page (e.g. `figure`, `h2.section-title`). |

Use only the keys you need: `{"page":"page-3.html"}` names a whole page;
`{"page":"page-3.html","selector":"figure"}` names one region of it. When
the user clicks an element, the `Address:` line in `<viewer-context>`
hands you a ready-made ViewerAddress — copy that JSON straight back.

### Locator cards

After creating or editing pages, embed `<viewer-locator>` cards in your
reply so the user can jump straight to the result. The card's `address`
attribute is a ViewerAddress — locators navigate the user to a **page**,
so use the coarse keys (`page`):

```html
<viewer-locator label="Open the cover" address='{"page":"index.html"}' />
<viewer-locator label="Jump to the Projects page" address='{"page":"page-3.html"}' />
<viewer-locator label="See the rewritten Methods page" address='{"file":"methods.html"}' />
```

One card per landmark you want the user to verify. Switching content
sets (e.g. from `pneuma-one-pager` to `kaku-portfolio`) is driven by the
viewer chrome, not the locator card — point the user there in prose if
they need to switch sets.

### Viewer actions

Kami exposes **no agent-invocable viewer actions** today. There is no
`scaffold`, no `navigate`, no programmatic page-size or orientation
change (paper size and orientation are locked at workspace creation in
`.pneuma/config.json`; see "What this mode is"). To start a new
document, create a new content-set directory with `index.html` +
`manifest.json` directly using `Write` — see "When the user hands over
raw content" below.

The base `POST $PNEUMA_API/api/viewer/action` endpoint exists for modes
that declare actions; calling it for kami will not match any registered
action.

### Native bridge

Desktop APIs (clipboard, shell, notifications, …) are available at
`$PNEUMA_API/api/native/*` when the session runs inside the Pneuma App.
Discover what's actually wired up at runtime with
`GET $PNEUMA_API/api/native` — web-only sessions report `available: false`
for unsupported modules.

### Verifying your work

The user is already watching a live preview of every edit you make — you
do not need to prove the page renders.

**Hard rule:** do NOT open an external browser, the chrome-devtools MCP,
headless Chrome, or browser-use tooling to verify your work.

**Why:** those tools render the raw HTML *outside* the kami viewer. Kami
renders your content as a single paper sheet at the locked physical paper
size — the paper chrome, the sheet dimensions, and the page-fit framing
are all applied by the viewer. Open an HTML file directly and you see an
unbounded web page, not a paper page. What an external browser shows is
not what the user sees. The Pneuma viewer is the only faithful render.

When you genuinely need to *see* the rendered result for a "quality
check → improve" loop, use the framework-level `capture` viewer action —
it returns a PNG screenshot of the live viewer, exactly what the user
sees:

```bash
# Full viewer — omit params for a whole-sheet shot
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture"}'

# A specific region — pass a ViewerAddress; `selector` resolves inside the rendered page
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture","params":{"address":{"selector":"figure"}}}'

# A region on another page — coarse `page` navigates first, then `selector` resolves
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture","params":{"address":{"page":"page-3.html","selector":"figure"}}}'
```

`params.address` is a [ViewerAddress](#vieweraddress--naming-an-object-in-the-preview) — omit it for a full-viewer shot.
On success the response is
`{"success":true,"data":{"path":"<absolute .png path>","width":<n>,"height":<n>}}`.
Use your `Read` tool on that `path` to view the screenshot inline, then
iterate. For fit issues, `.pneuma/kami-fit.json` stays the precise,
machine-readable check — capture is for visual judgement.

## Aesthetic rules (kami adapted)

| Element | Rule |
|---|---|
| Canvas | `#f5f4ed` parchment. Never pure white. |
| Accent | Ink blue `#1B365D` only. No second chromatic hue. |
| Neutrals | Warm-toned (yellow-brown undertone). No cool blue-grays. |
| Serif | **One serif per page.** CN: `TsangerJinKai02`. EN: `Charter` (system). JA: `YuMincho` (system). KO: `Source Han Serif K` → `AppleMyungjo` (system). Weight 400 body / 500 headings. Never bold. |
| Letter-spacing | CN body 0.3pt (locks in TsangerJinKai02 density). EN body 0. Tracking only on small labels and overlines. |
| Line-height | Titles 1.1–1.3. Dense body 1.4–1.45. Reading body 1.5–1.55. Never 1.6+. |
| Shadows | Ring or whisper only. No hard drop shadows. No gradients. |
| Tags | Two tints, both tokens: `--tag-bg` `#E4ECF5` default, `--brand-tint` `#EEF2F7` to recede. Solid only — `rgba()` can break in print, and a third tint is drift. |

`--sans` aliases `--serif` in `_shared/styles.css`; use one serif per page
unless the design calls for an explicit mono code block. Match the user's
language: CN content stays on the TsangerJinKai02 stack, EN on Charter,
JA on YuMincho, KO on Source Han Serif K → AppleMyungjo. JA and KO are
best-effort (the fonts are system-bundled, not shipped) — visually
verify before shipping. In any stack, the CJK families lead and the Latin
faces trail: a substituted CJK serif produces no missing-glyph boxes, so the
page still reads and nobody notices it went heavy and flat.

## Working rules

- Edit HTML / CSS / JS files directly — the user sees every change live.
- Do not edit `_shared/styles.css` tokens casually. Aesthetic drift
  compounds fast. Per-document overrides go in that document's own stylesheet.
- The parchment canvas has exactly one sanctioned exception: the opt-in
  white-paper print recipe for documents headed to a home or office
  printer — `references/design.md` §6.
- When importing raw content, create a new content set
  (see `references/writing.md`).
- Do not modify `.claude/` — it's runtime-managed.
- Paper size and orientation are locked at workspace creation. A different
  size means a new workspace, not an edit.

**Out of model here.** Don't render slides through Python (WeasyPrint /
python-pptx) or Marp — kami slides are HTML paper pages in the iframe.
Don't build screen-first landing pages, their carousels, or their
multilingual SEO companions; that is webcraft's job. Both exist upstream and
neither survives the move to a single physical sheet.

## Workspace layout

```
_shared/
  styles.css          # Tokens + paper dimensions. Don't edit casually.
  assets/fonts/       # Bundled fonts: TsangerJinKai02-W04.ttf, JetBrainsMono.woff2
  assets/diagrams/    # 18 self-contained SVG templates — copy the <svg>
                      # block out, drop it inside a <figure> on a page.
pneuma-one-pager/      # EN one-pager demo (Pneuma product brief)
kaku-portfolio/        # CN 6-page portfolio demo (from kami)
.pneuma/kami-fit.json  # Auto-written fit report — READ after every edit
```

Each content set has an `index.html` + `manifest.json` (+ a `README.md`
for provenance). The user can switch between sets, or you can create new
ones when they hand over raw content.

## Doc types this mode handles

One design language across these document genres. Pick the genre from the
user's intent before choosing a layout — the genre dictates length, page
count, density, and which diagrams sit naturally inside.

| User says | Genre |
|---|---|
| "one-pager / 方案 / 执行摘要 / exec summary" | One-Pager |
| "white paper / 白皮书 / 长文 / 年度总结 / technical report" | Long Doc |
| "formal letter / 信件 / 辞职信 / 推荐信 / memo" | Letter |
| "portfolio / 作品集 / case studies" | Portfolio |
| "resume / CV / 简历 / 履歴書" | Resume |
| "slides / PPT / deck / 演示" | Slides |
| "个股研报 / equity report / 估值分析 / investment memo / 股票分析" | Equity Report |
| "更新日志 / changelog / release notes / 版本记录" | Changelog |

Seed demos cover three points on this spectrum (`pneuma-one-pager/`,
`kaku-portfolio/`, `nvda-equity-report/`); the rest you build from
scratch into a new content set.

> Output format selection is driven by the viewer's Export menu (PDF /
> PNG); do not auto-trigger PDF/PNG generation from the agent side.

## Which kind of task this is

Route on the *state of the artifact*, not on the words in the request. Four
kinds, and only the first one runs the full flow below:

| The request | Kind | What it commits you to |
|---|---|---|
| A new document, or a restructuring that changes what the pages are | **New document** | The full flow: source pass, layout note, content set, post-fill check |
| Replacing text, translating, correcting a fact in an existing document | **Content-only** | Change the copy. Leave CSS and layout alone unless the new copy proves a genuine fit defect |
| The user looks at the render and says something is wrong with how it looks | **Visual repair** | The render is the brief. Name the target, name what must stay untouched, make the smallest fix — see «Vague feedback → concrete options» |
| A standalone generated illustration, cover, or redraw | **Generated asset** | Lock the semantic brief before any pixels; preserve what was already accepted across iterations — see «Image generation» |

The two that go wrong quietly are content-only and visual repair, because both
invite a tidy-up of everything nearby. Approved pages, settled content, and
`_shared/styles.css` are outside the boundary in both.

## When the user hands over raw content

This is the **New document** flow. It assumes you've already classified the doc
type using the table above.

### Step 1 · Source and material pass

Run this before distilling or filling when the document depends on facts
or materials outside the user's draft. Skip it for personal drafts where
the user already supplied everything.

**Source check** fires when the document names a specific company, product,
person, release date, version, funding round, metric, market fact, or
technical spec. Work from primary sources, keep a short note of source names
and dates for the facts that drive the document, and ask the user when sources
conflict rather than choosing silently. `references/writing.md` «5. Sources
before phrasing» owns the detail, including which current-sounding claims
("latest", "recent", "new", version numbers, launch dates, financial figures)
are banned until checked.

**Material check** fires when the subject is a company, product, project,
venue, or personal brand. Confirm what makes it recognizable before layout:

| Need | Required when | Accept |
|---|---|---|
| Logo | Any branded document | User file or official SVG/PNG |
| Product image | Physical product / venue / object | Official image, user image, or marked gap |
| UI screenshot | App / SaaS / website / tool | Current screenshot, official product image, or user capture |
| Brand colors | Branded one-pager / portfolio / deck | Official value, extracted asset value, or keep kami ink-blue |
| Fonts | Only if brand typography matters | Official font, close system fallback, or kami default |

A missing item gets a compact gap table and one question — never a generic
stand-in, an approximated logo, or an invented value. `references/writing.md`
«6. Materials serve recognition» carries the writing-side rules.

**Materials status block.** After the material check, output a structured
status block before continuing. One-shot transparency display, not a
question:

```
Materials status:
- Logo: OK assets/client-logo.svg
- Brand colors: OK #1B365D mapped to --brand
- Product screenshot: MISSING (proceeding with kami default placeholder)
- UI screenshot: not required for this doc type
```

Use `OK`, `MISSING`, or `not required`. If a required item is missing and
no user input arrived, ask once with the gap table; otherwise continue
silently.

### Step 2 · Layout note (plan before layout)

Before creating the content set, write a short editor-style note stating the
plan. It names six things, and the last one is the point: **doc genre**,
**page target** (or length), **narrative arc**, **embedded diagrams**,
**material status**, and **the checks this document has to pass before you
hand it back**. Naming the
acceptance bar before layout is what stops it being negotiated downward at the
end. Match the user's language, keep it under 80 words, write it as prose
rather than a status panel, and continue immediately — this is transparency,
not an approval gate.

Example (EN):

> Layout intent: Equity Report (EN), two pages A4. Open with thesis and
> price target, run through valuation (DCF and comparables), close on
> catalysts and risks. A revenue line chart and an FY26 waterfall sit
> mid-doc. Logo is in hand; product image is absent, so the header stays
> text-only. Ships when both pages read `fits` and every number traces
> back to the filing.

Example (CN):

> 排版意图：Equity Report 中文版，2 页 A4。先立论与目标价，进入估值 (DCF
> 与可比公司)，落于催化剂与风险。中段嵌一张营收趋势折线和 FY26 收入桥瀑
> 布。Logo 已就位，产品图暂缺，header 改走纯文字。交付标准：两页都 `fits`，
> 每个数字都能回溯到财报原文。

If the user pushes back, adjust; otherwise proceed to Step 3.

### Step 3 · Create the content set

1. Pick a short content-set name (e.g. `acme-whitepaper/`).
2. Create the directory with an `index.html` that starts from the closest
   existing demo as a skeleton, a `manifest.json`, and a `README.md`.
3. Extract every factual claim from the raw content; classify into
   sections that match the target doc type's structure.
4. Gap-check: list what the layout needs but the content doesn't have.
   Share the gap table with the user before guessing.

### Step 4 · Post-fill fact check

After the pages are filled, re-verify against the extraction from Step 3
that nothing was dropped or mutated on the way into HTML:

- Every name, number, date, and metric from the source lands in the
  document **verbatim** — short atomic values are never rephrased,
  rounded, or "improved". Only prose longer than ~80 characters may be
  rewritten for flow.
- Every image slot resolves: the referenced asset exists in the content
  set, or the gap is marked in the materials status block. Never ship a
  broken `<img>`.
- Anything the source lacks stays marked `[DATA NEEDED: description]` —
  a gap is reported, never silently filled.

Fix a mismatch by fixing the page (or asking the user for the missing
fact), not by relaxing the check.

## Fit discipline — the kami authoring loop

Kami is a **strict-page** medium. The AUTHOR decides how many sheets a
document spans by writing that many `<div class="page">` blocks. Every
page's content must be **tuned to fit exactly one sheet** — not overflow,
not sit half-empty. This is kami's core discipline, adapted from the
WeasyPrint-verified workflow in the upstream project.

The viewer makes this loop machine-checkable: after every render, it
writes a measurement report to **`.pneuma/kami-fit.json`**. **You MUST
read this file after every meaningful edit** and iterate until every
page reports `status: "fits"`.

Report shape:

```json
{
  "content_set": "musk-resume",
  "file": "index.html",
  "paper": { "size": "A4", "orientation": "Portrait", "height_mm": 297 },
  "pages": [
    { "index": 1, "content_height_mm": 289.2, "overflow_mm": -7.8, "status": "fits" },
    { "index": 2, "content_height_mm": 314.5, "overflow_mm":  17.5, "status": "overflow" }
  ],
  "summary": { "overflow_count": 1, "sparse_count": 0, "fits_count": 1 }
}
```

| Status     | Meaning                           | What to do |
|------------|-----------------------------------|------------|
| `fits`     | Content is within ±50mm of paper height | Stop. Move on. |
| `overflow` | `overflow_mm > 2` — will not print on one sheet | **Must trim.** Priority order (upstream V1.7.1): delete or merge content first — drop a bullet, tighten phrasing, remove a section, merge duplicated concepts. Never shrink font-size or line-height to force a fit; those are locked by the design system. |
| `sparse`   | `overflow_mm < -50` — paper is ~20%+ blank | Consider filling: expand a weak section with concrete specifics, add a pull-quote, include a metric, OR merge adjacent pages if the content genuinely fits tighter. |

**The loop** (run it automatically after every edit; don't wait for the user to point out overflow):

1. Make a content edit.
2. Read `.pneuma/kami-fit.json`.
3. If `overflow_count > 0` → trim the overflowing pages → loop to step 2.
4. If `sparse_count > 0` and content intent allows → enrich → loop to step 2.
5. When every page is `fits` → stop.

Reaching `fits` across every page is the quality bar before you tell
the user the document is ready. Silence on your part implies the fit is
passing. See `references/cmd-fit.md` for edge cases (sparse-on-purpose
cover pages, multi-sheet sections, how to choose what to trim).

### Definition of done

A document task is done only when your closing message carries:

1. Which content set (and pages) hold the deliverable — with
   `<viewer-locator>` cards to the landmarks.
2. The fit verdict: every page reports `fits` in `.pneuma/kami-fit.json`
   (or the named, deliberate exceptions — cover, colophon).
3. Every remaining `[DATA NEEDED]` gap, listed explicitly. Never declare
   done with an unreported gap.
4. The visual verdict, stated honestly: fit geometry cannot see a
   fallback glyph, an arrow crossing a label, or a broken image. For a
   final deliverable, run a `capture` pass page by page and say what you
   checked; if you did not look, say "fit verified, visuals unconfirmed",
   not "done". One visual defect found means sweeping every page for
   that class of issue, not fixing the one spot.
5. The plan from Step 2, answered item by item — genre, page target,
   arc, diagrams, and each check you named. A plan that quietly stops
   being mentioned at the end is a plan that was abandoned.

**What does not count as a pass.** Every clause above is about evidence you
actually have, and three near-misses look like evidence but aren't:

- **A page with no content on it is not a page.** An empty or near-empty
  `<div class="page">`, a section whose body never got filled, a figure slot
  with nothing in it — none of these ship, and none of them count toward a page
  target. Delete the block or fill it; a page target met by blank sheets is
  not met.
- **Hidden or unresolvable content does not satisfy a requirement.** Text sized
  to zero, content behind `display: none`, an `<img>` pointing at a file that
  isn't in the content set, a remote URL standing in for a local asset — the
  requirement is still open. Say so.
- **"I did not look" is a verdict, and it is the honest one.** Never report a
  check you did not run, and never let a check you skipped ride along inside a
  sentence about the checks you did run.

### Per-page density target (multi-page docs only)

Long-doc / portfolio / slides / equity-report / changelog carry a **60–80%**
body-page fill target — a guard against drafts that fragment content too thin
to fill the sheets they occupy. Resume / one-pager / letter are exempt; they
have their own length contracts, and so do cover, contents, and sign-off pages.

`kami-fit.json`'s `sparse` status already flags the worst cases. For the
borderline page, `references/cmd-fit.md` «Per-genre density floors» carries the
items-per-page contract, the merge order, and the last-page exemption. Read it
when a page is borderline, not before.

## Image generation (only when the user has configured a key)

A script lives at `{SKILL_PATH}/scripts/generate_image.mjs`. Default model
is `gpt-image-2` (fal.ai) — the right choice for kami because it renders
**legible typography inside images**: figure captions, diagram labels,
mock book spines, imagined postage stamps, rendered monograms. Opt in to
`--model gemini-3-pro` only for painterly / watercolor / woodcut-style
decorative artwork.

Images here live on a **printed paper page**. That constraint is absolute
and distinguishes kami from every other Pneuma mode. The images can't
look like they escaped from a SaaS landing page.

### The kami image slop test

Before you call the generator, picture where the image will sit — next to
warm parchment, serif body at weight 500, ink-blue accents, generous
margins. If the honest answer to *"does this image look like it belongs
in a printed book"* is no, rewrite the prompt.

Reject on sight:

- Saturated HDR colors, glossy 3D renders, neon / cyan highlights, space
  backgrounds, data-orb / "AI hero" aesthetics
- Purple-to-blue or cyan-on-dark gradients (kami has exactly one accent —
  ink blue — and *no* gradients, period)
- Drop shadows *inside* the image. The paper frame provides its own
  whisper ring-shadow; another shadow stacked on top is noise.
- AI-rendered people with waxy symmetrical faces
- Generic stock photography: boardroom handshakes, laptop-on-desk flat
  lays, "team standing in a circle"
- Tech-sticker aesthetics: chunky rounded rectangles with tiny icons,
  gradient backgrounds, retro-wave grids

Lean toward:

- **Documentary / editorial photography** — muted warm neutrals, diffuse
  natural light, analog film grain, print magazine composition
- **Risograph / woodcut / letterpress illustration** — limited palette,
  visible mark-making, handmade quality
- **Duotone / warm monochrome portraits** — ink blue + bone, or sepia +
  parchment; never full-color high-saturation headshots
- **Technical drawings & schematics** — thin ink lines on parchment,
  annotated with serif labels, in the spirit of 19th-century engineering
  manuals
- **Mock objects on paper ground** — a rendered museum label, a ticket
  stub, a book spine — imagined as if sitting on the page itself

### Prompt discipline

Bake these ingredients into every prompt so the result harmonizes with
the page it will land on:

1. **Palette anchor** — include phrases like *"warm parchment background
   tone (bone / off-white / #f5f4ed range), single ink-blue accent, no
   other chromatic hues, muted warm neutrals throughout"*.
2. **Weight & tone** — *"editorial restraint, print publication quality,
   not SaaS landing page"*.
3. **Medium** — pick one and commit (documentary photo / Risograph /
   woodcut / technical ink drawing / pressed botanical / museum archive).
4. **Composition** — *"generous negative space, off-center or rule-of-
   thirds, small subject on wide ground"* — paper pages breathe.
5. **No-fly zone** (explicit) — *"no gradients, no drop shadows on the
   subject, no glossy highlights, no neon"*. Models are suggestible; say
   it out loud.

Two worked examples:

> *Portrait for a resume page, A4 Portrait layout:*
> "A head-and-shoulders duotone portrait of a woman in her thirties,
> three-quarter profile, natural diffuse window light, printed as ink
> blue (#1B365D) duotone against a warm bone #f5f4ed ground, slight
> analog film grain, editorial restraint, generous negative space around
> the subject, no full-color, no drop shadow, no gradient — a magazine
> page portrait, not a LinkedIn avatar."

> *Inline diagram for a whitepaper section:*
> "A simple hand-drawn ink schematic of a four-node circular buffer,
> labeled nodes reading 'head', 'read', 'write', 'tail' in thin serif
> typography, thin ink-blue (#1B365D) lines on a warm parchment ground
> (#f5f4ed), generous whitespace around the diagram, visible hatched
> shading and hand-set labels, the feel of a 19th-century engineering
> manual — no gradients, no digital glow, no drop shadow."

### How to call it

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your kami-aligned prompt here" \
  --aspect-ratio 4:3 \
  --quality high \
  --output-format png \
  --output-dir <workspace>/<content-set>/assets \
  --filename-prefix figure-01
```

Flag guidance in paper terms:

| Flag | Kami guidance |
|---|---|
| `--aspect-ratio` | `4:3` or `3:2` for figures inline with body text; `1:1` for portraits and spot illustrations; `3:4` for vertical portraits set beside body text; `16:9` only for landscape-paper covers. Avoid `21:9` — it rarely sits well on a page. |
| `--quality` | `high`. Kami is a printed-page medium; no reason to ship draft-quality to final. |
| `--output-format` | `png` for illustrations / diagrams / monochrome portraits (preserves clean edges and text); `jpeg` only for full-color photography. |
| `--output-dir` | Always the active content set's `assets/` directory. Don't dump into `_shared/assets/` — that's the upstream-sourced font & diagram folder. |
| `--filename-prefix` | Role + index: `portrait-founder`, `figure-02-buffer`, `stamp-motif`. |
| `--model gemini-3-pro` | Reach for this when the style is explicitly painterly / watercolor / woodcut — Gemini's aesthetic range is broader at that end. Everything else stays on `gpt-image-2`. |

### After generating

1. Embed inside a `<div class="page">` with appropriate framing. Keep
   captions in small serif below the image if it's a figure.
2. Match the figure's real paper width in CSS — don't let an image bleed
   past the page's safe margins. The page's safe zone is
   `{{pageWidthMm - safeSideMm*2}} × {{pageHeightMm - safeTopMm - safeBottomMm}} mm`.
3. If the image has its own visible background, prefer PNG with a
   transparent or `#f5f4ed`-matched background so it blends into the
   paper. No extra box around it — the page *is* the frame.
4. **Re-read `.pneuma/kami-fit.json`.** An image adds height; a page that
   used to `fit` can flip to `overflow` after the embed. Loop the fit
   discipline until every page reads `fits` again.

### Consistency across figures

When a document needs multiple images (a multi-page portfolio, a
whitepaper with several diagrams), record the first prompt's style
descriptors and reuse them verbatim on every subsequent prompt. Kami
documents read as one voice across every sheet; the imagery must too.

When a deliverable needs **several** generated images, drive them
through a single handoff note (a scratch file in the content set works):
one line per image — slot, aspect ratio, shared style anchor, prompt,
status. Generate in batches of at most 5, update the status column after
each batch, and check existing output before regenerating. The style
anchor is shared by the whole batch; per-image style drift is the
failure mode.

For **diagram-shaped** illustrations (a figure that needs more detail
than hand-assembled SVG holds at the target width), write the brief per
`references/diagrams.md` «Illustration briefs» and run its QC checklist
before placing the result.

## Vague feedback → concrete options

When the user gives visual feedback ("looks off", "太挤了", "not elegant"),
**look before you ask**. The render is the evidence; their negative label is
only the signal that something is wrong. You already have the render — a
`capture` of the page they are looking at costs one call.

1. **Name the defect** in one sentence: which page, and whether the problem is
   density, hierarchy, alignment, type, colour, cropping, or text fit.
2. **Lock the boundary.** State what you will change and, explicitly, what
   stays untouched — the neighbouring pages, the approved content, and
   `_shared/styles.css`. Ask only when two plausible targets would produce
   materially different documents.
3. **Make the smallest change** that fixes the named defect. Never hide a
   content problem by shrinking type: the typography is locked, and a page
   that only fits at a smaller size has too much on it.
4. **Verify the whole blast radius**, not the one spot: the target page, its
   neighbours, the total page count, and — whenever the change touched a
   shared class or token — every other page that class reaches. Then re-read
   `.pneuma/kami-fit.json`.

If no render exists and the feedback still leaves two materially different
fixes, ask once by naming the current property and offering two in-spec
alternatives: "X is currently Y. Would you like (a) … or (b) …?" Never say
"I'll adjust the spacing" without naming the exact property and its new value.

**Escalate after two rounds.** If the same element is still not approved
after two adjustment rounds, stop nudging values: build one comparison
page instead — the current state plus 2-3 labeled variants (A/B/C) of
the same content in the same frame — and let the user pick in the live
preview. For choices with no objective criterion (typeface feel, accent
usage, cover motif), skip the nudging entirely and start with a specimen
page: up to 5 candidates, each a labeled half-page block of identical
title-plus-paragraph content. One round of "pick one" converges where
five rounds of "try again" do not; after the pick, apply it everywhere
in the same round.

## Diagrams (18 self-contained templates)

Eighteen types ship in `_shared/assets/diagrams/`. Pick the closest match,
copy the `<svg>` block out, and drop it inside a `<figure>` on the page —
inline, never linked through an `<iframe>`, so it paginates with the text
around it. `references/diagrams.md` §1 «Selection» maps every type to what it
shows and §7 lists the AI-slop patterns; read it once before drawing.

Before drawing at all, ask: **would a well-written paragraph teach the reader
less than this diagram?** If no, don't draw.

Three routes inside that reference, by trigger:

| Trigger | Section |
|---|---|
| Full-system panorama, control plane, roadmap, or owner map in one artifact | «Architecture boards». Give it its own page or content set; do not inflate the single architecture figure past its node budget. |
| Updating a diagram someone drew earlier — a redraw, or one living in a content set across sessions | «Maintained diagrams». Evidence pass first (intent note, current source, a `capture` of the render, then the facts that define objects and boundaries), maturity encoded, never redrawn from memory. |
| A raster illustration that needs more detail than hand-assembled SVG holds | «Illustration briefs», plus «Image generation» below. |

**Auto-select charts from data.** When the page carries numbers, pick the chart
type yourself and embed it without waiting to be asked; `diagrams.md` §1 owns
the mapping. Two house calls differ from the common default: a ~100% share is a
donut only up to 6 items and a horizontal bar at 7 or more; and a single time
series whose absolute *count* changes dominate (not rate) is bars, not a line.
When several types fit, prefer the one that shows variance most clearly. Always
embed inside a `<figure>` whose caption states the insight, not the data range.

## References (read on demand)

Load only what the task needs. Default to the lowest tier.

| When | Read |
|---|---|
| Updating text / translating / swapping bullets | Nothing — just edit, then check `kami-fit.json` |
| A page shows `overflow` or `sparse` | `references/cmd-fit.md` — trimming + filling tactics |
| Adjusting layout or tweaking spacing | Look at the closest existing demo |
| Building a new doc type from scratch | `references/design.md` |
| Writing tone / structure guidance | `references/writing.md` |
| Embedding a diagram | `references/diagrams.md` |
| Architecture board / maintained diagram | `references/diagrams.md` §3-4 — board skeleton, evidence pass, maturity encoding |
| Drafting a deck | `references/deck-preflight.md` — the six questions to ask in one batch, then the slide content rules |
| Building or editing a resume | `references/resume-writing.md` — bullet structure, source-and-truth pass, ownership calibration, two-page balance, recruiter pass |
| Document headed to a home/office printer | `references/design.md` §6 — the opt-in white-paper recipe |
| Quality pass before handing back | `references/anti-patterns.md` — the AI-document failure checklist |
