# Pneuma 3.0: Project Layer

> **日期**: 2026-04-27
> **状态**: Draft
> **决策者**: Pandazki
> **关联**:
> - 与 [`pneuma-3.0-design.md`](./pneuma-3.0-design.md) 平行——一个是"layout 维度"（mode 升级为微应用），一个是"organization 维度"（session 之上加 project）
> - Supersedes (in part): [ADR-008](../adr/adr-008-session-management.md) 的"单 session 模型"决策
> - Extends: [ADR-006](../adr/adr-006-skill-installation.md), [ADR-014](../adr/adr-014-user-preference-analysis.md), [ADR-010](../adr/adr-010-cli-entry-startup.md)

---

## 1. 命题

2.x 的 session 是平铺的：每个 workspace 绑定一个 mode、一个 session、一份 history、一份 shadow-git。这够用，但有三件事 2.x 做不到：

1. **跨 mode 协作**——做完设计文档想开始做官网，必须开新 workspace、丢失上下文
2. **项目级记忆**——用户偏好只有"全局"和"per-mode"两层，没有"这个项目里我习惯什么"
3. **多角度产出聚合**——一个项目的网站、视频、文档分散在 N 个无关 workspace，user 自己拼

3.0 引入 **Project**：在 session 之上加一层组织维度，让一组围绕同一目标的 session 共享身份、共享偏好、能跨 mode 接力。

**关键设计哲学**：

- Project 不强制。快会话（2.x 形态）完全保留，零迁移、零行为变化
- 升级是显式且渐进的——用户在 launcher 选"建项目"，可以从已有快会话拷一份作为 founder session
- Session 仍是 agent 工作的物理单位（CWD、文件监听、shadow-git）；project 是上层组织
- 跨 mode 接力靠 **handoff 文件**——agent 写到 project 共享层，目标 mode session 读取后删除。无新协议、无新 LLM 调用

---

## 2. 数据模型

### 2.1 快会话（保留 2.x，零变化）

```
<workspace>/                          # 用户指定或 cwd
├── .pneuma/
│   ├── session.json                  # { sessionId, agentSessionId, mode, backendType, createdAt }
│   ├── history.json
│   ├── config.json
│   ├── skill-version.json
│   ├── skill-dismissed.json
│   ├── shadow.git/
│   ├── checkpoints.jsonl
│   ├── replay-checkout/
│   ├── resumed-context.xml
│   ├── evolution/
│   └── deploy.json
├── .claude/
│   └── skills/<mode-skill>/
├── CLAUDE.md
├── AGENTS.md                          # codex backend
└── <user 内容>                        # 比如 .md / .html / assets/
```

### 2.2 项目化（新增）

```
<project>/                                       # 用户指定的目录（既存 or 新建空目录）
├── .pneuma/
│   ├── project.json                             # { name, displayName, description, createdAt, founderSessionId? }
│   ├── preferences/
│   │   ├── profile.md                           # 项目级跨 mode 偏好
│   │   └── mode-{name}.md                       # 项目级 per-mode 偏好（agent 按需创建）
│   ├── handoffs/
│   │   └── <handoffId>.md                       # 瞬态——目标 session 消费后删除
│   └── sessions/
│       ├── <sessionId-1>/                       # 一个 mode 的一个 session
│       │   ├── session.json                     # 同 2.x schema + 增加 projectRoot 字段
│       │   ├── history.json
│       │   ├── config.json
│       │   ├── skill-version.json
│       │   ├── skill-dismissed.json
│       │   ├── shadow.git/
│       │   ├── checkpoints.jsonl
│       │   ├── replay-checkout/
│       │   ├── resumed-context.xml
│       │   ├── evolution/
│       │   ├── deploy.json
│       │   ├── .claude/skills/<mode-skill>/
│       │   ├── CLAUDE.md
│       │   └── AGENTS.md                         # codex backend
│       ├── <sessionId-2>/                        # 另一个 mode、或同 mode 的另一个实例
│       │   └── ...
│       └── ...
└── <用户的 deliverable 内容>                    # 网站、视频、文档等——agent 显式越界写入
```

