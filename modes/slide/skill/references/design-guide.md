# Slide Design Guide

Design thinking and default values for slide decks. These are tools for making intentional choices — not rules for a specific look. A cold minimalist deck, a loud maximalist pitch, a warm editorial narrative, and a stark brutalist manifesto can all be excellent. The goal is coherence and intentionality, not convergence on one aesthetic.

---

## Design Direction

### Every Deck Needs a Point of View

Before writing theme.css, decide what this deck should *feel like*. Not "professional" (that's the minimum), but what kind of professional? What kind of energy?

- **Who is the audience?** Investors, engineers, designers, executives, students — each responds to different visual language
- **What's the emotional arc?** A sales pitch builds excitement. A postmortem demands sobriety. A tech talk rewards clarity.
- **What makes this deck THIS deck?** If you swapped the content for a different topic, would the design still feel specific — or could it be anything?

Commit to a direction and follow through. The worst decks are the ones that try to be everything — a little playful, a little serious, a little bold, a little restrained — and end up being nothing.

### Intentionality Over Formula

There's no single "good" aesthetic. What matters is that every choice has a reason:

- Chose dark mode? Because the content is visual and the dark background makes images pop — not because dark looks "modern."
- Chose Inter? Because the content is dense technical documentation and the font should disappear — not because it was the default.
- Chose bright red accent? Because this is a sales deck and urgency matters — not because red "pops."
- Chose zero decoration? Because the data speaks for itself — not because minimalism is trendy.

**The worst outcome** is not an ugly deck. It's a deck that looks like it was made without thinking.

### Recognizing Unintentional Patterns

When you catch yourself reaching for the same solution every time, stop. Some patterns that become autopilot:

- Dark background + neon accent for every topic
- 3-4 identical cards in a row for every list
- Gradient text for every heading
- Icon + heading + description repeated identically
- The same sans-serif font regardless of content
- Purple-to-blue for every gradient

These aren't bad in themselves — they're bad when they're the default rather than a deliberate choice. If you chose dark mode because THIS deck needs it, that's fine. If every deck you make is dark mode, something is off.

---

## Typography

### Choosing Fonts with Intention

The question isn't "which font is best?" — it's "what does this deck need to communicate, and which font carries that tone?"

| Quality | Font Direction | Examples (Google Fonts) | Example Context |
|---------|---------------|------------------------|----------------|
| Authority, tradition | Serif, high-contrast | Playfair Display, Lora, Newsreader | Legal, finance, academic |
| Modern, clean | Geometric sans | Plus Jakarta Sans, Outfit, Urbanist | Tech product, startup |
| Warm, approachable | Humanist sans, rounded | Nunito Sans, Figtree, DM Sans | Education, healthcare, community |
| Technical, precise | Monospace, tabular | JetBrains Mono, IBM Plex Mono, Space Mono | Engineering, data, code |
| Editorial, storytelling | Transitional serif, mixed pairs | Source Serif 4, Fraunces, Instrument Serif | Narrative decks, case studies |
| Playful, creative | Display, variable-width | Space Grotesk, Syne, Instrument Sans | Design, consumer brand, event |
| Confident, sharp | Neo-grotesque, tight tracking | Onest, Geist, Inter Tight | Pitch, product launch |
| Luxury, refined | Didone, thin serif | Cormorant, Bodoni Moda | Fashion, premium brand |

These are starting points, not a definitive list. Google Fonts has 1600+ options — it's worth spending five minutes browsing [fonts.google.com](https://fonts.google.com) to find something that genuinely matches the content, rather than picking from the same short list every time.

**The default font problem**: Using Inter/Roboto/system-ui is fine when the font should be invisible (dense data, technical content). It's a missed opportunity when the deck has personality to express. Know when you're choosing "neutral" intentionally vs. choosing it because you didn't think about it.

**Pairing**: You often don't need a second font — one family in multiple weights creates clean hierarchy. When you do pair, contrast on multiple axes (serif + sans, display + text, condensed + regular). Never pair fonts that are similar-but-not-identical — they create tension without clear hierarchy.

**CJK requirement**: Always include CJK system fonts (`"PingFang SC"`, `"Noto Sans CJK SC"`, `"Microsoft YaHei"`) before `sans-serif` in your font stack. Without them, Chinese/Japanese/Korean text will be invisible in exported PDFs.

### Default Font Stack

```css
--font-sans: "Inter", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
```

### Type Scale

Use fewer sizes with more contrast. The gap between title and body should feel decisive, not incremental.

| Element | Size | Weight | Line Height | Use |
|---------|------|--------|-------------|-----|
| Slide title (h1) | 48px (3rem) | 700 | 1.2 | Cover page main title |
| Page heading (h1) | 36px (2.25rem) | 700 | 1.2 | Content page title |
| Section header (h2) | 28px (1.75rem) | 600 | 1.3 | Subsections |
| Subheading (h3) | 22px (1.375rem) | 600 | 1.4 | Card headers, labels |
| Body text (p) | 20px (1.25rem) | 400 | 1.7 | Paragraphs, descriptions |
| List items (li) | 20px (1.25rem) | 400 | 1.8 | Bullet points |
| Caption/label | 14-16px | 500 | 1.5 | Tags, metadata, footnotes |
| Small text | 12-14px | 400 | 1.5 | Barely used — minimum readable |

### Typographic Details

- **Minimum body text**: 18px — anything smaller is hard to read on projected slides
- **Maximum title**: 56px — larger titles on cover pages only
- **Weight contrast**: Use enough gap between heading and body weight that the difference is obvious, not subtle
- **Letter spacing**: -0.02em for headings, default for body. Tighter tracking on large headings often looks more polished.
- **Line height**: Tighter for headings (1.1-1.2), looser for body (1.5-1.8). Light text on dark backgrounds benefits from slightly more line height.
- **Font smoothing**: Always use `-webkit-font-smoothing: antialiased`
- **OpenType features**: `font-variant-numeric: tabular-nums` makes numbers align in data slides. `font-variant-caps: all-small-caps` works for elegant labels when it fits the aesthetic.

---

## Color

### Color as Communication

Color in slides serves three purposes: **hierarchy** (what to look at first), **grouping** (what belongs together), and **emotion** (how the audience should feel). Decoration is not one of them.

Before choosing colors, ask:
- What's the dominant mood? (Warm/cool, energetic/calm, serious/playful)
- Is there a brand palette to work with or extend?
- Light or dark base — and why? (Dark isn't inherently modern. Light isn't inherently corporate. Choose based on content and context.)

Mood–hue associations as a starting intuition (not rules):

| Mood / Context | Hue Range (OKLCH) | Feeling |
|---------------|------------------|---------|
| Trust, professionalism | 220-250 (blue) | Calm, reliable |
| Growth, health | 140-170 (green) | Natural, positive |
| Urgency, energy | 20-40 (red-orange) | Intense, action-oriented |
| Creativity, imagination | 280-320 (purple) | Mysterious, premium |
| Warmth, friendliness | 60-90 (yellow-orange) | Approachable, vibrant |
| Neutral, technical | Any hue, low chroma | Restrained, function-first |

### Building Palettes

**OKLCH** is worth learning — it's perceptually uniform, meaning equal steps in lightness *look* equal. This makes it easier to generate consistent shade scales. But hex, HSL, or any other format is fine if you're achieving the result you want. The tool matters less than the intention.

```css
/* OKLCH: lightness (0-100%), chroma (0-0.4+), hue (0-360) */
--color-primary: oklch(60% 0.15 250);
--color-primary-light: oklch(85% 0.08 250); /* lighter → reduce chroma */
--color-primary-dark: oklch(35% 0.12 250);
```

**Key insight regardless of color space**: As colors approach white or black, reduce saturation. High saturation at extreme lightness looks garish.

### Default Palettes

Sensible defaults when the user has no explicit color preferences. Adapt or replace entirely to match the deck's direction.

**Dark mode (default):**
```css
:root {
  --color-bg: #0f0f0f;
  --color-fg: #e8e6df;
  --color-primary: #6ea8fe;     /* Blue accent */
  --color-secondary: #a78bfa;   /* Purple secondary */
  --color-accent: #34d399;      /* Green accent */
  --color-muted: #6b7280;       /* Gray for secondary text */
  --color-surface: #1a1a1a;     /* Card/container background */
  --color-border: #2a2a2a;      /* Subtle borders */
}
```

**Light mode:**
```css
:root {
  --color-bg: #ffffff;
  --color-fg: #1e293b;          /* Slate-800 */
  --color-primary: #2563eb;     /* Blue-600 */
  --color-secondary: #64748b;   /* Slate-500 */
  --color-accent: #0ea5e9;      /* Sky-500 */
  --color-muted: #94a3b8;       /* Slate-400 */
  --color-surface: #f8fafc;     /* Slate-50 */
  --color-border: #e2e8f0;      /* Slate-200 */
}
```

### Color Proportion

A useful mental model (not a rigid rule): most of the visual area should be calm (background, whitespace), a moderate portion carries the content (text, secondary elements), and a small portion draws attention (accent, key data).

| Role | Usage | Proportion |
|------|-------|-----------|
| Background | Slide background, large areas | 60-70% |
| Foreground | Primary text, headings | 20-25% |
| Primary | Accent elements, key highlights | 5-10% |
| Muted | Secondary text, captions, metadata | 5-10% |
| Surface | Cards, containers, code blocks | As needed |
| Border | Dividers, card borders | Minimal |

The common mistake: using the accent color everywhere because it's "the brand color." Accent colors work because they're rare. The more you use them, the less power they have.

### Neutral Colors

Neutrals (grays, near-whites, near-blacks) occupy the most area in most decks. Two valid approaches:

1. **Pure neutrals**: Clean, no-nonsense, lets content and accent colors do all the talking. Good for data-heavy or multi-brand contexts.
2. **Tinted neutrals**: Add a tiny hint of your brand hue (chroma ~0.01 in OKLCH). Creates subtle warmth or coolness that feels cohesive. Good for narrative or branded decks.

Neither is "better." Pure gray is a legitimate choice when neutrality IS the design intent. Tinted gray is a tool for when you want subconscious cohesion.

### Dark and Light Decks

Dark and light aren't just color swaps — they have different physics:

| Light Base | Dark Base |
|------------|-----------|
| Shadows create depth | Lighter surfaces create depth (shadows disappear on dark) |
| Bold text weights work | Reduce text weight slightly — light-on-dark appears heavier |
| Full saturation accents | Consider slight desaturation — bright on dark can be harsh |
| White backgrounds OK | Avoid pure black unless it's intentional (OLED, high-contrast editorial) — most dark UIs use 10-18% lightness |

### Readability Pitfalls

These commonly fail regardless of aesthetic direction:
- Light gray text on white backgrounds
- Gray text on colored backgrounds — gray looks washed out on color. Use a shade of the background color instead.
- Red on green or vice versa — 8% of men have difficulty distinguishing these
- Thin light text on photographic backgrounds — use an overlay to guarantee contrast
- Heavy use of alpha/transparency — creates unpredictable contrast. Define explicit colors when possible.

---

## Visual Hierarchy

### The Squint Test

Blur your eyes (or mentally defocus) looking at a slide. Can you still identify:
- The most important element?
- The second most important?
- Clear groupings?

If everything looks the same weight blurred, there's a hierarchy problem. On a slide, hierarchy is even more critical than on the web — the audience has seconds, not minutes.

### Building Hierarchy

Don't rely on a single dimension. The strongest hierarchy combines multiple signals:

| Tool | Creates Hierarchy When... |
|------|--------------------------|
| **Size** | The ratio is decisive (2x+), not incremental |
| **Weight** | The gap between weights is visible at a glance |
| **Color** | Accent draws the eye because the rest is calm |
| **Position** | Primary content sits where the eye naturally starts |
| **Space** | Important elements have room to breathe; secondary content is denser |

The specific values depend on the deck's aesthetic — a bold deck might use 4x size ratios, a refined one might use 2x. What matters is that the hierarchy is unambiguous.

A concrete example — same content, weak vs strong hierarchy:

```
Weak (everything similar):       Strong (clear priority):
┌────────────────────┐         ┌────────────────────┐
│ Overview (22px/600) │         │                    │
│                    │         │ Revenue grew 40%   │
│ Revenue: $2.4M     │         │        (48px/800)  │
│ Growth: 40%        │         │                    │
│ Users: 15,000      │         │ $2.4M  │  15K users│
│ Target: Q3         │         │  (20px/400, muted) │
│                    │         │                    │
└────────────────────┘         └────────────────────┘
```

Left: title and data are close in size — nothing stands out. Right: 40% is the core message of this slide, everything else recedes.

### Layout Diversity

Some things to watch for:
- **Identical card grids** on every slide — if three slides in a row use the same icon + heading + text card layout, the deck feels templated. Vary the treatment.
- **Cards aren't always needed** — spacing and alignment create visual grouping naturally. Use cards when items need clear boundaries or comparison, not as the default container for everything.
- **Nesting containers** (cards inside cards, boxes inside boxes) — adds visual complexity without information. Use spacing, typography, and dividers for hierarchy within.

### Whitespace

On slides, whitespace is as important as content. A slide with generous margins communicates confidence. A crowded slide communicates "I couldn't edit this down."

- More space around an element = more visual importance
- If a slide feels cramped, the answer is usually "split into two slides" not "make everything smaller"
- Empty space is not wasted space — it directs attention to what remains

---

## Spacing

### Slide Padding

```css
--slide-padding: 64px;  /* Default content page padding */
```

- **Cover pages**: 0px or custom (full-bleed backgrounds)
- **Content pages**: 64px all sides → 1152×592px available area (for 1280×720 canvas)

### Gap Scale

| Token | Size | Use |
|-------|------|-----|
| xs | 8px | Between related inline items |
| sm | 16px | Between list items, tight groups |
| md | 24px | Between content sections |
| lg | 32px | Between major blocks |
| xl | 48px | Between split columns, hero spacing |

### Margin Patterns

- Between heading and first content: 16-24px
- Between content paragraphs: 12-16px
- Between cards in a grid: 16-24px
- Between major sections: 32-48px

---

## Visual Elements

### Cards

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1); /* optional */
}
```

### Tags / Badges

```css
.tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  background: var(--color-primary);
  color: white;
}
```

### Dividers

```css
.divider {
  height: 1px;
  background: var(--color-border);
  margin: 24px 0;
}
```

### Icons

- Use **Lucide icons** (CDN) or **inline SVG** for consistency
- Icon size: 20-24px for inline, 32-48px for feature icons
- **Never use emoji** for professional presentations
- Color icons with `var(--color-primary)` or `var(--color-muted)`

### Charts (ECharts)

- Initialize with explicit width/height matching the container
- Use the deck's color palette for chart colors
- Include clear axis labels and legends
- Prefer bar/line charts for trends, pie/donut for composition
- Add a `<div id="chart-{n}" style="width: 100%; height: Xpx;"></div>` container
- Initialize with `<script>` at the end of the slide fragment

---

## Layout Templates

### Cover Page

Full-canvas, centered, minimal:
```
┌──────────────────────────────────────────┐
│                                          │
│              [Tag/Label]                 │
│                                          │
│         Main Title (48px)                │
│                                          │
│         Subtitle (20px, muted)           │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

