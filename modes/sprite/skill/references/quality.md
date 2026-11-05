# Animation measurements and optional alpha cleanup

`inspect` records `animation` beside its compatible geometry fields. Loop and
transition runs record the same measurements without sprite alignment advice.
Motion-directory inspection persists them in `<motionDir>/inspect.json`; run
summaries also include them under `inspect.animation`. Direct GIF inspection
prints a report only and never writes beside the GIF.
`drawingCount` counts contiguous runs separated by the declared adjacent image
difference threshold, including a return pose as a new run. It does not count
unique poses or infer anatomy. `adjacentPairs` supplies the denominator.

`holds` names adjacent similar drawings and their combined duration. `heldMs`
sums the complete presentation duration of these linear runs, including their
first frame, with `heldFrameCount` as its frame denominator. Runs are not
merged across the wrap. Unknown timing produces null durations. A hold can
be intentional timing. `changeSpikes` are suspected temporal discontinuities,
not proven ghosts or identity errors. `alphaMass` is mean alpha coverage, and
`alphaChanges` reports signed changes. Smoke, glow, glass, particles, deforming
props and abstract animations can legitimately change alpha and silhouette.
Applicability to the intended action and artistic quality remain unknown.

`inspect animation.gif --json` decodes each GIF drawing once and reports its
packet delays without writing beside the source. Unreadable delays use the
existing decoder's median fallback, explicitly named in timing and warnings.

Timing belongs to the measured artifact. `inspect` reads atlas frame durations
when the atlas order matches the frame count. Missing usable timing remains
`unknown`. Loop and transition reports use their exported frame rate. A GIF's
raw delays describe that GIF only. A derived atlas can play differently, so its
report must never call source GIF delays its playback durations. Legacy fields
such as `feetX`, `headDrift` and `scaleDrift` retain their numeric definitions;
their names do not prove the subject has feet or a head, nor require a fixed
silhouette. View the motion before changing alignment or shape.

## Deliberately requested cleanup

```sh
bun <skill-dir>/scripts/sprite-sheet.mjs alpha-clean native-alpha.png \
  --out cleaned-copy --max-alpha 15 --keep-edge 2 --json
bun <skill-dir>/scripts/sprite-sheet.mjs alpha-clean motion/frames \
  --out cleaned-frames --max-alpha 15 --keep-edge 2 --json
```

Output is always a **new directory** containing copied PNG filenames and
`alpha-clean.json`. Frame directories use contiguous numbered PNG names. This
command does not register the result, change `project.json`, enable native-alpha
generation or alter existing source pipelines. Review the copy before using it.

`maxAlpha` is an inclusive integer ceiling from 0 through 254. Stronger support
is original alpha greater than that ceiling, including alpha 254 when using the
15 default. `keepEdge` is an integer radius from 0 through 64 in original image
pixels. Diagonals count. All bytes of the original stronger support and every
pixel within its original edge band remain unchanged. Only positive alpha at
or below the ceiling outside that band becomes `(0,0,0,0)`. Dimensions stay the
same. Hidden RGB in already transparent pixels stays unchanged. Cleanup never
normalizes opacity. Repeating the same parameters is idempotent.

An image without stronger support is left unchanged with
`skipped: "no-stronger-support"`; a wholly translucent effect is not erased.
Intentional faint detached particles or glow can still be removed from an image
with support. The report measures removed pixels and their bounding rectangle,
records parameters and file hashes, and keeps artistic quality unknown.

Animated PNG is refused rather than silently flattening its animation.

Sources remain byte-identical. Existing outputs, overlapping paths and symlink
frame aliases are refused. The command stages every frame and its report before
publishing. A decode/write failure removes the stage without publishing a partial
copy. The destination parent must already exist.

The alpha mask algorithm adapts `sprite_gen/frames/alpha_floor.py` from
aldegad/sprite-gen at `4f5ccd55c7cf06685a41f954acc1e476b7772ece` (Apache-2.0).
Its floor is this command's `maxAlpha + 1`. This version additionally skips
images without stronger support. Adjacent change measurement reuses the existing
premultiplied area-thumbnail helper; no new codec or dependency is introduced.
