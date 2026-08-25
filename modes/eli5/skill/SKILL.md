---
name: pneuma-eli5
description: >
  Pneuma ELI5 Mode workspace guidelines. Use for ANY task in this workspace:
  explaining a topic, a piece of code, an error message, or a document to a
  specific audience, and building the audience ladder that holds those
  explanations. Trigger on "ELI5", "explain like I am", "explain this to my
  manager / mom / kid / team", "break this down for", "dumb it down",
  "simplify this for", "how would I explain this to", or any request naming
  who the explanation is for. Also trigger when the user wants the same thing
  explained at several levels, or wants to compare two audience versions.
  Consult before your first edit in a new conversation.
---

# Pneuma ELI5 Mode — Audience Ladder Explainers

## Scene

Someone just understood something hard, and now they have to hand that
understanding to a person who does not have their background: a manager who
needs to approve the work, an eight-year-old who asked a real question, a
teammate three layers down the stack. You are the writer they sit next to.

In front of the user is an **audience ladder** — an ordered rail of people,
simplest on the left, most technical on the right. Click a rung and the page
written *for that person* fills the canvas: not the same words at a different
reading level, but a differently designed document — huge rounded type and a
toy-box analogy on one rung, a one-screen memo with a cost callout on the
next, precise mechanics with a code sample on the last. A compare toggle puts
two rungs side by side so the shift is visible in one glance.

You write those pages as files. The viewer is a player, not an editor — it
never writes back. Every explainer is a directory holding a `manifest.json`
and one self-contained HTML page per audience, and one workspace holds as many
explainers as the user has topics.

## Viewer contract

The viewer is a live player for the explainers you write under
`<content-set>/manifest.json` + `<content-set>/pages/*.html`. Files you write
appear in the user's preview immediately — you never need to prove a page
"saved". The user interacts with the viewer to hand you grounded context.

### What the user can select

The user can select an **audience** by clicking a rung on the ladder, and an
**element inside a rendered page** by clicking the page surface. Either way,
their next message carries a `<viewer-context>` block with an `Address:` line —
a JSON-serialized `ViewerAddress` naming exactly what they had in front of
them. When they say "this page", "make this shorter", or "the callout here",
resolve the referent against that address rather than guessing from the
conversation.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | framework-reserved (coarse) | The explainer directory — one topic (`database-index`, `oauth-flow`). Passed through automatically when present; include it explicitly whenever you point at a topic other than the one on screen. |
| `audience` | coarse | The audience id within the active explainer, matching an `audiences[].id` in that set's `manifest.json` (`age-5`, `manager`, `engineer`). Names one rung of the ladder — one whole page. |
| `anchor` | fine (optional) | An element id or CSS selector resolved inside the rendered page (`#cost-callout`, `.analogy`, `h2`). Narrows an address from "this page" to "this part of this page". |

Use only the keys you need. `{"audience":"manager"}` names a whole page in the
open explainer; `{"contentSet":"database-index","audience":"engineer","anchor":"#tradeoffs"}`
names one section of one page in a specific explainer. When the user hands you
an address, copy that JSON verbatim into your locator cards and action calls —
retyping it is how targets drift.

### Locator cards

After writing or editing a page, embed a `<viewer-locator>` card so the user
can jump to it in one click. Always emit fully-formed cards with real values.

```xml
<viewer-locator label="Read the manager version" address='{"audience":"manager"}' />
<viewer-locator label="Database index → engineer" address='{"contentSet":"database-index","audience":"engineer"}' />
```

Include `contentSet` whenever the card points at a different explainer than the
one currently on screen; a bare `audience` resolves inside the active set, and
an address naming a topic this workspace does not have is refused rather than
silently redirected.

### Actions you can invoke

Actions go to `POST $PNEUMA_API/api/viewer/action`. Both actions below take a
`params.address` object — a `ViewerAddress`, **wrapped under the `address`
key**. A bare `{"audience":"manager"}` as `params` will not resolve.

- **`navigate-to`** — move the viewer to one rung of the ladder. Invoke it
  right after you finish writing or substantially editing a page, so the user
  lands on the version you just changed instead of hunting for it.

  ```bash
  curl -s -X POST "$PNEUMA_API/api/viewer/action" \
    -H 'Content-Type: application/json' \
    -d '{"actionId":"navigate-to","params":{"address":{"audience":"age-5"}}}'
  ```

  Cross-explainer navigation carries the set:
  `{"address":{"contentSet":"how-llms-work","audience":"pm"}}`.

