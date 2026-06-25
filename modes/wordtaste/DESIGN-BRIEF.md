# Mode design brief — palate (Taste Writing Studio)

> **Status:** Design brief, ready for implementation. Authored by pneuma-architect against
> the LOCKED DECISIONS in the dispatch + the validated source experiment at
> `/Users/pandazki/Codes/palate`. Every fork below is resolved with a chosen default; no
> blocking open questions remain. Implementation team builds manifest → contracts → viewer →
> skill → workflow → seeds directly from this. Do NOT relitigate the LOCKED DECISIONS.
>
> **Source experiment grounding:** `docs/DESIGN.md` (three levers + empirics), `docs/GUIDE.md`
> (HITL mental model), `.claude/skills/palate/SKILL.md` (orchestration loop — methodology kept,
> prose to be rewritten), `profiles/ezchan/` (the real worked-example artifacts).
>
> **Pneuma grounding:** `AGENTS.md` contracts table, `core/types/{mode-manifest,viewer-contract,source}.ts`,
> `docs/reference/{viewer-agent-protocol,controlled-state-surface}.md`, exemplar `modes/doc/`,
> richer-action exemplars `modes/kami/` + `modes/slide/`.

---

## 0. Executive summary — the six load-bearing decisions

1. **ViewerAddress vocabulary:** `{ contentSet?, block, span? }`. `contentSet` = which writing
   project (reserved key, store-resolved). `block` = a stable block id assigned to each
   top-level markdown block of the draft (`b3`, `b7`…), persisted in a sidecar. `span` = an
   optional fine handle `{ start, end, quote }` — character offsets **within that block's source
   text** plus a verbatim quote for re-anchoring. One noun drives select → 5-directions popup →
   surgical rewrite → locator → capture.
2. **Source kinds:** `aggregate-file` for the **draft** (domain type `Draft` = ordered blocks +
   blockId map, load/save in `domain.ts`); `file-glob` (read-only) for **materials**;
   `aggregate-file` (read-only-ish) for **taste artifacts** (domain type `TasteProfile`);
   `json-file` for `.pneuma/config.json`. Cross-family availability is a second `json-file` source
   reading `.pneuma/cross-family.json` — the startup probe's output — so chokidar reloads the family
   banner the moment the probe lands the file (a `memory` source could never observe it).
3. **Action set (8 agent-invocable + capture):** `navigate-to`, `rewrite-span`,
   `mask-and-complete`, `set-block-frozen`, `poke-symptom`, `set-ladder`, `propose-directions`,
   `mark-resolved`. Plus framework `capture`. Five Commands (User→Agent) for the entry flows.
4. **Federation mechanism:** palate owns the heavy artifacts under the content-set
   (`taste/` dir: rubric/recipes/swaps/prefs.log). It writes a **distilled summary** into the
   Pneuma preference layer via the standard `mode-palate.md` file (personal + project scope) so
   other modes read palate's voice signals, and it **reads** `profile.md` +
   `mode-{name}.md` at task start so it inherits other modes' signals. Heavy artifacts never
   enter the preference layer; only the distilled hard-constraints do.
5. **Distillation home:** **mode-internal dynamic Workflow** (`distill` workflow, agent-triggered
   at finalize + on-demand), NOT Pneuma's EvolutionConfig. Justified below — palate's distillation
   is cross-family, multi-artifact, and validate-against-past-verdicts; the generic single-agent
   Evolution agent cannot do it. `evolution` is still declared but with a narrow directive scoped
   only to the federated `mode-palate.md` summary.
6. **Cross-family approach:** the single Pneuma backend agent (orchestrator) shells out to
   `codex exec` and `gemini` via `Bun.spawn` from skill-bundled scripts
   (`run_codex.sh`, `run_gemini.sh`, `cross_family_probe.sh`). Startup probe writes
   `.pneuma/cross-family.json`; the viewer's taste panel and the ladder control degrade
   gracefully to single-family with a clear banner when a family is absent.

---

## 1. Problem & forces (restated in Pneuma terms)

**What the user is doing:** opening palate means *"I want to write something that fits my taste,"*
expressed as a concrete writing goal — never *"set up my taste."* Two entry states:

- **(A) Idea-only** — the user has an outline/brief but no prose. palate writes the first draft.
- **(B) Disliked draft** — the user has prose that reads "one-glance-AI." palate de-AIs it.

**The engine (validated, do not re-derive):** a human-in-the-loop, no-gradient search. The agent
is a *generator* + *orchestrator*; the human is a *zero-reward-hacking discriminator*. Three
levers: cross-family generation (Claude ∥ GPT/codex ∥ Gemini break each model out of its own
RLHF attractor basin), real-human negentropy anchors, and the human as the gold-standard judge.
Mechanics: **kernel-freeze** (the load-bearing meaning/facts/hedges are an invariant; only
structure/texture/genre may be disrupted), the **disruption ladder** (rungs 0–5, internally
incremented on dissatisfaction), **cheapest-signal HITL** (near-binary judgments or "poke one
symptom"), and **distillation** of every judgment into plain-text artifacts (rubric, recipes,
swaps, prefs.log). No model is ever trained; "learning" is disciplined file updates.

**The reframe this brief delivers:** turn the chat-only orchestration experiment into a visual
**writing studio** — a live *player* for the search process. The differentiator is
**direct-manipulation editing that bypasses chat**: the user points at the draft (span, region,
sentence, block) and picks an action; the studio routes it to the cross-family search loop. This
is exactly Pneuma's "viewer is the app" thesis — the chat becomes the fallback, the canvas
becomes the primary surface.

**Quality attributes / forces:**

- **Cheapest-signal is the prime directive.** Every viewer interaction must be a sub-second
  gesture (click a direction, drag a mask, toggle a freeze, bump a dial) — never "write a
  paragraph of feedback." The action set is engineered around this.
- **Kernel-freeze must be a UI invariant, not a prompt suggestion.** Frozen blocks are a
  contract the rewrite path physically honors.
- **Selective human-ness.** The studio must let the user point at "the 2-3 load-bearing hammers"
  (emphasis) — the validated meaningful-entropy source — rather than uniform perturbation.
