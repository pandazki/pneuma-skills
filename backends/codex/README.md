# Codex backend

This backend talks to OpenAI's Codex CLI (`codex app-server`) over **stdio
JSON-RPC**. Unlike Claude Code, Codex does not stream NDJSON envelopes — it
exposes a request/response + notification protocol modelled on JSON-RPC 2.0
where every wire frame is one `\n`-delimited JSON object with `method` /
`params` (notification or request) or `id` / `result` (response). The adapter
in this directory translates that protocol into Pneuma's normalised
`BrowserIncomingMessage` shape so the chat UI can render Codex turns the same
way it renders Claude Code turns.

Reference: <https://github.com/openai/codex> and the `codex app-server`
`--help` output (the protocol surface evolves quickly; v0.114 and v0.128 have
both shipped breaking changes that this adapter handles inline — see
Lifecycle gotchas).

## Files in this directory

| File                | Responsibility |
|---------------------|----------------|
| `manifest.ts`       | `BackendModule`: install layout (`.agents/skills` + `AGENTS.md`), capabilities, `createBackend` (constructs `CodexBackend`), `createBridgeBackend` (constructs `CodexBridge`), `checkRequirements`. No static `defaultModels` — Codex emits `model/list` itself. |
| `index.ts`          | `CodexBackend` — implements `AgentBackend`. Wraps `CodexCliLauncher` and exposes the additional `onAdapterCreated` / `getAdapter` hooks the bridge needs to attach. |
| `cli-launcher.ts`   | `CodexCliLauncher` — owns the `node:child_process` spawn (with sibling-`node`-script handling for npm-installed codex), wires the `StdioTransport` between the process pipes and the adapter, and propagates exit / disconnect events. |
| `codex-adapter.ts`  | `CodexAdapter` + `StdioTransport` — the heart of the integration. Handshakes via `initialize` → `initialized` → `thread/start` (or `thread/resume`), translates every Codex notification (`item/started`, `item/completed`, `thread/tokenUsage/updated`, etc.) into a Pneuma envelope, manages permission requests as JSON-RPC requests with ids, and synthesises a `result` envelope per turn since Codex doesn't have a single "turn end" message of its own. |
| `__tests__/`        | `manifest.test.ts` (manifest shape), `codex-adapter.test.ts` (adapter unit tests), `codex-adapter-subagents.test.ts` (thread attribution + roster), `mock-transport.ts` (the shared `ICodexTransport` fake both adapter suites drive), `lifecycle.test.ts` (six shared scenarios). |

## Protocol shape

Codex is JSON-RPC over stdio. Each line is one of:

- **Request** — `{ "method": "initialize", "id": 1, "params": {...} }` — expects a response keyed by the same `id`.
- **Notification** — `{ "method": "item/completed", "params": {...} }` — fire-and-forget.
- **Response** — `{ "id": 1, "result": {...} }` or `{ "id": 1, "error": {...} }`.

### Outbound boot sequence (server → Codex)

```jsonc
// 1. Identify the client.
{ "method": "initialize", "id": 1, "params": {
    "clientInfo": { "name": "pneuma-skills", "title": "Pneuma Skills", "version": "1.0.0" },
    "capabilities": { "experimentalApi": true }
} }

// 2. Notify init complete.
{ "method": "initialized", "params": {} }

// 3. Start a thread (or thread/resume with `threadId`).
{ "method": "thread/start", "id": 2, "params": {
    "model": "gpt-5",
    "cwd": "/path/to/workspace",
    "approvalPolicy": "on-request",
    "sandbox": "workspace-write"
} }
```

### Inbound responses + the synthesised `session_init`

The `thread/start` response carries `{ thread: { id }, model, model_provider }`.
The adapter then **synthesises** a `session_init` envelope so the bridge sees
the same shape Claude Code's native `system.init` produces:

```jsonc
{
  "type": "session_init",
  "session": {
    "session_id": "<pneuma session>",
    "backend_type": "codex",
    "model": "gpt-5",
    "cwd": "/path/to/workspace",
    "agent_version": "codex 0.128.0",
    "tools": [], "mcp_servers": [], "agents": [], "slash_commands": [], "skills": [],
    …
  }
}
```