**关键差异 vs 快会话：**
- session 状态文件**直接铺**在 `<sessionId>/` 下，**不再嵌套** `.pneuma/`（避免 `<project>/.pneuma/sessions/{id}/.pneuma/{...}` 的双重套娃）
- `.claude/skills/` 和 `CLAUDE.md` 也铺在 session 目录顶层——agent 的 CWD 正是这里
- project 共享层（`<project>/.pneuma/{project.json, preferences/, handoffs/}`）独立于任何 session
- project 根目录除 `.pneuma/` 外保持纯净——所有非元数据文件都是用户/agent 写的 deliverables

### 2.3 路径别名

代码里统一用三个抽象别名，不论快会话还是项目化：

| 别名 | 快会话 | 项目化 | 用途 |
|------|--------|--------|------|
| `sessionDir` | `<workspace>` | `<project>/.pneuma/sessions/{id}` | Agent CWD、`.claude/skills/`、`CLAUDE.md` 落点 |
| `stateDir` | `<workspace>/.pneuma` | `<project>/.pneuma/sessions/{id}` | session.json、history.json 等状态文件落点 |
| `homeRoot` | `<workspace>` | `<project>` | "用户视角的项目根"——deliverable 默认放这 |
| `projectRoot` | `null` | `<project>` | project 共享层的访问基点；快会话为 null |

注：项目化下 `sessionDir` 和 `stateDir` 是同一目录（扁平化）；快会话下 `stateDir = sessionDir/.pneuma`（保留 2.x 路径不变）。

---

## 3. 环境变量与 Agent 视角

启动 agent 时注入：

```bash
PNEUMA_SESSION_DIR=<sessionDir>          # 总是有
PNEUMA_HOME_ROOT=<homeRoot>              # 总是有；快会话 = workspace，项目化 = project root
PNEUMA_PROJECT_ROOT=<projectRoot>         # 仅项目化 session 有；快会话不设
PNEUMA_SESSION_ID=<sessionId>            # 总是有
```

Agent 的 CWD = `sessionDir`。Agent 看到的 CLAUDE.md = `<sessionDir>/CLAUDE.md`，技能在 `<sessionDir>/.claude/skills/` 下。

**Deliverable 落点**：技能教 agent 把"用户最终成果"写到 `$PNEUMA_HOME_ROOT`（快会话就是 CWD，项目化是 project 根），不写在 session 内部。Session 内部留给草稿、scratch、过程文件。

**文件监听**：默认作用域 = `sessionDir`（chokidar 主 watcher）。viewer 那一侧另开一条**轻量监听**指向 `homeRoot`，专门刷新 deliverable 展示——和 agent 的 watcher 互不干扰。

---

## 4. CLAUDE.md / AGENTS.md 标记升级

### 4.1 现有 markers（保留）

| Marker | 内容 |
|--------|------|
| `<!-- pneuma:start -->` ... `<!-- pneuma:end -->` | Mode skill prompt（含可选 `pneuma:evolved` 子区块） |
| `<!-- pneuma:viewer-api:start -->` ... `<!-- pneuma:viewer-api:end -->` | Viewer API |
| `<!-- pneuma:skills:start -->` ... `<!-- pneuma:skills:end -->` | 已安装的依赖 skills 清单 |
| `<!-- pneuma:preferences:start -->` ... `<!-- pneuma:preferences:end -->` | **个人** 偏好的 critical 块（`~/.pneuma/preferences/`） |
| `<!-- pneuma:resumed:start -->` ... `<!-- pneuma:resumed:end -->` | Replay 恢复上下文 |

### 4.2 新增 markers（仅项目化 session 注入）

| Marker | 内容 |
|--------|------|
| `<!-- pneuma:project:start -->` ... `<!-- pneuma:project:end -->` | 项目身份（name / description / founderSessionId）+ 项目下其他 mode session 概览 + **项目偏好** 的 critical 块（`<project>/.pneuma/preferences/`） |
| `<!-- pneuma:handoff:start -->` ... `<!-- pneuma:handoff:end -->` | 启动时如果 `<project>/.pneuma/handoffs/` 里有指向自己的 handoff，把文件路径和摘要注入；目标 session 消费后该区块清空 |

### 4.3 偏好正交注入

`pneuma:preferences`（个人）和 `pneuma:project` 内嵌的项目偏好**并置**，agent 同时看到两者，可独立进化：

