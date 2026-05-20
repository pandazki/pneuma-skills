# Design: `ViewerAddress` — a unified object-addressing contract

> **Status:** Landed in core, webcraft migrated & verified, fan-out in progress.
> The contract lives in `core/types/viewer-contract.ts` (`ViewerAddress`,
> `ViewerLocator.address`, `ViewerSelectionContext.address`). **webcraft** is
> migrated and verified end-to-end — full / region / cross-page `capture`, and
> the select → address → capture round-trip. Remaining content modes follow
> the [per-mode checklist](#per-mode-migration-checklist) below.
>
> **Audience:** Pneuma maintainers and mode-viewer authors.

## Problem

"Which object in the viewer?" is a question the agent and the viewer ask each
other constantly — but before this contract it was answered with five
unrelated shapes:

| Site | Direction | Granularity |
|---|---|---|
| `ViewerLocator.data` | Agent → Viewer — point the user at it | coarse (page / slide / set) |
| `navigate-to` action `params` (`{file}`) | Agent → Viewer — move the viewer there | coarse |
| `capture` action `params.selector` (3.10.13) | Agent → Viewer — render it for the agent | fine (DOM element) |
| `ViewerSelectionContext.selector` / `.file` | Viewer → Agent — report what the user picked | fine |
| `<viewer-context>` current `file` / selection | Viewer → Agent — report the current position | — |

Every site names the same kind of thing — *a referent in the viewer* — yet
each invented its own payload shape. The cost lands on the agent: it must learn
a different addressing vocabulary per feature, and the shapes do not
interoperate. The user selects an element and the viewer hands back a
`selector`; the agent wants to capture it or point the user back to it, but
`capture` and `ViewerLocator` expect different shapes. The select → view →
point round-trip — the most natural agent QA loop — was not expressible.

## Goal — protocol up, implementation down

Promote object-addressing to a first-class protocol noun: **`ViewerAddress`**.

The contract fixes the **slot** — there is one address type, and every verb
(point, view, navigate, report) consumes or produces it. Each mode's viewer
fills the **content** — its own addressing vocabulary, sculpted to whatever
granularity its domain needs. A thin, universal waist; wide, mode-specific
implementations.

- **slide** only ever needs to name a slide — page-level addressing is enough.
- **webcraft** / **kami** go finer — a page plus an anchor, a DOM region, a selector.
- **doc** thinks in headings and line ranges; **diagram** in node ids; **draw**
  in canvas-element ids.

None of these constrain each other. The agent's comprehension cost stays low
because the *interaction pattern* is invariant ("get an address, then
point / view / navigate it") even as the *address content* varies per mode —
and cross-mode capability is uniform: the same verbs work everywhere.

This mirrors the existing `fileRef` precedent (`BackendModule.toolFileRef`): a
cross-cutting, runtime-normalized reference type that lets the UI render
previews and open-actions without knowing any tool's internals.
`ViewerAddress` is the `fileRef` of "objects inside the viewer."

## The contract

### The noun

```ts
/**
 * ViewerAddress — a mode-defined, serializable referent for an object inside
 * the viewer. Opaque to the framework: only the owning mode's viewer resolves
 * it. The protocol fixes that this slot EXISTS and which verbs consume/produce
 * it; the mode owns the keys and the granularity.
 */
export type ViewerAddress = Record<string, unknown>;
```

Opaque, exactly as `ViewerLocator.data` was opaque before — this is a *naming
and consolidation* of a concept the codebase already had five times over, not a
new abstraction. A loose, **non-enforced** convention helps the agent
generalize: an address pairs a coarse "where" (page / slide / file / set) with
an optional fine "within" (anchor / selector / nodeId / lineRange). Modes that
need only the coarse half simply omit the rest.

### The verbs

One noun, shared by every verb on both sides of the protocol:

**Produced by the Viewer (⑥ Viewer → Agent):**
- A selection reports `{ address, ...descriptors }` — `address` is the machine
  handle; `selector` / `tag` / `label` / `nearbyText` / `accessibility` /
  `thumbnail` stay as human- and agent-readable *context*.
- `<viewer-context>` carries the current selection's `address` on an explicit
  `Address:` line the agent can copy verbatim.

**Consumed by the Viewer (⑤ Agent → Viewer):**
- `ViewerLocator` = `{ label, address }` — point the *user* at it (a card).
- `capture(address)` — render it for the *agent* (a screenshot).
- `navigate(address)` — move the viewer there (`navigateRequest`).

Because the same `address` is both produced and consumed, the round-trip
works: the user selects an object → the agent receives its `address` → the
agent `capture`s that exact address, or emits a `ViewerLocator` pointing back
to it. This is verified in webcraft.

### Resolution stays in the mode

The framework never interprets the *mode-defined* keys of a `ViewerAddress` —
it routes them to the mode viewer, the only party that knows what `{slide: 3}`
or `{page: "about.html", anchor: "#pricing"}` means. The existing
`navigateRequest` channel already does exactly this (every mode viewer handles
it). `capture` of a non-active object therefore composes from parts that
already exist — see [navigate-then-shoot](#navigate-then-shoot).

The one exception is **`contentSet`**: a framework-level coordinate the store's
`setNavigateRequest` resolves itself (switching the active content set) before
handing the rest of the address to the mode viewer. Treat `contentSet` as a
reserved, shared key; every other key is mode-opaque.

## Granularity belongs to the mode

Address vocabularies — webcraft is the verified-real reference; the rest are
**proposals for each mode's author to decide**, not a contract mandate:

| Mode | Example `ViewerAddress` | Finest granularity the mode chooses |
|---|---|---|
| webcraft ✅ | `{ contentSet?, page, anchor?: "#hero" }` / `{ …, selector: "section.pricing" }` | an anchor / DOM region |
| slide | `{ contentSet?, slide: 3 }` or `{ contentSet?, file: "slides/slide-03.html" }` | a slide |
| kami | `{ contentSet?, page?, selector? }` | a DOM region on the sheet |
| doc | `{ file, heading?: "Setup", lineRange?: [40, 72] }` | a heading / line range |
| diagram | `{ nodeId? }` (omit → the whole diagram) | a node |
| draw | `{ elementId? }` (omit → the whole canvas) | a canvas element |
| illustrate | `{ image: "assets/hero.png" }` | an image |

A viewer author sculpts this against their domain: slide deliberately stops at
the slide because nothing finer is meaningful for its fixed-canvas QA loop;
webcraft goes as deep as the DOM because section-level review is its bread and
butter. A mode's `navigate` verb and its `capture` verb may even honor
*different depths* of the same vocabulary — webcraft locators navigate to a
page, while `capture` resolves all the way to a selector. That is fine: the
vocabulary is one; how deep each verb reads it is the mode's call.

## Contract surface — what landed

- **`core/types/viewer-contract.ts`**
  - new `ViewerAddress = Record<string, unknown>`.
  - `ViewerLocator.data` → `ViewerLocator.address` — a clean rename, no alias
    (every consumer was migrated in one pass).
  - `ViewerSelectionContext` gains `address?: ViewerAddress`. The existing
    descriptor fields (`selector`, `file`, `tag`, `label`, `nearbyText`,
    `accessibility`, `thumbnail`, `viewport`) stay **as-is** — they are not
    aliases of `address`, they coexist with it. `address` is the canonical
    machine handle for routing; the rest remain human/agent-readable context.
  - `ViewerActionParam.type` gains `"object"` — so a mode can declare an action
    param that takes a structured value (a `ViewerAddress`) as JSON.
- **`src/types.ts`** — the frontend `SelectionContext` mirror gains the
  matching `address?: ViewerAddress`.
- **Selection round-trip plumbing** — `address` is a new field, so every
  hand-copy of a selection had to be taught to carry it: `src/App.tsx`
  `onSelect` and `src/ws.ts`'s `viewerSelection` builder. Field-by-field copies
  silently drop unknown keys — this is the easiest step to miss.
- **`<viewer-locator>` wire tag** — the canonical attribute is now
  `address='{…json…}'`. `src/components/MessageBubble.tsx`'s parser accepts
  both `address=` and `data=`, so locator cards in resumed sessions (history
  written before the contract) still render. New agent output uses `address=`.
- **`capture` action** — `params` is now `{ address?: ViewerAddress }`. The
  3.10.13 `params.selector` is reframed as one key inside a mode's address
  vocabulary. `useCaptureAction` parses `params.address` and stays lenient (a
  bare `selector` string still works) — agent-provided params are a system
  boundary.
- **`navigate` via the existing channel** — `navigateRequest` is a
  `ViewerLocator`, so the `data`→`address` rename made navigation
  address-driven for free. `src/store/viewer-slice.ts`'s `setNavigateRequest`
  resolves the one framework key (`contentSet`) and hands the rest through.
- **CLAUDE.md router** — `server/skill-installer.ts::generateViewerApiSection`
  stays a *pure router*: it names the channels and points the agent at the
  mode's SKILL.md for concrete shapes. There is **no** `viewerApi`
  manifest field for the address vocabulary (an earlier sketch proposed
  `locatorDescription` — it was not added). The address vocabulary is
  documented in each mode's **SKILL.md**, the single canonical source, exactly
  as locator / action / scaffold schemas already are.

### navigate-then-shoot

Capturing an address that names a *non-active* object composes from parts that
already exist. `useCaptureAction`:

1. parses `params.address`;
2. if the address carries a **coarse** key (`page` / `file` / `slide` /
   `contentSet` / `nodeId` / `elementId` / `image`), dispatches it through
   `setNavigateRequest` — driving the same `navigateRequest` channel every mode
   viewer already handles — and waits a settle delay;
3. runs the generic screenshot, resolving the **fine** part (`selector` /
   `anchor`) in place.

No new per-mode capture plumbing. The settle is currently a fixed ~1.1s delay
(covers a srcdoc swap + React re-render); see [Open questions](#open-questions).

## Per-mode migration checklist

Each content-mode migration is mechanical. For mode `<m>` (`modes/<m>/`):

1. **`viewer/<M>Preview.tsx` — navigation.** The `navigateRequest` effect reads
   `navigateRequest.data` → rename to `navigateRequest.address`. The keys it
   destructures are this mode's coarse address keys; keep them. (A bare rename
   — the contract removed `.data`, so a missed one is a compile error.)
2. **`viewer/<M>Preview.tsx` — selection.** Wherever the viewer calls
   `onSelect({...})`, add an `address` field: a `ViewerAddress` built from
   whatever the viewer knows — the active page/slide/file, plus any fine handle
   (a selector, a node id). Omit fine keys when there is no element-level
   selection.
3. **`pneuma-mode.ts` — `extractContext`.** When there is a real selection,
   emit a machine-readable `Address: <JSON.stringify(selection.address)>` line
   inside `<viewer-context>`, so the agent can copy the address straight back
   into `capture` or a `<viewer-locator>`.
4. **`skill/SKILL.md` — viewer-protocol section.**
   - Add (or fold into the existing locator section) a short **ViewerAddress**
     table: this mode's address keys, each tagged *coarse* or *fine*, one-line
     meanings.
   - Rename every `<viewer-locator label="..." data='{...}'/>` example to
     `address='{...}'`.
   - Update the `capture` docs: `params.selector` → `params.address` (a
     ViewerAddress). Show a full-viewer call (no address) and a region call.
5. **Coarse-key naming.** The framework's capture path treats `page` / `file` /
   `slide` / `contentSet` / `nodeId` / `elementId` / `image` as *coarse* keys
   that trigger navigate-then-shoot; `selector` / `anchor` are *fine* (resolved
   in place). Name your address keys to match — e.g. `slide` not `index`,
   `nodeId` not `id` — so `capture` routes correctly without per-mode code.

A mode whose viewer never reports element-level selections (a single-canvas
mode) still does steps 1, 4, 5; steps 2–3 reduce to a coarse address
(`{ file }` / `{ slide }`).

## Migration & staging

1. ✅ 3.10.13 shipped `capture` with a `selector` param — the forward-compatible seed.
2. ✅ Contract types landed in `core/types/viewer-contract.ts` + frontend plumbing.
3. ✅ webcraft migrated end-to-end and verified (full / region / cross-page
   `capture`; select → address → `capture` round-trip; navigate-then-shoot).
4. ◻ Remaining content modes — slide, kami, doc, draw, diagram, illustrate,
   remotion, gridboard, clipcraft, mode-maker — follow the per-mode checklist.
5. ◻ `docs/reference/viewer-agent-protocol.md` upgraded to describe
   `ViewerAddress` as the addressing noun the verbs share.

## Open questions

- **Address stability.** A webcraft `selector` can break when the DOM is
  edited; a slide index is stable. Selection-produced addresses should be "as
  durable as the mode can reasonably make them" — a per-mode quality concern,
  worth a line in each mode's address-vocabulary docs.
- **navigate-then-shoot timing.** `useCaptureAction` waits a fixed ~1.1s after
  dispatching the navigate. Robust enough for srcdoc / React reloads, but a
  future increment could await an explicit navigation-complete signal — the
  viewer already calls `onNavigateComplete`; the framework could resolve a
  promise on it instead of sleeping.
- **Subsume `navigate-to`?** The slide `navigate-to` action overlaps
  `navigate(address)`; the slide migration should decide whether to fold it in
  or keep it as a thin alias.
