# ADR-011: Slide Mode MVP 详细设计

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-004, ADR-005, ADR-006

---

## 1. 背景

Slide Mode 是 Pneuma 的 MVP Content Mode — 让 Code Agent 生成和编辑演示文稿。

核心体验：
1. 用户输入 "做一个关于 AI Agent 趋势的 PPT，10 页，暗色主题"
2. Claude Code 使用 Slide Skill 中的模板和最佳实践
3. 生成 HTML slide 文件 → 实时预览
4. 用户选中元素 + 输入修改指令 → 迭代优化

---

## 2. 决策

### 2.1 每页 Slide 一个独立 HTML 文件

**而非单文件多 section（如 reveal.js）或 Markdown（如 Slidev）。**

理由：
- Agent 修改单个 slide 时不影响其他 slide
- File watcher 精确知道哪一页变了
- Agent 只需 focus 在一个小文件上，减少 token 消耗
- 文件名约定清晰：`slides/slide-01.html`, `slides/slide-02.html`

### 2.2 CSS 主题系统

**共享 `theme.css` + 每页可覆盖。**

### 2.3 iframe 隔离渲染

**Slide 内容在 iframe 中渲染，与 Editor Shell 样式隔离。**

---

## 3. 详细设计

### 3.1 Slide 文件格式

#### 单页 HTML 结构

```html
<!-- slides/slide-01.html -->
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="../theme.css">
  <style>
    /* 页面级样式覆盖 (可选) */
  </style>
</head>
<body>
  <div class="slide">
    <h1>AI Agent 发展趋势</h1>
    <p class="subtitle">2026 年展望</p>
    <div class="author">Pandazki</div>
  </div>
</body>
</html>
```

**关键约定：**
- 每页一个完整的 HTML 文件（不是 fragment）
- 必须引用 `../theme.css`
- 内容包裹在 `<div class="slide">` 中
- 可以有 `<style>` 块做页面级覆盖
- 可以引用 `../assets/` 中的资源

#### manifest.json

```json
{
  "title": "AI Agent 发展趋势",
  "mode": "slide",
  "theme": "minimal-dark",
  "created_at": "2026-02-26T10:00:00Z",
  "slides": [
    {
      "file": "slides/slide-01.html",
      "title": "封面",
      "notes": "",
      "layout": "title"
    },
    {
      "file": "slides/slide-02.html",
      "title": "背景与趋势",
      "notes": "介绍 AI Agent 的发展背景",
      "layout": "content"
    },
    {
      "file": "slides/slide-03.html",
      "title": "技术方案",
      "notes": "",
      "layout": "two-column"
    }
  ]
}
```

#### theme.css 示例

```css
/* theme.css - minimal-dark */
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #eee;
  --text-secondary: #a0a0b0;
  --accent: #0f3460;
  --accent-light: #e94560;
  --font-heading: 'Inter', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  overflow: hidden;
}

.slide {
  width: 100vw;
  height: 100vh;
  padding: 60px 80px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

h1 {
  font-family: var(--font-heading);
  font-size: 3rem;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 0.5em;
}

h2 {
  font-family: var(--font-heading);
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 0.5em;
}

h3 {
  font-size: 1.5rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.5em;
}

p, li {
  font-size: 1.25rem;
  line-height: 1.6;
  color: var(--text-secondary);
}

.subtitle {
  font-size: 1.5rem;
  color: var(--accent-light);
}

code {
  font-family: var(--font-mono);
  background: var(--bg-secondary);
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
}

pre {
  background: var(--bg-secondary);
  padding: 1.5em;
  border-radius: 8px;
  overflow-x: auto;
}

img {
  max-width: 100%;
  border-radius: 8px;
}

/* Grid/Flexbox 布局辅助 */
.two-column {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: start;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* 图表容器 */
.chart {
  width: 100%;
  max-height: 400px;
}
```

### 3.2 Slide Navigator 组件

```typescript
// modes/slide/components/SlideNavigator.tsx

interface SlideNavigatorProps extends NavigatorProps {}

export function SlideNavigator({
  structure,
  activeItem,
  onNavigate,
  onAdd,
}: SlideNavigatorProps) {
  if (!structure) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No slides yet. Send a message to create one.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Slides ({structure.items.length})
        </h3>
      </div>

      {/* Slide 列表 */}
      <div className="flex-1 overflow-y-auto">
        {structure.items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full px-3 py-2 text-left text-sm transition-colors
              ${activeItem === item.id
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-5 text-right">
                {index + 1}.
              </span>
              <span className="truncate">{item.title}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 添加按钮 */}
      {onAdd && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-2">
          <button
            onClick={onAdd}
            className="w-full px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700
                       dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800
                       rounded transition-colors"
          >
            + New Slide
          </button>
        </div>
      )}
    </div>
  );
}
```