```markdown
<!-- pneuma:preferences:start -->
### Personal Preferences (Critical)
- 永远不要使用深色背景
- 标题不超过 8 字
<!-- pneuma:preferences:end -->

<!-- pneuma:project:start -->
### Project: 我的创业项目

**Description**: 一家做 AI 工具的初创团队的官网与展示

**Other sessions in this project**:
- doc/founding-narrative — 2 days ago
- webcraft/landing-page — 1 hour ago (current)
- clipcraft/intro-video — pending

**Project Preferences (Critical)**:
- 视觉调性偏暖橙
- 文案风格：技术 + 故事感，避免企业八股
- 所有页面/产物都要在 1 屏内说清楚价值主张

**Pending Handoff**: 无
<!-- pneuma:project:end -->
```

每次 session 启动重读 `<project>/.pneuma/{project.json, preferences/}`，重新组装这一区块——这就是"一个 session 改、所有 session 看到"的物理实现：按需重读，不要复杂的实时推送。

---

## 5. Mode 切换协议

### 5.1 触发

UI 入口在 mode 标签下拉菜单："Switch to webcraft" / "Switch to clipcraft" / ...

点击后，UI 向当前 session 的 chat 注入一条 user 消息（用户可见，方便调试）：

```xml
<pneuma:request-handoff target="webcraft" target_session="auto" />
```

`target_session="auto"` 表示由 Pneuma 决定（默认续上最近一个 webcraft session，没有则建新）。用户也可以在切换 UI 里手动指定一个 sessionId，或选 "new"。

### 5.2 生成 handoff 文件

源 agent 看到这条消息，按 `pneuma-project` 共享 skill 教的格式（见 §6），用 Write 工具写：

```
<projectRoot>/.pneuma/handoffs/<handoffId>.md
```

文件 schema：

```markdown
---
handoff_id: hf_2026042701
target_mode: webcraft
target_session: <sessionId or null for new>
source_session: <sourceSessionId>
source_mode: doc
source_display_name: founding-narrative
intent: 基于 founding-narrative.md 做一个落地页
suggested_files:
  - founding-narrative.md
  - assets/brand-deck.md
created_at: 2026-04-27T14:23:11Z
---

# Handoff: doc → webcraft

## 当前进展
我刚和用户完成了 founding-narrative.md 的最后一轮——核心叙事已稳定，包含三段式："为什么现在 / 我们做什么 / 想要谁加入"。

## 切换意图
用户想把这份叙事变成官网首页。明确要求一屏内呈现，不要堆细节。

## 关键决策与约束
- 视觉调性：暖橙 + 深色背景（前一轮反复确认过）
- 不要 hero CTA 那种企业八股
- 每段叙事配一句话标题 + 一段正文，间距大、留白多

## 目标 mode 应先看的文件
1. `founding-narrative.md` — 主叙事
2. `assets/brand-deck.md` — 视觉锚点

## 我没决策的点（留给 webcraft 判断）
- 字体选型
- 是否需要 hero 图（agent 你判断）
```

### 5.3 捕获

Pneuma server 沿用 chokidar 监听 `<projectRoot>/.pneuma/handoffs/`。新文件出现 → 解析 frontmatter → 通过 WS 推送给 UI → 渲染 **Handoff Card**（不是普通 chat 输出）：

```
┌──────────────────────────────────────────┐
│ 🔁 Handoff Ready                          │
├──────────────────────────────────────────┤
│ doc → webcraft                            │
│ Target: founding-narrative → landing-page │
│                                           │
│ [Preview markdown body...]                │
│                                           │
│ [ Edit ]  [ Cancel ]  [ Confirm Switch ]  │
└──────────────────────────────────────────┘
```

用户可以编辑 handoff 内容（直接改文件，UI reload）、取消（删文件）、或确认。

### 5.4 切换执行

用户点 Confirm：

1. 源 backend 优雅终止（`backend.kill()`）
2. 源 session 的 `history.json` 写一条 `{ type: "session_event", subtype: "switched_out", handoff_id, target_session_id, ts }`
3. 目标 session 启动：
   - 如果 handoff 指定了既存 sessionId → resume 那个 session
   - 否则在 `<project>/.pneuma/sessions/{newId}/` 创建新 session
4. 目标 session 启动时 skill-installer 检测到 `<projectRoot>/.pneuma/handoffs/` 有 frontmatter `target_mode = <自身 mode>` 的文件，把路径注入 `pneuma:handoff` 区块
5. 目标 agent 在首轮按 `pneuma-project` skill 指引读取 handoff 文件、内化、然后用 Bash 工具 `rm` 删除该文件
6. 目标 session `history.json` 写对称的 `switched_in`

