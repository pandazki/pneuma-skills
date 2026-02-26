# ADR-008: Session 管理与持久化

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-002, ADR-003

---

## 1. 背景

Session 是 Pneuma 中一次编辑会话的完整上下文，包括：
- WebSocket 连接状态（Browser + CLI）
- 消息历史（用户指令 + Agent 响应）
- 待处理的权限请求
- 文件监听状态
- Content Mode 状态

### Companion 调研结论

Companion 的 Session 管理非常成熟：
- **双 ID 系统** — Server UUID + CLI session_id
- **JSON 文件持久化** — `~/.companion/sessions/{id}.json`，debounced write (150ms)
- **事件缓冲** — 600 条事件 buffer，支持断线重放
- **消息幂等** — client_msg_id 去重
- **自动重连** — CLI 崩溃后自动 relaunch
- **Session Resume** — `--resume <cli-session-id>` 恢复对话

Pneuma 的需求比 Companion 简单（单 session、本地使用、不需要 Docker/多用户），但核心模式可以复用。

---

## 2. 决策

### 2.1 MVP 单 Session

**MVP 阶段只支持一个活跃 session。**

理由：
- Pneuma 是 CLI 启动的本地工具，一次编辑一个项目
- 简化实现和 UI
- Phase 2 再支持多 session / resume

### 2.2 JSON 文件持久化

**采用 Companion 的 JSON 文件存储模式**，但简化结构。

### 2.3 自动恢复策略

**MVP 不实现 session resume**，但预留 CLI session_id 映射。

---

## 3. 详细设计

### 3.1 Session 数据结构

```typescript
// core/server/session-manager.ts

interface Session {
  // === 标识 ===
  id: string;                          // Server 生成的 UUID (用于 URL 路由)
  cliSessionId?: string;               // CLI 报告的 session_id (用于未来 resume)

  // === 配置 ===
  workspace: string;                   // 工作目录绝对路径
  modeName: string;                    // Content Mode 名称 ("slide")
  backendName: string;                 // Agent Backend 名称 ("claude-code")

  // === 连接状态 ===
  cliSocket: WebSocket | null;         // CLI WebSocket
  browserSockets: Set<WebSocket>;      // Browser WebSocket(s)
  cliState: "starting" | "connected" | "running" | "exited";

  // === CLI 进程 ===
  process?: SpawnedProcess;            // Bun.spawn 的返回值

  // === 消息管理 ===
  messageHistory: HistoryMessage[];    // 持久化的消息历史
  pendingMessages: string[];           // CLI 未连接时排队的 NDJSON 消息
  pendingPermissions: Map<string, PermissionRequest>;

  // === 事件序号 ===
  nextEventSeq: number;
  eventBuffer: Array<{ seq: number; message: any }>;
  lastAckSeq: number;

  // === 幂等性 ===
  processedClientMsgIds: Set<string>;

  // === Session 状态 ===
  state: SessionState;

  // === 时间戳 ===
  createdAt: number;
  lastActiveAt: number;
}

interface SessionState {
  model?: string;
  cwd?: string;
  tools?: string[];
  permissionMode?: string;
  num_turns: number;
  total_cost_usd: number;
  contentStructure?: ContentStructure;
}

interface HistoryMessage {
  type: "user" | "assistant" | "result" | "permission";
  data: any;
  timestamp: number;
  seq?: number;
}
```

### 3.2 Session Manager