- **`capture`** (framework built-in) — screenshot the live viewer and get a PNG
  path back; `Read` that path to see it. Reach for it when you need *visual*
  judgement that reading your own HTML cannot give you: is the hierarchy right,
  does the kid page actually feel playful, does the manager memo fit the first
  screen. Omit `params` for a full-viewer shot; pass an address to target one
  page or one element.

  ```bash
  curl -s -X POST "$PNEUMA_API/api/viewer/action" \
    -H 'Content-Type: application/json' \
    -d '{"actionId":"capture","params":{"address":{"audience":"manager","anchor":"#impact"}}}'
  ```

Do not open an external browser, headless Chrome, or the chrome-devtools MCP to
check a page. `capture` returns what the user actually sees, inside the viewer's
own chrome; an external render is a different picture and judging it wastes a
loop.

## Core rules

### The content-set layout is the contract

One topic is one content set — a top-level directory in the workspace:

```
<topic-slug>/
├── manifest.json            # the ladder
├── pages/<audience-id>.html # one self-contained page per audience
└── assets/                  # optional images referenced by the pages
```

`manifest.json` has exactly this shape:

```json
{
  "title": "What is a database index?",
  "topic": "database-index",
  "language": "en",
  "audiences": [
    { "id": "age-5",    "label": "Age 5",    "file": "pages/age-5.html",    "tone": "playful, toy-box analogies" },
    { "id": "manager",  "label": "Manager",  "file": "pages/manager.html",  "tone": "memo, impact and cost" },
    { "id": "engineer", "label": "Engineer", "file": "pages/engineer.html", "tone": "precise, mechanics and trade-offs" }
  ]
}
```

- `title` and `audiences` are required; `topic` and `language` are optional but
  worth filling — `language` tells you which language the pages are written in
  when you come back to the explainer in a later session.
- `file` is **set-relative and includes the `pages/` prefix**. A bare filename
  does not resolve, and the rung renders empty.
- `id` is a kebab-case slug and is the only handle the viewer, your locator
  cards, and `navigate-to` have on that page. Keep it stable once written —
  renaming an id breaks every locator card already sitting in the transcript.
- `label` is what the user reads on the rung. Write it in the same language as
  the pages.
- `tone` is a short note to your future self about the register you chose. It
  is not rendered; it is how a later session picks up the same voice.

**Order in `audiences[]` is ladder order — simplest first, most technical
last.** The whole point of the rail is that climbing it feels like climbing.
Adding an audience means inserting it at the rung where it belongs, not
appending it.

Always write inside a content-set directory. A `pages/manager.html` at the
workspace root belongs to no explainer and appears in nothing.

### Pages are whole documents, not slides

Each page is a **complete, standalone HTML document** — `<!DOCTYPE html>`,
`<head>`, `<style>`, `<body>` — with all its CSS inline in that `<style>`
block. The viewer renders it as-is and injects no theme, so a page that relies
on an external stylesheet renders naked.

Pages **scroll**. Unlike Slide Mode there is no fixed canvas and no overflow
problem: design a readable document with a comfortable measure (60–75
characters), and let it run two to four screens if the content earns it. Use
`max-width` on a centred container rather than absolute positioning, so the
page holds up when the user narrows the panel or turns on compare mode (each
pane is roughly half width).

Google Fonts via `<link>` or `@import` are fine, but always name real fallbacks
in the stack — and for Chinese, Japanese, or Korean pages put the CJK system
faces (`"PingFang SC"`, `"Noto Sans SC"`, `"Microsoft YaHei"`) in the stack
ahead of the generic family, or the text renders in a fallback that ruins the
register you chose.

Decorate with CSS and inline SVG. Emoji are acceptable *inside* a young child's
page content when one genuinely carries meaning; they do not belong in headings,
in navigation, or in any page above the kid rung, where they read as filler.

### Same truth, different register — never a different accuracy

Every rung explains the same thing. What changes is vocabulary, analogy,
density, framing, and visual design. What does not change is whether the
explanation is *true*. Simplifying ruthlessly for a five-year-old is right —
getting the core idea across at 80% resolution beats a 100% correct explanation
that loses them. Inventing a mechanism that does not exist is not
simplification; it is a page the user will be embarrassed to show anyone.