源 session 的状态保留——用户后续可以从 launcher 回到源 session 继续，跨 mode 路径是分叉而非毁灭。

### 5.5 多窗口并发

不强制单 backend per project。同一 project 可同时跑多个 session：
- shadow-git 各自独立（本来就是 session 级）
- project 共享层文件：last-writer-wins（普通文件并发语义）。运行中 session 不自动刷新——下次启动时重读
- handoff 文件出现时所有连接的 UI 都收到 chokidar 事件，但 Handoff Card 只在目标 mode 的 session UI 上展示

---

## 6. 共享 Skill: `pneuma-project`

类比已有的 `pneuma-preferences`：放在 `modes/_shared/skills/pneuma-project/`，由 skill-installer **仅在项目化 session** 安装。

### 6.1 内容大纲

```
modes/_shared/skills/pneuma-project/
└── SKILL.md
```

`SKILL.md` 教 agent：

1. **项目语境**：你是 `<project>/.pneuma/sessions/{id}/` 里的 session，project root 在 `$PNEUMA_PROJECT_ROOT`，deliverable 写到 `$PNEUMA_HOME_ROOT`，scratch 留在 CWD
2. **跨 session 协作**：项目下其他 mode 的 session 是你的同事；他们的 history、shadow-git 你不直接读，但 `<project>/.pneuma/handoffs/` 是你们的协作通道
3. **写 handoff**：当用户发 `<pneuma:request-handoff target="..." />` 标签的消息时，按 §5.2 schema 写文件到 `<projectRoot>/.pneuma/handoffs/<id>.md`，frontmatter 必填字段，body 至少包含"当前进展 / 切换意图 / 关键约束 / 目标应先看的文件"
4. **消费 handoff**：启动时 CLAUDE.md 的 `pneuma:handoff` 区块如果点出待消费 handoff，立即读取、内化、然后用 `rm` 删除文件
5. **项目偏好读写规则**：项目偏好在 `<projectRoot>/.pneuma/preferences/`，schema 同 `pneuma-preferences`（profile.md + mode-{name}.md，critical/changelog markers）。读写规则同——但作用域是项目级
6. **不要污染 project 根**：除非是 deliverable，否则不要往 project 根写文件

### 6.2 与 `pneuma-preferences` 的关系

两者并存。`pneuma-preferences` 管个人/全局偏好（`~/.pneuma/preferences/`），`pneuma-project` 管项目级偏好（`<projectRoot>/.pneuma/preferences/`）。agent 同时看到两套，project 偏好对当前项目更近、个人偏好更广。冲突时 skill 指引 "project 优先 + 解释为什么"。

---

## 7. Project 创建（Launcher）

Launcher 新增 **"Create Project"** 按钮，触发表单：

| 字段 | 说明 |
|------|------|
| Name | 项目显示名（默认 = basename of root path） |
| Root path | 项目根目录路径——既存目录 or 让 launcher 创建空目录 |
| Description (optional) | 一句话项目描述，写入 `project.json` |
| Initialize from existing session (optional) | 下拉选择一个用户既存的快会话；选了之后 launcher 把那个 workspace 的 history、shadow-git、CLAUDE.md、`.claude/skills/<mode>/` 拷贝到 `<project>/.pneuma/sessions/{newId}/` 作为 founder session |

提交后：
1. 创建 `<root>/.pneuma/{project.json, preferences/, handoffs/, sessions/}` 结构
2. `project.json` 写入 `{ name, displayName, description, createdAt, founderSessionId? }`
3. 如果选了 init source：
   - 生成新 sessionId（保留原 displayName 或用户重命名）
   - 拷贝原 workspace 里 Pneuma 管理的文件到 `<project>/.pneuma/sessions/{newId}/`
     - `<source>/.pneuma/{*}` → `<project>/.pneuma/sessions/{newId}/{*}`（扁平化，跳过 `replay-checkout/`）
     - `<source>/.claude/skills/<mode-skill>/` → `<project>/.pneuma/sessions/{newId}/.claude/skills/<mode-skill>/`
     - `<source>/CLAUDE.md` 中 Pneuma 标记区块 → 重组到 `<project>/.pneuma/sessions/{newId}/CLAUDE.md`
   - 原 workspace 不动——quick session 继续以原形态存在（分叉语义）