```typescript
class SessionManager {
  private session: Session | null = null;
  private store: SessionStore;
  private fileWatcher: FileWatcher | null = null;

  constructor(store: SessionStore) {
    this.store = store;
  }

  // === 创建 Session ===

  async create(options: {
    workspace: string;
    mode: ContentMode;
    backend: AgentBackend;
    port: number;
    model?: string;
    permissionMode?: string;
  }): Promise<Session> {
    const sessionId = crypto.randomUUID();

    // 1. 安装 Skill
    await installSkill(options.mode, options.workspace);

    // 2. 创建 Session 对象
    const session: Session = {
      id: sessionId,
      workspace: options.workspace,
      modeName: options.mode.name,
      backendName: options.backend.name,
      cliSocket: null,
      browserSockets: new Set(),
      cliState: "starting",
      messageHistory: [],
      pendingMessages: [],
      pendingPermissions: new Map(),
      nextEventSeq: 1,
      eventBuffer: [],
      lastAckSeq: 0,
      processedClientMsgIds: new Set(),
      state: {
        num_turns: 0,
        total_cost_usd: 0,
      },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.session = session;

    // 3. Spawn CLI
    const process = await options.backend.spawn({
      sessionId,
      port: options.port,
      cwd: options.workspace,
      model: options.model,
      permissionMode: options.permissionMode,
    });
    session.process = process.spawned;

    // 4. 启动 File Watcher
    this.fileWatcher = new FileWatcher({
      workspace: options.workspace,
      mode: options.mode,
      onContentChange: (changes) => {
        handleContentChange(changes, session, options.mode, options.workspace);
      },
    });
    this.fileWatcher.start();

    // 5. 持久化
    this.store.save(session);

    console.log(`[session] Created: ${sessionId} (${options.mode.name} + ${options.backend.name})`);
    return session;
  }

  // === 获取当前 Session ===

  getSession(): Session | null {
    return this.session;
  }

  getSessionById(id: string): Session | null {
    return this.session?.id === id ? this.session : null;
  }

  // === 销毁 Session ===

  async destroy(): Promise<void> {
    if (!this.session) return;

    // 1. 停止 File Watcher
    this.fileWatcher?.stop();
    this.fileWatcher = null;

    // 2. Kill CLI 进程
    if (this.session.process) {
      this.session.process.proc.kill();
    }

    // 3. 关闭所有 WebSocket
    for (const ws of this.session.browserSockets) {
      ws.close(1000, "Session destroyed");
    }
    this.session.cliSocket?.close();

    // 4. 持久化最终状态
    this.store.save(this.session);

    console.log(`[session] Destroyed: ${this.session.id}`);
    this.session = null;
  }

  // === CLI 连接管理 ===

  onCLIConnected(sessionId: string, ws: WebSocket): void {
    const session = this.getSessionById(sessionId);
    if (!session) return;

    session.cliSocket = ws;
    session.cliState = "connected";
    session.lastActiveAt = Date.now();
  }

  onCLIDisconnected(sessionId: string): void {
    const session = this.getSessionById(sessionId);
    if (!session) return;

    session.cliSocket = null;
    session.cliState = "exited";
  }

  // === CLI Session ID 映射 ===

  setCLISessionId(sessionId: string, cliSessionId: string): void {
    const session = this.getSessionById(sessionId);
    if (session) {
      session.cliSessionId = cliSessionId;
      this.store.save(session);
    }
  }
}
```

### 3.3 Session Store (持久化)

