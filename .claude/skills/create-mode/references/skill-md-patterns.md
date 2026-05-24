# SKILL.md Patterns

> 怎么写 `modes/<name>/skill/SKILL.md` —— agent 在每个 session 启动时通过 skill-installer 把它的内容拼到 CLAUDE.md/AGENTS.md/.kimi/AGENTS.md 里读到。SKILL.md 是 mode 的"agent project guide"。

## 角色

SKILL.md 在 agent 的视角里类似项目根的 `CLAUDE.md`，但 scope 是单个 mode。每次 session 启动：

1. `server/skill-installer.ts` 把 `modes/<name>/skill/` 拷到 `<sessionDir>/.claude/skills/pneuma-<name>/`（或 Codex/Kimi 对应目录）
2. SKILL.md 主体（用 `<!-- pneuma:start -->` 包裹）被注入到 instructions file 的 `pneuma:start/end` block
3. `viewerApi.actions` / `commands` / `proxy` / `scaffold` 被渲染成结构化 markdown 注入到 `pneuma:viewer-api:start/end` block
4. 用户在跨 session 间累积的偏好被注入到 `pneuma:preferences:*` block

**所以 SKILL.md 写的是：** mode 的领域知识 + viewer 怎么用 + 必须遵守的输出契约 + 工作流套路 + 何时引用 `references/<topic>.md` 深入。

## 推荐骨架（六段式）

按这个顺序写，readers（agent + 你将来回头看）的认知路径最顺：

```markdown
# <Mode displayName>

## Scene
（一段话，说清楚用户在做什么、viewer 长什么样、agent 与 user 怎么协作）

## Viewer contract
（user 操作和 viewer 反馈的契约：select 后 viewer 提供什么 context，
agent 调 action 时 viewer 怎么响应。把 ViewerAddress vocabulary 表放这里。）

## Core rules
（agent 必须遵守的硬约束——输出格式合法性、文件命名约定、安全边界）

## Workflow
（一个或多个工作流剧本：discovery → brief → implementation；
read → reason → edit → verify。用 numbered steps，每步说"为什么"。）

## Commands
（如果 manifest.viewerApi.commands 有声明，列出每个命令的 id + 何时触发 + 期望产出。
Imperative form，对 agent 说"你应该……"。）

## References
（progressive disclosure 的入口：列 `references/<topic>.md` 们 + 何时读。
让 SKILL.md 主体保持 <500 行；深内容下沉。）
```

### Scene 的写法

Scene 不是宣传文案。它给 agent 一个"我和谁、在哪、做什么"的代入感。三句话足够。

**好的 Scene 例（kami 风）：**

> 你是 kami 模式里的 agent。用户面前是一张固定纸张尺寸的画布——A4、A5、Letter 任一，横竖锁定。你的工作是排版：用 HTML + CSS 在这张纸上组织内容，让密度、层级、节奏都恰到好处。viewer 持续渲染你刚写的文件，用户能立刻看到结果；他会在内容溢出页面时弹一个 "fit warning" 给你，要求收敛。

**差的 Scene 例：**

> Kami is a paper-canvas typesetting mode. It supports A4, A5, Letter paper sizes. Users can choose portrait or landscape orientation. The viewer renders HTML files into paper-styled pages.

差在哪？它在描述 mode 的"功能列表"，没给 agent "我是谁、我在干什么"的画面感。Scene 的作用就是建立画面感——剩下的 rules / workflow 才是动作。

`manifest.skill.mdScene` 是 Scene 的精炼版（一段话），会被 skill-installer 渲染进指令文件的开头。SKILL.md 里的 Scene 章节可以比 mdScene 更长，提供更多上下文。

### Viewer contract 章节

把这些东西摆清楚：

1. **用户的 selection 长什么样**：他能选哪些对象？viewer 把哪些字段塞进 `<viewer-context>`？
2. **ViewerAddress vocabulary 表**：每个 key 是 coarse 还是 fine、含义。这是 ViewerAddress 协议的 mode 侧 schema。
3. **可调 action 列表 + 何时调**：navigate-to / capture / 自定义诊断。`capture` 是框架内建——告诉 agent "需要看自己刚写的东西渲染对不对" 时调。
4. **不变量**：viewer **不会** 自动保存 agent 的编辑结果到任何远端——agent 直接 Edit/Write 到磁盘；viewer 经 Source 订阅看到结果。

### Core rules 章节

硬约束放这里。例如：

