---
name: pneuma-webcraft
description: >
  Pneuma WebCraft Mode workspace guidelines with Impeccable.style design intelligence.
  Use for ANY web design or development task: building pages, components, layouts,
  styling, animations, responsive design, accessibility, performance optimization,
  design system extraction, UX writing, and visual refinement.
  This skill defines how the live-preview environment works, the Impeccable design
  principles to follow, and the 22 design commands available.
  Consult before your first edit in a new conversation.
---

# Pneuma WebCraft Mode — Web Design with Impeccable.style

WebCraft is a live web development surface backed by Impeccable.style design intelligence: a comprehensive set of design principles and commands that help you produce distinctive, production-grade frontend interfaces. The user watches an iframe preview render your edits in real time, and a toolbar exposes 22 Impeccable design commands for structured passes.

## Core Principles

1. **Act, don't ask**: For straightforward edits, just do them. Only ask for clarification on ambiguous requests
2. **Incremental edits**: Make focused changes — the user sees each edit live as you make it
3. **Design with intention**: Every visual choice should be deliberate. Avoid generic "AI slop" aesthetics
4. **Quality over speed**: Production-grade code with exceptional attention to aesthetic details
5. **Follow Impeccable.style**: avoid AI slop aesthetics, commit to bold design directions
6. **Honor commands**: when the user invokes an Impeccable command (audit, critique, polish, etc.), follow the corresponding command reference

## File Conventions

- The workspace contains web files (`.html`, `.css`, `.js`, `.jsx`, `.ts`, `.tsx`, `.json`, `.svg`, etc.)
- Edit existing files or create new ones as requested — the user sees updates in real-time via iframe preview
- Use modern, semantic HTML5 with proper accessibility
- Prefer CSS custom properties for theming and consistency
- Keep files organized — separate concerns when complexity warrants it
- Preserve existing structure unless asked to reorganize

## Importing External Content

When the user provides original content (uploaded files, pasted HTML, or a URL to convert), **always create a new content set** for it before making any edits:

1. Choose a short descriptive name for the content set (e.g. `portfolio/`, `landing-page/`)
2. Create the directory and place the imported files inside it (with a `manifest.json`)
3. Then begin editing within that content set

**Why**: the workspace is organized around content sets — each is a self-contained, switchable project. Importing into a content set (rather than dumping files at the root) preserves the seed templates, enables side-by-side comparison between sets, and ensures all built-in features (set switching, per-set theming, export) work correctly.

## Locator cards

After creating or editing pages, embed locator cards so the user can jump to them.

- Navigate to a page: `data='{"page":"about.html"}'`
- Switch content set: `data='{"contentSet":"site-2"}'`
- Switch content set and page in one click: `data='{"contentSet":"site-2","page":"about.html"}'`

## Multi-Page Sites

For sites with multiple pages, create a `manifest.json` so the viewer shows page tabs at the bottom:

```json
{
  "title": "My Project",
  "pages": [
    { "file": "index.html", "title": "Home" },
    { "file": "about.html", "title": "About" },
    { "file": "contact.html", "title": "Contact" }
  ]
}
```

- Use `pages` array with `file` (path) and `title` (display name) for each entry
- The first page is shown by default
- Update the manifest whenever you add or remove pages

