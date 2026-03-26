# Electron Native API Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Electron native capabilities (clipboard, shell, system info, notifications, etc.) via a unified server API that works for both Viewer components and Agent, with graceful degradation in web environments.

**Architecture:** The Hono server exposes `/api/native/:capability` REST endpoints. In Electron, the renderer acts as a bridge — it registers itself via WebSocket and fulfills native requests by calling `pneumaDesktop` IPC. In web (no Electron), the endpoints return `{ available: false, reason: "Requires desktop app" }`. The preload exposes a generic `invoke(channel, ...args)` alongside the existing specific methods. A capability allowlist in the Electron main process controls security.

**Tech Stack:** Electron IPC (contextBridge), Hono REST endpoints, WebSocket bridge

---

## File Structure

| File | Responsibility |
|------|---------------|
| `desktop/src/preload/index.ts` | Add generic `invoke(channel, ...args)` method |
| `desktop/src/main/native-bridge.ts` | New: capability allowlist + handler registry |
| `desktop/src/main/ipc-handlers.ts` | Register generic `pneuma:native` handler |
| `server/native-bridge.ts` | New: REST endpoints `/api/native/*` + renderer bridge via WS |
| `server/index.ts` | Mount native bridge routes |
| `src/native-bridge.ts` | New: renderer-side bridge (connects WS, fulfills requests via IPC) |
| `src/App.tsx` | Initialize native bridge on mount |

---

### Task 1: Preload generic invoke

**Files:**
- Modify: `desktop/src/preload/index.ts`

- [ ] **Step 1: Add generic invoke to preload**

Add a generic `invoke` method that routes through a single IPC channel with an allowlist check on the main process side:

```typescript
// Add to the pneumaDesktop object:
invoke: (capability: string, method: string, ...args: unknown[]) =>
  ipcRenderer.invoke("pneuma:native", capability, method, ...args),
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/preload/index.ts
git commit -m "feat(native-bridge): add generic invoke to preload"
```

---

### Task 2: Main process capability registry

**Files:**
- Create: `desktop/src/main/native-bridge.ts`
- Modify: `desktop/src/main/ipc-handlers.ts`

- [ ] **Step 1: Create native-bridge.ts with capability allowlist**

```typescript
import { clipboard, shell, app, nativeTheme, screen, Notification, BrowserWindow } from "electron";
import * as os from "node:os";
import * as path from "node:path";

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

// Each capability is a namespace of methods
const capabilities: Record<string, Record<string, Handler>> = {
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (_e: unknown, text: unknown) => clipboard.writeText(String(text)),
    readHTML: () => clipboard.readHTML(),
    writeHTML: (_e: unknown, html: unknown) => clipboard.writeHTML(String(html)),
    has: (_e: unknown, format: unknown) => clipboard.has(String(format)),
    availableFormats: () => clipboard.availableFormats(),
  },
  shell: {
    openPath: (_e: unknown, p: unknown) => shell.openPath(String(p)),
    openExternal: (_e: unknown, url: unknown) => shell.openExternal(String(url)),
    showItemInFolder: (_e: unknown, p: unknown) => shell.showItemInFolder(String(p)),
    beep: () => shell.beep(),
  },
  app: {
    getVersion: () => app.getVersion(),
    getName: () => app.getName(),
    getPath: (_e: unknown, name: unknown) => app.getPath(name as any),
    getLocale: () => app.getLocale(),
  },
  system: {
    platform: () => process.platform,
    arch: () => process.arch,
    cpus: () => os.cpus().length,
    totalMemory: () => os.totalmem(),
    freeMemory: () => os.freemem(),
    hostname: () => os.hostname(),
    homedir: () => os.homedir(),
    tmpdir: () => os.tmpdir(),
    uptime: () => os.uptime(),
  },
  theme: {
    shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
    themeSource: () => nativeTheme.themeSource,
  },
  screen: {
    getPrimaryDisplay: () => {
      const d = screen.getPrimaryDisplay();
      return { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor };
    },
    getAllDisplays: () => screen.getAllDisplays().map(d => ({
      bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
    })),
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
  },
  notification: {
    show: (_e: unknown, opts: unknown) => {
      const { title, body } = opts as { title: string; body?: string };
      new Notification({ title, body }).show();
      return true;
    },
    isSupported: () => Notification.isSupported(),
  },
  window: {
    minimize: (_e: unknown) => {
      const win = BrowserWindow.getFocusedWindow();
      win?.minimize();
    },
    maximize: (_e: unknown) => {
      const win = BrowserWindow.getFocusedWindow();
      if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
    },
    isMaximized: () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false,
    isFullScreen: () => BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false,
    setAlwaysOnTop: (_e: unknown, flag: unknown) => {
      BrowserWindow.getFocusedWindow()?.setAlwaysOnTop(!!flag);
    },
    getBounds: () => BrowserWindow.getFocusedWindow()?.getBounds(),
  },
};

export function handleNativeInvoke(capability: string, method: string, ...args: unknown[]): unknown {
  const cap = capabilities[capability];
  if (!cap) throw new Error(`Unknown capability: ${capability}`);
  const fn = cap[method];
  if (!fn) throw new Error(`Unknown method: ${capability}.${method}`);
  return fn(...args);
}

export function listCapabilities(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [cap, methods] of Object.entries(capabilities)) {
    result[cap] = Object.keys(methods);
  }
  return result;
}
```

