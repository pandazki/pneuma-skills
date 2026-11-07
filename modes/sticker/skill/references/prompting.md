# Prompts: what the script sends and what a change does

Every prompt is assembled by `sticker-state.mjs` from `pack.json`; the CLI
sends exactly that text and records it on the file, and the viewer runs the
same function to tell whether a take is stale. `prompts` prints it. You steer
it through the fields, never by sending your own text.

## A sticker take

The anchor image goes along as the reference. The clauses, in order:

| Clause | Comes from | Why it is there |
|---|---|---|
| "Use the character in the input image exactly: same face, body shape, colors, markings and line style." | fixed | identity is the image's job first |
| "The character: …" | `character.description` | names the features the model must keep in every frame |
| "Style: …" | `character.style` | the drawing style (default: thick clean dark outlines, flat colors) |
| "A short looping animated chat sticker." | fixed | the format |
| `It expresses "<word>" through pose and face only.` | `word`, only when `caption` is empty | the meaning without text |
| same size and ground line in every frame, fully inside the frame with a clear margin | fixed | no drifting or growing figure, nothing cut at an edge |
| exaggerated facial expression that reads at a tiny size | fixed | thumbnails |
| solid crisp shapes: no motion blur, dust or semi-transparent effects | fixed | GIF transparency is on or off per pixel; anything soft turns to noise |
| a thick white die-cut sticker border around the whole character | fixed | stays visible on a dark chat background (measured below) |
| fully transparent background | fixed | |
| the last frame flows back into the first | fixed | the loop |
| "Action: …" | `action` | the motion |
| one big bold hand-lettered caption at the bottom, the same in every frame, reading exactly "…", thick white outline, no other text | `caption` (the script names the language from its script) | or, with no caption: "No text, letters or symbols anywhere." |

Sent alongside, not in the text: `motion.frames` × `motion.frameMs` at
`motion.size`², medium quality, transparent background, GPT Image 2.6 Flare.

Keep `description` to identity. Direction for one sticker ("tired eyes",
"holding a phone") belongs in that sticker's `action`; in the description it
would reach every sticker.

## What each change does

| Change | Effect | Cost |
|---|---|---|
| `gen --only s03 --redo`, nothing edited | the same prompt, a new sample: other staging, timing and caption lettering | one take |
| edit a sticker's `action` or `caption` (or `word` when it has no caption) | that sticker's prompt changes; its takes turn stale until a re-roll | one take |
| edit `character.description` or `style`, or pick another anchor | every take turns stale | the whole pack |
| edit `motion` | every take turns stale | the whole pack |
| set `keepFrames` | no new take; that sticker's exports turn stale | free (export again) |
| pick another take or art | the exports made from the old pick turn stale | free (export again) |

## Re-roll, rewrite or trim

- A wrong caption, a clipped effect, a glitch in one frame, a small identity
  slip: re-roll as it is. The seed's first 加班中 take had marks cut off at
  the top edge in frames 4–7; the re-roll was clean.
- The pose does not read, or two re-rolls fail the same way: rewrite the
  action (fewer beats, bigger moves, no prop), then re-roll.
- Identity drifts in every take: the anchor or the description is the cause;
  fixing it restarts the pack, so agree it with the user first.
- The loop jumps: look at the last frames on the contact sheet. If a tail of
  frames wanders off and the jump is real, `keepFrames` (free); if the jump is
  a small change of expression, it may not be worth trimming: the seed's
  摸鱼 is flagged at 2.27× for an eyelid that settles, and was kept.

## The character and the art

`characterPrompt`: with the user's picture attached, "redraw the subject as
an original chat-sticker character; keep who it is: <description>", the
style, full body front view with a margin, bold shapes that read at 240 px, a
friendly neutral expression, a transparent background, no text, shadow or
frame. Without a picture it designs from the description.

`artPrompt` attaches the anchor:

- **portrait** (→ WeChat cover, Telegram thumbnail) and **head** (→ WeChat
  icon, LINE tab) are transparent and ask for no white outline, because the
  WeChat cover rule forbids one. The head names what to leave out (body,
  legs, hooves): with a full-body anchor, "only the head" alone came back as
  the whole figure on the seed run, and the reworded prompt gave a head.
- **banner** and the two **reward** pictures are opaque scenes. They carry the
  pack's theme — the first chosen platform's listing name and blurb, else the
  stickers' words — and are told the scene belongs to that world, not to the
  place the character's species suggests, and to write no words. Before this,
  an office ox's banner came out as a farm; the seed's banner is a late-night
  office desk.

Art is not checked for staleness: after the character changes, make new art.

## Measured defaults (2026-11-06)

### The white border

Dark-outlined characters lose their outline on a dark chat background (an
earlier smoke take's outline and dark hooves nearly vanished on #111). Two
stickers of the seed, two takes each, with and without the border clause,
same anchor, 512² × 16:

| Variant | Sticker | Take | Raw | Wall | Loop seam | On the dark plate |
|---|---|---|---|---|---|---|
| no border | 收到 | 1 | 770 KB | 32.0 s | 1.99× | outline gone; the saluting hoof a dark blob; motion lines vanish |
| no border | 收到 | 2 | 792 KB | 34.2 s | 1.47× | the same |
| no border | 下班啦 | 1 | 668 KB | 29.3 s | 0.90× | outline gone; hooves merge with the plate in the jump |
| no border | 下班啦 | 2 | 754 KB | 32.0 s | 3.83× | the same; the loop jumps |
| border | 收到 | 1 | 883 KB | 36.5 s | 2.71× | thick white border in 16/16 frames; hoof, outline and marks read; the loop jumps |
| border | 收到 | 2 | 902 KB | 28.3 s | 1.42× | thinner border, 16/16 frames; reads |
| border | 下班啦 | 1 | 868 KB | 31.1 s | 0.47× | thick border 16/16; reads |
| border | 下班啦 | 2 | 811 KB | 30.3 s | 0.56× | thick border 16/16; reads |

On the light plate both read. Identity held and captions were exact in all
eight. The border costs about 15% more raw bytes, which the exporters absorb.
Decision: the border clause is in every take's prompt. "No white outline" is
a rule of the WeChat cover alone, which is made from the portrait art, so the
border never meets it; LINE's main image, cut from a sticker, has no such
rule.

### 512² × 16 frames × 120 ms

The seed's nine takes: 16 frames each as asked, 806–1003 KB raw, 1-bit alpha,
corners clear, 26–60 s wall (the first four waited on retried downloads; the
rest took 26–30 s). Exported without dropping a frame or a colour: WeChat
GIFs 319–411 KB (limit 500), Telegram WEBM 173–237 KB (limit 256), LINE APNG
412–505 KB (limit 1 MB, 2 plays).

Downloads of finished GIFs fail often right after the jobs finish: the seed
run and both trials of 2026-11-07 saw `fetch failed` retries, and in one
trial fal's file host refused connections for about 20 s, so four finished
takes failed after three attempts. The download now tries six times over
90 s; a take that still fails is fetched later by its request with
`recover`, free.
