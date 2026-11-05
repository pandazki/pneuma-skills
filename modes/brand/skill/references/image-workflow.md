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
a native image tool. New images default to GPT Image 2.6 Flare, with or without
references; `edit_image.mjs` defaults to GPT Image 2.6 Sunburst. Add
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

## Vector assets

Choose SVG when a downstream maker must scale an asset to any size or recolour
it: icon sets, pictograms, simple geometric marks or symbols, pattern tiles and
graphic devices. Keep raster for characters, textures, scenes, photography and
mockups. `generate_svg.mjs` sends one request to GPT Image 2.6 on fal: the image
model renders a reference picture, then an author model writes the SVG markup.

```sh
bun "<SKILL_DIR>/scripts/generate_svg.mjs" --help
bun "<SKILL_DIR>/scripts/generate_svg.mjs" "<vector brief>" --palette "<brand.json palette values>" --output-dir "<project>/assets" --filename-prefix icons-core
```

Pass the `brand.json` palette values as `--palette "#F57843,#254F42"`. Write a
precise drawing brief: subject of each element, layout (for example six icons
in a 3×2 grid), stroke weight, caps and corners, fill or outline, the palette
hex values and the role of each, and "no background, no text, flat shapes"
unless those belong to the asset. Line icon sets came out excellent and a
geometric mark acceptable in measured runs (2026-11-05).

Know the limits before planning the work:

- Lettering is unreliable. A requested wordmark came back with garbled letters
  drawn as paths. Keep wordmarks set in real type, such as an HTML specimen
  using the actual font, or a reviewed raster generation. Do not request words.
- It takes no reference images, so it cannot trace or vectorise an approved
  raster mark. Every result is a new drawing. If the approved mark is raster,
  keep it as the master, and record that a designer must still redraw it as a
  vector. Do not present a new SVG as the same mark.
- One SVG per request, about 20 s with the default author and up to about
  60 s with others (`--author`, see `--help`); `--model sunburst` upgrades
  the reference picture. Each run is a paid request, so do not loop or resend
  after an error or timeout. The printed request ID identifies a possibly billed job.
- fal reports no usage for this endpoint. The script prints `cost: unknown`
  with fal's list price; tell the user that rather than estimating a figure.

Inspect before recording. Look at the rendered file at full size and at small
icon size, and read the JSON `report`:

- `vector.pure: false` means it embeds raster images; it is not a vector asset.
- `text.elements` above zero means its lettering depends on installed fonts.
- `offPalette` lists colours outside the palette you passed. Regenerate with
  the palette in the brief, or record the deviation for the user to decide.
- `background` names a full-canvas fill. A mark for any surface needs none.
- Any `activeContent` count means the file must not be distributed as is.
- `title` and `desc` state what the author model intended; compare them with what you see.

Record a result as an `image` work whose `file` is the `.svg`, usually stage
`assets`, or `identity` for a mark. Put the brief in `prompt`, and describe what
may be recoloured or scaled. Mark it `ready` only after inspection. The viewer
and the exported brand book show it like any other image.

`FAL_KEY` comes from the session's configured environment (the fal.ai key in
the launch settings); raster images do not need it. If the script reports that
the key is missing, keep the vector work visibly planned and explain that SVG
generation needs a fal.ai key. Never hand-write an SVG and present it as the
generated asset.

The original research workflow inspired this method; its pictures and wording are
not distributed in this mode. Seeds are fictional original brand examples.
