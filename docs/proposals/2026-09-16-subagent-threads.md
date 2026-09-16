# Subagent threads — attribution, roster, and the agent view

Status: design + implementation spec, 2026-09-16. Resolves GitHub issue #152
("codex adapter: handleNotification ignores threadId, so subagent threads merge
into the main conversation") and the same class of defect on the Claude Code
path. Task sections are anchored (`## TASK-n`) so each implementer reads one
bounded assignment against the shared contract in §3.

## 1. Problem

A backend agent may spawn other agents. Their output arrives on the same
transport as the main agent's. Pneuma today merges everything into one
conversation, which is wrong on every backend that has subagents:

| Backend | Wire signal for "who produced this" | What Pneuma does with it today |
|---|---|---|
| Codex app-server (`--enable multi_agent`) | Every `item/*`, `turn/*`, `item/agentMessage/delta`, reasoning delta, `thread/tokenUsage/updated`, `thread/status/changed`, and every approval request carries `threadId`. Parent-thread items `collabAgentToolCall` (`spawnAgent`/`sendInput`/`wait`/`closeAgent`/…) and `subAgentActivity` (`agentThreadId`, `agentPath`, `kind`) describe the team. `thread/started` for a child carries `thread.parentThreadId`, `agentNickname`, `agentRole`. | `backends/codex/codex-adapter.ts::handleNotification` never reads `threadId`. A child thread's `agentMessage` becomes the main agent's own text; each child `turn/completed` synthesizes a `result` envelope (`num_turns++`, `status_change: idle`, flushes the main streaming buffers) while the main turn is still running; child `turn/started` overwrites `currentTurnId` (so `turn/interrupt` targets the wrong turn); child `thread/tokenUsage/updated` overwrites the main context gauge; `collabAgentToolCall` and `subAgentActivity` fall into `default:` and vanish. Verified in the lucid blind trial on codex-cli 0.154.0-alpha.3 (issue #152). |
| Claude Code stream-json | `assistant`, `stream_event`, `user`, `tool_progress`, `streamlined_text` carry `parent_tool_use_id` = the `Task`/`Agent` tool_use that spawned the subagent. | The bridge forwards the field and `history.json` persists it, but the frontend never reads it: `src/ws.ts` appends subagent text deltas to the root streaming bubble and renders subagent `assistant` messages as root bubbles. Verified in two persisted sessions: a Haiku `Read` tool card and a full text reply ("Session launcher row updated successfully…") from a `pneuma-session` subagent both render as the main agent's. No spurious `result`/idle on this path (subagent turns emit no `result`). |
| Kimi Code (ACP) | None. `session/update` has no subagent notion; the adapter emits `parent_tool_use_id: null`. | Nothing to attribute; nothing to change. |

Two adjacent defects surfaced while tracing this and are in scope because the
fix depends on them:

- **Claude history keeps only the last block of a multi-block message.**
  Claude Code emits one `assistant` frame per content block, all sharing
  `message.id`. `WsBridge.handleAssistantMessage` *replaces* the persisted
  entry with the same id instead of merging blocks (the frontend already
  merges via `mergeAssistantMessage`). Across four persisted histories
  (34 / 732 / 415 / 208 assistant entries) zero entries hold two blocks; on the
  Claude session the `Task` tool_use that spawned the subagent is gone from
  `history.json` while the subagent's reply survives. Any tool card followed by
  text in the same message disappears on reload.
- **`tool_progress` loses attribution.** The CLI frame has
  `parent_tool_use_id`; the browser envelope drops it, so a subagent's long
  tool run drives the root activity indicator.

## 2. Design

### 2.1 The invariants

1. **Every conversation envelope is attributed.** `parent_tool_use_id` on
   `assistant`, `stream_event`, `streamlined_text`, `tool_progress` means:
   *the `tool_use.id`, in the spawning agent's conversation, of the call that
   created the agent that produced this envelope; `null` for the root agent.*
   This is Claude's native meaning and the Codex adapter maps to it. It is the
   one attribution key on the browser protocol; no second identity is added.
2. **A subagent never ends the root turn.** No `result`, no root
   `status_change`, no `num_turns` increment, no flush of root streaming
   buffers, no change to the root context gauge, from any non-root thread.
3. **The team is visible and attributed.** Spawning is a tool card in the
   spawner's conversation; each spawned agent has a roster entry with a label
   and a lifecycle status; each agent's own conversation can be opened and
   left again. Nothing a subagent says renders as the root agent's words.
4. **Single-agent sessions are unchanged**, and histories recorded before this
   change still load: Claude's persisted `parent_tool_use_id` is honoured
   retroactively; roster entries without a persisted `subagent_update` are
   derived on the client.
5. **Persistence, reload, replay, export, and the online player see the same
   roster** because roster events ride `messageHistory` like every other
   history-backed envelope.

### 2.2 Responsibility placement

| Concern | Owner |
|---|---|
| Attribution key and roster envelope (`SubagentInfo`, `subagent_update`) | Browser protocol contract, `server/session-types.ts` (the file that owns every browser envelope), re-exported by `src/types.ts` |
| Reading Codex's thread ids, collab items, sub-agent activity | `backends/codex/codex-adapter.ts` (backend dialect stays behind the adapter) |
| Recognising which Claude tool call spawns an agent | `BackendModule.subagentSpawn` (backend knowledge as data on the manifest, the same seam as `toolFileRef`); the Claude bridge calls it |
| Turning Claude's `user` tool_result frames into roster completion | Claude path of `server/ws-bridge.ts` (that file is the Claude NDJSON seam) |
| Grouping, roster fold, agent view, streaming per agent | `src/store/subagent-slice.ts` + `src/ws.ts` + `src/components/ChatPanel.tsx` / `MessageBubble.tsx` / new `SubagentCard.tsx`, `SubagentStrip.tsx` |
| Replay / player | `src/replay-engine.ts` folds `subagent_update`; the player reuses `ChatPanel` and gets the behaviour for free |

### 2.3 Why not a separate `agent_id`

`parent_tool_use_id` already exists on four envelopes, is persisted in every
Claude history on disk, and its semantic ("the call that spawned me") is
exactly the agent's identity: one spawn call ↔ one agent on both backends.
Introducing `agent_id` would add a second name for the same fact and would not
make old histories readable. The Codex adapter therefore names each subagent
by the `collabAgentToolCall` item id that spawned it and emits that call as a
`tool_use` block with the same id, so the click target in the chat and the
attribution key on the wire are one value on both backends.

### 2.4 Interaction design (what the user sees)

The Agent Surface (docked / floating / torn-off chat) gains a view stack with
exactly two levels of chrome, modelled on the Codex TUI's agent picker:

**Root conversation (default).** Only root-attributed messages render. A
spawn call renders as a **SubagentCard** where the tool card used to be:

```
┌ ● judge_01                                   running · 42s ┐
│ ↳ Reading captures/round-3.png                             │
│                                              查看对话 →     │
└─────────────────────────────────────────────────────────────┘
```

label · status dot · elapsed while running · one line of latest activity
(last tool label or last text snippet from that agent's own messages; a live
dot while its streaming buffer is non-empty) · model and `ctx N%` when known.
Consecutive spawn cards (Claude fans out three `Task` calls in one message)
stack as separate cards; they are never collapsed into a `ToolGroupBlock`.

**Agent strip.** When at least one subagent is alive (`running` / `idle` /
`interrupted`) or an agent view is open, a slim glass strip sits at the top of
the message list: `[● 主对话] [● judge_01] [● builder_02] [+2]`. The active
view is highlighted; the 主对话 chip shows an unread dot when root messages
arrive while an agent view is open. Completed agents leave the strip and stay
reachable through their cards.

**Agent view.** Clicking a card or chip switches the same panel to that agent:

```
┌ ← 主对话 / judge_01            ● running · gpt-6-astra · ctx 12% ┐
│  (only this agent's messages, its own streaming bubble,           │
│   its own activity indicator, its children's SubagentCards)       │
│                                                                   │
│  这是子代理 judge_01 的对话，只能查看。        [返回主对话]        │
└───────────────────────────────────────────────────────────────────┘
```

The composer is hidden (there is no user→subagent channel on any backend);
`Esc` and the breadcrumb return. Breadcrumb items are the agent's ancestry
(`parent_id` chain), so a nested Codex agent reads `主对话 / builder / judge`
and each segment is clickable. The floating status pill (root status, cost,
ctx) is unchanged and always describes the root agent. Permission banners stay
visible in both views; a request from a subagent names it.

Empty / waiting / failed states: an agent with no output yet shows
"子代理尚未产生输出" inside its view and "等待输出…" on its card; a `failed`
agent shows its `detail` on the card and at the top of its view; an agent view
whose roster entry is missing (old history) uses the generic label 子代理.

## 3. Contract

### 3.1 `server/session-types.ts`

```ts
/** Lifecycle of a spawned agent, backend-neutral. */
export type SubagentStatus = "running" | "idle" | "completed" | "failed" | "interrupted";

export interface SubagentInfo {
  /**
   * Attribution key: the `tool_use.id` in the spawning agent's conversation
   * whose call created this agent. Every envelope this agent produces carries
   * the same value as `parent_tool_use_id`. Claude: the `Task`/`Agent`
   * tool_use id. Codex: the `collabAgentToolCall` (spawnAgent) item id, which
   * the adapter also uses as the id of the `tool_use` block it emits for it.
   */
  id: string;
  /** Attribution key of the agent that spawned this one; null when spawned by the root agent. */
  parent_id: string | null;
  /** Codex: basename of `agentPath` (`judge_01`), else `agentNickname`. Claude: `Task.input.description`. */
  label: string;
  status: SubagentStatus;
  /** Free text for the card: Codex full `agentPath` + `agentRole`, error text, last collab message; Claude `subagent_type`. */
  detail?: string;
  model?: string;
  /** This agent's own window occupancy, when the backend reports per-thread usage (Codex). */
  context_used_percent?: number;
}

// BrowserIncomingMessageBase gains:
| { type: "subagent_update"; agent: SubagentInfo; timestamp: number }

// `tool_progress` gains attribution (the CLI frame already has it):
| { type: "tool_progress"; tool_use_id: string; tool_name: string; elapsed_time_seconds: number; parent_tool_use_id?: string | null }

// PermissionRequest gains optional attribution so the banner can name the asking agent:
parent_tool_use_id?: string | null;
```

`subagent_update` is a **state snapshot** (the whole `SubagentInfo`), not a
delta: consumers replace the entry for `agent.id`. Emitters send one on every
status change and may send one for `context_used_percent`/`model` changes;
they do not send one per message. Ordering relative to the agent's own
messages is best effort; consumers must tolerate a message whose
`parent_tool_use_id` names an agent with no roster entry yet (§3.4).

### 3.2 Replay ring and persistence

- `server/ws-bridge-replay.ts::isHistoryBackedEvent` adds `subagent_update`.
  `shouldBufferForReplay` needs no change (default true).
- **Every emitter pushes the envelope to `session.messageHistory` before
  broadcasting**, the same way `result` and `system_event` are handled, so a
  reload, `history.json`, `pneuma history export`, and the online player all
  rebuild the roster.

### 3.3 `core/types/agent-backend.ts`

```ts
/** Label for a tool call that spawns an agent, or undefined when the tool is not a spawn. */
export interface SubagentSpawnRef { label: string; detail?: string }

// BackendModule gains (optional, sibling of toolFileRef):
subagentSpawn?(toolName: string, input: Record<string, unknown>): SubagentSpawnRef | undefined;
```

Claude Code implements it for `Task` and `Agent` (label = `input.description`
string, else `input.subagent_type`, else the tool name; detail =
`subagent_type`). Codex and Kimi leave it undefined: the Codex adapter emits
its roster itself, Kimi has no subagents. `backends/__tests__/index.test.ts`
gets a case pinning the Claude mapping and the undefined default.

### 3.4 Client-side fallback derivation

For every message whose `parentToolUseId` is set, the client ensures a roster
entry exists (`touchSubagent`): missing → create `{ id, parent_id: null,
label: "", status: "running" }`; the UI renders an empty label as the generic
子代理 and, when a `tool_use` block with that id exists in any message and the
backend's card would know better, the label from that block's `input.description`
(client already knows the Claude `Task` shape via `ToolBlock.getPreview`).
Roster entries whose anchor `tool_use` block does not exist in any message
(pre-fix Claude histories) get a synthetic card in the root view, placed
before the first root message that follows the agent's first attributed
message.

## 4. Backend behaviour

### 4.1 Codex adapter (`backends/codex/codex-adapter.ts`)

State model: replace the flat streaming/reasoning/turn/tool-dedupe fields with
a per-thread record, `threads: Map<threadId, ThreadState>` where
`ThreadState = { threadId, anchorId: string | null, currentTurnId, streamingText,
streamingItemId, reasoningText, reasoningItemId, emittedToolUseIds, commandStartTimes }`.
The main thread is the entry with `anchorId: null` and `threadId` from
`thread/start`/`thread/resume`. `resolveThread(params)` returns the main record
when `params.threadId` is absent or equals the main id (legacy servers omit
it), else get-or-create the child record.

Subagent registry: `subagents: Map<threadId, { anchorId, parentThreadId, label,
detail?, status, model?, contextPercent? }>`.

Anchor rule: **an agent's anchor id is fixed the first time its thread is
seen and never rewritten.** Sources, in the order they normally arrive:

1. `collabAgentToolCall` item (`tool: "spawnAgent"`) in the sender thread —
   anchor = `item.id` **only when the call names exactly one agent**
   (`receiverThreadIds`, or `agentsStates` when receivers are absent). A
   fan-out spawn naming several agents gives none of them the item id; each
   keeps its `thread:<threadId>` fallback, because one card must map to one
   agent (§2.3). On `item/started` the receiver may be absent; on
   `item/completed` it is set — when the receiver is still unknown at
   `item/started`, the spawn card is deferred to `item/completed`, so that the
   card id, the `tool_result.tool_use_id`, and the roster id are one value
   (review finding, 2026-09-16; the alternative — reserving the item id for
   the next child registered under that parent — would pair by FIFO guesswork
   under concurrent spawns and mis-attribute a conversation).
2. `subAgentActivity` item in the parent — `agentThreadId`, `agentPath`
   (label = basename, detail = full path), `kind`.
3. `thread/started` notification whose `thread.parentThreadId` is set —
   nickname/role fill label/detail when no path is known yet.
4. Any other notification from an unknown non-main thread — register with
   fallback anchor `thread:<threadId>`, label `""`, parent = main. If a spawn
   item for that thread arrives later, the emitted `tool_use` card uses the
   fallback anchor as its id (ids of synthesized blocks are Pneuma's to choose;
   `emittedToolUseIds` still dedupes on the Codex item id).

Emission rules per notification:

| Notification (child thread) | Behaviour |
|---|---|
| `turn/started` | child `currentTurnId`; roster → `running`; **no** root `status_change` |
| `turn/completed` | flush child text/reasoning with `parent_tool_use_id = anchor`; clear child dedupe set; roster status from `turn.status` (`completed`→`completed`, `failed`→`failed`, `interrupted`→`interrupted`), `turn.error.message` → `detail`; **no** `result`, **no** `turnCount++`, **no** root `status_change`, root buffers untouched |
| `item/*`, deltas | same item handlers as today, operating on the child record and stamping `parent_tool_use_id = anchor` on every synthesized `assistant`/`stream_event` |
| `thread/tokenUsage/updated` | roster `context_used_percent` (and `model`); root gauge untouched |
| `thread/status/changed` | ignored (turn events carry the lifecycle) |
| `error` (has `threadId`) | roster `detail` = message; if `!willRetry` → status `failed`; **no** root `error` envelope |
| approval requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput` carry `threadId`; legacy `execCommandApproval`/`applyPatchApproval` carry `conversationId`) | `PermissionRequest.parent_tool_use_id = anchor` |

Parent-thread items:

| Item | Behaviour |
|---|---|
| `collabAgentToolCall` | `tool_use` card in the sender's conversation: `id` = anchor (spawn) or item id (others); `name` = snake_case of `tool` (`spawn_agent`, `send_input`, `wait_agent` for `wait`, `close_agent`, `resume_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`); `input` = `{ agent?: label, agents?: labels, prompt?: first 400 chars, model?, reasoning_effort? }`. On `item/completed`: `tool_result` summarising `agentsStates` (`label: status — message` per receiver), `is_error` when `status === "failed"`; roster updates from `agentsStates` (`pendingInit`/`running`→`running`, `completed`/`shutdown`→`completed`, `errored`/`notFound`→`failed`, `interrupted`→`interrupted`). A spawn card is also followed by `subagent_update { status: "running" }` for the new agent. |
| `subAgentActivity` | roster only (no chat bubble): `started`/`interacted`→`running`, `interrupted`→`interrupted`, `completed`→`completed`; label/detail from `agentPath` |

`thread/started` with `parentThreadId` registers the child (nickname/role). A
`thread/started` without it (our own thread) stays a no-op.

Nested agents: a child that spawns its own child follows the same rules; the
grandchild's `parent_id` is the child's anchor, and its spawn card is emitted
with `parent_tool_use_id` = the child's anchor.

Tests (`backends/codex/__tests__/codex-adapter.test.ts`, mock transport):
child `agentMessage` is attributed and never a root message; child
`turn/completed` emits no `result`/`status_change` and leaves `num_turns`
unchanged; child token usage leaves `context_used_percent` alone; spawn card
+ roster running → child messages → `wait` result + completed; child events
before the spawn item (fallback anchor stays stable when the spawn item lands
later); nested spawn; legacy notifications without `threadId` still hit the
main thread; the existing single-thread suite stays green.

Docs: `backends/codex/README.md` (multi-agent section: wire facts above, the
anchor rule, the synthesised envelopes table gains `subagent_update` and the
collab cards); `.claude/rules/backends.md` gotcha ("Codex 的每条通知都带
`threadId`，不读它子线程就会冒充主线程…").

### 4.2 Claude bridge (`server/ws-bridge.ts`, `server/ws-bridge-types.ts`, `backends/claude-code/manifest.ts`)

- `Session.subagents: Map<string, SubagentInfo>` (initialised in
  `getOrCreateSession`).
- `handleAssistantMessage`: for each `tool_use` block, ask
  `getBackendModule(session.state.backend_type).subagentSpawn?.(name, input)`;
  on a hit register `{ id: block.id, parent_id: msg.parent_tool_use_id ?? null,
  label, detail, status: "running" }`, push `subagent_update` to history,
  broadcast. Runs on root and subagent messages alike (nested spawns).
- **History merge fix**: when an entry with the same `message.id` exists,
  merge content blocks (existing first, then new blocks not already present by
  JSON identity) instead of replacing. Keep the resume re-emit path (different
  id, same text) as it is. Regression test: two frames with one id
  (`tool_use` then `text`) persist as one entry with both blocks;
  `message_history` then contains both.
- CLI `user` frames (`case "user"`): today only `<local-command-stdout>` is
  handled. Add: when `message.content` is an array, for each `tool_result`
  whose `tool_use_id` is a registered subagent, update the roster to
  `completed` (or `failed` when `is_error`), `detail` = first 200 characters
  of the result text, push + broadcast `subagent_update`. Keep the
  slash-command echo path unchanged.
- `handleToolProgress`: forward `parent_tool_use_id`.
- `handleResultMessage`: no roster change (a background `Agent` outlives the
  turn; marking it done would be a guess). Known limitation, documented: a
  background agent's roster entry reads `completed` after its immediate
  tool_result ("started in background") while its output keeps arriving; the
  card's live-activity line still reflects the truth.
- Tests: `server/__tests__/ws-bridge-subagents.test.ts` through
  `attachCLITransport` + `feedCLIMessage` + a recording browser socket (see
  `ws-bridge-system-signals.test.ts` for the harness): spawn block → running
  entry in history and broadcast; tool_result → completed / failed; subagent
  assistant frames keep `parent_tool_use_id`; nested spawn sets `parent_id`;
  history merge test; `tool_progress` attribution.
- Docs: `backends/claude-code/README.md` (subagent frames, `parent_tool_use_id`
  meaning, the per-block frame + merge rule), `docs/reference/viewer-agent-protocol.md`
  §④ subsection "子代理归属", `docs/reference/project-guide.md` contracts row
  for `SubagentInfo` / `subagent_update` / `BackendModule.subagentSpawn`.

### 4.3 Kimi

No change. `backends/kimi-cli/README.md` gets one sentence: ACP carries no
subagent signal, so nothing is attributed and nothing is dropped.

## 5. Frontend behaviour (`src/`)

### 5.1 Store: `src/store/subagent-slice.ts` (new, registered in `store/index.ts` and `store/types.ts`)

```ts
export interface SubagentEntry extends SubagentInfo {
  firstSeenAt: number;
  lastActivityAt: number;
}
export interface SubagentSlice {
  subagents: Map<string, SubagentEntry>;
  /** null = root conversation. Transient UI state; never persisted. */
  viewingAgentId: string | null;
  streamingByAgent: Map<string, string>;
  activityByAgent: Map<string, Activity>;
  /** Root messages arrived while an agent view was open. */
  rootUnread: boolean;
  upsertSubagent(info: SubagentInfo, timestamp: number): void;
  /** A message attributed to `id` arrived: create a fallback entry if missing, bump lastActivityAt. */
  touchSubagent(id: string, timestamp: number): void;
  setViewingAgent(id: string | null): void;
  setAgentStreaming(id: string, text: string | null): void;
  setAgentActivity(id: string, activity: Activity | null): void;
  clearAgentTransients(): void;   // streaming + activity for all agents (result / disconnect)
  resetSubagents(): void;         // message_history rebuild
}
```

### 5.2 `src/ws.ts` routing

- `assistant` with `parent_tool_use_id`: append the message (it keeps
  `parentToolUseId`), `touchSubagent`, clear that agent's streaming; **do not**
  touch root `streaming`, `activity`, `sessionStatus`, task/process/cron
  extraction, or `bumpChangedFilesTick` (a subagent's `TodoWrite` is its own
  list). Root-attributed messages behave exactly as today; if an agent view is
  open, set `rootUnread`.
- `stream_event` with `parent_tool_use_id`: `message_start` resets that agent's
  buffer; text/thinking deltas append to `streamingByAgent[id]` and set
  `activityByAgent[id]`; `input_json_delta` file-write preview is root-only.
  Root deltas unchanged.
- `streamlined_text` with parent: attributed as today plus `touchSubagent`.
- `tool_progress` with parent: `setAgentActivity`, not root `setActivity`.
- `subagent_update`: `upsertSubagent`.
- `permission_request`: stored as today; the banner reads `parent_tool_use_id`
  to prefix the agent label.
- `result` / `cli_disconnected`: `clearAgentTransients()` in addition to the
  root clears.
- `message_history`: `resetSubagents()`, then fold `subagent_update` entries in
  order and `touchSubagent` for every attributed assistant entry.
- `src/replay-engine.ts::displayMessage`: `subagent_update` → `upsertSubagent`;
  `assistant` already carries `parentToolUseId`.

### 5.3 Components

- `ChatPanel.tsx`: `viewingAgentId` selects the visible timeline
  (`(m.parentToolUseId ?? null) === viewingAgentId`); system-role messages
  (errors, compaction markers, command output) are root-only. Renders
  `SubagentStrip` (root view, when any agent is alive) or the agent-view
  header with breadcrumb + back button (agent view). Streaming bubble and
  `ActivityIndicator` read the viewed agent's buffers in an agent view.
  Composer hidden in agent view, replaced by the read-only note + 返回主对话.
  `Esc` returns one level. Orphan roster entries (§3.4) get synthetic cards.
  `bottomRef` auto-follow works per view; switching views jumps to the tail.
- `MessageBubble.tsx`: `groupContentBlocks` emits `{ kind: "subagent", id, name, input }`
  for any `tool_use` whose id is in `subagents` or is some message's
  `parentToolUseId` (pass a `subagentIds: Set<string>` down; never grouped into
  `ToolGroupBlock`). Renders `SubagentCard`.
- `SubagentCard.tsx` (new): label, status dot (running amber pulse, idle zinc,
  completed green, failed red, interrupted zinc), elapsed while running, latest
  activity line derived from that agent's messages, live dot when
  `streamingByAgent` has text, model / `ctx N%`, `detail` on failure, 查看对话
  button → `setViewingAgent(id)`. Uses `cc-*` tokens, SVG icons, no emoji.
- `SubagentStrip.tsx` (new): chips for 主对话 + alive agents (+N overflow),
  active highlight, unread dot on 主对话.
- `ToolBlock.tsx`: icon mapping for `spawn_agent`/`send_input`/`wait_agent`/
  `close_agent`/`resume_agent`/`send_message`/`followup_task`/`interrupt_agent`/
  `list_agents` → the `agent` icon; labels in `tool-block.json`.
- `PermissionBanner.tsx`: when `request.parent_tool_use_id` names a roster
  entry, prefix the label.
- i18n: new namespace `subagent.json` in all seven locales (`en`, `zh-CN`,
  `zh-TW`, `ja`, `ko`, `de`, `es`), keys for strip/main, view/back,
  view/readonly_note, status/*, card/view, card/waiting, card/no_output,
  generic label. Use 子代理 (the guide's Agent = 代理) and change the existing
  `tool-block` `Task` label from 子智能体 to 子代理 for consistency.

### 5.4 Tests and evidence

- `src/store/__tests__/subagent-slice.test.ts`: upsert/touch/fallback, view
  switching, transient clears.
- `src/__tests__/ws-subagent-attribution.test.ts` via `handleParsedMessage`:
  a subagent text delta never touches root `streaming`; a subagent `assistant`
  never clears root streaming or flips root status; `subagent_update` folds
  live and from `message_history`; `tool_progress` with parent sets agent
  activity only; history with attributed messages but no roster produces a
  fallback entry.
- A `MessageBubble` grouping test (happy-dom, see `src/components/__tests__/`)
  pinning that spawn anchors are never collapsed into a tool group.
- Visual verification in a real browser is mandatory (`.claude/rules/frontend.md`):
  start a disposable `--dev` session, drive the UI with synthetic envelopes
  through `handleParsedMessage` (importable from `/src/ws.ts` in dev) and
  screenshot: root view with two cards (one running, one completed), the
  strip, an agent view with streaming text, the failed state, the orphan card
  from a pre-fix history shape. Save screenshots under the scratchpad and
  list their paths.

## 6. Lifecycle and failure behaviour

- **Startup / resume**: Codex `thread/resume` returns the main thread id; a
  resumed Codex session may replay child items with their `threadId` — they
  attribute correctly because the anchor rule does not depend on order. Claude
  `--resume` re-emits the last assistant message; the existing dedup paths are
  untouched because attribution is orthogonal to text equality.
- **Reload**: `message_history` rebuilds messages and roster; transient view
  state resets to root.
- **Replay / export / player**: `subagent_update` is in `messageHistory` and
  therefore in `SharedHistoryPackage`; the player's `ChatPanel` renders the
  same cards and views.
- **Disconnect mid-subagent**: `cli_disconnected` clears agent transients; the
  roster keeps the last known status (an honest "running" of an agent whose
  fate is unknown is preferable to inventing "completed").
- **Unknown-thread events on Codex** are registered, never dropped
  (`thread:<id>` fallback anchor, generic label).
- **Permission from a subagent**: still blocks the whole session (Codex
  approvals are per-request); the banner names the agent.

## 7. Out of scope (recorded, not built)

- Talking to a subagent from the UI (no backend channel).
- Mapping Claude `task_notification.task_id` to a background `Agent` call
  (the CLI does not expose the link; roster liveness for background agents is
  message-driven).
- Fetching a Codex child thread's history on demand (`thread/read`,
  `thread/items/list`) for subagents that ran while no browser was attached;
  the adapter attributes live events only, which is what `history.json` has for
  the root agent too.
- Codex `thread/status/changed` per child thread as a status source.

## 8. Work breakdown

| Task | Scope | Files | Depends on |
|---|---|---|---|
| TASK-0 | Contract | `server/session-types.ts`, `server/ws-bridge-replay.ts`, `core/types/agent-backend.ts`, `src/types.ts`, `backends/__tests__/index.test.ts`, `docs/reference/project-guide.md`, `docs/reference/viewer-agent-protocol.md` | — |
| TASK-1 | Codex adapter | `backends/codex/**`, `.claude/rules/backends.md` | TASK-0 |
| TASK-2 | Claude bridge + history merge | `server/ws-bridge.ts`, `server/ws-bridge-types.ts`, `server/ws-bridge-codex.ts` (persist `subagent_update`), `backends/claude-code/**`, `backends/kimi-cli/README.md`, `server/__tests__/` | TASK-0 |
| TASK-3 | Frontend | `src/**` | TASK-0 |
| TASK-4 | Integration verification | real Codex + Claude sessions in a browser | TASK-1..3 |

## TASK-0 — Contract

Acceptance: the types in §3.1 and §3.3 exist exactly as specified (names and
field semantics; JSDoc carries the attribution definition from §2.1); `src/types.ts`
re-exports `SubagentInfo` and `SubagentStatus`; `isHistoryBackedEvent` returns
true for `subagent_update` (pin with a test next to the existing
`ws-bridge-replay.test.ts` cases); the Claude manifest implements
`subagentSpawn` for `Task` and `Agent` and `backends/__tests__/index.test.ts`
pins the mapping (`description` → label, `subagent_type` → detail; non-spawn
tool → undefined; codex and kimi modules leave it undefined);
`docs/reference/project-guide.md` gains one contracts-table row;
`docs/reference/viewer-agent-protocol.md` §④ gains a subsection "子代理归属"
stating the invariants of §2.1 and the envelope; `bun run typecheck` passes;
`bun run test:server` and `bun test backends/__tests__/index.test.ts` pass.
No behaviour change anywhere else.

## TASK-1 — Codex adapter

Implement §4.1 completely. Acceptance: the tests listed in §4.1 exist and
pass; the existing codex adapter suite passes; `bun run typecheck` passes;
`backends/codex/README.md` and `.claude/rules/backends.md` updated as
described; no file outside `backends/codex/**` and `.claude/rules/backends.md`
is touched except for `.claude/references/` if evidence needs a longer note.
The `emittedToolUseIds`/streaming/reasoning/`currentTurnId` state is per
thread (no residual flat field for any of them).

## TASK-2 — Claude bridge, history merge, persistence on both bridges

Implement §4.2 and §4.3, plus: `server/ws-bridge-codex.ts::onAdapterMessage`
persists `subagent_update` to `messageHistory` before broadcasting (the codex
adapter emits it; the bridge owns history). Acceptance: the tests listed in
§4.2 pass; a `ws-bridge-codex.test.ts` case pins persistence of
`subagent_update`; `bun run test:server` passes; `bun run typecheck` passes;
docs updated as listed. Do not touch `backends/codex/codex-adapter.ts` or
`src/**`.

## TASK-3 — Frontend

Implement §5 completely. Acceptance: tests in §5.4 pass; `bun run test:frontend`
passes; `bun run typecheck` passes; screenshots listed in §5.4 exist and are
referenced in the report; all seven locales have the new namespace and the
`Task` label change; no `src/**` file outside the listed areas changes
semantics for single-agent sessions (root view with zero subagents renders
exactly as before — pin with a test that a history without attribution yields
no strip and no cards). Do not touch `server/**` or `backends/**`.

## TASK-4 — Integration verification

With TASK-1..3 merged: start a disposable Codex session with a prompt that
makes the agent spawn a subagent and wait for it, and a disposable Claude Code
session that uses the `Agent`/`Task` tool; observe in a real browser that the
root conversation never shows the subagent's words, the card appears with a
live status, the agent view opens and closes, the root status pill stays
`running` until the root turn ends, `num_turns` increments once per root turn,
`history.json` contains `subagent_update` entries and multi-block Claude
messages, and a reload rebuilds the same cards. Capture screenshots and the
relevant `history.json` excerpts as evidence.