4. `~/.pneuma/sessions.json` 注册新 project + founder session（schema 见 §8）
5. Launcher 跳到项目页

---

## 8. Session Registry Schema 升级

### 8.1 现状（2.x）

`~/.pneuma/sessions.json`：

```jsonc
[
  {
    "id": "${workspace}::${mode}",
    "mode": "doc",
    "displayName": "doc-2026-04-27-1830",
    "workspace": "/Users/x/notes",
    "backendType": "claude-code",
    "lastAccessed": 1714200000000,
    "editing": true
  }
]
```

### 8.2 3.0

新增独立的 projects 注册 + sessions 增加 project 关联字段：

```jsonc
{
  "projects": [
    {
      "id": "${projectRoot}",                                  // path-derived 唯一标识
      "name": "my-startup",
      "displayName": "我的创业项目",
      "root": "/Users/x/Code/my-startup",
      "createdAt": 1714200000000,
      "lastAccessed": 1714210000000
    }
  ],
  "sessions": [
    // 项目化 session
    {
      "id": "${projectRoot}::${sessionId}",                    // 注意：id 不再含 mode；同一 project 可有同 mode 多 session
      "kind": "project",
      "sessionId": "abc-123-def-456",
      "projectRoot": "/Users/x/Code/my-startup",
      "mode": "webcraft",
      "displayName": "landing-page",
      "sessionDir": "/Users/x/Code/my-startup/.pneuma/sessions/abc-123-def-456",
      "backendType": "claude-code",
      "lastAccessed": 1714210000000,
      "editing": true
    },
    // 快会话
    {
      "id": "${workspace}::${mode}",                           // 沿用 2.x，向后兼容
      "kind": "quick",
      "mode": "doc",
      "displayName": "doc-2026-04-27-1830",
      "workspace": "/Users/x/notes",
      "sessionDir": "/Users/x/notes",
      "backendType": "claude-code",
      "lastAccessed": 1714200000000,
      "editing": true
    }
  ]
}
```

新字段：
- `kind`: `"quick" | "project"` 区分两种 session
- `projectRoot` (project session only)
- `sessionDir`：物理目录（避免每次推算）
- `sessions[].id` 对项目 session 改用 `${projectRoot}::${sessionId}`——同 mode 多 session 在一个 project 下可以共存

**迁移**：现存 `sessions.json` 没有顶层 `{ projects, sessions }` 结构，是一个数组。读取代码做向后兼容——遇到数组格式当作 `{ projects: [], sessions: <array> }`，并自动给每条加 `kind: "quick"`。下次写入时升级到新结构。

`pneuma sessions rebuild` 命令扫描 `~/pneuma-projects/` 时，对发现的目录：
- 如果有 `.pneuma/project.json` → 注册为 project + 扫描 `<project>/.pneuma/sessions/` 注册子 session
- 否则 → 注册为快会话（同 2.x）

---

## 9. Launcher UX

新区段顺序：

```
┌────────────────────────────────────┐
│ 📁 Recent Projects                 │  ← 新区段
│   • 我的创业项目          1 hr ago │
│     [Open Project]                 │
│   • 周报自动化             3d ago  │
│     [Open Project]                 │
├────────────────────────────────────┤
│ 🕒 Recent Sessions                 │  ← 平铺：项目内 session + 快会话都列
│   • [project] webcraft/landing     │
│   • [quick] doc-2026-04-27         │
│   • [project] clipcraft/intro      │
├────────────────────────────────────┤
│ 🆕 Create Project                  │  ← 新按钮
├────────────────────────────────────┤
│ 🎨 Built-in Modes (start quick)    │  ← 不变；点击 = 起一个快会话
├────────────────────────────────────┤
│ Local / Published Modes            │  ← 不变
└────────────────────────────────────┘
```

### 9.1 项目页（点击 Recent Projects 进入）

```
┌────────────────────────────────────┐
│ ← Back                              │
│ 我的创业项目                         │
│ /Users/x/Code/my-startup            │
│ Description: 一家做 AI 工具的...    │
├────────────────────────────────────┤
│ [+ New Session in this Project]    │  ← 选 mode → 创建新 session
│ [ Evolve Project Preferences ]     │  ← §11
│ [ Edit Project Info ]              │  ← 改 project.json
├────────────────────────────────────┤
│ Sessions:                           │
│   ◉ webcraft/landing-page    now    │
│   ○ doc/founding-narrative   2d     │
│   ○ clipcraft/intro          pending│
└────────────────────────────────────┘
```

