# Kimi CLI backend

This backend talks to Moonshot AI's Kimi CLI (`kimi`) over **stdio NDJSON**
using `kimi --print --input-format stream-json --output-format stream-json -y`.
Each line is one OpenAI-Chat-Completions-style message
(`{role, content, tool_calls?, tool_call_id?}`); there is **no system / result
/ stream_event envelope** native to the protocol, so the bridge in this
directory synthesises every "session lifecycle" envelope the rest of Pneuma
expects.

Reference: <https://moonshotai.github.io/kimi-cli/> (and the upstream source
<https://github.com/MoonshotAI/kimi-cli>). Wire shapes verified empirically
against `kimi-cli v1.41.0`.

## Files in this directory

| File              | Responsibility |
|-------------------|----------------|
| `manifest.ts`     | `BackendModule`: install layout (`.kimi/skills` + `AGENTS.md`), capabilities, `createBackend` (constructs `KimiCliBackend`), `createBridgeBackend` (constructs `KimiBridge`). No static `defaultModels` — kimi's model list is dynamic. |
| `index.ts`        | `KimiCliBackend` — implements `AgentBackend`, exposes the additional `onAdapterCreated` / `getAdapter` hooks the bridge needs to attach. |
| `cli-launcher.ts` | `KimiCliLauncher` — owns the `node:child_process` spawn, **pre-allocates the kimi session UUID** and passes it via `-r <uuid>`, wires the `KimiAdapter` between the process pipes and the bridge. |
| `kimi-adapter.ts` | `KimiAdapter` — buffers stdout NDJSON, parses each line through `protocol.ts`, fans `PneumaMessage` out to the bridge; watches stderr for `kimi -r <uuid>` and seeds the session id; sends `SIGINT` for in-step interrupts (vs `SIGTERM` for full kill). |
| `protocol.ts`     | Pure parsing + translation: `parseKimiLine` (string → `KimiMessage`), `kimiToPneumaMessages` (kimi shape → Pneuma shape), `pneumaUserToKimi` (back), and `extractKimiSystemMetadata` (lifts `<system>…</system>` headers out of tool results into a separate metadata field). No IO — fully unit-testable. |
| `__tests__/`      | `manifest.test.ts`, `protocol.test.ts` (translation + metadata extraction), `kimi-adapter.test.ts` (adapter behaviour with mock streams), `lifecycle.test.ts` (six shared scenarios). |

## Protocol shape

Every line on stdin / stdout is one OpenAI-Chat-Completions-style message.
There is no JSON-RPC, no envelope wrapper, no per-message id from the
protocol layer.

### Outbound (server → kimi stdin)

```jsonc
// Single user turn — written verbatim, one NDJSON line per turn.
{ "role": "user", "content": "Reply with the single word: hi" }
```

### Inbound (kimi → server stdout)

```jsonc
// Plain assistant — OpenRouter-provider variant: `content` is a string.
{ "role": "assistant", "content": "Sure — here's the file." }

// Assistant with reasoning — managed `kimi-code` subscription with thinking
// enabled: `content` is an array of `{type:"think"}` and `{type:"text"}` parts.
// The translator emits a Pneuma `thinking` block followed by a `text` block.
{ "role": "assistant", "content": [
    { "type": "think", "think": "First, I'll list the files…", "encrypted": null },
    { "type": "text", "text": "I'll list and then summarise." }
] }

// Assistant with a tool call — translates to a Pneuma `tool_use` block.
// `function.arguments` is a JSON-encoded STRING; the translator JSON.parses
// it (falling back to `{ _raw: "<string>" }` on parse failure).
{ "role": "assistant", "tool_calls": [
    { "type": "function", "id": "call_abc", "function": {
        "name": "Shell", "arguments": "{\"command\":\"ls -la\"}"
    } }
] }

// Tool result — translates to a Pneuma `tool_result` block. The agent-facing
// `<system>…</system>` header (added by every kimi tool wrapper, see
// `kimi_cli/agents/default/system.md`) is lifted into `tool_result.metadata`.
{ "role": "tool", "tool_call_id": "call_abc", "content":
  "<system>Command executed successfully.</system>\ntotal 0\n…"
}
```

### Synthesised envelopes (KimiBridge → browser)

Kimi never emits these; the bridge fabricates them so the chat panel's state
machine (model badge, idle/busy, thinking indicator, "result" status pill)
behaves identically across backends:

