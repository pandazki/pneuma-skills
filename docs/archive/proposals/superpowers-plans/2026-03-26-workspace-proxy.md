# Workspace Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reverse proxy middleware to the Pneuma server so viewer components can access external APIs via `/proxy/<name>/*` without CORS issues.

**Architecture:** A Hono middleware on `/proxy/*` reads a merged config (manifest defaults + workspace `proxy.json`) and forwards requests server-side. Config changes are hot-reloaded via the existing chokidar file watcher. The skill installer generates proxy documentation in CLAUDE.md so the agent knows how to use it.

**Tech Stack:** Hono middleware, chokidar (existing), Bun `fetch()` for upstream forwarding

---

### Task 1: Add ProxyRoute type to ModeManifest

**Files:**
- Modify: `core/types/mode-manifest.ts:239-281`
- Modify: `core/types/index.ts:10-19`
- Test: `core/__tests__/mode-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test section at the end of `core/__tests__/mode-manifest.test.ts`:

```typescript
// ── ProxyRoute ────────────────────────────────────────────────────────────────

describe("ProxyRoute", () => {
  test("manifest can declare proxy routes", () => {
    const manifest = createMinimalManifest({
      proxy: {
        github: {
          target: "https://api.github.com",
          headers: { Authorization: "Bearer {{GITHUB_TOKEN}}" },
          methods: ["GET", "POST"],
          description: "GitHub REST API",
        },
      },
    });
    expect(manifest.proxy?.github.target).toBe("https://api.github.com");
    expect(manifest.proxy?.github.methods).toEqual(["GET", "POST"]);
  });

  test("proxy is optional", () => {
    const manifest = createMinimalManifest();
    expect(manifest.proxy).toBeUndefined();
  });

  test("proxy route target must be a URL string", () => {
    const manifest = createMinimalManifest({
      proxy: {
        weather: { target: "https://wttr.in" },
      },
    });
    expect(manifest.proxy?.weather.target).toMatch(/^https?:\/\//);
  });

  test("methods defaults semantically to GET only", () => {
    const manifest = createMinimalManifest({
      proxy: {
        api: { target: "https://api.example.com" },
      },
    });
    expect(manifest.proxy?.api.methods).toBeUndefined();
    // Runtime should treat undefined as ["GET"]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/mode-manifest.test.ts`
Expected: FAIL — `ProxyRoute` type doesn't exist on ModeManifest yet.

- [ ] **Step 3: Add ProxyRoute type and ModeManifest.proxy field**

In `core/types/mode-manifest.ts`, add before the `ModeManifest` interface (before line 239):

```typescript
/** Reverse proxy route — forwards /proxy/<name>/* to target, avoiding CORS in viewer code */
export interface ProxyRoute {
  /** Target base URL (e.g. "https://api.github.com") */
  target: string;
  /** Additional request headers. Values support {{ENV_VAR}} template syntax resolved from process.env at request time. */
  headers?: Record<string, string>;
  /** Allowed HTTP methods (default: ["GET"]) */
  methods?: string[];
  /** Human-readable description (injected into CLAUDE.md for agent awareness) */
  description?: string;
}
```

In the `ModeManifest` interface, add after the `layout` field (before the closing `}`):

```typescript
  /** Reverse proxy routes — forwards /proxy/<name>/* to external APIs, avoiding CORS */
  proxy?: Record<string, ProxyRoute>;
```

- [ ] **Step 4: Export ProxyRoute from index.ts**

In `core/types/index.ts`, add `ProxyRoute` to the mode-manifest export:

```typescript
export type {
  ModeManifest,
  SkillConfig,
  ViewerConfig,
  AgentPreferences,
  InitConfig,
  ViewerApiConfig,
  EvolutionConfig,
  EvolutionTool,
  ProxyRoute,
} from "./mode-manifest.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test core/__tests__/mode-manifest.test.ts`
Expected: PASS — all existing tests still pass, new ProxyRoute tests pass.

- [ ] **Step 6: Commit**

```bash
git add core/types/mode-manifest.ts core/types/index.ts core/__tests__/mode-manifest.test.ts
git commit -m "feat(proxy): add ProxyRoute type to ModeManifest"
```

---

### Task 2: Create proxy middleware

**Files:**
- Create: `server/proxy-middleware.ts`
- Test: `server/__tests__/proxy-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/proxy-middleware.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { createProxyMiddleware, type ProxyConfigRef } from "../proxy-middleware.js";

// Start a tiny upstream server for integration tests
let upstreamServer: ReturnType<typeof Bun.serve>;
let upstreamPort: number;

beforeAll(() => {
  upstreamServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/echo") {
        return Response.json({
          method: req.method,
          path: url.pathname,
          query: url.search,
          authHeader: req.headers.get("authorization") ?? null,
          acceptHeader: req.headers.get("accept") ?? null,
        });
      }
      if (url.pathname === "/status/418") {
        return new Response("I'm a teapot", { status: 418 });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  upstreamPort = upstreamServer.port;
});

afterAll(() => {
  upstreamServer.stop();
});

function createTestApp(configRef: ProxyConfigRef) {
  const app = new Hono();
  app.all("/proxy/*", createProxyMiddleware(configRef));
  return app;
}

describe("proxy middleware", () => {
  test("forwards GET request to upstream", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo?foo=bar");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("/echo");
    expect(body.query).toBe("?foo=bar");
    expect(body.method).toBe("GET");
  });

  test("returns 404 for unknown proxy name", async () => {
    const configRef: ProxyConfigRef = { current: new Map() };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/unknown/path");
    expect(res.status).toBe(404);
  });

  test("returns 405 for disallowed HTTP method", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}`, methods: ["GET"] }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", { method: "POST" });
    expect(res.status).toBe(405);
  });

  test("allows configured methods", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}`, methods: ["GET", "POST"] }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("POST");
  });

  test("resolves {{ENV_VAR}} in headers", async () => {
    process.env.__TEST_PROXY_TOKEN = "secret123";
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", {
          target: `http://localhost:${upstreamPort}`,
          headers: { Authorization: "Bearer {{__TEST_PROXY_TOKEN}}" },
        }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo");
    const body = await res.json();
    expect(body.authHeader).toBe("Bearer secret123");
    delete process.env.__TEST_PROXY_TOKEN;
  });

  test("passes through accept header from client", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", {
      headers: { Accept: "application/xml" },
    });
    const body = await res.json();
    expect(body.acceptHeader).toBe("application/xml");
  });

  test("transparently passes upstream status codes", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/status/418");
    expect(res.status).toBe(418);
  });

  test("returns 502 when upstream is unreachable", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["dead", { target: "http://localhost:1" }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/dead/path");
    expect(res.status).toBe(502);
  });

  test("reads latest config on each request (hot reload)", async () => {
    const configRef: ProxyConfigRef = { current: new Map() };
    const app = createTestApp(configRef);

    // Initially no config → 404
    let res = await app.request("/proxy/test/echo");
    expect(res.status).toBe(404);

    // Add config at runtime
    configRef.current = new Map([
      ["test", { target: `http://localhost:${upstreamPort}` }],
    ]);

    // Now it should work
    res = await app.request("/proxy/test/echo");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/proxy-middleware.test.ts`
Expected: FAIL — module `../proxy-middleware.js` not found.

- [ ] **Step 3: Implement proxy middleware**

Create `server/proxy-middleware.ts`:

```typescript
/**
 * Proxy middleware — reverse proxy for viewer API access.
 *
 * Forwards /proxy/<name>/<path> to configured upstream targets.
 * Config is read from a mutable ref (hot-reloadable via file watcher).
 */

import type { Context } from "hono";
import type { ProxyRoute } from "../core/types/mode-manifest.js";

export interface ProxyConfigRef {
  current: Map<string, ProxyRoute>;
}

/** Headers safe to pass through from the browser request to upstream. */
const PASSTHROUGH_HEADERS = ["accept", "content-type", "accept-language"];

/** Headers that must NOT be forwarded (security boundary). */
const BLOCKED_HEADERS = new Set(["host", "origin", "referer", "cookie", "connection"]);

/** Hop-by-hop headers to strip from upstream response. */
const HOP_BY_HOP = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Resolve {{ENV_VAR}} placeholders in a string using process.env.
 */
function resolveEnvTemplate(value: string): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => process.env[key] ?? "");
}