{{#imageGenEnabled}}
## Image Generation

Two scripts live under `{SKILL_PATH}/scripts/`:
- `generate_image.mjs` — text-to-image (and precise URL+mask edits via GPT-Image-2)
- `edit_image.mjs` — modify an existing local image with an optional highlighter annotation (Gemini vision via OpenRouter)

Default model is `gpt-image-2`. It is especially strong at the things webcraft reaches for often: legible typography, labels, landing-page mockups with real copy, signage, wordmark-style logos, and diagrams with text. Switch to `--model gemini-3-pro` for painterly / watercolor / broad artistic illustration, or when only `OPENROUTER_API_KEY` is configured (`gpt-image-2` is fal.ai-only and will error out otherwise).

### When to Generate vs. Code Visuals

Webcraft can render many things with HTML/CSS/SVG. Generate an image **only when the asset can't plausibly be composed from code**:

| Want | Use |
|---|---|
| Geometric shapes, icons, gradients, patterns, decorative lines | CSS / SVG / `<canvas>` — faster, responsive, theme-aware |
| A photograph, a painterly illustration, a mood image, a hand-made texture | Generate |
| A product-shot mockup (phone, laptop, poster) with real copy on screen | Generate (`gpt-image-2` — it renders legible text) |
| A logo or wordmark concept to iterate on | Generate with clear typography + mark direction |
| "Hero abstract 3D gradient swoosh thing" | **Stop.** See the Image Slop Test below. |

### The Image Slop Test

You already know the AI Slop Test for design — the same reflex applies to imagery. Before you call the generator, predict how the image will read. If the honest answer is *"this looks like every AI hero image on every AI landing page from 2024"*, that's the problem.

Reflex images to reject — your training-data defaults:
- Glowing translucent orbs, neon-halo spheres, "data crystal" shapes floating on dark space
- Purple-to-blue / cyan-on-dark gradient backgrounds
- Abstract flowing 3D ribbons, iridescent swooshes, soap-bubble metaballs
- Isometric flat-vector "dashboard with colorful chart widgets" hero illustrations
- Generic "person at laptop with floating UI elements" stock images
- AI-rendered people with that waxy plastic skin + perfect symmetrical eyes look

These are the visual equivalent of the `reflex_fonts_to_reject` list. Reject them every time. Look further.

### Prompt Discipline: Reinforce, Don't Contradict, the Design Direction

An image in a webcraft project has to live next to the site's typography, color system, and voice. If the site is a brutalist concrete manifesto and the hero image is a pastel unicorn, you've failed. Before typing the prompt:

1. **Read `.impeccable.md` / CLAUDE.md Design Context** (tone, audience, brand personality). If none exists, run `teach` first — same rule as any other design work.
2. **Name the project's 3 brand words** (same words you used for font selection) — e.g. "warm and mechanical and opinionated".
3. **Translate them into image language** — medium, palette, composition, era, physical analog.
4. **Write the prompt** with those translations baked in. Examples:
   - *warm and mechanical and opinionated* → "A close-up photograph of a 1970s bakelite control panel with amber tungsten indicator lamps, shallow depth of field, warm incandescent light, film-grain texture, muted earth-tone palette."
   - *calm and clinical and careful* → "A soft-focus overhead photograph of a matte ceramic dish on pale linen, diffuse north-facing daylight, restrained cold-neutral palette (pale stone, off-white, a single shadow), minimal composition."
   - *handmade and a little weird* → "A Risograph-style illustration of a pair of mismatched scissors floating on a flat mustard-yellow ground, visible misregistration between pink and blue plates, low-fi charm."

### Palette Matching

Match the image's palette to the site's theme. Write palette descriptors in prompts using concrete visual references rather than hex codes — models respond better to "muted clay red, bone white, a single cold-steel accent" than to `oklch(0.55 0.15 30)`. If the site uses OKLCH custom properties, paraphrase them for the prompt, don't paste them in.

### How to Call It

Most text-to-image calls look like this. Run from the skill's directory so `.env` is picked up:

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your context-matched prompt here" \
  --aspect-ratio 16:9 \
  --quality high \
  --output-format png \
  --output-dir <workspace-relative>/<content-set>/assets \
  --filename-prefix hero-context
```

Webcraft-specific flag guidance:

| Flag | Guidance |
|---|---|
| `--model` | Default `gpt-image-2`. Switch to `--model gemini-3-pro` for painterly / watercolor / broad artistic illustration, or when only OpenRouter is configured. |
| `--aspect-ratio` | `16:9` for hero banners above the fold, `4:3` or `3:2` for content images and card thumbs, `1:1` for avatars and icon-sized art, `9:16` for mobile-first hero or vertical feature images. |
| `--quality` | `high` for anything the user will actually look at; drop to `medium` for draft passes while iterating prompts. GPT-Image-2 only. |
| `--output-format` | `png` for illustrations or anything needing clean edges and legible text; `jpeg` for photographs; `webp` when size matters more than max fidelity. |
| `--output-dir` | Always the active content set's `assets/` directory. |
| `--filename-prefix` | Describe the image's role: `hero-context-lab`, `about-team-portrait`, `logo-wordmark-v1`. |

For edits on an already-deployed / uploaded image, prefer `--image-urls <url> --mask-url <url>` against `gpt-image-2` — it respects text and layout much better than Gemini vision. The annotation-driven `edit_image.mjs` is for the *local file + highlighter* flow (takes `--input <path>` and optional `--annotation <path>`).

### After Generating

- Reference the image with a semantic element (`<img>` with meaningful `alt`, or `<picture>` when you need art direction across breakpoints).
- Add `loading="lazy"` for anything below the fold; add `decoding="async"` to hero images.
- Give the image a sensible `max-width` and `aspect-ratio` in CSS so layout doesn't jump while it loads.
- If you produced 2+ candidates (via `--num-images`), wire both up behind a comment so the user can pick — don't silently discard.

### Consistency Across a Series

When generating multiple images for one site (hero + about + feature cards), record your style descriptors on the first call and reuse them verbatim on subsequent calls. The viewer lives next to the prompts; drifting midway through a batch is how decks start looking stitched-together.
{{/imageGenEnabled}}

---

## Editing Guidelines

- Use the `Edit` tool (preferred) for surgical changes to existing content
- Use the `Write` tool for creating new files or full rewrites
- Make focused, incremental edits — the user sees changes live, so each edit should leave files in a valid state
- Preserve existing content structure unless asked to reorganize

## Context Format

When the user sends a message, they may be viewing a specific file in the iframe preview. Context includes:
- `file="index.html"` — which file the user is viewing
- `Selected: section.hero > div.card:nth-child(2)` — which element they clicked/selected
- `Element: button "Submit"` — human-readable element description
- `Tag: <button>` — the HTML tag
- `Classes: btn btn-primary` — CSS classes on the element

Use this to resolve references like "this section", "this button", "here", etc.

## Constraints

- Do not modify `.claude/` directory contents — managed by the runtime
- Do not run long-running background processes
- Do not ask for confirmation before simple edits — just do them

---

## Impeccable.style Design Intelligence

This skill integrates the Impeccable.style design system. Follow these principles for ALL frontend work.

### Context Gathering Protocol

Design skills produce generic output without project context. You MUST have confirmed design context before doing any design work.

**Required context** — every design skill needs at minimum:
- **Target audience**: Who uses this product and in what context?
- **Use cases**: What jobs are they trying to get done?
- **Brand personality/tone**: How should the interface feel?

Individual commands may require additional context — check the command's preparation section for specifics.

**CRITICAL**: You cannot infer this context by reading the codebase. Code tells you what was built, not who it's for or what it should feel like. Only the creator can provide this context.

**Gathering order:**
1. **Check current instructions (instant)**: If `CLAUDE.md` already contains a **Design Context** section, proceed immediately.
2. **Check .impeccable.md / PRODUCT.md (fast)**: If not in instructions, read `.impeccable.md` (or `PRODUCT.md`, the upstream v3.0 successor) from the project root. If either exists and contains the required context, proceed.
3. **Run the `teach` command (REQUIRED)**: If neither source has context, you MUST run the `teach` command NOW before doing anything else. Do NOT skip this step. Do NOT attempt to infer context from the codebase instead.

### Register: brand vs product

Every design task is one of two registers — identify before designing:

- **Brand** — design IS the product. Marketing sites, landing pages, campaign pages, portfolios, long-form content. The visitor's impression IS the deliverable. Distinctive, opinionated, willing to risk strangeness. → consult [brand reference](references/brand.md) for typography, palette commitment, layout license.
- **Product** — design SERVES the product. App UI, dashboards, settings panels, data tables, anything where the user is in a task. Earned familiarity beats novelty; the tool should disappear into the work. → consult [product reference](references/product.md) for system fonts, single-family typography, fixed scales, restrained palette defaults.

Priority for detection: (1) cue in the task itself ("landing page" vs "dashboard"); (2) the surface in focus (the page/route/file being edited); (3) the `register` field in `.impeccable.md` / `PRODUCT.md` if present. First match wins.

The shared design laws below apply to both registers; the register reference adjusts the dial.

### Design Direction

Commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

Then implement working code that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

### Frontend Aesthetics Guidelines

#### Typography
> *Consult [typography reference](references/typography.md) for OpenType features, web font loading, and the deeper material on scales.*

Choose fonts that are beautiful, unique, and interesting. Pair a distinctive display font with a refined body font.

<typography_principles>
Always apply these — do not consult a reference, just do them:

- Use a modular type scale with fluid sizing (clamp) for headings on marketing/content pages. Use fixed `rem` scales for app UIs and dashboards (no major design system uses fluid type in product UI).
- Use fewer sizes with more contrast. A 5-step scale with at least a 1.25 ratio between steps creates clearer hierarchy than 8 sizes that are 1.1× apart.
- Line-height scales inversely with line length. Narrow columns want tighter leading, wide columns want more. For light text on dark backgrounds, ADD 0.05-0.1 to your normal line-height — light type reads as lighter weight and needs more breathing room.
- Cap line length at ~65-75ch. Body text wider than that is fatiguing.
</typography_principles>

<font_selection_procedure>
DO THIS BEFORE TYPING ANY FONT NAME.

The model's natural failure mode is "I was told not to use Inter, so I will pick my next favorite font, which becomes the new monoculture." Avoid this by performing the following procedure on every project, in order:

Step 1. Read the brief once. Write down 3 concrete words for the brand voice (e.g., "warm and mechanical and opinionated", "calm and clinical and careful", "fast and dense and unimpressed", "handmade and a little weird"). NOT "modern" or "elegant" — those are dead categories.

Step 2. List the 3 fonts you would normally reach for given those words. Write them down. They are most likely from this list:

<reflex_fonts_to_reject>
Fraunces
Newsreader
Lora
Crimson
Crimson Pro
Crimson Text
Playfair Display
Cormorant
Cormorant Garamond
Syne
IBM Plex Mono
IBM Plex Sans
IBM Plex Serif
Space Mono
Space Grotesk
Inter
DM Sans
DM Serif Display
DM Serif Text
Outfit
Plus Jakarta Sans
Instrument Sans
Instrument Serif
</reflex_fonts_to_reject>

Reject every font that appears in the reflex_fonts_to_reject list. They are your training-data defaults and they create monoculture across projects.

Step 3. Browse a font catalog with the 3 brand words in mind. Sources: Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim Type Foundry, Velvetyne. Look for something that fits the brand as a *physical object* — a museum exhibit caption, a hand-painted shop sign, a 1970s mainframe terminal manual, a fabric label on the inside of a coat, a children's book printed on cheap newsprint. Reject the first thing that "looks designy" — that's the trained reflex too. Keep looking.

Step 4. Cross-check the result. The right font for an "elegant" brief is NOT necessarily a serif. The right font for a "technical" brief is NOT necessarily a sans-serif. The right font for a "warm" brief is NOT Fraunces. If your final pick lines up with your reflex pattern, go back to Step 3.
</font_selection_procedure>

<typography_rules>
DO use a modular type scale with fluid sizing (clamp) on headings.
DO vary font weights and sizes to create clear visual hierarchy.
DO vary your font choices across projects. If you used a serif display font on the last project, look for a sans, monospace, or display face on this one.

DO NOT use overused fonts like Inter, Roboto, Arial, Open Sans, or system defaults — but also do not simply switch to your second-favorite. Every font in the reflex_fonts_to_reject list above is banned. Look further.
DO NOT use monospace typography as lazy shorthand for "technical/developer" vibes.
DO NOT put large icons with rounded corners above every heading. They rarely add value and make sites look templated.
DO NOT use only one font family for the entire page. Pair a distinctive display font with a refined body font.
DO NOT use a flat type hierarchy where sizes are too close together. Aim for at least a 1.25 ratio between steps.
DO NOT set long body passages in uppercase. Reserve all-caps for short labels and headings.
</typography_rules>

#### Color & Theme
> *Consult [color reference](references/color-and-contrast.md) for the deeper material on contrast, accessibility, and palette construction.*

Commit to a cohesive palette. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

<color_principles>
Always apply these — do not consult a reference, just do them:

- Use OKLCH, not HSL. OKLCH is perceptually uniform: equal steps in lightness *look* equal, which HSL does not deliver. As you move toward white or black, REDUCE chroma — high chroma at extreme lightness looks garish. A light blue at 85% lightness wants ~0.08 chroma, not the 0.15 of your base color.
- Tint your neutrals toward your brand hue. Even a chroma of 0.005-0.01 is perceptible and creates subconscious cohesion between brand color and UI surfaces. The hue you tint toward should come from THIS brand, not from a "warm = friendly" or "cool = tech" formula. Pick the brand's actual hue first, then tint everything toward it.
- The 60-30-10 rule is about visual *weight*, not pixel count. 60% neutral / surface, 30% secondary text and borders, 10% accent. Accents work BECAUSE they're rare. Overuse kills their power.
</color_principles>

<color_strategy>
Pick a **color strategy** before picking colors. Four steps on the commitment axis — chosen by register and brief, not defaulted to:

- **Restrained** — tinted neutrals + one accent ≤10% of surface area. Product default; brand minimalism.
- **Committed** — one saturated color carries 30–60% of the surface. Brand default for identity-driven pages.
- **Full palette** — 3–4 named roles, each used deliberately. Brand campaigns; product data viz.
- **Drenched** — the surface IS the color. Brand heroes, campaign pages.

The "one accent ≤10%" rule is Restrained only. Committed / Full palette / Drenched exceed it on purpose. Don't collapse every design to Restrained by reflex.
</color_strategy>

<theme_selection>
Theme (light vs dark) should be DERIVED from audience and viewing context, not picked from a default. Read the brief and ask: when is this product used, by whom, in what physical setting?

- A perp DEX consumed during fast trading sessions → dark
- A hospital portal consumed by anxious patients on phones late at night → light
- A children's reading app → light
- A vintage motorcycle forum where users sit in their garage at 9pm → dark
- An observability dashboard for SREs in a dark office → dark
- A wedding planning checklist for couples on a Sunday morning → light
- A music player app for headphone listening at night → dark
- A food magazine homepage browsed during a coffee break → light

Do not default everything to light "to play it safe." Do not default everything to dark "to look cool." Both defaults are the lazy reflex. The correct theme is the one the actual user wants in their actual context.
</theme_selection>

<color_rules>
DO use modern CSS color functions (oklch, color-mix, light-dark) for perceptually uniform, maintainable palettes.
DO tint your neutrals toward your brand hue. Even a subtle hint creates subconscious cohesion.

DO NOT use gray text on colored backgrounds; it looks washed out. Use a shade of the background color instead.
DO NOT use pure black (#000) or pure white (#fff). Always tint; pure black/white never appears in nature.
DO NOT use the AI color palette: cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds.
DO NOT use gradient text for impact — see <absolute_bans> below for the strict definition. Solid colors only for text.
DO NOT default to dark mode with glowing accents. It looks "cool" without requiring actual design decisions.
DO NOT default to light mode "to be safe" either. The point is to choose, not to retreat to a safe option.
</color_rules>

#### Layout & Space
> *Consult [spatial reference](references/spatial-design.md) for the deeper material on grids, container queries, and optical adjustments.*

Create visual rhythm through varied spacing, not the same padding everywhere. Embrace asymmetry and unexpected compositions. Break the grid intentionally for emphasis.

<spatial_principles>
Always apply these — do not consult a reference, just do them:

- Use a 4pt spacing scale with semantic token names (`--space-sm`, `--space-md`), not pixel-named (`--spacing-8`). Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. 8pt is too coarse — you'll often want 12px between two values.
- Use `gap` instead of margins for sibling spacing. It eliminates margin collapse and the cleanup hacks that come with it.
- Vary spacing for hierarchy. A heading with extra space above it reads as more important — make use of that. Don't apply the same padding everywhere.
- Self-adjusting grid pattern: `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` is the breakpoint-free responsive grid for card-style content.
- Container queries are for components, viewport queries are for page layout. A card in a sidebar should adapt to the sidebar's width, not the viewport's.
</spatial_principles>

<spatial_rules>
DO create visual rhythm through varied spacing: tight groupings, generous separations.
DO use fluid spacing with clamp() that breathes on larger screens.
DO use asymmetry and unexpected compositions; break the grid intentionally for emphasis.

DO NOT wrap everything in cards. Not everything needs a container.
DO NOT nest cards inside cards. Visual noise; flatten the hierarchy.
DO NOT use identical card grids (same-sized cards with icon + heading + text, repeated endlessly).
DO NOT use the hero metric layout template (big number, small label, supporting stats, gradient accent).
DO NOT center everything. Left-aligned text with asymmetric layouts feels more designed.
DO NOT use the same spacing everywhere. Without rhythm, layouts feel monotonous.
DO NOT let body text wrap beyond ~80 characters per line. Add a max-width like 65–75ch so the eye can track easily.
</spatial_rules>

#### Visual Details

<absolute_bans>
These CSS patterns are NEVER acceptable. They are the most recognizable AI design tells. Match-and-refuse: if you find yourself about to write any of these, stop and rewrite the element with a different structure entirely.

BAN 1: Side-stripe borders on cards/list items/callouts/alerts
  - PATTERN: `border-left:` or `border-right:` with width greater than 1px
  - INCLUDES: hard-coded colors AND CSS variables
  - FORBIDDEN: `border-left: 3px solid red`, `border-left: 4px solid #ff0000`, `border-left: 4px solid var(--color-warning)`, `border-left: 5px solid oklch(...)`, etc.
  - WHY: this is the single most overused "design touch" in admin, dashboard, and medical UIs. It never looks intentional regardless of color, radius, opacity, or whether the variable name is "primary" or "warning" or "accent."
  - REWRITE: use a different element structure entirely. Do not just swap to box-shadow inset. Reach for full borders, background tints, leading numbers/icons, or no visual indicator at all.

BAN 2: Gradient text
  - PATTERN: `background-clip: text` (or `-webkit-background-clip: text`) combined with a gradient background
  - FORBIDDEN: any combination that makes text fill come from a `linear-gradient`, `radial-gradient`, or `conic-gradient`
  - WHY: gradient text is decorative rather than meaningful and is one of the top three AI design tells
  - REWRITE: use a single solid color for text. If you want emphasis, use weight or size, not gradient fill.
</absolute_bans>

DO: Use intentional, purposeful decorative elements that reinforce brand.
DO NOT: Use border-left or border-right greater than 1px as a colored accent stripe on cards, list items, callouts, or alerts. See <absolute_bans> above for the strict CSS pattern.
DO NOT: Use glassmorphism everywhere (blur effects, glass cards, glow borders used decoratively rather than purposefully).
DO NOT: Use sparklines as decoration. Tiny charts that look sophisticated but convey nothing meaningful.
DO NOT: Use rounded rectangles with generic drop shadows. Safe, forgettable, could be any AI output.
DO NOT: Use modals unless there's truly no better alternative. Modals are lazy.

#### Motion
> *Consult [motion reference](references/motion-design.md) for timing, easing, and reduced motion.*

Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions.

**DO**: Use motion to convey state changes — entrances, exits, feedback
**DO**: Use exponential easing (ease-out-quart/quint/expo) for natural deceleration
**DO**: For height animations, use grid-template-rows transitions instead of animating height directly
**DON'T**: Animate layout properties (width, height, padding, margin). Use transform and opacity only
**DON'T**: Use bounce or elastic easing. They feel dated and tacky; real objects decelerate smoothly

#### Interaction
> *Consult [interaction reference](references/interaction-design.md) for forms, focus, and loading patterns.*

Make interactions feel fast. Use optimistic UI — update immediately, sync later.

**DO**: Use progressive disclosure. Start simple, reveal sophistication through interaction (basic options first, advanced behind expandable sections; hover states that reveal secondary actions)
**DO**: Design empty states that teach the interface, not just say "nothing here"
**DO**: Make every interactive surface feel intentional and responsive
**DON'T**: Repeat the same information (redundant headers, intros that restate the heading)
**DON'T**: Make every button primary. Use ghost buttons, text links, secondary styles; hierarchy matters

#### Responsive
> *Consult [responsive reference](references/responsive-design.md) for mobile-first, fluid design, and container queries.*

**DO**: Use container queries (@container) for component-level responsiveness
**DO**: Adapt the interface for different contexts, not just shrink it
**DON'T**: Hide critical functionality on mobile. Adapt the interface, don't amputate it

#### UX Writing
> *Consult [ux-writing reference](references/ux-writing.md) for labels, errors, and empty states.*

**DO**: Make every word earn its place
**DON'T**: Repeat information users can already see

### Absolute bans

Match-and-refuse. If you're about to write any of these, rewrite the element with different structure:

- **Side-stripe borders.** `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts. Never intentional. Rewrite with full borders, background tints, leading numbers/icons, or nothing.
- **Gradient text.** `background-clip: text` combined with a gradient background. Decorative, never meaningful. Use a single solid color. Emphasis via weight or size.
- **Glassmorphism as default.** Blurs and glass cards used decoratively. Rare and purposeful, or nothing.
- **The hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly.
- **Modal as first thought.** Modals are usually laziness. Exhaust inline / progressive alternatives first.
- **Em dashes in copy.** Use commas, colons, semicolons, periods, or parentheses. Also not `--`.

### The AI Slop Test

**Critical quality check**: If you showed this interface to someone and said "AI made this," would they believe you immediately? If yes, that's the problem.

A distinctive interface should make someone ask "how was this made?" not "which AI made this?"

Review the DON'T guidelines above — they are the fingerprints of AI-generated work from 2024-2025.

**Category-reflex check.** If someone could guess the theme and palette from the category name alone — "observability → dark blue", "healthcare → white + teal", "finance → navy + gold", "crypto → neon on black" — it's the training-data reflex. Rework the scene sentence and color strategy until the answer is no longer obvious from the domain.

### Implementation Principles

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices across generations.

Remember: Claude is capable of extraordinary creative work. Don't hold back — show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

---

## Impeccable Commands

The user invokes these commands from the toolbar. When a command is invoked, follow the corresponding reference document. The available commands are:

### Setup
- **teach** — Gather design context for the project and save persistent guidelines to `.impeccable.md`. Reference: [cmd-teach](references/cmd-teach.md)
- **document** — Generate a `DESIGN.md` at the project root capturing the current visual design system in Google Stitch format, so future agents stay on-brand. Reference: [cmd-document](references/cmd-document.md)

### Plan
- **shape** — Run a discovery interview and produce a design brief before any code is written. Reference: [cmd-shape](references/cmd-shape.md)
- **craft** — Shape-then-build: run the discovery flow, then implement the feature in one pass. Reference: [cmd-craft](references/cmd-craft.md)

### Review
- **audit** — Comprehensive quality audit across accessibility, performance, theming, and responsive design. Reference: [cmd-audit](references/cmd-audit.md)
- **critique** — Holistic UX design critique evaluating hierarchy, architecture, and emotional resonance. Reference: [cmd-critique](references/cmd-critique.md)

### Refine
- **polish** — Final quality pass aligning the feature to the design system — fixes spacing, consistency, and drift before shipping. Reference: [cmd-polish](references/cmd-polish.md)
- **distill** — Strip design to its essence by removing unnecessary complexity. Reference: [cmd-distill](references/cmd-distill.md)
- **clarify** — Improve unclear UX copy, error messages, labels, and instructions. Reference: [cmd-clarify](references/cmd-clarify.md)
- **typeset** — Improve typography: font selection, modular scale, weight, rhythm, and readability. Reference: [cmd-typeset](references/cmd-typeset.md)
- **layout** — Improve layout, spacing, and visual rhythm — fix monotonous grids and weak hierarchy. Reference: [cmd-layout](references/cmd-layout.md)

### Performance
- **optimize** — Improve performance across loading, rendering, animations, and bundle size. Reference: [cmd-optimize](references/cmd-optimize.md)
- **harden** — Make interfaces production-ready: error handling, empty states, onboarding flows, i18n, text overflow, and edge cases. Reference: [cmd-harden](references/cmd-harden.md)
- **onboard** — Design first-run flows, empty states, and activation moments that get users to value quickly. Reference: [cmd-onboard](references/cmd-onboard.md)

### Style
- **animate** — Add purposeful animations, micro-interactions, and motion effects. Reference: [cmd-animate](references/cmd-animate.md)
- **colorize** — Add strategic color to monochromatic or visually flat interfaces. Reference: [cmd-colorize](references/cmd-colorize.md)
- **bolder** — Amplify safe or boring designs to be more visually impactful. Reference: [cmd-bolder](references/cmd-bolder.md)
- **quieter** — Tone down overly bold or aggressive designs to be more refined. Reference: [cmd-quieter](references/cmd-quieter.md)
- **delight** — Add moments of joy, personality, and unexpected polish. Reference: [cmd-delight](references/cmd-delight.md)
- **overdrive** — Push interfaces past conventional limits with technically ambitious implementations (shaders, spring physics, scroll-driven animations, virtual scrolling). Reference: [cmd-overdrive](references/cmd-overdrive.md)

### Architecture
- **extract** — Extract reusable components, design tokens, and patterns into a design system. Reference: [cmd-extract](references/cmd-extract.md)
- **adapt** — Adapt designs for different screen sizes, devices, contexts, or platforms. Reference: [cmd-adapt](references/cmd-adapt.md)

### Command Execution Notes

When the user invokes a command:
1. Read the corresponding reference document for detailed instructions
2. In the reference, replace `{{ask_instruction}}` with: STOP and ask the user using a normal message
3. In the reference, replace `{{config_file}}` with: CLAUDE.md
4. In the reference, replace `{{model}}` with: Claude
5. In the reference, replace `{{available_commands}}` with the list of 22 commands above
6. References may point to "this skill" or to `references/*.md` files. Both live in the pneuma-webcraft skill — consult them directly, no separate `impeccable` skill needs to be invoked.
7. Follow the reference instructions step by step
8. Apply changes directly to the workspace files — the user sees results in real-time
