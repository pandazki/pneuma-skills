# Network Topology & Port Reference

> Last updated: 2026-03-12 (Codex transport clarification)

## Port Allocation

| Port | Component | When | Purpose |
|------|-----------|------|---------|
| **17996** | Vite dev server | Dev mode | Frontend HMR, proxies `/api` `/content` to backend |
| **17007** | Hono backend | Dev mode | REST API, WebSocket, file watcher |
| **17996** | Hono backend | Prod mode | Everything (API + static frontend) |
| **18997** | Play child backend | Mode-maker Play | Isolated backend for test instance |
| **18996** | Play child Vite | Mode-maker Play | Isolated frontend for test instance |

All servers bind to `0.0.0.0` to avoid IPv4/IPv6 dual-stack port collision on macOS.

## Scenario Matrix

| Scenario | Command | Backend Port | Vite Port | Browser URL | CLI WS |
|----------|---------|:----------:|:---------:|-------------|--------|
| **Dev Normal** | `bun run dev doc` | 17007 | 17996 | `localhost:17996` | `ws://localhost:17007/ws/cli/:id` |
| **Prod Normal** | `pneuma doc` | 17996 | — | `localhost:17996` | `ws://localhost:17996/ws/cli/:id` |
| **Dev Launcher** | `bun run dev` | 17007 | 17996 | `localhost:17996` | — (no agent) |
| **Prod Launcher** | `pneuma` | 17996 | — | `localhost:17996` | — (no agent) |
| **Launcher → Child** | (spawned) | auto | auto | auto | backend-specific |
| **Play (mode-maker)** | (spawned) | 18997 | 18996 | `localhost:18996` | `ws://localhost:18997/ws/cli/:id` |
| **Custom port** | `--port 9000` | 9000 | 17996* | `localhost:17996` | `ws://localhost:9000/ws/cli/:id` |

\* Vite port is independent of `--port`; override with `PNEUMA_VITE_PORT` env var.

## Dev Mode vs Production Mode

Detection logic (`bin/pneuma.ts`):

```
isDev = forceDev (--dev flag) || !existsSync(dist/index.html)
```

