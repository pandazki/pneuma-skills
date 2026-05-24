# External Integrations

> 当 mode 要接外部 API / 渲染引擎 / 第三方库时，要做的事：选加载方式、绕 CORS、收集 API key、合规标注。源头：`docs/reference/viewer-agent-protocol.md::Manifest`、`docs/reference/network-topology.md`。

## 集成形态决策

mode 接外部技术栈大致两种方式：

| 方式 | 适合 | 加载点 | manifest 体现 |
|------|------|--------|--------------|
| **CDN + ProxyRoute** | 成熟独立渲染器；输出有公开标准（XML / JSON / SVG） | viewer iframe / `<script src>` 走 `/proxy/<name>/*` 反代 | `proxy: { name: ProxyRoute }` |
| **npm + 浏览器 JIT** | 需要紧密集成、动态组件、render 闭环 | viewer 直接 import；用 `@babel/standalone` 编译用户的 .tsx | `viewer.refreshStrategy: "manual"` + `init.params` 配置 |

### 已有实例

- **diagram → draw.io**：CDN viewer-static.min.js 走 `proxy.drawio`；draw.io 是黑盒渲染器，viewer 只通过 SVG 提结果。
- **remotion → Remotion 4.0**：npm `@remotion/player` + `@babel/standalone` 在浏览器内编译用户 `src/**/*.tsx`，渲染管道完全内化。

### 选哪种？

- "成熟、有 standalone viewer、输出可序列化的格式（XML/JSON）" → **CDN + Proxy**
- "需要在 viewer 里 host 用户代码、动态注册 component、跑 frame-level 联动" → **npm + JIT**
- 两者都不是 → 大概率你不需要外部集成，直接在 viewer 内用 React component 实现

---

## ProxyRoute

用 `proxy` 字段时框架做的事：

```ts
proxy: {
  drawio: {
    target: "https://viewer.diagrams.net",
    methods: ["GET"],
    description: "draw.io viewer-static SDK CDN (for embedding the diagram renderer)",
  },
}
```

`server/index.ts` 把 `/proxy/drawio/*` 反代到 `https://viewer.diagrams.net/*`。Viewer 里就这样用：

```tsx
<script src="/proxy/drawio/js/viewer-static.min.js" />
```

### 关键约束

- **默认只放行 `GET`**——POST/PUT/PATCH/DELETE 要显式写 `methods: ["GET", "POST"]`。
- **`target` 必须是裸 origin**（`https://api.example.com`），不带 path。
- **`headers` 支持模板**：`Authorization: "Bearer {{API_KEY}}"`，`{{API_KEY}}` 从 `process.env` 取（同源于 `init.params` + `skill.envMapping` 落地的 .env）。
- **proxy.json 可热加载**：workspace 里可以放 `proxy.json` 覆盖 manifest 的 proxy 配置；chokidar 监它，改完不用重启。

### 何时用

- 第三方 web SDK（draw.io、Mermaid、Google Charts）不允许通过相对路径加载——proxy 让它假装同源。
- 用户的 viewer 要 fetch 一个有 CORS 限制的外部 API——proxy 解 CORS。
- Image / video CDN 在浏览器跨域时被屏蔽——proxy 当转发器。

---

## npm + 浏览器 JIT（Babel/standalone）

如果你的 mode 需要让 user 编辑的 .tsx 文件直接在 viewer 里 render（remotion / gridboard），用 `@babel/standalone`：

1. viewer 订阅 `Source<ViewerFileContent[]>`，watch `src/**/*.tsx`
2. 每次文件变化（debounce）→ 跑 Babel transform → `eval` 出 component → mount 进 React tree
3. 编译错误 → error boundary 显示，不影响 viewer 主结构

### 注意

- `viewer.refreshStrategy: "manual"` 才能控制 viewer 不要在每次文件变化时立即重渲染——你需要 debounce + 一次性整体重编译。
- **不要在每次 file change 都 recompile**——agent streaming Edit 时文件每秒多次写，每次都编译会卡死浏览器。debounce 800-1500ms 是常见值。
- Error boundary 不能让 viewer 整体 crash——保留上一个合法编译版本，错误显示在角落。

### GridBoard JSX tag limitation（已知坑）

`@babel/standalone` + `eval` 无法把"本地定义的 React component"当 JSX tag 解析。这是 Babel 在 eval 上下文的限制：

```tsx
// ❌ 不工作
function Card() { return <div>...</div>; }
return <Card />;

// ✓ 工作
return renderCard();
```

这条已经写在 `CLAUDE.md::Known Gotchas`。如果你的新 mode 也走 Babel/standalone，把这条复制到 mode 的 SKILL.md `## Core rules` 章节。

---

## API Key 与凭据

### 收集 — `init.params` + `sensitive: true`

```ts
init: {
  params: [
    {
      name: "openrouterApiKey",
      label: "OpenRouter API Key",
      description: "Used for image generation. Stored locally, never sent to Pneuma.",
      type: "string",
      defaultValue: "",
      sensitive: true,   // ← 关键
    },
  ],
}
```

`sensitive: true` 让框架在 snapshot 打包时擦掉这个值——不会被分享出去。

### 落地为 env 变量 — `skill.envMapping`