session 卡片显示 mode + displayName + lastAccessed。点击 = 打开/恢复该 session。Pending 状态表示有 handoff 文件等待目标但目标 session 还没启动。

---

## 10. Mode 切换 UI（项目内 session）

active session 顶部 mode 标签变成可点击下拉：

```
┌─────────────────────────────────────┐
│ [doc ▼]  founding-narrative   ...   │
├─────────────────────────────────────┤
│ Switch mode:                        │
│   • webcraft  (1 existing)          │
│   • clipcraft  (no sessions yet)    │
│   • illustrate (1 existing)         │
│   • [...all other modes]            │
└─────────────────────────────────────┘
```

点击目标 mode：
- 如果该 mode 有项目内既存 session → 默认续上最近一个，弹"Continue most recent / Create new"二选一
- 如果没有 → 直接创建新 session

二选一确认后，UI 注入 `<pneuma:request-handoff target="..." target_session="..." />` 到 chat，进入 §5 流程。

---

## 11. Evolution at Project Scope

现有 `pneuma evolve <mode>` 不变（继续学全局/跨项目用户偏好）。新增项目级入口：

- Launcher 项目页提供 "Evolve Project Preferences" 按钮
- 触发等同启动一个 evolve mode session，但 workspace = `<projectRoot>`、扫的语料 = 该项目下所有 session 的 history
- 输出写到 `<projectRoot>/.pneuma/preferences/`（profile.md + mode-{name}.md）
- 跨 mode 协作模式（`handoffs/` 历史 + session_event 跨 mode 序列）成为新的 evolve 输入——agent 可以学到 "这个项目里 doc → webcraft 的常见 handoff 风格"

实现层面：evolve mode 的 skill 增加一个 "project mode" 分支——根据启动时 `$PNEUMA_PROJECT_ROOT` 是否设置切换工作模式。

---

## 12. 实现路径与影响面

### 12.1 新增文件

| 文件 | 用途 |
|------|------|
| `core/types/project-manifest.ts` | `ProjectManifest` 类型（`project.json` 的 shape） |
| `core/project-loader.ts` | 识别 quick vs project workspace、加载 project.json、注册到 sessions.json |
| `server/handoff-watcher.ts` | chokidar 监听 `<project>/.pneuma/handoffs/` + 推送 UI |
| `modes/_shared/skills/pneuma-project/SKILL.md` | 共享 skill 内容 |
| `src/components/ProjectPage.tsx` | Launcher 项目详情页 |
| `src/components/CreateProjectDialog.tsx` | 项目创建表单 |
| `src/components/HandoffCard.tsx` | UI 渲染 handoff |
| `src/components/ModeSwitcherDropdown.tsx` | mode 标签下拉切换 |

### 12.2 修改的关键文件

| 文件 | 修改 |
|------|------|
| `bin/pneuma.ts` | 启动逻辑分支：检测 `<workspace>/.pneuma/project.json` → 走项目路径；否则走 quick 路径。组装 `sessionDir`、`stateDir`、`homeRoot`、`projectRoot`，注入对应环境变量 |
| `server/skill-installer.ts` | (1) 安装目标路径参数化为 `sessionDir` (2) 检测项目化 session → 安装 `pneuma-project` 共享 skill (3) 注入新 markers `pneuma:project` 和 `pneuma:handoff` (4) 项目化时同时注入个人 + 项目偏好 critical |
| `server/index.ts` | 项目页 launcher endpoints (`/api/projects`, `/api/projects/:id/sessions`, `POST /api/projects`)；handoff confirm/cancel endpoints；session_event 写入 hook |
| `server/shadow-git.ts` | 路径参数化（已经是 session 级，主要确保新路径下生效） |
| `bin/pneuma-cli-helpers.ts` | `recordSession` 写入 schema 升级，区分 quick/project；`reconcileSessionsRegistry` 增强 |
| `core/types/agent-backend.ts` | 增加 `homeRoot`、`projectRoot` 到 launch 选项 |
| `src/store/session-slice.ts` | 增加 project 上下文字段 |
| `src/App.tsx` | mode 切换 UI 接入 |
| `src/components/Launcher.tsx` | 增加 Recent Projects + Create Project 按钮 |

### 12.3 修改的关联文档

实现完成后联动更新：

