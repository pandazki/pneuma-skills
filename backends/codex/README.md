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
| `__tests__/`        | `manifest.test.ts` (manifest shape), `codex-adapter.test.ts` (adapter unit tests), `lifecycle.test.ts` (six shared scenarios). |

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
// nested under `tokenUsage.total`, legacy was flat. Adapter handles both.
{ "method": "thread/tokenUsage/updated", "params": {
    "tokenUsage": { "total": { "inputTokens": 132, "outputTokens": 41 }, "modelContextWindow": 128000 }
} }

// turn/completed — adapter then SYNTHESISES a Pneuma `result` envelope
// (Codex has no native "all done with this turn" message that matches
// Claude Code's `result`).
{ "method": "turn/completed", "params": { "turn": { "status": "completed" }, "usage": {...} } }
```

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
| `result`                | **Synthesised** on `turn/completed` — Codex has no native equivalent. |
| `permission_request`    | Synthesised from any of the seven approval-style JSON-RPC requests above. |
| `session_update`        | Native-ish — adapter pushes one whenever model / cost / context-percent / available models change. |
| `status_change`         | Synthesised from `thread/status/changed`. |

## Capabilities + why

| Flag           | Value | Justification |
|----------------|-------|---------------|
| `streaming`    | `true`  | `item/agentMessage/delta` and `item/reasoning/textDelta` arrive token-by-token. |
| `resume`       | `true`  | `thread/resume` with the saved `threadId` rehydrates state; falls back to `thread/start` if the rollout file was cleaned up. |
| `permissions`  | `true`  | Seven different approval-request methods are wired (see Permission round-trips above). |
| `toolProgress` | `false` | We surface "Running… (Ns)" via `handleItemUpdated`, but it's a coarse text update — there is no incremental progress integer the UI can chart, so we report `false` to match what the UI reasonably gates on. |
| `modelSwitch`  | `true`  | `set_model` records the new model on the adapter; it's applied to the next `turn/start` (Codex is per-turn model selection, not a stateful flip). |

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
