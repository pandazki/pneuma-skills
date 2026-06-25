# Errand — Peer / Round-Trip Cross-Mode Handoff

> **Date**: 2026-06-25
> **Status**: DRAFT — design pass (build approved by user; this precedes implementation)
> **Author**: pneuma-architect (design authority)
> **Relationship to existing decisions**: *extends* the Smart Handoff tool-call protocol
> (`docs/archive/proposals/2026-04-28-handoff-tool-call.md`, Approved) — does **not** supersede it.
> **ADR**: Warranted. This introduces a new cross-cutting cross-mode primitive with a new disk
> state file and a new return-leg contract; it is hard to reverse once skills teach it. See §10.

---

## 0. Executive summary

Smart Handoff is a **goto**: source agent A calls `$PNEUMA_CLI handoff`, the user confirms, the
server kills A and spawns target B with A's context. Control never comes back.

An **errand** is a **subroutine call**: from inside a live session A, the agent calls
`$PNEUMA_CLI errand --mode <B> --brief <text>` (surfaced to the user as a `/errand <mode>` slash
affordance). The server spins up a **bounded, background sub-session** in mode B under the *same
project* (or a temp dir for quick sessions). A **stays alive and stays in the foreground** — it
is not killed. B does one bounded job, writes its deliverable(s) plus a structured
**`errand-result.json`** (artifact paths + change-notes), and signals completion. The server
delivers a `<pneuma:errand-returned>` synthetic message to A's chat **using the existing
queue-on-busy / flush-on-idle notification pipeline**, A reads B's `errand-result.json`, and
continues — applying the result to the host artifact on demand.

**The six load-bearing decisions:**

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Name** | **`errand`** (CLI verb + disk + tag namespace). Rationale §1. |
| 2 | **Return-leg contract** | New **`ErrandResult`** disk file `errand-result.json` written by B into the errand's session dir; a new `pneuma:errand` marker-block convention is **not** needed (see §4). A reads it via a pointer in the `<pneuma:errand-returned>` tag. **Not** an extension of `InboundHandoffPayload` (that's the *outbound/inbound* leg). |
| 3 | **Non-leaving mechanism** | Source A is **never killed**. B is a real project sub-session linked to A by a new **`ErrandLink`** in-memory record (server) + `errand` provenance fields persisted in B's `session.json`. On B completion, server pokes A via `sendUserMessage`-class injection, queued behind A's idle gate. |
| 4 | **Trigger** | New CLI verb `pneuma errand` (agent-invoked via `$PNEUMA_CLI`), POSTing to `/api/errands/dispatch` on **A's own per-session server**. The `/errand` user-facing affordance is a thin chat-tag (`<pneuma:request-errand>`) symmetric with `<pneuma:request-handoff>`. |
| 5 | **Placement** | Project session → B is a project session under `<projectRoot>/.pneuma/sessions/<errandId>/`, stamped `internal: true` + `errand` provenance so it's filtered from user-facing session lists. Quick session → B runs in an OS temp dir; result file copied back into A's reach. |
| 6 | **Host-artifact application** | **Default: return-a-diff/content, host applies.** B edits only files inside its *own* scratch reach and reports `produced` artifacts + `change_notes`; A is the sole writer of the host's canonical artifact. One opt-in escape hatch (`scope: "in-place"`) lets B edit a host file directly when the brief names it. Resolves the user's open question. §7. |

Contract changes owed: a new `core/types/errand.ts` (the `ErrandResult` + `ErrandDispatchPayload`
+ `ErrandLink` shapes), `core/__tests__/` coverage, a new `docs/reference/` subsection (or a short
new doc) on the errand round-trip, and a new row in the `AGENTS.md` contracts table. §9.

---

## 1. Problem & forces (in project terms)

**Need.** Pneuma's cross-mode machinery today has exactly one shape: a *terminal* handoff that
relocates the user from mode A to mode B. But many real tasks are **A delegates a bounded
sub-task to B and resumes** — the work's center of gravity stays in A. Webcraft has a finished,
styled page; only the prose needs the writing-taste treatment that lives in `wordtaste` (the
renamed `palate` mode). Webcraft wants polished copy **back**, then keeps owning the page.
Likewise webcraft wants a logo from `illustrate` and then *places* it. This is a subroutine
call, not a jump.

**Forces / quality attributes.**

- **Non-leaving is the whole point.** The host session must remain live and foreground. Anything
  that kills A (as Smart Handoff confirm does) is disqualified.
- **Single-backend lock (convention).** Backend is chosen at startup and locked for the session.
  B is a *separate session*, so it can have its own backend — but the natural default is to
  inherit A's backend (§5). No runtime backend switching is introduced.
- **Background, non-interruptive.** B runs without stealing the user's foreground. A must be
  *notified*, not *interrupted mid-turn* — Pneuma already has a pipeline for exactly this
  (viewer-notification queue-on-busy → flush-on-idle).
