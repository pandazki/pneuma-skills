# History 分享与重放 — 实现设计

> **关联 ADR**: [ADR-013](../adr/adr-013-history-sharing-replay.md)
> **状态**: Draft
> **日期**: 2026-03-20

---

## 实现分阶段规划

### Phase 1 — Shadow Git + Checkpoint 捕获

**目标**：日常会话中自动记录文件变更历史，为后续导出和重放提供数据基础。

#### 1.1 新增文件

| 文件 | 职责 |
|------|------|
| `server/shadow-git.ts` | Shadow git 初始化、checkpoint 捕获、archive 导出 |

#### 1.2 改动点

| 文件 | 改动 |
|------|------|
| `bin/pneuma.ts` | session 启动流程中调用 `initShadowGit()`（skill install 之后、agent launch 之前） |
| `server/ws-bridge.ts` | `result` 消息处理时调用 `enqueueCheckpoint()`（使用 `result.num_turns` 作为 turnIndex） |
| `server/ws-bridge-codex.ts` | 同上，在 `attachCodexAdapterHandlers` 的 `msg.type === "result"` 分支；需要将 `workspace` 加入 `CodexBridgeDeps` 接口 |

#### 1.3 `server/shadow-git.ts` 接口

```typescript
/** 初始化影子仓库，幂等。git 不可用时静默降级。 */
export async function initShadowGit(workspace: string): Promise<void>;

/** 入队 checkpoint 捕获（串行队列，避免 git 并发冲突） */
export function enqueueCheckpoint(workspace: string, turnIndex: number): void;

/** Shadow git 是否可用（init 成功） */
export function isShadowGitAvailable(workspace: string): boolean;

/** 列出所有 checkpoint */
export async function listCheckpoints(workspace: string): Promise<CheckpointEntry[]>;

/** 导出某个 checkpoint 的完整文件树到目录 */
export async function exportCheckpointFiles(workspace: string, hash: string, outDir: string): Promise<void>;

/** 创建 git bundle（包含所有 checkpoint） */
export async function createBundle(workspace: string, outPath: string): Promise<void>;
```

#### 1.4 并发控制

Shadow git 不支持并发操作（`index.lock` 错误）。所有 checkpoint 通过 Promise 链串行化：

```typescript
let queue: Promise<void> = Promise.resolve();

export function enqueueCheckpoint(workspace: string, turnIndex: number) {
  queue = queue
    .then(() => captureCheckpointInner(workspace, turnIndex))
    .catch((err) => console.warn("[shadow-git] checkpoint failed:", err));
}
```

#### 1.5 Turn Index 来源

- **Claude Code**：`result` 消息的 `num_turns` 字段
- **Codex**：模块内部自增计数器（Codex 的 result 不含 turn count）

#### 1.6 降级处理

如果 `git` 未安装或 init 失败：
- `initShadowGit()` 记录 warning，设置 `available = false`
- `enqueueCheckpoint()` 检查 `available`，为 false 时直接 return
- Session 正常启动，仅丧失 checkpoint 能力
- 导出时提示 "No checkpoints available"

#### 1.7 Shadow Git Exclude 默认规则

```
.pneuma
node_modules
.DS_Store
dist
.env
.env.*
*.log
```

可由 mode manifest 扩展（新增 `shadowGitExclude?: string[]` 字段，非必须，后续版本考虑）。

---

### Phase 2 — 导出（Create Share）

**目标**：用户通过 UI 或 CLI 触发导出，生成 SharedHistory 包。

#### 2.1 新增文件

| 文件 | 职责 |
|------|------|
| `server/history-export.ts` | 导出逻辑：读取历史、checkpoint、生成摘要、打包 |
| `server/history-summary.ts` | 摘要生成：从 history 提取对话、生成 overview |
| `core/types/shared-history.ts` | SharedHistory 类型定义 |