Never talk down. A five-year-old's page should feel delightful, not
condescending. A manager's page should feel empowering, not dismissive of their
intelligence — they are not "the non-technical one", they are the person who
owns a different set of concerns. If a rung reads like an apology for the
reader's ignorance, rewrite it.

### The shape of an explanation

Each page, at every rung, moves through the same four beats — the beats just
change size:

1. **What it is** — one sentence that captures the essence, before any
   machinery.
2. **An analogy** — connect to something this audience already lives with.
   The analogy domain is the single biggest lever you have; see
   `{SKILL_PATH}/references/audience-calibration.md`.
3. **The details** — layers, added only as far as this audience wants them.
4. **The so-what** — why it matters *to them*. This is the beat most often
   dropped, and its absence is what makes an explanation feel like a lecture.

When explaining code, explain the *purpose* before the mechanism. Nobody cares
about syntax until they know why the code exists.

### Visual register — how each audience's page should look

The upstream ELI5 skill calibrated words. Here you also calibrate the page, and
a mismatch is loud: a five-year-old's explanation set in 15px grey Helvetica
reads as homework, and a manager's memo in bubbly rounded type reads as a joke.
Pick the row, then design deliberately within it.

| Audience | Type | Palette | Density & rhythm | Decoration |
|---|---|---|---|---|
| **Young child (4–9)** | Rounded sans (Baloo 2, Nunito, Quicksand). Body 22–28px, headings 48–72px. Generous line-height (1.7+). | Bright and saturated on a warm off-white — 3–4 crayon-box colours, high contrast. | Very short paragraphs, one idea per block. Lots of air. Under one screen of real text. | Big CSS/SVG shapes, colour blocks, a numbered story strip. One meaningful emoji is fine. |
| **Teenager (10–17)** | Confident geometric sans. Body 18–20px, big punchy headings. | Bold and a little loud — one strong accent on a light or dark ground. | Skimmable: short sections, pull quotes, a comparison strip. | Sticker-ish badges, chunky borders, an accent underline. No cutesy shapes. |
| **General adult / family (parents, partner, grandparents)** | Warm serif or humanist sans (Lora, Source Serif, Charter). Body 19–21px, line-height 1.8. | Soft, low-saturation, warm neutrals. Nothing that flashes. | Roomy and calm — generous margins, clear section breaks, big enough for tired eyes. | Almost none. A rule, a soft card, a single hand-drawn-feeling SVG. |
| **Business (manager, director, PM)** | Neutral professional sans (Inter, Source Sans). Body 16–17px, tight headings. | Restrained — one accent for emphasis, one warning tint for risk. | Memo-shaped: the answer in the first screen, then a scannable body. Numbers get their own tiles. | Impact callouts, a cost/benefit table, a decision box. Quantify or cut it. |
| **Technical (engineer, grad student)** | Clean sans for prose + a real mono for code (JetBrains Mono, IBM Plex Mono). Body 15–16px. | Cool and precise — muted ground, syntax-ish accents, a single highlight colour. | Dense is fine. Code blocks, complexity notes, an explicit trade-offs section. | Diagrams as inline SVG, annotated code, comparison tables. No illustration. |
| **Designer** | Editorial pairing, strong type contrast. | Deliberate palette; the page itself demonstrates taste. | Visual-first: flows, before/after, spatial layout over prose. | Diagrams of interaction and state, generous figure treatment. |

These are starting points, not uniforms. If the topic or the user's own taste
pulls elsewhere, follow it — but pull *deliberately*, and keep the rungs of one
ladder visibly distinct from each other. If two pages in the same explainer
look the same, the ladder has nothing to show.

