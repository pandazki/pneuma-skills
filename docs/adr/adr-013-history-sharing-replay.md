# ADR-013: History 分享与重放

> **状态**: Proposed
> **日期**: 2026-03-20
> **决策者**: Pandazki
> **关联**: ADR-002, ADR-008, ADR-012

---

## 1. 背景

Pneuma 当前的工作成果以 workspace 文件为中心，分享手段是 snapshot（打包 workspace 文件上传 R2）。但 snapshot 只包含最终结果，不包含创作过程。

用户希望像 Manus 一样，能够把一次完整的协作过程（对话 + 内容变化）分享出去，接收者可以：

1. **重放** — 按时间线浏览对话过程和每一步的内容变化
2. **继续** — 从重放终点接手，在还原的 workspace 上继续与 agent 对话

这要求解决三个问题：

- **过程记录**：对话历史已有（`history.json`），但文件变更的中间状态没有被捕获
- **重放展示**：需要播放器 UI，将对话与文件变化同步回放
- **上下文恢复**：接收者的 agent 需要理解之前发生了什么，才能自然地继续对话

---

## 2. 决策

### 2.1 Shadow Git 捕获文件变更

使用 git 的 `--git-dir` / `--work-tree` 分离机制，在 `.pneuma/shadow.git` 维护一个独立于用户 `.git` 的影子仓库，自动记录每轮对话结束时的文件变更。

- Session 启动时无条件初始化 `git init --bare .pneuma/shadow.git`
- 用户无需知道 shadow git 的存在，不需要 workspace 有自己的 git repo
- 影子 repo 记录的是 Pneuma 视角的增量变更，与用户自己的 git 工作流完全隔离

### 2.2 Checkpoint 在每轮结束时自动捕获

当 `result` 消息到达（一轮对话结束），异步检查 shadow git diff：

- 有文件变更 → `git add -A && git commit`，记录一个 checkpoint
- 无文件变更 → 跳过

这是日常会话中唯一的额外开销（约 50-100ms/轮，异步不阻塞）。

### 2.3 分享是显式的一次性动作

不在日常会话中维护分享状态。用户通过明确的 "Create Share" 操作触发导出：

- 读取 `history.json` + shadow git checkpoints
- 打包为 SharedHistory 包（`.tar.gz`）
- 可选上传到 R2 获取分享链接

导出过程可以慢一些（后台处理），不影响正常使用。

### 2.4 上下文恢复采用 Compact 式摘要注入

放弃迁移 Claude Code 内部历史文件的方案（格式不稳定、版本耦合严重）。

接收者点击「继续对话」时：

1. 从最后一个 checkpoint 还原 workspace 文件
2. 启动全新 agent session
3. 将预生成的结构化摘要（工作概述 + 关键决策 + 最近 N 轮原始对话）注入 CLAUDE.md / AGENTS.md

效果类似 Claude Code 的 `/compact`：agent 不拥有原始对话上下文，但通过摘要获得足够的背景信息来自然地继续工作。摘要在导出时一次性生成，存在包里。

### 2.5 重放播放器复用现有消息渲染管线

前端已有从 `message_history` 重建完整 UI 状态的逻辑（`src/ws.ts:579-651`）。重放播放器在此基础上：

- 按时间顺序逐条喂入消息，复用 `appendMessage` / `mergeAssistantMessage`
- Viewer 根据 checkpoint 切换文件状态（`git archive` 导出对应 commit 的文件树）
- 不需要重写消息渲染逻辑

---

## 3. 详细设计

### 3.1 Shadow Git

#### 初始化

Session 启动时（`bin/pneuma.ts`），在 skill install 之后、agent launch 之前：

```typescript
function shadowGitDir(workspace: string) {
  return `${workspace}/.pneuma/shadow.git`;
}

async function initShadowGit(workspace: string) {
  const gitDir = shadowGitDir(workspace);
  if (await Bun.file(`${gitDir}/HEAD`).exists()) return;

  try {
    await Bun.spawn(["git", "init", "--bare", gitDir]).exited;
    // 排除 .pneuma 自身和常见噪声
    await Bun.write(`${gitDir}/info/exclude`,
      `.pneuma\nnode_modules\n.DS_Store\ndist\n.env\n.env.*\n*.log\n`
    );
    await shadowGit(workspace, "add", "-A");
    await shadowGit(workspace, "commit", "-m", "initial", "--allow-empty");
  } catch (err) {
    // git 未安装或文件系统只读 — 记录警告，继续启动
    console.warn("[shadow-git] init failed, checkpoints disabled:", err);
    // 设置标记使 captureCheckpoint 成为 no-op
  }
}

function shadowGit(workspace: string, ...args: string[]) {
  const gitDir = shadowGitDir(workspace);
  return Bun.spawn(["git", `--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args]);
}
```

#### Checkpoint 捕获

在 `ws-bridge.ts` 处理 `result` 消息时触发（异步，不阻塞消息流）。

**并发控制**：Shadow git 不支持并发操作（会产生 `index.lock` 错误），因此所有 checkpoint 操作通过 Promise 链串行化：

```typescript
import { appendFileSync } from "node:fs";

