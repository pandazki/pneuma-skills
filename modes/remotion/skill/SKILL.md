# Remotion Video Creation

Create programmatic videos with React and Remotion inside the Pneuma workspace. The viewer compiles and previews compositions in real-time as files are edited.

## Workflow

Video creation follows three stages. The goal is to ensure the content is worth expressing before any code is written — animation is expression, not decoration.

### Stage 1: Research & Content Discovery

A compelling video requires understanding the subject with enough breadth and depth to find the angle worth expressing. A 60-second video can only say one thing well, so choosing the right thing matters more than how it's animated.

1. **Research the full landscape** — explore the topic broadly. Look at adjacent ideas, context, history, counterarguments. Don't settle on the first angle.
2. **Find tension or insight** — what's counterintuitive? What do most people get wrong? What's the most interesting lens?
3. **Choose the projection** — from the full understanding, identify the specific slice that translates well to visual storytelling.

Deliver a short creative brief: what the video is about and why this angle is compelling.

### Stage 2: Motion Intent

Not everything should move. Plan which ideas benefit from animation and which work better as static composition. This prevents the common trap of animating everything uniformly.

For each section of content, assign a motion intent:

| Intent | When to use | Example |
|--------|------------|---------|
| **static** | The idea is clear as text/image | A definition, a quote |
| **subtle** | Light emphasis helps | A fade-in, a gentle scale |
| **animated** | Motion carries meaning | A data comparison, a process flow |
| **hero** | The memorable moment | The key insight, the reveal |

Every video needs one **hero moment** — the scene that gets the most animation investment and makes the video memorable.

Guidelines for motion intent:
- Data comparison → animated chart or visual transformation
- Process/flow → sequential reveal with spatial movement
- Scale/magnitude → size or count animation
- Before/after → transition or morph
- Emphasis → kinetic typography or focal pull

### Stage 3: Content Design Outline

Assemble the full plan before writing code:

