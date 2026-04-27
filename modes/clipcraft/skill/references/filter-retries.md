# Seedance content-filter retries

`generate-video.mjs` surfaces API errors verbatim to stderr — the full
response body, including the `content_policy_violation` detail, shows
up in the Bash tool result. When you see a 422, match the signature
below to pick the right recovery action before retrying. Don't guess.

There are two distinct failure modes. They look similar but have
different causes and fixes.

---

## Signature A — image-side rejection

**What you see:**

```
bytedance/seedance-2.0 reference-to-video failed (422):
{"detail":[{"loc":["body","image_urls"],
            "msg":"The images or videos provided may contain
                   likenesses of real people or other private
                   information that cannot be processed.",
            "type":"content_policy_violation",
            "ctx":{"extra_info":{"reason":"partner_validation_failed"}}, ...}]}
```

Key tokens to match: `loc:["body","image_urls"]` and
`reason:"partner_validation_failed"`.

**What it means:** ByteDance's image classifier found a photorealistic
human face above a modest area threshold in one of your
`--image-url` assets and refused to process the request. The prompt
was never evaluated. Prompt rewording does NOT defeat this filter.

**Recovery:**

1. Identify which `--image-url` carries a photorealistic face — in
   practice this is almost always a single character reference.
2. Run `make-character-sheet.mjs` on that photo. It takes the image
   plus short outfit / character-trait descriptions and produces a
   **photo-body, sketch-head 16:9 sheet** that is verified to pass
   the image filter. Sheet anatomy and honest-limits notes are in
   `character-consistency.md`.

   ```bash
   node .claude/skills/pneuma-clipcraft/scripts/make-character-sheet.mjs \
     --source-url <the photo you tried to pass> \
     --outfit "comma, separated, outfit, items" \
     --traits "comma, separated, character, traits" \
     --output assets/image/character-sheet-<name>.jpg
   ```

   `--outfit` and `--traits` are both optional — omit them and
   the model reads them from the source image, at the cost of
   less-controlled annotations. For richer annotations or a more
   custom sheet layout, prefer `generate_image.mjs --image-urls` with
   a hand-written prompt (GPT-Image-2 composes the 4-panel layout +
   typewriter text reliably).

3. Replace the original `--image-url` with the generated sheet.
4. Remove any `virtual character` / `not a real person` / `CG render`
   framing from the prompt — those terms do nothing against this
   filter and actively degrade output quality (push the model toward
   a game-CG aesthetic).
5. Add `--no-audio` (Signature B below tends to hit on the retry
   otherwise).
6. Re-run `generate-video.mjs reference`.

Do **not** use this workflow for:

- Photos of real identifiable people you don't have rights for.
- Photorealistic minors of any origin (AI-generated or not).
- References that are already stylized — those pass seedance directly.

---

## Signature B — output-audio rejection

**What you see:**

```
bytedance/seedance-2.0 reference-to-video failed (422):
{"detail":[{"loc":["body","generated_video"],
            "msg":"Output audio has sensitive content.",
            "type":"content_policy_violation",
            "ctx":{"extra_info":{"reason":"partner_validation_failed"}}, ...}]}
```

Key tokens to match: `loc:["body","generated_video"]` and
`msg:"Output audio has sensitive content."`.

**What it means:** The image filter accepted the reference. Frames
were actually generated. Seedance then attempted to generate an
automatic audio track and its audio classifier rejected the result.
This is common on character-centric prompts and is largely orthogonal
to your prompt content.

**Recovery:**

1. Re-run the exact same command with `--no-audio` appended.
2. Do not change the prompt, seed, or any other flag. Just disable
   generated audio.

You can bake `--no-audio` in as a default for character-heavy
generations to skip the first-failure retry round.

---

## When neither recovery gets you through

If Signature A persists after regenerating the character sheet, the
sheet probably still contains too much photographic face. Inspect the
generated sheet visually — if any panel shows a clean photorealistic
face (especially frontal, close-up, studio-lit), edit the sheet again
to replace that face with a sketch. Panels 1–3 must have sketched
heads; only panel 4 should carry identity, and panel 4's portrait
should clearly read as a pencil drawing on sketch paper, not a photo.

If Signature A persists across multiple sheet iterations, or if the
character genuinely needs to look like a specific real person,
acknowledge the limit and surface it to the user rather than retrying.
This workflow is intended for false-flagged AI-generated characters,
not for bypassing identity-preservation controls.

Last-resort option: fall back to `--model veo3.1`. Veo 3.1 has a
different content classifier and accepts many refs that seedance
rejects. Caveats: veo3.1 only supports `--duration 4 | 6 | 8`,
does not support the `reference` subcommand (drop to `from-image`
with a single frame), and costs more per second.