// 串行队列 — 确保 shadow git 操作不并发
let checkpointQueue: Promise<void> = Promise.resolve();

function enqueueCheckpoint(workspace: string, turnIndex: number) {
  checkpointQueue = checkpointQueue
    .then(() => captureCheckpointInner(workspace, turnIndex))
    .catch((err) => console.warn("[shadow-git] checkpoint failed:", err));
}

async function captureCheckpointInner(workspace: string, turnIndex: number) {
  const proc = shadowGit(workspace, "diff", "HEAD");
  const diff = await new Response(proc.stdout).text();
  if (!diff.trim()) return; // 无变更，跳过

  await shadowGit(workspace, "add", "-A").exited;
  await shadowGit(workspace, "commit", "-m", `turn-${turnIndex}`).exited;

  const hashProc = shadowGit(workspace, "rev-parse", "HEAD");
  const hash = (await new Response(hashProc.stdout).text()).trim();

  // 追加到索引（appendFileSync 保证原子追加，不会覆盖已有内容）
  const entry = JSON.stringify({ turn: turnIndex, ts: Date.now(), hash }) + "\n";
  const indexPath = `${workspace}/.pneuma/checkpoints.jsonl`;
  appendFileSync(indexPath, entry);
}
```

**Turn index 来源**：使用 `result` 消息中的 `num_turns` 字段（Claude Code）。Codex 没有此字段，使用 shadow-git 模块内部维护的自增计数器作为 fallback。

#### 存储结构

```
<workspace>/.pneuma/
├── shadow.git/           # bare git repo (影子仓库)
│   ├── HEAD
│   ├── objects/
│   ├── refs/
│   └── info/exclude      # 排除规则
├── checkpoints.jsonl     # checkpoint 索引 (每行一条)
├── session.json          # 现有
├── history.json          # 现有
└── config.json           # 现有
```

`checkpoints.jsonl` 每行：
```json
{"turn": 1, "ts": 1773298467342, "hash": "a1b2c3d"}
{"turn": 3, "ts": 1773298512000, "hash": "e4f5g6h"}
```

### 3.2 SharedHistory 包格式

#### 数据模型

```typescript
interface SharedHistoryPackage {
  version: 1;
  metadata: {
    id: string;
    title: string;
    description?: string;
    mode: string;
    backendType: string;
    model?: string;
    totalTurns: number;
    totalCost?: number;
    createdAt: number;       // 原始会话创建时间
    exportedAt: number;
    duration: number;        // 首条到末条消息的时间跨度
  };
  // 摘要（导出时生成，用于「继续对话」）
  summary: SessionSummary;
  // checkpoint 索引
  checkpoints: CheckpointEntry[];
}

interface CheckpointEntry {
  turn: number;
  timestamp: number;
  hash: string;              // shadow git commit hash
  label: string;             // 自动生成：来自 commit 中变更文件的描述
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
}

