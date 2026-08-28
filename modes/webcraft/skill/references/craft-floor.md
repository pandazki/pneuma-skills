# Craft floor

Load this once the direction is settled and immediately before you edit UI, then build without announcing the checklist. A pinned brief or the committed visual world overrides anything here; your own habit does not.

## Verify

Each of these is a check on the built result, not an intention. Run them together in the batched `capture` round, not as separate screenshot trips — the checks share one render.

- **Contrast:** body and placeholder text ≥4.5:1, large text (≥18px, or bold ≥14px) ≥3:1. On colored surfaces tint secondary text from that hue or from the foreground; never gray. Light gray "for elegance" is the single biggest reason AI designs read as hard to read.
- **Depth:** shadows carry an offset and a soft blur. A zero-offset colored halo is decoration, not depth.
- **Spacing:** tight groups, generous separation, more space above a heading than below it. Read the computed values rather than trusting the eye.
- **Type:** body measure 65–75ch, display max ~6rem, tracking floor -0.04em (-0.02 to -0.03em usually reads better), balanced headings (`text-wrap: balance` on h1–h3, `pretty` on long prose), obvious scale and weight steps, at most three families. Run the real copy at every breakpoint and fix what overflows.
- **Motion:** one authored moment, not scattered effects and not one identical entrance on every section. Exponential ease-out (quart / quint / expo, no bounce, no elastic) from an already-visible default. Reach past transform and opacity: blur, backdrop-filter, clip-path, mask, and shadow belong to the palette when they stay smooth. Every animation needs a `prefers-reduced-motion` alternative — usually a crossfade or an instant transition.
- **States:** hover, disabled, loading, error, empty. Plus real content, working controls, responsive composition, and keyboard focus.
- **Browser surfaces:** the parts you did not draw still carry the design. Text selection, the caret, custom scrollbars, focus rings, underline offset, and the numerals in tabular data all ship with browser defaults that belong to no design system. Theme them from the palette. This is the cheapest signal that a page was built rather than assembled, and the one models skip most reliably.
- **Copy:** the product's own language. Controls name their action; errors name the problem and the recovery. Every word earns its place — no restated headings, no intro that repeats the title, no marketing buzzwords ("seamless", "effortless", "supercharge"), no aphoristic triads that sound profound and say nothing. Don't lean on em dashes (or `--`); commas, colons, semicolons, periods, and parentheses exist.
- **Coverage:** every brief requirement present and findable within seconds.

## Refuse

These are the category's defaults, not decisions: the brief's own words can earn most of them. Reaching for one when the axis is free means you were not deciding — and recognizing that means rewriting the element, not softening it.

**Page scaffolds**

- Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container; nested cards are always wrong.
- The hero-metric template: big number, small label, supporting stats, accent.
- A kicker or eyebrow above a heading — the tiny uppercase tracked label, and the pill-chip variant with a 999px radius. This one is a ban, not a default: no brief earns it back. The heading carries its own weight; delete the label and let it speak.
- Section numbers (01 / 02 / 03) as scaffolding. They earn their place only when the sequence itself carries information the reader needs; numbered eyebrows across every section are AI grammar.
- A modal for a task that needs neither interruption nor protected focus. Exhaust inline and progressive alternatives first.
- Text that overflows its container, and body text running to the absolute viewport edge. The viewport is part of the design: test the real heading copy at every breakpoint, and wrap content in a container with horizontal padding.
- First-viewport content that overflows its own column — the fold is a composition, not an accident.

**Surface habits**

