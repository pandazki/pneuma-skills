# ADR-010: CLI 入口与启动流程

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-003, ADR-004, ADR-006, ADR-008

---

## 1. 背景

Pneuma 通过 CLI 启动，形如：

```bash
pneuma slide                            # 启动 Slide Mode
pneuma slide --workspace ./my-deck      # 指定工作目录
pneuma slide --port 3210                # 指定端口
pneuma slide --model claude-opus-4-6    # 指定模型
```

CLI 负责：
1. 解析命令行参数
2. 加载 Content Mode 和 Agent Backend
3. 安装 Skill 到工作目录
4. 启动 Bun Server (HTTP + WebSocket)
5. Spawn Claude Code CLI
6. 打开浏览器

### Companion 对比

Companion 的启动方式不同 — 它是一个持久化 web 服务，通过 `bun run dev` 或 Docker 启动，支持多 session。

Pneuma 更像 `vite dev` 或 `slidev` — 一个面向特定项目的开发服务器。

---

## 2. 决策

### 2.1 CLI 框架

**不使用 CLI 框架（commander/yargs），手写参数解析。**

理由：
- 参数很少（mode 子命令 + 几个 flag），手写更轻量
- 减少依赖
- Phase 2 如果参数变多可以引入 commander

### 2.2 自动打开浏览器

**启动后自动打开默认浏览器**，可通过 `--no-open` 禁用。

### 2.3 workspace 默认值

**默认为当前工作目录 (`process.cwd()`)。**

---

## 3. 详细设计

### 3.1 CLI 参数定义

```
pneuma <mode> [options]

Modes:
  slide                     启动 Slide Mode (MVP 唯一支持的 mode)

Options:
  --workspace, -w <path>    工作目录 (默认: 当前目录)
  --port, -p <number>       服务端口 (默认: 3210)
  --agent <name>            Agent Backend (默认: claude-code)
  --model <name>            Claude 模型 (默认: 使用 CLI 默认)
  --permission-mode <mode>  权限模式: default | acceptEdits | bypassPermissions
  --no-open                 不自动打开浏览器
  --verbose                 详细日志
  --version, -v             显示版本号
  --help, -h                显示帮助
```

### 3.2 CLI 入口实现

```typescript
// bin/pneuma.ts
#!/usr/bin/env bun

import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

// === 参数解析 ===

interface CLIOptions {
  mode: string;
  workspace: string;
  port: number;
  agent: string;
  model?: string;
  permissionMode?: string;
  open: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);  // 跳过 bun 和脚本路径

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    const pkg = require("../package.json");
    console.log(`pneuma v${pkg.version}`);
    process.exit(0);
  }

  const mode = args[0];
  const options: CLIOptions = {
    mode,
    workspace: process.cwd(),
    port: 3210,
    agent: "claude-code",
    open: true,
    verbose: false,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case "--workspace":
      case "-w":
        options.workspace = resolve(args[++i]);
        break;
      case "--port":
      case "-p":
        options.port = parseInt(args[++i], 10);
        break;
      case "--agent":
        options.agent = args[++i];
        break;
      case "--model":
        options.model = args[++i];
        break;
      case "--permission-mode":
        options.permissionMode = args[++i];
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
    i++;
  }

  return options;
}

function printHelp(): void {
  console.log(`
pneuma - Let Code Agents do WYSIWYG editing on HTML-based content

Usage:
  pneuma <mode> [options]

Modes:
  slide     Slide presentation editor (MVP)

Options:
  -w, --workspace <path>        Working directory (default: current directory)
  -p, --port <number>           Server port (default: 3210)
      --agent <name>            Agent backend (default: claude-code)
      --model <name>            Claude model
      --permission-mode <mode>  Permission mode: default | acceptEdits | bypassPermissions
      --no-open                 Don't auto-open browser
      --verbose                 Verbose logging
  -v, --version                 Show version
  -h, --help                    Show help

Examples:
  pneuma slide
  pneuma slide -w ./my-deck --port 3333
  pneuma slide --model claude-opus-4-6 --permission-mode acceptEdits
`);
}
```

### 3.3 启动流程

