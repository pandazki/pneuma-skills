# Pneuma 3.0: AI-Native Micro-App Platform

> **日期**: 2026-03-12
> **状态**: Draft
> **决策者**: Pandazki
> **前提**: 2.x 里程碑完成 — Mode 系统、Backend 抽象、Skill 演进、桌面应用、分发基础设施

---

## 1. 核心命题

### 2.x 做了什么

Pneuma 2.x 建立了一套完整的 Agent 共创基础设施：

- **Mode 系统** — 7 个内置 Mode，外部 Mode 支持，Mode 发布
- **Backend 抽象** — Claude Code + Codex，启动时选择，能力 gating
- **Skill 演进** — Evolution Agent 跨会话学习用户偏好
- **桌面应用** — Electron 封装，系统托盘，应用管理
- **分发** — R2 快照、Mode 发布、npm CLI

但 2.x 的交互范式本质上还是 **chat-centric**：用户与 Agent 对话，Viewer 是辅助。用户需要理解"我在使用一个 AI Agent"。

### 3.0 要做什么

**反转交互主体。**

用户面对的不再是 Agent，而是一个**为特定任务量身定做的微应用**。Agent 是引擎，不是界面。

```
2.x: 用户 → 对话框 → Agent → 输出
3.0: 用户 → App UI → (Agent 在背后) → 交付物
```

**一句话定义 Pneuma 3.0:**

> 如果你有 Claude Code 或 Codex 订阅，想用自己舒服的方式完成一件工作——告诉 Pneuma，它为你生成一个专属的 AI-native 微应用。

---

## 2. 关键洞察：Mode 从来就是 App

回顾 2.x 的 doc mode：它就是一个"帮你写文档的 App"。slide mode 就是一个"帮你做演示文稿的 App"。

Mode 本质上已经是 App，只是 2.x 只提供了一种布局——chat panel 永远在右边，viewer 永远在左边。

**3.0 不需要重新发明 Mode 系统。它只需要加一种新的布局。**

整条管线不变：
- `ModeManifest` 描述 App 的能力
- `Skill` 注入 Agent 的领域知识
- `ViewerContract` 定义 App 的界面
- `AgentBackend` 提供 AI 引擎
- `Evolution` 个性化 App 的行为

变的只是 shell 层怎么把这些东西组合呈现。

---

## 3. 布局体系

### 3.1 两种布局

```
┌─────────────────────────────────────────────────┐
│ "editor" 布局 (2.x 默认)                         │
│                                                  │
│  ┌──── TopBar ──────────────────────────────┐    │
│  ├──────────────┬───────────────────────────┤    │
│  │              │                           │    │
│  │   Viewer     │    Chat / Editor /        │    │
│  │  (preview)   │    Terminal / Context     │    │
│  │              │                           │    │
│  │              │                           │    │
│  └──────────────┴───────────────────────────┘    │
│                                                  │
│  适用: 复杂任务，持续对话，多轮迭代               │
│  例: doc, slide, draw, webcraft                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ "app" 布局 (3.0 新增)                             │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │                                          │    │
│  │        Viewer = 整个 App                 │    │
│  │       (全屏 SPA，固定窗口)                │    │
│  │                                          │    │
│  │                                          │    │
│  │                           ┌────┐         │    │
│  │                           │ 🤖 │         │    │
│  └───────────────────────────┴────┘─────────┘    │
│                                                  │
│  适用: 结构化任务，明确输入输出，微应用           │
│  悬浮按钮 → 展开 Agent 对话面板 (fallback)       │
│  例: 双语阅读器, 邮件起草器, 数据清洗器           │
└─────────────────────────────────────────────────┘
```

### 3.2 editor 布局 — 2.x 的超集

即现有布局，零改动。2.x 所有 Mode 自动归入此类。

特点：
- Agent 对话面板始终可见
- Viewer 和 Chat 可调整比例
- 多 Tab（Editor、Terminal、Diff、Context、Schedules）
- 适合需要持续对话的复杂创作任务

### 3.3 app 布局 — 3.0 新增

Viewer 占据整个窗口，Agent 完全隐藏。

**结构：**

```
┌──────────────────────────────────────────┐
│  App Content (Viewer 全屏)                │
│                                          │
│  ┌─── 由 viewer 自定义的 SPA ──────────┐ │
│  │                                      │ │
│  │  表单、卡片、列表、进度...           │ │
│  │  任何 HTML 都可以                    │ │
│  │                                      │ │
│  └──────────────────────────────────────┘ │
│                                          │
│                              ┌──────────┐│
│                              │  Agent   ││
│                              │  Bubble  ││
│                              └──────────┘│
└──────────────────────────────────────────┘
```

