# In-flight turn steering

This contract defines how a user can promote one queued user message into the
agent's currently running turn without cancelling that turn or starting a new
one.

## Capability

`AgentCapabilities.steer` is the single source of truth for the UI. It means
the backend transport used by Pneuma can append user input to an in-flight
turn through the backend's native protocol.

| Backend | `steer` | Pneuma transport | Native mapping |
|---|---:|---|---|
| `claude-code` | `true` | CLI streaming input (`--input-format stream-json`) | Write another SDK `user` envelope while the agent loop is running; Claude consumes it at the next interruptible point. |
| `codex` | `true` | app-server JSON-RPC | `turn/steer { threadId, expectedTurnId, input }` |
| `kimi-cli` | `false` | ACP 0.23 (`kimi acp`) | No ACP steering method. `session/prompt` queues a new turn and `session/cancel` interrupts; neither satisfies this contract. |

Kimi Code's TUI and local Server API have native steering, but that surface is
not exposed by the ACP transport Pneuma currently uses. Product capability is
defined by the integrated transport, not by another first-party client.

## Browser protocol

The browser promotes a pending user message with:

```ts
{
  type: "steer_message";
  content: string;
  images?: { media_type: string; data: string }[];
  files?: { name: string; media_type: string; data: string; size: number }[];
  client_msg_id: string; // the pending-message id
}
```

The server answers every request with:

```ts
{
  type: "steer_result";
  client_msg_id: string;
  success: boolean;
  error?: string;
}
```

The browser removes the item from its pending queue only after
`success: true`. A failed request leaves the item queued so the normal
flush-on-idle path can still deliver it as a later turn.

`steer_result` participates in the session replay buffer. If the browser
reconnects after the backend accepted the message but before the acknowledgement
arrived, replay still resolves the selected queue item without sending the
guidance twice.

## Invariants

1. Steering never sends an interrupt and never calls a new-turn method.
2. Only queued user messages are steerable. Viewer-generated notifications
   keep their existing turn-boundary delivery semantics.
3. The queue button is always visible for a queued user message. When
   `agent_capabilities.steer !== true`, it is disabled and its tooltip explains
   that the current agent transport does not support in-flight steering.
4. The shared incoming-message path still owns upload persistence, pending
   environment-context drain, and user-visible history. A successfully
   steered message appears exactly once in history.
5. A backend/protocol race must fail explicitly via `steer_result`; it must
   not silently fall back to interrupt-plus-resend or to a new turn.
6. A rejected steer releases its idempotency key so retrying the same queued
   message is processed again rather than silently deduplicated.
7. A committed history entry retains the queued message id, so reconnect can
   reconcile exactly once even when its transient `steer_result` aged out of
   the replay buffer. Failed attempts remove only the attachment paths minted
   by that attempt.
