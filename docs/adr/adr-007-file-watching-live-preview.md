# ADR-007: 文件监听与实时预览

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-002, ADR-004

---

## 1. 背景

Pneuma 的核心体验是 **Agent 编辑文件 → 用户实时看到变化**：

```
Claude Code 修改 slides/slide-03.html
        ↓
File Watcher 检测到变更
        ↓
Server 通过 WebSocket 推送 content_update
        ↓
Browser 刷新 iframe 预览
```

### Companion 对比

Companion **没有实现文件监听**。它的 file preview 是：
- 用户在 file tree 中点击文件 → 通过 HTTP API 获取文件内容 → CodeMirror 渲染
- 没有自动刷新机制

Pneuma 的场景不同 — 我们需要内容预览实时跟随文件变更更新，因此需要自己实现文件监听。

---

## 2. 决策

### 2.1 使用 chokidar 做文件监听

**选择 chokidar 而非 Bun 内置 `fs.watch`。**

| 方案 | 优点 | 缺点 |
|------|------|------|
| `fs.watch` (Node/Bun 内置) | 无额外依赖 | macOS 上事件不稳定、需要递归选项、重复事件多 |
| **chokidar** | 跨平台稳定（FSEvents on macOS）、成熟 API、glob 支持、debounce 内置 | 额外依赖 |
| `@parcel/watcher` | 性能极佳 | 需要 native binding 编译、Bun 兼容性不确定 |

### 2.2 iframe 刷新策略

**使用 iframe src 追加查询参数触发重载**，而非 WebSocket 推送文件内容。

### 2.3 静态文件服务

**通过 HTTP 直接 serve workspace 内容文件**，iframe 通过 URL 访问。

---

## 3. 详细设计

### 3.1 File Watcher 实现

```typescript
// core/server/file-watcher.ts

import { watch, type FSWatcher } from "chokidar";
import type { ContentMode } from "../types/content-mode";

interface FileWatcherOptions {
  workspace: string;
  mode: ContentMode;
  onContentChange: (changes: FileChange[]) => void;
  debounceMs?: number;
}

interface FileChange {
  path: string;                       // 相对于 workspace 的路径
  action: "created" | "modified" | "deleted";
}

class FileWatcher {
  private watcher: FSWatcher | null = null;
  private pendingChanges: Map<string, FileChange> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private options: FileWatcherOptions;

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  start(): void {
    const { workspace, mode, debounceMs = 300 } = this.options;

    // 使用 Content Mode 定义的 watch patterns
    const patterns = mode.fileConvention.watchPatterns.map(p =>
      join(workspace, p)
    );

    const ignored = [
      ...(mode.fileConvention.ignorePatterns || []).map(p => join(workspace, p)),
      "**/node_modules/**",
      "**/.git/**",
      "**/.claude/**",           // 不监听 Skill 包变更
    ];

    this.watcher = watch(patterns, {
      ignored,
      persistent: true,
      ignoreInitial: true,       // 启动时不触发已有文件的事件
      awaitWriteFinish: {        // 等待写入完成 (Agent 可能分多次写)
        stabilityThreshold: 200, // 200ms 无新写入才算完成
        pollInterval: 50,
      },
    });

    this.watcher
      .on("add", (path) => this.enqueue(path, "created"))
      .on("change", (path) => this.enqueue(path, "modified"))
      .on("unlink", (path) => this.enqueue(path, "deleted"));

    console.log(`[file-watcher] Watching: ${patterns.join(", ")}`);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private enqueue(absolutePath: string, action: FileChange["action"]): void {
    const relativePath = relative(this.options.workspace, absolutePath);

    this.pendingChanges.set(relativePath, { path: relativePath, action });

    // Debounce: 合并短时间内的多个变更
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.options.debounceMs ?? 300);
  }

  private flush(): void {
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    if (changes.length > 0) {
      console.log(`[file-watcher] ${changes.length} file(s) changed:`,
        changes.map(c => `${c.action}: ${c.path}`).join(", ")
      );
      this.options.onContentChange(changes);
    }
  }
}
```

### 3.2 内容静态文件服务

```typescript
// core/server/static-server.ts

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

function createContentRoutes(workspace: string): Hono {
  const app = new Hono();

  // /content/* → workspace 目录下的文件
  // 这是 iframe src 的基础路径
  app.use("/content/*", async (c, next) => {
    // 添加 no-cache 头 (内容文件频繁变化)
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    await next();
  });

  app.use("/content/*", serveStatic({
    root: workspace,
    rewriteRequestPath: (path) => path.replace(/^\/content/, ""),
  }));

  return app;
}
```

### 3.3 Manifest 变更特殊处理

