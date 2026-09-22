# `loop` fixture — one seamless loop motion, on disk

A hand-built loop motion in the shape `sprite-sheet.mjs loop --json` produces
(the seamless-loop design brief, Contract 1), so `sprite-project.mjs` can be
pinned against real bytes without running the pipeline: 12 frames of a 32×32
box bobbing through one sine cycle inside a 64×72 transparent canvas, and the
four exports encoded from exactly those frames.

```
frames/000.png … 011.png   three digits — a full-rate loop runs past 99 frames
loop.webp                  libwebp_anim, yuva420p, -loop 0
loop.apng                  -f apng -plays 0 -pred mixed
loop.webm                  libvpx-vp9, yuva420p, -auto-alt-ref 0
loop.json                  Lottie 5.7.4, one image layer per frame, PNGs inline
keyframe.png               frame 000 on the white plate it was generated on
keyframe-alpha.png         the same image cut out
video-seedance-1.mp4       the clip the frames claim to come from
inspect.json / run.json    the loop-shaped report and the run summary
```

Two things the numbers in `run.json` are chosen for: `seam` 0.0065 against a
`step` of 0.02 is the reference clip's own measurement — a loop that closes,
with the seam at a third of a normal step — and the frames really are one
closed cycle, so a reader who renders them sees the same verdict the report
prints.

The paths inside `run.json` are workspace-relative (`motions/flame/…`), the
way `bounce-run.json` next door is: the test copies this directory into a
temp character as `motions/flame` and `--dir` resolves the rest.

Rebuilding it, if the shape ever has to change:

```sh
# one frame per i, y = 20 + 12·sin(2πi/12)
ffmpeg -f lavfi -i "color=c=black@0.0:s=64x72,format=rgba" -frames:v 1 \
  -vf "drawbox=x=16:y=$Y:w=32:h=32:color=0xf97316@1.0:t=fill:replace=1" frames/$N.png
ffmpeg -framerate 12 -i frames/%03d.png -c:v libwebp_anim -pix_fmt yuva420p -q:v 85 -loop 0 loop.webp
ffmpeg -framerate 12 -i frames/%03d.png -f apng -plays 0 -pred mixed loop.apng
ffmpeg -framerate 12 -i frames/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 40 -row-mt 1 loop.webm
ffmpeg -framerate 12 -i frames/%03d.png -c:v libx264 -pix_fmt yuv420p video-seedance-1.mp4
```

`loop.json` is the Lottie writer from the brief: one `assets[]` entry and one
`ty: 2` layer per frame, each PNG base64'd into `p`. The `exports` sizes in
`inspect.json` are the byte counts of the four files beside it — `register-run`
measures the files themselves, so they are documentation, not a source.
