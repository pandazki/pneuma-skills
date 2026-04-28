# Pneuma Handoff — Tool-Call Protocol Rewrite

> **Date**: 2026-04-28
> **Status**: Approved (replaces the v1 file-mediated protocol)
> **Decided by**: Pandazki
> **Supersedes**: the file-write + chokidar handoff protocol shipped in commits `e03509e` … `d48af65`.

---

## 1. Why a rewrite

The v1 handoff protocol had the source agent write a markdown file to `<projectRoot>/.pneuma/handoffs/<id>.md`, which a chokidar watcher detected, the UI rendered as a `HandoffCard`, and the user confirmed to trigger the actual switch. It worked, but the architecture was implicitly signal-based:

1. **No "agent done" signal.** The system inferred completion from "a file appeared". Any later mtime touch (partial write retry, OS metadata blip, agent reading the file back) re-fired `change` events that the UI mapped back into "new handoff arrived". The result was a duplicate-spawn loop on user confirmation.

2. **Two user confirmations.** The user confirmed Smart Handoff once (to dispatch the request to the agent), then confirmed again on the HandoffCard (to actually switch). The user's mental model is one Confirm.

3. **Payload-by-disk.** The handoff content lived in a file on disk, read at target-boot time by the skill installer. Server-side delete-on-confirm raced the boot, so the file had to linger; lingering files re-fired watcher events, etc.

4. **Implicit framing in the skill.** The v1 skill said "use the Write tool to drop a markdown file" — agents understood this as plumbing, not as a structured system call. The structure of the handoff (intent, summary, decisions, files, questions) wasn't enforced; agents would freelance the markdown body.

The fix is to make the protocol **explicit, tool-call-mediated, and one-confirm**: the agent calls a system function `pneuma handoff` with structured JSON, the system shows the user a final review card, and one click executes the switch — or one Cancel returns context to the source agent so the conversation continues.

---

## 2. The new protocol

```
┌─────────────────────────────────────────────────────────────────────────┐
│ User in session A clicks Smart Handoff in ProjectPanel, types intent    │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           │  sendUserMessage("<pneuma:request-handoff …/>")
                           │  (closes the panel; no second UI confirm yet)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Source agent A reads the tag, prepares structured handoff per its       │
│ pneuma-project skill: intent, summary, suggested_files, decisions, qs   │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           │  Bash: pneuma handoff --json '{...}'
                           │  CLI POSTs to $PNEUMA_SERVER_URL/api/handoffs/emit
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Server receives payload, validates, broadcasts WS `handoff_proposed`    │
│ event to the active session's browser. Agent's Bash returns "ok".       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           │  HandoffCard renders with the structured payload
                           │  (intent / summary / files / decisions / questions)
                           ▼
                    ┌──────┴──────┐
                    │             │
                    ▼             ▼
        ┌───────────────┐   ┌───────────────────┐
        │ User Confirms │   │ User Cancels      │
        └───────┬───────┘   └─────────┬─────────┘
                │                     │
                │                     │  POST /api/handoffs/cancel
                │                     │  Server: emit "<pneuma:handoff-cancelled
                │                     │   reason="…" />" to source agent A's chat
                │                     │  Source agent continues conversation
                │                     │  naturally; handoff state cleared.
                │                     ▼
                │              [conversation continues in A]
                │
                │  POST /api/handoffs/confirm
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Server:                                                                 │
│  1. Kill source A (best-effort)                                         │
│  2. Decide target session id (existing or fresh UUID)                   │
│  3. Write payload to <targetSessionDir>/.pneuma/inbound-handoff.json    │
│     BEFORE spawning the target agent                                    │
│  4. Spawn target B as a project session                                 │
│  5. Return { launchUrl } to UI; UI navigates                            │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Target B boots. Skill installer detects inbound-handoff.json, reads it, │
│ formats the structured fields into the CLAUDE.md `pneuma:handoff` block.│
│ Target agent reads CLAUDE.md, follows pneuma-project skill receive-side │
│ guidance, and rms inbound-handoff.json after consuming.                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Key shifts vs v1:

- **One user click**: Smart Handoff Confirm dispatches the chat tag and closes the panel. The HandoffCard is the *only* further confirmation.
- **Explicit agent signal**: agent calls `pneuma handoff` (a real CLI invocation), not "writes a file and hopes". The CLI exits 0 only when the server has accepted the payload.
- **Structured payload**: JSON, not markdown frontmatter. The skill defines the schema; the CLI validates required fields.
- **Payload as launch input**: written to `inbound-handoff.json` before target spawn. No race with watcher events.
- **Cancel returns context**: source agent gets `<pneuma:handoff-cancelled />` so the conversation has a graceful continuation point.

---

## 3. Components to build

### 3.1 `pneuma handoff` CLI subcommand

**File**: `bin/pneuma.ts` (or a new `bin/handoff-emit.ts`).

**Invocation**:
```bash
pneuma handoff --json '<json>'
# or
echo '<json>' | pneuma handoff --stdin
```

**Behavior**:
1. Read JSON payload from `--json <inline>` or stdin.
2. Validate: `target_mode` non-empty string; `intent` non-empty string. Warn (don't fail) on missing recommended fields. Reject extra fields not in the schema.
3. POST to `${PNEUMA_SERVER_URL}/api/handoffs/emit` (env var must be set; server sets it on agent spawn).
4. Server response shapes the exit:
   - 200 → exit 0, print `Handoff submitted; awaiting user confirmation.` to stdout.
   - 4xx → exit non-zero, print server's `error` field to stderr.
   - Network error → exit non-zero with the error.
5. **No retry loop**. The agent's role is single-shot; if it fails, the agent should incorporate the error into its conversation and let the user decide.

**Env vars consumed**:
- `PNEUMA_SERVER_URL` — required. Server sets this on agent spawn (e.g. `http://localhost:17007`).
- `PNEUMA_SESSION_ID` — required. The source session id (already injected today).