#### 2.2 API 路由

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/history/export` | 触发导出，返回进度 → 完成后返回文件路径 |
| GET | `/api/history/export/status` | 导出进度查询 |
| GET | `/api/history/checkpoints` | 列出当前 session 的 checkpoint |

#### 2.3 CLI 命令

```bash
pneuma history export [--output <path>] [--title <title>]
```

#### 2.4 导出流程详细步骤

```
1. 读取 .pneuma/session.json → metadata (mode, backendType, createdAt)
2. 读取 .pneuma/history.json → rawMessages
3. 去敏感化:
   a. 替换 display text 中的绝对路径 → 相对路径（仅 user/assistant 文本，
      不改 tool_use 结构化参数，避免破坏重放语义）
   b. 清除 manifest 声明的 sensitive config 字段
   c. 可选：移除 thinking blocks (用户选择)
4. 读取 .pneuma/checkpoints.jsonl → checkpoint 列表
5. 为每个 checkpoint:
   a. git --git-dir=shadow.git diff-tree --stat <parent> <hash> → 变更统计
   b. 生成 label (从变更文件名推导)
   c. 记录 messageSeqRange: 该 turn 对应的消息序号范围
      (遍历 messages，找到 turn 边界：user_message 开始 → result 结束)
6. 创建 git bundle:
   git --git-dir=shadow.git bundle create repo.bundle --all
7. 生成摘要 (history-summary.ts):
   a. 从 messages 提取所有 user_message 文本
   b. 提取最近 3-5 轮完整对话 (user + assistant text blocks)
   c. 扫描最终 workspace 文件列表 + 行数
   d. overview: 仅使用本地机械提取（v1 不依赖外部 API）
8. 组装 manifest.json（含 checkpoint 索引 + messageSeqRange 映射）
9. tar.gz 打包: manifest.json + messages.jsonl + repo.bundle + assets/
```

#### 2.5 摘要生成策略

**v1 仅使用本地机械提取**（零外部依赖）：

```
overview = 前 3 条 user_message 拼接 + "... 共 N 轮对话"
keyDecisions = 从 assistant 消息中提取包含 "决定"/"选择"/"使用" 的句子
workspaceFiles = 最终 checkpoint 的文件列表 + wc -l
recentConversation = 最后 3-5 轮 user_message.content + assistant text blocks
```

效果足够支撑「继续对话」场景。后续版本可考虑接入 Claude API 生成更优质摘要。

---

### Phase 3 — 重放播放器

**目标**：接收者打开 SharedHistory 包，在播放器 UI 中按时间线浏览。

#### 3.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/store/replay-slice.ts` | 重放状态管理 |
| `src/components/ReplayPlayer.tsx` | 播放器控制栏 |
| `src/components/ReplayTimeline.tsx` | Checkpoint 时间线 |
| `server/history-import.ts` | 读取 SharedHistory 包、解压 checkpoint |

#### 3.2 播放器状态

```typescript
interface ReplaySlice {
  // 状态
  replayMode: boolean;
  replayPackage: SharedHistoryPackage | null;
  replayMessages: BrowserIncomingMessage[];
  currentSeq: number;              // 当前播放位置 (消息索引)
  activeCheckpoint: string | null; // 当前展示的 checkpoint hash
  playbackSpeed: number;           // 1, 2, 4, 8
  isPlaying: boolean;

  // 派生
  totalMessages: number;
  currentTurn: number;             // 从 messages 推导
  totalTurns: number;

  // Actions
  loadReplay: (pkg: SharedHistoryPackage, msgs: BrowserIncomingMessage[]) => void;
  exitReplay: () => void;
  play: () => void;
  pause: () => void;
  nextTurn: () => void;
  prevTurn: () => void;
  seekToMessage: (seq: number) => void;
  seekToCheckpoint: (cpId: string) => void;
  setSpeed: (speed: number) => void;
}
```

#### 3.3 Checkpoint 到消息的映射

每个 `CheckpointEntry` 在导出时计算 `messageSeqRange`：

```typescript
interface CheckpointEntry {
  turn: number;
  timestamp: number;
  hash: string;
  label: string;
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
  messageSeqRange: [number, number];  // [firstMsgIndex, lastMsgIndex] 在 messages.jsonl 中
}
```