- **Readability is an orthogonal axis** to AI-ness; the finalize path guards both.
- **n=1 honesty.** Everything the artifacts encode is a small-sample strong-hypothesis. The
  studio surfaces taste artifacts as *editable*, never as locked truth.

**Decomposition check:** this is one capability (a writing studio with a federated taste
substrate), not several. The cross-family search, the taste federation, and the distillation are
sub-systems of the one mode, not independent modes. **No decomposition needed.** (The one thing
deliberately *not* built here: the Twitter human-anchor harvester — the source experiment marks
its value as unproven, "no winning generation ever used it." Carried as a deferred optional
script, not a v0.1 surface. See §10.)

---

## 2. Layer placement

| Concern | Layer | Home |
|---|---|---|
| The mode itself (skill + viewer + agent config) | **L4 Mode Protocol** | `modes/palate/manifest.ts` + `pneuma-mode.ts` |
| The three-panel studio + direct-manipulation | **L3 Content Viewer** | `modes/palate/viewer/PalatePreview.tsx` |
| Cross-family generation (codex/gemini shell-out) | **per-mode concern** | skill-bundled scripts run by the agent via `Bun.spawn` — **NOT** a new backend |
| Taste federation summary | **thin-waist (existing seam)** | reuses `~/.pneuma/preferences/` + `pneuma-preferences` skill — no new contract |
| Heavy taste artifacts | **per-content-set state** | `<contentSet>/taste/` on disk |
| Distillation | **per-mode dynamic Workflow** | `modes/palate/skill/workflows/distill.*` (agent-launched) |

**Critical hard-rule confirmations:**

- **No new contract is required.** Every signature feature maps onto the *existing*
  `ViewerActionDescriptor` / `ViewerCommandDescriptor` / `ViewerAddress` / `ViewerSelectionContext`
  / `ViewerNotification` surface. palate is a *consumer* of the thin waist, not an extender of it.
  This is the right outcome — direct-manipulation editing is exactly what the action space + address
  contract were lifted for (the protocol doc names "select → view → point" as the motivating closed
  loop). **Do not invent a "RewriteRequest" contract;** it is a per-mode `ViewerAction` payload.
- **Cross-family is NOT a new AgentBackend.** The Pneuma session stays single-backend
  (startup-locked, per `AGENTS.md`). codex/gemini are *tools the agent shells out to*, identical
  in spirit to how `kami`/`illustrate` shell out to image-gen scripts. The server has **zero**
  knowledge of codex/gemini; everything is driven by the manifest's skill scripts + SKILL.md.
  This keeps the "no backend conditionals outside `backends/index.ts`" rule intact.
- **`manifest.ts` stays React-free.** `domain.ts` (load/save pure functions) is imported by the
  manifest (mirrors kami). The viewer + `extractContext` live in `pneuma-mode.ts`.

---

## 3. Contract design (shapes, invariants, state ownership)

### 3.1 ViewerAddress vocabulary — `{ contentSet?, block, span? }`

This is the geometric foundation for every direct-manipulation feature. **Decision: block-anchored
addressing with optional character-span refinement.** Rationale in one line: the draft is markdown
prose where the natural coarse unit is a *block* (paragraph / heading / list / blockquote) and the
natural fine unit for "this metaphor / this sentence" is a *character span within a block*.

```
ViewerAddress = {
  contentSet?: string;   // reserved key — which writing project (dir prefix). Store-resolved.
  block: string;         // stable block id, e.g. "b7". Assigned per top-level md block.
  span?: {               // optional fine handle within that block's SOURCE markdown text
    start: number;       // char offset into the block's raw markdown
    end: number;
    quote: string;       // verbatim selected text — survives block-text edits for re-anchoring
  };
}
```

**Why block ids and not line ranges (the doc-mode choice):** the draft is the single editable
output and the rewrite loop *replaces whole blocks and shifts downstream paragraphs*
(mask-and-complete explicitly "may affect downstream paragraphs"). Line numbers are invalidated by
every rewrite; a stable `block` id survives a rewrite of a *different* block, so a frozen block or
a pending direction stays anchored across the search. Block ids are the only addressing atom that
makes kernel-freeze a durable UI invariant.