**Agent Bubble（悬浮按钮）：**

- 默认收起：圆形按钮，显示 Agent 状态（idle/working）
- Working 状态：呼吸动效 + 简短状态文字（"翻译中..."）
- 点击展开：侧滑出 Agent 对话面板
- 展开后等同于 2.x 的 ChatPanel（完整的消息流 + 输入框）
- 用途：
  - 查看 Agent 工作日志
  - 手动输入补充指令
  - 处理 Permission 请求
  - Debug / 高级用户 fallback

**窗口模型：**

- 固定大小，由 manifest 声明
- 从 Launcher 启动时创建独立窗口（Electron `BrowserWindow`）
- 没有 TopBar，没有 Tab 切换
- 看起来就是一个普通的桌面小应用

### 3.4 Viewer 的角色演变

2.x 的 Viewer 是"预览面板"——展示 Agent 写入的文件。

3.0 app 布局下，Viewer 变成"整个应用的 UI"——它不只是展示文件，它是用户操作的主界面。

但合约不变。`ViewerContract` 已有的能力刚好够用：

| ViewerContract 能力 | editor 布局中 | app 布局中 |
|---------------------|-------------|-----------|
| `PreviewComponent` | 渲染预览 | 渲染整个 App UI |
| `extractContext` | 选中内容 → Agent | 用户输入 → Agent |
| `actions` | Agent 操作预览 | Agent 返回结果 → UI 更新 |
| `onNotifyAgent` | Viewer 主动通知 | App 提交任务给 Agent |
| `workspace` | 文件导航 | App 数据管理 |

关键点：**app 布局的 viewer 不依赖 agent 写文件来驱动 UI 更新。** 它通过 `onNotifyAgent` 发送任务，通过 `actionRequest` 接收结果，直接在内存中渲染。文件系统只用于持久化交付物。

---

## 4. Manifest 扩展

```typescript
export interface ModeManifest {
  // ... 所有现有字段保持不变 ...

  /**
   * App 布局模式。
   * - "editor": 传统双面板布局（Viewer + Chat），默认值
   * - "app": 全屏微应用布局（Viewer 独占，Agent 悬浮）
   */
  layout?: "editor" | "app";

  /**
   * 窗口尺寸偏好（主要用于 app 布局 + Electron 场景）。
   * editor 布局忽略此字段，使用默认窗口策略。
   */
  window?: {
    width: number;   // e.g. 800
    height: number;  // e.g. 600
  };
}
```

变更量极小：两个可选字段，默认值保持 2.x 行为。

---

## 5. Shell 层实现

### 5.1 App.tsx 变更

当前 `App.tsx` 的渲染路径：

```
isLauncher? → <Launcher />
otherwise  → <TopBar /> + <Group horizontal>[ <Preview/> | <RightPanel/> ]</Group>
```

3.0 变为：

```
isLauncher? → <Launcher />
layout === "app"?  → <AppShell>[ <Preview fullscreen /> + <AgentBubble /> ]</AppShell>
layout === "editor" → 现有布局（零改动）
```

### 5.2 AppShell 组件（新增）

```typescript
// src/components/AppShell.tsx

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen bg-cc-bg text-cc-fg overflow-hidden">
      {/* Viewer 全屏 */}
      <div className="h-full w-full">
        {children}
      </div>
      {/* Agent 悬浮按钮 */}
      <AgentBubble />
    </div>
  );
}
```

### 5.3 AgentBubble 组件（新增）

```typescript
// src/components/AgentBubble.tsx

function AgentBubble() {
  const [expanded, setExpanded] = useState(false);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const permSize = useStore((s) => s.pendingPermissions.size);

  // Permission 请求时自动展开
  useEffect(() => {
    if (permSize > 0) setExpanded(true);
  }, [permSize]);

  const isWorking = sessionStatus === "running" || sessionStatus === "compacting";

  if (expanded) {
    return (
      <div className="fixed bottom-6 right-6 w-[400px] h-[600px] z-50
                      bg-cc-surface border border-cc-border rounded-2xl
                      shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-cc-border">
          <StatusDot />
          <button onClick={() => setExpanded(false)}>收起</button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel />  {/* 复用现有 ChatPanel */}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      className="fixed bottom-6 right-6 w-14 h-14 z-50
                 rounded-full bg-cc-surface border border-cc-border
                 shadow-lg flex items-center justify-center
                 hover:border-cc-primary/40 transition-all"
    >
      {isWorking ? <PulsingDot /> : <AgentIcon />}
      {permSize > 0 && <Badge count={permSize} />}
    </button>
  );
}
```

