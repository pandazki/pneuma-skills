#!/bin/sh
# Build and measure an isolated copy of Lucid's texture CLI.
set -eu
node --input-type=module -e 'if (typeof import.meta.main !== "boolean") { console.error("Use a Node release with import.meta.main, e.g. Node 25.1"); process.exit(1); }'
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mode=$(CDPATH='' cd -- "$here/../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/lucid-roughness.XXXXXX")
cd "$scratch"
printf 'Experiment directory: %s\n' "$PWD"
unset FAST_ANYTHING_DISABLE

cp "$mode/skill/scripts/texture.mjs" original.mjs
cp "$mode/skill/scripts/argv.mjs" "$here/check.mjs" .
# The recorder inserts its hook before this entry guard. Node 25 supports it.
sed 's/^if (isEntryPoint()) {/if (import.meta.main) {/' original.mjs > texture.mjs
if cmp -s original.mjs texture.mjs; then
  echo 'Lucid entry guard changed. Check the profiling copy before continuing.' >&2
  exit 1
fi
mkdir textures
for source in "$mode"/seed/ember-abbey/scene/textures/*.png; do
  # The seed uses indexed PNGs. Lucid reads RGB, greyscale and RGBA PNGs.
  ffmpeg -v error -i "$source" -frames:v 1 -pix_fmt rgb24 "textures/$(basename "$source")"
done

id=texture.mjs:roughnessMap
fast-anything scan -- node texture.mjs roughness textures/slate.png out.png --json
fast-anything port "$id"
crate=$(node -p 'Object.values(require("./.fast/state.json").ports)[0].crate_dir')
cp "$here/Cargo.lock" "$crate/Cargo.lock"
cp "$here/roughness.rs" "$crate/src/lib.rs"
fast-anything verify "$id"
fast-anything enable "$id"
node check.mjs
fast-anything bench --runs 21
fast-anything report
printf '\nVerified CLI: %s/texture.mjs\nReport: %s/.fast/report.md\n' "$PWD" "$PWD"