- Gradient text (`background-clip: text` over a gradient). Emphasis comes from weight or size.
- Glass and blur as decoration rather than as a specific effect.
- A colored `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts — hard-coded colors and CSS variables alike. Rewrite with full borders, background tints, leading numbers or icons, or nothing. Swapping to an inset box-shadow is the same stripe wearing a different property.
- Hard offset shadows (`box-shadow: 4px 4px 0`) outside a world that is actually neobrutalist. The zero-blur block shadow is a costume, not a depth system.
- Radial glow halos, accent spotlights, and glowing edges painted behind a section to imply light that no material in the scene emits.
- Marquee scrollers and infinitely sliding logo belts, and blinking terminal cursors, as decoration for "energy" or "technical".
- Decorative dot and grid fields: dot matrices, and two-axis grid overlays built from `linear-gradient(... 1px, transparent 1px)` plus `background-size`. Backgrounds are surfaces, textured only from the subject's world — Decorative grid backgrounds need an actual canvas, map, blueprint, or measuring tool under them.
- `repeating-linear-gradient(...)` stripe backgrounds, and side-edge stripes painted with an inset shadow.
- Text sitting under an overlay that was never designed to carry it — a scrim added after the fact because the image won the contrast fight.
- Hero art assembled from stock geometric shapes (floating circles, blurred blobs, rotated squares) standing in for the picture the brief actually asked for.
- Sparklines, progress rings, and soft-shadowed rounded rectangles standing in for content.
- Monospace as a costume for "technical" rather than for code, data, or measurement.
- A system display face (Impact, Arial Black, the platform sans) as the display voice of an own-world page. Source and self-host a face whose character matches the approved lettering; the closest installed font is a failure, not a fallback.
- Unicode glyphs or emoji standing in for an icon system. Icons are drawn — from a real library or authored SVG, in one consistent stroke and weight.
- Geometric masks standing in for organic contours. A circle, polygon, or radial-gradient cutout approximating a photographic subject's edge is the cheap version of the effect and reads worse than omitting it. Derive an alpha matte from the actual image, or produce a real cut-out asset.
- Light or dark picked by category ("tools look cool dark", "light to be safe"). Pick it from the use scene: who, where, under what ambient light.
- The cream / sand / beige body background. The whole warm-neutral band (OKLCH L 0.84–0.97, C < 0.06, hue 40–100) reads as cream/paper/parchment whatever you name it, and token names like `--paper`, `--cream`, `--sand`, `--bone`, `--linen`, `--ivory` are tells in themselves. "Warm, traditional, editorial" is carried by accent, typography, and imagery — not by a warm-tinted near-white ground.

**Model tells** — frequent giveaways of a specific code model; refuse and rewrite regardless of which model you are:

- **The ghost card:** `border: 1px solid X` plus `box-shadow: 0 Npx Mpx …` with blur ≥16px on the same element. Declare elevation once — a single solid border, or a defined shadow at no more than 8px blur.
- **Over-rounding:** `border-radius: 32px+` on cards, sections, or inputs. Cards top out at 12–16px; full-pill is for small controls and tags.
- **Sketchy SVG illustration:** `loose-sketch` / `doodle` / `wavy` class names, `feTurbulence` "paper grain" filters, crude 5-to-30-path scenes depicting a tangible subject. Real illustration or none. This bans SVG imitating pictures, never SVG doing geometry — crisp vector shapes, diagrams, animated linework, and shader-driven effects remain first-class media.
- **Never animate an image on hover**, directly or through its parent. It is not an action target and the motion adds no information. Give the container the feedback: background, border, or shadow.
- **Claims come from supplied truth.** Label illustrative values honestly. Naming a concept and then ironizing it is not a claim, and staging a strawman to correct it is theater — make the specific claim instead.

## The AI Slop Test

If someone could look at this interface and say "AI made that" without doubt, it failed. Ask "which AI made this?" and the honest answer should be "none — a designer did."

Run the category-reflex check at two altitudes; the second catches what the first misses.

- **First-order:** if someone could guess the theme and palette from the category alone ("observability → dark blue", "healthcare → white + teal", "finance → navy + gold", "crypto → neon on black"), that is the first training-data reflex.
- **Second-order:** if someone could guess the aesthetic family from category-plus-avoidance ("AI workflow tool that isn't SaaS-cream → editorial-typographic", "fintech that isn't navy-and-gold → terminal-native dark"), the trap is one tier deeper. Rework until neither answer is obvious.

AI-generated interfaces cluster around a few looks regardless of subject: warm cream ground with a high-contrast serif display and a terracotta or signal-red accent; near-black with one neon accent and glowing edges; broadsheet-editorial hairlines with an italic display serif and small tracked mono labels. All are legitimate when the brief calls for them. Where the brief leaves the aesthetic free, landing in one means the self-check failed. A bookish, warm, or child-facing subject is not a license: book cloth, thread, jackets, and endpapers span the whole saturated spectrum, and cream paper is the smallest corner of that world.

Match implementation complexity to the aesthetic vision: maximalist work needs elaborate code and effects; minimalist work needs restraint, precision, and exact spacing. Vary between light and dark, different faces, different aesthetics — never converge on the same choices across generations.

The floor holds the mechanics; it never picks the direction. With every check green, spend the page on the committed world — and when torn between refined and committed, commit.