- **Bounded.** An errand is a scoped job with a deliverable, not an open-ended session. The
  contract must make "done" explicit (B signals completion), mirroring the lesson from the v1
  handoff rewrite ("no 'agent done' signal" was the root bug — §1 of the handoff proposal).
- **Disk is the source of truth.** The return-leg artifact rides a disk file, like
  `inbound-handoff.json`. In-memory link state is index/cache, reconstructable.
- **Composes with Background Mode.** On desktop, B should run in a hidden window and *not* reveal
  itself on completion (unlike a `pneuma://handoff`, which reveals) — the user's foreground is A.

**Decomposition check.** This is **one** capability (a round-trip delegated sub-task), not
several. But it has two clearly separable legs — the **dispatch leg** (A → spawn B with a brief)
and the **return leg** (B → notify A with a result). Design both edges deliberately; they are not
symmetric (dispatch is request-shaped, return is result-shaped).

### Naming — recommendation: `errand`

The orchestrator floated `errand`, `consult`, `excursion`, `delegate`, `borrow`, `sidequest`.
Criteria: (a) connotes *bounded + returns*, (b) reads well as a CLI verb and a `/cmd`, (c) distinct
from `handoff`, (d) doesn't imply the host *leaves* (rules out `excursion`/`sidequest`, which
connote the user going somewhere).

- **`errand`** — a short trip to fetch/do one thing and come back. Bounded ✓, returns ✓, verb ✓
  (`pneuma errand`), `/errand wordtaste` reads naturally ✓. **Recommended.**
- `consult` — good ("ask an expert, get advice back") but connotes *advice*, not *produced
  artifacts*; webcraft wants polished copy + a logo file, not opinions.
- `delegate` — accurate but generic; collides with general agent-delegation vocabulary (Task
  subagents), risking confusion about scope.
- `borrow` — "borrow mode B's skill" is evocative but awkward as a noun for the work unit.

**Decision: `errand`.** Namespaces: CLI `pneuma errand`; chat tags `<pneuma:request-errand>` /
`<pneuma:errand-returned>`; disk `errand-result.json`; route `/api/errands/*`; provenance field
`errand` on B's `session.json`. One residual risk: "errand" is informal; if product voice prefers
`consult`, the rename is mechanical (single namespace token) — flag as an open question (§11, OQ-1).

---

## 2. Layer placement

**Owner: Layer 1 (Runtime Shell) + Layer 4 (Mode Protocol skill surface), exactly mirroring
Smart Handoff.** It is a **cross-cutting, thin-waist** concern, not per-mode and not per-backend:

- It rides the same seams Smart Handoff already established: `$PNEUMA_CLI` agent-invocation,
  per-session-server routes, `inbound-handoff.json`-style disk payload, `launchPneumaChild`
  spawn, synthetic-message injection via the WS bridge, marker-block instruction assembly.
- **No mode knowledge** enters server/CLI: B's mode is data (`--mode <name>`), validated through
  `enumerateLocalModes` exactly as `handoff-from-external` does. Webcraft/wordtaste/illustrate
  appear nowhere in server code. (Hard rule: aligns.)
- **No backend branching.** B's backend is resolved through the existing
  `resolveWorkspaceBackendType` / `getDefaultBackendType` path; no `if (type === ...)`. (Hard
  rule: aligns.)
- **No React in `manifest.ts`.** No manifest changes are required at all for the MVP (§4) — the
  capability is project-level, available to every mode that runs in a project, taught by the
  shared `pneuma-project` skill. (Hard rule: aligns, trivially.)

This placement is the YAGNI-correct one: an errand is **not** a new mode capability that each
mode declares; it's a runtime affordance every project session inherits, same as handoff. We
*extend an existing seam* (the handoff family of signals) rather than invent a parallel one — the
2026-04-28 proposal's §0 explicitly tells us to add signal types to the one chat-tag injection
pipeline, not bespoke state machines per signal.

---