```ts
skill: {
  ...
  envMapping: {
    "OPENROUTER_API_KEY": "openrouterApiKey",
  },
}
```

skill-installer 启动时把 user 填的 `openrouterApiKey` 值写到 `<sessionDir>/.env` 的 `OPENROUTER_API_KEY=...`——agent 写的脚本与 mcpServers 都能读。

### 派生功能旗标 — `deriveParams`

通常你想根据"key 是否已配"开关 mode 内某些功能：

```ts
init: {
  params: [/* ... */],
  deriveParams(params) {
    return {
      imageGenEnabled: params.openrouterApiKey ? "true" : "false",
    };
  },
}
```

`imageGenEnabled` 之后可以在 seed 模板里 `{{imageGenEnabled}}`，或者通过 instructions 让 agent 知道这个功能可不可用。

---

## MCP Servers

如果你的 mode 需要专门的工具链（不是普通 npm script），用 `skill.mcpServers` 在 .mcp.json 自动注册：

```ts
skill: {
  mcpServers: [
    {
      name: "ffmpeg-helpers",
      command: "node",
      args: ["{{SKILL_PATH}}/scripts/ffmpeg-mcp.js"],
      env: {
        FFMPEG_PATH: "${PATH}",
      },
    },
  ],
}
```

`{{SKILL_PATH}}` 是 skill-installer 替换的特殊变量，指向 `<sessionDir>/.claude/skills/pneuma-<name>/`。

### 何时用 MCP，何时用 sharedScripts

- **Pure helper script（generate_image, edit_image）** → `skill.sharedScripts`（共享源 `modes/_shared/scripts/`，装到 `<SKILL_PATH>/scripts/`）。Agent 调 `node <SKILL_PATH>/scripts/foo.mjs` 直接 invoke。
- **Stateful / multi-turn tool 协议** → MCP Server。例如需要维护 connection 池、长时运行的 process、跨调用的 cache。

大多数情况 sharedScripts 已经够用——只在你真的需要 MCP 的 RPC 协议时才上 MCP。

---

## NOTICE.md — 借鉴他人内容时的合规

### 必标 vs 不必标

**必标（NOTICE.md）：**
- 直接转录的内容（命令文档、UI 范例、设计 token 列表、字体子集）
- License 节选（Apache 2.0、MIT、BSD）
- 命名映射（upstream 的 X = pneuma 的 Y）
- 字体许可（特别商用限制）

**不必标（架构借鉴）：**
- 产品架构思想（"纸张画布" 概念、"live preview" 交互范式）
- 美学方向（warm parchment 调性、serif 优先排版）
- 工作流哲学（discovery → brief → implementation）
- Seed 示例的精神（只要内容本身不抄原作具体案例）

### NOTICE.md 标准结构

```markdown
# NOTICE

## Upstream

- **Name**: <Project / Tool name>
- **URL**: <https://...>
- **License**: <Apache 2.0 / MIT / BSD-3-Clause / ...>
- **Version pinned**: <upstream version or commit hash>
- **Synced at**: <YYYY-MM-DD>

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `skill/references/cmd-shape.md` | `commands/shape.md` (Impeccable v3.1.1) | Adapted: AskUserQuestion → free-form chat |
| `skill/references/typography.md` | `references/typography.md` | Direct copy with credit |
| ... | ... | ... |

## What we adapted

- 上游的 CLI verb-arg routing → pneuma 的 toolbar command + agent dispatch
- 上游的 standalone runtime → pneuma 的 iframe player + Source<T>
- ...

## What we dropped

- 上游的 build pipeline（与 pneuma 的 chokidar + WS 不兼容）
- 上游的独立 license server（不适用）
- ...

## License excerpts

<Apache 2.0 / MIT 全文节选，按 upstream 要求>
```

### 上游版本号是"版本之门"

`Version pinned` 这个字段最重要——它锁定了"我借鉴时上游的哪个版本"。未来上游更新时，可以对照 diff 决定是否同步 pneuma 这边的副本。webcraft NOTICE.md 用的就是这个模式（Impeccable v3.1.1 pinned）。

### inspiredBy 字段

`manifest.inspiredBy` 是**非合规性质**的标注——它告诉 launcher gallery / mode marketplace 这个 mode 是受谁启发的：

```ts
inspiredBy: {
  name: "tw93/kami",
  url: "https://github.com/tw93/kami",
}
```

可以与 NOTICE.md 并存（borrowing + 灵感），也可以单独存在（仅灵感借鉴）。**它不是 license 替代品**——直接转录内容仍需 NOTICE.md。

---

## 反模式

- ❌ **直接 `<script src="https://external-cdn.com/...">` 跳过 proxy**：CORS 不会过，且 user 的 mode-maker Play 环境隔离时这种硬编码会断。
- ❌ **API key 明文写在 seed 文件**：用户 share workspace 时会泄露；走 `init.params` + `sensitive: true`。
- ❌ **借了 commands 不写 NOTICE**：license 不允许就侵权；即使 license 允许，也违反学术诚信。
- ❌ **NOTICE.md 写一句话**："Based on X."——没用。必须有 version pinned + 借鉴/适配/舍弃三段表。
- ❌ **每个 file change 都 recompile**：浏览器卡死。debounce + error boundary 是 JIT 编译的必备配置。
