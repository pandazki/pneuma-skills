# Reference-to-video directive language

`bytedance/seedance-2.0/reference-to-video`, accessed via
`generate-video.mjs reference`, is not just "multi-image as identity
anchor". It is a **compositional directing system** — every reference
you pass is an addressable asset that gets a specific structural role
in the prompt. Different refs can control different things at the
same time: character identity, first frame, destination environment,
camera motion, style lookup, audio bed. You assign those roles in
natural language.

The most common failure is treating `reference` like `from-image`
with extra pictures. Don't. The real power is in naming each ref and
telling the model what to do with it.

## Addressing mechanic

Inside the prompt, reference assets are addressed as:

- `@image1`, `@image2`, …, up to `@image9`
- `@video1`, `@video2`, `@video3`
- `@audio1`, `@audio2`, `@audio3`

The number is the 1-indexed order of the corresponding flag on the
command line. The first `--image-url` is `@image1`, the second is
`@image2`, and so on. Images, videos, and audios count separately, so
`--image-url` order does not affect `@videoN` numbering.

```bash
node scripts/generate-video.mjs reference \
  --prompt "Replace the character in @video1 with @image1 ..." \
  --image-url assets/image/hero.jpg         # @image1
  --image-url assets/image/destination.jpg  # @image2
  --video-url assets/video/dolly-shot.mp4   # @video1
  --duration 8 --aspect-ratio 16:9 \
  --output assets/video/shot.mp4
```

Unaddressed refs (ones you pass but never `@`-mention) seem to nudge
mood/style weakly, but explicit addressing is dramatically more
reliable. Assume an unaddressed ref is mostly ignored and don't waste
slots on decoration.

## Role vocabulary

These directive patterns the model understands reliably. Mix and stack
them in a single prompt — the more precise the role assignment, the
less the model has to guess.

| Role | Pattern | What it does |
|---|---|---|
| **Character identity** | `the character from @image1`, `replace the character in @video1 with @image1` | Locks the subject's look to the ref. |
| **First-frame anchor** | `with @image1 as the first frame`, `open on @image1` | The opening frame starts from (or matches) the ref. |
| **Destination scene** | `travel to the … of @image2`, `arrive at @image2`, `ending in the environment of @image2` | The video ends in the environment shown. |
| **Mid-scene setting** | `in the location shown in @image2`, `set inside @image2` | The scene happens inside that environment. |
| **Camera motion transfer** | `refer to the camera movement of @video1`, `match the pacing / blocking of @video1` | Borrows dolly / tracking / handheld feel from a video ref. |
| **Style transfer** | `in the visual style of @image3`, `color-grade like @video1` | Borrows look / grade / palette without copying content. |
| **Prop / costume add** | `the character should wear sci-fi glasses` (no ref needed) | Add or change wardrobe on top of the character ref. |
| **POV / framing shift** | `from third-person to the character's subjective POV`, `close-up surround shot` | Direct the shot grammar. |
| **Audio bed** | `background music from @audio1`, `underscore with @audio1` | Use an audio ref as BGM. Requires `--generate-audio` i.e. **not** `--no-audio`. |

## Worked example — character into a sci-fi sequence

Goal: put a specific character inside a spaceship cockpit, using the
camera motion of a reference video, transitioning from third-person
to POV, ending in a deep-space vista.

```bash
node scripts/generate-video.mjs reference \
  --prompt "Replace the character in @video1 with @image1, with @image1 as the first frame. The character should wear virtual sci-fi glasses. Refer to the camera movement and close-up surround shots of @video1, changing from a third-person perspective to the character's subjective perspective. Travel through the glasses and arrive at the deep blue universe of @image2, where several spaceships are seen traveling into the distance." \
  --image-url assets/image/hero.jpg         `# @image1: the character`
  --image-url assets/image/space-vista.jpg  `# @image2: the destination`
  --video-url assets/video/dolly-shot.mp4   `# @video1: camera grammar`
  --duration 8 --aspect-ratio 16:9 --resolution 720p \
  --no-audio \
  --output assets/video/hero-intro.mp4
```

Notice each ref does a distinct, non-overlapping job:

- `@image1` = subject identity + first frame lock
- `@image2` = destination environment
- `@video1` = camera motion template (replaces verbose camera prose)

Because the roles don't overlap, the model can follow them cleanly.
If two refs fight for the same role (e.g. two different `@images`
both tagged as character), the output gets muddy.

## Asset slot budgets

Reference mode accepts:

- `--image-url`: up to **9**
- `--video-url`: up to **3**
- `--audio-url`: up to **3**
- Total across all modalities: **≤ 12**
- Audio refs require at least one image or video ref.

Slot planning tips:

- Include a character ref (image) whenever a specific person appears.
  Use multiple image refs of the same character only if one angle
  can't capture them (e.g. front + profile).
- Pick a video ref when camera motion, blocking, or pacing matter
  more than look. A 5-second motion ref beats three paragraphs of
  camera prose.
- Use audio refs sparingly — the output-audio filter rejects generated
  audio frequently, and `--no-audio` is the default-safe call.

## When to use `reference` vs `from-image` vs text-to-video

| Situation | Mode |
|---|---|
| Fresh generation from prompt only | text-to-video (default) |
| Animate from a single still | `from-image` |
| A specific character must appear | `reference` with a character `@image` |
| Transition between two distinct environments | `reference` with destination `@image` |
| Inherit camera language from another clip | `reference` with motion `@video` |
| Frame-to-frame interpolation (first + last frame) | `from-image` with `--end-image-url` |

The moment you have more than one visual intent you want to pin down,
switch to `reference` and assign roles. Don't try to do complex
direction through a single image + a long prose prompt — the prose
does not constrain enough.

## See also

- `references/character-consistency.md` — when the character ref is a
  photo-realistic person (special-case workflow and filter notes).
- SKILL.md "Content-policy retry pattern" — `--no-audio` as the
  default retry when seedance rejects on generated audio.