```typescript
// bin/pneuma.ts (续)

async function main() {
  const options = parseArgs(process.argv);

  // 1. 加载 Content Mode
  console.log(`\n  Pneuma · ${options.mode} mode\n`);

  const mode = getMode(options.mode);
  if (!mode) {
    console.error(`Unknown mode: ${options.mode}`);
    process.exit(1);
  }

  // 2. 加载 Agent Backend
  const backend = getBackend(options.agent);
  if (!backend) {
    console.error(`Unknown agent backend: ${options.agent}`);
    process.exit(1);
  }

  // 3. 确保工作目录存在
  if (!existsSync(options.workspace)) {
    mkdirSync(options.workspace, { recursive: true });
    console.log(`  Created workspace: ${options.workspace}`);
  }

  // 4. 安装 Skill
  console.log(`  Installing ${mode.name} skill...`);
  const skillResult = await installSkill(mode, options.workspace);
  if (skillResult.installed) {
    console.log(`  Skill v${skillResult.version} installed → ${skillResult.path}`);
  } else {
    console.log(`  Skill v${skillResult.version} already up to date`);
  }

  // 5. 初始化 Content Mode (如果需要)
  if (mode.initialize) {
    await mode.initialize(options.workspace);
  }

  // 6. 创建 Server
  const sessionStore = new SessionStore();
  const sessionManager = new SessionManager(sessionStore);
  const server = createServer({
    port: options.port,
    workspace: options.workspace,
    mode,
    backend,
    sessionManager,
    verbose: options.verbose,
  });

  // 7. 创建 Session
  const session = await sessionManager.create({
    workspace: options.workspace,
    mode,
    backend,
    port: options.port,
    model: options.model,
    permissionMode: options.permissionMode,
  });

  // 8. 启动 Server
  const url = `http://localhost:${options.port}`;
  server.start();

  console.log(`\n  Server running at ${url}`);
  console.log(`  Workspace: ${options.workspace}`);
  console.log(`  Session: ${session.id}`);
  console.log(`  Agent: ${backend.name} (${options.model || "default model"})`);
  console.log(`\n  Waiting for Claude Code to connect...`);

  // 9. 打开浏览器
  if (options.open) {
    setTimeout(() => {
      openBrowser(url);
    }, 500);  // 等待 server 完全启动
  }

  // 10. 监听 CLI 连接
  // (通过 WebSocket 事件自动处理，见 ADR-002)

  // 11. Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down...");
    await sessionManager.destroy();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

### 3.4 Server 创建

```typescript
// core/server/index.ts

import { Hono } from "hono";
import { cors } from "hono/cors";

interface ServerOptions {
  port: number;
  workspace: string;
  mode: ContentMode;
  backend: AgentBackend;
  sessionManager: SessionManager;
  verbose: boolean;
}

function createServer(options: ServerOptions) {
  const app = new Hono();
  const wsBridge = new WsBridge(options.sessionManager);

  // === HTTP Routes ===

  app.use("/api/*", cors());

  // Session info
  app.get("/api/session", (c) => {
    const session = options.sessionManager.getSession();
    if (!session) return c.json({ error: "No active session" }, 404);
    return c.json({
      id: session.id,
      mode: session.modeName,
      backend: session.backendName,
      cliState: session.cliState,
      state: session.state,
    });
  });

  // Content manifest
  app.get("/api/manifest", async (c) => {
    const manifestPath = join(options.workspace, options.mode.fileConvention.manifestFile);
    try {
      const content = await Bun.file(manifestPath).text();
      return c.json(JSON.parse(content));
    } catch {
      return c.json({ error: "Manifest not found" }, 404);
    }
  });

  // === Content static files ===
  const contentRoutes = createContentRoutes(options.workspace);
  app.route("/", contentRoutes);

  // === Frontend SPA ===
  // Production: serve from dist/
  // Dev: Vite dev server handles this
  if (process.env.NODE_ENV === "production") {
    const distDir = resolve(__dirname, "../../dist");
    app.use("/*", serveStatic({ root: distDir }));
    app.get("/*", serveStatic({ path: resolve(distDir, "index.html") }));
  }

  // === WebSocket + Bun.serve() ===

  let bunServer: ReturnType<typeof Bun.serve>;

  return {
    start() {
      bunServer = Bun.serve({
        port: options.port,
        idleTimeout: 120,

        async fetch(req, server) {
          const url = new URL(req.url);

          // WebSocket upgrade
          const wsMatch = url.pathname.match(
            /^\/ws\/(browser|cli)\/([a-f0-9-]+)$/
          );
          if (wsMatch && server.upgrade(req, {
            data: { kind: wsMatch[1], sessionId: wsMatch[2] },
          })) {
            return undefined;
          }

          // HTTP routes → Hono
          return app.fetch(req);
        },

        websocket: {
          open(ws) {
            const { kind, sessionId } = ws.data as any;
            if (kind === "cli") {
              wsBridge.handleCLIOpen(ws, sessionId);
            } else {
              wsBridge.handleBrowserOpen(ws, sessionId);
            }
          },
          message(ws, msg) {
            const { kind, sessionId } = ws.data as any;
            if (kind === "cli") {
              wsBridge.handleCLIMessage(ws, sessionId, msg);
            } else {
              wsBridge.handleBrowserMessage(ws, sessionId, msg as string);
            }
          },
          close(ws) {
            const { kind, sessionId } = ws.data as any;
            if (kind === "cli") {
              wsBridge.handleCLIClose(ws, sessionId);
            } else {
              wsBridge.handleBrowserClose(ws, sessionId);
            }
          },
        },
      });
    },

    stop() {
      bunServer?.stop();
    },
  };
}
```