| Envelope                          | When fabricated |
|-----------------------------------|-----------------|
| `session_init`                    | Once at `bridge.attach()`. Hard-codes `model: "kimi"` and `agent_version: "kimi-cli"` because nothing in the kimi protocol reports either. |
| `cli_connected` / `cli_disconnected` | At attach / on adapter disconnect. |
| `stream_event:message_start`      | Every time a user message is forwarded TO kimi. The frontend's `case "stream_event"` handler sets `activity={phase:"thinking"}` so the user sees a spinner while kimi reasons silently before its first emission. |
| `result`                          | On every turn yield (assistant message whose last content block is *not* `tool_use`). Carries the synthesised `duration_ms`, increments `num_turns`, and tells the frontend the turn is over. |
| `session_update` (`cli_busy`)     | After every emission, to keep the input lock state in sync. |

### Browser-outgoing types kimi explicitly drops

Kimi has no JSON-RPC verbs for permission flow, runtime model switch, or
session-lifecycle control. The bridge's `KIMI_UNSUPPORTED_MESSAGE_TYPES` set
explicitly drops the following so they don't queue forever in
`session.pendingMessages`:
`permission_response`, `set_model`, `end_session`,
`update_environment_variables`, `stop_task`. The frontend gates the
corresponding UI on `agent_capabilities` — reaching the unsupported branch
typically means a stale UI element.

## Capabilities + why

| Flag           | Value | Justification |
|----------------|-------|---------------|
| `streaming`    | `true`  | We do receive incremental output, even though the protocol is line-per-message; the bridge synthesises a `stream_event:message_start` so the UI shows immediate feedback. |
| `resume`       | `true`  | `kimi -r <uuid>` accepts any UUID and creates-or-resumes a session with that id. The launcher pre-allocates the UUID at spawn so we know it before kimi prints its `kimi -r <uuid>` resume hint at process exit. |
| `permissions`  | `false` | Kimi's `--print` mode does not expose a permission round-trip. Tool calls execute under the CLI's own approval rules (`-y` skips them); the browser permission UI is hidden via this flag. |
| `toolProgress` | `false` | No incremental progress events. Tool results arrive as a single `role: "tool"` line. |
| `modelSwitch`  | `true`  | Initial model is set via `--model`. Mid-session switches are not honoured by the CLI today, so `set_model` is in the unsupported set; manifest still claims `true` because picker discovery / launch-time selection both work. (If kimi ever wires runtime model switch, drop `set_model` from the unsupported set.) |

## Install layout

| Field              | Value           |
|--------------------|-----------------|
| `skillsDir`        | `.kimi/skills`  |
| `instructionsFile` | `AGENTS.md`     |

Per `kimi_cli/soul/agent.py:88-132`, kimi explicitly reads `AGENTS.md` and
`.kimi/AGENTS.md` from the working directory; **it does NOT read `CLAUDE.md`**.
The skill installer's per-backend handler routes both files through
`AGENTS.md` for kimi, with skills landing in `.kimi/skills/<name>/`. We don't
override the convention because the CLI's loader hard-codes these paths.

## Lifecycle gotchas

There are five non-obvious behaviours; each maps directly to a `CLAUDE.md`
"Kimi-cli gotchas" entry:

- **Pre-allocated session UUID.** `kimi --print --output-format stream-json`
  only prints its `kimi -r <uuid>` resume hint to **stderr at process exit**,
  never per-turn. We can't rely on capturing it from a live session, so the
  launcher pre-generates a UUID and passes it via `-r <uuid>`; kimi accepts
  any UUID and creates or resumes a session with that id. The adapter's
  `seedSessionId(...)` is fired immediately so listeners that subscribed
  *after* spawn (e.g. the WsBridge attaches after `backend.launch()` returns)
  still receive the id via `onSessionId`'s replay-on-subscribe path
  (`kimi-adapter.ts:71`).
- **Synthesised lifecycle envelopes.** As above (`session_init`, `result`,
  `stream_event:message_start`). If you remove any of them, the chat panel
  visually breaks: no model badge, perpetual "Running…" pill, no thinking
  indicator. The synthesis lives in `KimiBridge.attach` (`server/ws-bridge-kimi.ts:103`)
  and `KimiBridge.onAdapterMessage` (`server/ws-bridge-kimi.ts:251`).
- **Two assistant content shapes.** `KimiAssistantMessage.content` is
  `string | KimiAssistantContentPart[]`. The OpenRouter provider sends the
  string form; the managed `kimi-code` subscription with `default_thinking
  = true` sends an array of `{type:"think"|"text"}` parts. Both are
  translated by `kimiToPneumaMessages` (`protocol.ts:138`) — `think` parts
  become Pneuma `thinking` blocks, `text` parts become `text` blocks, in
  emission order so the chat panel renders reasoning before its answer.
- **Tool-result `<system>` headers.** Every kimi tool wrapper (`Shell`,
  `ReadFile`, `WriteFile`, …) prepends an agent-facing status line of the
  form `<system>…</system>` to its result. These markers are noise for human
  display; `extractKimiSystemMetadata` lifts them into a separate `metadata`
  field on the `tool_result` block so the chat panel can render them as a
  small status header above the actual stdout / file body. **Don't echo the
  raw header into chat without stripping** — it will read like the model is
  shouting a `<system>` tag at the user.
