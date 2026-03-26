import type { Hono } from "hono";

type PendingRequest = {
  resolve: (result: { ok: boolean; result?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

let bridgeSocket: { send: (msg: string) => void } | null = null;
let capabilitiesCache: Record<string, string[]> | null = null;
const pending = new Map<string, PendingRequest>();
let reqId = 0;

const NOT_AVAILABLE = {
  available: false,
  reason: "Requires Pneuma desktop app",
};

export function setBridgeSocket(ws: { send: (msg: string) => void } | null, capabilities?: Record<string, string[]>) {
  bridgeSocket = ws;
  if (capabilities) capabilitiesCache = capabilities;
}

export function handleBridgeResult(requestId: string, result: { ok: boolean; result?: unknown; error?: string }) {
  const p = pending.get(requestId);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(requestId);
    p.resolve(result);
  }
}

function invokeViaRenderer(capability: string, method: string, args: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (!bridgeSocket) return Promise.resolve({ ok: false, error: "No desktop bridge connected" });
  const id = `nr_${++reqId}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "Timeout waiting for desktop bridge (10s)" });
    }, 10000);
    pending.set(id, { resolve, timer });
    bridgeSocket!.send(JSON.stringify({
      type: "native_request",
      requestId: id,
      capability,
      method,
      args,
    }));
  });
}

export function mountNativeRoutes(app: Hono) {
  app.get("/api/native", (c) => {
    if (!bridgeSocket) return c.json(NOT_AVAILABLE);
    return c.json({ available: true, capabilities: capabilitiesCache });
  });

  app.post("/api/native/:capability/:method", async (c) => {
    if (!bridgeSocket) return c.json(NOT_AVAILABLE, 501);
    const { capability, method } = c.req.param();
    const args = await c.req.json().catch(() => []);
    const argsArray = Array.isArray(args) ? args : [args];
    const result = await invokeViaRenderer(capability, method, argsArray);
    return c.json(result, result.ok ? 200 : 500);
  });
}
