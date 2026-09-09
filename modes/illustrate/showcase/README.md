# Illustrate showcase

The four 1376 × 768 gallery PNGs combine a conceptual dark interface with
actual GPT Image 2.5 outputs. Four Sunburst requests produced the painterly,
paper, miniature, and poster artworks. Flare changed the painterly fox's
scarf from orange to blue using the original image as its reference.
No artwork was painted or retouched during layout; the source images were
scaled or cropped in HTML and the final screenshots were compressed.

`prompts.json` contains the complete prompts. `provenance.json` records the
models and hashes of the source outputs and gallery PNGs. Original artwork
is generated into the ignored `.tmp-illustrate-showcase/` directory.

## Regenerate

Run from the repository root with `OPENROUTER_API_KEY` configured:

```sh
bun modes/illustrate/showcase/generate.mjs
bun modes/illustrate/showcase/preview.mjs
```

Open `http://127.0.0.1:18142/?view=hero` in a browser at 1376 × 768 CSS pixels.
Capture `hero`, `text-to-image`, `row-canvas`, and `region-edit` after the local
fonts and all images finish loading. Save each PNG under its matching name.
If a Retina display doubles the screenshot size, resize to 1376 × 768 before
running `pngquant --quality=85-100 --speed 1` on the four final PNGs.

Generation makes five paid requests and never automatically retries a failed
request. It writes a receipt after each successful output. `preview.mjs`
serves only the artwork, the layout, and the repository's bundled fonts on
localhost; it does not launch an agent or alter sessions.
