# Lucid — zero-leak blind trial findings (2026-09-16)

> Procedure (same bar as the bansho trial): a fresh, empty workspace
> (`~/lucid-blind`, only the installed skill and `AGENTS.md`, no seed, no
> examples), codex backend with GPT-6 Astra, the upstream dream-loop README
> prompt with a 45-minute limit and a request for a `REPORT.md` written "as if
> seeing the tool for the first time". Not one internal term was given. The
> session URL was opened in the user's own Chrome (the chrome-devtools MCP
> profile was held by another Chrome instance; it was left alone), and the
> brief was delivered over the bridge WebSocket. Full report:
> `~/lucid-blind/REPORT.md`; project: `~/lucid-blind/ember-abbey/`.

## 0. Outcome first

The loop ran end to end without help: the agent read SKILL.md and all five
references, ran `blender.mjs doctor`, dreamed a target with its own image
tool, `init`-ed a project, locked the target, built a Three.js scene on the
starter, captured through the bridge (`method: viewer-captureViewport`,
non-black WebGL frames at 2182×1476), spawned a fresh subagent as the judge
(`/root/judge_01`, parent = the session thread), ingested the verdict, and
went around again. Three judged rounds inside the 42-minute budget it set
itself: **3.35 → 4.0 → 4.25**. After round 2 the script reported
`stall-approaching` (repeated gap ids, less than a full point gained); the
agent read it, rebuilt the background as a dense layered city and recorded
round 3 as `--kind rethink` — the exit rules drove behaviour, not just
reporting. The final frame (`rounds/03/capture.png`) is a coherent isometric
voxel abbey with a storm sky, an ornate glowing door, wet-stone reflections,
rubble, candles, circling birds and a caped knight, at ~120 fps. No tool call
in the loop's own path failed.

The agent's report is unusually good: fifteen precise confusions and ten
concrete change requests, most of them right. They are folded into the skill,
the scripts and the viewer in the same change set as this note.

## 1. What the trial proved

- **The rhythm transfers.** init → read state → capture → judge → status was
  followed in order by a cold-start agent; `lucid.mjs` was used for every write
  it owns (init, target, round add, judge-prompt, verdict, asset add); nothing
  was hand-edited.
