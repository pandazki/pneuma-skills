# plotwise: the play loop as an asynchronous pipeline (skill 0.4)

Status: accepted 2026-09-02 (user decision); implemented as plotwise skill 0.4.0 the same day (`play-manager.mjs`, `write-screenplay.mjs`, `screenplay-lib.mjs`, `async-job-queue.mjs`, `modes/_shared/scripts/fal-queue.mjs`; viewer: `Interlude.tsx`, choice file, heartbeat).

## Why

Three findings from the first live courses (v5–v7, 2026-09-02):

1. **A segment was one sentence.** One beat → one 10–12 s clip → ~40
   Chinese characters. Eight beats made a thread of tweets, not a course.
   A knowledge point needs 30–60 s of continuous explanation; H3's 15 s is
   the ceiling of a *shot*, not of a *segment*.
2. **Choices were filler.** Every clip ended in "advance vs refine", and
   the refine card restated the clip. Choosing every 12 s with nothing to
   gain destroyed the sense of a through-line.
3. **Production followed the click.** The next pair started when the
   learner chose; 76–200 s per pair against 12 s clips. No lookahead of
   one step can hide that.

The user's sister project (`~/Tmp/galgame-demo`, "Oh My Crash!") solves
the third problem for a galgame: a cheap plot tree planned 4–5 levels
deep, an expensive video tree rendered 1–3 levels deep, one resource
manager with two queues and fixed H3 slots, priority by distance from
the player, pruning on choice, remote cancellation, and a ready gate so
a click never waits on a model. plotwise adopts that machinery and keeps
two things of its own: **a spine** (the outline) and **scenes** (a
segment is as long as its content needs).

## Vocabulary

- **Beat** — one entry of the master outline (`course.json.outline`),
  the spine. Unchanged.
- **Scene** — one node of the course tree; a teaching unit of 1–6
  **shots**; 20–90 s. `kind: "main"` scenes follow the spine one beat
  each; `kind: "branch"` scenes are detours off a main scene (an example,
  a closer look, a check) that return to the spine; `kind: "question"`
  scenes answer a learner's free-text question.
- **Shot** — one H3 clip, 5–15 s, with its own narration, visual prompt,
  and (rarely) a figure reference. Shots of a scene are chained: shot k+1
  is image-to-video from shot k's last frame. A scene's first shot starts
  from the style anchor (a cut at every scene boundary — the natural place
  for one — so scenes render in parallel).
- **Figure** — a code-rendered knowledge visual. Rides as a reference
  (reference-to-video, Image 2+) only in the shot whose script shows it.
  Never a first or last frame. Most shots show none.

## course.json (the viewer's contract; additions in bold)

```jsonc
{
  "outline": [ { "id": "b1", "title", "summary", "tier", "figureSpecs", "evidence": [...] } ],
  "rootNode": "n1",
  "path": ["n1", "n2"],                       // written by the manager on choice
  "nodes": {
    "n2": {
      "beat": "b2", "kind": "main", "parent": "n1", "choiceLabel": "先验：把瞎猜变成数字",
      "status": "planned|scripting|queued|generating|ready|failed|cancelled",
      "phase": "script|shoot|qa", "shotIndex": 2, "shotCount": 3, "startedAt": "...", "error": "...",
      "brief": "one paragraph: what this scene teaches and how it opens/closes",   // detours before scripting
      "shots": [
        { "id": "s1", "script": "...", "visual": "...", "duration": 12,
          "figures": ["evidence/b2/prior.png"], "status": "ready", "video": { "file": "nodes/n2/s1.mp4", "duration": 12.3 },
          "qa": { "similarity": 0.97, "coverage": 1, "verdict": "pass", "judge": "auto" } }
      ],
      "video": { "file": "nodes/n2/video.mp4", "duration": 41.2 },   // the concatenated scene
      "children": [ { "nodeId": "n3", "label": "继续：线索藏在颜色里" }, { "nodeId": "n2x", "label": "举个例子：抛硬币" } ]
    }
  },
  "play": {                                   // manager snapshot, read-only for everyone else
    "state": "warming|playing|complete|failed", "currentNode": "n2",
    "slots": 3, "videoAhead": 2, "planAhead": 2,
    "queued": ["n2x", "n4"], "active": ["n3"], "pruned": 4,
    "updatedAt": "..."
  }
}
```