{{#imageGenEnabled}}
### Optional illustrations

An image generation script lives at `{SKILL_PATH}/scripts/generate_image.mjs`.
Reach for it when a rung genuinely needs a picture that CSS and SVG cannot
make — a warm illustration on a kid's page, a scene on a family page. Skip it
for business and technical rungs, where a table or an SVG diagram is both
faster and more informative.

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "A friendly cartoon illustration of a toy box with labelled drawers, flat vector style, bright primary colours on cream, thick outlines, no text" \
  --aspect-ratio 4:3 \
  --quality high \
  --output-format png \
  --output-dir <workspace>/<topic-slug>/assets \
  --filename-prefix age-5-toybox
```

- The prompt is a **positional argument** — there is no `--prompt` flag, and
  passing one silently swallows your prompt as a second positional.
- **Do not pass `--style`.** It is not a switch: it rewrites your prompt by
  appending style text before dispatch, which fights any style you already
  wrote into the prompt. Write the style into the prompt and leave the flag
  alone.
- Default model is `gpt-image-2` (fal.ai only), strongest at legible text and
  labels. If only `OPENROUTER_API_KEY` is configured, pass
  `--model gemini-3-pro`; `gpt-image-2` will error out without a fal.ai key.
- `--output-dir` is always the explainer's own `assets/` directory, so the page
  can reference it as `assets/<file>.png`.
- Generating for several rungs of one ladder? Reuse the same style descriptor
  sentences verbatim across prompts, or the explainer stops looking like one
  piece of work.
{{/imageGenEnabled}}

## Workflow

### Writing a new explainer

1. **Identify the audiences.** Read the request for who this is for — "for my
   manager", "for a 10-year-old", "for the backend team". If the user names one
   audience, build a one-rung ladder; that is a perfectly good explainer and
   you can offer to extend it after. If they name none, build the default
   three-rung ladder — **age 5 → manager → engineer** — because that spread
   shows the user what the mode does and lets them point at the rung they
   actually wanted. Map each named audience onto a row of
   `{SKILL_PATH}/references/audience-calibration.md` before writing; that is
   where the analogy domain and framing come from.
2. **Read the source material first.** Code, an error, a doc, a link — open it
   and understand it before translating it. An explanation written from the
   name of a thing rather than the thing itself is where confident wrong pages
   come from. For an error, find the root cause, not the surface text; for
   code, work out what it is *for* before how it works.
3. **Pick the content-set slug** — kebab-case, topic-shaped (`database-index`,
   `oauth-pkce`, `why-the-build-is-slow`). New topic means a new directory;
   never overwrite an existing explainer or a seed to make room.
4. **Write `manifest.json` first,** with the full `audiences[]` array in ladder
   order. The rail appears immediately and the user can watch the pages arrive.
5. **Write the pages in ladder order,** one file per rung. Take the register
   row from the table above and commit to it — the simplest rung sets the tone
   the ladder will contrast against. Keep the four beats in every page.
6. **Land the user on it.** Invoke `navigate-to` for the rung you consider the
   best entry point (usually the first, or the one they asked for), then drop a
   `<viewer-locator>` card per rung in your reply.
7. **Offer the next move.** Another audience? A compare view of two rungs? A
   shorter version? One sentence, not a menu.

### Editing an existing page

1. **Resolve the target** from the `Address:` line in `<viewer-context>` — do
   not assume they mean the rung you last touched.
2. **Read the page** before editing it. These are hand-designed documents;
   blind edits break layout the user liked.
3. **Edit narrowly.** Fix the rung they pointed at. If the same fix belongs on
   every rung (a factual correction, a renamed product), say so and apply it
   across the ladder in one pass — a wrong fact fixed on one page and left on
   two is worse than not fixing it.
4. **Keep the register.** A "make it shorter" on the engineer page is not an
   invitation to make it read like the manager page.
5. **Verify visually** with `capture` when the change was structural, then
   `navigate-to` the edited rung.

### Adding a rung to an existing ladder

1. Read the existing `manifest.json` and at least the two rungs the new one
   will sit between — the new page has to feel like a step, not a fork.
2. Insert the entry at the right index in `audiences[]`, not at the end.
3. Write the page in the register its position implies, then `navigate-to` it.

## Commands

This mode declares no viewer commands. Everything the user asks for arrives as
ordinary chat, usually with a `<viewer-context>` block naming what they were
looking at.

## References

Read when you need depth. Loaded into context only when you open the file.

| Topic | File | Read when |
|---|---|---|
| Audience taxonomy — ages, grade levels, job roles, relationships; vocabulary, analogy domains, framing, tone, and the page visual register for each | `{SKILL_PATH}/references/audience-calibration.md` | Before writing any page, and any time an audience is one you have not calibrated for in this session. |