- **The senses work.** `get-scene-state` (fps, draw calls, triangles, errors)
  was read after every reload; the agent found a real composition bug ("a
  distant tower had walked into the foreground and covered the character")
  from the capture, not from the source.
- **The judge is real and strict.** 18 actionable gaps in round 1, each with
  area, stable id, symptom and fix; round 2 reused ids and scored the
  improvement honestly (4.0).
- **The new adapter cards work.** `ImageGeneration` / `ImageView` rendered as
  tool cards with the saved path; the agent used the path for `target --set`.

## 2. Defects found, and where they were fixed

| Finding (from the report or the transcript) | Fix | Where |
|---|---|---|
| Target dreamed at 16:9 before the stage aspect was known (stage was 1091×738) | `get-scene-state` always returns `stage { width, height, aspect }`, even with no scene; workflow reordered: init → read stage → dream | viewer, SKILL.md, target-image.md |
| Image model upgraded "voxel-ish real-time" into a painterly perspective render; the judge then punished the requested style | target-image.md tells the agent to name the rendering style and to re-dream once if the result drifts from the brief | target-image.md |
| Budget clock started at the first target lock, silently excluding the dream from the user's 45 minutes | `init --budget-minutes` starts the clock at init; `budget --minutes` starts it when unset | lucid.mjs |
| Judge brief hand-copied into the subagent prompt; a JSON key was duplicated once | `judge-prompt` writes `rounds/NN/judge-brief.md` and prints its path first; the judge writes `rounds/NN/verdict.json`; `verdict` defaults to that path | lucid.mjs, judging.md |
| `capture` right after a reload returned a frame while `registered: false` | `captureViewport` waits up to 4 s for ready; `lastCapture { ready, registered, waitedMs }` is reported | viewer |
| Bridge fps measured rAF cadence, not rendered frames | bridge wraps `renderer.render`; `fps` is render-based once registered, `fpsSource` says which | lucid-bridge.js |
| No supported way to test controls; the agent smuggled an integration result through the error channel | `window.lucid.note(name, data)` → `get-scene-state.notes`; skill says to test inside the page and never to hunt for a browser or host process | lucid-bridge.js, viewer, SKILL.md, three-scene.md |
| "Do not download assets" read as excluding image-to-3D; all four assets went procedural although a fal key was present | Core rule: image-to-3D is not a download; vendored three.js is a library; voxel / low-poly briefs make procedural the faithful rung | SKILL.md, assets.md |
| "Build on the starter, do not replace it" was over-read | Anchors named explicitly; camera, content and controls are the agent's | SKILL.md |
| Exit table says "ask whether they want more" although the user forbade questions | Rule: when the user said not to ask, report in one line and stop | SKILL.md, judging.md |
| Agent once echoed the image tool's multi-megabyte result into a command | Rule: use only the saved path the tool reports | SKILL.md |
| The judge subagent's text and `turn/completed` appeared as the MAIN agent's own message and ended the turn in the UI | Codex adapter is thread-unaware — filed as pandazki/pneuma-skills#152; a draft implementation is kept as a patch for the maintainer | backends/codex (separate issue) |
| `vendor-three` copied five files; three ≥ 0.167 needs `three.core.js` too (blank page otherwise) | six files vendored; found by the viewer agent's browser pass before the trial | lucid.mjs |

Not changed, on purpose:

- The judge receives the previous verdict. The report calls this "not truly
  blind"; it is deliberate — id reuse is how repeated gaps are detected and
  what keeps the trend comparable. judging.md now says why.
- `capture` is the WebGL frame, not the DOM. That is the judge's contract
  (the target is an in-engine screenshot); HUD verification belongs to
  in-page checks. A page-level capture would be a desktop-app feature.
- The "identical pixels" rubric stays. It is the upstream rubric, it produced
  the useful gap lists, and softening it is a taste decision for later
  trials, not this one.

## 3. Trial hygiene — one contamination, recorded

During round 3 the viewer was being edited (wave-3 fixes) in the same
checkout whose Vite dev server served the trial page. HMR re-mounted the
viewer, the scene iframe reloaded, the bridge briefly reported
`registered: false`, and the server log shows a burst of browser
connect/disconnect events; the agent noticed ("the preview connection dropped
for a moment"), waited, and re-measured. Rounds 1–2 were not affected. Rule
for the next trial: serve a built frontend (`bun run build`, production mode)
or run the trial from a separate worktree; backend and script edits in the
repo are harmless, `src/**` and `modes/*/viewer/**` edits are not.

## 4. Independent review (Codex, read-only)

A Codex review of the diff after the trial fixes could not run a browser (its
sandbox refused `/tmp`), so it read code and ran the scripts. Seven findings,
all confirmed and amended in the same change set:

| Severity | Finding | Amendment |
|---|---|---|
| P1 | A re-dream (`target --set` over a locked target) kept every verdict scored against the old target, so a `done` loop stayed `done` against a new dream | rounds carry `targetVersion`; the exit rules and the judge's "previous verdict" consider only the current target's rounds; the rail dims older versions |
| P1 | The bridge counted every `renderer.render` call as a frame, so a reflection pass doubled fps and a 30 fps scene could pass the 54 fps `done` bar | at most one frame per animation frame; extra passes reported as `passesPerFrame` |
| P2 | A capture with no address returned the selected round or the target, and `lastCapture` said nothing about it | `lastCapture.source` (`live` / `round` / `target`); the skill navigates to live before a judged capture |
| P2 | The Live button kept a selected round on stage while `navigate-to { view: "live" }` cleared it | the button clears the round too |
| P2 | `navigate-to { round: 999 }` without `contentSet` reported success | validated against the resolved project |
| P2 | Budget exhaustion was not reported before the first judged round | the clock is checked whenever a budget has started |
| P3 | judging.md said unmeasured fps → `optimize-fps`; the script says `continue` with a reason | table aligned with the script |

## 5. Second trial (2026-09-17, production build, 90-minute budget, stopped by an external cause)

Same zero-leak procedure, served from `bun run build` so no HMR could touch
the page; a non-voxel brief (a ruined shrine courtyard at dusk,
stylized-realistic) with "don't download assets from the internet" kept, to
test whether the rewritten ladder is walked. It was, unaided:

| Rung | Used | Evidence (`~/lucid-blind-2/dusk-shrine/`) |
|---|---|---|
| image-to-3D | 5 script calls, 4 jobs downloaded | `assets/fal-jobs.json`: `saint`, `traveler`, `portal`, `fern` via the `hero` recipe (`auto_size`, `align_image`, detailed) with a per-asset `face_limit` |
| Blender kit | `run` ×1, `prep` ×6, `render-views` ×2 | `assets/masonry.py` (~300 lines, `import kit`: voussoir arches, fluted columns, bevels) → `arch/column/lantern/pedestal/slab.glb`; every generated model went through `prep --height … --merge` |
| textures | `texture.mjs` normal + roughness from the generated stone albedo | `scene/textures/stone-normal.png`, `stone-rough.png` |
| starter loader | `assets.js` copied by `init` and used | `scene/world.js`, `traveler.js` |
| ledger | four entries with rungs and states | `lucid.json` `assets[]` |

Round 1 at 35 minutes scored **4.85** (trial 1 at the same point: 3.35) with
a real hooded statue, kit-built columns and arches, lit lanterns, banners and
a normal-mapped wet floor; the judge brief travelled as a file and the
verdict was ingested by its default path. Round 2 was under way — a finer
shrine portal and ferns generated and prepped — when the Codex workspace
ran out of credits (`Your workspace is out of credits`) and the turn ended
with `error_during_execution` at ~00:30; no REPORT.md was written. The
session is resumable from the workspace once credits are refilled.

Findings from the transcript (no tool call failed):

- The bridge's `errors[]` does not see shader compile failures — three.js
  reports them through `console.error`, not `window.onerror`; the agent
  noticed a silent black material, added its own diagnostic and fixed the
  shader. Fix: hook `console.error` and `renderer.debug.onShaderError` into
  `errors[]`.
- The agent still reached for a temporary in-page check module and then
  removed it, as the skill says; `notes` carried the result.
- The judge subagent's `fileChange` (writing `verdict.json`) and its final
  text rendered in the main conversation — issue #152 again, cosmetic here.

## 6. Open after both trials

- `done` and `stalled` have not been observed live (trial 1 ended at
  `stall-approaching` after one rethink round; trial 2 was cut off by
  credits after round 1). Both are covered by tests.
- Trial 2 proved the image-to-3D and Blender rungs are used unaided; whether
  the score reaches a passing level with them needs the trial to run to its
  budget.
- The report's suggestion of a page-level capture (`capture-interface`) and a
  supported input-dispatch channel is recorded, not built.