| 文档 | 修改 |
|------|------|
| `CLAUDE.md` (root) | "Per-Workspace Persistence" 表 → 改成"Per-Session Persistence + Project Layer"；Session Registry section 更新 schema；新增 "Project Lifecycle" 小节；Skill Installation 列出新 markers |
| `AGENT.md` (如果有等价) | 同上 |
| `README.md` | 新增 "Projects" feature 介绍 |
| `docs/adr/adr-008-session-management.md` | 顶部加 `**Status**: Superseded in part by docs/design/2026-04-27-pneuma-projects-design.md` 注释；保留原文以记录历史 |
| `docs/adr/adr-006-skill-installation.md` | 文末增加 "Amendment 2026-04-27" 段，列出新 markers + sessionDir 安装路径变化 |
| `docs/adr/adr-014-user-preference-analysis.md` | 文末增加 "Amendment 2026-04-27" 段，引入项目级偏好层 |
| `docs/adr/adr-010-cli-entry-startup.md` | 文末增加 "Amendment 2026-04-27" 段，说明 `--project` flag 与启动逻辑分支 |
| `docs/adr/README.md` | ADR-008 状态改 "Accepted (Superseded in part)" |
| `docs/design/pneuma-3.0-design.md` | 顶部增加一行说明：3.0 包含 layout（本文）+ project layer（链接到本 spec）两条平行线 |
| `docs/design/README.md` 或 `docs/README.md` 活跃文档列表 | 列入本 spec |
| `docs/reference/viewer-agent-protocol.md` | 增加 `homeRoot` / `projectRoot` 环境变量段；handoff 文件协议 reference |

### 12.4 CLI flag 增量

| Flag | 用途 |
|------|------|
| `--project <path>` | 显式声明 project root（覆盖自动检测） |
| `--session-id <id>` | 项目化 session 的目标 sessionId（resume 既存或指定 new） |

`--workspace` 沿用——快会话路径下的 workspace = sessionDir = stateDir 父目录；项目化路径下的 workspace 等同 `--project`，但内部路径走新逻辑。

---

## 13. 兼容性

### 13.1 向后兼容

- 2.x 快会话**完全不变**：`<workspace>/.pneuma/session.json` 存在且没有 `project.json` → 走 quick 路径，所有行为同 2.x
- `~/.pneuma/sessions.json` 老数组格式自动识别为 `{ projects: [], sessions: <数组转项目, 自动加 kind:"quick"> }`，下次写入升级
- 老 CLAUDE.md（无新 markers）正常工作，新 markers 不存在时静默跳过
- `pneuma-preferences` skill 不变；`pneuma-project` 仅在项目化 session 安装，不影响快会话

### 13.2 不强制迁移

老 workspace 不会被自动改造。用户想升级到项目化的路径只有一条：在 launcher 选 "Create Project" + "Initialize from existing session"。原快会话保留。

### 13.3 跨版本回退

如果用户暂时回到 2.x 版本：
- 项目化 session 的 `<sessionDir>` 里有完整的 2.x 结构（session.json, history.json, .claude/, CLAUDE.md），但路径在 `<project>/.pneuma/sessions/{id}/` 里——2.x 不会自动发现这个嵌套位置
- 用户可以手动 `pneuma <mode> --workspace <project>/.pneuma/sessions/{id}` 强制以 2.x 形态打开——能跑，但 project 共享层失效（CLAUDE.md 的 `pneuma:project` 区块来自 3.0 注入，2.x 不会刷新它，会变成静态副本）
- 这是接受的代价——3.0 主仓库就是 source of truth

---

## 14. 风险与权衡

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| skill-installer 改动面大，回归风险 | High | 完整 unit test + 现有 739 tests 不破坏 + 一份 e2e 测试覆盖 quick 和 project 两条路径 |
| project 共享层文件并发写入 | Low | 用户偏好 + project info 都是低频写；last-writer-wins 接受。SKILL 指引 agent 写前先读 |
| handoff 文件残留（目标 agent crash） | Low | UI 在项目页提供 "Pending Handoffs" 列表，用户可手动清；后续可加自动 GC（创建 24h 后未消费就提示） |
| 多窗口并发跑同 project 引发的 CLAUDE.md 视图不一致 | Low | 已说明"运行中 session 不自动刷新"是显式语义，不是 bug；下次启动重读 |
| sessions.json schema 升级后老版本 Pneuma 读取 | Medium | 升级时保留数组格式兼容读取；新格式仅 3.0+ 写入——回退到 2.x 时 sessions.json 退化为部分可读（projects 段被忽略），后果可接受 |
| 项目目录结构对用户 git 仓库不友好 | Medium | `.pneuma/` 默认加入用户 `.gitignore`（如果没有就建议）；deliverables 在项目根、Pneuma 元数据隔离在 `.pneuma/` 下，git 友好 |