interface SessionSummary {
  overview: string;          // 工作概述
  keyDecisions: string[];    // 关键决策列表
  workspaceFiles: string[];  // 最终文件列表 + 行数
  recentConversation: string; // 最近 3-5 轮原始对话文本
}
```

#### 磁盘包结构

```
my-project-share.tar.gz
├── manifest.json          # SharedHistoryPackage
├── messages.jsonl         # 完整消息流 (来自 history.json，去敏感化)
├── repo.bundle            # git bundle (shadow repo 的完整 pack)
└── assets/                # 二进制资源 (图片等，从最终状态提取)
```

使用 `git bundle` 而非每个 checkpoint 单独 `git archive`。理由：

- **体积优势**：git bundle 内部使用 pack 格式，自动跨 commit 去重压缩。20 个 checkpoint 的 bundle 体积接近单个 checkpoint，而 20 个独立 tar 则是 20 倍
- **接收端还原简单**：`git clone repo.bundle` 即得完整 shadow repo，任意 checkout 即可
- **导出简单**：一条命令 `git --git-dir=shadow.git bundle create repo.bundle --all`

### 3.3 导出流程

```
用户点击 "Create Share"
  │
  ├─ 读取 .pneuma/session.json → metadata
  ├─ 读取 .pneuma/history.json → messages
  ├─ 读取 .pneuma/checkpoints.jsonl → checkpoint 列表
  │
  ├─ 对 messages 去敏感化:
  │   - 移除绝对路径 (替换为相对路径)
  │   - 清除 config.json 中 manifest 声明的 sensitive 字段
  │   - 可选：移除 thinking blocks
  │
  ├─ 为每个 checkpoint 执行 git archive:
  │   $ git --git-dir=.pneuma/shadow.git archive <hash> > turn-NNN.tar
  │
  ├─ 生成摘要 (SessionSummary):
  │   - 提取所有 user_message 文本
  │   - 提取最近 3-5 轮完整对话
  │   - 生成 overview: 如果有 Claude API → 调用生成；否则机械拼接
  │
  ├─ 组装 manifest.json
  ├─ tar.gz 打包
  │
  └─ 输出:
      - 本地: ~/Downloads/project-share-<timestamp>.tar.gz
      - 远程: 上传 R2 → 返回分享链接
```

### 3.4 重放播放器

#### Store 扩展

新增 `replay-slice.ts`：

```typescript
interface ReplaySlice {
  replayMode: boolean;
  replayPackage: SharedHistoryPackage | null;
  replayMessages: BrowserIncomingMessage[];   // 从 messages.jsonl 加载
  currentTurn: number;                        // 当前播放到的轮次
  currentCheckpoint: string | null;           // 当前展示的 checkpoint hash
  visibleMessageCount: number;                // 已显示的消息条数
  playbackSpeed: number;                      // 1, 2, 4, 8
  isPlaying: boolean;

  loadReplay: (pkg: SharedHistoryPackage, messages: BrowserIncomingMessage[]) => void;
  play: () => void;
  pause: () => void;
  seekToTurn: (turn: number) => void;
  seekToCheckpoint: (cpId: string) => void;
  setSpeed: (speed: number) => void;
}
```

#### 播放逻辑

```
播放中:
  1. 取下一条消息 replayMessages[visibleMessageCount]
  2. 喂入现有消息处理管线 (appendMessage)
  3. 如果该消息对应一个 checkpoint → 切换 viewer 文件状态
  4. 等待 delay (基于原始时间间隔 / playbackSpeed)
  5. 重复

跳转到某 checkpoint:
  1. 显示该 checkpoint 之前的所有消息 (瞬时)
  2. 加载该 checkpoint 的文件树到 viewer
  3. 暂停
```

#### UI 布局

播放器在现有布局基础上增加底部控制栏：

```
┌─ TopBar (标题 + 分享信息) ─────────────────────────────┐
├────────────────────────────────────────────────────────┤
│  ChatPanel (逐条显示)  │  Viewer (checkpoint 文件状态)  │
├────────────────────────────────────────────────────────┤
│  ◄◄  ◄  ▶  ►  ►►  │ Turn 3/12 │ ███░░░░ │ 1x │       │
├─ Checkpoint Timeline ─────────────────────────────────┤
│  ● 初始  ● 创建布局  ● 加样式  ● 重构  ● 完成        │
└────────────────────────────────────────────────────────┘
│                  [ 继续对话 ]                           │
```

### 3.5 上下文恢复（继续对话）

接收者点击「继续对话」：

**Step 1 — 还原 workspace**

解压最后一个 checkpoint 的 tar 到目标目录。

**Step 2 — 注入上下文**

在 `skill-installer.ts` 中新增 `<!-- pneuma:resumed:start -->` / `<!-- pneuma:resumed:end -->` section，写入 CLAUDE.md / AGENTS.md：

```xml
<!-- pneuma:resumed:start -->
<resumed-session original-turns="12" original-mode="webcraft">
  <summary>
    这是从分享历史恢复的工作会话。

    ## 工作概述
    用户在 webcraft 模式下创建了一个 landing page。
    完成了响应式布局、动画效果、暗色主题。

    ## 关键决策
    - 布局使用 CSS Grid
    - 动画使用纯 CSS @keyframes
    - 配色基于 oklch 色彩空间

    ## 当前文件
    - index.html (247 lines)
    - style.css (189 lines)
    - assets/hero.svg
  </summary>

  <recent-conversation>
    [user] 移动端的 hero section 太大了，能缩小一点吗？
    [assistant] 我添加了 media query，在 768px 以下将 hero 高度从 100vh 改为 60vh，
    字体从 3rem 缩小到 2rem。同时调整了 CTA 按钮的 padding。
    [user] 不错，再把导航栏改成汉堡菜单
    [assistant] 好的，我用纯 CSS 实现了一个汉堡菜单...
  </recent-conversation>
