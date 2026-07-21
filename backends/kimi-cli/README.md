# Kimi backend (Kimi Code ACP)

This backend talks to Moonshot AI's **Kimi Code CLI** (`kimi`, >= 0.26.0) over
**ACP — the Agent Client Protocol**: line-delimited JSON-RPC 2.0 on
stdin/stdout of a long-lived `kimi acp` process. One process per Pneuma
session, alive across turns.

Docs: <https://moonshotai.github.io/kimi-code/>. Every wire shape referenced
below was verified against live frames captured from `kimi acp` 0.26.0 —
not read from protocol documentation.

> **History / the product swap.** The `kimi` binary used to be the Python
> `kimi-cli` v1.x (`uv tool install kimi-cli`), which this backend previously
> drove via `--print --input-format stream-json` NDJSON. Moonshot replaced the
> product wholesale: Kimi Code is a Node SEA binary whose version numbering
> restarted at 0.x (old `1.41.0` → new `0.26.0` — **never** gate on semver),
> the print-mode stream-json flags are gone, and the skill discovery layout
> changed. This backend supports **only Kimi Code**; there is no legacy
> fallback. `checkRequirements()` probes for the `acp` subcommand, which only
> Kimi Code has.

## Files in this directory

| File               | Responsibility |
|--------------------|----------------|
| `manifest.ts`      | `BackendModule`: install layout (`.kimi-code/skills` + `AGENTS.md`), capabilities, `createBackend`, `createBridgeBackend`, the acp-subcommand requirement probe, `toolFileRef` for kimi's `path`-keyed tool inputs. No static `defaultModels` — the model list is dynamic. |
| `index.ts`         | `KimiCliBackend` — implements `AgentBackend`, exposes the `onAdapterCreated` / `getAdapter` hooks the bridge needs to attach. |
| `cli-launcher.ts`  | `KimiCliLauncher` — owns the `node:child_process` spawn of `kimi acp` (no other flags), PATH enrichment, SIGTERM→SIGKILL kill sequence, session/process/adapter maps. |
| `kimi-adapter.ts`  | `KimiAdapter` — the ACP client: handshake, prompt queue, permission round trip, cancel, model + mode switching, event fan-out to the bridge. |
| `acp-transport.ts` | `AcpTransport` — id-correlated JSON-RPC 2.0 over node streams. Modeled on codex's `StdioTransport.fromNodeStreams` (Node streams dodge a Bun `ReadableStream` premature-close bug). Supports timeout-less calls for `session/prompt`. |
| `protocol.ts`      | Pure wire types + `AcpSessionTranslator`, the stateful `session/update` → `PneumaMessage` state machine. No IO — fully unit-testable. |
| `__tests__/`       | `protocol.test.ts` (translator, fixtures from captured frames), `kimi-adapter.test.ts` (adapter vs `fake-acp-server.ts`), `manifest.test.ts`, `lifecycle.test.ts` (six shared scenarios against the real CLI). |

The bridge half lives in `server/ws-bridge-kimi.ts` (`KimiBridge`).

## Protocol shape

### Handshake

```
client → initialize        {protocolVersion:1, clientCapabilities:{fs:{...false}, terminal:false}}
       ← result            {agentCapabilities, authMethods, agentInfo:{name,version}}
client → session/new       {cwd:<abs>, mcpServers:[]}
       ← result            {sessionId:"session_<uuid>", configOptions:[...]}
```

- `agentInfo.version` feeds `agent_version`; `configOptions` carries the
  **model list** (`id:"model"`: `currentValue` + `options[]`) and the
  **permission mode** (`id:"mode"`: `default`/`plan`/`auto`/`yolo`).
- We declare `fs`/`terminal` client capabilities **false** — Pneuma provides
  no client-side file or terminal services. Kimi's builtin tools (Write /
  Read / Bash / Glob …) execute agent-side regardless; verified end-to-end.
- **Resume**: `session/resume {sessionId, cwd}`. Verified to replay **no**
  history (only an `available_commands_update`) — exactly right, since Pneuma
  rehydrates chat from its own `history.json`. `session/load` is deliberately
  NOT used: it replays the whole conversation as update frames, which would
  duplicate the chat. Failed resume falls back to `session/new`.