## 3. The protocol (round-trip)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Session A (webcraft) is live & foreground. User: "polish this copy in my voice"│
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │  (optional) user clicks /errand wordtaste →
                                     │  UI sendUserMessage("<pneuma:request-errand
                                     │     mode='wordtaste' />")   ── symmetric w/ handoff
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agent A prepares a bounded BRIEF per pneuma-project skill and calls:           │
│   $PNEUMA_CLI errand --mode wordtaste --json '{brief, inputs[], expects, scope}'│
│   → POST  A's-own-server /api/errands/dispatch                                 │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │  server:
                                     │   1. validate mode (enumerateLocalModes)
                                     │   2. mint errandId; resolve B's sessionDir (§5)
                                     │   3. write <Bdir>/.pneuma/errand-brief.json  (inbound)
                                     │   4. record ErrandLink{ errandId, hostSessionId=A,
                                     │        errandSessionId=B, state:"running" } (in-mem)
                                     │   5. launchPneumaChild(mode=B, project, sessionId=B,
                                     │        errand=<errandId>, background=true)
                                     │   6. CLI returns { errand_id, state:"running" } → A's Bash
                                     │      exits 0. A keeps talking to the user meanwhile.
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Session B (wordtaste) boots in BACKGROUND. Skill installer detects             │
│ errand-brief.json → fills a pneuma:handoff-style block ("You are running an    │
│ errand for <A>"). B's <pneuma:env reason="errand"> is dispatched IMMEDIATE      │
│ (like handed-off) so B starts without waiting for a user to type.              │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │  B does the bounded job: produces artifact(s)
                                     │  (its own preview/scratch reach), writes change-notes.
                                     │  When done, B calls:
                                     │    $PNEUMA_CLI errand-return --json '{produced[],
                                     │       change_notes, status:"completed"}'
                                     │    → POST B's-own-server /api/errands/return
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Server (B's per-session server == A's per-session server? NO — see §6.1):      │
│   1. write <Bdir>/errand-result.json (atomic)                                  │
│   2. relay completion to A's server via /api/errands/:id/notify (loopback POST)│
│   3. A's server flips ErrandLink → "completed", enqueues                       │
│      <pneuma:errand-returned errand_id=… mode=wordtaste                         │
│         result_path="<Bdir>/errand-result.json" status="completed" /> as a     │
│      QUEUED notification (flushes when A is idle — never mid-turn)              │
│   4. best-effort kill B's backend (errand is bounded; don't bill idle B)       │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agent A (on its next idle) sees <pneuma:errand-returned>, reads                │
│ errand-result.json (pointer-style), and on the USER's go-ahead applies the     │
│ change-notes / content to the host page. A is the writer of the host artifact. │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why this shape (vs alternatives):**

- **B is a real session, not a Task subagent inside A.** A Task subagent shares A's mode + skill
  + viewer; it cannot *be* wordtaste with wordtaste's skill, seed templates, and writing-taste
  viewer. The whole value is "run mode B's brain on a sub-task." So B must be a full Pneuma
  session. (This is the central architectural commitment.)
- **Completion is an explicit signal (`errand-return` CLI call), not an inference.** This directly
  applies the v1-handoff post-mortem lesson: never infer "agent done" from a file's appearance /
  mtime. B declares done.
- **The return notification is queued, not immediate.** It rides
  `session.pendingNotifications` (the viewer-notification pipeline, ws-bridge.ts ~L1591) so it
  flushes on A's idle — A is never interrupted mid-turn. Contrast the *dispatch/handoff* env tag
  which is `immediate` because the target was just spawned with nothing to do; here A is busy and
  must not be derailed.

---

## 4. Contract design

### 4.1 `ErrandDispatchPayload` (A → server, the brief)

The request the agent submits via `pneuma errand --json`. Deliberately a **superset-shaped sibling
of `InboundHandoffPayload`** but a distinct type — it carries errand-specific fields (`expects`,
`scope`) and omits handoff-terminal fields.

```
ErrandDispatchPayload {
  mode: string;                  // target sub-mode (validated; never branched on)
  brief: string;                 // REQUIRED. The bounded job, stated for B's first turn.
  inputs?: string[];             // host files/dirs B should read (read-only by default)
  expects?: string;             // what B must produce, in B's terms ("polished markdown +
                                 //   a change-notes list mapping each edit to a rationale")
  scope?: "return" | "in-place"; // §7. default "return"
  in_place_targets?: string[];   // only meaningful when scope="in-place": host files B may edit
  summary?: string;              // optional context (reuses the handoff vocabulary)
  language?: string;             // source-conversation language, same semantics as handoff
}
```

