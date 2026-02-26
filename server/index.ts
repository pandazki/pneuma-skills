import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WsBridge } from "./ws-bridge.js";
import type { SocketData } from "./ws-bridge.js";
import type { ServerWebSocket } from "bun";

const DEFAULT_PORT = 3210;

export interface ServerOptions {
  port?: number;
  workspace: string;
}

export function startServer(options: ServerOptions) {
  const port = options.port ?? DEFAULT_PORT;
  const workspace = resolve(options.workspace);
  const wsBridge = new WsBridge();

  const app = new Hono();

  // ── API Routes ─────────────────────────────────────────────────────────
  app.get("/api/files", (c) => {
    const files: { path: string; content: string }[] = [];
    // Scan workspace for .md files (simple flat scan for MVP)
    try {
      const entries = new Bun.Glob("**/*.md").scanSync({ cwd: workspace, absolute: false });
      for (const relPath of entries) {
        // Skip config files — only show content files in preview
        if (relPath === "CLAUDE.md" || relPath.startsWith(".claude/")) continue;
        const absPath = join(workspace, relPath);
        try {
          const content = readFileSync(absPath, "utf-8");
          files.push({ path: relPath, content });
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // glob failed
    }
    return c.json({ files, workspace });
  });

  // ── Static content serving (workspace files) ──────────────────────────
  app.get("/content/*", async (c) => {
    const relPath = c.req.path.replace(/^\/content\//, "");
    const absPath = join(workspace, relPath);
    // Basic path traversal protection
    if (!absPath.startsWith(workspace)) {
      return c.text("Forbidden", 403);
    }
    if (!existsSync(absPath)) {
      return c.text("Not found", 404);
    }
    try {
      const file = Bun.file(absPath);
      return new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
    } catch {
      return c.text("Error reading file", 500);
    }
  });

  // ── Bun.serve with WebSocket ──────────────────────────────────────────
  const server = Bun.serve<SocketData>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // CLI WebSocket — Claude Code CLI connects here via --sdk-url
      const cliMatch = url.pathname.match(/^\/ws\/cli\/([a-f0-9-]+)$/);
      if (cliMatch) {
        const sessionId = cliMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "cli" as const, sessionId },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Browser WebSocket — connects to a specific session
      const browserMatch = url.pathname.match(/^\/ws\/browser\/([a-f0-9-]+)$/);
      if (browserMatch) {
        const sessionId = browserMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "browser" as const, sessionId },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Hono handles the rest
      return app.fetch(req, server);
    },
    websocket: {
      open(ws: ServerWebSocket<SocketData>) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIOpen(ws, data.sessionId);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserOpen(ws, data.sessionId);
        }
      },
      message(ws: ServerWebSocket<SocketData>, msg: string | Buffer) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIMessage(ws, msg);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserMessage(ws, msg);
        }
      },
      close(ws: ServerWebSocket<SocketData>) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIClose(ws);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserClose(ws);
        }
      },
    },
  });

  console.log(`[server] Pneuma server running on http://localhost:${server.port}`);
  console.log(`[server] Workspace: ${workspace}`);
  console.log(`[server] CLI WebSocket:     ws://localhost:${server.port}/ws/cli/:sessionId`);
  console.log(`[server] Browser WebSocket: ws://localhost:${server.port}/ws/browser/:sessionId`);

  return { server, wsBridge, port: server.port as number };
}