`available_models` is populated separately from a best-effort `model/list`
RPC (`fetchAvailableModels`); skills come from `skills/list`.

### Per-turn flow (server → Codex)

```jsonc
{ "method": "turn/start", "id": 7, "params": {
    "threadId": "thr_…",
    "input": [{ "type": "text", "text": "Reply with the single word: hi" }],
    "cwd": "…", "model": "gpt-5",
    "approvalPolicy": "on-request",
    "sandboxPolicy": { "type": "workspaceWrite" }
} }

// turn/interrupt — sent by the chat UI's stop button
{ "method": "turn/interrupt", "id": 8, "params": { "threadId": "…", "turnId": "trn_…" } }

// turn/steer — promotes one queued message into the active turn
{ "method": "turn/steer", "id": 9, "params": {
    "threadId": "…", "expectedTurnId": "trn_…",
    "input": [{ "type": "text", "text": "Focus on rollback safety" }]
} }
```

```jsonc
// Browser `/compact` — the ONE slash command the adapter answers itself.
// app-server has no slash-command surface (the TUI owns those), so the bare
// text is translated into the native RPC instead of reaching the model as
// prose. `/compact <note>` stays prose: the RPC takes no focus instructions.
{ "method": "thread/compact/start", "params": { "threadId": "thr_…" } }
// → {} — the compaction then runs as a turn of its own (see below).
```

### Per-turn flow (Codex → server)

```jsonc
// Streaming text deltas — adapter accumulates in `streamingText`, flushes
// to a single assistant envelope on item/completed.
{ "method": "item/agentMessage/delta", "params": { "delta": "He" } }

// Tool / file-change items — translated to assistant `tool_use` blocks.
{ "method": "item/started", "params": { "item": {
    "type": "commandExecution", "id": "itm_…", "command": ["ls", "-la"]
} } }
{ "method": "item/completed", "params": { "item": {
    "type": "commandExecution", "id": "itm_…",
    "exitCode": 0, "aggregatedOutput": "…", "status": "completed"
} } }

// Reasoning deltas — surfaced as `thinking_delta` stream events,
// flushed to a `thinking` content block on completion.
{ "method": "item/reasoning/textDelta", "params": { "delta": "First, …" } }

// Token usage — driven by thread/tokenUsage/updated; v0.114+ payload is
// nested under `tokenUsage`, legacy was flat. Adapter handles both.
// `total` = cumulative session spend, `last` = the most recent request.
// The ctx gauge measures `last` against the window; only cumulative
// counters read `total`. See "Two token numbers" below.
{ "method": "thread/tokenUsage/updated", "params": {
    "tokenUsage": {
      "total": { "inputTokens": 23245850, "outputTokens": 74081, "totalTokens": 23319931 },
      "last":  { "inputTokens": 125962,   "outputTokens": 1329,  "totalTokens": 127291 },
      "modelContextWindow": 258400
    }
} }

// turn/completed — adapter then SYNTHESISES a Pneuma `result` envelope
// (Codex has no native "all done with this turn" message that matches
// Claude Code's `result`).
{ "method": "turn/completed", "params": { "turn": { "status": "completed" }, "usage": {...} } }
```

```jsonc
// Context compaction — whether the user asked (`thread/compact/start`) or
// Codex decided on its own mid-turn. The adapter echoes ONE
// `system_event { subtype: "compact_boundary" }` per compaction
// (`trigger: "manual" | "auto"`, `pre_tokens` = occupancy when it started).
// Sequence as probed live on codex-cli 0.154.0 (2026-09-07): a manual
// compaction is bracketed by its own turn/started … turn/completed (so it
// ends with a `result` like any turn), the turn id is under `turn.id`, and
// the token-usage update INSIDE the turn already reports the
// post-compaction occupancy (20,716 → 5,750 in the probe) — which is why
// pre_tokens is snapshotted at item/started and the gauge is left alone.
// 0.154 sent no `thread/compacted`; the handler stays for builds that do,
// deduped against the item.
{ "method": "turn/started",   "params": { "threadId": "thr_…", "turn": { "id": "turn_…", "status": "inProgress" } } }
{ "method": "item/started",   "params": { "item": { "type": "contextCompaction", "id": "itm_…" } } }
{ "method": "thread/tokenUsage/updated", "params": { "tokenUsage": { "last": { "totalTokens": 5750, "inputTokens": 0, "outputTokens": 0 }, "modelContextWindow": 258400 } } }
{ "method": "item/completed", "params": { "item": { "type": "contextCompaction", "id": "itm_…" } } }
{ "method": "turn/completed", "params": { "turn": { "id": "turn_…", "status": "completed" } } }

// Errors — v2 nests the text; `willRetry: true` means Codex is about to
// retry on its own (stream drops, transient 5xx) and the turn is not over.
// Legacy servers put `message` (or `msg.message`) at the top level; the
// adapter reads all three shapes (`describeErrorNotification`).
{ "method": "error", "params": {
    "threadId": "thr_…", "turnId": "turn_…",
    "error": { "message": "stream disconnected before completion", "codexErrorInfo": "responseStreamDisconnected", "additionalDetails": null },
    "willRetry": true
} }
```

