# C2 stage verification (G7) — @focus → talk → @overview

Board: `stage-demo` (a `board.md` with `@focus "注意力引导"` → `@wait 2.5` →
`@overview` → one closing prose step), played in the dev server at viewport
1600×1100, light theme, rate 1×. Total canonical duration 38.9 s.

## The measured trajectory (stage transform sampled at 100 ms during a replay)

```
 0.1s   ty=0      z=1.0000   follow — the pen camera, top of board
24.4s   ty=-83    z=1.0000   follow stepping down with the pen (C1 per-unit pulls)
32.4s   ty=-273   z=1.0000   last write before the camera segment
33.9s   ty=-241   z=0.9908   @focus glide begins FROM the live follow pose (no jump)
34.0s   ty=-59    z=0.9799   mid-glide: z bows below 1 — the Van Wijk arc
34.2s   ty=0      z=1.0000   focus pose reached (anchor step centered, z=1)
37.1s   ty=1.3    z=0.9875   @overview glide begins (hold spanned the @wait)
37.3s   ty=9.4    z=0.7806   overview pose: content-so-far fitted + centered
37.7s   ty=-314   z=1.0000   decay: writing resumed → hand-back to the pen camera
```

- The `@focus` window opens at exactly the pose the live follow was at
  (`ty` −273 → glide), because the fold's from-pose is the canonical follow
  proxy — the lurch this replaces is on record in the pre-fix trace, where
  the window opened with a one-frame z jump 0.78 → 1.0.
- Mid-glide z dips below both endpoints (0.98 on a pure pan): the V&N path
  pulls back instead of shooting the picture across — the anti-queasiness
  property the spec names. Time is eased (cubic-in-out over arc length).
- Small moves are quick by design (0.32 s / 0.25 s here — the ρ-metric makes
  near moves fast and cross-board jumps slow; the scaling is property-tested).
- The decay hand-back (37.7 s) is an instant cut back to the pen, per the
  pinned decay rule ("follow" = C1's live path, which writes discretely).

## Scrub purity, demonstrated live

The screenshots were captured by scrubbing OUT OF ORDER (0.91 → 0.875 →
0.956 → 0.964 → 0.995 of the timeline); every pose matched the play-through
trace at the same t byte-for-byte — the register is a function of `t`, not of
query history.

| File | Moment |
|---|---|
| `01-follow-writing.png` | t≈17.6 s — live follow, pen writing at z=1 |
| `03-focus-glide-mid.png` | inside the @focus window — interpolated pose |
| `04-focus-hold.png` | mid-@wait — anchor held, script highlights `@focus` (G6) |
| `05-overview-glide-mid.png` | inside the @overview window |
| `06-overview-hold.png` | overview held — content-so-far fitted, unwritten tail absent |
| `07-decayed-follow.png` | post-decay — pen camera restored, closing line mid-write |