映射逻辑（导出时）：遍历 messages，每个 `user_message` 标记 turn 开始，对应的 `result` 标记 turn 结束。将 turn 号与 checkpoint turn 号对齐。

播放器通过 `messageSeqRange` 判断当前消息属于哪个 checkpoint：
- 当 `currentSeq` 到达某 checkpoint 的 `messageSeqRange[1]`（turn 结束）→ 切换 viewer 到该 checkpoint

#### 3.4 播放逻辑

```typescript
async function playLoop() {
  while (isPlaying && currentSeq < totalMessages) {
    const msg = replayMessages[currentSeq];
    const nextMsg = replayMessages[currentSeq + 1];

    // 喂入现有渲染管线
    processIncomingMessage(msg);

    // 检查是否到达某个 checkpoint 的结尾
    const cp = checkpoints.find(c => c.messageSeqRange[1] === currentSeq);
    if (cp) {
      await loadCheckpointFiles(cp.hash);  // git checkout from cloned bundle
      setActiveCheckpoint(cp.hash);
    }

    currentSeq++;

    // 计算延迟：基于与下一条消息的时间差
    if (nextMsg && isPlaying) {
      const gap = nextMsg.timestamp - msg.timestamp;
      const delay = Math.min(gap / playbackSpeed, 2000); // 最长等 2s
      await sleep(delay);
    }
  }
  pause();
}
```

#### 3.5 Checkpoint 文件加载

重放模式下，viewer 的文件来源不是 workspace 磁盘，而是从 checkpoint tar 中提取：

```typescript
// 解压 checkpoint tar 到内存 / 临时目录
async function loadCheckpointFiles(hash: string): Promise<FileEntry[]> {
  const tarPath = `${replayDir}/checkpoints/turn-${hash}.tar`;
  // 解压到临时目录，读取文件列表
  // 更新 workspace-slice 的 files (替换，非合并)
}
```

Viewer 组件不需要修改——它只消费 `files` 数组，不关心文件来源。

#### 3.7 入口

```bash
# CLI
pneuma history open ./my-share.tar.gz
pneuma history open https://r2.example.com/histories/abc123.tar.gz

# Launcher (可选)
# "Shared Histories" section，点击打开重放
```

打开后：
1. 解压到临时目录 (`~/.pneuma/replay/<id>/`)
2. 从 `repo.bundle` 恢复 shadow repo：`git clone repo.bundle .shadow-repo`
3. 读取 `manifest.json` + `messages.jsonl`
4. 启动 server（重放模式）
5. 前端进入 `replayMode`

#### 3.6 重放模式下的 Server 配置

重放模式与正常模式的 server 差异：

| 组件 | 正常模式 | 重放模式 |
|------|----------|----------|
| Agent backend | 启动 Claude/Codex | **不启动** |
| File watcher | chokidar 监听 workspace | **不启动** |
| Skill installer | 安装 skill 到 workspace | **不执行** |
| WebSocket CLI bridge | `/ws/cli/:id` | **不启用** |
| WebSocket browser bridge | 双向通信 | **只发不收**（重放数据单向推送） |
| File API (`/api/files`) | 读写 workspace 磁盘 | **从 shadow repo checkout 提供**（`git --work-tree=tmpdir checkout <hash> -- .`） |
| Mode viewer | 动态加载 | 根据 `manifest.metadata.mode` 加载（同一个 viewer，只读） |
| 新增 API | — | `GET /api/replay/manifest`、`GET /api/replay/messages`、`POST /api/replay/checkout/:hash` |

实现方式：在 `server/index.ts` 的启动逻辑中，根据 `replayMode` flag 跳过 agent launch、file watcher、skill install，只注册重放相关路由。

---

### Phase 4 — 继续对话

**目标**：从重放终点恢复 workspace，注入上下文，启动新 session。

#### 4.1 改动点

