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
- **`backdrop-filter` 还会开一个 stacking context**(同一属性的第二个坑,2026-08-12 bansho transport 上实测):带 `backdrop-blur` 的容器里,子元素的 `z-*` 被**封死在容器内部**,压不过外面任何兄弟层——bansho 的 rate 菜单(transport bar 内 `z-20`)被 board 区里 `z-10` 的 WallMap 整个盖住。修法是给**那个带 backdrop-blur 的容器本身**在父级排序里赢(`relative z-30`),不是继续加子元素的 z。另一半:**CDP `Page.captureScreenshot` 对 backdrop-filter 的合成是错的**——截图里 95% 不透明的面板会显出底下内容,看着像透明度 bug 其实屏幕上没有。判断方法是临时 `style.backdropFilter='none'` 再截一张对比,别照着截图去调 opacity。
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
- **Focus ring 用 `ring`,别用 `outline`**:`src/index.css` 里有全局 `*:focus { outline: none }`,它是 un-layered CSS,按 cascade layer 规则**无条件压过** `@layer utilities` 里的任何 Tailwind outline utility(`focus-visible:outline-*` 写了也白写、静默不生效)。焦点样式一律走 box-shadow 系的 `focus-visible:ring-*`(见 bansho `Timeline.tsx` 的 track)。
- **Measured geometry 必须跟着"字体会变"的每一个输入失效**(bansho T8):viewer 里任何"量出来"的东西——ink overlay、back-reference anchor、对齐列宽——都是当前排版下的测量值。宽度变化有 ResizeObserver 兜底,**主题切换没有**:light/dark 的 `--hand` 是两套不同 face(Bradley Hand vs Chalkboard SE),字宽不同 → 文字重排、overlay 留在旧位置。而且 reconcile **看不见**它:字节没变、hash 全中、plan 是 no-op,所以只把 `theme` 加进 effect 依赖数组不管用——必须清缓存(`stateRef` / containers / label widths / itemByRef)再 tick 强制重建(`BoardCanvas.tsx::invalidateMeasurements`)。新的字体输入(seed `theme.css` 的 `--hand`、用户字号)照此办理。
- **一个 client rect 的中线不是"字的中线"——尤其在 CJK 板上**(bansho G8-M,2026-08-12 实测):`span.getBoundingClientRect()` 量到的是 **line box**,高度是 line-height,而它的中心落在 baseline 上方 `(ascent − descent) / 2` 处——那是**字体 ascent/descent 不对称**的产物(拉丁字体给重音和升部留的顶部空间),不是"写下来的东西"的中心。实测 34px / line-height 1.5 的手写栈:box 中心在 baseline 上方 14.5px,而一个汉字的墨迹中心只在上方 10.9px,**任何按 box 中心摆的覆盖物都高 3.6px**。拉丁看不出来:小写墨迹只有 0.53em,压在 1.02em 的高亮带下面怎么偏都盖得住;汉字墨迹 1.04em——跟带子一样高——误差就全部落在每个字的下缘,黄带读起来像"从字中间划过的条纹"。**修法是要到 baseline**,而 DOM 给不出:client rect 和 line box 共享中心(half-leading 对称),任何 rect 组合都分不开 ascent 与 descent;唯一便宜且与 DOM 逐像素吻合的来源是 canvas `measureText().fontBoundingBoxAscent/Descent`(实测预测 40.00 对 DOM strut 40.00),属 layout 家族、transform 免疫。见 `modes/bansho/engine/factories/type-metrics.ts`。**任何"盖住/穿过/围住文字"的测量几何都要按 baseline 摆位,不要按 box 中心**。
- **`mask-image` 的图片源受同源限制,跨源/`file://` 下静默画不出任何东西**(bansho 插图层,2026-08-13 实测):遮罩要读像素,所以浏览器按同源策略挡它——但失败形状是**完全没有输出**,而所有诊断都说一切正常:`getComputedStyle` 报 `mask-mode: luminance`、URL 解析正确、`CSS.supports('mask-mode','luminance')` 为 true、`new Image()` 也能把同一个文件加载到完整尺寸。**唯一能隔离它的对照是在同一个元素上换成 `linear-gradient` 遮罩**——渐变照常生效,图片不生效,才知道问题在源不在语法。产品路径是同源 HTTP 提供资产,所以只有本地测试页会踩(写在 `file://` 上的验证页会让你以为整个方案不成立)。
- **SVG presentation attribute 不解析 `var()`**(bansho G8-D):`el.setAttribute("stroke", "var(--s1)")` **静默失效**——颜色直接丢、不报错;且 CSS 规则优先级高于 presentation attribute(`.chart text { fill }` 会盖掉 attribute 上的 `fill`)。token 颜色一律走 `element.style`(inline style 才盖得住)。bansho 的 `engine/factories/svg.ts::el()` 对 attrs 里的 fill/stroke/color/opacity 直接 throw,把这条规则做成了结构性约束——新 SVG 代码照抄这个模式。