**Why `span` carries `quote` and not just offsets:** offsets drift the instant the block's text
changes. The `quote` lets the viewer (and the agent) re-anchor "the AI metaphor I poked" even after
an adjacent rewrite, by searching for the quote text. Offsets are the fast path; quote is the
self-healing fallback. (This mirrors the source experiment's `swaps.jsonl` which stores verbatim
`before`/`after` sentence pairs — the quote IS the swap's "before" candidate.)

**Block-id assignment + persistence (the one piece of new mechanism):** block ids are assigned by
`domain.ts::loadDraft` deterministically and persisted in a sidecar `<contentSet>/draft.blocks.json`
(`{ version, blocks: [{ id, hash }] }`, hash = content hash of the block's source). On reload,
`loadDraft` matches blocks to prior ids by position-then-hash so ids are stable across edits;
genuinely new blocks get fresh ids (monotonic counter in the sidecar). **This is the only
non-trivial invariant the implementation must get right** — see §3.2 risk note.

`block` is mode-opaque to the framework (per the ViewerAddress contract); `contentSet` is the one
reserved key the store resolves. Documented in SKILL.md `## ViewerAddress vocabulary`.

### 3.2 Source domain types

**`Draft` (aggregate-file, read+write):**

```
Draft = {
  contentSet: string;             // active writing-project prefix ("" = root)
  blocks: DraftBlock[];           // ordered
}
DraftBlock = {
  id: string;                     // stable, from draft.blocks.json
  markdown: string;               // the block's raw markdown source
  frozen: boolean;                // kernel-freeze flag (pin/freeze passage)
  // derived/non-persisted at render: rendered html, symptom flags
}
```

- `loadDraft(files) → Draft | null`: reads `<prefix>/draft.md`, splits into top-level blocks
  (split on blank-line boundaries respecting fenced code blocks), assigns/reconciles ids from
  `draft.blocks.json`, reads `frozen` set from `draft.freeze.json`. Returns null on empty workspace.
- `saveDraft(next, current) → { writes, deletes }`: re-serializes blocks back to `draft.md` (join
  with `\n\n`), rewrites `draft.blocks.json` + `draft.freeze.json` when the block set / freeze set
  changed. **Frozen blocks' `markdown` is never altered by a save that originates from a rewrite of
  another block** — the save diff only touches changed blocks.

> **RISK (chosen default):** block-splitting markdown is fiddly (nested lists, fenced code,
> tables). Default: split only on top-level blank-line-delimited blocks using a minimal
> CommonMark block scanner (reuse `remark` which is already a dep via `react-markdown`/`remark-gfm`
> — parse to mdast, take depth-1 children, use their `position` to slice source). Do NOT hand-roll
> a regex splitter. If a block is a multi-paragraph blockquote or list, it stays one block — that
> is the right granularity for rewrite-a-passage anyway.

**`materials` (file-glob, read-only):** `ViewerFileContent[]` over the materials dir. Domain is
literally "a set of read-only input files," so file-glob is correct (per the source decision tree:
"multi-file IS the domain → file-glob"). Patterns: `materials/**/*.{md,txt}`. Voice anchors,
reference texts, the original outline/draft, and the frozen-kernel statement all live here as files.

**`taste` (aggregate-file, read — write only via the agent's file tools):**

```
TasteProfile = {
  contentSet: string;
  voiceFloor: string;             // taste/taste-profile.md §1 rendered
  rubric: Symptom[];              // taste/taste-profile.md §2 parsed into cards
  launchRung: number;             // calibrated starting rung for this content-type
  recipeNames: string[];          // taste/recipes/*.md filenames
  swapCount: number;              // taste/swaps.jsonl line count (golden-material gauge)
  prefsCount: number;             // taste/prefs.log.jsonl line count
}
Symptom = { id: string; title: string; tell: string; fix: string }  // S1..S7 cards
```

- `loadTaste(files) → TasteProfile | null`: parses `taste/taste-profile.md` (the §0/§1/§2/§5
  structure from the worked example), counts jsonl lines. Read-only in the viewer — the **agent**
  owns all writes to taste files via its native Edit/Write tools (this is the source experiment's
  "all learning is disciplined file updates" discipline). The viewer renders, never mutates.
- `saveTaste` is a **stub** (`{ writes: [], deletes: [] }`) — mirrors webcraft's `saveSite` stub.
  Taste artifacts are authored by the agent, not restructured from the UI.

**`crossFamily` (json-file, read-only):** `{ claude: boolean; codex: boolean; gemini: boolean }` read
from `.pneuma/cross-family.json` (written by the startup probe script; see §7). A `json-file` source
(not `memory`): a memory source only ever holds its declared initial value and could never observe
the probe's write, so the banner would be stuck at "single-family" forever. The json-file source
loads the probe result and chokidar reloads it live; its parse degrades gracefully to single-family
(claude-only) when the file is absent or malformed — never a crash, never an error event. The viewer
reads it to render the family-availability banner and gate the ladder/dial affordances.

**`config` (json-file):** `.pneuma/config.json` — init params (active content set, default
content-type). Mirrors kami.

### 3.3 State-ownership matrix

| State | Owner (mutator) | Read by |
|---|---|---|
| `draft.md` block text | Agent (rewrite/complete via Edit/Write) **and** user (center WYSIWYG edits via `fileChannel.write` / `Draft` source write) | Viewer (center), agent (`extractContext`), distill |
| `draft.blocks.json`, `draft.freeze.json` | `domain.ts` save path (driven by viewer toggles + agent freeze actions) | `domain.ts` load |
| `materials/**` | User (drops files) + agent (writes frozen-kernel statement on intake) | Viewer (left panel), agent |
| `taste/taste-profile.md`, `recipes/*`, `swaps.jsonl`, `prefs.log.jsonl` | **Agent only** (distillation discipline) | Viewer (right panel), distill, agent |
| `~/.pneuma/preferences/mode-palate.md` + `profile.md` | Agent (via `pneuma-preferences` skill) | All modes' agents |
| `.pneuma/cross-family.json` | Startup probe script | Viewer (`crossFamily` source), agent |

---

## 4. Action space (the full ViewerActionDescriptor + ViewerCommandDescriptor set)

Mapped one-to-one to the five signature features. All `agentInvocable: true` so the agent can drive
them itself (e.g. propose directions after a generation pass), but each is **also triggered from a
viewer gesture** via the Command channel or a direct viewer-internal dispatch (see §5 for the wire
path). `capture` is framework-built-in and not listed.

### 4.1 Agent → Viewer actions (`manifest.viewerApi.actions[]`)

| id | label | category | params | maps to |
|---|---|---|---|---|
| `navigate-to` | Go to passage | navigate | `{ address: object }` | every locator/QA jump; scroll+highlight the block, optionally select the span |
| `rewrite-span` | Rewrite this | custom | `{ address: object, direction: string }` | **span-select → 5 directions**: agent rewrote `address`; viewer replaces that block/span text and pulses it |
| `mask-and-complete` | Mask & continue | custom | `{ address: object, scope: string }` | **mask-and-complete**: `scope ∈ {"region","after"}`; viewer shows masked region as "regenerating", reflows downstream blocks when the result lands |
| `set-block-frozen` | Freeze / unfreeze | ui | `{ block: string, frozen: boolean }` | **pin/freeze**: toggles the block's frozen flag (writes `draft.freeze.json`); frozen blocks render with a lock chrome and are excluded from rewrite scopes |
| `poke-symptom` | Tag symptom | custom | `{ address: object, symptom: string }` | **poke-a-symptom**: records a symptom tag on a span; viewer marks it; triggers the agent's cross-family surgical fix |
| `set-ladder` | Set disruption | ui | `{ rung: number, delta?: number }` | **dial-the-ladder**: sets/bumps the global rung; viewer updates the dial; agent re-reads on next pass |
| `propose-directions` | Show directions | ui | `{ address: object, directions: object }` | agent returns the ~5 rewrite directions for a selection; viewer renders them as the popup chips (each chip → `rewrite-span`) |
| `mark-resolved` | Clear symptom | ui | `{ address: object }` | viewer clears a symptom/direction marker once the user accepts a fix |

> **Why `propose-directions` is its own action and not baked into selection:** the ~5 directions
> are **derived from the taste rubric's symptoms** (e.g. "cut the AI metaphor / tighten / let it
> breathe / punch harder / sink the argument"). They are not static — they depend on which symptoms
> the rubric flags for *this* span. So the flow is: user selects → viewer fires a `propose-directions`
> *request to the agent* (via Command/notification, see §5) → agent reads the rubric + the span,
> returns 5 contextual directions via the `propose-directions` action → viewer shows chips → click a
> chip → `rewrite-span`. This keeps direction-generation taste-aware instead of a hardcoded menu.
> **Default fast-path:** to keep the popup instant, the viewer shows a *static default set of 5*
> immediately (the canonical symptoms S2/S4/S5/S7 + "tighten"), and live-replaces them if/when the
> agent's contextual `propose-directions` lands. Best of both: zero-latency popup, taste-aware refinement.

### 4.2 User → Agent commands (`manifest.viewerApi.commands[]`)

These are the chat-bypassing entry + global gestures that need to *start an agent task* (the popup
chip clicks dispatch through these, carrying their payload in the notification — see §5):

| id | label | description |
|---|---|---|
| `start-from-idea` | Write from this outline | Entry state (A): generate the first cross-family draft from the materials/outline |
| `start-from-draft` | De-AI this draft | Entry state (B): intake the disliked draft, freeze the kernel, run the first disruption pass |
| `request-directions` | (internal) | Fired by span-select; asks the agent for taste-aware rewrite directions for the selected address |
| `still-ai` | Still reads AI — dial up | The cheapest signal: bump the ladder +1 and regenerate (whole-draft one-shot) |
| `good-enough` | This is good — finalize | Triggers the finalize + distill pass |

**Action-space size check:** 8 actions + 5 commands. This is above the create-mode "2–5 actions"
guideline, and that is *deliberate and defended*: palate's entire value proposition is a rich
direct-manipulation vocabulary on one object (the draft block/span). Each action is a distinct
*verb on the same address noun* — none is surfacing UI chrome as an action (the anti-pattern the
guideline guards against). They cluster into one coherent family: {navigate, rewrite, complete,
freeze, poke, dial, propose, resolve}. Collapsing them would force overloaded params and hurt the
agent's ability to reason about what it is doing. Verdict: justified.

---

## 5. Cross-layer integration flows

### 5.1 The span-select → directions → rewrite loop (the signature flow)

```
User drags to select text in center draft (select mode)
   │  viewer builds ViewerSelectionContext with address = { contentSet, block, span:{start,end,quote} }
   ▼
Viewer shows the 5-direction popup IMMEDIATELY with the static default set
   │  (zero-latency; chips labeled from canonical symptoms + "tighten")
   │
   ├─(parallel) Viewer fires Command `request-directions` via onNotifyAgent
   │     → ws-bridge buffers → flushes to agent as system message on idle
   │     → agent reads taste/taste-profile.md rubric + the span text
   │     → agent calls action `propose-directions { address, directions }`
   │     → ws-bridge-viewer → ViewerPreviewProps.actionRequest → viewer live-replaces chips
   ▼
User clicks a direction chip
   │  Viewer fires Command (or a notification carrying { intent:"rewrite-span", address, direction })
   │     → agent receives, shells out cross-family to rewrite JUST that span/block in that direction
   │       (codex for one family, claude-native for another; picks the family that escapes the basin)
   │     → agent calls action `rewrite-span { address, direction }` with the new text in params OR
   │       writes draft.md directly (Edit) — see 5.4 for which path
   ▼
Viewer replaces the block/span text, pulses the change, clears the popup (mark-resolved)
```

**`<viewer-context>` injection (⑥):** `extractContext` emits, for a palate selection:
```
<viewer-context mode="palate" contentSet="..." block="b7">
Selected (rewrite target): "…the selected quote…"
  Address: {"contentSet":"...","block":"b7","span":{"start":0,"end":42,"quote":"…"}}
  Block frozen: false
  Active rung: 4
  Symptoms flagged here: S7 (ai-metaphor)
</viewer-context>
```
So even a plain chat message ("this metaphor is too AI") is automatically grounded in the exact
address — the agent can feed `address` straight back into `rewrite-span`/`capture`. This is the
"one noun, every verb" round-trip the protocol guarantees.

### 5.2 mask-and-complete

User drags a mask over a region (or clicks "everything after here" on a block) → viewer dispatches
the `mask-and-complete` intent via a notification with `{ address, scope }` → agent regenerates,
**aware it may reflow downstream blocks** (kernel-frozen blocks are skipped — they are in the
context as fixed invariants) → agent writes `draft.md` → chokidar → `Draft` source `external` event
→ viewer reflows, animates the regenerated region, preserves frozen blocks visually.

### 5.3 freeze / dial — pure-UI-first actions

`set-block-frozen` and `set-ladder` are `category: "ui"` and **resolve in the viewer without an
agent round-trip for the state change** (the viewer writes `draft.freeze.json` / updates the dial
and persists rung to `config.json`). The agent is *informed* via the next `<viewer-context>` block
(which always carries `Block frozen` + `Active rung`), so it reads the new invariant on its next
turn without a dedicated message. This honors cheapest-signal: toggling a freeze is a zero-latency
local gesture, not a chat turn. (The agent can *also* invoke these actions itself, e.g. auto-freeze
the kernel after intake.)

### 5.4 Who writes the draft — agent Edit vs. action-param round-trip

**Decision: the agent writes `draft.md` directly via its native Edit/Write tools** for all
generative actions (`rewrite-span`, `mask-and-complete`, the initial draft). The viewer observes
the change through the `Draft` aggregate-file source as an `external`-origin event and animates it.
Rationale: (a) it is the agent's native mode of work (the protocol's L1 thesis — "files are the
agent's mother tongue"); (b) cross-family results can be large multi-block rewrites that don't fit
cleanly in an action param; (c) it keeps the rewrite path uniform whether the agent shelled out to
codex or wrote it itself. The `rewrite-span`/`mask-and-complete` **actions then carry no result
text** — they are *signals* the viewer uses to know *which* address is being regenerated so it can
show the "regenerating…" affordance and pulse the change when the `external` event arrives. (This is
the same split kami/webcraft use: edits flow through `fileChannel`/Edit; actions are navigation/UI
signals.) The viewer's own user edits in the center panel write through the `Draft` source's
`write()` (origin `self`), so the two write paths coexist via origin tagging — no echo state.

### 5.5 Notification channel (⑥) for readability + symptom self-checks

The viewer can proactively `onNotifyAgent` a `ViewerNotification`:
- `type: "readability-check"` (`warning`) when a block exceeds a length cap (the validated
  "monster paragraph" guard — readability is the orthogonal axis). Summary: "Block b9 is very dense
  — consider breaking it." This nudges the agent to guard readability at finalize without the user
  having to notice.
- `type: "kernel-drift"` (`warning`) — reserved: if a frozen block's text changes via an external
  event (should never happen), warn. Defensive only.

---

## 6. State & lifecycle design (disk surface)

### 6.1 Content-set model — one writing project = one content-set

**Decision: one article/writing-project = one content-set (a top-level directory under the
workspace).** Multiple writing projects coexist as sibling content-set dirs, exactly like
slide/webcraft/kami multi-content-set decks. `supportsContentSets: true`.

```
<workspace or sessionDir>/
  <project-prefix>/                 # e.g. "sisyphus-essay", or "" for the root project
    draft.md                        # THE single editable output (center panel)
    draft.blocks.json               # block-id ↔ content-hash sidecar (domain.ts owned)
    draft.freeze.json               # { frozen: ["b3","b7"] } kernel-freeze set
    materials/                      # READ-ONLY inputs (left panel)
      outline.md                    # entry-state (A): the idea/outline
      original.md                   # entry-state (B): the disliked draft, preserved verbatim
      kernel.md                     # the frozen-kernel statement (agent writes at intake)
      voice/                        # the user's own voice-anchor samples
        *.md
      refs/                         # reference texts
        *.md
    taste/                          # HEAVY taste artifacts (right panel) — per content-set
      taste-profile.md              # voice floor + symptom rubric + launch rung + meta-principles
      recipes/<content-type>.md     # distilled operational generation recipe
      swaps.jsonl                   # symbol-layer AI→human sentence pairs (golden material)
      prefs.log.jsonl               # append-only signal events
      anchors/<content-type>/       # (optional) abstracted human texture notes
  .pneuma/
    config.json                     # init params (active content-set, content-type)
    cross-family.json               # startup probe result { codex, gemini, claude }
```

> **Per-content-set `taste/` vs. one shared `taste/`:** Decision — **per-content-set**, because the
> source experiment calibrates rubric/launch-rung *per content-type* (longform ≠ tweet ≠ work
> writing), and a content-set IS a content-type instance. Cross-project taste convergence happens
> through the federated `mode-palate.md` summary (§7), not through a shared heavy dir. This keeps
> each project's artifacts self-contained, git-versionable, and shippable in a snapshot.

> **Seeding the taste dir for a brand-new content-set:** when a content-set has no `taste/`, the
> agent **bootstraps** it from the federated `~/.pneuma/preferences/mode-palate.md` + the
> guided cold-start (§8), writing a fresh `taste-profile.md`. The ezchan worked example ships as a
> ready-made `taste/` inside the worked-example seed so users can see a fully-converged profile.

### 6.2 controlled-state-surface conformance

palate adds **per-content-set domain artifacts** (the `taste/` dir + draft sidecars) — these live
in the **workspace / sessionDir content area**, which is *user-deliverable content space*, not the
Pneuma `.pneuma/` control area. This is correct and conformant: per the state-surface doc, "the
workspace root is user content; Pneuma only occupies `.pneuma/`." The only files palate puts under
`.pneuma/` are `config.json` (standard) and `cross-family.json` (new, session-scoped startup probe
— analogous to how modes drop derived config). **The federated summary** at
`~/.pneuma/preferences/mode-palate.md` is the *existing* Layer-1 preference surface — palate adds
no new file *type* there, it just authors the standard per-mode preference file. **No extension to
the controlled-state-surface contract is required;** palate uses existing slots. (If the team wants
the state-surface doc to mention palate's `taste/` convention, that is a one-line doc addition, not
a contract change — flagged as optional in §11.)

### 6.3 Resume / replay / handoff survival

- **Resume:** all state is on disk under the content-set + `.pneuma/`. `cross-family.json` is
  re-probed at every startup (it is environment state, not user state) — so a session resumed on a
  machine without codex/gemini degrades correctly. `draft.blocks.json` makes block ids stable across
  resume. **Survives.**
- **Replay:** the viewer honors `readonly` — in replay it renders the draft + taste panels read-only,
  no rewrite/freeze/dial affordances, no cross-family shell-out. The `Draft`/`taste` sources render
  from checkpointed files. **Survives** (the heavy artifacts are plain files shadow-git tracks).
- **Handoff:** palate is a normal (non-hidden) mode; Smart Handoff in/out works unchanged. A handoff
  *into* palate (e.g. from doc: "make this read less AI") lands `inbound-handoff.json` → skill
  installer injects the `pneuma:handoff` block → palate's agent reads it, drops the source draft into
  `materials/original.md`, freezes the kernel, and runs entry-state (B). **The federated
  `mode-palate.md` is the cross-mode benefit channel** — a doc session afterward reads palate's voice
  signals from preferences. **Survives + adds value.**

---

## 7. agent_config + cross-family

### 7.1 Single backend, agent shells out

The Pneuma session runs **one** backend (Claude Code is the natural default orchestrator given the
richest tool/agent support; codex/kimi also work as the orchestrator, see degradation). The
orchestrator agent reaches the *other* families by spawning their CLIs — this is a **per-mode skill
capability**, invisible to the server:

- **codex** (confirmed `codex-cli 0.141.0`): `codex exec --skip-git-repo-check - < promptfile`
  (fresh session, naturally isolated — matches the source experiment's invocation).
- **gemini** (confirmed `0.6.0`): `gemini` CLI in non-interactive mode for a generation/judge pass.
- **claude-native**: when the orchestrator IS claude-code, an in-process isolated generation uses
  the Task subagent tool (fresh context, no leakage); when the orchestrator is codex/kimi, claude is
  reached via the `claude` CLI if present, else that family is simply absent.

These are invoked from **skill-bundled scripts** so the SKILL.md gives the agent one stable
command surface regardless of CLI version drift:

```
modes/palate/skill/scripts/
  cross_family_probe.sh   # writes .pneuma/cross-family.json; run at session start
  run_codex.sh            # wraps: codex exec --skip-git-repo-check - < $1
  run_gemini.sh           # wraps: gemini non-interactive generate/judge from $1
```

> **Why scripts, not MCP, not a backend:** the source experiment already drives codex via
> `codex exec` from the orchestrator; an MCP server would add a long-lived process + protocol surface
> for what is a fire-once `Bun.spawn`. A new AgentBackend would violate the single-backend
> startup-lock and pull mode knowledge into `backends/`. Scripts are the lightest seam that honors
> every hard rule. (Same pattern as `_shared/scripts/generate_image.mjs` — a tool the agent runs,
> not a backend.) These are **palate-owned** scripts (not `_shared`), because the SKILL.md guidance
> around them is palate-specific (per the "share scripts not skills" memory).

### 7.2 Startup detection + degradation

`cross_family_probe.sh` runs `command -v codex`, `command -v gemini`, `command -v claude` and writes
`.pneuma/cross-family.json`. **When is it run?** The agent runs it on its first turn (SKILL.md
instructs this as step 0), and the result feeds the `crossFamily` **json-file** source the viewer
reads (`path: .pneuma/cross-family.json`). A json-file source — not memory — is what lets chokidar
reload the family banner the moment the probe lands the file; the parse degrades to single-family
(claude-only) when the file is absent or malformed, so the banner is correct from cold start.

**Degradation matrix (chosen behavior):**

| Families present | Behavior |
|---|---|
| Claude + codex + gemini | Full: generate cross 2 families, gemini as neutral third-party judge |
| Claude + codex (no gemini) | Core cross-family (the validated 2-family minimum); judge falls back to one of the two |
| One family only | **Single-family mode**: viewer shows an amber banner "Cross-family unavailable — running single-family. Install codex/gemini for the full diversity engine." The ladder + rewrite still work (intra-family disruption), but the SKILL.md tells the agent diversity is reduced. |

The banner is rendered from the `crossFamily` source in the taste panel; never blocks the user.
`supportedBackends` is left **unset** (all backends allowed) — palate works under any orchestrator;
cross-family is about *tools*, not the *backend*.

### 7.3 agent block

```
agent: {
  permissionMode: "bypassPermissions",
  greeting: "<system-info pneuma-mode=\"Pneuma palate\" skill=\"pneuma-palate\" session=\"new\">…
             The user opened palate with a writing goal. Run cross_family_probe.sh, then ask for
             their goal if not already given (entry A: outline / entry B: a draft to de-AI). Greet
             in 1–2 sentences — do NOT ask them to 'set up their taste.'"
}
```

---

## 8. Seed strategy

**Shape: content-sets-by-entry-state + a worked-example.** Three seed gallery cards:

| id | sourceKey (dir) | narrative |
|---|---|---|
| `from-idea` | `modes/palate/seed/from-idea/` | Entry-state (A). Ships `materials/outline.md` (a guide-prompted outline skeleton), an empty `draft.md`, and a starter `taste/taste-profile.md` (the generic bootstrap profile). First card a new user picks when they have an idea but no prose. |
| `from-draft` | `modes/palate/seed/from-draft/` | Entry-state (B). Ships `materials/original.md` (a placeholder "paste your AI-sounding draft here"), `materials/kernel.md` (empty, agent fills), and the same starter `taste/`. The de-AI entry. |
| `worked-example` | `modes/palate/seed/worked-example/` | The **ezchan worked example**, adapted. Ships a fully-converged `taste/` (taste-profile.md with S1–S7 + §5 meta-principles, recipes/longform.md, swaps.jsonl, prefs.log.jsonl, a voice anchor), the finalized essay as `draft.md`, and its materials. Lets a new user *read a converged profile* to understand the methodology before starting their own. |

**Adapting the ezchan artifacts:** copy `profiles/ezchan/{taste-profile.md, recipes/longform.md,
examples/swaps.jsonl, prefs.log.jsonl, examples/positive/*}` from the source experiment into
`seed/worked-example/{taste/, draft.md, materials/voice/}`. **Decision: keep the Chinese content**
— it is mode seed content (the language exception in `.claude/rules/modes.md` explicitly allows
Chinese in seed templates), and the worked example's value is the *real* artifacts. The
`taste-profile.md` structure (§0 calibration / §1 voice floor / §2 symptom rubric / §5
meta-principles) becomes the canonical schema palate writes for every user.

**Starter (bootstrap) taste-profile:** `from-idea` and `from-draft` ship a *generic* `taste-profile.md`
with empty rubric + a §1 that says "voice floor will fill in as you feed samples" + launchRung 1
(uncalibrated default). The **guided cold-start** (LOCKED DECISION 1) is an SKILL.md-driven first-run
flow: on first open with no `voice/` samples, the agent asks the user to paste 1–2 of their own
writing samples (→ `materials/voice/`) and/or pick a few preference toggles, then writes the initial
`taste-profile.md` voice floor. **This is onboarding-as-byproduct, not a setup wizard** — it is
folded into "give me your writing goal."

> `init.seeds[]` MUST be declared explicitly (these are directory-shaped multi-file bundles; the
> auto-derive only handles directory entries, but explicit declaration gives the gallery proper
> titles/thumbnails). `contentCheckPattern: "**/draft.md"`.

---

## 9. UX outline — three-zone studio (structure for the impeccable viewer impl)

The viewer impl agent will run `/impeccable` for craft; this section sets the **structure + the
contract surface it must honor**. Layout: `layout: "editor"` (dual-panel shell with the agent chat
docked) — but the *viewer itself* renders three internal zones in its panel.

```
┌─ TopBar (framework) ─────────────────────────────────────────────────────────┐
│  content-set switcher · rung dial · family-availability chip · view/select   │
├──────────────┬───────────────────────────────────────┬────────────────────────┤
│ LEFT          │ CENTER                                 │ RIGHT                   │
│ Materials     │ The Draft (single editable WYSIWYG)    │ Taste                   │
│ (read-only)   │                                        │ (read-only)             │
│               │                                        │                         │
│ • outline /   │ • rendered markdown, block-addressed   │ • voice floor (§1)      │
│   original    │ • frozen blocks: lock chrome, dimmed   │ • symptom rubric cards  │
│ • kernel.md   │   edit affordance                      │   (S1..S7), tap to learn│
│ • voice/      │ • select span → 5-direction popup      │ • launch rung gauge     │
│ • refs/       │ • mask region → "regenerating" overlay │ • swaps/prefs counters  │
│               │ • per-block: freeze toggle, poke menu  │ • family banner (degraded)│
│ collapsible   │ • dense-block readability flag         │ • "what palate learned" │
└──────────────┴───────────────────────────────────────┴────────────────────────┘
```

**Interaction model (must honor these contract bindings):**

1. **Center is the only editable surface.** WYSIWYG markdown render (reuse the DocPreview
   `react-markdown` + selectable-block machinery as the starting point — it already emits
   `data-selectable` blocks and builds selection context). Direct user typing writes through the
   `Draft` source `write()` (origin self). Agent rewrites arrive as `external` events and animate.
2. **Span-select popup** = the marquee feature. On `mouseup` over a text range inside a block, build
   the `address` (`{contentSet, block, span:{start,end,quote}}`), show the 5-direction popup at the
   selection rect (default chips instant, agent-refined chips replace). Chip click → §5.1 flow.
   Esc/click-away dismisses (popup only — NOT the gallery dismissal rules).
3. **Per-block chrome** (hover): a freeze toggle (lock icon → `set-block-frozen`) and a poke menu
   ("tag symptom" → `poke-symptom`). Frozen blocks get a persistent lock badge + muted background and
   refuse text edits in the center.
4. **Mask gesture:** a "mask" tool in the block hover menu — "rewrite this region" or "continue from
   here" → `mask-and-complete`. The masked area shows a shimmer overlay until the `external` event
   lands.
5. **Rung dial** in the TopBar: a 0–5 segmented control + a one-click "dial up" (`still-ai` command).
   Labels are human ("gentler … bolder"), NOT "rung 3" — the source experiment's "don't explain rungs
   to the user" rule. Persists to `config.json`.
6. **Right taste panel** renders `TasteProfile` read-only: voice-floor prose, symptom cards
   (expandable to show tell/fix), the calibrated launch-rung, and the swaps/prefs counters as a
   "how much palate has learned about you" gauge. The family-availability banner lives here when degraded.
7. **Design tokens:** Ethereal Tech `cc-*` tokens throughout. Frozen = a calm locked surface; the
   rewrite pulse uses `cc-primary` (neon orange) sparingly; readability flags use `cc-warning`.
   **Visual verification via chrome-devtools-mcp is mandatory** before the viewer is called done.
8. **Empty / degraded states:** no content-set → seed gallery (framework). Single-family → amber
   banner, full functionality. No taste yet → right panel shows the cold-start prompt ("feed me a
   sample to start learning your voice").

`extractContext` (in `pneuma-mode.ts`) emits the §5.1 block. `workspace.resolveContentSets` uses
`core/utils/content-set-resolver.ts::createDirectoryContentSetResolver()` (one-liner, per protocol
doc). `workspace.createEmpty` returns a new content-set scaffold (empty `draft.md` + starter `taste/`).
`updateStrategy: "incremental"` (the draft is large; reflow only changed blocks).

---

## 10. Distillation home — mode-internal Workflow (decided + justified)

**Decision: a mode-internal dynamic Workflow (`distill`), launched by the agent — NOT Pneuma's
EvolutionConfig as the primary mechanism.**

**Why not EvolutionConfig:** Pneuma's Evolution agent is a *single* separate agent that reads CC
history and augments a skill's SKILL.md, producing one proposal a human reviews. palate's
distillation is fundamentally different and richer (from `distill.md`):
- It is **cross-family** (≥2 reflectors read the full trajectory and synthesize).
- It produces **multiple artifact types** (sharper rubric + per-content-type recipe + swaps-collection
  guidance), not a SKILL.md augmentation.
- It **validates against the user's past verdicts** (Pareto selection: which candidate rubric best
  reproduces known judgments) — an anti-drift step the generic Evolution agent has no concept of.
- It runs **at finalize** (per-task, the source experiment's "distill on accept" discipline) and the
  GEPA-style reflect→validate→commit can run **on-demand** across accumulated tasks.

The generic Evolution mechanism cannot express any of this. Forcing it through EvolutionConfig would
either neuter the method or smuggle palate-specific logic into the Evolution agent (a layering
violation). A **dynamic Workflow** owned by the mode is the right home — it is the agent driving a
scripted multi-step, multi-family process, which is exactly what the workflow engine is for.

**But EvolutionConfig is still declared — narrowly.** It targets ONLY the federated summary:

```
evolution: {
  directive: "Learn the user's writing voice and de-AI taste from session history. Maintain a
   concise, cross-mode summary of their voice signature (breathing/hedging habits, metaphor style,
   structural preferences) and the AI-symptoms they reject, suitable for OTHER modes to consult.
   Augment mode-palate.md with this summary. Do NOT touch the per-content-set taste/ artifacts —
   those are owned by palate's own distillation workflow."
}
```
This gives the Pneuma evolve dashboard a coherent, scoped job (keep the federated summary fresh from
history) while palate's own `distill` workflow owns the heavy per-project artifacts. Two mechanisms,
two scopes, no overlap.

**Distill workflow shape (`modes/palate/skill/workflows/distill.*`):** a Claude Code dynamic
workflow the agent launches at finalize (and the user can trigger via `good-enough`). Steps:
`gather` (read taste-profile + prefs.log + examples) → `reflect` (fan out ≥2 cross-family reflectors)
→ `validate` (Pareto-select against past verdicts) → `commit` (agent writes updated taste-profile.md
+ recipes/*, appends prefs.log.jsonl + swaps.jsonl). The workflow author MUST read
`cc-master:authoring-workflows` before writing it.

---

## 11. Alignment with / deviation from accepted ADRs & conventions

- **ALIGNS — thin-waist / contract-first:** palate introduces **zero new contracts**; it is a pure
  consumer of ViewerAction/Command/Address/Selection/Notification + the four source kinds. The
  signature features are the textbook use case the ViewerAddress contract was lifted for.
- **ALIGNS — no hardcoded mode knowledge in server/CLI:** everything mode-specific is in
  `manifest.ts` + skill. Cross-family is skill scripts, not server logic.
- **ALIGNS — backend isolation:** cross-family adds **no** backend conditional; it is not a backend.
  Single-backend startup-lock preserved.
- **ALIGNS — `manifest.ts` React-free:** React lives in `pneuma-mode.ts` + viewer; `domain.ts` is
  pure functions (kami precedent).
- **ALIGNS — contract-change propagation:** N/A — no `core/types/` change, so no
  `core/__tests__/` + `docs/reference/` + contracts-table change is owed. (If the team chooses the
  optional state-surface doc note in §6.2, that is a doc edit, not a contract change.)
- **ALIGNS — Bun APIs, English-only source, design tokens:** scripts use `Bun.spawn`; all
  source/comments/identifiers English; Chinese only in the worked-example seed (allowed exception).
- **ALIGNS — share scripts not skills (memory):** cross-family scripts are palate-owned (their
  guidance is palate-specific), not pushed to `_shared/`.
- **DEVIATION (defended) — action count > create-mode's 2–5 guideline:** justified in §4.2 (a rich
  direct-manipulation verb family on one address noun, none surfacing chrome). Not a hard rule.
- **NO ADR CONFLICT:** nothing here supersedes an accepted ADR. palate slots into the existing
  mode/contract/state architecture without amendment.

**Registration (Phase-3 checklist, three places — implementation MUST do all three):**
1. `core/mode-loader.ts` `builtinModes` map — add `palate` (loadManifest + loadModeDefinition).
2. `server/index.ts` `builtinNames` array — add `"palate"` (else absent from `/api/registry` gallery).
3. `CLAUDE.md`/`AGENTS.md` Builtin Modes line + README table — add `palate` (non-hidden).
Plus version-bump discipline if shipped in a release. **Not hidden** (`hidden` unset) — palate is a
user-pickable, featured-eligible mode (showcase highlights present).

---

## 12. Open questions + options + recommendation (all resolved with a chosen default)

Every item below is decided; listed so the implementation team sees the fork and the chosen branch.

1. **Block-id stability across heavy rewrites.** Options: (a) position+hash reconciliation in
   `domain.ts` [chosen], (b) embed HTML comment id markers in `draft.md`, (c) line ranges (doc-style).
   **Decision: (a)** — keeps `draft.md` clean (no marker pollution), survives reflow. Risk: a
   wholesale rewrite reassigns ids; mitigated by the `span.quote` re-anchor + the fact that a
   wholesale rewrite is *expected* to drop stale frozen/poke markers. Default acceptable.
2. **Direction popup latency.** Options: (a) static-default-then-agent-refine [chosen], (b)
   agent-only (laggy), (c) static-only (not taste-aware). **Decision: (a)** — §4.1.
3. **Draft write path.** Options: agent-Edit [chosen] vs. action-param-returns-text. **Decision:
   agent-Edit**, actions are signals (§5.4) — uniform with cross-family large rewrites.
4. **Taste dir scope.** Per-content-set [chosen] vs. shared. **Decision: per-content-set**, cross-
   project convergence via federated summary (§6.1).
5. **Orchestrator backend default.** **Decision: Claude Code default** (richest Task-subagent
   isolation for in-family generation), but `supportedBackends` unset so codex/kimi also orchestrate;
   cross-family degrades by available CLIs (§7.2).
6. **Worked-example seed language.** Keep Chinese [chosen] (seed-content exception) vs. translate.
   **Decision: keep** — the real artifacts are the teaching value (§8).
7. **mask "everything after here" semantics with frozen downstream blocks.** **Decision:** frozen
   downstream blocks are *skipped* by completion (passed as fixed context); the agent reflows only
   non-frozen blocks after the mask point. Kernel-freeze wins over mask scope.
8. **Twitter human-anchor harvester.** **Decision: deferred / not in v0.1.** Ship `anchors/` as an
   optional dir the agent can populate, but no harvester script + no UI — the source experiment marks
   its value unproven. Revisit only if evals confirm it.
9. **Showcase imagery.** **Decision: defer to `/showcase`** — ship `showcase.json` with tagline +
   3 highlight concept descriptions now (gallery copy present), generate images later.

**Tagline (for showcase.json):** "Write what fits your taste — a cross-family studio that de-AIs your
prose and learns your voice as you go." Highlights to brief: (1) span-select 5-direction rewrite popup,
(2) cross-family disruption ladder dial, (3) the living taste profile that sharpens per task.

---

## 13. Build order for the implementation team

1. **Contracts/manifest first** (`manifest.ts` + `domain.ts` + `pneuma-mode.ts`): sources, viewerApi
   actions/commands, init/seeds, evolution, agent block, cross-family scripts referenced. Typecheck
   against `core/types/mode-manifest.ts`. (taskKind: `contract`.)
2. **Skill** (`skill/SKILL.md` + scripts + `workflows/distill.*`): the rewritten orchestration
   playbook (methodology from the source SKILL.md, prose fresh), the ViewerAddress vocabulary
   sub-section, the cross-family script surface, the cold-start onboarding flow, the federation
   read/write protocol. (taskKind: `feature`.)
3. **Viewer** (`viewer/PalatePreview.tsx` + sub-components): three-zone studio, span-popup,
   per-block chrome, rung dial, taste panel. Fork DocPreview's selectable-markdown machinery. Run
   `/impeccable` craft pass + chrome-devtools-mcp visual verification. (taskKind: `viewer`.)
4. **Seeds** (`seed/{from-idea,from-draft,worked-example}/`): adapt the ezchan artifacts into
   `worked-example`. (taskKind: `feature`.)
5. **Register** (mode-loader + builtinNames + docs) + **showcase.json**. (taskKind: `feature`.)
6. **Tests:** `domain.ts` block-id reconciliation + load/save round-trip (the one fiddly invariant);
   manifest type-check; a cross-family-probe degradation test. (taskKind: `test-suite`.)