</resumed-session>
<!-- pneuma:resumed:end -->
```

**Step 3 — 启动正常 session**

以全新 session 启动（不 resume），agent 读到 CLAUDE.md 中的上下文后即可继续工作。

### 3.6 远程分发

复用现有 snapshot 的 R2 基础设施：

```
R2 存储:
├── snapshots/           # 现有
├── modes/               # 现有
└── histories/           # 新增
    ├── <id>.tar.gz      # SharedHistory 包
    └── <id>.meta.json   # 轻量元数据 (用于列表展示)
```

CLI 命令：

```bash
pneuma history share              # 导出 + 上传，返回链接
pneuma history export [--output]  # 仅本地导出
pneuma history open <path-or-url> # 打开重放 / 下载后重放
```

Launcher 可选增加 "Shared Histories" section 展示已分享的历史。

---

## 4. 被否决的方案

### 4.1 迁移 Claude Code 内部历史文件

将 CC 的 `~/.claude/projects/` JSONL 文件复制到接收者环境，通过 `--resume` 恢复原生上下文。

**否决原因**：
- CC 内部 JSONL 格式无公开规范，版本间可能变化
- 路径映射复杂（CC 按 workspace 路径 hash 存储）
- 仅限 Claude Code backend，Codex 无法使用
- 维护成本高，每次 CC 升级都可能需要适配

Compact 式摘要注入虽然不是原生上下文，但 backend 无关、格式稳定、效果足够。

### 4.2 实时维护分享状态

在日常会话中持续维护可分享的中间产物（如每轮都生成 checkpoint tar）。

**否决原因**：
- 分享是低频操作，不应对每次会话都产生开销
- Shadow git commit（~100ms/轮）是必要的最小记录成本
- 导出时的打包处理可以慢一些，不影响用户体验

### 4.3 从 tool_use blocks 反向重建文件状态

不使用 git，导出时从历史消息中的 Edit/Write tool_use 参数反向推导每轮的文件状态。

**否决原因**：
- Edit 的 `old_string`/`new_string` 可能不完整（被截断或省略）
- 无法捕获 agent 通过 Bash 工具进行的文件操作（如 `mkdir`, `cp`, `mv`）
- 累积误差会导致后续 checkpoint 偏离真实状态
- Shadow git 方案同样轻量，但精确度远高于 tool_use replay

---

## 5. 影响

### 正面

- 用户可以像 Manus 一样分享完整的协作过程，展示 AI 辅助创作的价值
- 接收者可以从任意分享继续工作，降低协作门槛
- Shadow git 机制为未来其他功能（undo/redo、版本对比、时间旅行调试）奠定基础

### 成本

- 每次会话新增 shadow git 初始化（一次性 ~100ms）+ 每轮 checkpoint（~50-100ms，异步）
- `.pneuma/shadow.git/` 占用额外磁盘空间（git 自带压缩，通常远小于 workspace 本身）
- 导出流程需要生成摘要，如果使用 Claude API 会产生少量 token 成本

### 约束

- 分享包的体积取决于 workspace 大小 × checkpoint 数量；大型项目需要考虑选择性导出
- 摘要注入的上下文恢复效果不如原生对话历史，但对大多数「继续工作」场景足够
- Shadow git 不追踪 `.pneuma/` 自身和 `node_modules` 等，这些目录的变更不会出现在 checkpoint 中

---

## 6. 参考

- [Manus Replay](https://manus.im) — 对话过程重放的产品参考
- 现有 snapshot 系统：`snapshot/push.ts`, `snapshot/pull.ts`
- 现有历史持久化：`bin/pneuma.ts` (`saveHistory`, `loadHistory`), `server/ws-bridge.ts` (`getMessageHistory`, `loadMessageHistory`)
- 前端历史重建：`src/ws.ts` (`message_history` handler in `processMessage`)
- Git `--git-dir` / `--work-tree` 分离机制：`git(1)` manpage