### Multi-agent threads (subagents)

`codex app-server --enable multi_agent` lets the agent spawn other agents.
They run on **their own threads over the same transport**, and every
notification that has a thread carries its id:

| Notification / request | Thread field | Payload facts (codex-cli 0.154.0-alpha.3, protocol v2) |
|---|---|---|
| `item/started` / `item/completed` | `threadId` | `{ threadId, turnId, item, startedAtMs \| completedAtMs }` |
| `turn/started` / `turn/completed` | `threadId` | `{ threadId, turn }` |
| `item/agentMessage/delta` | `threadId` | `{ threadId, turnId, itemId, delta }` |
| `item/reasoning/textDelta` | `threadId` | as above plus `contentIndex` |
| `thread/tokenUsage/updated` | `threadId` | `{ threadId, turnId, tokenUsage }` |
| `thread/status/changed` | `threadId` | `{ threadId, status }` |
| `thread/started` | `thread.id` | `{ thread }`; `Thread` has `id`, `parentThreadId` ("only set if this thread is a subagent"), `agentNickname`, `agentRole`, `model` |
| `error` | `threadId` | plus `error.message` / `willRetry` |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput` | `threadId` | the modern approvals |
| `execCommandApproval`, `applyPatchApproval` | `conversationId` | legacy name for the same value |

Two item types describe the team, both on the **parent's** thread:

```jsonc
// The spawner's own tool call. `agentsStates` is the per-agent outcome.
{ "method": "item/completed", "params": { "threadId": "thr_root", "item": {
    "type": "collabAgentToolCall", "id": "itm_call", "status": "completed",
    "tool": "spawnAgent",            // sendInput | resumeAgent | wait | closeAgent
                                     // | sendMessage | followupTask | interruptAgent | listAgents
    "prompt": "judge captures/round-3.png", "model": "gpt-6-astra", "reasoningEffort": "high",
    "senderThreadId": "thr_root", "receiverThreadIds": ["thr_child"],
    "agentsStates": { "thr_child": { "status": "running", "message": null } }
                     // pendingInit | running | interrupted | completed | errored | shutdown | notFound
} } }