The per-scene caption shown under the stage is the concatenation of the
shots' scripts. `nodes/<id>/script.md` stays for the evidence panel.

## Files the manager listens to

- `<set>/state/choice.json` — written by the viewer:
  `{ "at": "...", "choose": "<nodeId>" }` or `{ "at": "...", "retry": "<nodeId>" }`.
  The viewer writes it with `fileChannel.write`; nothing else touches it.
- `<set>/state/requests/<id>.json` — written by the director (agent) for a
  learner's question: `{ "parent": "<nodeId>", "label": "...", "brief": "..." }`.
  The manager turns it into a `question` scene under `parent` with top
  priority.
- `<set>/state/manager.pid`, `<set>/state/manager.log` — liveness and log.

## Modules

- `modes/_shared/scripts/fal-queue.mjs` — `runFalJob({ url, body, key, signal, deadlineMs, label })`
  → `{ data, apiMs, inferenceSeconds }`. Submits to `queue.fal.run`, polls
  `status_url`, fetches `response_url`, PUTs `cancel_url` when `signal`
  aborts; retries a transient submit failure (5xx/429/network) three
  times with back-off; a 4xx is reported at once. `generate-video.mjs`
  uses it (behaviour unchanged for callers; SIGTERM cancels remotely).
- `modes/plotwise/skill/scripts/async-job-queue.mjs` — the galgame's
  `AsyncJobQueue` (priority, concurrency, cancel with AbortSignal),
  ported as ESM JavaScript.
- `modes/plotwise/skill/scripts/screenplay-lib.mjs` +
  `write-screenplay.mjs` — Luna writes the whole main line in one
  structured call (scenes → shots + one detour brief per scene), with
  the outline, the evidence index and the style as input; validated
  (speech budget per shot, figure paths exist, durations 5–15) and
  landed into course.json (`main` scenes planned with `shots[]`,
  `branch` stubs with `brief`, children linked, `rootNode`). Fallback
  when the single call fails: scene by scene, sequentially, each with the
  previous scene's script as context.
- `modes/plotwise/skill/scripts/play-manager.mjs` — the manager. One
  long-running process per course. Owns every write to `nodes[*]`,
  `path`, and `play` during play (under the course lock). Two queues:
  planning (Luna: detour and question scripts, concurrency 3) and video
  (H3: shots, `--slots` 2–3). Scheduling: the current scene's children
  first (distance 0), then grandchildren; main-line scenes up to
  `--video-ahead` beats past the current beat; detours of the current
  scene; questions at top priority. A scene renders its shots serially;
  each shot: endpoint by what the shot shows → `runFalJob` → download →
  loudness (faststart) → transcribe (CDN url, warmed) → compare/judge →
  one reshoot on fail → last frame → next shot. After the last shot:
  ffmpeg concat (stream copy; re-encode fallback) → `video` → `ready`.
  On choice: append to `path`, set `currentNode`, cancel and mark
  `cancelled` every node in the unchosen subtrees (queued and active
  jobs aborted → remote cancel), then reconcile. On retry: reset the
  node to `planned`, reconcile. Exit: `complete` when the last main
  scene was watched, or SIGTERM.
- `modes/plotwise/viewer/*` — the stage plays `node.video` (one file per
  scene); choices are the node's children with production state; a click
  writes `state/choice.json`; 再拍一次 writes `retry`; `segmentWatched`
  and `produceSegment` notifications are gone; `userQuestion` stays
  (the director writes a request file). Waiting labels read
  `phase` + `shotIndex/shotCount` ("拍摄中 2/3").

## The director's role after initialisation

topic → style board → `plan-course` (outline lands first, grounding
streams) → `write-screenplay.mjs` → `play-manager.mjs` (detached,
pid in `state/`). Then nothing, until `userQuestion` (write a request
file) or the manager dies (the viewer shows it; the learner or the
director restarts it). No per-click work, no navigation, no auditing.

## Numbers to hold

- cold start: screenplay ≤ 60 s; opening scene (3 shots) ≈ 2–3 min;
  scenes 2–3 render in parallel meanwhile.
- steady state: a 45 s scene consumed per ~60 s; three slots produce a
  shot per ~15–20 s → ahead as long as `slots × 15s ≤ 60s / shots-per-scene`.
- ready gate: "继续" is never shown before the next main scene's file
  exists; a detour card shows its production state and may be waited on.