1. **Creative brief** (from Stage 1) — one paragraph: what and why
2. **Scene breakdown** — each scene with: content, duration estimate, motion intent
3. **Aesthetic direction** — mood, palette, typography, pacing. These should emerge from the content (a data story feels different from a philosophical essay), not be chosen arbitrarily. See [Design Guidance](#design-guidance) for how to make distinctive choices.
4. **Hero moment** — which scene, what animation, why it matters

Present this outline and wait for confirmation before coding. Changing direction mid-implementation is expensive.

**When to compress this process:**
- User provides a detailed brief or storyboard → start at Stage 2
- User says "just make it" with a simple, clear request → quick outline, confirm, build
- Iterating on existing compositions → go straight to code

---

## Pneuma Environment

### Live Preview

The Pneuma viewer automatically compiles and previews compositions as files are edited (1-second debounce). No dev server startup needed.

**Supported in preview:** All core `remotion` APIs (`useCurrentFrame`, `interpolate`, `spring`, `AbsoluteFill`, `Sequence`, `Series`, etc.) and local file imports within `src/`.

**Static assets** go in `public/` and are referenced with `staticFile()`:
```tsx
import { Img, staticFile } from "remotion";
<Img src={staticFile("logo.png")} />  // → public/logo.png
```

**Not supported in preview:** External packages like `@remotion/google-fonts`, `@remotion/three`, `@remotion/motion-blur`. These require running `npx remotion studio` separately.

### Locator Cards

After editing compositions, include locator cards so the user can jump directly to what changed.

Navigate to a composition:
```
<viewer-locator label="My Composition" data='{"file":"MyComposition"}' />
```

Loop a specific time range (useful when editing a particular section):
```
<viewer-locator label="Intro Animation (0-3s)" data='{"file":"MyComposition","inFrame":0,"outFrame":90}' />
```

Frame numbers are 0-based. Calculate from time: `frame = seconds × fps` (default fps is 30).

Use frame-range locators when you modified timing in a specific section, added a new scene, or changed a transition — it lets the user see exactly what changed without scrubbing.

### Viewer Context

User messages may include a `<viewer-context mode="remotion">` block with:
- **Composition and playback state** — which composition, frame, timecode, playing/paused
- **Project files** — source file list
- **Compositions** — IDs parsed from Root.tsx

Use this to resolve references like "this part", "the animation here", "around 2 seconds".

### Project Structure

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point (`registerRoot()`) |
| `src/Root.tsx` | Composition registry — all `<Composition>` elements declared here |
| `src/<Name>.tsx` | One file per video composition |
| `public/` | Static assets (reference with `staticFile()`) |
| `remotion.config.ts` | CLI configuration |

Keep one composition per file. Register every new composition in `src/Root.tsx`.

---

## Design Guidance

### Why Design Rigor Matters for Video

Video is the most aesthetically exposed medium — every frame is a visual artifact with nowhere to hide. Unlike a web app where functionality can compensate for mediocre aesthetics, a generic-looking video is just... generic. The goal is for someone to ask "how was this made?" rather than "which AI made this?"

### Recognizing Generic AI Video

These patterns have become strong signals that a video was AI-generated. They're not inherently bad techniques, but their combination is now a fingerprint:

- Inter/Roboto/Arial on everything (these are the "default font" of AI output)
- Centered title + centered subtitle on dark background
- Purple-to-blue gradients, cyan-on-dark, neon accents
- Glassmorphism blur cards with glow borders
- Cards in a grid (icon + heading + text, repeated)
- Bounce/elastic easing on every element (reads as "uncontrolled")
- Same animation speed for everything
- Dark mode + glowing accents as the lazy default

If a video hits 3+ of these, it's worth reconsidering the design direction.

### Making Distinctive Choices

Strong videos commit to a clear aesthetic stance rather than playing it safe. Some directions to consider (not exhaustive — the content should drive the choice):

- **Brutally minimal** — one font, two colors, massive whitespace, slow reveals
- **Editorial/magazine** — sophisticated grids, serif headings, restrained motion
- **Retro-futuristic** — CRT effects, scanlines, monospaced type, glitch transitions
- **Organic/natural** — hand-drawn feel, imperfect edges, warm tones
- **Luxury/refined** — thin weights, generous spacing, muted palette
- **Bold/graphic** — oversized type, hard cuts, saturated color
- **Kinetic typography** — text IS the animation, words fly/morph/stack

Write the chosen direction as a comment at the top of each composition file. This anchors decisions and prevents style drift during implementation.

### Video-Specific Design Tips

**Typography** — often the primary visual element in video:
- Avoid the most common AI-default fonts (Inter, Roboto, Arial, Open Sans, Lato, Montserrat, Poppins). These immediately signal "generated." Load distinctive fonts via `@remotion/google-fonts` — see [rules/fonts.md](rules/fonts.md) and [references/typography.md](references/typography.md).
- Use a 3:1+ heading-to-body size ratio (5:1 often works better for video than for web).

**Color** — see [references/color-and-contrast.md](references/color-and-contrast.md):
- OKLCH produces more perceptually uniform palettes than HSL.
- Tint neutrals rather than using pure black/white. Apply the 60-30-10 rule by visual weight.

**Motion** — see [references/motion-design.md](references/motion-design.md):
- `Easing.out(Easing.exp)` is a strong default (snappy, confident).
- Bounce and elastic curves tend to read as uncontrolled — they've become an AI video cliché.
- Vary timing: mix fast cuts (2-3 frames) with slow reveals (20-30 frames). Exits at ~75% of entrance duration. Stagger groups of 4-6 items, 3-5 frames apart at 30fps.

**Layout** — see [references/spatial-design.md](references/spatial-design.md):
- Treat every frame as a poster. Asymmetry tends to be more visually interesting than centering everything. Fill the frame intentionally.

### Self-Review Checklist

Before delivering, review these questions. They're diagnostic, not pass/fail — if several feel wrong, it's worth a revision pass:

1. Could someone immediately tell AI made this? → Identify which parts feel generic
2. Can the aesthetic be described in one phrase? → If not, the direction isn't clear enough
3. Is there one thing that surprises? → A bold color, unexpected transition, unusual layout
4. Are the font choices distinctive? → Swap out any defaults
5. Is everything centered? → Try breaking symmetry somewhere
6. Are all animations the same speed? → Vary timing across scenes
7. Is the palette more than 3 colors? → Simplify
8. Does it feel like a slide deck? → Lean into motion and spatial composition
9. Are backgrounds pure black or pure white? → Tint them
10. Does it look like a previous generation? → Push for visual variety

### Design Reference Files

The `references/` directory contains detailed guidance. Read the relevant file when making design decisions in that area:

| Decision area | Reference |
|---|---|
| Font choice, sizing, weight, pairing | [references/typography.md](references/typography.md) |
| Color palette, OKLCH, tinted neutrals | [references/color-and-contrast.md](references/color-and-contrast.md) |
| Spacing, grids, visual hierarchy | [references/spatial-design.md](references/spatial-design.md) |
| Easing curves, stagger, pacing | [references/motion-design.md](references/motion-design.md) |
| Copy, labels, voice | [references/ux-writing.md](references/ux-writing.md) |

---

## Technical Reference

### Core Rules

Remotion drives all animation through frame counting, not CSS:

- All animation uses `useCurrentFrame()` and `interpolate()` / `spring()`. CSS transitions and Tailwind animation classes (`transition-*`, `animate-*`) don't work in Remotion's rendering pipeline — they produce inconsistent results across frames.
- Write durations as `seconds * fps` rather than raw frame counts for readability.
- Use `type` (not `interface`) for component props.

### Remotion API Rules

Read individual rule files on demand when the topic is relevant:

**Fundamentals**
- [rules/animations.md](rules/animations.md) — `useCurrentFrame`, `interpolate` patterns
- [rules/timing.md](rules/timing.md) — Easing curves, spring animations
- [rules/compositions.md](rules/compositions.md) — Composition, Still, Folder, defaultProps
- [rules/sequencing.md](rules/sequencing.md) — Sequence, Series, timing, delay
- [rules/transitions.md](rules/transitions.md) — TransitionSeries, scene transitions
- [rules/trimming.md](rules/trimming.md) — Cutting beginning or end of animations
- [rules/parameters.md](rules/parameters.md) — Parametrizable video with Zod schema
- [rules/calculate-metadata.md](rules/calculate-metadata.md) — Dynamic duration, dimensions, props

**Assets & Media**
- [rules/assets.md](rules/assets.md) — Importing images, videos, audio, fonts
- [rules/images.md](rules/images.md) — `<Img>` component
- [rules/videos.md](rules/videos.md) — Video: trimming, volume, speed, looping
- [rules/audio.md](rules/audio.md) — Audio: trimming, volume, speed, pitch
- [rules/fonts.md](rules/fonts.md) — Google Fonts and local fonts
- [rules/gifs.md](rules/gifs.md) — GIFs synchronized with timeline
- [rules/transparent-videos.md](rules/transparent-videos.md) — Transparent video rendering

**Text & Typography**
- [rules/text-animations.md](rules/text-animations.md) — Text animation patterns
- [rules/measuring-text.md](rules/measuring-text.md) — Measuring and fitting text
- [rules/measuring-dom-nodes.md](rules/measuring-dom-nodes.md) — DOM element dimensions

**Visual Effects**
- [rules/charts.md](rules/charts.md) — Data visualization (bar, pie, line)
- [rules/3d.md](rules/3d.md) — Three.js integration
- [rules/lottie.md](rules/lottie.md) — Lottie animations
- [rules/light-leaks.md](rules/light-leaks.md) — Light leak overlays
- [rules/maps.md](rules/maps.md) — Mapbox map animation

**Audio & Captions**
- [rules/subtitles.md](rules/subtitles.md) — Subtitle routing
- [rules/display-captions.md](rules/display-captions.md) — Caption display
- [rules/import-srt-captions.md](rules/import-srt-captions.md) — SRT import
- [rules/transcribe-captions.md](rules/transcribe-captions.md) — Whisper transcription
- [rules/audio-visualization.md](rules/audio-visualization.md) — Spectrum, waveforms, bass-reactive
- [rules/sfx.md](rules/sfx.md) — Sound effects
- [rules/voiceover.md](rules/voiceover.md) — ElevenLabs TTS voiceover

**Advanced**
- [rules/ffmpeg.md](rules/ffmpeg.md) — FFmpeg operations
- [rules/can-decode.md](rules/can-decode.md) — Video decode capability
- [rules/extract-frames.md](rules/extract-frames.md) — Frame extraction
- [rules/get-audio-duration.md](rules/get-audio-duration.md) — Audio duration
- [rules/get-video-dimensions.md](rules/get-video-dimensions.md) — Video dimensions
- [rules/get-video-duration.md](rules/get-video-duration.md) — Video duration
- [rules/tailwind.md](rules/tailwind.md) — TailwindCSS in Remotion
