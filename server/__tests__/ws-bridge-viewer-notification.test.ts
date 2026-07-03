import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WsBridge } from "../ws-bridge.js";
import type { BridgeBackend, RouteResult } from "../ws-bridge-backend.js";
import type { BrowserOutgoingMessage } from "../session-types.js";
import type { BrowserSocketData, SocketData } from "../ws-bridge-types.js";

function browserWs(sessionId: string): ServerWebSocket<SocketData> {
  return {
    data: {
      kind: "browser",
      sessionId,
      subscribed: false,
      lastAckSeq: 0,
    } satisfies BrowserSocketData,
  } as unknown as ServerWebSocket<SocketData>;
}

class RecordingStreamingBackend implements BridgeBackend {
  readonly backendType = "codex" as const;
  readonly injected: string[] = [];
  readonly routed: BrowserOutgoingMessage[] = [];

  attach(): void {}

  injectUserMessage(content: string): void {
    this.injected.push(content);
  }

  routeBrowserMessage(msg: BrowserOutgoingMessage): RouteResult {
    if (msg.type === "user_message") {
      this.routed.push(msg);
      return "handled";
    }
    return "passthrough";
  }

  async disconnect(): Promise<void> {}
}

describe("viewer notifications with streaming backends", () => {
  test("an idle streaming backend receives viewer commands instead of queuing legacy CLI NDJSON", () => {
    const bridge = new WsBridge();
    const sessionId = "wordtaste-codex";
    const session = bridge.getOrCreateSession(sessionId, "codex");
    const backend = new RecordingStreamingBackend();
    bridge.attachStreamingBackend(sessionId, backend);

    bridge.handleBrowserMessage(
      browserWs(sessionId),
      JSON.stringify({
        type: "viewer_notification",
        notification: {
          type: "wordtaste-command",
          severity: "warning",
          message: "The user clicked the \"Try three styles first\" command. Run calibrate-style-sample.",
        },
      }),
    );

    expect(backend.injected).toHaveLength(1);
    expect(backend.injected[0]).toContain("Try three styles first");
    expect(session.pendingMessages).toHaveLength(0);
  });
});
