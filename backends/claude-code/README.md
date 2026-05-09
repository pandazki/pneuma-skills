# Claude Code backend

This backend talks to Anthropic's Claude Code CLI (`claude`) over **stdio
NDJSON** using the `--output-format stream-json` / `--input-format stream-json`
contract. The CLI is positioned by Anthropic as their official headless surface
("…built for scripted and automated use") so this directory's job is to spawn
it, pipe its stdout to the bridge, and deliver user turns one NDJSON line at a
time on its stdin.

Reference docs: <https://docs.anthropic.com/en/docs/claude-code/overview>.

## Files in this directory

| File              | Responsibility |
|-------------------|----------------|
| `manifest.ts`     | `BackendModule` self-description: install layout, capabilities, default model list, `createBackend` / `createBridgeBackend` (returns `null` — see Lifecycle gotchas), `checkRequirements`. |
| `index.ts`        | `ClaudeCodeBackend` — implements the `AgentBackend` interface and proxies through to `CliLauncher`. Pure shape adaptation; no business logic. |
| `cli-launcher.ts` | `CliLauncher` — owns the `node:child_process` for `claude --print …`, NDJSON line buffering on stdout, the writer side of stdin, and process exit handling. |
| `__tests__/`      | `manifest.test.ts` (BackendModule shape) + `lifecycle.test.ts` (six shared scenarios — see `backends/__tests__/lifecycle-harness.ts`). |

## Protocol shape

The wire format is whatever `claude --print --output-format stream-json
--input-format stream-json --include-partial-messages --include-hook-events
--verbose --permission-mode bypassPermissions [--model X] [--resume <id>]`
produces. **None of these envelopes are synthesised** — the CLI emits them
natively.

Inbound (CLI → server, one JSON object per `\n`-delimited line):

```jsonc
// system.init — identifies the CLI process. Fires AFTER the first user prompt.
{
  "type": "system",
  "subtype": "init",
  "session_id": "9c…",          // CC's internal session id; this is what `--resume` accepts
  "model": "claude-opus-4-7",
  "cwd": "/path/to/workspace",
  "tools": ["Read", "Edit", …],
  "claude_code_version": "2.1.118",
  "mcp_servers": [{ "name": "…", "status": "connected" }],
  "agents": [], "slash_commands": [], "skills": [],
  "permissionMode": "bypassPermissions"
}

// assistant — model output, often delivered as multiple deltas before
// the final consolidated message arrives.
{
  "type": "assistant",
  "message": {
    "id": "msg_01…",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Sure — running it now." },
      { "type": "tool_use", "id": "toolu_01…", "name": "Bash", "input": { "command": "ls" } }
    ],
    "model": "claude-opus-4-7",
    "usage": { "input_tokens": 42, "output_tokens": 12, … }
  },
  "parent_tool_use_id": null,
  "session_id": "9c…"
}

// user — synthetic echoes that include tool_result blocks.
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "tool_result", "tool_use_id": "toolu_01…", "content": "…" }
    ]
  }
}

// result — turn end. Carries cumulative cost / usage; bridge pushes this to UI.
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 4123, "duration_api_ms": 3892,
  "is_error": false,
  "num_turns": 3,
  "total_cost_usd": 0.0214,
  "usage": { "input_tokens": …, "output_tokens": …, "cache_*": … },
  "uuid": "…",
  "session_id": "9c…"
}

// stream_event — partial-content deltas (gated on `--include-partial-messages`).
// system.status / system.compact_boundary / system.task_notification — runtime status updates.
// control_request:can_use_tool — permission prompt (only when not in bypass mode).
```

Outbound (server → CLI stdin, one JSON object per `\n`-delimited line):

```jsonc
{
  "type": "user",
  "message": { "role": "user", "content": "Reply with the single word: hi" },
  "parent_tool_use_id": null,
  "session_id": "9c…"
}

// or when running with the permission prompt path:
{ "type": "control_response", "response": { "subtype": "can_use_tool", "behavior": "allow", … } }

// runtime model switch (Claude accepts this mid-session):
{ "type": "set_model", "model": "claude-haiku-4-5-20251001" }
```

## Capabilities + why

| Flag             | Value | Justification |
|------------------|-------|---------------|
| `streaming`      | `true`  | `--include-partial-messages` makes CC emit `stream_event` deltas as the model writes. |
| `resume`         | `true`  | `--resume <session_id>` rehydrates the prior conversation; we capture `session_id` from `system.init` and persist it as `agentSessionId`. |
| `permissions`    | `true`  | CC supports `control_request:can_use_tool` round-trips (not used in default `bypassPermissions` mode but the protocol path is wired). |
| `toolProgress`   | `true`  | CC exposes long-running tool progress via `stream_event` and tool_use streaming. |
| `modelSwitch`    | `true`  | `set_model` mid-session is honoured by CC (next turn uses the new model). |
| `scheduling`     | `true`  | Background tasks via the `Task` tool family. |
| `costTracking`   | `true`  | `result.total_cost_usd` + per-message `usage` are real numbers Anthropic computes server-side. |
| `contextWindow`  | `true`  | `system.compact_boundary` plus per-result usage fields let the UI compute a "% of context used" indicator. |

## Install layout

| Field              | Value           |
|--------------------|-----------------|
| `skillsDir`        | `.claude/skills` |
| `instructionsFile` | `CLAUDE.md`     |