| 文件 | 改动 |
|------|------|
| `server/skill-installer.ts` | 新增 `<!-- pneuma:resumed -->` section 注入 |
| `server/history-import.ts` | workspace 还原 + 上下文文件生成 |

#### 4.2 流程

```
用户在播放器中点击 [继续对话]
  │
  ├─ 选择 workspace 目录 (默认建议一个新目录)
  │
  ├─ 解压最后一个 checkpoint 的文件到 workspace
  │
  ├─ 创建 .pneuma/session.json (新 session，记录 resumedFrom)
  │
  ├─ 生成 resumed-context 文件:
  │   .pneuma/resumed-context.xml  ← 来自 manifest.json 的 summary
  │
  ├─ skill-installer 检测到 resumed-context.xml 存在:
  │   → 注入 <!-- pneuma:resumed --> section 到 CLAUDE.md / AGENTS.md
  │
  └─ 正常启动 session (不 --resume，全新 agent)
      → agent 读 CLAUDE.md 获得上下文
      → 用户可以继续对话
```

#### 4.3 上下文注入格式

`skill-installer.ts` 在 `<!-- pneuma:start -->` block 内追加：

```xml
<!-- pneuma:resumed:start -->
<resumed-session original-turns="12" original-mode="webcraft" original-author="pandazki">
  <summary>
    这是从分享历史恢复的工作会话。以下是之前工作的摘要。
    用户可能会在这个基础上继续工作，请自然地衔接。

    ## 工作概述
    {{overview}}

    ## 关键决策
    {{keyDecisions as bullet list}}

    ## 当前文件
    {{workspaceFiles with line counts}}
  </summary>
  <recent-conversation>
    {{recentConversation — 最近 3-5 轮原始对话}}
  </recent-conversation>
</resumed-session>
<!-- pneuma:resumed:end -->
```

---

### Phase 5 — 远程分发

**目标**：上传分享包到 R2，通过链接分发。

#### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `snapshot/history-push.ts` | 上传 SharedHistory 包到 R2 |
| `snapshot/history-pull.ts` | 下载 SharedHistory 包 |

#### 5.2 复用 snapshot 基础设施

```typescript
// history-push.ts — 复用 snapshot/push.ts 的 R2 client 和上传逻辑
export async function pushHistory(packagePath: string): Promise<string> {
  const r2 = loadR2Credentials();
  const key = `histories/${id}.tar.gz`;
  await upload(r2, key, packagePath);

  // 同时上传轻量 meta（用于列表展示，不含文件内容）
  const meta = extractMeta(packagePath);
  await upload(r2, `histories/${id}.meta.json`, JSON.stringify(meta));

  return `${r2.publicUrl}/${key}`;
}
```

#### 5.3 CLI

```bash
pneuma history share [--title <title>]   # export + push, 返回链接
pneuma history export [--output <path>]   # 仅本地导出
pneuma history open <path-or-url>         # 打开重放
```

---

## UI 入口

### 导出入口

ContextPanel（右侧面板）中新增 "Share" 按钮，或 TopBar 中增加分享图标。

点击后弹出确认面板：
- 标题（可编辑，默认为 mode + workspace 名）
- 描述（可选）
- 选项：是否移除 thinking blocks
- [导出到本地] [上传并分享]

### 重放入口

- CLI：`pneuma history open <path-or-url>`
- Launcher：可选 "Shared Histories" section（Phase 5）

---

## 开发顺序建议

```
Phase 1: Shadow Git (基础设施，独立可测试)
  ↓ 约 1-2 天
Phase 2: 导出 (依赖 Phase 1)
  ↓ 约 2-3 天
Phase 3: 重放播放器 (依赖 Phase 2 的包格式)
  ↓ 约 3-4 天
Phase 4: 继续对话 (依赖 Phase 2 的摘要 + Phase 3 的 UI)
  ↓ 约 1-2 天
Phase 5: 远程分发 (独立，复用 snapshot)
  ↓ 约 1 天
```

Phase 1 可以先合入 main，日常使用中积累 checkpoint 数据，为后续 Phase 验证提供真实数据。
