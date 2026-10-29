# Craft project file (`pneuma-craft/project/v1`)

A mode that persists generated media (images, clips, audio) records each file
as a craft asset with provenance in one `project.json`. The format is shared
across modes and across the script/viewer language boundary:

| Concern | Authority |
|---|---|
| Types | `core/types/craft-project.ts` |
| Pure rules (validate, index, lifecycle, cost, viewer URL) | `modes/_shared/scripts/craft-project.mjs` + `.d.mts` — no `node:` imports, browser-safe |
| Disk, probing, `runRegistered`, CLI | `modes/_shared/scripts/craft-project-io.mjs` + `.d.mts` |
| Mapping and seed checks | `core/__tests__/craft-project.test.ts` |

Upstream `@pneuma-craft/core` owns the semantics (`Asset`, `AssetStatus`,
`Operation`, `ProvenanceEdge`) and defines no file format. Clipcraft hydrates
the same file into the craft store (`modes/clipcraft/persistence.ts`); the
sprite writer (`sprite-project.mjs`) has its own copy of these rules. Both are
scheduled to migrate onto the shared modules behind their fixture tests.

## Shape and key order

```json
{
  "$schema": "pneuma-craft/project/v1",
  "title": "Night Shift",
  "composition": { "settings": { "width": 1280, "height": 720, "fps": 24, "aspectRatio": "16:9" }, "tracks": [], "transitions": [] },
  "assets": [
    { "id": "ref-guang", "type": "image", "uri": "refs/guang.png", "name": "Guang sheet",
      "metadata": { "width": 1536, "height": 1024 }, "createdAt": 1800000003000, "status": "ready" }
  ],
  "provenance": [
    { "toAssetId": "ref-guang", "fromAssetId": null,
      "operation": { "type": "generate", "actor": "agent", "timestamp": 1800000002000,
        "params": { "model": "openai/gpt-image-2.5-flare", "prompt": "…", "cost": { "usd": 0.0388, "basis": "reported" },
                    "requestId": "gen-1", "finishedAt": 1800000003000 } } }
  ],
  "series": { "…": "the mode's sidecar" }
}
```

The writer emits a fixed key order, so diffs stay stable whichever command
wrote last:
- top level: `$schema, title, composition, assets, provenance`, then every
  other key in its original order;
- asset: `id, type, uri, name, metadata, createdAt, status, tags`;
- edge: `toAssetId, fromAssetId, operation`;
- operation: `type, actor, agentId?, timestamp, label?, params?`.

`uri` is relative to the directory that holds `project.json`. Timestamps are
epoch milliseconds.

## Invariants

1. Asset ids match `^[a-z0-9][a-z0-9-]{0,63}$` and are unique per file. Ids are
   semantic; modes derive them from their own slots (`ref-tangyuan`,
   `ep01-a-storyboard`, `ep01-a-clip-2`). Every edge points at registered
   assets, and each asset has at most one edge (`toAssetId` is the edge's
   on-disk identity). An asset cannot be its own parent.
2. `ready` — and an absent `status`, which upstream treats as `ready` — means
   `uri` is non-empty and an image is measured (`metadata.width` and
   `metadata.height`). Video and audio are measured on a best-effort basis
   (the writer warns by name when ffprobe cannot read them). A `text` asset
   may keep its content inline and have an empty `uri` (clipcraft's caption
   holder). `pending`, `generating` and `failed` may carry `uri: ""` or the
   planned path, with `metadata: {}`.
3. A paid call is on disk before the request leaves (`reserve`). It ends in one
   of two states: `ready`, or `failed` with `params.failure`. A failed edge
   always carries `params.failure`, and no other edge does.
4. Every top-level key that is not craft's belongs to the mode's sidecar. The
   writer never reads, reorders or validates it. It writes the sidecar back in
   its original position and key order, so the sidecar survives load → save
   byte for byte.
5. `project.json` is replaced atomically: a unique scratch file is written
   beside it and then renamed over it, and the scratch file is removed on
   every exit. A viewer never reads a torn file. Two processes saving at once
   lose an update; they do not corrupt the file.

The reader is strict. One malformed asset or edge invalidates the whole file,
and the error names it (`assets[3] ('idle-frame-00'): a ready image must be
measured …`). A viewer shows that error state.

## Operations and multi-input steps

`operation.type` is one of upstream's six values: `upload`, `import`,
`generate`, `derive`, `select`, `composite`. Any other value is a validation
error. `storyboard.mjs`'s `"slice"` is a known drift; it becomes `derive` with
`params.op: "slice"`. `actor` is `agent` or `human`. A file the user brought in
is an `upload` by `human`.

Craft edges are single-parent. A step with several inputs records its first
input as `fromAssetId` and lists every input in `params.inputs`, so
`inputs[0] === fromAssetId`. A single input has no list. This convention is an
extension in this file format, not an upstream concept. `dropAssets` cascades
the removal through both fields.

`params` keys owned by the lifecycle: `model`, `prompt`, `provider`, `inputs`,
`cost`, `failure`, `requestId`, `finishedAt`, `earlier`. Every other key, such
as `op`, `shots` or `edits`, belongs to the mode and is preserved.

## Lifecycle

```
reserve ─▶ pending ─▶ generating ─▶ ready
              │            └──────▶ failed
              └──▶ ready | failed
```

- **reserve** writes `pending` (`generating` with `--generating`), the planned
  `uri` or `""`, `metadata: {}`, and the edge with `params.{model, prompt,
  provider, inputs?, cost?}`. The record is saved before any network call. A
  `ready` id is refused without `--force`. A `pending`, `generating` or `failed`
  id is replaced in place. When the earlier edge has the same operation type,
  an absent `--model` / `--prompt` / `--provider` / `--from` keeps the value the
  earlier edge recorded.