- [ ] **Step 2: Register generic handler in ipc-handlers.ts**

Add to `registerIpcHandlers()`:

```typescript
import { handleNativeInvoke, listCapabilities } from "./native-bridge.js";

// Inside registerIpcHandlers():
ipcMain.handle("pneuma:native", async (_event, capability: string, method: string, ...args: unknown[]) => {
  try {
    const result = await handleNativeInvoke(capability, method, ...args);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("pneuma:native:capabilities", () => {
  return listCapabilities();
});
```

Also add to preload:

```typescript
capabilities: () => ipcRenderer.invoke("pneuma:native:capabilities"),
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/main/native-bridge.ts desktop/src/main/ipc-handlers.ts desktop/src/preload/index.ts
git commit -m "feat(native-bridge): capability registry with allowlist"
```

---

### Task 3: Server REST endpoints

**Files:**
- Create: `server/native-bridge.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create server/native-bridge.ts**

The server exposes `/api/native/*` endpoints. It maintains a callback to the renderer bridge. When in Electron, the renderer connects and registers itself as the native bridge. When not in Electron, endpoints return `available: false`.

```typescript
import type { Hono } from "hono";

type NativeBridgeFn = (capability: string, method: string, ...args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

let nativeBridge: NativeBridgeFn | null = null;
let capabilitiesCache: Record<string, string[]> | null = null;

export function registerNativeBridge(fn: NativeBridgeFn, capabilities: Record<string, string[]>) {
  nativeBridge = fn;
  capabilitiesCache = capabilities;
}

export function unregisterNativeBridge() {
  nativeBridge = null;
  capabilitiesCache = null;
}

const NOT_AVAILABLE = {
  available: false,
  reason: "Requires Pneuma desktop app. Install from https://pneuma.vibecoding.icu",
};

export function mountNativeRoutes(app: Hono) {
  // List available capabilities
  app.get("/api/native", (c) => {
    if (!nativeBridge) return c.json(NOT_AVAILABLE);
    return c.json({ available: true, capabilities: capabilitiesCache });
  });

  // Invoke a capability method
  app.post("/api/native/:capability/:method", async (c) => {
    if (!nativeBridge) return c.json(NOT_AVAILABLE, 501);
    const { capability, method } = c.req.param();
    const args = await c.req.json().catch(() => []);
    const argsArray = Array.isArray(args) ? args : [args];
    try {
      const result = await nativeBridge(capability, method, ...argsArray);
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
```

- [ ] **Step 2: Mount in server/index.ts**

Near the other route registrations (non-launcher section), add:

```typescript
import { mountNativeRoutes } from "./native-bridge.js";

// After other route registrations:
mountNativeRoutes(app);
```

- [ ] **Step 3: Commit**

```bash
git add server/native-bridge.ts server/index.ts
git commit -m "feat(native-bridge): server REST endpoints /api/native/*"
```

---

### Task 4: Renderer bridge (connects Electron IPC to server)

**Files:**
- Create: `src/native-bridge.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create src/native-bridge.ts**

The renderer-side bridge detects Electron, fetches capabilities, and registers itself with the server so the server can fulfill `/api/native/*` requests.

```typescript
import { getApiBase } from "./utils/api.js";

const desktop = (window as any).pneumaDesktop as {
  invoke?: (capability: string, method: string, ...args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  capabilities?: () => Promise<Record<string, string[]>>;
} | undefined;

let registered = false;

/**
 * Initialize the native bridge.
 * In Electron: registers with the server so /api/native/* requests can be fulfilled.
 * In web: no-op (server returns "not available" by default).
 */