The CLI reads `CLAUDE.md` from the working directory (and walks parents) plus
any directory ending in `.claude/skills/<name>/` as installable skills. This
is the layout the upstream CLI documents at
<https://docs.anthropic.com/en/docs/claude-code/skills> and
<https://docs.anthropic.com/en/docs/claude-code/memory>; we don't override
the convention because the CLI itself wires the discovery logic.

## Lifecycle gotchas

- **`system.init` fires AFTER the first user prompt, not at spawn.** The CLI
  needs an actual turn before it emits the init envelope (Task 10 discovery).
  Any code that pre-waits on `session_init` before sending the first prompt
  will deadlock — see `backends/__tests__/lifecycle-harness.ts:507` for the
  workaround the test harness uses.
- **Claude Code uses the legacy stdio path on `WsBridge` directly.** It does
  NOT implement `BridgeBackend`; `manifest.createBridgeBackend` returns `null`,
  and the launcher's stdio handlers are wired into `WsBridge.attachCLITransport`
  / `feedCLIMessage` from `bin/pneuma.ts`. The pre-existing
  `routeCLIMessage(session, msg)` pipeline (`server/ws-bridge.ts:510`) handles
  every envelope shape verbatim — adding a new envelope means extending that
  switch, not the bridge interface.
- **`CLAUDECODE` env var must be unset before spawn.** CC sets `CLAUDECODE=1`
  on the processes it spawns; if our parent shell already has it set (because
  the user is running pneuma from inside a `claude` session), the spawned
  child short-circuits as a "nested invocation" and exits abnormally. The
  launcher explicitly sets `CLAUDECODE: undefined` in the spawn env to defeat
  this (see `cli-launcher.ts:165`).
- **Each NDJSON message must end with `\n`.** The launcher's `sendInput`
  helper adds the newline if the caller forgot; downstream consumers all rely
  on `\n` to delimit complete envelopes.
- **`node:child_process`, not `Bun.spawn`.** Bun's `proc.stdout` ReadableStream
  occasionally closes prematurely on long-lived stdio pipes. `claude` is a
  long-running process — switching to `node:child_process` preserves stream
  liveness and matches what the codex backend does for the same reason.
- **`--resume` failures look like an immediate exit.** When the supplied
  `session_id` doesn't exist (rollout file deleted, version upgrade), the CLI
  exits inside the first 5 seconds. The launcher detects this via uptime
  (`cli-launcher.ts:225`) and clears `cliSessionId` so the next launch starts
  fresh instead of looping on the same dead id.
- **Stdout is chunked, not line-aligned.** `pipeStdoutNDJSON` accumulates
  partials in a leftover buffer and only dispatches the prefix up to the last
  newline. Don't strip this — slow connections (or large `tool_use` payloads)
  can land mid-line.
- **`bypassPermissions` is the default.** This matches Pneuma's existing
  behaviour where the agent acts autonomously. Switching to a permissioned
  mode would require wiring `control_request:can_use_tool` round-trips
  through to the existing browser permission UI; the protocol plumbing is
  there, but no current product surface exposes it.
- **Anthropic banned `--sdk-url`.** CC 2.1.118+ rejects `--sdk-url
  ws://localhost:PORT` (locked to an Anthropic-host whitelist). The
  `_port` constructor parameter on `CliLauncher` is preserved for backwards
  compatibility but is ignored — there is no longer any WebSocket endpoint to
  connect to. Any old code passing a port number won't break, it just
  doesn't do anything.
- **Empty-content `assistant` messages are tool-only.** When CC emits an
  `assistant` envelope whose `content` array is just `tool_use` blocks (no
  `text`), the chat-panel `MessageBubble` returns `null`. Don't try to render
  them as empty bubbles — the tool-use cards downstream do the user-facing
  rendering.

## Adding a new model

`manifest.ts:defaultModels` is a static list of `{ id, label, icon }` entries.
Update it in the same commit that bumps the package version; the launcher
shows these in the model picker. The CLI itself accepts any model id Anthropic
serves (model id is passed to `claude --model <id>`), so the static list is
purely a UX hint — users can always type a different id into the picker if
they need to. There is no `available_models` discovery endpoint on Claude
Code today (compare codex which emits `model/list`); a future CLI version
could add one and the manifest list would then become a fallback.

## References

Upstream:
- Claude Code CLI overview — <https://docs.anthropic.com/en/docs/claude-code/overview>
- Skills / memory file conventions — <https://docs.anthropic.com/en/docs/claude-code/skills>, <https://docs.anthropic.com/en/docs/claude-code/memory>
- Stream-json IO format — `claude --help` (`--output-format stream-json`, `--input-format stream-json`)
- Convergent prior art on the stdio shape — Crystal, Conductor, opcode

Pneuma:
- `core/types/agent-backend.ts` — `AgentBackend` + `BackendModule` contract this backend implements
- `server/ws-bridge.ts:510` (`routeCLIMessage`) — the switch claude-code envelopes feed into
- `server/ws-bridge.ts:583` (`handleSystemMessage`) — concrete handling of `system.init` / `status` / `compact_boundary`
- `server/skill-installer.ts` + `manifest.skillsDir`/`instructionsFile` — how the `.claude/skills` + `CLAUDE.md` layout is materialised
- `bin/pneuma.ts` — wires `CliLauncher.setHandlers` into `WsBridge.attachCLITransport` / `feedCLIMessage`
- `backends/__tests__/lifecycle-harness.ts` — the six shared scenarios this backend's `lifecycle.test.ts` re-uses
- `CLAUDE.md` "Known Gotchas" — Claude-related entries (`CLAUDECODE`, `bypassPermissions`, NDJSON `\n`, empty assistant messages)