### 5.4 Electron 窗口管理扩展

```typescript
// desktop/src/main/window-manager.ts

function createAppWindow(url: string, manifest: { window?: { width: number; height: number } }) {
  const { width = 800, height = 600 } = manifest.window || {};

  const win = new BrowserWindow({
    width,
    height,
    resizable: false,          // 固定大小
    titleBarStyle: "hiddenInset",
    backgroundColor: "#09090b",
    webPreferences: { preload: PRELOAD_PATH, contextIsolation: true },
  });

  win.loadURL(url);
  return win;
}
```

Launcher spawn 子进程时，传递 `layout` 和 `window` 信息给前端 URL query：

```
http://localhost:18001?session=xxx&mode=bilingual-reader&layout=app
```

---

## 6. 微应用的交互模型

### 6.1 通用模式

每个 micro-app 的核心交互可以抽象为三步：

```
1. 用户输入（结构化）
   ├─ 表单填写
   ├─ 文件拖入 / 粘贴
   ├─ URL 输入
   └─ 选项选择

2. Agent 处理（不可见）
   ├─ Viewer 调用 onNotifyAgent() 发送结构化任务
   ├─ Agent 使用 Skill 处理
   ├─ 进度通过 session_update 反馈到 UI（Agent Bubble 状态变化）
   └─ 结果通过 viewer_action / 文件写入交付

3. 结果交付（用户友好）
   ├─ 在 Viewer 内直接展示
   ├─ 提供本地文件链接（一键打开）
   ├─ 通知完成（系统通知 / 声音 / Bubble 状态）
   └─ 保存到 workspace 供后续使用
```

### 6.2 Viewer ↔ Agent 通信

app 布局的 Viewer 通过现有 contract 与 Agent 通信：

**Viewer → Agent（发送任务）：**

```typescript
// Viewer 内部
props.onNotifyAgent({
  type: "task_submit",
  summary: "翻译文章",
  message: `请翻译以下内容为中文，按照纸质书排版生成双语对照 HTML。

<task>
  <source-type>url</source-type>
  <source>https://example.com/article</source>
  <options>
    <format>paper-style</format>
    <target-language>zh-CN</target-language>
  </options>
</task>`,
});
```

这条消息通过 `sendViewerNotification()` → WebSocket → Agent，和 2.x 完全一样。

**Agent → Viewer（返回结果）：**

方式一：Agent 写文件 → chokidar 推送 → Viewer 检测到新文件 → 更新 UI
方式二：Agent 发送 viewer_action → Viewer 收到 `actionRequest` prop → 处理

**进度反馈：**

- Agent working → `sessionStatus = "running"` → Bubble 显示工作中动效
- Agent idle → `sessionStatus = "idle"` → Bubble 恢复静默
- Agent 写入中间文件（progress.json）→ Viewer 读取 → 显示进度条

### 6.3 Skill 的角色

micro-app 的 Skill 和 2.x 一样是静态知识注入。但 micro-app 的 Skill 更聚焦：

```markdown
# 双语阅读器 Skill

## 你的任务
将用户提供的外文内容翻译为中文，生成双语对照 HTML 页面。

## 输入格式
用户通过 <task> 标签提交任务，包含：
- source-type: url | pdf | markdown | clipboard
- source: 内容或 URL
- options: 排版偏好、目标语言

## 输出要求
1. 生成 output/<filename>.html，纸质书排版风格
2. 左栏原文，右栏中文，段落对齐
3. 使用 serif 字体，适当行距，米色背景
4. 生成完成后写入 output/latest.json: { "file": "<path>", "title": "<标题>" }

## 翻译原则
- 专业术语保留原文并括号标注
- 不意译，保留原文结构
- 代码块不翻译
```

Evolution Agent 可以学到：
- "这个用户是 AI 工程师，技术术语按专业理解翻译"
- "这个用户偏好宋体而非黑体"
- "这个用户喜欢在术语后用括号标注英文原文"

这些偏好被增量写入 Skill，后续翻译自动应用。

---

## 7. 案例：双语阅读器

以这个案例完整走一遍 3.0 的体验。

### 7.1 创建（一次性）

用户在 Pneuma Launcher 中进入 mode-maker，描述需求：

