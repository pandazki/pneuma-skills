---
paths:
  - "src/**"
  - "modes/*/viewer/**"
  - "index.html"
  - "player.html"
---

# Frontend Rules (React / Vite / viewers)

## Baseline

- **Zustand** sliced store (`src/store/`, 10 protocol-aligned slices); mode viewers live in `modes/<mode>/viewer/`.
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`). New UI must use the tokens, not ad-hoc colors.
- **Visual verification is mandatory**: after modifying viewer components, CSS, or any UI-facing code, use `chrome-devtools-mcp` to screenshot the running dev server and verify before reporting completion. Do not judge visual correctness by reading code alone.
- **No emoji in UI elements** — use SVG icons or text labels.

## Gotchas

- **react-resizable-panels v4.6**:`Group` 不是 `PanelGroup`,`Separator` 不是 `PanelResizeHandle`,`orientation` 不是 `direction`。
- **`line-clamp` 需要 `display: -webkit-box`**,Tailwind `block` 在源码顺序中会覆盖:`block` 配 `line-clamp-N` 会静默失效。删掉 `block`;line-clamp 自带 display 规则。
- **React key collision for same-named modes**:一个 builtin(`slide`)evolve 出的 local mode 通常仍 `name: "slide"`。任何 builtin + local 混排的列表把 key 组合成 `${source}::${path || name}`,不要用裸 `mode.name`。
- **`backdrop-filter` containing block**:会为 fixed-position 子元素创建 containing block,在 Excalidraw 里造成坐标偏移。避开或显式处理。
- **`@zumer/snapdom`**:调用期间 capture iframe 必须 `display: none`——可见 iframe 会导致 foreignObject 文本 reflow。见 `useSlideThumbnails.ts` 和 `export.ts`。
- **snapdom 必须在目标元素自己的 window 里跑**:用外层 window 的 snapdom 去栅格化*同源 iframe 内部*的元素时,iframe 文档里的 CSS 变量、`@font-face`、SVG 画笔服务器都解析不到。用 `src/utils/iframe-snapdom.ts::snapdomFor()`(往同源 iframe 注 `/vendor/snapdom.js`)。捕获主文档元素的(GridBoard、`useThumbnailCapture`)外层 snapdom 本就正确,不要改。
- **Session thumbnail capture**(`src/hooks/useThumbnailCapture.ts`):优先级 viewer `captureViewport()` → Electron `pneumaDesktop.capturePage(rect)`(唯一能看到 iframe 内容的路径)→ snapdom(仅 browser dev)。空 Electron capture 不用 snapdom 补——后者把 iframe 渲染成白矩形,比 mode-icon fallback 更糟。
- **GridBoard JSX tag limitation**:tile compiler(Babel + eval)不能把本地定义的 component 当 JSX tag 解析。用 `{renderMyComponent(...)}` 函数调用。
- **Empty assistant messages**:`MessageBubble` 在 content 为空时返回 null(纯 tool_use 消息)。
- **modelUsage cumulative**:用 delta(current - previous)算 per-turn cost。
- **TopBar drag region**:`TopBar` 根是 `WebkitAppRegion: "drag"`;三个 pill 子容器是 `no-drag`。launcher 复用 `BrowserWindow` 给 session,macOS Sequoia 的系统级 drag inset 会吃掉 TopBar pill 上沿点击。任何新加在 TopBar 根下的可点元素都要带 `no-drag`(或落在已有 `no-drag` 子容器里)。
- **Empty shell 没有 `modeViewer`**:`?project=<root>`(无 `session`、无 `mode`)→ `EmptyShell` mount `TopBar` 但无 session。任何新 TopBar feature 都要防 `modeViewer` 为 null。
- **`ViewerPreviewProps.files` is a deprecated compat shim**:新契约是 `sources` + `fileChannel`;`files` 只为 pre-2.29 外部 mode 保留。新 viewer 一律用 `useSource(sources.files)`。
- **Diagram viewer**:native events、SVG pointer-events、sketch injection、rough.js 加载顺序——见 `modes/diagram/viewer/DiagramPreview.tsx` 头部注释。
- **Gallery dismissal sources**:empty-state gallery 只在 (a) `userContentCount > 0` 或 (b) 用户点"或直接开始对话 →"时清除。**没有** click-outside-to-close——TopBar 点击、chat focus 都不得 dismiss。
