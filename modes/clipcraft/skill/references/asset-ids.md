# Asset + Clip IDs

Short reference for naming, uniqueness, and stability of every
identifier in `project.json`. Full schema in `project-json.md`.

## Naming conventions

Prefer **semantic** names over random UUIDs. The craft store
preserves whatever id you write, and semantic ids are readable in
diffs and make provenance edges legible.

| Good | Bad |
|---|---|
| `asset-panda-intro` | `asset-a8f2e5` |
| `clip-video-intro` | `clip-1712934-xyz` |
| `track-audio-narration` | `track-3` |
| `scene-bamboo-reveal` | `scene-b` |

Prefix ids by role (`asset-`, `clip-`, `track-`, `scene-`). Nothing
enforces this, but it keeps the four id spaces visually separated.

## Uniqueness rules

Enforced by the craft store at hydration time:

- **Asset ids** — globally unique in the registry. Duplicates throw
  `Asset already registered`.
- **Clip ids** — globally unique across **all tracks** in the
  composition (not per-track). Duplicates throw `Clip already
  exists`. Track-prefix clip names if two tracks could collide, e.g.
  `clip-video-intro` / `clip-caption-intro`.
- **Track ids** — globally unique. Duplicates throw `Track already
  exists`.
- **Scene ids** — convention only (the store has no scene model),
  but don't reuse them — the viewer's React tree keys off the id.

## Stability

- The craft store preserves whatever ids you write to disk. Edits
  that touch unrelated fields never rename ids.
- To rename an id, **delete the entry and add it back** with the new
  id. Don't try to rewrite the id in place on a single Edit call —
  any clip or provenance edge referencing the old id will then
  dangle.
- `createdAt` is also stable; don't bump it when editing other asset fields.

## Variants

Two conventions work equally well as long as every sibling is linked
via a provenance edge:

1. **Numeric suffix** — `asset-panda-intro-v1`, `asset-panda-intro-v2`.
   Mirrors the seed project's `asset-panda-sad-v1` / `-v2` pair.
   Good for "try another take with the same intent".
2. **Semantic suffix** — `asset-forest`, `asset-forest-sunset`,
   `asset-forest-nighttime`. Good for "same subject, different
   conditions".

What actually makes them siblings is the provenance edge:
`fromAssetId` on the new asset points at the parent, and
`operation.type` is `"derive"`. The variant switcher walks the
provenance DAG — not the id string — so the suffix is purely for
human readability.

## Do / Don't

**Do:**
- Use stable semantic ids (`asset-panda-intro`, `clip-narration-1`).
- Prefix ids by role (`asset-`, `clip-`, `track-`, `scene-`).
- Track-prefix clip ids when collisions are possible.
- Link variants via `provenance[]`, not by naming alone.
- Preserve `createdAt` when editing an existing asset.

**Don't:**
- Generate random UUIDs for assets, clips, or tracks.
- Rename an id in place — delete and re-add instead.
- Reuse a track id for a different track, or a clip id on a
  different track.
- Put variant relationships into the id alone without a matching
  `derive` provenance edge.
