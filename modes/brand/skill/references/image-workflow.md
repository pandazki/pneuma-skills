# Image workflow

Inventory reusable assets before generating application examples. Identify core
marks, character anchors, reusable poses, textures and scene imagery. Keep raw
sources distinct from boards and composite mockups. Batch related pose studies
when useful, but verify separability and margins before relying on a sheet.

A generation brief names: intended use, output type and aspect ratio, exact copy,
each reference's role, identity invariants, allowed variation, composition,
materials and background/transparency requirements. Record that brief with the work.

For a brand handbook, a coherent sequence often demonstrates the mark, type/color,
graphic language, character (if used), and selected applications. Do not blindly
copy a fixed checklist; choose the examples that answer this brand's actual needs.

Use the host's native image tool when present. Optional portable fallback:

```sh
bun "<SKILL_DIR>/scripts/generate_image.mjs" --help
bun "<SKILL_DIR>/scripts/edit_image.mjs" --help
```

Read those tools' current help before invoking them. `OPENROUTER_API_KEY` comes
from the session's configured environment. Never include keys in artifacts or
prompts. If no generation capability is available, keep planned work visibly
planned and explain what is missing; do not replace requested imagery with fake
finished work. Use reference-based edits for identity continuity.

Inspect every result for recognizable identity, readable intentional copy,
cropping, background alpha, image dimensions and context fit. For a claimed
transparent cutout, check alpha rather than assuming a checkerboard is transparency.
Store successful outputs locally. A failed or uncertain remote generation is not
fixed by changing a JSON status, and undoing local files does not cancel charges.

The original research workflow inspired this method; its pictures and wording are
not distributed in this mode. Seeds are fictional original brand examples.