```typescript
// core/server/session-store.ts

import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "fs";

const DEFAULT_DIR = join(
  process.env.HOME || "/tmp",
  ".pneuma",
  "sessions",
);

interface PersistedSession {
  id: string;
  cliSessionId?: string;
  workspace: string;
  modeName: string;
  backendName: string;
  state: SessionState;
  messageHistory: HistoryMessage[];
  createdAt: number;
  lastActiveAt: number;
}

class SessionStore {
  private dir: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir?: string) {
    this.dir = dir || DEFAULT_DIR;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Debounced save (150ms) */
  save(session: Session): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveSync(session);
    }, 150);
  }

  /** 立即保存 */
  saveSync(session: Session): void {
    const persisted: PersistedSession = {
      id: session.id,
      cliSessionId: session.cliSessionId,
      workspace: session.workspace,
      modeName: session.modeName,
      backendName: session.backendName,
      state: session.state,
      messageHistory: session.messageHistory,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    };

    const filePath = join(this.dir, `${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(persisted, null, 2));
  }

  /** 加载 session */
  load(sessionId: string): PersistedSession | null {
    try {
      const filePath = join(this.dir, `${sessionId}.json`);
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /** 列出所有已保存的 session */
  list(): PersistedSession[] {
    try {
      return readdirSync(this.dir)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          try {
            const content = readFileSync(join(this.dir, f), "utf-8");
            return JSON.parse(content);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as PersistedSession[];
    } catch {
      return [];
    }
  }

  /** 删除 session 文件 */
  delete(sessionId: string): void {
    try {
      unlinkSync(join(this.dir, `${sessionId}.json`));
    } catch {
      // ignore
    }
  }
}
```

### 3.4 Session 生命周期时序图

```
pneuma slide --workspace ./my-deck
      │
      ▼
[SessionManager.create()]
      │
      ├─ installSkill() → .claude/skills/pneuma-slide/
      ├─ new Session(id=UUID)
      ├─ backend.spawn() → claude --sdk-url ws://...
      ├─ fileWatcher.start() → 监听 workspace 文件
      └─ store.save() → ~/.pneuma/sessions/UUID.json
      │
      ▼
[CLI 启动中... state="starting"]
      │
      ├─ CLI 连接 WebSocket → handleCLIOpen()
      │  └─ state="connected"
      │
      ├─ CLI 发送 system/init
      │  └─ 保存 cliSessionId
      │  └─ 广播 session_init 到浏览器
      │
      ▼
[Session 运行中]
      │
      ├─ 浏览器 ↔ 消息桥接 ↔ CLI
      │  └─ state="running" (有活跃请求时)
      │  └─ state="idle" (请求完成时)
      │
      ├─ File Watcher → content_update → iframe 刷新
      │
      ├─ store.save() → 定期持久化
      │
      ▼
[Session 结束]
      │
      ├─ Ctrl+C / 关闭浏览器 / CLI 退出
      │
      └─ SessionManager.destroy()
         ├─ fileWatcher.stop()
         ├─ process.kill()
         ├─ websocket.close()
         └─ store.save() → 最终状态
```

### 3.5 CLI 崩溃处理

```typescript
// CLI 进程退出时的处理

function onCLIProcessExit(session: Session, exitCode: number | undefined): void {
  session.cliState = "exited";

  // 通知浏览器
  broadcastToBrowsers(session, { type: "cli_disconnected" });

  if (exitCode === 127) {
    // Claude CLI 二进制不存在
    broadcastToBrowsers(session, {
      type: "session_update",
      updates: { error: "Claude Code CLI not found in PATH" },
    });
    return;
  }

  if (exitCode !== 0 && session.browserSockets.size > 0) {
    // CLI 异常退出且有浏览器在线 → 提示用户
    broadcastToBrowsers(session, {
      type: "session_update",
      updates: {
        error: `Claude Code exited unexpectedly (code: ${exitCode}). You can try refreshing the page to restart.`,
      },
    });

    // MVP: 不自动重启，让用户决定
    // Phase 2: 可以实现自动 relaunch
  }
}
```

### 3.6 存储目录结构

```
~/.pneuma/
├── sessions/
│   └── <uuid>.json              # Session 持久化文件
└── config.json                  # (未来) 全局配置
```

---

## 4. 关键设计决策

### 4.1 单 Session vs 多 Session

**决策：MVP 单 session。**

理由：
- 本地工具场景，一次编辑一个项目
- 多 session 需要 UI 支持（session 列表、切换）和更复杂的 store
- Phase 2 可扩展（store 改为 Map-based）

### 4.2 持久化频率

**决策：Debounced write (150ms)，与 Companion 一致。**

理由：
- 消息历史频繁更新（每条 streaming event）
- 150ms debounce 平衡了持久化频率和磁盘 I/O
- 异常退出最多丢失 150ms 内的数据

### 4.3 不实现 MVP Session Resume

**决策：MVP 不实现 `--resume`，但保存 `cliSessionId` 映射。**

理由：
- Resume 增加启动复杂度（需要检测旧 session 是否可恢复）
- MVP 场景下刷新页面重新开始是可接受的
- 保存映射为 Phase 2 resume 做准备

### 4.4 CLI 崩溃不自动重启

**决策：MVP 不自动 relaunch CLI，只通知用户。**

理由：
- 自动重启可能掩盖问题
- 用户刷新页面即可重新创建 session
- Companion 的自动 relaunch 逻辑较复杂（grace period、retry limit 等），Phase 2 再考虑

---

## 5. 被否决的方案

### 5.1 SQLite 持久化

- 否决原因：JSON 文件对单 session 足够；SQLite 增加依赖；Companion 也用 JSON 文件

### 5.2 内存 only（不持久化）

- 否决原因：服务器重启或 CLI 崩溃时丢失所有消息历史；用户体验差

### 5.3 Redis / 外部存储

- 否决原因：Pneuma 是本地工具，不需要外部依赖

---

## 6. 影响

1. **Session 文件在 `~/.pneuma/sessions/`** — 需要定期清理旧 session
2. **单 session 限制** — 不能同时编辑多个项目
3. **无 resume** — 关闭再打开会丢失对话上下文（但文件保留）
4. **CLI 崩溃需要手动恢复** — 刷新页面