The CLI sends `source_session_id` to the server as part of the payload (or as a separate header). The server uses it to know which session's browser to broadcast `handoff_proposed` to.

### 3.2 Server endpoint `POST /api/handoffs/emit`

**File**: `server/handoff-routes.ts` (new), mounted alongside `mountProjectsRoutes`.

**Request body**:
```typescript
interface HandoffEmitBody {
  source_session_id: string;       // who's emitting
  target_mode: string;
  target_session?: string;         // existing id or "auto"/undefined for fresh
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
}
```

**Behavior**:
1. Validate fields.
2. Generate a `handoff_id` (UUID) server-side; the agent doesn't pick one.
3. Store the proposal in an in-memory `Map<handoff_id, HandoffProposal>` keyed by id, with state `pending`.
4. Broadcast WS `handoff_proposed` to the source session's browser:
   ```typescript
   {
     type: "handoff_proposed",
     handoff_id: string,
     payload: HandoffEmitBody,
     proposed_at: number,
   }
   ```
5. Return `{ handoff_id, status: "proposed" }` to the agent CLI.

**State machine**: each handoff_id has one of `pending → confirmed | cancelled | timed_out`. Pending proposals expire after some window (e.g. 30 minutes) — the in-memory map prunes them on a timer; if the user comes back later, they need to re-trigger.

**Single-flight guard**: only one `pending` handoff per source session at a time. A second `emit` from the same source while a `pending` exists either supersedes (replace + cancel old) or rejects with 409. Pick **supersede** — agents may legitimately revise.

### 3.3 Server endpoint `POST /api/handoffs/:id/confirm`

**Replaces** the v1 confirm endpoint (similar shape, new internals).

**Behavior**:
1. Look up proposal in the in-memory map. If not `pending`, return appropriate error (404 if unknown, 409 if already confirmed/cancelled).
2. Mark `confirmed` (atomic swap; no other request can race past).
3. Resolve target session id: if `target_session` is set and not `"auto"`, use it; otherwise generate fresh UUID.
4. Resolve target session dir: `<projectRoot>/.pneuma/sessions/<targetSessionId>/`. Create it if not present.
5. Write `<targetSessionDir>/.pneuma/inbound-handoff.json` with the structured payload before spawning. Atomic: write to `inbound-handoff.json.tmp` and rename.
6. Kill source session (best-effort, via the existing `killSession` callback).
7. Append `switched_out` event to source `history.json` (existing behavior).
8. Spawn target via the existing `launchSession` callback, passing `mode = target_mode`, `project = projectRoot`, `sessionId = targetSessionId`.
9. Return `{ launchUrl, target_session_id, handoff_id }`.

