import type { ICodexTransport } from "../codex-adapter.js";

/** The main thread id `thread/start` answers with in these tests. */
export const MAIN_THREAD_ID = "thr_test";

export type MockCodexTransport = ICodexTransport & {
  _notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null;
  _requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null;
  _callHistory: { method: string; params: Record<string, unknown> }[];
  _respondHistory: { id: number; result: unknown }[];
  _callResolver: Map<string, (result: unknown) => void>;
  simulateNotification: (method: string, params: Record<string, unknown>) => void;
  simulateRequest: (method: string, id: number, params: Record<string, unknown>) => void;
};

/**
 * Creates a mock ICodexTransport that simulates the Codex app-server
 * JSON-RPC protocol for testing the CodexAdapter. Shared by
 * `codex-adapter.test.ts` and `codex-adapter-subagents.test.ts` so both
 * suites drive the adapter through exactly the same seam.
 */
export function createMockTransport(): MockCodexTransport {
  let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  let requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  const callHistory: { method: string; params: Record<string, unknown> }[] = [];
  const respondHistory: { id: number; result: unknown }[] = [];
  const callResolver = new Map<string, (result: unknown) => void>();

  return {
    _notificationHandler: null,
    _requestHandler: null,
    _callHistory: callHistory,
    _respondHistory: respondHistory,
    _callResolver: callResolver,

    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      callHistory.push({ method, params });

      // Auto-resolve known init methods
      if (method === "initialize") {
        return { serverInfo: { name: "codex-test", version: "1.0.0" } };
      }
      if (method === "thread/start") {
        return { thread: { id: MAIN_THREAD_ID }, model: "o3-pro", model_provider: "openai" };
      }
      if (method === "thread/resume") {
        return { thread: { id: params.threadId || "thr_resumed" }, model: "o3-pro", model_provider: "openai" };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_1" } };
      }
      if (method === "turn/interrupt") {
        return {};
      }
      if (method === "turn/steer") {
        return { turnId: "turn_1" };
      }

      // For other methods, return a promise that can be resolved externally
      return new Promise((resolve) => {
        callResolver.set(method, resolve);
      });
    },

    async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
      callHistory.push({ method, params });
    },

    async respond(id: number, result: unknown): Promise<void> {
      respondHistory.push({ id, result });
    },

    onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
      notificationHandler = handler;
    },

    onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void {
      requestHandler = handler;
    },

    isConnected(): boolean {
      return true;
    },

    simulateNotification(method: string, params: Record<string, unknown>): void {
      notificationHandler?.(method, params);
    },

    simulateRequest(method: string, id: number, params: Record<string, unknown>): void {
      requestHandler?.(method, id, params);
    },
  };
}

/** Wait for initialization to complete. */
export async function waitForInit(): Promise<void> {
  // The adapter initializes asynchronously — give it time
  await new Promise((r) => setTimeout(r, 50));
}