### Dev Mode — two processes

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│                                                                 │
│  http://localhost:17996  ───→  Vite Dev Server (:17996)         │
│                                  │                              │
│                                  ├─ /api/*    ──proxy──→        │
│                                  ├─ /content/* ─proxy──→        │
│                                  │                 │            │
│  ws://localhost:17007/ws/browser/:id ──────────────┤            │
│                                                    │            │
│                                          Hono Backend (:17007)  │
│                                                    │            │
│                          ws://localhost:17007/ws/cli/:id         │
│                                                    │            │
│                                          Agent Backend            │
│                                          (Claude: WS, Codex: stdio)│
└─────────────────────────────────────────────────────────────────┘
```

Key points:
- Vite proxies REST (`/api/*`, `/content/*`) to backend
- WebSocket **bypasses** Vite proxy — browser connects directly to `:17007`
- Vite env var `VITE_API_PORT` tells frontend which backend port to use
- Codex backend uses stdio (JSON-RPC), not WebSocket — managed by `CodexAdapter` + `ws-bridge-codex.ts`

### Production Mode — single process

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│                                                                 │
│  http://localhost:17996  ───→  Hono Backend (:17996)            │
│                                  │                              │
│                                  ├─ Static files from dist/     │
│                                  ├─ /api/*                      │
│                                  ├─ /content/*                  │
│                                  ├─ /ws/browser/:id             │
│                                  └─ /ws/cli/:id                 │
│                                          │                      │
│                                    Agent Backend                │
│                              (Claude: WS, Codex: stdio)        │
└─────────────────────────────────────────────────────────────────┘
```

Key points:
- Single port serves everything
- Frontend served as static files from `dist/`
- All WebSocket routes on same port

## Launcher Mode

Launcher starts when no mode argument is given. It serves the marketplace UI.

### Launcher → Child Process

When user clicks "Launch" in the marketplace, the launcher spawns a child `pneuma` process:

```
Launcher (:17996 / :17007)
    │
    POST /api/launch
    │
    ├─ Resolve mode
    ├─ Resolve backendType
    ├─ Spawn: bun pneuma.ts <mode> --workspace <path> --port <auto> --backend <type> --no-open --no-prompt [--dev] [--debug]
    │
    ├─ Wait for child stdout: [pneuma] ready http://localhost:<port>?...
    │
    └─ Return URL to browser → redirect
```

The child process gets:
- `--port`: chosen by launcher (the launcher server's actual port, allowing auto-increment)
- `--backend`: launcher-selected backend, persisted for the workspace session
- `--dev`: inherited if parent is in dev mode
- `--debug`: inherited if parent has `--debug`
- `--no-open --no-prompt`: non-interactive

## Mode-Maker Play Instance

When the developer clicks "Play" in mode-maker, a subprocess tests the mode in an isolated environment:

```
Parent Mode-Maker                      Play Child Instance
─────────────────                      ────────────────────

Backend (:17007)                       Backend (:18997)
Vite    (:17996)                       Vite    (:18996)
                                         │
POST /api/mode-maker/play                │
    │                                    │
    spawn: pneuma.ts <workspace>         │
      --workspace /tmp/pneuma-play-xxx   │
      --port 18997                       │
      --no-open --no-prompt --dev        │
                                         │
    env: PNEUMA_VITE_PORT=18996          │
    env: CLAUDECODE=""                   │
                                         │
    stdout → [pneuma] ready URL ────→  returned to frontend
                                         │
                                       Browser opens :18996
```

Ports 18996/18997 are hardcoded constants in `server/mode-maker-routes.ts`.

## WebSocket Routes

| Path | Protocol | Client | Purpose |
|------|----------|--------|---------|
| `/ws/browser/:sessionId` | JSON | Browser UI | User messages, permissions, viewer actions |
| `/ws/cli/:sessionId` | NDJSON (Claude) | Claude Code CLI | Tool use, streaming, agent events |
| *(stdio, no WS)* | JSON-RPC (Codex) | Codex app-server | Managed by CodexAdapter, not WS-routed |
| `/ws/terminal/:terminalId` | Binary | Terminal UI | PTY I/O (xterm.js) |

Browser WebSocket URL construction (`src/ws.ts`):

```typescript
// Dev: connect directly to backend (bypass Vite)
const host = import.meta.env.DEV
  ? `${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
  : location.host;  // Prod: same origin
```

CLI WebSocket URL construction (`backends/claude-code/cli-launcher.ts`):

```typescript
const sdkUrl = `ws://localhost:${this.port}/ws/cli/${sessionId}`;
// Passed as: claude --sdk-url <sdkUrl>
```

Codex transport (`backends/codex/codex-adapter.ts`):

```typescript
// Codex uses stdio JSON-RPC, not WebSocket
// codex --app-server spawns a child process
// CodexAdapter communicates via stdin/stdout JSON-RPC
// ws-bridge-codex.ts bridges browser WS ↔ CodexAdapter events
```

The runtime session layer is backend-neutral. Browser session state carries `backend_type`, `agent_capabilities`, and `agent_version` so frontend feature gating does not depend on transport details.

## Environment Variable Flow

```
bin/pneuma.ts
    │
    ├─ actualPort = startServer(port: effectiveApiPort)
    │
    ├─ Vite env:
    │   ├─ VITE_API_PORT = actualPort        → import.meta.env.VITE_API_PORT (frontend)
    │   ├─ PNEUMA_EXTERNAL_MODE_PATH = ...   → vite.config.ts (external mode resolve)
    │   ├─ PNEUMA_EXTERNAL_MODE_NAME = ...   → vite.config.ts
    │   └─ VITE_MODE_MAKER_WORKSPACE = ...   → vite.config.ts (mode-maker only)
    │
    └─ Agent env:
        ├─ PNEUMA_API = http://localhost:${actualPort}
        ├─ CLAUDECODE = "" (explicitly cleared)
        └─ (mode-specific envMapping values)
```

For Play subprocess, additionally:
```
PNEUMA_VITE_PORT = 18996   → bin/pneuma.ts reads for Vite --port
```

## Port Auto-Increment

When a requested port is occupied, the server retries up to 10 times:

```typescript
// server/index.ts
for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
  try {
    server = Bun.serve({ port: serverPort, hostname: "0.0.0.0", ... });
    break;
  } catch (err) {
    if (err?.code === "EADDRINUSE") serverPort++;
    else throw err;
  }
}
```

The actual bound port is returned as `actualPort` and used for all downstream configuration.

Vite also has `strictPort: false` — if 17996 is occupied, it picks the next available port. The actual Vite port is parsed from stdout (`Local: http://localhost:<port>/`).

## Debug Mode (`--debug`)

The `--debug` flag:
- Adds `&debug=1` to the browser URL query parameter
- Frontend reads this to enable `debugMode` in the Zustand store
- Enables verbose logging in server/client code
- **Does not change any port assignments**
- Inherited by launcher-spawned child processes

## Vite Proxy Configuration

```typescript
// vite.config.ts
proxy: {
  "/api":     → http://localhost:${VITE_API_PORT || "17007"}
  "/content": → http://localhost:${VITE_API_PORT || "17007"}
}
```

Note: WebSocket is **not** proxied through Vite — the browser connects directly to the backend port. This is by design because Vite's WS proxy doesn't work reliably with Bun.serve.

## Source Files

| Topic | File | Key lines |
|-------|------|-----------|
| Port defaults, dev detection | `bin/pneuma.ts` | `effectiveApiPort`, `isDev`, `VITE_PORT` |
| Server startup, auto-increment | `server/index.ts` | `startServer()`, `MAX_PORT_ATTEMPTS` |
| Vite config, proxy, resolve | `vite.config.ts` | `server.proxy`, `pneumaWorkspaceResolve` |
| Frontend port resolution | `src/ws.ts` | `getWsUrl()` |
| Frontend API base | `src/App.tsx` | `getApiBase()` |
| CLI WebSocket URL | `backends/claude-code/cli-launcher.ts` | `sdkUrl` |
| Codex stdio transport | `backends/codex/codex-adapter.ts` | `JsonRpcTransport` |
| Codex WS bridge | `server/ws-bridge-codex.ts` | Browser ↔ CodexAdapter |
| Play ports | `server/mode-maker-routes.ts` | `PLAY_PORT`, `PLAY_VITE_PORT` |
| Launcher child spawn | `server/index.ts` | `POST /api/launch` |
