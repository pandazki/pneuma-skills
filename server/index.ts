import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, basename, extname } from "node:path";
import { execSync } from "node:child_process";
import { WsBridge } from "./ws-bridge.js";
import type { SocketData } from "./ws-bridge.js";
import type { TerminalSocketData } from "./ws-bridge-types.js";
import type { ServerWebSocket } from "bun";
import { TerminalManager } from "./terminal-manager.js";

const DEFAULT_PORT = 17007;

export interface ServerOptions {
  port?: number;
  workspace: string;
  distDir?: string; // Path to built frontend assets (production mode)
}

export function startServer(options: ServerOptions) {
  const port = options.port ?? DEFAULT_PORT;
  const workspace = resolve(options.workspace);
  const wsBridge = new WsBridge();
  const terminalManager = new TerminalManager();

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

  // ── Save file ────────────────────────────────────────────────────────
  app.post("/api/files", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    const relPath = body.path;
    if (!relPath || typeof body.content !== "string") {
      return c.json({ error: "Missing path or content" }, 400);
    }
    const absPath = join(workspace, relPath);
    if (!absPath.startsWith(workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    try {
      writeFileSync(absPath, body.content, "utf-8");
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: "Failed to write file" }, 500);
    }
  });

  // ── Read single file ────────────────────────────────────────────────
  app.get("/api/files/read", (c) => {
    const relPath = c.req.query("path");
    if (!relPath) return c.json({ error: "Missing path" }, 400);
    const absPath = join(workspace, relPath);
    if (!absPath.startsWith(workspace)) return c.json({ error: "Forbidden" }, 403);
    try {
      const content = readFileSync(absPath, "utf-8");
      return c.json({ path: relPath, content });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });

  // ── File tree ──────────────────────────────────────────────────────
  app.get("/api/files/tree", (c) => {
    interface TreeNode {
      name: string;
      path: string;
      type: "file" | "directory";
      children?: TreeNode[];
    }
    function buildTree(dir: string, relBase: string): TreeNode[] {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return entries.map((e) => {
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
          return { name: e.name, path: rel, type: "directory" as const, children: buildTree(join(dir, e.name), rel) };
        }
        return { name: e.name, path: rel, type: "file" as const };
      });
    }
    return c.json({ tree: buildTree(workspace, "") });
  });

  // ── Git: changed files ─────────────────────────────────────────────
  app.get("/api/git/changed-files", (c) => {
    const base = c.req.query("base") || "last-commit";
    const files = new Map<string, string>(); // relPath → status (A/M/D)
    try {
      // Uncommitted changes vs HEAD
      const nameStatus = execSync("git diff HEAD --name-status", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const line of nameStatus.split("\n").filter(Boolean)) {
        const [status, ...parts] = line.split("\t");
        const filePath = parts.join("\t");
        if (status && filePath) files.set(filePath, status.charAt(0));
      }
      // Untracked files
      const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const filePath of untracked.split("\n").filter(Boolean)) {
        if (!files.has(filePath)) files.set(filePath, "A");
      }
      // Branch diff (if requested)
      if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          const branchStatus = execSync(`git diff ${defaultBranch}...HEAD --name-status`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          for (const line of branchStatus.split("\n").filter(Boolean)) {
            const [status, ...parts] = line.split("\t");
            const filePath = parts.join("\t");
            if (status && filePath && !files.has(filePath)) files.set(filePath, status.charAt(0));
          }
        } catch { /* no default branch info available */ }
      }
    } catch {
      // Not a git repo or git not available
    }
    const result = Array.from(files.entries()).map(([path, status]) => ({ path, status }));
    return c.json({ files: result });
  });

  // ── Git: file diff ─────────────────────────────────────────────────
  app.get("/api/git/diff", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "Missing path" }, 400);
    const base = c.req.query("base") || "last-commit";
    try {
      let diff = "";
      const absPath = join(workspace, filePath);
      // Check if file is untracked
      const tracked = execSync(`git ls-files -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (!tracked) {
        // Untracked new file — diff against /dev/null
        try {
          diff = execSync(`git diff --no-index -- /dev/null "${absPath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) {
          // git diff --no-index exits with 1 when there are differences
          diff = e.stdout?.toString() || "";
        }
      } else if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          diff = execSync(`git diff ${defaultBranch}...HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch { /* fallback to HEAD */ }
        if (!diff) {
          try {
            diff = execSync(`git diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          } catch (e: any) { diff = e.stdout?.toString() || ""; }
        }
      } else {
        try {
          diff = execSync(`git diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) { diff = e.stdout?.toString() || ""; }
      }
      return c.json({ path: filePath, diff });
    } catch {
      return c.json({ path: filePath, diff: "" });
    }
  });

  // ── Git: status (for editor file tree badges) ──────────────────────
  app.get("/api/git/status", (c) => {
    try {
      const output = execSync("git status --porcelain", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      const statuses: Record<string, string> = {};
      for (const line of output.split("\n").filter(Boolean)) {
        const status = line.substring(0, 2).trim();
        const filePath = line.substring(3);
        if (status === "??" || status === "A") statuses[filePath] = "A";
        else if (status === "D") statuses[filePath] = "D";
        else statuses[filePath] = "M";
      }
      return c.json({ statuses });
    } catch {
      return c.json({ statuses: {} });
    }
  });

  // ── Process management ──────────────────────────────────────────────
  app.get("/api/processes/system", (c) => {
    const DEV_COMMANDS = new Set(["node", "bun", "deno", "python", "python3", "uvicorn", "vite", "next", "nuxt", "webpack", "esbuild", "tsx"]);
    const EXCLUDE_COMMANDS = new Set(["launchd", "nginx", "docker", "dockerd", "com.docker", "Cursor", "cursor", "Code", "code"]);
    const processes: { pid: number; command: string; fullCommand: string; ports: number[]; cwd?: string; startedAt?: number }[] = [];
    try {
      const lsofOutput = execSync("lsof -iTCP -sTCP:LISTEN -P -n", { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
      const pidPorts = new Map<number, Set<number>>();
      const pidCommand = new Map<number, string>();
      for (const line of lsofOutput.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const cmd = parts[0];
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;
        if (EXCLUDE_COMMANDS.has(cmd)) continue;
        if (!DEV_COMMANDS.has(cmd)) continue;
        pidCommand.set(pid, cmd);
        const nameField = parts[parts.length - 1];
        const portMatch = nameField.match(/:(\d+)$/);
        if (portMatch) {
          if (!pidPorts.has(pid)) pidPorts.set(pid, new Set());
          pidPorts.get(pid)!.add(parseInt(portMatch[1], 10));
        }
      }
      for (const [pid, ports] of pidPorts) {
        let fullCommand = "";
        let cwd: string | undefined;
        try { fullCommand = execSync(`ps -p ${pid} -o args=`, { encoding: "utf-8", timeout: 3_000 }).trim(); } catch {}
        try {
          const cwdOutput = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf-8", timeout: 3_000 });
          const cwdMatch = cwdOutput.match(/\nn(.+)/);
          if (cwdMatch) cwd = cwdMatch[1];
        } catch {}
        processes.push({
          pid,
          command: pidCommand.get(pid) || "",
          fullCommand,
          ports: Array.from(ports),
          cwd,
        });
      }
    } catch { /* lsof not available or failed */ }
    return c.json({ processes });
  });

  app.post("/api/processes/:taskId/kill", async (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[a-f0-9]+$/i.test(taskId)) return c.json({ error: "Invalid taskId" }, 400);
    try {
      execSync(`pkill -f "${taskId}"`, { timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] });
    } catch { /* process may already be gone */ }
    return c.json({ ok: true, taskId });
  });

  app.post("/api/processes/system/:pid/kill", async (c) => {
    const pid = parseInt(c.req.param("pid"), 10);
    if (isNaN(pid) || pid <= 0) return c.json({ error: "Invalid PID" }, 400);
    if (pid === process.pid) return c.json({ error: "Cannot kill self" }, 403);
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    return c.json({ ok: true, pid });
  });

  // ── Terminal management ──────────────────────────────────────────────
  app.post("/api/terminal/spawn", async (c) => {
    const body = await c.req.json<{ cwd?: string; cols?: number; rows?: number }>();
    const cwd = body.cwd || workspace;
    const terminalId = terminalManager.spawn(cwd, body.cols, body.rows);
    return c.json({ terminalId });
  });

  app.get("/api/terminal", (c) => {
    const terminalId = c.req.query("terminalId");
    const info = terminalManager.getInfo(terminalId);
    if (info) {
      return c.json({ active: true, terminalId: info.id, cwd: info.cwd });
    }
    return c.json({ active: false });
  });

  app.post("/api/terminal/kill", async (c) => {
    const body = await c.req.json<{ terminalId?: string }>();
    terminalManager.kill(body.terminalId);
    return c.json({ ok: true });
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

  // ── Built frontend serving (production) ─────────────────────────────
  if (options.distDir) {
    const distDir = options.distDir;

    app.get("/assets/*", async (c) => {
      const filePath = join(distDir, c.req.path);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return c.notFound();
    });

    // SPA fallback — serve index.html for all non-API routes
    app.get("*", async (c) => {
      return new Response(Bun.file(join(distDir, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    });
  }

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

      // Terminal WebSocket — connects to a PTY terminal
      const terminalMatch = url.pathname.match(/^\/ws\/terminal\/([a-f0-9-]+)$/);
      if (terminalMatch) {
        const terminalId = terminalMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "terminal" as const, terminalId },
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
        } else if (data.kind === "terminal") {
          terminalManager.addBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
        }
      },
      message(ws: ServerWebSocket<SocketData>, msg: string | Buffer) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIMessage(ws, msg);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserMessage(ws, msg);
        } else if (data.kind === "terminal") {
          terminalManager.handleBrowserMessage(ws as ServerWebSocket<TerminalSocketData>, msg);
        }
      },
      close(ws: ServerWebSocket<SocketData>) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIClose(ws);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserClose(ws);
        } else if (data.kind === "terminal") {
          terminalManager.removeBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
        }
      },
    },
  });

  console.log(`[server] Pneuma server running on http://localhost:${server.port}`);
  console.log(`[server] Workspace: ${workspace}`);
  console.log(`[server] CLI WebSocket:     ws://localhost:${server.port}/ws/cli/:sessionId`);
  console.log(`[server] Browser WebSocket: ws://localhost:${server.port}/ws/browser/:sessionId`);

  return { server, wsBridge, terminalManager, port: server.port as number };
}