- **Replaced calls are carried forward.** When a reservation replaces an edge
  that recorded a call, it appends the earlier attempt to `params.earlier` as
  `{ at, status: "ready" | "failed", model?, requestId?, cost?, failure? }`. An
  attempt replaced while still `pending` or `generating` has its outcome
  recorded as unknown. A possibly billed call therefore never drops out of the
  cost reading.
- **land** probes the file and sets `uri`, `metadata` and `ready`. It sets
  `createdAt` to the landing time, which gives viewers a fresh URL stamp. It
  also sets `params.requestId` and `params.finishedAt`. A cost given at land,
  typically the vendor's reported figure, replaces the reservation's estimate.
- **fail** sets `failed` and `params.failure = { reason, at, billing }`, and
  `params.requestId` when the id is known.

`runRegistered` (library) composes these steps around one call:

1. Reserve as `generating` and save.
2. Call with an `AbortSignal` that SIGINT and SIGTERM trigger. A second signal
   exits 130 at once.
3. On success, land the returned file. When the call completed but its file
   cannot be landed, the asset is recorded as failed with billing `unknown`.
4. On an error, record the failure. When an interrupt aborted the call, the
   outcome carries `exitCode` 130.

A mode's `updateSidecar(doc, phase)` callback runs inside the same atomic
write as each phase.

## Cost and uncertainty

`params.cost = { usd: number | null, basis: "estimate" | "reported" | "table", note? }`.
There is no ledger: `summarizeCosts` reads the edges. A *call* is an edge
that is a `generate`, names a `model` or `provider`, or carries a `cost`. Any
other edge is a local step and costs nothing. A call without a number is
**unpriced, never free**.

A retry that re-attaches to an earlier request (`fal-queue.mjs::runFalJob({ requestId })`
polls the job fal already accepted instead of submitting a new one) lands with the
same `requestId` as the attempt kept in `params.earlier`. `summarizeCosts` counts
that request once and lists it under `reconciled`, so a landed retry is not billed
twice in the reading.

`params.failure.billing`:
- `none` applies only when the request provably never left this machine. The
  evidence is `fal-queue.mjs::neverReached`: a refused socket or an unresolved
  name. The total excludes these calls.
- `unknown` applies to everything else: an abort, a timeout, or an upstream
  error. The total keeps these calls, and the summary lists them as uncertain.
  An abort is recorded as "the request was cancelled; whether it had already
  been billed is not knowable from here". Cancellation is compensation, not
  undo.

`fal-queue.mjs` attaches `error.requestId` to every failure after fal has
accepted the job. The writer records that id so a failed call can be
reconciled against fal's queue.

## Sidecar rule

`loadProject(path, { sidecarKey })` and `--sidecar-key` refuse a file without
that key, because the file belongs to another mode. The sidecar is the
authority for the mode's own structure: slots, selections, and pointers such
as `parts[].clip`. Selection is a sidecar pointer, not a `select` edge.
`drop` does not touch the sidecar. A mode that drops assets updates its own
pointers.

## CLI

```
craft-project-io.mjs init     --path <p> --title <t> --sidecar-key <k> [--width --height --fps --aspect] [--force]
craft-project-io.mjs validate --path <p>
craft-project-io.mjs reserve  --path <p> --id <id> --type image|video|audio|text --name <n> --op generate|derive|upload|select|composite
                              [--uri <rel>] [--from <id,…>] [--model --prompt --provider] [--params-json '<obj>']
                              [--cost-usd <n> --cost-basis estimate|table [--cost-note]] [--generating] [--actor agent|human] [--force]
craft-project-io.mjs land     --path <p> --id <id> [--file <abs|rel>] [--request-id <id>] [--cost-usd <n> --cost-basis reported|estimate|table [--cost-note]]
craft-project-io.mjs fail     --path <p> --id <id> --reason "<text>" --billing none|unknown [--request-id <id>]
craft-project-io.mjs drop     --path <p> --id <id,…>
craft-project-io.mjs show     --path <p> [--id <id>]
craft-project-io.mjs cost     --path <p>
```

Every command also accepts `--json` (stdout carries one object), `--at <ms>`
(pins the timestamp), and `--sidecar-key <k>`. A refused command prints one
`ERROR:` line, exits 1 and leaves the file untouched. `--file` defaults to the
reservation's planned `uri`. `--actor` defaults to `human` for `upload` and to
`agent` otherwise.

## Viewer side

A viewer imports the pure module by relative path. It uses `readProjectFile`
to parse the file strictly with a named error, `indexAssets` and `edgeInputs`
to look up assets and their inputs, and `summarizeCosts` for spend.
`resolveAssetUri(prefix, asset)` returns `<prefix>/<uri>?r=<createdAt>`, or
null when the asset is not ready. Hydration into the craft store, which needs
the timeline packages, stays in clipcraft. Catalog modes are built in-tree, so
the import resolves. An out-of-tree mode cannot reach `modes/_shared` because
`snapshot/mode-build.ts` redirects only `/core/` and `/src/`.

## Mapping to upstream

- `CraftAsset` = upstream `Asset` with JSON-only `metadata`.
- `CraftProvenanceEdge` = upstream `ProvenanceEdge` without `id`. Hydration
  assigns the id.
- `CraftOperationType`, `CraftAssetStatus`, `CraftAssetType` and `CraftActor`
  equal upstream's unions. `core/__tests__/craft-project.test.ts` fails to
  typecheck when either side drifts.
