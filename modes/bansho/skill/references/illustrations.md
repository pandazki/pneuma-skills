# The figure the board cannot draw

Almost every picture a lecture needs, the board draws itself: a `chart`
rules its axes and lays a line down, a `graph` puts boxes and arrows on
in reading order, and the pen inks the words you marked. Those are drawn
in front of the user at the speed a hand works, they cost nothing, and
watching them arrive IS part of the explanation.

A few pictures are not like that. A neuron. A cross-section of a valve.
A hand pointing at a thing. Where the meaning lives in the drawing
itself, the board has nothing to rule and nothing to connect — and the
lecture that needed that picture goes without one, which is the failure
this page exists to prevent.

So there are two tiers, and **both are decided in `plan.md`, before the
first board step** — never in the middle of writing, where the decision
would cost you the thread of the argument.

## The rule — applied, not agonized over

> **Can it be said with `chart`, `graph`, or ink on the words? → tier 1.**
> **Does it need real hand-drawing ability? → tier 2.**

That is the whole test. Run it once per figure, in the design, and move
on.

- **Tier 1 — the board's own.** Anything that counts, compares, splits or
  traces a flow. The board genuinely draws it, one line at a time, in
  step with the sentence that introduces it. It is also the better
  picture *as a lecture*, because the audience watches it being made.
  When in doubt, tier 1.
- **Tier 2 — ordered from an outside hand.** A shape, a body, a piece of
  apparatus, an object whose likeness is the point. One command, one
  picture, drawn in chalk on black, placed on the board like anything
  else.

Two traps, the same two the design page names for figures generally:

- **A drawing that only decorates is not a figure.** If the sentence
  already says it, the picture is a picture of the sentence.
- **Tier 2 is not the ambitious choice.** Reaching for it where a `graph`
  would do buys a still picture with money and a wait, and gives up the
  drawing-in-front-of-you that made the board worth watching.

## The look is not yours to write — you fill in the subject only

The prompt has one fixed opening, settled and measured. Copy it exactly —
one line, never retyped from memory:

```text
A chalk drawing on a blackboard. Pure white chalk lines on a solid pure black background. Line art only: no fill, no shading, no gradients, no color. Loose confident hand-drawn strokes, the way a professor sketches while lecturing — slightly uneven, alive, not mechanical. Clear readable silhouette, generous spacing, no frame, no border, no background scenery, no text labels. Subject:
```

**Everything after `Subject:` is yours, and it is only ever the subject.**
No look, no colours, no "blackboard", no "chalk", no "line art" — the
opening already said all of it, and saying it twice is how a picture
comes back grey, boxed, or with a lecture hall drawn around it.

**Wrong** — the subject re-states the look, and fights it:

```
Subject: a neuron drawn in white chalk on a blackboard, sketchy hand-drawn
style, dark background, with labels for the axon and the dendrites
```

**Right** — the subject is a subject, described the way you would
describe it to someone drawing it for you:

```
Subject: a single neuron — dendrites branching in on the left, one long
axon wrapped in myelin segments, ending at a synapse
```

Say what is in the picture and how the parts sit relative to each other.
That is the whole of your half.

## Why the picture carries no lettering

The opening bans text labels twice over, and both reasons matter:

- **Lettering that is drawn for you is unreliable** — misspelt, half a
  word, a language you did not ask for.
- **It would be in the wrong hand.** Every other word on that board was
  written by the board's own pen, at the speed a hand writes. A label
  baked into the picture arrives fully formed, in a hand nobody else on
  the board has.

So labels go on the board, written by the board: place the picture with
`@at`, and write the naming sentence beside it. That reads better anyway
— the audience gets the shape first and the names as you say them.

## Ordering one

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "A chalk drawing on a blackboard. Pure white chalk lines on a solid pure black background. Line art only: no fill, no shading, no gradients, no color. Loose confident hand-drawn strokes, the way a professor sketches while lecturing — slightly uneven, alive, not mechanical. Clear readable silhouette, generous spacing, no frame, no border, no background scenery, no text labels. Subject: a single neuron — dendrites branching in on the left, one long axon wrapped in myelin segments, ending at a synapse" \
  --aspect-ratio 4:3 \
  --output-dir <content set>/illustrations \
  --filename-prefix neuron \
  --output-format png
