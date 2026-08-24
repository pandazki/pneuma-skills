# Human reference notes

A writer prompt draws on human text from two directions, and they are not the
same thing. Keeping them apart is what this note is for.

- **The person the essay is for.** `taste/style.en.md` plus their own artifacts
  under `taste/examples/`. `voice_sample.ts` samples them and the composer puts
  them in the `<user_voice>` block, the last of the style inputs — after the
  reference prose it may override, and before the constraints. See
  [distill.md](distill.md) for how that record is built.
- **A texture reference.** Passages of published prose from the primer library,
  sampled by `primer_sample.ts` into `<reference_prose>`. Nobody's voice in
  particular — a reminder of what unhurried Chinese sounds like.

Priority, when they disagree: **frozen meaning > the user's voice > the
reference prose.** The material and `<must_keep>` are not style inputs at all
and are never overridden by either.

Neither of them is the last thing a writer reads. `<preceding_prose>` — the
essay so far — sits at the very end of the prompt, past the constraints, and
the prompt closes by telling the writer to continue directly from where that
text stops. That position is about continuation, not authority: it does not
lift the draft above the priority order above. What it buys is momentum and
register, which come from whatever was read last, and a writer that starts by
continuing rather than by starting over.

## Texture, not content

Both directions supply texture and nothing else:

- sentence breathing and interruption;
- paragraph movement;
- how qualifications are carried;
- how examples enter and leave;
- where emphasis lands;
- what kinds of figurative language are absent or sparse.

Never their subject matter, their images, or their distinctive phrases. Both
blocks say so in their own framing, and the framing is English written once in
`references/prompt-scaffolding.en.json`.

## Collecting a primer library

- Use lawful, attributable material suitable for analysis.
- Match language, genre, audience, and publication setting.
- Prefer several authors over one personality. One author's texture is that
  author's voice, and the point of this block is that it belongs to no one.
- Keep source text private where licensing or privacy requires it.

The bundled library ships with the mode; a user's own libraries are read from
`~/.pneuma/primers` and the project root, chosen once with the
`primerLibraries` init parameter. Do not read or list them during a task —
priming belongs to the scripts.

## When it does not help

Priming is optional and its value has not passed an ablation. Treat it as a
cold-start aid, not doctrine, and switch it off with `WORDTASTE_PRIMER=0` if a
run is worth comparing without it. If reference prose makes the writing more
colloquial but less precise, keep the precision and discard the effect: a
qualification lost is a meaning lost, and no amount of texture pays for that.