// The parent's view of what one of its agents is doing.
{ "method": "item/completed", "params": { "threadId": "thr_root", "item": {
    "type": "subAgentActivity", "id": "itm_act", "agentThreadId": "thr_child",
    "agentPath": "/Users/dev/.codex/agents/judge_01",
    "kind": "started"                // interacted | interrupted | completed
} } }
```

**Attribution.** The adapter maps all of this onto the one cross-backend key,
`parent_tool_use_id` (see `SubagentInfo` in `server/session-types.ts`): the
`tool_use.id`, in the spawning agent's conversation, of the call that created
the agent that produced an envelope — `null` for the root agent. Every
`assistant` / `stream_event` / `tool_progress` synthesised for a child thread,
and every `permission_request` it raises, carries its anchor.

**The anchor rule — fixed at first sight, never rewritten**, because it is
already on the wire by the time a later source could disagree. Sources, in the
order they normally arrive:

1. `collabAgentToolCall` with `tool: "spawnAgent"` naming **exactly one**
   agent — anchor = the **item id**, which is also the card's block id, so the
   click target in the chat and the attribution key on the wire are one value.
   A spawn that names several agents proposes nothing: one card cannot be two
   conversations, so each of them keeps its own fallback (source 4) and the
   card keeps the item id, listing the team in `input.agents`.
2. `subAgentActivity` — `agentThreadId`, with `agentPath` giving the label
   (basename) and the detail (full path).
3. `thread/started` whose `thread.parentThreadId` is set — nickname / role
   fill the label and detail while no path is known.
4. Any other notification from an unknown non-main thread — registered with
   the fallback anchor `thread:<threadId>`, empty label, parent = main. If a
   spawn item lands later, its card is emitted **with that fallback id** (the
   ids of synthesised blocks are Pneuma's to choose); the dedupe key stays the
   Codex item id, which is a different string, and `ThreadState.collabCardIds`
   remembers the mapping so the `tool_result` names the id the `tool_use` was
   actually emitted with.

Observed live (codex-cli 0.154.0-alpha.3, 2026-09-16, `spawn_agent` → `wait_agent`
→ `close_agent` prompt through Pneuma and again against a bare `codex
app-server --enable multi_agent`): the spawn call did **not** surface as a
`collabAgentToolCall` item at all, and no `thread/started` arrived for the
child. The parent thread carried only `subAgentActivity { kind: "started",
agentPath: "/root/write_judge" }` and a `collabAgentToolCall { tool: "wait" }`
with empty `receiverThreadIds` / `agentsStates`. Sources 2 and 4 were therefore
the whole path — the agent's anchor is `thread:<threadId>`, its label comes from
`agentPath`, and the chat still draws its card because the frontend derives a
card from the roster when no spawn block exists (spec §3.4). Source 1 stays
implemented for builds that do emit the spawn item (issue #152's blind trial
listed `spawn_agent` items in the parent rollout).

`item/started` for a spawn can arrive before the agent exists
(`receiverThreadIds` empty), and by `item/completed` the child may have
registered itself under a fallback anchor. There is no identity to draw a card
with in that window, so **the card waits for `item/completed`**, which names
the receiver. Emitting early is what gave one agent two ids — a card under the
item id, a roster entry and a `tool_result` under the fallback anchor — so the
card never paired with its own result.

A notification with no thread field belongs to the main thread: legacy servers
omit it and have no second thread. A notification that *does* name a thread but
arrives before `thread/start` / `thread/resume` has answered cannot be placed
at all — it is queued (`preAdoptionNotifications`) and replayed once the main
id is known. The window is real on the resume path: the RPC response and the
replayed notifications share one stdout chunk, and `processBuffer` dispatches
the rest of that chunk synchronously while the continuation that adopts the
thread is still a queued microtask, so a replayed child `turn/completed` used
to synthesize a root `result`.

**What a child thread may and may not do.** A subagent never ends the root
turn — that was the core of issue #152:

| Child notification | Behaviour |
|---|---|
| `turn/started` | sets the child's `currentTurnId`, roster → `running`; **no** root `status_change` (and `turn/interrupt` / `turn/steer` keep targeting the root turn) |
| `turn/completed` | flushes the child's text / reasoning with its anchor, clears its dedupe set, roster status from `turn.status` and `turn.error.message` → `detail`; **no** `result`, **no** `num_turns++`, **no** root `status_change`, root buffers untouched |
| `item/*`, deltas | the same handlers as the root, on the child's `ThreadState`, stamped with its anchor |
| `thread/tokenUsage/updated` | roster `context_used_percent` / `model`; the session gauge keeps reporting the root thread |
| `thread/status/changed` | ignored — the turn events carry per-thread lifecycle |
| `error` | roster `detail` = message, status → `failed` unless `willRetry`; **no** root `error` envelope |
| `codex/event/error`, `codex/event/stream_error` (legacy; the thread is `conversationId`) | roster `detail` = message, status untouched — these say nothing about whether the agent is dead; **no** root `error` envelope |
| `contextCompaction` item | ignored — compaction bookkeeping belongs to the root session |
| `thread/compacted` | ignored, for the same reason. It used to draw the **root's** `compact_boundary` — labelled `manual` whenever the user had armed `/compact`, carrying the root's `pre_tokens`, clearing `is_compacting`, and spending the one echo the root's own `thread/compacted` needed, so the real boundary emitted nothing |
| `model/rerouted` | roster `model`; `activeModel` and the session's `model` are the root's, and writing a child's reroute there relabelled every later root `assistant` message |
| approval request | `PermissionRequest.parent_tool_use_id` = the child's anchor (it still blocks the whole session; Codex approvals are per request) |

A child's file edits **do** count toward the session's
`total_lines_added` / `total_lines_removed`: subagents edit the same cwd, so
those lines are really in the working tree. Its tokens do not — a context gauge
describes one window, and the child's own occupancy is on its roster card.

Nested agents follow the same rules: a grandchild's `parent_id` is the child's
anchor, and the child's spawn card is emitted with the child's anchor as its
`parent_tool_use_id`.

Per-thread state lives in `ThreadState` (`threads: Map<threadId, ThreadState>`,
the main thread being the record with `anchorId: null`): streaming text,
reasoning, `currentTurnId`, `emittedToolUseIds`, `collabCardIds`,
`commandStartTimes`. Both id-keyed maps reset on `turn/completed`, because
Codex item ids are only unique within a turn. There is no flat copy of any of
them — one flat field is all it takes for a child to impersonate the root
again.

### Permission round-trips (Codex → server, expects response)

These are **JSON-RPC requests with an `id`**, not notifications — the adapter
must call `transport.respond(id, …)` once the user decides:

```jsonc
{ "method": "item/commandExecution/requestApproval", "id": 13, "params": {
    "itemId": "itm_…", "command": "rm -rf /tmp/foo"
} }

// Acceptable response variants:
//   - item/*/requestApproval            → { "decision": "accept" | "decline" }
//   - applyPatchApproval / execCommandApproval → { "decision": "approved" | "denied" }
//   - item/permissions/requestApproval (v0.114+) → { "decision": "accept" | "decline" }
//   - item/tool/requestUserInput (v0.114+)       → freeform input
//   - mcpServer/elicitation/request (v0.114+)    → server-defined elicitation payload
```

### Synthesised vs native envelopes

| Envelope                | Source |
|-------------------------|--------|
| `session_init`          | **Synthesised** by the adapter after `thread/start` succeeds. |
| `assistant` (text)      | Synthesised on `item/completed` (or on `turn/completed` flush) from accumulated `streamingText`. |
| `assistant` (`tool_use`)| Synthesised on `item/started` for `commandExecution` / `fileChange` / `webSearch` / `mcpToolCall`. |
| `assistant` (`tool_result`) | Synthesised on `item/completed` with the tool's output. |
| `assistant` (`thinking`)| Synthesised on `item/completed` for `reasoning` items. |
| `assistant` (`tool_use` / `tool_result`, collab) | Synthesised from a `collabAgentToolCall` item in the **sender's** conversation: name = snake_case of `tool` (`spawn_agent`, `send_input`, `wait_agent` for `wait`, `close_agent`, `resume_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`), `input` = `{ agent?, agents?, prompt? (400 chars), model?, reasoning_effort? }` (labels omitted while unknown), block id = the spawned agent's anchor when the spawn names exactly one agent, the item id otherwise; the id is decided once per item (`collabCardIds`) so the `tool_result` on `item/completed` names it too. That `tool_result` summarises `agentsStates` as `label: status — message` per agent, `is_error` when the item failed. |
| `subagent_update`       | **Synthesised** roster snapshot (`SubagentInfo`) whenever an agent's state changes — registration, status, `model`, `context_used_percent`, or a label refinement; never one per message. `label` = basename of `agentPath`, else `agentNickname`, else `""`; `detail` = full `agentPath` + `agentRole`, or the error / collab message. `subAgentActivity` items feed it and produce **no** chat bubble. |
| `result`                | **Synthesised** on `turn/completed` of the **main** thread — Codex has no native equivalent, and a subagent's turn must never produce one. |
| `permission_request`    | Synthesised from any of the seven approval-style JSON-RPC requests above, carrying `parent_tool_use_id` when the asking thread is a subagent. |
| `session_update`        | Native-ish — adapter pushes one whenever model / cost / context-percent / available models change. |
| `status_change`         | Synthesised from `thread/status/changed` and the main thread's turn events; child threads never move it. |
| `system_event` (`compact_boundary`) | **Synthesised** once per compaction of the **main** thread, from its `item/completed` (`contextCompaction`) or `thread/compacted` — whichever the build sends, deduped. A subagent compacting its own window draws nothing. Same envelope the Claude bridge forwards from `system.compact_boundary`, so the chat draws one marker for every backend. |
| `error`                 | Native `error` notification, text lifted from `params.error.message` (v2) or the legacy top-level fields; `(retrying)` appended when `willRetry` is set. A child thread's error goes to its roster entry instead. |

## Capabilities + why

| Flag           | Value | Justification |
|----------------|-------|---------------|
| `streaming`    | `true`  | `item/agentMessage/delta` and `item/reasoning/textDelta` arrive token-by-token. |
| `resume`       | `true`  | `thread/resume` with the saved `threadId` rehydrates state; falls back to `thread/start` if the rollout file was cleaned up. |
| `permissions`  | `true`  | Seven different approval-request methods are wired (see Permission round-trips above). |
| `toolProgress` | `false` | We surface "Running… (Ns)" via `handleItemUpdated`, but it's a coarse text update — there is no incremental progress integer the UI can chart, so we report `false` to match what the UI reasonably gates on. |
| `modelSwitch`  | `true`  | `set_model` records the new model on the adapter; it's applied to the next `turn/start` (Codex is per-turn model selection, not a stateful flip). |
| `steer`        | `true`  | app-server's native `turn/steer` appends typed input to the active turn. Pneuma includes `expectedTurnId` so a turn-boundary race fails explicitly instead of steering the wrong turn. |
| `contextWindow`| `true`  | `thread/tokenUsage/updated` carries `modelContextWindow` alongside the per-request counts, so the "ctx N%" readout is measurable. See "Two token numbers" below. |
| `costTracking` | *unset* | The app-server never pushes a cost. `costUsd` is read opportunistically but no codex build has been observed to send it; an estimate exists only behind a `codex/usage/*` **request** (`estimatedUsageUsdMicros` on `ThreadUsage`), and nothing polls it. Declaring `true` would put a permanent `$0.0000` in the UI. |

### Two token numbers, and which one the window gauge uses

`thread/tokenUsage/updated` reports **two** scopes plus the window, and they
mean different things:

- **`total`** — the session's *cumulative* spend. Every request re-sends and
  re-counts the whole prompt, so this climbs to millions of tokens over a long
  thread. It is the right source for cumulative counters and cost.
- **`last`** — the most recent request alone. This is what actually occupies
  the model's context window right now.

Measuring the window against `total` is a category error that renders as an
absurd percentage. A real 194-turn rollout ended at 23,319,931 cumulative
tokens against a 258,400-token window — 9,024% — while `last` was 127,291,
i.e. 49%. `handleTokenUsageUpdated` therefore reads `last` for
`context_used_percent` (falling back to `total` only before the first request
completes, when the two are equal) and clamps the result to `[0, 100]` so a
future reshape of the payload can never render an impossible number again.

`totalTokens` on either scope is that scope's input + output; the adapter
falls back to summing the two when it is absent.

## Install layout

| Field              | Value           |
|--------------------|-----------------|
| `skillsDir`        | `.agents/skills` |
| `instructionsFile` | `AGENTS.md`     |

The Codex CLI reads `AGENTS.md` from the working directory and discovers
skills from `.agents/skills/<name>/`. This is documented in the
upstream README at <https://github.com/openai/codex#agents> and matches the
broader "AGENTS.md" convention adopted by other agent-runtime projects (see
<https://agentsmd.net>). We don't override the convention because the CLI
reads these paths directly.

## Lifecycle gotchas

- **`/compact` is not prose.** app-server does not parse slash commands — a
  browser `/compact` sent through `turn/start` reaches the model as a
  two-word prompt. The adapter intercepts the bare command and calls
  `thread/compact/start` (present since ~0.100; a rejected call is unwound
  with an error `result` so the composer does not stay stuck on "running").
  `compact` is advertised in `slash_commands` ahead of the `skills/list`
  names so the composer menu shows it; skills are still reported separately
  in `skills`.
- **The `error` notification nests its text.** v2 sends
  `{ threadId, turnId, error: { message, codexErrorInfo, additionalDetails }, willRetry }`.
  Reading only the legacy `params.message` / `params.msg.message` rendered
  every modern error as "Unknown error" — the shape that greeted a `/compact`
  on 0.154 was two such dividers around a perfectly good turn. Go through
  `describeErrorNotification`; do not add a fourth ad-hoc reader.
- **`CodexBridge` MUST merge the adapter's partial session before broadcasting.**
  The adapter emits `session_init` / `session_update` with only the fields it
  knows about — notably without `agent_capabilities`, which the bridge layer
  injects from the manifest. If a bridge implementation forwards the
  adapter's payload as-is (`broadcastToBrowsers(session, msg)` instead of
  `broadcastToBrowsers(session, { ...msg, session: { ...this.session.state, ...msg.session } })`),
  the browser receives a session with `agent_capabilities: undefined` and
  capability-gated UI components crash. See `server/ws-bridge-codex.ts:144`.
- **`node:child_process`, NOT `Bun.spawn`.** Bun's `proc.stdout` ReadableStream
  occasionally closes prematurely while the underlying process is still
  alive. Codex sessions are long-lived; switching to `node:child_process`
  preserves stream lifetime. Do not switch back without re-verifying the Bun
  bug is fixed.
- **`approvalPolicy` variants changed in codex-cli 0.128.** Earlier versions
  accepted `unless-allow-listed`; 0.128 removed it. Accepted variants today
  are `untrusted`, `on-failure`, `on-request`, `granular`, and `never`. Our
  default mapping (`mapApprovalPolicy` in `codex-adapter.ts:1603`) returns
  `on-request` (closest semantic equivalent — ask before each exec unless
  pre-approved). If you see "invalid approvalPolicy" rejections at boot,
  this enum drifted again — check `codex --help` and update
  `mapApprovalPolicy`.
- **`sandboxPolicy` is camelCase per turn but kebab-case at boot.** `thread/start`
  takes `sandbox: "workspace-write"`; `turn/start` takes
  `sandboxPolicy: { type: "workspaceWrite" }`. The adapter has separate
  `mapSandboxPolicy` / `mapSandboxPolicyObject` helpers. If you change one,
  change the other.
- **`handleBrowserOpen` / `getActiveSessionId` use the unified `streamingBackends`
  map.** Codex has no `cliSocket` (it's stdio JSON-RPC, not WebSocket). The
  bridge's reconnection guards check `streamingBackends.has(sessionId)`
  (which contains both codex and kimi entries) instead of `cliSocket` to
  decide whether to emit a `cli_disconnected` event. New stdio backends must
  register in this map at launch time.
- **v0.114+ payload reshaping is everywhere.** Many notifications grew nested
  fields in 0.114: `thread/status/changed.status` went from a string to an
  object; `thread/tokenUsage/updated` payloads moved fields under
  `tokenUsage.total`; `mcpToolCall` items renamed `serverName` → `server`
  and `args` → `arguments`. The adapter handles both shapes inline (`?? legacy`
  patterns). Keep these compatibility branches when adding new fields.
- **Permission requests come in seven flavours.** Five are item-level
  (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/mcpToolCall/requestApproval`, `item/permissions/requestApproval`,
  `item/tool/requestUserInput`), two are policy-level
  (`applyPatchApproval`, `execCommandApproval`), and one is MCP-internal
  (`mcpServer/elicitation/request`). Each maps to a different response
  shape. The `pendingReviewDecisions` set tracks which ids need
  `approved`/`denied` vs `accept`/`decline` — flipping that mapping silently
  rejects every approval.
- **Unknown JSON-RPC requests are auto-declined.** Anything that arrives as
  a request (not a notification) which the adapter doesn't recognise is
  responded to with `{ decision: "decline" }`. This is intentional — it
  avoids accidentally approving a future-version dangerous operation — but
  it does mean a UX regression if codex adds a new approval shape and we
  silently reject every request from a session.
- **Unknown *notifications* are logged and dropped — unlike requests.** The
  `default:` branch suppresses a known list of event-prefix families
  (`account/`, `codex/event/`, `rawResponseItem/`, `fuzzyFileSearch/`,
  `thread/realtime/`, `app/`, `mcpServer/`, `windows`) and `console.log`s
  everything else as `Unhandled notification: …`. Harmless, but it is the
  signal that upstream's protocol surface has grown. As of codex-cli
  **0.144.6** three such notifications show up in lifecycle runs with no
  handler: `warning`, `remoteControl/status/changed`, and
  `thread/goal/cleared`. Nothing depends on them today (all six lifecycle
  scenarios pass), so this is a note about available surface, not a bug —
  check here first when wiring a new codex capability.
- **Initialization retries `thread/start` on transport-closed errors only.**
  The retry loop in `initialize()` (`codex-adapter.ts:548`) catches
  `Transport closed` errors with exponential backoff up to 3 attempts. Other
  errors fail-fast; the adapter emits an `error` envelope and `initFailed`
  is set so subsequent `sendBrowserMessage` calls return `false`.
- **`sandbox: "danger-full-access"` only fires when `permissionMode ==
  "bypassPermissions"`.** Otherwise the adapter defaults to `workspace-write`
  (or whatever was passed in `options.sandbox`). Don't try to set
  `danger-full-access` via the launch options without also bypassing — the
  policy mapping will downgrade it.
- **`account/chatgptAuthTokens/refresh` requests are silent no-ops.** The
  adapter responds `{}` so the CLI's auth refresh succeeds without involving
  the user. If you start seeing refresh-loop spam in logs, this swallow is
  hiding a real auth failure — check the underlying Codex login state.
- **The model list isn't static.** `defaultModels` is intentionally absent
  from `manifest.ts` because the CLI emits `model/list` and the result is
  pushed to the browser as `available_models`. This means a fresh Codex
  install may briefly show no models in the picker between session_init and
  the first `available_models` update — UI elements should treat
  `available_models` as `T | undefined`, not `T[]`.

## Adding a new model

There is no static list to extend. The CLI's `model/list` RPC is the source
of truth; `fetchAvailableModels` (`codex-adapter.ts:754`) is a best-effort
call run after `thread/start` returns. The result is filtered to
`!hidden`, mapped to `{ id, name }`, and pushed to the browser via
`session_update.available_models`. To add support for a new model:

1. Make sure your local codex install knows about it (it has to come back
   from `model/list` for the picker to show it).
2. Pass the model id via `AgentLaunchOptions.model` at launch — the launcher
   forwards it to `thread/start.model` and to every `turn/start.model`
   thereafter.
3. If you want it to be the *default*, mark `isDefault: true` on the Codex
   side; the adapter promotes it via the `defaultModel` branch in
   `fetchAvailableModels` only when `activeModel` is empty.

## References

Upstream:
- Codex CLI repo — <https://github.com/openai/codex>
- `codex app-server --help` — the wire protocol is documented inline; the CLI's `--enable multi_agent` flag we set lives there too
- AGENTS.md convention — <https://agentsmd.net> + the [Codex README "Agents"](https://github.com/openai/codex#agents) section
- v0.114 changelog (status object shape, tokenUsage nesting, MCP field renames) — see Codex release notes on GitHub
- v0.128 changelog (`approvalPolicy` enum cleanup) — see Codex release notes on GitHub

Pneuma:
- `core/types/agent-backend.ts` — `AgentBackend` + `BackendModule` contract this backend implements
- `server/ws-bridge-codex.ts` — `CodexBridge` (the BridgeBackend that keeps `WsBridge` codex-agnostic; documents the partial-session-merge gotcha inline)
- `server/ws-bridge-backend.ts` — `BridgeBackend` interface
- `server/skill-installer.ts` + `manifest.skillsDir`/`instructionsFile` — how `.agents/skills` + `AGENTS.md` get materialised per session
- `bin/pneuma.ts` — wires `CodexBackend.onAdapterCreated` so the WsBridge can `attach()` the bridge once the adapter exists
- `backends/__tests__/lifecycle-harness.ts` — the six shared scenarios this backend's `lifecycle.test.ts` re-uses
- `CLAUDE.md` "Known Gotchas" — Codex-related entries (partial session merge, `node:child_process`, `streamingBackends` map)