/**
 * Create a Hono handler for /proxy/* routes.
 *
 * URL format: /proxy/<name>/<remaining-path>
 * Config is read from configRef.current on every request (supports hot reload).
 */
export function createProxyMiddleware(configRef: ProxyConfigRef) {
  return async (c: Context) => {
    // Parse: /proxy/<name>/<path...>
    const fullPath = c.req.path.replace(/^\/proxy\//, "");
    const slashIdx = fullPath.indexOf("/");
    const name = slashIdx === -1 ? fullPath : fullPath.slice(0, slashIdx);
    const remainingPath = slashIdx === -1 ? "" : fullPath.slice(slashIdx + 1);

    // Lookup config
    const route = configRef.current.get(name);
    if (!route) {
      return c.text(`Proxy "${name}" not configured`, 404);
    }

    // Method check
    const method = c.req.method.toUpperCase();
    const allowedMethods = (route.methods ?? ["GET"]).map((m) => m.toUpperCase());
    if (!allowedMethods.includes(method)) {
      return c.text(`Method ${method} not allowed for proxy "${name}"`, 405);
    }

    // Build upstream URL
    const targetBase = route.target.replace(/\/+$/, "");
    const url = new URL(c.req.url);
    const upstreamUrl = `${targetBase}/${remainingPath}${url.search}`;

    // Build headers: passthrough + route config (config wins on conflict)
    const headers = new Map<string, string>();

    // Passthrough safe headers from browser request
    for (const key of PASSTHROUGH_HEADERS) {
      const value = c.req.header(key);
      if (value) headers.set(key, value);
    }

    // Apply route-configured headers (with env var resolution)
    if (route.headers) {
      for (const [key, value] of Object.entries(route.headers)) {
        headers.set(key.toLowerCase(), resolveEnvTemplate(value));
      }
    }

    // Build body for non-GET/HEAD
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? c.req.raw.body : undefined;

    // Forward request
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

      const upstream = await fetch(upstreamUrl, {
        method,
        headers: Object.fromEntries(headers),
        body,
        signal: controller.signal,
        // @ts-ignore — Bun supports duplex for streaming body
        duplex: hasBody ? "half" : undefined,
      });

      clearTimeout(timeout);

      // Filter hop-by-hop headers from response
      const responseHeaders = new Headers();
      for (const [key, value] of upstream.headers.entries()) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[proxy] ${name} → ${upstreamUrl}: ${message}`);
      return c.text(`Bad Gateway: proxy "${name}" upstream error — ${message}`, 502);
    }
  };
}

/**
 * Merge manifest proxy routes with workspace proxy.json routes.
 * Workspace entries override manifest entries with the same name.
 */
export function mergeProxyConfig(
  manifestProxy: Record<string, ProxyRoute> | undefined,
  workspaceProxy: Record<string, ProxyRoute> | undefined,
): Map<string, ProxyRoute> {
  const merged = new Map<string, ProxyRoute>();
  if (manifestProxy) {
    for (const [name, route] of Object.entries(manifestProxy)) {
      merged.set(name, route);
    }
  }
  if (workspaceProxy) {
    for (const [name, route] of Object.entries(workspaceProxy)) {
      merged.set(name, route);
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/__tests__/proxy-middleware.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/proxy-middleware.ts server/__tests__/proxy-middleware.test.ts
git commit -m "feat(proxy): add reverse proxy middleware with tests"
```

---

### Task 3: Register proxy middleware in server and wire up hot reload

**Files:**
- Modify: `server/index.ts:1-24` (imports), `server/index.ts:27-44` (ServerOptions), `server/index.ts:1509` (route registration area)
- Modify: `server/file-watcher.ts`
- Modify: `bin/pneuma.ts` (pass manifest.proxy to server, wire proxy.json watcher)

- [ ] **Step 1: Add proxy imports and ServerOptions field in server/index.ts**

Add import at the top of `server/index.ts` (after line 23):

```typescript
import { createProxyMiddleware, mergeProxyConfig, type ProxyConfigRef } from "./proxy-middleware.js";
import type { ProxyRoute } from "../core/types/mode-manifest.js";
```

Add to `ServerOptions` interface (after `replayMode`):

```typescript
  manifestProxy?: Record<string, ProxyRoute>; // Manifest-declared proxy routes
```

- [ ] **Step 2: Initialize proxy config and register middleware**

In the `startServer` function, after the launcher mode early return (after line 868), add proxy initialization:

```typescript
  // ── Proxy config (hot-reloadable) ────────────────────────────────────
  const proxyConfigRef: ProxyConfigRef = { current: new Map() };

  // Load workspace proxy.json if it exists
  const proxyJsonPath = join(workspace, "proxy.json");
  let workspaceProxy: Record<string, ProxyRoute> | undefined;
  if (existsSync(proxyJsonPath)) {
    try {
      workspaceProxy = JSON.parse(readFileSync(proxyJsonPath, "utf-8"));
    } catch (err) {
      console.error(`[proxy] Failed to parse proxy.json: ${err}`);
    }
  }
  proxyConfigRef.current = mergeProxyConfig(options.manifestProxy, workspaceProxy);
  if (proxyConfigRef.current.size > 0) {
    console.log(`[proxy] Loaded ${proxyConfigRef.current.size} proxy route(s): ${[...proxyConfigRef.current.keys()].join(", ")}`);
  }
```

Before the content serving section (before line 1509 — the `// ── Static content serving` comment), add the proxy route:

```typescript
  // ── Reverse proxy for viewer API access ────────────────────────────────
  app.all("/proxy/*", createProxyMiddleware(proxyConfigRef));
```

- [ ] **Step 3: Add proxy.json file watcher in file-watcher.ts**

Add a new exported function at the end of `server/file-watcher.ts`:

```typescript
/**
 * Watch proxy.json for changes and call the update callback with parsed config.
 * Uses the same chokidar pattern as startFileWatcher but dedicated to proxy config.
 */
export function startProxyWatcher(
  workspace: string,
  onUpdate: (config: Record<string, unknown> | null) => void,
): void {
  const proxyPath = join(workspace, "proxy.json");

  const watcher = watch(proxyPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const reload = () => {
    if (existsSync(proxyPath)) {
      try {
        const content = readFileSync(proxyPath, "utf-8");
        const parsed = JSON.parse(content);
        console.log(`[proxy] proxy.json updated, reloading config`);
        onUpdate(parsed);
      } catch (err) {
        console.error(`[proxy] Failed to parse proxy.json: ${err}`);
      }
    } else {
      console.log(`[proxy] proxy.json removed, clearing workspace proxy config`);
      onUpdate(null);
    }
  };

  watcher.on("change", reload);
  watcher.on("add", reload);
  watcher.on("unlink", reload);
}
```

- [ ] **Step 4: Wire proxy watcher in bin/pneuma.ts**

In `bin/pneuma.ts`, add import for the proxy watcher and merge function (near the existing `startFileWatcher` import, line 18):

```typescript
import { startFileWatcher, startProxyWatcher } from "../server/file-watcher.js";
import { mergeProxyConfig } from "../server/proxy-middleware.js";
```

In the normal mode `startServer` call (around line 1124), pass `manifestProxy`:

```typescript
  const { server, wsBridge, port: actualPort, modeMakerCleanup, onReplayContinue } = startServer({
    port: serverPort,
    workspace,
    watchPatterns: manifest.viewer.watchPatterns,
    manifestProxy: manifest.proxy,
    // ... rest of existing options
```

After both `startFileWatcher` calls (lines 1247 and 1414), add the proxy watcher. The watcher needs access to `proxyConfigRef` — since it's inside `startServer`, expose it from the return value.

**Alternative approach (simpler):** Instead of exposing `proxyConfigRef`, have `startServer` accept an `onProxyChange` callback and set up the watcher internally. But the cleanest approach is: move proxy watcher start into `startServer` itself, since it already knows the workspace and has `proxyConfigRef`.

Add in `startServer`, right after the proxy config initialization block:

```typescript
  // Watch proxy.json for hot reload
  if (!options.launcherMode) {
    startProxyWatcher(workspace, (config) => {
      proxyConfigRef.current = mergeProxyConfig(options.manifestProxy, (config ?? undefined) as Record<string, ProxyRoute> | undefined);
      console.log(`[proxy] Config reloaded: ${proxyConfigRef.current.size} route(s)`);
    });
  }
```

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: All existing tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/file-watcher.ts bin/pneuma.ts
git commit -m "feat(proxy): register middleware in server, wire hot reload"
```

---

### Task 4: Add Vite dev proxy entry

**Files:**
- Modify: `vite.config.ts:162-166`

- [ ] **Step 1: Add /proxy entry to Vite dev server proxy**

In `vite.config.ts`, add the `/proxy` entry to the proxy config (after line 165):

```typescript
    proxy: {
      "/api": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/content": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/export": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/proxy": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
    },
```

- [ ] **Step 2: Verify dev mode works**

Run: `bun run dev gridboard` (manual verification — Vite should start without errors)
Expected: Vite dev server starts, `/proxy` route is listed in proxy config output.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat(proxy): add /proxy entry to Vite dev server proxy"
```

---

### Task 5: Generate proxy docs in skill installer

**Files:**
- Modify: `server/skill-installer.ts:107-219`

- [ ] **Step 1: Write the failing test**

Add to existing test file or create `server/__tests__/skill-installer-proxy.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { generateViewerApiSection } from "../skill-installer.js";
import type { ViewerApiConfig } from "../../core/types/mode-manifest.js";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { generateProxySection } from "../skill-installer.js";

describe("generateProxySection", () => {
  test("returns empty string when no proxy config", () => {
    expect(generateProxySection(undefined)).toBe("");
  });

  test("generates markdown table for proxy routes", () => {
    const proxy: Record<string, ProxyRoute> = {
      github: {
        target: "https://api.github.com",
        description: "GitHub REST API",
      },
      weather: {
        target: "https://wttr.in",
        description: "Weather data",
      },
    };
    const result = generateProxySection(proxy);
    expect(result).toContain("### Proxy");
    expect(result).toContain("`github`");
    expect(result).toContain("https://api.github.com");
    expect(result).toContain("GitHub REST API");
    expect(result).toContain("`weather`");
    expect(result).toContain("/proxy/<name>/<path>");
    expect(result).toContain("proxy.json");
  });

  test("handles routes without description", () => {
    const proxy: Record<string, ProxyRoute> = {
      api: { target: "https://api.example.com" },
    };
    const result = generateProxySection(proxy);
    expect(result).toContain("`api`");
    expect(result).toContain("https://api.example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/skill-installer-proxy.test.ts`
Expected: FAIL — `generateProxySection` not exported.

- [ ] **Step 3: Implement generateProxySection**

Add to `server/skill-installer.ts`, after the `generateViewerApiSection` function (after line 219):

```typescript
/**
 * Generate a CLAUDE.md section describing available proxy routes.
 * Pure function — no side effects.
 */
export function generateProxySection(
  proxy: Record<string, import("../core/types/mode-manifest.js").ProxyRoute> | undefined,
): string {
  if (!proxy || Object.keys(proxy).length === 0) return "";

  const lines: string[] = [
    "### Proxy",
    "",
    "The runtime provides a reverse proxy to avoid CORS issues when fetching external APIs from viewer code.",
    "",
    "**Available proxies (from mode defaults):**",
    "",
    "| Name | Target | Description |",
    "|------|--------|-------------|",
  ];

  for (const [name, route] of Object.entries(proxy)) {
    lines.push(`| \`${name}\` | \`${route.target}\` | ${route.description ?? "—"} |`);
  }

  lines.push("");
  lines.push("**Usage in viewer code:**");
  lines.push("- Use `/proxy/<name>/<path>` instead of absolute URLs");
  lines.push("- Example: `fetch(\"/proxy/" + Object.keys(proxy)[0] + "/path/to/resource\")`");
  lines.push("");
  lines.push("**Adding new proxies at runtime:**");
  lines.push("- Write `proxy.json` in workspace root:");
  lines.push("  ```json");
  lines.push('  { "myapi": { "target": "https://api.example.com", "headers": { "Authorization": "Bearer {{API_KEY}}" } } }');
  lines.push("  ```");
  lines.push("- Immediately available at `/proxy/myapi/...` (no restart needed)");
  lines.push("- Headers support `{{ENV_VAR}}` for secrets from environment variables");
  lines.push('- Allowed methods default to GET only; add `"methods": ["GET","POST"]` if needed');
  lines.push("");

  return lines.join("\n");
}
```

- [ ] **Step 4: Integrate into installSkill**

Modify `installSkill` function signature in `server/skill-installer.ts` to accept proxy config. Add a `proxyConfig` parameter after `viewerApi`:

```typescript
export function installSkill(
  workspace: string,
  skillConfig: SkillConfig,
  modeSourceDir: string,
  params?: Record<string, number | string>,
  viewerApi?: ViewerApiConfig,
  backendType?: string,
  proxyConfig?: Record<string, import("../core/types/mode-manifest.js").ProxyRoute>,
): void {
```

In the viewer API section injection (around line 456), append proxy section to viewerApiContent:

```typescript
  // 2b. Inject/update Viewer API section (independent marker, Viewer-owned)
  let viewerApiContent = generateViewerApiSection(viewerApi);
  const proxyContent = generateProxySection(proxyConfig);
  if (proxyContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n" + proxyContent
      : proxyContent;
  }
```

Note: The rest of the viewer API injection code stays the same — it wraps `viewerApiContent` in markers and injects it.

- [ ] **Step 5: Update installSkill call sites in bin/pneuma.ts**

There are 3 `installSkill` calls in `bin/pneuma.ts`. Update the main ones to pass `manifest.proxy`:

Line 952 (normal mode):
```typescript
    installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType, manifest.proxy);