### 3.3 Slide Preview 组件

```typescript
// modes/slide/components/SlidePreview.tsx

export function SlidePreview({
  contentBaseUrl,
  activeItem,
  selectedElement,
  onElementSelect,
  contentVersion,
}: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 构造 iframe src
  const src = useMemo(() => {
    if (!activeItem) return "";
    // slide-01 → slides/slide-01.html
    const file = `slides/${activeItem}.html`;
    return `${contentBaseUrl}/${file}?v=${contentVersion}&_selector=1`;
  }, [contentBaseUrl, activeItem, contentVersion]);

  // 监听 iframe 中的元素选中事件
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "pneuma:element_selected") {
        onElementSelect(event.data.element);
      } else if (event.data?.type === "pneuma:element_deselected") {
        onElementSelect(null);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onElementSelect]);

  // 空状态
  if (!activeItem) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-4">📊</div>
          <div className="text-lg">No slides yet</div>
          <div className="text-sm mt-2">
            Tell the agent what presentation you'd like to create
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-6">
      {/* Slide 预览容器 (16:9 比例) */}
      <div className="w-full max-w-5xl aspect-[16/9] bg-white dark:bg-gray-800
                      rounded-xl shadow-2xl overflow-hidden relative">
        <iframe
          ref={iframeRef}
          src={src}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={`Slide: ${activeItem}`}
        />

        {/* 选中状态指示器 */}
        {selectedElement && (
          <div className="absolute bottom-2 left-2 right-2 bg-black/70 text-white
                          text-xs px-3 py-1.5 rounded-md backdrop-blur">
            Selected: &lt;{selectedElement.tagName}&gt;
            {selectedElement.textContent && ` "${selectedElement.textContent.slice(0, 60)}..."`}
          </div>
        )}
      </div>

      {/* 页面导航 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
        <button className="rounded-full p-2 bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600">
          ←
        </button>
        <span className="text-sm text-gray-500">
          {activeItem.replace("slide-", "")}
        </span>
        <button className="rounded-full p-2 bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600">
          →
        </button>
      </div>
    </div>
  );
}
```

### 3.4 元素选中脚本注入

由于 slide HTML 是通过 HTTP serve 的，需要在 serve 时注入选中脚本：

```typescript
// core/server/static-server.ts (增强)

// 对 slide HTML 文件注入选中脚本
app.get("/content/slides/*.html", async (c) => {
  const filePath = c.req.path.replace("/content/", "");
  const fullPath = join(workspace, filePath);

  try {
    let html = await Bun.file(fullPath).text();

    // 注入选中脚本 (在 </body> 前)
    if (c.req.query("_selector") === "1") {
      html = html.replace(
        "</body>",
        `${SELECTOR_SCRIPT}\n</body>`
      );
    }

    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(html);
  } catch {
    return c.notFound();
  }
});
```

### 3.5 Slide Mode SKILL.md

