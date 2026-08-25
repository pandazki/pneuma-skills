# Kimi backend (Kimi Code ACP)

This backend talks to Moonshot AI's **Kimi Code CLI** (`kimi`, >= 0.26.0) over
**ACP — the Agent Client Protocol**: line-delimited JSON-RPC 2.0 on
stdin/stdout of a long-lived `kimi acp` process. One process per Pneuma
session, alive across turns.

Docs: <https://moonshotai.github.io/kimi-code/>. Every wire shape referenced
below was verified against live frames captured from `kimi acp` — first on
0.26.0, re-probed frame-by-frame on **0.38.0** (see [What 0.38.0
changed](#what-0380-changed)) — not read from protocol documentation.

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
- **Resume**: `session/resume {sessionId, cwd}`. Verified on 0.26.0 and
  re-verified on 0.38.0 to replay **no** history frames (only an
  `available_commands_update`) while the model still has the prior
  conversation in context — exactly right, since Pneuma rehydrates chat from
  its own `history.json`. `session/load` is deliberately NOT used: it replays
  the whole conversation as update frames, which would duplicate the chat.
  Failed resume falls back to `session/new`. On 0.38.0 the result's
  `sessionId` is `null`; the id we asked to resume stays authoritative.
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
| `config_option_update` | full refreshed `configOptions` — re-syncs model state. **The mode is deliberately not read here** (see `current_mode_update`) |
| `usage_update` **(0.38.0)** | context-window occupancy → `context_used_percent` + the result envelope's `input_tokens` |
| `current_mode_update` **(0.38.0)** | active ACP session mode → `SessionState.permissionMode` |
| `session_info_update` **(0.38.0)** | agent-generated conversation title — consumed silently, see below |

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

## What 0.38.0 changed

Probed 2026-08-25 against `kimi --version` → **0.38.0** (`agentInfo.version`
on the `initialize` result agrees). A full `test:backends` run against it
produced 13 "unknown sessionUpdate kind" warnings across three new kinds; all
three are now handled. Nothing that existed before changed shape — the
tool-call lifecycle, chunk frames, permission round trip and
`available_commands_update` all re-captured identical.

### Three new `session/update` kinds (captured payloads)

```jsonc
{"sessionUpdate":"usage_update","used":36350,"size":1048576}
{"sessionUpdate":"current_mode_update","currentModeId":"yolo"}
{"sessionUpdate":"session_info_update","title":"Remember the magic word: paprika. Reply with only the word ok."}
```

**`usage_update` — context-window occupancy, NOT a token I/O split.** `used`
is how many tokens the session occupies of a `size`-token window (`1048576`
on k3; a fresh session already sits at ~36k because the system prompt is that
big). There is no input/output/cache breakdown anywhere in ACP. Wiring:

- `used / size` → `SessionState.context_used_percent` — the "ctx N%" readout
  in `ChatPanel` and `SessionAtlas`, which was permanently absent for kimi
  before. This is the real win.
- `used` → the **result envelope's** `usage.input_tokens` (cumulative context
  is the closest true analogue of "what the model read" — the same convention
  codex uses for its cumulative `total.inputTokens`). `output_tokens` and both
  cache fields stay **0**: kimi reports no such numbers and a fabricated one
  is worse than an honest zero. `total_cost_usd` likewise stays 0 — ACP
  carries no cost signal.
- Per-message assistant envelopes keep **zero** usage on purpose: the frame is
  once per *turn*, so stamping every mid-turn message with the same cumulative
  snapshot would invent per-message numbers (codex does the same).

> **One-turn lag, by protocol.** The frame lands in a separate stdout chunk
> just AFTER the turn's `session/prompt` response — measured at the same
> millisecond, but after the promise resolves, so the microtask that builds
> the result envelope has already run. Turn 1's envelope therefore reports 0
> and turn N's reports the snapshot taken at boundary N-1. `context_used_percent`
> has no lag (it updates when the frame lands). Delaying turn end to "fix"
> this would trade a live idle transition for a cosmetic number — don't.

**`current_mode_update` — the ACP session mode** (`default` / `plan` / `auto`
/ `yolo`), emitted after our `session/set_mode` and whenever the user flips
the mode inside kimi. Mapped back to Pneuma's Claude vocabulary
(`mapAcpModeToPermissionMode`, the exact inverse of `mapPermissionModeToAcp`)
and stored on `SessionState.permissionMode`, which until now sat at its
`"default"` default while the session actually ran in `yolo`. Two rules:

- **It is the single source for the mode.** `config_option_update` also
  carries the new value in its `mode` entry — deliberately not read, because
  two sources for one fact eventually disagree.
- The launch-time value is seeded from the session-setup result's `modes`
  state (below) *before* any `set_mode`, and replayed to late `onModeChanged`
  subscribers (the bridge attaches after `launch()` — same reason
  `onSessionId` replays).

`permissionMode` has no frontend consumer today; the wiring makes the
server-side state and the `session_init` / `session_update` payloads honest.
The `bypassPermissions` auto-approve shortcut in `WsBridge` is on the Claude
NDJSON path only, so kimi's permission round trip is unaffected.

**`session_info_update` — an agent-generated conversation title.** Despite the
name it carries no model / cwd / version: just `title`, restated from the
first user prompt. Consumed silently (like `user_message_chunk`), **not**
wired, because Pneuma already owns session display names on a better surface —
`pneuma session refine` writes `displayName`/`description` to `session.json`
plus the registry, guarded by `preserveRefinedSessionMeta`, and its fallback
is already "first user message preview". Adopting kimi's title would overwrite
a user/agent-chosen name with a worse default.

### Other 0.38.0 deltas (observed, no wiring needed)

- `session/resume` now answers with **`sessionId: null`** — harmless: the
  adapter keeps using the id it asked to resume. Nothing reads it off the
  result.
- `session/new` **and** `session/resume` results now carry a top-level
  `modes: {currentModeId, availableModes[]}` — the ACP-canonical mirror of the
  `mode` config option, and on resume the only place the mode appears at setup
  time. Used to seed the mode; `parseCurrentModeId` returns `null` for older
  agents so the `mode` config option stays the fallback.
- `agentCapabilities.sessionCapabilities` widened from `{list, resume}` to
  `{list, resume, close, delete, fork, additionalDirectories}`. The resume
  probe (`sessionCapabilities.resume !== undefined`) is unaffected.
- `configOptions` gained a `thinking` entry (`low`/`high`/`max`, category
  `thought_level`, default `high`). **Not wired** — Pneuma has no
  thinking-level surface, and an unknown config option disturbs nothing.
- **Resume still restores context without replaying history.** Re-verified
  live: after a kill + `session/resume`, the model recalled a word it had been
  told before the restart, and the only `session/update` the resume produced
  was `available_commands_update`. `session/load` remains the thing to avoid.

## Capabilities

`streaming: true, resume: true, permissions: true, toolProgress: true,
modelSwitch: true` — permissions and toolProgress are real ACP features
(they were `false` under the old print-mode protocol, which had neither).
Declared in **two places** (`manifest.ts` + `index.ts`) — keep them in sync
(a manifest test pins this).

The optional `contextWindow` flag stays **undeclared** even though 0.38.0's
`usage_update` now feeds `context_used_percent`. Codex is in the same
position (it computes the percent from `thread/tokenUsage/updated` and also
declares the flag falsy), and `server/__tests__/session-capabilities.test.ts`
pins "only claude-code declares contextWindow = true". Flipping it is a
cross-backend decision about what the flag means — kimi and codex would move
together — not a kimi-local one; nothing reads the flag at runtime today.

No version is declared anywhere in `manifest.ts`, on purpose: the `kimi`
binary's version numbering went **backwards** across the product swap
(1.41.0 → 0.26.0), so `checkRequirements()` probes for the `acp` subcommand
instead of comparing semver. 0.38.0 needed no change there.

## Skill install layout

Kimi Code discovers project skills in `.kimi-code/skills/` and
`.agents/skills/` — the legacy `.kimi/skills/` is **not** read (verified by
planting probe skills in all three and reading `available_commands_update`).
Instructions file stays `AGENTS.md`. `commandsDir` stays unset — kimi has no
project-command slash surface.