```

Line 1183 (replay continue):
```typescript
      installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType, manifest.proxy);
```

The evolve mode call (line 472/477) doesn't need proxy — leave it unchanged.

- [ ] **Step 6: Run tests**

Run: `bun test server/__tests__/skill-installer-proxy.test.ts && bun test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/skill-installer.ts bin/pneuma.ts server/__tests__/skill-installer-proxy.test.ts
git commit -m "feat(proxy): generate proxy docs in CLAUDE.md via skill installer"
```

---

### Task 6: Add preset proxy routes to gridboard manifest

**Files:**
- Modify: `modes/gridboard/manifest.ts`

- [ ] **Step 1: Add proxy field to gridboard manifest**

In `modes/gridboard/manifest.ts`, add after the `viewer` block (after line 56, before `agent`):

```typescript
  proxy: {
    coingecko: {
      target: "https://api.coingecko.com",
      description: "Cryptocurrency price and market data",
    },
    wttr: {
      target: "https://wttr.in",
      description: "Weather forecast data (JSON format)",
    },
    hn: {
      target: "https://hn.algolia.com",
      description: "Hacker News search API",
    },
  },
```

- [ ] **Step 2: Run tests to verify no regressions**

Run: `bun test`
Expected: PASS — manifest type-checks correctly with new proxy field.

- [ ] **Step 3: Commit**

```bash
git add modes/gridboard/manifest.ts
git commit -m "feat(proxy): add preset proxy routes to gridboard manifest"
```

---

### Task 7: Update gridboard skill and seed tiles to use /proxy/

**Files:**
- Modify: `modes/gridboard/skill/SKILL.md`
- Modify: `modes/gridboard/seed/default/tiles/crypto-ticker/Tile.tsx`
- Modify: `modes/gridboard/seed/default/tiles/weather/Tile.tsx`
- Modify: `modes/gridboard/seed/default/tiles/ai-news/Tile.tsx`

- [ ] **Step 1: Update SKILL.md dataSource example**

In `modes/gridboard/skill/SKILL.md`, update the example `fetch` call (around lines 97-103) to use the proxy pattern:

```typescript
  dataSource: {
    refreshInterval: 60,
    fetch: async ({ signal, params }) => {
      // Use /proxy/<name>/ to avoid CORS — proxied by pneuma runtime
      const res = await fetch("/proxy/myapi/metrics/revenue", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  },
```

Also add a brief note about proxy usage near the `TileFetchContext` section (after line 61):

```markdown
> **Proxy for external APIs:** Use `/proxy/<name>/<path>` instead of absolute URLs to avoid CORS issues.
> Available proxies are listed in the Viewer API section of CLAUDE.md. To add new ones, write a `proxy.json`
> file in the workspace root. See the Proxy section in CLAUDE.md for details.
```

- [ ] **Step 2: Update crypto-ticker tile**

In `modes/gridboard/seed/default/tiles/crypto-ticker/Tile.tsx`, replace direct CoinGecko fetch URLs:

Replace `https://api.coingecko.com/api/v3/` with `/proxy/coingecko/api/v3/` in all fetch calls.

- [ ] **Step 3: Update weather tile**

In `modes/gridboard/seed/default/tiles/weather/Tile.tsx`, replace:

```typescript
const res = await fetch(`https://wttr.in/${city}?format=j1`, { signal });
```

with:

```typescript
const res = await fetch(`/proxy/wttr/${city}?format=j1`, { signal });
```

- [ ] **Step 4: Update ai-news tile**

In `modes/gridboard/seed/default/tiles/ai-news/Tile.tsx`, replace:

```typescript
const res = await fetch(
  "https://hn.algolia.com/api/v1/search?query=AI+LLM+GPT&tags=story&hitsPerPage=10",
  { signal: ctx.signal },
);
```

with:

```typescript
const res = await fetch(
  "/proxy/hn/api/v1/search?query=AI+LLM+GPT&tags=story&hitsPerPage=10",
  { signal: ctx.signal },
);
```

- [ ] **Step 5: Run tests**

Run: `bun test`
Expected: PASS — no test regressions.

- [ ] **Step 6: Manual verification**

Start dev server: `bun run dev gridboard`
Create a new workspace and verify:
1. Seed tiles load data through `/proxy/` URLs
2. Network tab shows requests going to `localhost:17007/proxy/coingecko/...` etc.
3. CLAUDE.md contains the Proxy section with the 3 preset routes

- [ ] **Step 7: Commit**

```bash
git add modes/gridboard/skill/SKILL.md modes/gridboard/seed/default/tiles/crypto-ticker/Tile.tsx modes/gridboard/seed/default/tiles/weather/Tile.tsx modes/gridboard/seed/default/tiles/ai-news/Tile.tsx
git commit -m "feat(proxy): update gridboard tiles and skill to use /proxy/ routes"
```

---

### Task 8: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document proxy mechanism in CLAUDE.md**

Add a brief entry to the Server API Reference section, after the Workspace & Viewer subsection:

```markdown
### Proxy

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/proxy/<name>/*` | Reverse proxy to external API (config from manifest + proxy.json) |
```

Add to Known Gotchas:

```markdown
- **Proxy hot reload**: `proxy.json` changes are picked up by chokidar. The proxy middleware reads config from memory on each request, so no server restart is needed.
- **Proxy methods**: Default allowed method is GET only. POST/PUT/PATCH require explicit `"methods"` in config.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add proxy API and gotchas to CLAUDE.md"
```