**Key invariant**: the inbound payload file is written **before** the target spawns. There's no race with the target's skill installer because the file is guaranteed to be there.

### 3.4 Server endpoint `POST /api/handoffs/:id/cancel`

**Replaces** the v1 cancel endpoint.

**Body**:
```typescript
{ reason?: string }  // optional user-provided reason
```

**Behavior**:
1. Look up proposal. If not `pending`, return appropriate error.
2. Mark `cancelled`.
3. Inject a chat message into the source session via the WS bridge:
   ```
   <pneuma:handoff-cancelled reason="<escaped reason or omit>" />
   ```
   Use the same `sendUserMessage` plumbing the source agent already understands. The agent reads this tag and continues the conversation per the skill.
4. Return `{ cancelled: true }`.

**Note**: cancellation does NOT kill the source session. The user is still there, talking to it.

### 3.5 Client `HandoffCard` rewrite

**File**: `src/components/HandoffCard.tsx`.

**Trigger**: instead of subscribing to `handoffInbox` populated by chokidar, subscribe to a new `handoff_proposed` WS event. Maintain a single proposal in store state (only one active at a time per session); cleared on cancel/confirm/timeout.

**UI**: render the structured payload — intent (large), summary (1–3 sentences), suggested files (chip list), decisions (bullet list), open questions (bullet list). Two buttons:
- **Confirm Switch** → `POST /api/handoffs/:id/confirm`. On 200, navigate to `data.launchUrl`. Disabled while in flight.
- **Cancel** → optional reason input (small text field, "Why? (optional)"), then `POST /api/handoffs/:id/cancel`. Closes the card. Source agent receives the cancel tag.

The card no longer disappears via watcher events — it disappears when the user acts or the proposal expires.

### 3.6 Skill installer — inbound handoff handling

**File**: `server/skill-installer.ts` (or wherever `pneuma:handoff` block is generated).

**Current behavior**: scan `<projectRoot>/.pneuma/handoffs/*.md` for files with `target_session` matching this session, parse frontmatter, format a `pneuma:handoff` block.