export async function initNativeBridge() {
  if (registered || !desktop?.invoke || !desktop?.capabilities) return;

  try {
    const capabilities = await desktop.capabilities();

    // Register with server via a long-poll bridge
    // The server will call us back via this connection when it needs native access
    const poll = async () => {
      while (registered) {
        try {
          const res = await fetch(`${getApiBase()}/api/native/_bridge/poll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ capabilities }),
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) break;
          const request = await res.json();
          if (request.type === "invoke") {
            const result = await desktop.invoke!(request.capability, request.method, ...request.args);
            await fetch(`${getApiBase()}/api/native/_bridge/result`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requestId: request.requestId, ...result }),
            });
          }
        } catch {
          // Timeout or network error — retry
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    };

    registered = true;
    poll(); // Fire and forget
  } catch (err) {
    console.warn("[native-bridge] Failed to initialize:", err);
  }
}

export function destroyNativeBridge() {
  registered = false;
}
```

Wait — long-polling is overly complex. Simpler approach: since the server and renderer are on the same machine, use a **direct registration** pattern. The renderer calls a registration endpoint, and subsequent `/api/native/*` requests are fulfilled by the renderer calling the IPC synchronously... but the renderer can't intercept server requests.

**Simpler architecture:** The `/api/native/*` endpoints on the server are **only callable from the renderer** (same origin). The renderer itself is the client — it calls the server endpoint, which is really just a pass-through. But actually... the renderer can call Electron IPC directly without going through the server at all.

The real use case for server endpoints is: **Agent needs to call native APIs**. The agent talks to the server. The server needs to reach Electron. The only bridge is the renderer's WebSocket.

**Revised approach:** Use the existing WS bridge. When the server receives a `/api/native/*` request (from agent or any HTTP client), it sends a WS message to the browser asking it to invoke the native API, waits for the response, and returns it.

- [ ] **Step 1 (revised): Update server/native-bridge.ts with WS-based bridge**

```typescript
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
  reason: "Requires Pneuma desktop app. Install from https://pneuma.vibecoding.icu",
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
  if (!bridgeSocket) return Promise.resolve({ ok: false, error: "No desktop bridge" });
  const id = `nr_${++reqId}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "Timeout waiting for desktop bridge" });
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
```

- [ ] **Step 2: Create src/native-bridge.ts (renderer side)**

The renderer listens for `native_request` WS messages and fulfills them via IPC:

```typescript
const desktop = (window as any).pneumaDesktop as {
  invoke?: (capability: string, method: string, ...args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  capabilities?: () => Promise<Record<string, string[]>>;
} | undefined;

/**
 * Handle a native_request message from the server (via WS).
 * Calls Electron IPC and returns the result.
 */
export async function handleNativeRequest(
  msg: { requestId: string; capability: string; method: string; args: unknown[] },
  sendToServer: (data: unknown) => void,
) {
  if (!desktop?.invoke) {
    sendToServer({ type: "native_result", requestId: msg.requestId, ok: false, error: "Not in desktop app" });
    return;
  }
  try {
    const result = await desktop.invoke(msg.capability, msg.method, ...msg.args);
    sendToServer({ type: "native_result", requestId: msg.requestId, ...result });
  } catch (err) {
    sendToServer({ type: "native_result", requestId: msg.requestId, ok: false, error: String(err) });
  }
}

/**
 * Check if native bridge is available and return capabilities.
 */
export async function getNativeCapabilities(): Promise<Record<string, string[]> | null> {
  if (!desktop?.capabilities) return null;
  try {
    return await desktop.capabilities();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Wire into WS client (src/ws.ts)**

In the WS message handler, add handling for `native_request` type. Also on connection, if in Electron, send capabilities registration.

Find where incoming WS messages are handled (the `onmessage` handler) and add:

```typescript
import { handleNativeRequest, getNativeCapabilities } from "./native-bridge.js";

// In the message handler:
if (msg.type === "native_request") {
  handleNativeRequest(msg, (data) => ws.send(JSON.stringify(data)));
  return;
}

// On connection open, register capabilities:
getNativeCapabilities().then(caps => {
  if (caps) ws.send(JSON.stringify({ type: "native_bridge_register", capabilities: caps }));
});
```

- [ ] **Step 4: Wire server WS to native bridge**

In `server/ws-bridge.ts` or `server/index.ts`, handle `native_bridge_register` and `native_result` messages from the browser:

```typescript
import { setBridgeSocket, handleBridgeResult } from "./native-bridge.js";

// In browser message handler:
if (msg.type === "native_bridge_register") {
  setBridgeSocket(browserWs, msg.capabilities);
  return;
}
if (msg.type === "native_result") {
  handleBridgeResult(msg.requestId, { ok: msg.ok, result: msg.result, error: msg.error });
  return;
}
```

- [ ] **Step 5: Mount routes in server/index.ts**

```typescript
import { mountNativeRoutes } from "./native-bridge.js";
// After other routes:
mountNativeRoutes(app);
```

- [ ] **Step 6: Commit**

```bash
git add server/native-bridge.ts src/native-bridge.ts src/ws.ts server/index.ts
git commit -m "feat(native-bridge): WS-based bridge connecting server REST to Electron IPC"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Native Bridge API to CLAUDE.md**

In the Server API Reference section, add:

```markdown
### Native (Electron desktop only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/native` | List available capabilities (or `{ available: false }` in web) |
| POST | `/api/native/:capability/:method` | Invoke a native method (body: args array) |

Available capabilities (when running in desktop app):
- `clipboard` — readText, writeText, readHTML, writeHTML, has, availableFormats
- `shell` — openPath, openExternal, showItemInFolder, beep
- `app` — getVersion, getName, getPath, getLocale
- `system` — platform, arch, cpus, totalMemory, freeMemory, hostname, homedir, tmpdir, uptime
- `theme` — shouldUseDarkColors, themeSource
- `screen` — getPrimaryDisplay, getAllDisplays, getCursorScreenPoint
- `notification` — show, isSupported
- `window` — minimize, maximize, isMaximized, isFullScreen, setAlwaysOnTop, getBounds
```

In Known Gotchas, add:

```markdown
- **Native bridge availability**: `/api/native/*` endpoints only work when running inside the Electron desktop app. Web environments return `{ available: false }`. The bridge uses WebSocket — if no browser tab is connected, native calls will timeout (10s).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add native bridge API reference"
```