```

The prompt is the first thing on the line and takes no flag of its own.
The command prints a small JSON object; `files[0]` is the path it saved.
It needs `FAL_KEY` in the session `.env` (the fal.ai key init parameter),
the same key the voice uses.

**Never pass `--style`.** `--style sketch` rewrites your prompt behind
you, appending "…no shading, white background" — and a white background
is the one thing a board cannot take a picture from: it comes back as a
solid block standing where your figure should be. The default leaves the
prompt alone, which is what you want.

**The picture is never pasted onto the board.** White-on-black is not a
look you are choosing, it is a *stencil*: the board reads the picture's
brightness as the shape of the drawing and then paints that shape in its
own chalk. So the file you order is not what the audience sees — chalk
on slate in a dark room, dark ink on plaster in a light one, from the
same one file, with nothing regenerated when the theme changes. That is
also the whole reason a white background is fatal: a solid bright field
is a stencil with no holes in it.

Do not plan around a dark plate pinned to a pale board, and never write
a line on the board excusing one. There is no plate. Ask for the picture
the lecture needs and the room will ink it in its own hand.

Pick the aspect ratio from what the picture is: `4:3` or `1:1` for a
thing, `16:9` for something wide, `3:4` for something tall. It is a
declaration, not a measurement — see below.

## Where it lands, and how the board finds it

The picture files live in `illustrations/`, beside `board.md` in the
content set, and one sidecar names them:

```json
{
  "figures": {
    "illustrations/neuron.png": {
      "width": 4,
      "height": 3,
      "subject": "a single neuron — dendrites branching in on the left, one long axon wrapped in myelin segments, ending at a synapse"
    }
  }
}
```

`illustrations/manifest.json` sits next to `board.md`, exactly as the
voice's manifest does, and the same three rules hold:

- **The key is the path you write in `board.md`** — relative to the
  content set, never prefixed with the set directory. A picture the board
  is asked for and cannot find an entry for is not drawn: a badge stands
  where it should have been, and `check-board` says which one.
- **`width` and `height` are the two halves of the ratio you asked for** —
  `4:3` becomes `"width": 4, "height": 3`. Only their ratio is read, so
  any pair in that proportion does (a single `"aspect": 1.3333` — width
  ÷ height — is accepted too). It is how the board knows how tall to
  leave the space before the picture has arrived: nothing is measured off
  the file, so the wall lays out the same way at every window size.
- **`subject` is the sentence you filled in.** Keep it and a re-draw is
  one command away; drop it and the next hand has to invent the picture
  again.

Save the sidecar **last** — its write is what tells the board the
pictures changed.

## Putting it on the board

A picture is one step, written on its own line, in the passage it
belongs to:

```markdown
@at right

![一个神经元](illustrations/neuron.png)

@at left

先看它的形状：一头是树突，另一头是轴突。
```

The alt text is what the figure is, in words — write it as you would say
it. The picture is FITTED INSIDE the room its `@at` word gave it: as wide
as that room allows, but never deeper than it. A tall picture in a shallow
band therefore comes out narrower rather than hanging off the bottom, and
its shape is always the ratio you declared — what gives is the size, never
the proportions. It stands centred in whatever the binding side left over.
How long the board spends putting it up follows from that ratio, like a
chart: not yours to time.

**A room still fills up.** The picture fits the room; it does not make the
room bigger, and the prose you introduce it with is standing in there too.
A heading and a figure together in a half-deep band is a band that
overflows — `check-board` says so (`regionBurst`: "the writing goes on
below; the board does not"), and the answer is the same as for prose that
overfills: a wider word, a board of its own, or a smaller claim on the
room. A figure wants a column or a face, never a band shared with the
prose that introduces it.

**And look at it once it is up.** A picture you ordered is a picture you
have never seen on this board: `capture` it after it plays and ask whether
it reads at the same distance as the writing beside it — a drawing fitted
into a corner is a drawing at quarter size. Same question, same cure, as
for the board's own figures (`references/charts.md`): a wider word before
anything else.

## One batch, right after the plan — never mid-lecture

Every tier-2 picture in the design is ordered in **one batch**, once the
plan is settled and before the first board step is written.

Each one is real money and the better part of a minute. Ordered in the
middle of a lecture, that wait lands between two sentences the user is
watching, and you spend the pause holding a command instead of the
argument. Batched, the pictures are simply on disk by the time the pen
needs them, and the whole of the writing carries nothing extra: you look
up, you write the passage, the figure it names is already there.

If the design changes later and a new tier-2 figure appears, order that
one when you revise `plan.md` — at the design, again, never mid-lecture.

## No key, no invention

Without `FAL_KEY` there are no tier-2 pictures, and that is an honest
outcome with a written answer:

1. **Say it in `plan.md`**, in the line where the tier was decided.
2. **Fall back to tier 1** where the idea survives it — a `graph` of the
   parts, a `chart` of the proportions.
3. **Or drop the figure and tell the user** which one and why, so they
   can add a key and ask for it.

**Never fake it.** Do not write a paragraph that pretends to be the
picture, do not point `![…](…)` at a file that was never made, and never
let a missing figure pass in silence — a lecture with a hole where its
central picture was is worse than one that says out loud it could not
draw it.

## When the picture comes back wrong

Look at it before you place it. Three failures are common and all three
are one more command away from fixed:

- **A background, a hall, a desk** — the subject wandered into a scene.
  Cut the subject back to the thing itself.
- **Grey, filled, shaded** — something in your subject implied a look.
  Take the look words out; the opening owns them.
- **Lettering on it** — a part name in your subject read as a label.
  Describe the part's position instead ("branching in on the left"), and
  write the name on the board beside it.

If a second try misses too, the picture is fighting the medium: take
tier 1 and draw what the picture was for.
