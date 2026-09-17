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

### Resumed after the refill (2026-09-17 10:45, same workspace, rebased build)

The branch was rebased onto `main` (which now carries the #152 fix), `dist`
rebuilt, and the server restarted on the same workspace: the Codex thread
resumed with its 216 messages and one user line ("额度已经恢复了，继续。")
continued the loop. Two things surfaced in the first minute:

- **The budget is wall clock, and a pause is not.** `status` reported
  `budget-exhausted` with "652 minutes elapsed" for a 90-minute budget — the
  ten-hour credit outage had been counted. The agent read the situation
  correctly, said so to the user, and kept its 55 remaining minutes by
  setting `budget --minutes 708`, which is honest arithmetic but a hack the
  script invited. Fix: `budget --pause-credit <minutes>` accumulates
  `budget.pausedMinutes`; `status` prints `budget.sinceLastWriteMinutes`
  (the manifest's last mutation — `status` never writes) so the pause is
  read, not remembered; `budget-exhausted` advice, `judging.md` and SKILL.md
  say to credit a pause before acting on the exit.
- The resumed turn logged five `Reconnecting… n/5 … Broken pipe` lines from
  the Codex model stream plus one `write_stdin failed: Unknown process id`
  (a background process of the previous app-server). The turn survived both;
  the work continued without a tool error.

Round 2 (judged at ~11:30, from the windowless Chrome, 59.6 fps) scored
**5.75** — and `status` answered `stall-approaching`, not because of the
score (a 0.9-point gain) but because the judge had carried seventeen gap
ids forward, and the rule fired on any id named twice running. The judge is
*told* to carry a persisting id forward, so two-in-a-row is the normal state
of every real scene one round in; the rule was converting the loop into
"rethink after every second round". Fix: the stall signal is now a gap named
in **three** verdicts running (`evaluation.stubbornGaps`, constant
`STUBBORN_VERDICTS`); `repeatedGaps` is still reported but no longer decides.
The `repeated-gap` scenario flips to `continue` and a `stubborn-gap`
scenario pins the new signal. The trial itself ran on the old rule, so its
round 3 is a `rethink` the new rule would not have asked for.

Two more from the interim REPORT.md the agent wrote at 11:15 (22 numbered
items; the actionable ones and where they went):

| Report item | Where it went |
|---|---|
| Budget has no pause semantics; SKILL and target-image.md disagree on when the clock starts | `budget --pause-credit`; target-image.md now says the clock started at init |
| Null fps in a hidden tab is indistinguishable from a broken scene | bridge reports `visibility` + `sinceLastRenderMs`, drops samples older than 2 s; SKILL/manifest say what to do |
| `align_image` did not remove the yaw check; both figures faced +X | assets.md: "not the same as facing +Z — one render-views sheet still confirms it" |
| `--yaw -90` refused as ambiguous | `argv.mjs` joins negative numbers onto their option in all five scripts |
| `--thin mesh` had no effect after `--merge` | prep names thin parts before the merge |
| Replaced `vista.png` still showed the old image after reload | assets.md + reload-scene: a same-name binary swap reloads nothing (only code files are watched); call `reload-scene` |
| A model referenced before it existed reloaded into a 404 | assets.md: reference a file once `collect` says `downloaded` |
| Reported DPR 2 while rendering at 1.5 | `viewport.renderPixelRatio` |
| No consolidated view of which asset blocks the next frame | `status.assetsPending` |
| Image-to-3D character is a static mesh; walking was vertex deformation | assets.md says so before it becomes the pipeline; Tripo rig stays out (needs its own key) |
| Orthographic brief locked against a perspective-looking dream | target-image.md: check the camera before locking; the user's words are the contract |
| Image tool returns a huge base64 payload if printed | Codex's tool, not ours — noted only |
| A "fresh" judge still received the previous scores and summary (report item 23) | the brief now carries the previous gap ids, areas and issues only; scores withheld |
| A rethink that gained 0.2 was answered with "make another rethink" (item 24) | a rethink below a full point is `stalled`; `rethink-small-gain` scenario |
| The scene kept the bridge init installed after the skill changed | `status.scene.bridgeCurrent` + a SKILL rule to `bridge --refresh` |

### Outcome of the second trial

| Round | Kind | Score | fps | Note |
|---|---|---|---|---|
| 1 | iterate | 4.85 | 120 (user's 120 Hz tab) | 35 min in |
| 2 | iterate | 5.75 | 59.6 (windowless Chrome, 60 Hz cap) | after the resume |
| 3 | rethink | 5.95 | 59.8 | camera lowered, courtyard opened, foreground banner, stone relief halo, column drums |

The agent stopped at the budget with `stall-approaching` on the old rule
(the new rules read the same history as `stalled`: the rethink gained
0.2), wrote a 19.6 KB REPORT.md (24 items) and left a working demo with
click-to-walk, drag-orbit, wheel zoom, rain, reflections and a control
self-test (`assets/control-check-result.json`). It never asked a question
after the brief, never had a tool call fail, and used every rung of the
ladder unaided.

### Trial hygiene, second incident

Restarting the server re-installs the mode skill from the source tree
(`[skill-installer] Updated …`). The 11:15 restart (moving the viewer to a
windowless Chrome on a new port) shipped the pause-credit commit into the
workspace mid-trial; the agent found `--pause-credit` "on a final reread"
and could not tell whether the text had changed. Nothing else it saw
changed (the later commits landed after that restart), and it affected only
how it normalised the budget in its last minute. Rule, added to the
blind-trial memory: a trial's server must be restarted from a pinned
worktree, never from the tree being edited.

## 5b. Extension (2026-09-17 11:55, 60 more minutes, current skill)

After the report, the user line "工具更新了一版（版本号没变）。再给你 60
分钟…" restarted the loop on the CURRENT skill (every fix above installed,
dist rebuilt, same windowless Chrome). This is not zero-leak — it is the
continuation a real user would run after an update — and its purpose is to
see how far the score goes and whether the new rules (`stalled` at a
small-gain rethink, `bridgeCurrent`, `assetsPending`, visibility) hold up
in use. Results below when it ends.

## 6. Open after both trials

- `done` and `stalled` have not been observed live (trial 1 ended at
  `stall-approaching` after one rethink round; trial 2 was cut off by
  credits after round 1). Both are covered by tests.
- Trial 2 proved the image-to-3D and Blender rungs are used unaided; whether
  the score reaches a passing level with them needs the trial to run to its
  budget.
- The report's suggestion of a page-level capture (`capture-interface`) and a
  supported input-dispatch channel is recorded, not built.
