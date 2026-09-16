# Judging and the exit rules

The judge is the loop's conscience: a fresh agent with no memory of what you
tried, looking only at the capture, the target and the previous verdict. You
never score your own work. The rubric, the gap format and the exit rules are
encoded in `lucid.mjs`; this file explains how to run a round and what the
verdict means.

## One round

1. Point the stage at the live scene (`navigate-to` `{ view: "live" }`); this
   clears a round or the target the user may have left selected.
2. Make sure the scene is ready: `get-scene-state` → `ready: true`, `errors`
   empty, `bridge: true`. Then `capture` with no address; the framework
   returns a PNG path, and `get-scene-state.lastCapture.source` must read
   `"live"`. A frame captured while assets load, or a still of the target,
   is a wasted verdict.
3. Record the round: `lucid.mjs round <dir> add --capture <png> --fps <fps>`
   (fps from `get-scene-state`). Use `--kind rethink` only for the deliberate
   big-picture round described below.
4. Get the judge brief: `lucid.mjs judge-prompt <dir>`. Its first line is the
   path of `rounds/NN/judge-brief.md`, which holds the rubric, the absolute
   paths of target and capture, the previous verdict and the exact output
   schema, plus the instruction to write `rounds/NN/verdict.json`. Spawn a
   fresh subagent with a clean context (no history, no fork) and a one-line
   prompt: read that file and do what it says. Passing a path instead of
   pasting text is what keeps the JSON exact.
5. Ingest: `lucid.mjs verdict <dir> --round N` reads `rounds/NN/verdict.json`
   (`--file <json>` or `--file -` for another source). The script validates
   ranges, recomputes the total and reports `evaluation.exit`.
6. Read `lucid.mjs status <dir>` and do what it says. Then `navigate-to`
   `{ round: N, view: "split" }` and tell the user the score in one line with
   a `<viewer-locator>` to that round.

## Reading a verdict

Four scores — composition 0–3, lighting 0–3, materials 0–3, details 0–1 —
sum to a total out of 10. Gaps are the work list: each has an `id`, an
`area`, the `issue` (what gives the impression) and the `fix` (what to change).
Work every gap, biggest area first; do not argue with the judge in chat.
The judge reuses a gap's `id` when the same problem persists, which is how
the script detects repetition.

## The exit rules (computed by the script, not by you)

| `exit` | Meaning | What you do |
|---|---|---|
| `dreaming` | No target locked | Dream and lock a target |
| `continue` | Normal | Fix the gaps, next round |
| `done` | total ≥ 8 and fps ≥ 90 % of target | Show the round, ask whether they want more |
| `optimize-fps` | total ≥ 8, fps measured below 90 % of target | Lossless optimizations first (textures, shadows, bloom), then minimal-impact ones; re-judge to prove no visual regression |
| `continue` with reason "fps unmeasured" | total ≥ 8 but the round carries no fps | Record the next round with `--fps` from `get-scene-state`; nothing else changes |
| `stall-approaching` | Best score gained < 1 point over two rounds, or a gap repeated | Stop tweaking. Rethink the whole approach — assets, camera, lighting model — and make one dramatic change as a `--kind rethink` round |
| `stalled` | The rethink did not help | Stop spending. Show best and latest to the user and ask whether the current state is good enough or something is fundamentally off |
| `budget-exhausted` | The user's time budget is used up | Finish the current fix, judge once more, report |

When the user said not to ask questions, `done` and `stalled` end with a
one-line report, not a question.

Never degrade visual fidelity to hit a budget. It is better to run out of time
with meaningful, beautiful progress than to finish something rough.

## What makes a judge useful

- Give it nothing but the brief file. Your notes, your excuses and your plan
  bias it; a fresh context is the point. The brief does include the previous
  verdict — deliberately: the judge keeps a persisting gap's `id`, and the
  exit rules read that repetition. Consistency across rounds is what makes
  the trend a trend; it is not a leak of your opinion.
- The judge scores the WebGL frame against the target. Controls, HUD text and
  behaviour are not in the picture and are not what the score measures; test
  those inside the page and read the result from `notes`.
- Ask for the JSON only. The brief already says so; if the subagent returns
  prose around the JSON, extract the object and ingest that.
- Regression is information. A lower score after a change is the verdict, not
  a judge error; look at what the change broke before reverting it.
- A re-dream restarts the trajectory. Rounds keep the `targetVersion` they
  were judged against; the exit rules and the judge's "previous verdict" only
  see the current version, so the first round after a new target is judged
  fresh and `status` is `continue` with an empty trend, whatever the loop had
  reached before.