Invariants: `mode` + `brief` required; `in_place_targets` ignored unless `scope="in-place"`;
`inputs`/`in_place_targets` must resolve **inside the project root** (traversal guard, mirroring
`/api/contentsets/delete`'s `_`-prefix + traversal guards).

### 4.2 `ErrandResult` (B → disk → A, the return leg) — **the new return-leg contract**

Written by B into `<Bdir>/errand-result.json`. This is the artifact A reads.

```
ErrandResult {
  errand_id: string;
  mode: string;                  // who ran the errand
  status: "completed" | "failed" | "partial";
  produced: Array<{              // the deliverables
    path: string;                // ABSOLUTE path B wrote (in B's reach or, if in-place, host file)
    kind?: string;               // "markdown" | "image" | "json" | … (advisory, for A + UI)
    role?: string;               // semantic role in B's terms ("polished-copy", "logo")
  }>;
  change_notes: string;          // human+agent-readable: WHAT changed and WHY, in B's voice.
                                 //   For wordtaste: a per-section map of original→revised + rationale.
  applied_in_place?: string[];   // host files B edited directly (only when scope was "in-place")
  open_questions?: string[];     // anything B couldn't resolve, bubbled back to A/user
  produced_at: number;
}
```

**Ownership of state.** B is the *sole writer* of `errand-result.json` and of everything under
`<Bdir>`. A is the *sole writer* of the host's canonical artifact (the page). The server owns the
`ErrandLink` lifecycle and the brief file. This clean writer-ownership split is what makes the
default "return-a-diff, host applies" model safe (§7).

### 4.3 `ErrandLink` (server, in-memory link record)

```
ErrandLink {
  errand_id: string;
  host_session_id: string;       // A
  errand_session_id: string;     // B
  mode: string;
  project_root?: string;         // present for project sessions; absent for quick (temp dir)
  errand_dir: string;            // absolute <Bdir>
  state: "running" | "completed" | "failed" | "cancelled" | "timed_out";
  dispatched_at: number;
}
```

Held in a `Map<errand_id, ErrandLink>` on A's per-session server, **exactly like
`Map<handoff_id, HandoffProposal>`** in `handoff-routes.ts`, with the same TTL-prune janitor
(longer TTL — an errand may legitimately run many minutes; recommend 60 min, configurable). Disk
is truth; this map is reconstructable from B's `session.json` provenance + `errand-result.json` on
restart (a server restart mid-errand degrades gracefully: A still finds the result on disk via the
pointer once B finishes, even if the live notification is lost — see §8 resume).

### 4.4 Why **not** a new `manifest.ts` field or a new marker block

- **No manifest field.** An errand is available to *every* project session regardless of mode; it
  is not a declared per-mode capability. Adding `manifest.errand` would be YAGNI and would put
  mode knowledge where it doesn't belong. (If, later, a mode wants to *forbid* being run as an
  errand target, that's a one-line `manifest.errandable?: boolean` — defer until a real need.)
- **Reuse the `pneuma:handoff` marker block for B's inbound brief.** B receiving an errand-brief
  is structurally identical to B receiving an inbound handoff: a system briefing in B's
  instructions file telling it what to do and what context it has. We **reuse**
  `buildHandoffSection` / the `pneuma:handoff` block, fed from `errand-brief.json` (which is an
  `InboundHandoffPayload`-shaped file with an added `errand_id` + `expects` + `return_via`). This
  avoids a parallel marker block — extend the existing seam. The skill teaches B to look for the
  `errand_id`/`return_via` fields and, when present, call `errand-return` instead of treating it
  as a terminal handoff. (Decision §4.4-a, recommended; alternative in §11 OQ-2.)

---

## 5. Instantiation & consumption plan (the contract triple)

### `ErrandDispatchPayload` / `ErrandResult` / `ErrandLink` — defined in `core/types/errand.ts` (new)

| Edge | Where |
|------|-------|
| **Defined** | `core/types/errand.ts` (new) — pure types + `isErrandResult` guard, mirroring `isProjectManifest`. No React, no server imports beyond type-only. |
| **Instantiated (dispatch)** | `pneuma errand` CLI (new `bin/errand-cli.ts`, pure handler + IO surface mirroring `bin/handoff-from-external-cli.ts`) builds `ErrandDispatchPayload`; POSTs to `/api/errands/dispatch`. |
| **Instantiated (brief on disk)** | `/api/errands/dispatch` (new `server/errand-routes.ts`) writes `<Bdir>/.pneuma/errand-brief.json` (atomic tmp+rename, before spawn — same invariant as inbound-handoff). |
| **Instantiated (result on disk)** | `pneuma errand-return` CLI (B-side) → `/api/errands/return` writes `<Bdir>/errand-result.json` (atomic). |
| **Instantiated (link)** | `server/errand-routes.ts` creates `ErrandLink` in the per-session `Map`. |
| **Consumed (brief → B's instructions)** | `server/skill-installer.ts::readInboundHandoff` + `buildHandoffSection` — **extended** to also recognize `errand-brief.json` and surface `errand_id`/`expects`/`return_via`. |
| **Consumed (B start signal)** | `bin/env-tag.ts::buildEnvTag` — **extended** with a `reason="errand"` branch (or reuse `handed-off` with an `errand_id` attr; recommend a distinct `reason="errand"` so the skill can teach the return obligation). Dispatched `immediate` like handed-off. |
| **Consumed (return → A)** | `server/errand-routes.ts` enqueues `<pneuma:errand-returned>` via `wsBridge` queued-notification path; A's agent reads `errand-result.json`. |
| **Consumed (UI)** | A new lightweight `ErrandCard` / chat affordance renders the running/returned errand in A's chat, symmetric with `HandoffCard`. Optional for MVP (the chat tag is enough); recommend a minimal status chip. |

### Spawn seam — `launchPneumaChild` (extended)

Add optional fields to the existing `launchPneumaChild` params (no new spawn path — reuse the
single seam, per server.md "new consumers should go through this helper"):

- `errandId?: string` → threaded to the child as `--errand <id>` so B's `session.json` gets
  `errand` provenance and the env-tag dispatcher knows to emit `reason="errand"`.
- `background?: boolean` → desktop hint (the child URL gets the existing `&background=1`-style
  treatment; **not revealed** on completion — see §6.2).

`bin/pneuma.ts` reads `--errand`, stores it in startup context, writes it into `session.json`
(`{ errand: { errandId, hostSessionId, role:"errand-target" } }`), and stamps the session
`internal: true` for `scanProjectSessions` filtering (so B never pollutes Recent Sessions /
ProjectPanel — same mechanism hidden internal modes use).

---

## 6. Cross-layer integration flows

### 6.1 Which server? (the two-server reality)

Each Pneuma session runs **its own** per-session server on its own port (per network-topology +
the handoff proposal §3.7). So A and B have **different servers**. The dispatch POST goes to A's
server (`$PNEUMA_SERVER_URL` in A's agent env = A's port). The return POST goes to B's server
(`$PNEUMA_SERVER_URL` in B's env = B's port).

**The link must cross servers.** Two relay options:

- **(R1) B's server loopback-POSTs A's server** at `/api/errands/:id/notify` (A's URL passed to B
  via the brief's `return_via` field = `host_server_url`). A's server then enqueues the chat tag
  to A's live agent. **Recommended** — keeps the notification logic where A's WS bridge lives, and
  the loopback is localhost-only.
- (R2) Route everything through the launcher. Rejected: the launcher has no agent session and
  `broadcastAll` can't reach a per-session agent (server.md gotcha: "Launcher 没 agent session,
  WS 广播到不了"). A's *own* server is the only thing that can poke A's agent.

So: brief carries `return_via: { errand_id, host_server_url }`. B's `errand-return` CLI knows
both. **Residual risk:** if A's server has died (A's window closed) when B returns, the loopback
fails — handled by §8 (B still wrote `errand-result.json`; A picks it up on next resume via the
provenance link).

### 6.2 Desktop Background Mode composition

B is spawned with the background hint. On desktop this means B runs in a hidden `BrowserWindow`
(the existing Background Mode machinery). **Critical difference from `pneuma://handoff`:** an
errand must **NOT** reveal B's window on its `running → idle` transition — the user's foreground
is A, and revealing B would yank them away from the very session that's still in charge. The
reveal trigger (`background-sessions.ts`, first `running → idle` → `revealModeWindow`) must be
**suppressed for errand sessions**. Mechanism: the background hint for an errand carries a
`reveal: false` flavor (or the renderer's `useBackgroundStatusReporter` reads B's `errand`
provenance and skips reveal). The signal that matters to the user is the
`<pneuma:errand-returned>` tag landing in A's chat (plus an optional system Notification), not B's
window appearing. (Decision §6.2, recommended. This is a desktop-presentation-layer change only;
server is unaffected — consistent with the Background Mode design's "服务端零改动" principle.)

On web (no Electron), B simply runs as a backgrounded session the user can navigate to via a chip
if they want to watch; nothing reveals automatically. Graceful degradation, no special path.

### 6.3 Notification injection (the non-interruptive poke)

A's server enqueues the `<pneuma:errand-returned>` tag through the **same queue that viewer
notifications use** (`session.pendingNotifications`, flushed on idle in `ws-bridge.ts`). If A is
mid-turn, it queues; when A goes idle, it flushes as a system/user message. This guarantees
non-interruption — the exact property the user asked for ("B does its job; control RETURNS to A").

If A is *already idle* when B returns, the tag dispatches immediately (the queue's flush-now
branch). Either way A sees it at a safe boundary.

### 6.4 File-watch + origin stamping

When A applies B's returned content to the host page (default `scope:"return"`), A edits via its
own Write/Edit tools → chokidar fires with `origin:"self"` (A's `pendingSelfWrites`) → A's webcraft
viewer re-renders the page. **No new file-watch wiring** — the host edit is an ordinary A edit. In
the `scope:"in-place"` case (§7), B edits a host file directly; chokidar fires in *A's* watcher
with `origin:"external"` (B is a different process A didn't stamp), so A's viewer live-updates and
A sees the change as external — which is correct (B is, to A, an external collaborator). The
`change_notes` in `errand-result.json` are what let A reason about *what* changed.

---

## 7. Host-artifact application — resolving the user's open question

> *"Who edits the real page? Does the sub-mode edit the host artifact directly, or return a diff
> for the host mode to apply?"*

**Default recommendation: `scope: "return"` — B returns content + change-notes; A applies.**

Rationale, in priority order:

1. **Clean writer ownership.** A owns the host artifact; B owns its scratch + result file. No two
   processes write the same file. This is the near-decomposability principle and it eliminates the
   entire class of concurrent-write / lost-update bugs.
2. **The host knows its medium; the errand knows its craft.** The user's own example nails it: an
   ink-wash (水墨) site wants the polished copy to *also feel* 中国风, and the page is more than
   text (layout, image intent, tone must stay unified). **wordtaste** is the writing-taste expert;
   it should produce *the best prose in the user's voice* and explain its choices. **webcraft** is
   the only thing that understands the page's DOM, the 水墨 visual language, and how copy length
   interacts with layout. So webcraft must be the one to weave the polished copy back in — possibly
   adjusting it to fit, possibly nudging an image to match the now-more-中国风 tone. Returning
   content + notes preserves this division of expertise; letting wordtaste reach into the page's
   markup/JSX would force a writing-mode to understand a web-mode's medium. That coupling is
   exactly what the layer boundaries exist to prevent.
3. **Reviewability.** The user can see B's `change_notes` and A's application as two visible steps,
   and intervene between them ("actually keep the original headline"). A direct in-place edit
   collapses that into one opaque mutation.

**Escape hatch: `scope: "in-place"`.** When the host agent's brief explicitly names host files
B may edit (`in_place_targets`), and the medium is one B genuinely owns (e.g. an errand to
`illustrate` to *regenerate* an existing logo file in place, or a pure-markdown host where
wordtaste editing the `.md` directly is lossless), B may write those files directly and list them
in `applied_in_place`. This is opt-in, brief-scoped, and traversal-guarded to the project root.
A still gets the `change_notes` and can review/revert via shadow-git checkpoints.

**Default for the driving scenarios:**
- webcraft → wordtaste (styled page, copy polish): **`return`**. wordtaste previews/returns
  polished markdown + per-section change-notes; webcraft places it, adapting to the 水墨 layout.
  This is precisely the user's unification concern, answered.
- webcraft → illustrate (logo): **`return`**. illustrate produces the logo file in its own reach
  and returns the path + a note ("transparent PNG, 512², warm-orange mark"); webcraft places it in
  the page. (If the user later wants "regenerate the logo that's already at `assets/logo.png`",
  that's the `in-place` case.)

---

## 8. State & lifecycle design

### Disk surface additions (extends `controlled-state-surface.md`)

| Path | Meaning | Owner | Lifecycle |
|------|---------|-------|-----------|
| `<Bdir>/.pneuma/errand-brief.json` | The dispatch brief (`InboundHandoffPayload`-shaped + `errand_id`/`expects`/`return_via`) | A's server (`/api/errands/dispatch`) → B's agent | Written atomically before B spawns; B reads first turn, `rm`s after consuming (same discipline as inbound-handoff). |
| `<Bdir>/errand-result.json` | `ErrandResult` — the return leg | B's agent (via `/api/errands/return`) | Written when B finishes; A reads via pointer; persists as audit residue (not auto-deleted — A may re-read on resume). |
| `<Bdir>/session.json` `.errand` field | Provenance: `{ errandId, hostSessionId, role }` + session stamped `internal:true` | `bin/pneuma.ts` startup | Written at B's session start; immutable. |

- **Project session:** `<Bdir> = <projectRoot>/.pneuma/sessions/<errandId>/`. B is a normal project
  session, just internal+errand-stamped. It shares the project's `preferences/`, `project-atlas.md`,
  and shadow-git-per-session machinery — all free.
- **Quick session (no project):** A is a bare workspace. B runs in an **OS temp dir**
  (`<tmp>/pneuma-errand-<errandId>/`), and `errand-result.json`'s `produced[]` paths point into
  that temp dir. A copies the deliverables it wants into its own workspace when applying (A is the
  writer). The temp dir is best-effort cleaned after A acknowledges, or left for the OS to reap.
  (Decision: temp-dir for quick, per the user's spec. Residual risk: temp dirs leak if A never
  acknowledges — mitigated by a max-age sweep; OQ-3.)

### Resume / replay / handoff survival

- **Server restart mid-errand.** `ErrandLink` (in-memory) is lost, but B's `session.json` carries
  the `errand` provenance and B still writes `errand-result.json` on completion. On A's next start,
  the server scans A's project for errand sessions whose `host_session_id == A` with a result file
  and re-enqueues the `<pneuma:errand-returned>` pointer (a boot-time reconcile, mirroring how the
  Running-Session registry reconciles dead PIDs). So a crash degrades to "A finds out when it next
  opens," not "result lost." (Disk is truth — satisfies the controlled-state-surface invariant.)
- **A resumed later.** Same path: errand results sit on disk under the project; the reconcile
  surfaces any unacknowledged ones.
- **Replay.** The `<pneuma:request-errand>` and `<pneuma:errand-returned>` tags live in A's
  `history.json` like any synthetic message, so replay reconstructs the narrative (tags are
  informational text; replay doesn't re-spawn B). `errand-brief.json`/`errand-result.json` are
  session-state files, not workspace deliverables, so they're excluded from shadow-git per the
  topology-derived exclude rules (must be added to `buildExcludeRules` for project sessions — see
  server.md shadow-git self-reference trap; treat `errand-*.json` like other plumbing).
- **Errand → handoff interaction.** An errand does not kill A, so the existing single-pending-
  handoff-per-source guard is untouched. A may have a pending handoff AND a running errand
  simultaneously — they're orthogonal maps. (No new coordination cost.)

### Lifecycle steps touched

resolve(B's mode) → load(B's manifest) → session(mint B under project/temp) → **skill install
(B gets errand-brief in `pneuma:handoff` block)** → server(B's per-session server) → backend(B
inherits A's backend by default) → frontend(B in hidden window on desktop, no reveal). The return
leg adds a *new* lifecycle micro-step: **errand-return → A-notify-reconcile**.

---

## 9. Contract changes owed (the propagation the hard rule demands)

A change touching `core/types/` must reach all four artifacts. This design adds a new contract, so:

1. **`core/types/errand.ts`** (new) — `ErrandDispatchPayload`, `ErrandResult`, `ErrandLink`,
   `isErrandResult` guard. (Plus a tiny extension to `InboundHandoffPayload` in skill-installer to
   carry `errand_id`/`expects`/`return_via` when the inbound file is an errand brief — or a thin
   `ErrandBriefPayload extends InboundHandoffPayload` to keep the handoff type clean.)
2. **`core/__tests__/errand.test.ts`** (new) — type guard + the pure CLI handlers
   (`bin/__tests__/errand-cli.test.ts`, mirroring `handoff-from-external-cli.test.ts`) + route
   tests (`server/__tests__/errand-routes.test.ts`, mirroring `handoff-routes.test.ts`: dispatch
   writes brief before spawn, idempotent return, TTL prune, supersede semantics if A re-dispatches
   the same errand).
3. **`docs/reference/`** — add an "Errand round-trip" subsection to `controlled-state-surface.md`
   (the disk-surface rows in §8) and a short flow section (mirroring the Handoff 数据流 diagram).
   Consider a dedicated `docs/reference/errand-protocol.md` if the round-trip warrants its own page
   — recommend folding into the existing handoff/state docs to avoid doc sprawl (OQ-4).
4. **`AGENTS.md` contracts table** — new row: **`ErrandDispatchPayload` + `ErrandResult` +
   `ErrandLink`** | defined `core/types/errand.ts` | instantiated `bin/errand-cli.ts` +
   `server/errand-routes.ts` | consumed by `server/skill-installer.ts` (brief→block),
   `bin/env-tag.ts` (`reason="errand"`), `server/ws-bridge.ts` (queued return tag),
   `pneuma-project` skill. Plus a short "Errand (round-trip handoff)" prose section under the
   cross-mode area, and a Communication-section line for the `<pneuma:request-errand>` /
   `<pneuma:errand-returned>` tags.

Skill surface (Layer 4, not a `core/types` contract but owed): extend
`modes/_shared/skills/pneuma-project/SKILL.md` with an **"Errands — delegating a bounded sub-task"**
section teaching both sides — emitting (`$PNEUMA_CLI errand`, when to use vs handoff, how to write
a bounded brief, default `scope:"return"`) and receiving (recognize the errand brief, do the
bounded job, call `$PNEUMA_CLI errand-return`, don't treat it as a terminal handoff). This is the
semantic layer that makes the disk contract usable, per the controlled-state-surface principle
"Skill 是状态的语义层."

---

## 10. ADR-worthy decisions (drafted thinking — human ratifies)

**ADR candidate: "Errand — peer/round-trip cross-mode delegation."** Warranted because it is
cross-cutting and hard to reverse once skills teach agents the `$PNEUMA_CLI errand` /
`errand-return` contract and modes start relying on it.

- **Decision D1 — Errand is a distinct primitive alongside Smart Handoff, not a mode of it.**
  - *Alternatives*: (a) add a `return: true` flag to the existing handoff (so confirm doesn't kill
    source). Rejected: handoff's whole UX is "review card → one confirm → switch"; bolting a
    non-leaving return-leg onto it muddies a clean, shipped contract and the skill guidance. (b)
    Generalize both into one "cross-mode invocation" supertype now. Rejected as premature
    abstraction (YAGNI) — ship two concrete siblings, extract the supertype if a third appears.
  - *Consequence*: two clear verbs (`handoff` = goto, `errand` = call). The skill teaches the
    distinction explicitly. Slightly more surface area; much clearer mental model.

- **Decision D2 — Return leg is a disk file + queued chat tag, not a synchronous response.**
  - *Alternatives*: A's `pneuma errand` CLI blocks until B finishes and returns the result inline.
    Rejected: B may run minutes; blocking A's agent turn is hostile and breaks the "A stays live"
    requirement; also fragile across the two-server boundary.
  - *Consequence*: asynchronous, non-interruptive, crash-survivable (disk is truth). Costs one
    reconcile-on-boot path.

- **Decision D3 — Default `scope:"return"` (host applies), with opt-in `in-place`.**
  - *Alternatives*: always in-place (B edits host files). Rejected: cross-medium coupling + concurrent
    writes; violates layer boundaries (writing-mode editing a web-mode's artifact).
  - *Consequence*: preserves the division of expertise the user's 水墨 example demands; two visible,
    reviewable steps; opt-in escape hatch for the lossless cases.

- **Decision D4 — B inherits A's backend by default; backend lock unviolated.**
  - *Alternative*: let the brief pick B's backend. Defer — adds a knob nobody asked for; the
    startup-lock convention is per-session and B is a new session, so inheriting A's is the least-
    surprise default. (Revisit only if a mode is backend-specific.)

---

## 11. Open questions + options + recommendations

- **OQ-1 — Final name.** `errand` (recommended) vs `consult`. *Recommendation:* ship `errand`;
  it's a single-token rename if product voice later prefers `consult`. **Needs the user's call
  before code, since it bakes into CLI verb + tags + disk + docs.**

- **OQ-2 — Reuse `pneuma:handoff` block for B's inbound brief, or new `pneuma:errand` block?**
  *Options:* (a, recommended) reuse — extend `buildHandoffSection` with errand awareness (fewest
  moving parts, one marker block). (b) new `pneuma:errand` block — cleaner separation, but a new
  marker-block reader/writer domain to maintain. *Recommendation:* (a) for MVP; promote to (b) only
  if the briefs diverge materially.

- **OQ-3 — Quick-session temp-dir cleanup policy.** *Options:* clean on A's acknowledge / max-age
  sweep / never (OS reaps). *Recommendation:* max-age sweep at launcher boot (e.g. errand temp
  dirs older than 24h), since "A acknowledges" isn't guaranteed.

- **OQ-4 — Dedicated `docs/reference/errand-protocol.md` vs folding into existing docs.**
  *Recommendation:* fold into `controlled-state-surface.md` + a Communication-section blurb;
  revisit if the protocol grows.

- **OQ-5 — Concurrency: multiple errands in flight from one A?** The `Map<errand_id, ErrandLink>`
  supports N, and each B is its own session/dir. *Recommendation:* allow N (no single-flight cap,
  unlike handoff which is single-pending) — errands are additive sub-tasks, not mutually exclusive
  intents. Cap at a small N (e.g. 3 concurrent) to bound resource use. Confirm with user.

- **OQ-6 — Should B see A's chat/transcript?** Handoff supports `source_transcript`. An errand brief
  *could* include it, but the bounded-job framing argues for *less* context, not more — B should
  get a tight brief + named inputs, not A's whole conversation. *Recommendation:* omit transcript
  by default; let the agent include a `summary` if needed. Keeps errands cheap and focused.

- **OQ-7 — UI surface for a running errand in A.** A status chip ("wordtaste errand running…")
  plus a "returned" affordance, symmetric with `HandoffCard`? *Recommendation:* minimal chip for
  MVP; the chat tags carry the protocol. Full `ErrandCard` is a fast-follow if users want to watch
  B's progress.

---

## 12. Alignment summary

- **Aligns with** the 2026-04-28 handoff tool-call proposal §0 ("user/agent behaviors → one
  chat-tag injection pipeline; don't add bespoke state machines per signal"): errand adds two new
  signal types (`request-errand`, `errand-returned`) to the existing pipeline.
- **Aligns with** the controlled-state-surface invariants (disk is truth; pointer-over-inline for
  the result; marker-block assembly reused; skill as the semantic layer).
- **Aligns with** all three hard rules (no mode knowledge in server/CLI; no backend branching; no
  React in manifest — no manifest change at all for MVP).
- **Aligns with** the single-backend-lock convention (B is a new session; inherits A's backend).
- **Extends, does not supersede,** the Smart Handoff ADR. **Does not contradict** any accepted ADR.
- **New coordination cost introduced** (justified, not incidental): the cross-server return relay
  (§6.1 R1) and the boot-reconcile path (§8). Both are the minimum needed for non-interruptive,
  crash-survivable round-trip; both reuse existing patterns (loopback POST; PID/registry reconcile).

---

## 13. Blind spots / assumptions stated honestly

- I did not read `server/background-sessions.ts` (desktop) or the renderer's
  `useBackgroundStatusReporter` directly — §6.2's "suppress reveal for errand sessions" assumes the
  reveal trigger keys off session identity reachable from provenance. **If reveal is hardwired to
  any first `running→idle` with no per-session opt-out, that hook needs a small extension** — verify
  in `desktop/src/main/background-sessions.ts` before implementing.
- I confirmed the queue-on-busy / flush-on-idle pipeline exists for viewer notifications
  (ws-bridge.ts ~L1582–1625) but did not trace whether a *non-viewer* synthetic tag can ride the
  same `pendingNotifications` queue verbatim or needs a sibling queue. **Verify the queue accepts an
  arbitrary system tag, or add a `pendingSystemSignals` sibling with the same flush gate.**
- The `internal: true` stamping for `scanProjectSessions` filtering is described in AGENTS.md but I
  did not read `scanProjectSessions` to confirm an errand session (internal mode-agnostic) is
  filtered the same way a hidden-*mode* session is. **Verify the filter keys on a session field, not
  only on the mode's `hidden` flag** — if it only checks mode-hidden, add an `internal`/`errand`
  session-level check.
- Two-server topology (§6.1) assumes each session has its own server with `$PNEUMA_SERVER_URL` set
  to its own port (stated in handoff proposal §3.7). If a future consolidation puts multiple
  sessions behind one server, the loopback relay simplifies to an in-process call — design still
  holds, relay just gets cheaper.