---

## 15. 不在范围内（YAGNI）

- 跨 project 偏好共享（用户跨项目共有的认知偏好走 `~/.pneuma/preferences/`，已有）
- Project-level deploy 配置（继续 mode 级，每个 webcraft session 自己管 `.pneuma/deploy.json`）
- Project 整体 export 打包（继续 session-level export，可由用户聚合）
- Project 重命名 / 路径迁移工具（手动 mv + 改 project.json + 改 sessions.json 即可，不做 UI）
- 同 project 内 session 间互相读对方 history 的 API（保持隔离；handoff 是唯一通道）
- Project 模板 / scaffold（v3.1 再考虑）

---

## 16. 测试策略

### 16.1 现有测试

`bun test` 当前 739 pass / 0 fail。3.0 实现期间这个数字只允许增加不允许减少。

### 16.2 新增测试

| 测试 | 覆盖 |
|------|------|
| `core/__tests__/project-loader.test.ts` | identify quick vs project；加载 project.json；schema 校验 |
| `server/__tests__/skill-installer-project.test.ts` | sessionDir 安装路径；新 markers 注入；项目偏好 critical 提取 |
| `server/__tests__/handoff-watcher.test.ts` | 文件创建检测；frontmatter 解析；UI 推送 |
| `server/__tests__/session-registry-migration.test.ts` | 老数组 schema → 新对象 schema 的兼容读取 |
| `core/__tests__/launcher-create-project.test.ts` | "init from session" 拷贝逻辑；CLAUDE.md 标记重组 |
| e2e: `quick-session-still-works.test.ts` | 验证 quick session 路径完全不变（行为快照） |
| e2e: `mode-switch-roundtrip.test.ts` | doc → webcraft → clipcraft 跨 mode 接力，handoff 文件流转、session_event 落点正确 |

### 16.3 手动验证

- 创建一个 project，从既存快会话拷过来，确认原快会话不受影响
- 在 project 内 doc → webcraft 切换，确认 handoff card 出现、目标 agent 读到内容、handoff 文件被删除
- 同 project 同时开两个窗口（同 mode 不同 session 实例），验证 shadow-git 各自独立
- 退出 + 重启 launcher，确认 Recent Projects 和 Recent Sessions 正确恢复

---

## 17. 后续问题（v3.1+）

- 同 mode 多 session 在一个 project 下，displayName 命名规则（建议 `{mode}/{slug}` 或 `{mode}-{n}`，由用户在切换创建时指定）
- Project preferences evolution 的语料 weight 跨 mode 如何平衡（不同 mode session 长度差异巨大）
- handoff 文件是否在 project 维度留 history（暂定不留——消费即删；如果要留可放 `<project>/.pneuma/handoffs-archive/{handoffId}.md`，后续讨论）
- 项目内 deliverable 在 project 根的 git 友好性（例如，是否生成 `.gitattributes` 标记某些 mode 产出为 binary）

---

## 18. 决策摘要

- **Project 是可选的组织维度**，不强制；快会话保持 2.x
- **Session 是物理工作单位**，agent CWD 永远 = sessionDir
- **共享层在 project 根**：`<project>/.pneuma/{project.json, preferences/, handoffs/}`
- **跨 mode 接力靠 handoff 文件**：agent 自己写、UI 捕获、目标读取后删除——无新 LLM 调用、无新协议
- **多窗口并发允许**，按需重读共享层；无强一致性
- **CLAUDE.md 新增两个 markers**：`pneuma:project`（项目身份 + 项目偏好 critical）+ `pneuma:handoff`（待消费 handoff 索引）
- **`pneuma-project` 共享 skill** 教 agent 跨 mode 协作的方法论；仅项目化 session 安装
- **Launcher 升级**：Recent Projects 区段 + Create Project 按钮 + 项目详情页
- **不强制迁移**：老 workspace 不动，用户用"建项目 + 从 session 初始化"显式升级