### 3.5 打开浏览器

```typescript
function openBrowser(url: string): void {
  const cmd = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
    ? ["cmd", "/c", "start", url]
    : ["xdg-open", url];

  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    console.log(`  Open ${url} in your browser`);
  }
}
```

### 3.6 启动输出示例

```
$ pneuma slide -w ./my-deck

  Pneuma · slide mode

  Installing slide skill...
  Skill v0.1.0 installed → .claude/skills/pneuma-slide

  Server running at http://localhost:3210
  Workspace: /Users/pandazki/my-deck
  Session: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Agent: claude-code (default model)

  Waiting for Claude Code to connect...
  ✓ Claude Code connected (claude-sonnet-4-5-20250929)

  Ready! Open http://localhost:3210
```

### 3.7 开发模式

```typescript
// 开发模式启动: pneuma dev slide

// 与生产模式的区别:
// 1. Vite dev server 在独立端口 (3211) 运行
// 2. Vite proxy /api/* 和 /ws/* 到 Bun server (3210)
// 3. 前端代码支持 HMR

// vite.config.ts
export default defineConfig({
  server: {
    port: 3211,
    proxy: {
      "/api": {
        target: "http://localhost:3210",
      },
      "/ws": {
        target: "ws://localhost:3210",
        ws: true,
      },
      "/content": {
        target: "http://localhost:3210",
      },
    },
  },
});
```

### 3.8 npm 发布与安装

```json
// package.json
{
  "name": "pneuma-skills",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "pneuma": "./bin/pneuma.ts"
  },
  "files": [
    "bin/",
    "core/",
    "modes/",
    "backends/",
    "dist/"
  ],
  "engines": {
    "bun": ">=1.0.0"
  }
}
```

安装方式：
```bash
# 全局安装
bun install -g pneuma-skills

# 或直接运行
bunx pneuma-skills slide
```

---

## 4. 关键设计决策

### 4.1 Bun shebang

**使用 `#!/usr/bin/env bun` 而非 `#!/usr/bin/env node`。**

Pneuma 依赖 Bun 特性（`Bun.spawn()`, `Bun.serve()` websocket, `Bun.file()`），不兼容 Node.js。

### 4.2 不使用 CLI 框架

**手写参数解析。**

MVP 只有约 8 个参数，手写代码量 < 100 行，引入框架反而增加依赖。

### 4.3 Mode 作为子命令

**`pneuma slide` 而非 `pneuma --mode slide`。**

理由：
- 更符合 CLI 习惯（`git commit`, `docker run`, `npm install`）
- Mode 是核心概念，值得作为子命令
- 未来可以为每个 mode 定义不同的 flag

### 4.4 默认端口 3210

**选择 3210 而非 3000/8080。**

理由：
- 避免与常见开发服务器冲突（3000 = React, 8080 = 通用）
- 3210 好记且不常用

---

## 5. 被否决的方案

### 5.1 Docker 化部署

- 否决原因：Pneuma 是本地开发工具，需要访问用户的 Claude Code CLI；Docker 增加使用门槛

### 5.2 Daemon 模式

- 否决原因：MVP 不需要后台运行；一次使用一个项目

---

## 6. 影响

1. **用户需要安装 Bun** — 前置条件
2. **用户需要安装 Claude Code CLI** — 前置条件
3. **默认端口 3210** — 可能需要文档说明
4. **自动打开浏览器** — 在无头环境中可能不适用（`--no-open`）