- **`WriteFile` struggles with long content in `--print` mode.** k2.6 occasionally
  emits truncated / garbled JSON-quoted strings inside `function.arguments`
  for `WriteFile` calls > ~30 lines (the model itself produces the bad JSON;
  we just fail to parse it cleanly via the `{_raw: …}` fallback). Slide /
  webcraft skills should advise heredoc + `Shell` for files >>30 lines until
  the upstream model behaviour improves. Default `~/.kimi/config.toml` runs
  with `default_thinking = true` for better generation quality on structured
  content.

Additional adapter-level details:

- **`SIGINT` for interrupt, `SIGTERM` for kill.** `kimi --print`'s signal
  handler turns `SIGINT` into an internal `cancel_event` that aborts the
  in-flight LLM call / tool but keeps the process alive to read the next
  user message. `SIGTERM` would tear the whole process down. The bridge's
  `interrupt` path in `ws-bridge-kimi.ts:188` therefore calls
  `adapter.interrupt()` (which sends `SIGINT`) and then immediately pushes
  an `cli_busy: false` snapshot so the UI input unlocks (kimi may not emit
  anything before the next user turn, and we'd otherwise leave the chat
  stuck on "Running").
- **Stderr is parsed for the resume hint, but stderr is also where kimi
  logs.** The adapter forwards every stderr chunk to `process.stderr` for
  diagnostics; the `kimi -r <uuid>` regex match is dedup'd so listeners
  fire exactly once per unique id, even if kimi prints it multiple times
  during a session.
- **The bridge's `pendingMessages` flush is parser-tolerant.** Queued user
  messages can be in two formats (`{type:"user", message:{content}}` from
  the legacy NDJSON path, or `{type:"user_message", content}` from the
  current bridge interface). Both are unwrapped to a plain string in
  `KimiBridge.attach` (`server/ws-bridge-kimi.ts:131`) before being handed
  to `sendToAdapter`.
- **`node:child_process`, NOT `Bun.spawn`.** Same reason as Codex: Bun's
  `proc.stdout` ReadableStream can close prematurely on long-lived stdio.
- **`CLAUDECODE` env var must be unset.** Same nested-invocation guard the
  Claude / Codex launchers use; kept consistent so a user running pneuma
  from inside a `claude` session doesn't poison the kimi spawn.

## Adding a new model

Same story as Codex — there is no static `defaultModels` list. Today the
launcher passes `--model <id>` if `AgentLaunchOptions.model` is provided;
otherwise kimi picks its configured default. To add a new model:

1. Confirm your local kimi-cli install has the model registered in
   `~/.kimi/config.toml` (or the global configuration source kimi reads).
2. Pass the model id via `AgentLaunchOptions.model` at launch — the launcher
   forwards it to `--model <id>`. Mid-session model swap is not supported
   today (see `KIMI_UNSUPPORTED_MESSAGE_TYPES` containing `set_model`); a new
   session has to be spawned for a different model.
3. If kimi grows a model-discovery RPC similar to Codex's `model/list`, the
   adapter could populate `available_models` via a `session_update` —
   currently the picker shows "(launcher selection only)" because the
   browser receives no enumerated list.

## References

Upstream:
- Kimi CLI docs — <https://moonshotai.github.io/kimi-cli/>
- Kimi CLI source — <https://github.com/MoonshotAI/kimi-cli>
- AGENTS.md / `.kimi/AGENTS.md` discovery — `kimi_cli/soul/agent.py:88-132`
- Tool `<system>…</system>` header convention — `kimi_cli/agents/default/system.md` and the per-tool wrappers under `kimi_cli/tools/`
- `--print` mode signal handling (SIGINT → cancel_event) — `kimi_cli/ui/print/__init__.py`

Pneuma:
- `core/types/agent-backend.ts` — `AgentBackend` + `BackendModule` contract this backend implements
- `server/ws-bridge-kimi.ts` — `KimiBridge`; documents the synthesis machinery and the unsupported-types set inline
- `server/ws-bridge-backend.ts` — `BridgeBackend` interface
- `server/skill-installer.ts` + `manifest.skillsDir`/`instructionsFile` — how `.kimi/skills` + `AGENTS.md` get materialised per session
- `bin/pneuma.ts` — wires `KimiCliBackend.onAdapterCreated` so the WsBridge can `attach()` the bridge once the adapter exists
- `backends/__tests__/lifecycle-harness.ts` — the six shared scenarios this backend's `lifecycle.test.ts` re-uses
- `CLAUDE.md` "Known Gotchas" → "Kimi-cli gotchas" — the five sub-items expanded above