### Single Column Content

Standard for text-heavy slides:
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  • Bullet point one                      │
│  • Bullet point two                      │
│  • Bullet point three                    │
│  • Bullet point four                     │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

### Two-Column Split

For comparison, feature + detail, or text + image:
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  ┌──────────────┐  ┌──────────────┐     │
│  │  Left Column │  │ Right Column │     │
│  │  Text/list   │  │ Image/chart  │     │
│  │              │  │              │     │
│  └──────────────┘  └──────────────┘     │
│                                          │
└──────────────────────────────────────────┘
```

### Card Grid

For 3-4 equal items (features, team, metrics):
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │ Card │  │ Card │  │ Card │          │
│  │  1   │  │  2   │  │  3   │          │
│  └──────┘  └──────┘  └──────┘          │
│                                          │
└──────────────────────────────────────────┘
```

### Full Visual

Image or chart dominates, minimal text:
```
┌──────────────────────────────────────────┐
│  ┌──────────────────────────────────┐    │
│  │                                  │    │
│  │        Large Image/Chart         │    │
│  │                                  │    │
│  └──────────────────────────────────┘    │
│  Caption or source (small, muted)        │
└──────────────────────────────────────────┘
```

---

## Presentation Writing

Every word on a slide should earn its place. Presentations are a spoken medium — the slides support the speaker, they don't replace them.

