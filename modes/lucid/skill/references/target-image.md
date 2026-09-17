# The target image — dreaming well

The target is the whole loop's contract. Every round is scored against it, so
a bad target costs every round that follows. Spend judgment here before you
spend any on code.

## What the target is

An **in-engine screenshot of the finished product**, as the user will see it
in the browser at the viewer's aspect ratio. Not concept art, not a cinematic
still, not a painting, not "an artist's interpretation". You will try to match
it down to the pixel, so it must be something a real-time renderer can
plausibly produce: one camera, one exposure, materials that exist, a UI layer
only if the product has one.

Prompt it that way. Say *"a screenshot of a running Three.js game, isometric
camera, 16:9"* and describe the scene, lighting, palette, materials and mood
concretely. Avoid the words *concept art*, *illustration*, *painting*,
*cinematic*, *render of* — the model reads them as permission to invent what
an engine cannot do.

## Fresh vs existing product

- **Fresh** — generate the target directly from the user's brief.
- **Existing product** — capture the current scene first and feed that capture
  to the image tool as the baseline, asking for a refined version that keeps
  the composition and improves what the user pointed at. The target must be an
  *improvement of what exists*, not a divergence; a divergent target makes
  every asset and camera decision already taken look wrong to the judge.

Re-dreaming later (the `re-dream` command) follows the same rule: start from
the latest capture, not from a blank prompt.

## Match the viewer — read the stage first

Run `lucid.mjs init` before you dream, then `get-scene-state`: `stage`
gives the exact size and aspect the stage renders at, even before your scene
does anything. Generate the target at that aspect. A 16:9 dream judged against
a 3:2 stage is letterboxing the scene can never reproduce, and it costs every
round that follows. Image tools do not honour requested pixel sizes exactly —
the aspect is what matters.

## Say the style, not just the subject

The model will happily upgrade "voxel-ish, real-time" into a painterly
perspective render with photographic weathering, and the judge will then
punish you for the style the user actually asked for. Put the requested
rendering style in the prompt in plain words — *orthographic isometric camera*,
*blocky voxel construction*, *stylized real-time lighting*, *a screenshot from
a running Three.js game* — and if the first result drifts from the brief,
dream once more rather than accepting a contract you cannot honour.

Write the light as carefully as the objects — the target's beauty is decided
here, and a prompt that lists objects gets a catalogue render: evenly lit,
saturated, nothing in shadow. Say where the light comes from and how much
of the frame is dark (*low-key, a single warm key from the lanterns, deep
blue shadow, rim light on the character*), what glows (*lantern glass
blooming, wet stone reflecting the flames*), what the air does (*mist in
the distance, rain streaks catching the light*), and what the surfaces are
(*worn, chipped, moss in the joints*). Even a bright, gentle brief has a
light: *soft late-afternoon key from the left, long warm shadows, hazy
backlight*. The judge scores lighting and materials as two of the four
areas; a target without a lighting idea has already given those points away.

Check the camera before you lock. An orthographic or isometric brief locked
against a dream with a horizon and perspective convergence makes every later
round chase a camera the user did not ask for: distant geometry that reads
as far away in the picture can only be drawn far away in an orthographic
scene by being huge, and the judge will keep scoring the difference. If the
dream has the wrong camera, dream again with the camera named first and the
subject second. If the second try still drifts, keep the user's camera, lock
the closer of the two, and write the mismatch into the round notes: the
target is evidence, the user's words are the contract.

## Lock it

Store the image through `lucid.mjs target <project> --set <png>`. The
previous target is archived on replacement, and the score trajectory always
says which target it was measured against. Never overwrite `target.png` by
hand. Locking does not start the budget clock — that started at `init`, when
the user asked, so a target that took ten minutes to dream has already spent
ten minutes of it.

## Ask the user, or not

If the user supplies a target, use it directly. If the user said "don't ask
me, just go", do not show the target for approval — lock it and start. If they
said nothing about that and the brief is ambiguous in a way that changes the
picture (isometric vs first-person, day vs night, painterly vs realistic),
show the target once with a `<viewer-locator>` to `{ view: "target" }` and ask
one question. One.