```markdown
# Pneuma Slide Skill

## 你的角色
你是一个专业的 PPT 设计师和 HTML/CSS 开发者。用户通过 Pneuma 可视化编辑器与你交互。

## 用户上下文
用户消息可能包含 `[Context: ...]` 前缀，提供当前编辑状态：
- `[Context: slide, view: slide:3]` — 用户正在查看第 3 页
- `[Context: slide, view: slide:3, selected: h1.title "技术方案"]` — 用户选中了第 3 页的标题

请结合上下文理解修改意图。例如：
- `[Context: slide, view: slide:3, selected: h1 "技术方案"] 改大一点` → 修改 slides/slide-03.html 中的 h1 字号
- `[Context: slide, view: slide:5] 加一个图表` → 在 slides/slide-05.html 中添加图表

## 文件约定

### 目录结构
```
workspace/
├── manifest.json           # slide 元数据 (必须保持同步)
├── slides/
│   ├── slide-01.html       # 每页一个独立 HTML
│   ├── slide-02.html
│   └── ...
├── assets/                 # 图片/资源
├── theme.css               # 主题样式
└── index.html              # 演示模式入口
```

### manifest.json 格式
```json
{
  "title": "演示文稿标题",
  "mode": "slide",
  "theme": "minimal-dark",
  "slides": [
    { "file": "slides/slide-01.html", "title": "页面标题", "notes": "", "layout": "title" }
  ]
}
```

**重要**: 添加/删除/重排 slide 后，必须同步更新 manifest.json！

### 单页 HTML 格式
- 每页是完整的 HTML 文件 (DOCTYPE + html + head + body)
- head 中必须引用 `<link rel="stylesheet" href="../theme.css">`
- 内容包裹在 `<div class="slide">` 中
- 可以用 `<style>` 块做页面级样式覆盖
- 资源引用相对路径: `../assets/image.png`

## 设计原则

1. **一页一主题** — 每页 slide 聚焦一个核心信息
2. **留白充分** — padding 至少 60px 80px，不要塞满内容
3. **字号层次** — h1: 3rem, h2: 2rem, h3: 1.5rem, body: 1.25rem
4. **CSS Grid/Flexbox** — 所有布局用现代 CSS，不用 absolute positioning
5. **SVG 优先** — 图表和图标优先使用内联 SVG
6. **响应式** — 使用 vw/vh 相对单位，确保不同屏幕尺寸下正常显示

## 模板参考
- 可用主题: 本 skill 的 `templates/themes/` 目录
- 可用布局: 本 skill 的 `templates/layouts/` 目录
- 详细代码生成指南: `references/slide-codegen-guide.md`
- 设计原则详解: `references/design-principles.md`

## 工作流程

### 创建新演示
1. 创建 manifest.json (标题、主题)
2. 创建 theme.css (使用模板主题或自定义)
3. 逐页创建 slides/slide-XX.html
4. 同步更新 manifest.json 的 slides 数组
5. 创建 index.html (演示模式入口)

### 修改已有页面
1. 读取 manifest.json 确认目标文件
2. 读取对应的 slide-XX.html
3. 修改内容/样式
4. 如果标题变了，同步更新 manifest.json

### 添加新页面
1. 创建 slides/slide-XX.html (编号递增)
2. 在 manifest.json 的 slides 数组中添加条目
3. 调整已有页面编号 (如果需要插入中间)
```

### 3.6 index.html (演示模式入口)

```html
<!-- 演示模式: 全屏 iframe 切换 -->
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #000; overflow: hidden; }
    iframe {
      width: 100vw;
      height: 100vh;
      border: 0;
    }
    .controls {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 12px;
      opacity: 0;
      transition: opacity 0.3s;
    }
    body:hover .controls { opacity: 1; }
    .controls button {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: rgba(255,255,255,0.2);
      color: white;
      cursor: pointer;
    }
    .controls button:hover { background: rgba(255,255,255,0.3); }
    .slide-number {
      color: rgba(255,255,255,0.5);
      font-size: 14px;
      line-height: 36px;
    }
  </style>
</head>
<body>
  <iframe id="slide-frame"></iframe>
  <div class="controls">
    <button onclick="prev()">← Prev</button>
    <span class="slide-number" id="slide-num"></span>
    <button onclick="next()">Next →</button>
  </div>
  <script>
    let slides = [];
    let current = 0;

    async function init() {
      const res = await fetch('/content/manifest.json');
      const manifest = await res.json();
      slides = manifest.slides.map(s => '/content/' + s.file);
      show(0);
    }

    function show(index) {
      current = Math.max(0, Math.min(index, slides.length - 1));
      document.getElementById('slide-frame').src = slides[current];
      document.getElementById('slide-num').textContent =
        `${current + 1} / ${slides.length}`;
    }

    function prev() { show(current - 1); }
    function next() { show(current + 1); }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') next();
      if (e.key === 'Escape') window.close();
    });

    init();
  </script>
</body>
</html>
```

### 3.7 Slide Mode 初始化

当 workspace 为空时，创建最小初始文件：

