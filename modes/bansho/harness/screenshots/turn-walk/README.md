# `@turn` — the walk to the next board (2026-08-11)

The acceptance evidence for "switching boards has motion". Screenshots of
settled states cannot show a transition, so this is a **frame sequence
through one `@turn`**, taken by exploiting seek purity: the pose is a pure
function of `t`, so a scrubbed frame is exactly the played one.

Board: the product owner's `queue-collapse` (a 4:48 lecture a cold agent
wrote with ten `@turn`s), served on a private port, own Chrome profile,
headless 1600×1100, dark.

| frame | t | `.bansho-depth` transform | `.bansho-stage` transform |
|---|---|---|---|
| f00 | 23.60 | *(empty — square on)* | `translate(0px, 0px) scale(1)` |
| f01 | 23.88 | *(empty)* | `translate(0px, 0px) scale(1)` |
| f02 | 24.16 | *(empty)* | `translate(0px, 0px) scale(1)` |
| f03 | 24.44 | `rotateY(-0.568deg) translateZ(-8.5px)` | `scale(0.994894)` |
| f04 | 24.72 | `rotateY(-4.262deg) translateZ(-63.9px)` | `translate(-12.9px, 66.5px) scale(0.857086)` |
| f05 | 25.00 | `rotateY(-5.912deg) translateZ(-88.7px)` | `translate(-390.4px, 135.6px) scale(0.708281)` |
| f06 | 25.28 | `rotateY(-2.845deg) translateZ(-42.7px)` | `translate(-1100.4px, 31.8px) scale(0.931546)` |
| f07 | 25.56 | `rotateY(-0.029deg) translateZ(-0.4px)` | `translate(-1273.9px, 0.03px) scale(0.999943)` |
| f08 | 25.84 | *(empty — square on)* | `translate(-1274px, 0px) scale(1)` |
| f09–f10 | 26.12–26.40 | *(empty)* | `translate(-1274px, 0px) scale(1)` |

Read as a shot: the board is square-on and unskewed while it is being
READ (f00–f02, and again f08–f10 — the ratified boundary of css3d brief
§2, enforced by `depthBump`'s value at `p ∈ {0,1}` rather than by a
conditional). Then the room steps back far enough that **both boards are
in frame at once** (f05, scale 0.71 — the Van Wijk pull-back), yaws
toward the direction of travel, sweeps right until the finished board
leaves at the left edge (f06), and settles square-on in front of the new
one.

`perspective(1600px)` is present in every non-empty pose and absent from
every empty one: **there is no 3D surface at rest**, which is what keeps
the V1 layout baseline byte-identical by construction.

## The gap this same instrument found

`jumps` scan, 601 samples over the same lecture — every change of the
board under the camera, and whether a transition was in flight:

```
board 0 -> 1  t=24.9..25.4   depth ACTIVE
board 1 -> 2  t=61.4..61.9   depth ACTIVE
board 2 -> 3  t=72.2..72.7   depth inactive
board 3 -> 0  t=79.5..80.0   depth inactive
board 0 -> 3  t=90.2..90.7   depth inactive
board 3 -> 0  t=91.7..92.2   depth inactive
board 0 -> 1  t=112.2..112.6 depth inactive
board 1 -> 2  t=143.4..143.9 depth inactive
board 2 -> 0  t=170.2..170.7 depth inactive
board 0 -> 1  t=200.9..201.4 depth inactive
board 1 -> 2  t=231.6..232.1 depth inactive
board 2 -> 0  t=264.3..264.8 depth inactive
board 0 -> 1  t=289.7..290.1 depth inactive
```

Two of thirteen. The two that glide are the `@turn`s that found a clean
board to walk to. The other eleven are **the live follow chasing the pen
onto another board** — a write's camera walk, applied instantly by
`applyCamera` since C1, with no window on the canonical timeline to
interpolate over. `@turn` is fixed; the follow's own board changes are
not, and making them glide is a change to the follow's contract (it holds
no animation state on purpose — that is what makes scrub trivially
correct), not a tuning knob.
