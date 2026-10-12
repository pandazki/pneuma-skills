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

Prefer the bundled scripts through OpenRouter, even when the host also provides
a native image tool. New images default to GPT Image 2.5 Flare, with or without
references; `edit_image.mjs` defaults to GPT Image 2.5 Sunburst. Add
`--model sunburst` to upgrade a new generation or to edit through
`generate_image.mjs --image-urls`. Reference attachment alone does not select
the editing model. Read the current help before calling either script:

```sh
bun "<SKILL_DIR>/scripts/generate_image.mjs" --help
bun "<SKILL_DIR>/scripts/edit_image.mjs" --help
```

`OPENROUTER_API_KEY` comes from the session's configured environment. Never
include keys in artifacts or prompts. If it is missing, keep planned work
visibly planned and explain that the image scripts need an OpenRouter key;
do not replace requested imagery with fake finished work. Use Sunburst edits
with reference images for identity continuity. For example:

```sh
bun "<SKILL_DIR>/scripts/generate_image.mjs" "<new image brief>" --output-dir "<workspace>/assets"
bun "<SKILL_DIR>/scripts/generate_image.mjs" "<generation upgrade brief>" --model sunburst --output-dir "<workspace>/assets"
bun "<SKILL_DIR>/scripts/edit_image.mjs" "<edit brief>" --input "<workspace>/assets/source.png" --output-dir "<workspace>/assets"
```

Inspect every result for recognizable identity, readable intentional copy,
cropping, background alpha, image dimensions and context fit. For a claimed
transparent cutout, check alpha rather than assuming a checkerboard is transparency.
Store successful outputs locally. A failed or uncertain remote generation is not
fixed by changing a JSON status, and undoing local files does not cancel charges.

The original research workflow inspired this method; its pictures and wording are
not distributed in this mode. Seeds are fictional original brand examples.