- diagram：**XML 必须是合法 draw.io 结构**（cells 0 和 1 必须存在、ID 唯一、vertex/edge 互斥），否则渲染器拒绝
- remotion：**Composition 必须在 `Root.tsx` 注册**，包含 fps/width/height/durationInFrames 元数据
- slide：**每张 slide 是一个独立 .html 文件，存在 `<contentSet>/slides/` 目录**

Rules 要陈述式 + 显式后果。**避免 ALL-CAPS 的 MUST / NEVER**——尝试解释 *why*。

```markdown
❌ NEVER use `position: fixed` in slide HTML.
✓ Avoid `position: fixed` in slide HTML. Slides render inside an iframe scaled to fit
  the viewport; fixed positioning escapes the iframe transform and lands in the wrong
  place. Use `position: absolute` relative to the slide container instead.
```

### Workflow 章节

把"agent 拿到任务后应该怎么走"写成可循的剧本。一个 mode 通常 1-3 个 workflow：

- **创作 workflow**：discovery → brief → implement → self-verify (capture)
- **修复 workflow**：read → reason → edit → verify
- **导出 workflow**：（如有）prepare → render → save

每步说 *为什么*——读者是 agent，告诉它"这一步存在的理由"它就能在边缘情况上做对决定。

### Commands 章节

如果 `manifest.viewerApi.commands` 有声明，列出每个命令的：

- id
- 何时被用户触发（什么按钮 / 操作）
- agent 应该如何响应（产出什么、调什么 action、问什么后续）

Agent 看到 user message 末尾出现一个 command notification 时会回 SKILL.md 这一节查"我该干嘛"。

### References 章节

每个 mode 通常 3-8 份 references/，每份覆盖一个 topic。在 SKILL.md References 章节用一个表索引：

```markdown
## References

Read when you need depth on the topic.

| Topic | File |
|---|---|
| Typography & layout | `references/typography.md` |
| Color palettes | `references/palette.md` |
| Component patterns | `references/components.md` |
| Export formats | `references/export.md` |
```

每份 references 文件本身控制在 ~300 行——更长的话切成子文件。

---

## 写作风格

- **Imperative form**：对 agent 说"做 X"、"先 read 再 edit"——比起 passive 描述句更好执行。
- **解释 Why**：每个 rule、每个 workflow 步骤都带一句"为什么"。今天的 LLM 是 *smart* 的；告诉它 *why*，它在 edge case 上能自己推理。看 skill-creator 的 "Explain the why" 段。
- **避免空话**：不写"使用最佳实践"、"注意性能"——具体说什么是 best practice、性能瓶颈在哪。
- **示例 > 抽象描述**：input → output 的具体例子，比一段 prose 的"应该"更有用。
- **不要堆 MUST/NEVER**：见上面 Core rules 的反例对比。

---

## Evolution directive

`manifest.evolution.directive` 是给 evolve agent 看的一句话——它告诉"evolve 时应该往什么方向学"。这个字段几乎所有现役 mode 都填了；建议必填。

**写法：动词开头 + 学什么 + 学了之后怎么用。**

例：

> 学习用户的演示设计偏好：排版选择、调色板倾向、布局密度、幻灯片结构模式。把它们写回 skill，让主 agent 把这些偏好当默认值，同时尊重显式指令。

**反例（差）：** "Learn the user's preferences."（什么偏好？学了用在哪？）

**好的 directive 有三段：**

1. **学什么** — 列出可观察的维度
2. **怎么学** — 从哪种证据（session history、文件变更、用户反馈）
3. **用在哪** — 注入 skill 主体的哪段、影响主 agent 的什么决策

evolution.directive 决定了 evolve 命令对这个 mode 的产出质量。花 10 分钟写一句好的，比事后改 evolve 输出省事得多。

---

## 反模式

- ❌ **SKILL.md 写成"功能介绍"**：把 mode 的对外宣传文案搬过来——agent 不需要营销文案，需要操作指引。
- ❌ **把所有 references 都 inline**：SKILL.md 主体 >500 行就难以高效进入工作；切下沉。
- ❌ **rules 只写 don'ts，不写 dos**：agent 读完 "don't do X" 不知道该做什么。配一对 do/don't。
- ❌ **复制 CLAUDE.md 的内容**：CLAUDE.md 已经在 instructions 里了，SKILL.md 主体不要复述项目通则；只写 *这个 mode 特有的*。
- ❌ **不写 ViewerAddress vocabulary 表**：agent 就只能猜 address 的 shape；选错了 navigate / capture 都会失败。