- **Permission posture**: `AgentLaunchOptions.permissionMode` maps onto ACP
  session modes via `session/set_mode` — unset/`bypassPermissions` → `yolo`
  (matching Claude's default `--permission-mode bypassPermissions` posture),
  `acceptEdits` → `auto`, `plan` → `plan`, anything else → `default` (ask).

### Turns

`session/prompt {sessionId, prompt:[{type:"text",text}, {type:"image",data,mimeType}…]}`
**resolves only at end of turn** with `{stopReason:"end_turn"|"cancelled"|…}`.
All intermediate output arrives as `session/update` notifications. The
resolution is the bridge's turn boundary — the `result` envelope and idle
transition are driven by this real signal, nothing is synthesized from
message-shape heuristics. The adapter serializes turns client-side (one
in-flight prompt; later sends queue). The call runs with **no RPC timeout**
(a turn legitimately blocks on human permission answers); transport close
still rejects it.

Interrupt = the `session/cancel` **notification** (no `id`, no signals). The
in-flight prompt then resolves with `stopReason:"cancelled"`.

### `session/update` kinds (all verified live)

| kind | handling |
|------|----------|
| `agent_message_chunk` | accumulate → flush as a `text` block at boundaries; also emitted as a live `text_delta` stream event |
| `agent_thought_chunk` | accumulate → flush as a `thinking` block; live `thinking_delta` |
| `tool_call` | records the tool. **`title` on this start frame is the real tool name** ("Write", "Bash", …) |
| `tool_call_update` | see the streaming trap below |
| `available_commands_update` | surfaced as `slash_commands` in session state |
| `user_message_chunk` | ignored (only appears in `session/load` replay) |
| `config_option_update` | full refreshed `configOptions` — re-syncs model state |

**The tool-argument streaming trap.** A single `toolCallId` fires many
`tool_call_update` frames whose `content[].content.text` is a *growing
partial JSON string* of the arguments (status already `in_progress`), and
whose `title` mutates into a human phrase ("Writing out.txt"). Never parse
those partials and never take the tool name from an update frame. The
structured input arrives exactly once as a real `rawInput` object — that
frame emits the `tool_use` block (and feeds `toolFileRef`; e.g. Write's
`rawInput` is `{path, content}` — `path`, not `file_path`). The terminal
frame (`status:"completed"|"failed"`) carries `rawOutput` → `tool_result`
(`is_error` on failure).

### Agent → client requests

`session/request_permission {sessionId, options:[{optionId,kind}], toolCall:{toolCallId,title,content}}`
— the turn **blocks** until the client responds
`{outcome:{outcome:"selected",optionId}}`. The bridge broadcasts a
`permission_request` (rendered by the generic `PermissionBanner`); browser
`allow`/`allowAlways`/`deny` map onto the offered `allow_once` /
`allow_always` / `reject_once` option kinds. A cancelling client MUST answer
pending permission requests with `{outcome:{outcome:"cancelled"}}` — the
adapter does this on `interrupt()` and on disconnect, otherwise the turn
deadlocks. Unknown agent→client requests are refused with the cancelled
outcome rather than ignored (ignoring would deadlock the turn).

Note the agent numbers its client-bound requests in **its own id space**
(starting at 0) — ids can numerically collide with our outbound ids;
direction disambiguates.

### Model switching

`session/set_model {sessionId, modelId}` — verified to persist for the
session (survives resume). The available list is never fetched separately;
it arrives with session setup and on every `config_option_update`.

## Capabilities

`streaming: true, resume: true, permissions: true, toolProgress: true,
modelSwitch: true` — permissions and toolProgress are real ACP features
(they were `false` under the old print-mode protocol, which had neither).
Declared in **two places** (`manifest.ts` + `index.ts`) — keep them in sync
(a manifest test pins this).

## Skill install layout

Kimi Code discovers project skills in `.kimi-code/skills/` and
`.agents/skills/` — the legacy `.kimi/skills/` is **not** read (verified by
planting probe skills in all three and reading `available_commands_update`).
Instructions file stays `AGENTS.md`. `commandsDir` stays unset — kimi has no
project-command slash surface.