```typescript
// modes/slide/index.ts

async initialize(workspace: string) {
  const manifestPath = join(workspace, "manifest.json");

  // 如果 manifest 已存在，跳过初始化
  if (existsSync(manifestPath)) return;

  // 创建目录
  mkdirSync(join(workspace, "slides"), { recursive: true });
  mkdirSync(join(workspace, "assets"), { recursive: true });

  // 创建空 manifest
  const manifest = {
    title: "Untitled Presentation",
    mode: "slide",
    theme: "minimal-dark",
    created_at: new Date().toISOString(),
    slides: [],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // 复制默认主题
  const defaultTheme = join(workspace, ".claude/skills/pneuma-slide/templates/themes/minimal-dark.css");
  if (existsSync(defaultTheme)) {
    copyFileSync(defaultTheme, join(workspace, "theme.css"));
  }

  // 创建 index.html (演示模式入口)
  // ... (写入上面 3.6 中的 HTML)

  console.log(`[slide-mode] Initialized empty workspace: ${workspace}`);
},
```

### 3.8 完整编辑闭环时序

```
用户: "做一个关于 AI Agent 的 PPT，5 页，暗色主题"

1. Editor Shell 构造消息:
   content: "[Context: slide, view: slide:1]\n做一个关于 AI Agent 的 PPT，5 页，暗色主题"

2. Server 转发给 CLI (NDJSON)

3. Claude Code 读取 SKILL.md + manifest.json
   → 知道这是 Pneuma Slide 环境
   → 知道文件约定和设计原则

4. Claude Code 执行:
   a. 更新 manifest.json (5 页配置)
   b. 创建 slides/slide-01.html ~ slide-05.html
   c. 更新 theme.css (暗色主题)
   d. 创建 index.html

5. 每次文件写入 → File Watcher 检测 → content_update → 浏览器

6. 浏览器:
   a. 收到 content_update → incrementContentVersion
   b. iframe src 更新 → 重新加载当前 slide
   c. manifest 变更 → 更新 Navigator 列表

7. Claude Code 完成 → result 消息 → status: idle

用户看到: Navigator 出现 5 个 slide，预览显示第 1 页

用户: 选中第 3 页标题，输入 "字号再大一点，颜色改成渐变"

8. Editor Shell 构造消息:
   "[Context: slide, view: slide:3, selected: h1.title "技术方案"]
    字号再大一点，颜色改成渐变"

9. Claude Code 读取 slides/slide-03.html → 修改 h1 样式
10. File Watcher → content_update → iframe 重载 → 用户看到更新
```

---

## 4. 关键设计决策

### 4.1 独立 HTML vs Fragment

**每页是完整 HTML 文件，不是 HTML fragment。**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **完整 HTML** | 可独立预览；iframe 直接加载；样式隔离 | 文件稍大；theme.css 引用重复 |
| Fragment | 文件更小 | 需要 wrapper 组装；预览需要额外处理；Agent 编辑更复杂 |

### 4.2 16:9 固定比例

**Slide 预览固定 16:9 比例。**

这是演示文稿的标准比例。CSS 使用 `vw/vh` 单位，在 iframe 中按比例缩放。

### 4.3 选中脚本 serve 时注入

**通过 HTTP 中间件注入选中脚本，而非修改用户的 HTML 文件。**

理由：
- 不污染用户的 slide 源文件
- 注入只在预览模式下生效
- 演示模式（index.html）不注入选中脚本

### 4.4 theme.css 作为独立文件

**主题是独立 CSS 文件，所有 slide 引用同一个 theme.css。**

理由：
- 统一主题切换 — 换一个文件即可
- Agent 可以全局修改主题而不触碰每一页
- 页面级覆盖通过 `<style>` 块实现

---

## 5. 被否决的方案

### 5.1 Markdown 格式 (Slidev 风格)

```markdown
---
theme: minimal-dark
---

# 封面

---

# 第二页
```

- 否决原因：Markdown 对布局控制力有限；复杂 slide（图表、多栏、自定义动画）难以表达
- HTML 给 Agent 完全的控制力

### 5.2 reveal.js 集成

- 否决原因：增加运行时依赖；Agent 需要理解 reveal.js API；不够灵活
- 未来可以作为 export 目标

### 5.3 PPTX 直接生成

- 否决原因：PPTX 是二进制格式，Agent 无法直接编辑；无法实时预览
- 可以作为 export 功能

---

## 6. 影响

1. **Slide Skill 质量是核心** — SKILL.md + 模板 + 参考文档直接决定 PPT 质量
2. **HTML slide 不是标准格式** — 需要提供 export 到 PDF/PPTX 的能力 (Phase 2)
3. **iframe 选中体验取决于注入脚本** — 需要仔细测试各种 HTML 结构
4. **Agent token 消耗** — 每页独立文件减少了单次编辑的 token 量，但整体生成仍需要多次文件操作
