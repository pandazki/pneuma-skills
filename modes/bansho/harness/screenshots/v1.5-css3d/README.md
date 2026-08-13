# V1.5 — CSS 3D (G7 visual verification)

Same session, one page, viewport **1600×1100**, board width **1242**,
theme **dark** — the V1 A/B's universe (`layout-baseline/README.md`).
`before/` is a `git worktree` at `39ef925`; `after/` is the branch.

| File | What it evidences |
|---|---|
| `before/fourier.jpeg`, `before/four-boards.jpeg` | the at-rest board on the V1 code |
| `after/transition-mid.jpeg` | **the transition's perspective, caught mid-flight.** A settled still cannot show it — depth only exists inside a camera move — so the playhead was scrubbed onto the peak of an `@overview` move and parked there: pose `perspective(1600px) rotateX(-0.287deg) rotateY(-5.741deg) translateZ(-89.911px)`. The two standing boards are equal-height panels; on screen the right one measures **385px** and the left **372px**, a 3.5% foreshortening across the wall. That difference IS the perspective |
| `after/parallax-left.jpeg` / `after/parallax-right.jpeg` | the parallax probe at two pointer positions on `fourier`, `rotateY(∓3.52deg)`. Mirror images: pointer left, the LEFT edge recedes; pointer right, the RIGHT edge does. Every annotation — the circle on 孤零零的细线, the highlight band, the drawn rules, the back reference — stays on its words while the plane turns, which is the visual half of the measurement proof |
| `after/parallax-right-bottom.jpeg` | the strongest deflection the probe allows (`rotateX(-3.984deg) rotateY(3.987deg)`), the pose the 322.58px / 0.00px drift numbers were measured at |

**How the mid-transition frame was caught** (it is not obvious, and it is
the only way to see this feature in a still): drag the timeline slider
across its full width in 400 steps, sampling `.bansho-depth`'s inline
transform at each. Camera moves show up as short runs of non-empty poses
— on `four-boards` a single move occupied 4 of 400 samples. Re-drag to
the sample with the largest `|rotateY|`, release, screenshot. The pose is
a pure function of `t`, so the parked frame is exactly the frame playback
would have drawn.
