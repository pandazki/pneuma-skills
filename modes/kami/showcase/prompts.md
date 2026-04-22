# Kami Showcase Image Prompts

Four 16:9 images (1376×768) for `modes/kami/showcase/`. All share the
"Ethereal Tech Dark Mockup" aesthetic used across Pneuma showcases
(deep zinc background `#09090b → #18181b`, orange `#f97316` accent for
pneuma chrome / interactive elements) but with one kami-specific twist:
**the content inside the chrome is warm parchment `#f5f4ed`**. That
warm-vs-dark tension is what visually distinguishes kami from every
other Pneuma mode in the gallery.

Run with:

```bash
bun modes/slide/skill/scripts/generate_image.mjs "<PROMPT>" \
  --aspect-ratio 16:9 --resolution 2K --output-format png \
  --output-dir modes/kami/showcase --filename-prefix <PREFIX>
```

You'll need `FAL_KEY` or `OPENROUTER_API_KEY` in env (or the script's
`.env`). See the script docs for backend detection.

---

## 1. `hero.png` — workspace in action

**Prompt:**

> A cinematic 16:9 product-marketing mockup of the Pneuma Kami mode on a
> deep zinc canvas (radial gradient from `#09090b` at the corners to
> `#18181b` at center, faint orange glow bleeding in from the right
> edge). Pneuma's dark chrome frames the scene: a glassmorphic toolbar
> along the top with a small pill reading **"Viewport: A4 Portrait ·
> 210 × 297 mm"**, a subtle left-edge chat panel silhouette with two or
> three faint message bubbles. Floating at the visual center, a single
> warm-parchment sheet in colour `#f5f4ed` — A4 proportions, soft
> ring-shadow (`0 0 0 1px #d1cfc5, 0 8px 40px rgba(0,0,0,0.5)`),
> rendered as if lit by a warm overhead light. On the sheet: typeset
> content in the kami style — large serif heading **"Elon Musk"** in
> near-black, small ink-blue sans-serif line **"Founder · Chief
> Engineer · CEO"** right-aligned, a row of four metric cards below
> (`30 yrs · building hard tech`, `6 cos · founded`, `400+ · Falcon
> launches`, `7M+ · Tesla vehicles`) with ink-blue `#1B365D` numerals
> and olive captions, and the beginning of a "Summary" section set in
> warm editorial serif at ~9.5pt. The paper is the hero — everything
> else in the composition supports it. A small italic caption at the
> bottom of the canvas in muted warm-white: *"Good content deserves
> good paper."* No real cursor arrows, no gradient text in headings, no
> glassmorphism on the paper itself. Style reference: editorial print
> design, not SaaS landing page.

**Generate:**

```bash
bun modes/slide/skill/scripts/generate_image.mjs \
  "$(cat modes/kami/showcase/prompts.md | sed -n '/## 1/,/^## 2/p' | grep -A 9999 'Prompt:' | head -n -2 | tail -n +2)" \
  --aspect-ratio 16:9 --resolution 2K --output-format png \
  --output-dir modes/kami/showcase --filename-prefix hero
# then: mv modes/kami/showcase/hero-*.png modes/kami/showcase/hero.png
```

---

## 2. `paper-locked.png` — paper size is sacred

**Prompt:**

> 16:9 conceptual diagram on a deep zinc `#09090b` background.
> Centrepiece: a single warm-parchment A4 sheet (colour `#f5f4ed`)
> floating in the middle, rendered almost like a blueprint — thin
> orange dashed guides extending outward from each edge of the paper,
> with dimension labels in small sans-serif: **"210 mm"** along the
> bottom edge, **"297 mm"** along the right edge, and corner tick
> marks. The paper has a faint ring-shadow. On its surface: a
> minimalist mockup of a kami page — an "Elon Musk" serif heading in
> ink-blue `#1B365D`, a single line of body text, a metric row below;
> just enough detail to signal "this is a kami document". In the
> top-right corner of the canvas, a small dark glassmorphic panel
> stylized as a paper-size picker dropdown, containing five options —
> **A3, A4, A5, Letter, Legal** — with **A4** shown as the selected
> state (orange `#f97316` underline beneath the "A4" row, a faint
> orange glow, a check mark). Below the picker: a smaller "Orientation:
> Portrait | Landscape" toggle with **Portrait** selected. At the
> bottom of the canvas, one line of italic warm-white caption: *"Pick
> once. Lock forever."* No keyboard arrows, no scroll indicators —
> this is about commitment to a physical page.

**Generate:**

```bash
# Prompt text: see Section 2 above. Save as:
bun modes/slide/skill/scripts/generate_image.mjs "<paste prompt>" \
  --aspect-ratio 16:9 --resolution 2K --output-format png \
  --output-dir modes/kami/showcase --filename-prefix paper-locked
```

---

## 3. `typography.png` — editorial typography

**Prompt:**

> 16:9 composition with a deep zinc `#09090b` background, faint radial
> warm glow. Left two thirds of the canvas: a large zoomed-in slice of
> a kami document on warm parchment `#f5f4ed`, rendered as if we're
> peering through a magnifier at one section — a big serif headline
> **"Elon Musk"** in near-black (ink weight 500, serif like
> Newsreader), an inline ink-blue `#1B365D` small-caps label
> **"FOUNDER · CHIEF ENGINEER · CEO"**, two lines of editorial body
> text set in serif at ~10pt with tight 1.45 line-height, and one
> highlighted span reading **"$350B"** in brand ink blue. The paper
> has a soft ring-shadow. Right third: a dark glassmorphic "design
> tokens" panel overlaying the canvas, listing five editorial rules
> stacked like a spec: **"--parchment: #f5f4ed"** (with a small warm
> swatch), **"--brand: #1B365D"** (ink-blue swatch), **"--serif:
> TsangerJinKai02 · Newsreader"**, **"font-weight: 500 (never bold)"**,
> **"line-height: 1.1–1.55"**. Each swatch is a tiny rounded square.
> No flamboyant colour blocks, no emoji. One line of italic warm-white
> caption centered at the bottom: *"One accent. One serif. Editorial
> weight throughout."*

**Generate:**

```bash
bun modes/slide/skill/scripts/generate_image.mjs "<paste prompt>" \
  --aspect-ratio 16:9 --resolution 2K --output-format png \
  --output-dir modes/kami/showcase --filename-prefix typography
```

---

## 4. `export.png` — paper-first export

**Prompt:**

> 16:9 composition, deep zinc `#09090b` to `#18181b` radial background.
> Top-left: a stylized Pneuma export toolbar in warm parchment
> `#f5f4ed` — title "Musk Resume (EN) · 2 pages" in small editorial
> serif, and three rounded buttons in a row: a prominent ink-blue
> `#1B365D` primary button labelled **"Download PDF"**, a lighter
> secondary **"Download HTML"**, a third ghost **"Screenshot PNG"**.
> From the **Download PDF** button, a thin orange `#f97316` arrow curves
> down and fans out to three floating document artifacts in the
> bottom two-thirds of the canvas, each on their own tilt:
>
> 1. a stack of two warm-parchment A4 PDF pages with a tiny PDF icon
>    badge in the corner, showing the faint outline of kami typeset
>    content on each page;
> 2. a dark ZIP archive icon labelled **".zip · 2 PNGs"** with two
>    paper-shaped thumbnails peeking out;
> 3. a single HTML file preview — a browser window frame, inside it
>    the warm parchment sheet floating with letterbox gutter, centred.
>
> All three artifacts are same-origin same-content, just different
> containers. Soft drop shadows on each. Small italic warm-white
> caption at the bottom: *"Same paper. Three ways to share."*