> "我想要一个双语阅读器。输入外文内容（URL、PDF、Markdown 或粘贴文本），生成纸质书排版的双语对照 HTML。左边原文右边中文，段落对齐。"

Mode-maker agent 生成：
- `manifest.ts` — `layout: "app"`, `window: { width: 900, height: 700 }`
- `viewer/` — React SPA（输入表单 + 结果列表 + 状态指示）
- `skill/` — 翻译 + HTML 生成的领域知识
- `seed/` — 空的 output 目录

### 7.2 日常使用

用户从 Launcher 点击"双语阅读器"图标。

**Step 1 — 一个独立窗口打开：**

```
┌─────────────────────────────────────────┐
│  双语阅读器                    ─  □  ×  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  📎 粘贴内容 或 输入 URL        │    │
│  │                                 │    │
│  │  [                            ] │    │
│  │                                 │    │
│  │  选项:                          │    │
│  │  ○ 纸质书排版  ○ 简洁排版       │    │
│  │                                 │    │
│  │         [ 开始翻译 ]            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ── 历史记录 ──                         │
│  📄 Attention Is All You Need   3/12    │
│  📄 Scaling Laws for Neural...  3/11    │
│                                         │
│                              ┌────┐     │
│                              │ ●  │     │
│                              └────┘     │
└─────────────────────────────────────────┘
```

**Step 2 — 用户粘贴 URL，点击"开始翻译"：**

Viewer 调用 `onNotifyAgent()`，Agent Bubble 变为 working 状态。

```
┌─────────────────────────────────────────┐
│  双语阅读器                    ─  □  ×  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  翻译中...                      │    │
│  │                                 │    │
│  │  ████████████░░░░░  65%         │    │
│  │                                 │    │
│  │  正在处理第 12/18 段             │    │
│  └─────────────────────────────────┘    │
│                                         │
│                            ┌────┐       │
│                            │ ◌  │ ← 呼吸│
│                            └────┘       │
└─────────────────────────────────────────┘
```

**Step 3 — 翻译完成：**

Agent 写入 `output/attention-is-all-you-need.html`，Viewer 检测到新文件。

```
┌─────────────────────────────────────────┐
│  双语阅读器                    ─  □  ×  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  ✓ 翻译完成                      │    │
│  │                                 │    │
│  │  Attention Is All You Need      │    │
│  │  18 段 · 约 12,000 字            │    │
│  │                                 │    │
│  │  [ 在浏览器中打开 ]  [ 新翻译 ]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ── 历史记录 ──                         │
│  📄 Attention Is All You Need   刚刚 ←  │
│  📄 Scaling Laws for Neural...  3/11    │
│                                         │
│                              ┌────┐     │
│                              │ ●  │     │
│                              └────┘     │
└─────────────────────────────────────────┘
```

用户点击"在浏览器中打开"→ 调用 `system/open-url` → 浏览器打开本地 HTML。

### 7.3 个性化

使用几次后，用户运行 `pneuma evolve --mode bilingual-reader`。

Evolution Agent 分析历史，发现：
- 用户总是翻译 AI/ML 论文
- 用户的修改请求："transformer 不要翻译成'变换器'"、"把 attention 保留英文"
- 用户偏好宋体排版

生成 proposal，apply 后 Skill 被增强：

```markdown
<!-- evolved: 2026-03-15 -->
## 用户偏好
- 用户是 AI 方向工程师，翻译 AI/ML 领域术语时按专业理解处理
- 保留以下术语英文原文：transformer, attention, embedding, fine-tuning, tokenizer
- 排版使用宋体（Noto Serif SC），行距 1.8
- 术语首次出现时括号标注英文，后续直接使用中文
```

下次翻译自动应用这些偏好，用户无感。

---

## 8. 实现路径

### Phase 1: App Shell（核心增量）

目标：让 app 布局可以运行。

- [ ] `ModeManifest` 新增 `layout` + `window` 字段
- [ ] `AppShell` 组件 — Viewer 全屏容器
- [ ] `AgentBubble` 组件 — 悬浮按钮 + 可展开对话面板
- [ ] `App.tsx` 根据 layout 选择 shell
- [ ] Electron `window-manager.ts` 支持 `createAppWindow()`
- [ ] Launcher 传递 layout/window 信息到子进程 URL
- [ ] 验证：用现有 webcraft mode 设为 `layout: "app"` 测试

### Phase 2: 第一个 Micro-App

目标：用真实用例验证整条链路。