### Core Rules

- **One idea per slide** — if you can't summarize the slide's point in one sentence, it's trying to do too much
- **Bullet points**: Max 5-6 per slide, max 8-10 words each. If bullets are full sentences, they're paragraphs pretending to be bullets.
- **Headings are statements, not labels**: "Revenue grew 40% YoY" beats "Revenue Overview". The heading should deliver the takeaway.
- **Cut, then cut again**: Write your text, cut it in half, then cut it in half again. What remains is what matters.
- **Active voice**: "We launched in 12 markets" not "The product was launched in 12 markets"

### Consistency

- Pick one capitalization style (Title Case or Sentence case) and stick with it across all slides
- Use consistent terminology — don't alternate between "users," "customers," and "clients" unless they mean different things
- Punctuation: either all bullets end with periods, or none do

### Data Storytelling

- Lead with the insight, not the data: "3x faster" is a headline, the chart is the evidence
- Round numbers for impact: "~2 million users" beats "1,987,432 users"
- Highlight the one number that matters — if everything is highlighted, nothing is

{{#imageGenEnabled}}
---

## Using Generated Images

CSS and SVG handle geometric shapes, gradients, icons, and simple charts better than images — code is more controllable and resolution-independent. But some things code can't do well. That's where generated images become a real weapon.

### The Finishing Touch, Not the Filler

An image earns its place the same way a word does — not because there's empty space to fill, but because the slide genuinely needs it.

**Worth generating**:

- **Mood-setting hero images on cover/divider slides.** A full-bleed background photo that matches the topic establishes atmosphere faster than any CSS gradient. A deck about ocean conservation with a single deep-sea light-and-shadow image puts the audience in the right headspace within the first second.
- **Making abstract concepts tangible.** "Consistency in distributed systems" takes three paragraphs to explain in text. A carefully generated visual metaphor — a row of clocks all pointing to the same time — communicates it in one glance.
- **Grounding data with reality.** A deck about user growth has numbers and charts, but a realistic scene — a crowded coffee shop where everyone is using your product — creates emotional impact that no bar chart can match.
- **Textures and qualities that SVG can't reach.** Hand-drawn illustration styles, watercolor textures, photographic lighting, complex 3D renders — these are CSS and SVG's blind spots.

**Not worth generating**:

- Purely decorative geometric patterns — CSS does this better and it's easier to tweak
- An image on every single slide — this isn't a photo album. Data-heavy and process slides work fine with just typography and layout.
- Generic stock-photo-style images — a person in a suit standing at a whiteboard adds nothing to any deck

### Image × CSS Integration

Generated images don't exist in isolation — they need CSS to blend into the slide's design language. Practical combinations:

**Gradient overlay for text readability.** Image as background, CSS gradient on top to control brightness and ensure text contrast.
```css
.slide-hero {
  background: linear-gradient(to right, rgba(0,0,0,0.7) 40%, transparent), url('assets/hero.jpg');
  background-size: cover;
}
```
Text goes on the dark left side; the image bleeds through on the right. Far more readable than text placed directly over an uncontrolled image.

**Non-rectangular cropping.** `clip-path` or creative `border-radius` breaks the rectangle monotony. `object-fit: cover` + `object-position` controls the focal point.
```css
.feature-image {
  clip-path: polygon(10% 0, 100% 0, 100% 100%, 0 100%);
  object-fit: cover;
  object-position: center 30%; /* keep the face in upper third */
}
```

**Blend modes for color unity.** `mix-blend-mode` and `filter` make any image harmonize with the slide's palette. A desaturated image + `multiply` blend mode + brand-colored background = highly unified visual.

**Subtle texture backgrounds.** Generate a texture (paper grain, noise, fabric) and use it as a `background-image` with low `opacity`. Gives flat-color backgrounds a tactile quality that CSS noise patterns can approximate but rarely match.

### Style Coherence Across a Deck

When multiple generated images appear in the same deck, they must look like they belong to the same world:

- **Consistent style descriptors in prompts**: If the first image uses "flat illustration, muted earth tones, thick outlines," every subsequent image should carry the same style language.
- **Color temperature consistency**: A warm-toned deck with one cold-toned image looks like a collage, not a design.
- **Don't mix rendering styles**: Photorealistic and illustration shouldn't coexist in the same deck unless the contrast itself is the design intent.

### Restraint

Image generation is a powerful tool, but overuse turns a deck into an AI art gallery. Some rules of thumb:

- **In most decks, the majority of slides don't need images.** Data slides, process slides, comparison slides — typography and charts carry these.
- **One great image beats three filler images.** When you think "an image here would look nice," ask: would removing it make the slide communicate worse? If not, skip it.
- **Fewer images = more weight per image.** In a 20-slide deck with 3 images, every image gets remembered. With 20 images, none of them do.

{{/imageGenEnabled}}