```typescript
// manifest.json 变更时，除了刷新预览，还需要更新 Navigator

function handleContentChange(
  changes: FileChange[],
  session: BridgeSession,
  mode: ContentMode,
  workspace: string,
): void {
  // 1. 推送 content_update 到浏览器
  session.bridge.broadcastToBrowsers(session, {
    type: "content_update",
    files: changes,
  });

  // 2. 如果 manifest 变更，重新解析并推送结构更新
  const manifestChanged = changes.some(
    c => c.path === mode.fileConvention.manifestFile
  );

  if (manifestChanged) {
    const manifestPath = join(workspace, mode.fileConvention.manifestFile);
    try {
      const content = readFileSync(manifestPath, "utf-8");
      const structure = mode.parseManifest(content);
      session.bridge.broadcastToBrowsers(session, {
        type: "session_update",
        updates: { contentStructure: structure },
      });
    } catch (e) {
      console.warn("[file-watcher] Failed to parse manifest:", e);
    }
  }
}
```

### 3.4 iframe 预览刷新机制

```typescript
// 前端: SlidePreview 组件的刷新逻辑

function SlidePreview({ contentBaseUrl, activeItem, contentVersion }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // contentVersion 变化 → 触发 iframe 重载
  const src = useMemo(() => {
    const slideFile = `slides/${activeItem}.html`;
    // 追加 cache-buster 查询参数
    return `${contentBaseUrl}/${slideFile}?v=${contentVersion}`;
  }, [contentBaseUrl, activeItem, contentVersion]);

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-8">
      <div className="w-full max-w-4xl aspect-[16/9] bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <iframe
          ref={iframeRef}
          src={src}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={`Slide: ${activeItem}`}
        />
      </div>
    </div>
  );
}
```

### 3.5 内容文件 URL 结构

```
http://localhost:3210/
├── /                              # Editor Shell SPA
├── /content/slides/slide-01.html  # Slide HTML
├── /content/slides/slide-02.html
├── /content/theme.css             # 主题样式
├── /content/assets/logo.png       # 资产文件
├── /content/manifest.json         # Manifest
├── /content/index.html            # 演示模式入口
├── /api/...                       # API 路由
└── /ws/...                        # WebSocket 路由
```

### 3.6 Debounce 策略

Agent 编辑文件时，可能在短时间内多次写入同一文件（如分步修改 HTML）：

```
时间线:
0ms    - Agent 开始修改 slide-03.html
50ms   - 第一次写入 (修改标题)
120ms  - 第二次写入 (添加副标题)
200ms  - 第三次写入 (调整样式)
        ← chokidar awaitWriteFinish: 等待 200ms 无新写入
400ms  - 写入稳定
        ← debounce 300ms
700ms  - 触发 content_update (一次合并推送)
```

参数选择：
- `awaitWriteFinish.stabilityThreshold = 200ms` — 等待文件写入稳定
- `debounce = 300ms` — 合并同一批次的多个文件变更
- 总延迟 ≈ 200 + 300 = 500ms — 体感"几乎实时"

---

## 4. 关键设计决策

### 4.1 HTTP Serve vs WebSocket Push 文件内容

**决策：HTTP serve 文件 + iframe 刷新，而非通过 WebSocket push 文件内容。**

理由：
- HTML 文件可能引用相对路径的 CSS/JS/图片 → HTTP serve 天然支持
- iframe src 刷新是最简单可靠的方案
- WebSocket push 文件内容需要在前端重建完整的 HTML 上下文，复杂且脆弱
- HTTP no-cache 头 + query parameter cache-buster 确保总是获取最新内容

### 4.2 监听范围

**决策：只监听 Content Mode 声明的 watchPatterns。**

理由：
- 不监听 `.claude/`, `node_modules/`, `.git/` 等无关目录
- 减少不必要的事件处理
- Mode 对自己的文件结构最了解

### 4.3 awaitWriteFinish

**决策：启用 chokidar 的 awaitWriteFinish 选项。**

理由：
- Agent 写文件可能不是原子操作（先清空再写入，或分段写入）
- 如果在写入过程中触发刷新，用户会看到空白或半成品
- 200ms 的 stabilityThreshold 足以等待大部分写入完成

---

## 5. 被否决的方案

### 5.1 Bun 内置 `fs.watch`

- 否决原因：macOS 上不稳定（重复事件多）、不支持 glob、没有 awaitWriteFinish

### 5.2 Vite HMR

- 否决原因：HMR 设计用于开发时的 JS/CSS 模块热替换，不适合 iframe 中的独立 HTML 文件
- Slide 的 HTML 文件不是 Vite 的 module graph 的一部分

### 5.3 Polling

- 否决原因：延迟高（最快也是 polling interval）、CPU 浪费；FSEvents/inotify 是更优解

---

## 6. 影响

1. **chokidar 是额外依赖** — 但它是文件监听的事实标准（8000+ npm 依赖者）
2. **500ms 延迟** — 从文件写入到预览更新约 500ms，用户体验可接受
3. **大量文件变更可能产生事件风暴** — debounce 机制缓解，但极端情况下仍可能有延迟
4. **HTTP serve 内容文件有安全考虑** — 只 serve workspace 目录，不暴露系统文件；sandbox iframe 限制脚本能力