- [ ] 双语阅读器 Mode（manifest + skill + viewer）
- [ ] Viewer SPA：输入表单 + 历史列表 + 进度 + 结果展示
- [ ] Skill：翻译 + HTML 生成
- [ ] 验证 onNotifyAgent → Agent 处理 → 文件写入 → Viewer 更新
- [ ] 验证 Evolution 对 micro-app 的效果

### Phase 3: Mode-Maker 增强

目标：让用户通过 mode-maker 创建 micro-app。

- [ ] mode-maker fork 时支持选择 layout 类型
- [ ] app 布局的 seed 模板（表单 + 结果 + 状态的通用 SPA 骨架）
- [ ] mode-maker 的 Skill 更新：指导 Agent 如何生成 app 布局的 viewer

### Phase 4: 平台化

- [ ] Launcher 作为 App Manager：安装/卸载/更新 micro-app
- [ ] App 图标自定义（manifest.icon 在 Launcher 和 Tray 中渲染）
- [ ] 跨 micro-app 的全局 Evolution（用户画像共享）
- [ ] App 市场（R2 发布 micro-app，其他用户一键安装）

---

## 9. 架构影响

### 不变的

| 层 | 说明 |
|----|------|
| ModeManifest | 协议不变，新增两个可选字段 |
| ViewerContract | 合约不变，`PreviewComponent` 已经可以渲染任意 UI |
| AgentBackend | 零改动 |
| Skill 安装 | 零改动 |
| Evolution | 零改动 |
| WS Bridge | 零改动 |
| Session 持久化 | 零改动 |
| 文件监听 | 零改动 |
| 分发（R2/npm） | 零改动 |

### 变的

| 组件 | 变更 |
|------|------|
| `App.tsx` | 根据 layout 分支渲染 AppShell 或现有布局 |
| `AppShell.tsx` | **新增** — Viewer 全屏容器 |
| `AgentBubble.tsx` | **新增** — 悬浮 Agent 按钮 + 可展开对话面板 |
| `window-manager.ts` | 支持 app 布局的固定尺寸窗口 |
| `Launcher.tsx` | 传递 layout 信息；后续演进为 App Manager |
| `mode-manifest.ts` | 新增 `layout` + `window` 两个可选字段 |
| `server/index.ts` | 传递 layout 到前端 URL query |

**代码影响量估算：~300-500 行新增，~50 行修改。核心是两个新组件。**

### 兼容性

- `layout` 默认 `"editor"` — 所有 2.x Mode 零改动
- `window` 不设时使用 Electron 默认窗口策略 — 2.x 行为不变
- App 布局的 Viewer 使用和 editor 布局完全相同的 `ViewerPreviewProps`
- 不引入新的通信协议、新的数据格式、新的持久化结构

---

## 10. 被否决的方案

### 10.1 为 micro-app 设计全新的 Viewer 合约

否决原因：现有 `ViewerContract` 已经足够。`PreviewComponent` 可以渲染任意 React 组件，`onNotifyAgent` / `actionRequest` 提供了双向通信。新合约会导致两套并行系统。

### 10.2 让 micro-app 脱离 Mode 系统

否决原因：Mode 系统已经提供了 micro-app 需要的一切——skill 安装、session 管理、evolution、分发。脱离意味着重写这些基础设施。

### 10.3 用 DSL 而非 HTML/React 定义 micro-app UI

否决原因：DSL 增加学习成本，限制表达能力。HTML/React 是 coding agent 最擅长的输出格式，且 mode-maker 已经证明 agent 可以生成完整的 React viewer。

### 10.4 运行时动态生成 micro-app（无需 mode-maker）

否决原因：过度设计。用户描述需求 → mode-maker 生成 Mode → 作为 app 使用，这条路径已经足够。运行时动态生成意味着无法持久化、无法 evolve、无法分享。mode-maker 是正确的创建入口。

---

## 11. 产品定位演变

```
1.x: Claude Code 的 GUI wrapper
     "让 AI coding 更好看"

2.x: Agent 共创基础设施
     "给 Agent 注入领域知识，人和 Agent 一起创作内容"

3.0: AI-Native 微应用平台
     "描述你要做什么，得到一个专属的 AI 驱动小应用"
```

核心公式演变：

```
2.x: ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell
3.0: ModeManifest(skill + viewer + agent_config) × AgentBackend × Layout × RuntimeShell
                                                                    ↑ 唯一新增维度
```

一个维度的增加，产品形态从"工具"变成"平台"。