**New behavior**:
1. Check `<sessionDir>/.pneuma/inbound-handoff.json`.
2. If present, parse JSON, format the structured fields into the `pneuma:handoff` block (using the shape documented in `pneuma-project` SKILL.md's "Receiving a handoff" section).
3. Don't delete the file from the installer — let the target agent rm it after consuming, per the skill instructions. (If the agent fails to delete, it's not catastrophic — it'll just re-inject the same context on next session resume, which is approximately right anyway.)
4. Drop the `<projectRoot>/.pneuma/handoffs/` directory scan entirely.

### 3.7 Server `PNEUMA_SERVER_URL` injection

**File**: `bin/pneuma.ts` agent spawn paths.

When spawning a child pneuma session via the launcher's `/api/launch`, the server already passes env vars (`PNEUMA_SESSION_DIR`, etc.). Add `PNEUMA_SERVER_URL=http://localhost:<port>` so the child agent's `pneuma handoff` invocation knows where to POST.

Inside a session's own server (the per-session pneuma process), the env var should also be set for the agent it spawns. Since each session runs its own server on its own port, the URL should be the session's own server URL — that way the handoff `emit` goes to the same server that's driving the source session, and the WS broadcast lands in the right browser.

### 3.8 Removal: file-mediated v1 plumbing

Delete or repurpose:
- `server/handoff-watcher.ts` — entire file goes away (no more chokidar on handoffs dir).
- `server/handoff-parser.ts` — kept for now as audit / migration helper, but no longer in the live request path. Can delete in a follow-up commit.
- `<projectRoot>/.pneuma/handoffs/` directory — no longer written by any code path. Old files can stay on disk as audit residue (we don't actively clean them).
- `recordHandoffCreated`, `recordHandoffDeleted`, `clearHandoffs` in `src/store/project-slice.ts` — replaced by a single `proposedHandoff: HandoffProposal | null` slot.
- `<pneuma:request-handoff>` tag dispatch in `ModeSwitcherDropdown.tsx` — still valid (it's the SOURCE-side input tag the agent reads), but the dropdown's own UI flow stays as-is for now. Smart Handoff in the panel is the recommended path; the dropdown is a power-user shortcut.

---

## 4. State machine

```
                              ┌─────────────┐
                              │   IDLE      │
                              └──────┬──────┘
                                     │ user clicks Smart Handoff Confirm
                                     │ → UI sendUserMessage(<pneuma:request-handoff …>)
                                     │ → panel closes
                                     ▼
                              ┌─────────────┐
                              │  PREPARING  │  (no server state; agent is thinking)
                              └──────┬──────┘
                                     │ agent calls `pneuma handoff --json …`
                                     │ → CLI POSTs /api/handoffs/emit
                                     │ → server creates proposal id, broadcasts handoff_proposed
                                     ▼
                              ┌─────────────┐
                              │   PENDING   │  (server map has handoff_id → proposal)
                              └──────┬──────┘
                       ┌─────────────┼─────────────┐
                       │             │             │
                user Confirm    user Cancel    timeout (30 min)
                       │             │             │
                       ▼             ▼             ▼
             ┌────────────┐  ┌─────────────┐  ┌──────────┐
             │ CONFIRMED  │  │  CANCELLED  │  │  EXPIRED │
             │ (target    │  │ (source     │  │ (silent  │
             │  spawned;  │  │  agent gets │  │  cleanup)│
             │  source    │  │  cancel tag;│  └──────────┘
             │  killed)   │  │  conversation│
             └────────────┘  │  continues) │
                             └─────────────┘
```

PREPARING state isn't tracked server-side — it's just "user has dispatched the tag, hasn't seen a HandoffCard yet". If the agent never calls `pneuma handoff`, the user sees nothing change; they can re-trigger Smart Handoff or talk to the agent directly.

If the user re-triggers Smart Handoff while in PREPARING (or even PENDING) state, the server should **supersede**: the new request becomes the new pending; the old proposal (if any) is silently cancelled (no chat tag emitted, since the user replaced their own intent).

---

## 5. Test plan

Unit:
- `pneuma handoff` CLI: validates required fields, handles `--json` and `--stdin`, posts to the URL, surfaces server errors.
- `/api/handoffs/emit`: validates body, generates handoff_id, supersedes a prior pending for the same source.
- `/api/handoffs/:id/confirm`: writes inbound-handoff.json **before** spawning, idempotent on second confirm (returns 409, doesn't double-spawn).
- `/api/handoffs/:id/cancel`: emits the cancel tag once, even on duplicate cancels.

Integration:
- Skill installer reads inbound-handoff.json and produces the expected `pneuma:handoff` CLAUDE.md block.
- Old `<projectRoot>/.pneuma/handoffs/*.md` files are ignored (no chokidar regression).

End-to-end:
- Smart Handoff from illustrate → webcraft → Confirm Switch → land in webcraft session → CLAUDE.md has inbound block → agent acknowledges in first reply.
- Smart Handoff → Cancel with reason → source agent receives `<pneuma:handoff-cancelled reason="…" />` and continues.
- Smart Handoff → close browser tab before user confirms → 30 minutes later proposal expires silently.

---

## 6. Migration

There are no production users on this branch yet (the v1 protocol shipped only in this development cycle). Old handoff `.md` files on disk in test environments can be ignored — the new code path simply doesn't read them.

If we later want to handle stragglers: a one-shot CLI command `pneuma handoff migrate-v1` could parse remaining files into the new protocol. Out of scope for the rewrite itself.

---

## 7. Open questions (for follow-ups, not blockers)

- **Multi-tab cancel**: if the user has the project open in two browser tabs and cancels in one, the other tab's HandoffCard should also disappear. Solved naturally by broadcasting `handoff_cancelled` event on cancel.
- **Agent calls `pneuma handoff` without a `<pneuma:request-handoff>` tag**: the skill says "wait for the request tag", but a misbehaving agent could still call. Server could check the source session's recent chat for the tag — but that's coupling the server to chat history. Simpler: trust the skill, accept the call, let the user decide via the HandoffCard. If the user is surprised, they cancel; agent gets the cancel tag and sees its mistake.
- **Inbound handoff for an already-running target session**: if `target_session` is an existing id and that session is currently active, the inbound-handoff.json drop-in is racy. v1 simply spawned a new session. Punt on this for now — `target_session` defaults to `"auto"` (fresh) in the UI; resume-into-existing is power-user and can come later.
