# ADR-004: Content Mode 插件系统

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-006, ADR-011

---

## 1. 背景

Content Mode 是 Pneuma 的核心可插拔维度之一，定义了"编辑什么"：

| Mode | 内容类型 | 编辑器特征 | MVP |
|------|----------|-----------|-----|
| **Slide** | 演示文稿 | 大纲 + 单页预览 + 页面导航 | Yes |
| Doc | 长文档 | 连续滚动 + 段落级选中 | 后续 |
| Mindmap | 思维导图 | 节点树 + 节点选中 | 后续 |
| Canvas | 自由画布 | 无限画布 + 元素选中 | 后续 |

每个 Mode 需要提供：
1. **UI 组件** — Navigator（导航）、Preview（预览）、Selector（选中）
2. **Skill 包** — 给 Code Agent 的领域 prompt + 模板 + 参考文档
3. **文件约定** — 内容的文件组织方式

---

## 2. 决策

### 2.1 MVP 阶段：硬编码 + 接口预留

**先 hardcode Slide Mode 跑通闭环，但以 `ContentMode` 接口定义边界。**

- Phase 1 (MVP)：直接 import SlideMode，不搞运行时插件注册
- Phase 2：基于 MVP 经验，正式化插件注册机制

理由：
- 避免过度抽象导致 MVP 延期（draft 中的风险 5.2）
- 接口定义作为设计约束，确保 mode 之间不耦合
- Phase 2 开发第二个 mode 时，自然会验证接口抽象是否合理

### 2.2 Mode 目录结构约定

每个 Mode 遵循统一的目录结构，自包含所有资源。

---

## 3. 详细设计

### 3.1 ContentMode 接口定义

```typescript
// core/types/content-mode.ts

import type { ComponentType } from "react";

/** Content Mode 完整定义 */
interface ContentMode {
  /** Mode 唯一标识 */
  name: string;                       // "slide" | "doc" | "mindmap" | "canvas"

  /** 人类可读的显示名 */
  displayName: string;                // "Slide" | "Document" | "Mindmap" | "Canvas"

  // ===== UI 组件 =====

  /** 左侧导航/大纲组件 */
  NavigatorComponent: ComponentType<NavigatorProps>;

  /** 右侧内容预览组件 */
  PreviewComponent: ComponentType<PreviewProps>;

  /** 元素选中行为策略 */
  selectorConfig: SelectorConfig;

  // ===== 文件约定 =====

  /** 内容文件组织约定 */
  fileConvention: FileConvention;

  // ===== Skill 配置 =====

  /** Skill 包位置与安装配置 */
  skill: SkillConfig;

  // ===== 上下文提取 =====

  /** 从编辑器状态中提取 UI 上下文 (注入到用户消息中) */
  extractUIContext(state: ModeState): UIContext;

  /** 从 manifest 中提取内容结构 (供 Navigator 使用) */
  parseManifest(content: string): ContentStructure;

  // ===== 初始化 =====

  /** Mode 启动时的初始化逻辑 (如创建默认文件) */
  initialize?(workspace: string): Promise<void>;
}
```

### 3.2 UI 组件接口

```typescript
/** Navigator 组件 Props */
interface NavigatorProps {
  /** 内容结构 (从 manifest 解析) */
  structure: ContentStructure;
  /** 当前活跃项 */
  activeItem: string;
  /** 用户选择导航项 */
  onNavigate: (itemId: string) => void;
  /** 用户请求添加新内容 */
  onAdd?: () => void;
  /** 用户请求删除内容 */
  onDelete?: (itemId: string) => void;
  /** 用户拖拽重排序 */
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

/** Preview 组件 Props */
interface PreviewProps {
  /** 内容文件的 base URL (iframe src 基础路径) */
  contentBaseUrl: string;
  /** 当前预览的内容项 */
  activeItem: string;
  /** 选中的元素信息 */
  selectedElement: SelectedElement | null;
  /** 元素被选中时的回调 */
  onElementSelect: (element: SelectedElement | null) => void;
  /** 内容更新信号 (触发 iframe reload) */
  contentVersion: number;
}

/** 选中的元素 */
interface SelectedElement {
  /** CSS 选择器路径 */
  selector: string;
  /** 标签名 */
  tagName: string;
  /** 文本内容 (截断) */
  textContent: string;
  /** 元素属性 */
  attributes?: Record<string, string>;
  /** Mode-specific 扩展数据 */
  metadata?: Record<string, unknown>;
}
```

### 3.3 元素选中策略

```typescript
/** 元素选中配置 */
interface SelectorConfig {
  /** 选中粒度: 哪些元素可以被选中 */
  selectableSelector: string;         // CSS selector, e.g. "h1, h2, h3, p, img, .chart, ul, ol, table"

  /** 高亮样式 */
  highlightStyle: {
    outline: string;                  // e.g. "2px solid #3b82f6"
    outlineOffset: string;            // e.g. "2px"
    backgroundColor?: string;         // e.g. "rgba(59, 130, 246, 0.05)"
  };

  /** Hover 样式 */
  hoverStyle: {
    outline: string;
    outlineOffset: string;
    backgroundColor?: string;
  };

  /** 是否允许多选 */
  multiSelect: boolean;               // MVP: false

  /** 是否在 iframe 内工作 (需要 postMessage 通信) */
  insideIframe: boolean;              // Slide Mode: true
}
```

### 3.4 文件约定

```typescript
/** 内容文件组织约定 */
interface FileConvention {
  /** Manifest 文件路径 (相对于 workspace) */
  manifestFile: string;               // e.g. "manifest.json"

  /** 内容文件目录 */
  contentDir: string;                 // e.g. "slides/"

  /** 资产文件目录 */
  assetDir: string;                   // e.g. "assets/"

  /** 入口文件 (演示/预览用) */
  entryFile?: string;                 // e.g. "index.html"

  /** 主题文件 */
  themeFile?: string;                 // e.g. "theme.css"

  /** 文件监听 glob patterns */
  watchPatterns: string[];            // e.g. ["slides/**", "manifest.json", "theme.css", "assets/**"]

  /** 忽略 patterns */
  ignorePatterns?: string[];          // e.g. ["node_modules/**", ".claude/**"]
}
```

### 3.5 Skill 配置

```typescript
/** Skill 安装配置 */
interface SkillConfig {
  /** Skill 源文件目录 (框架内，相对于 modes/XXX/) */
  sourceDir: string;                  // "skill/"

  /** 安装到 workspace 的目标目录 */
  installDir: string;                 // ".claude/skills/pneuma-slide"

  /** 注入 CLAUDE.md 的内容片段 */
  claudeMdSnippet: string;

  /** Skill 版本号 (用于升级检测) */
  version: string;                    // "0.1.0"
}
```

### 3.6 内容结构

```typescript
/** 通用内容结构 (供 Navigator 使用) */
interface ContentStructure {
  /** Mode 标识 */
  mode: string;

  /** 内容标题 */
  title: string;

  /** 内容主题 */
  theme?: string;

  /** 内容项列表 */
  items: ContentItem[];
}

/** 内容项 */
interface ContentItem {
  /** 项 ID (唯一) */
  id: string;
  /** 显示标题 */
  title: string;
  /** 文件路径 (相对于 workspace) */
  file: string;
  /** 排序索引 */
  order: number;
  /** 子项 (如 mindmap 的子节点) */
  children?: ContentItem[];
  /** Mode-specific 元数据 */
  metadata?: Record<string, unknown>;
}
```

### 3.7 Slide Mode 实现示例

```typescript
// modes/slide/index.ts

import type { ContentMode } from "../../core/types/content-mode";
import { SlideNavigator } from "./components/SlideNavigator";
import { SlidePreview } from "./components/SlidePreview";

export const slideMode: ContentMode = {
  name: "slide",
  displayName: "Slide",

  NavigatorComponent: SlideNavigator,
  PreviewComponent: SlidePreview,

  selectorConfig: {
    selectableSelector: "h1, h2, h3, h4, p, img, svg, .chart, ul, ol, table, blockquote, figure",
    highlightStyle: {
      outline: "2px solid #3b82f6",
      outlineOffset: "2px",
      backgroundColor: "rgba(59, 130, 246, 0.05)",
    },
    hoverStyle: {
      outline: "1px dashed #93c5fd",
      outlineOffset: "2px",
    },
    multiSelect: false,
    insideIframe: true,
  },

  fileConvention: {
    manifestFile: "manifest.json",
    contentDir: "slides/",
    assetDir: "assets/",
    entryFile: "index.html",
    themeFile: "theme.css",
    watchPatterns: [
      "slides/**/*.html",
      "manifest.json",
      "theme.css",
      "assets/**",
      "index.html",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".claude/**",
      ".git/**",
    ],
  },

  skill: {
    sourceDir: "skill/",
    installDir: ".claude/skills/pneuma-slide",
    version: "0.1.0",
    claudeMdSnippet: `## Pneuma Slide Mode

你正在一个 Pneuma Slide 编辑环境中工作。
用户通过可视化编辑器与你交互，消息中可能包含 [Context: ...] 前缀，
表示用户当前查看的页面和选中的元素。

详细的 slide 生成规范和模板请参考 skill:
.claude/skills/pneuma-slide/SKILL.md

### 关键约定
- 每页 slide 一个独立 HTML 文件: slides/slide-XX.html
- 主题样式: theme.css
- 元数据: manifest.json (修改 slide 后必须同步更新)
- 模板目录: .claude/skills/pneuma-slide/templates/`,
  },

  extractUIContext(state) {
    const ctx: UIContext = {
      mode: "slide",
      currentView: `slide:${state.activeSlideIndex + 1}`,
    };

    if (state.selectedElement) {
      ctx.selectedElement = state.selectedElement;
    }

    return ctx;
  },

  parseManifest(content: string): ContentStructure {
    const manifest = JSON.parse(content);
    return {
      mode: "slide",
      title: manifest.title || "Untitled",
      theme: manifest.theme,
      items: (manifest.slides || []).map((slide: any, i: number) => ({
        id: `slide-${String(i + 1).padStart(2, "0")}`,
        title: slide.title || `Slide ${i + 1}`,
        file: slide.file,
        order: i,
        metadata: { notes: slide.notes },
      })),
    };
  },

  async initialize(workspace: string) {
    // 如果 workspace 为空，创建初始文件
    // (具体实现见 ADR-011 Slide Mode MVP)
  },
};
```

### 3.8 Mode Registry (MVP 简化版)

```typescript
// core/mode-registry.ts

import { slideMode } from "../modes/slide";
import type { ContentMode } from "./types/content-mode";

/** MVP: 静态注册，直接 import */
const modes: Record<string, ContentMode> = {
  slide: slideMode,
  // doc: docMode,      // Phase 3
  // mindmap: mindmapMode, // Phase 3
};

export function getMode(name: string): ContentMode {
  const mode = modes[name];
  if (!mode) {
    throw new Error(
      `Unknown content mode: "${name}". Available: ${Object.keys(modes).join(", ")}`
    );
  }
  return mode;
}

export function listModes(): string[] {
  return Object.keys(modes);
}
```

### 3.9 ModeRenderer (动态加载 Mode 组件)

```typescript
// core/editor-shell/components/ModeRenderer.tsx

import { useEditorStore } from "../store/editor-store";

interface ModeRendererProps {
  mode: ContentMode;
}

export function ModeRenderer({ mode }: ModeRendererProps) {
  const {
    contentStructure,
    activeItem,
    selectedElement,
    contentVersion,
    contentBaseUrl,
    setActiveItem,
    setSelectedElement,
  } = useEditorStore();

  const { NavigatorComponent, PreviewComponent } = mode;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧导航 */}
      <div className="w-48 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <NavigatorComponent
          structure={contentStructure}
          activeItem={activeItem}
          onNavigate={setActiveItem}
        />
      </div>

      {/* 右侧预览 */}
      <div className="flex-1 overflow-hidden">
        <PreviewComponent
          contentBaseUrl={contentBaseUrl}
          activeItem={activeItem}
          selectedElement={selectedElement}
          onElementSelect={setSelectedElement}
          contentVersion={contentVersion}
        />
      </div>
    </div>
  );
}
```

---

## 4. 关键设计决策

### 4.1 iframe 隔离 vs 直接渲染

**决策：Slide Mode 使用 iframe 隔离渲染，每个 Mode 自行决定渲染方式。**

理由：
- Slide 的 HTML/CSS 可能与编辑器样式冲突 → iframe 隔离
- iframe 提供天然的安全沙箱
- 缺点：iframe 内的元素选中需要 postMessage 通信 → 增加复杂度
- 但 Companion 也是类似的内容隔离模式

### 4.2 接口粒度

**决策：ContentMode 接口提供组件级插槽 + 配置对象，不做更细粒度的 hook 系统。**

理由：
- MVP 只有一个 Mode，无需过度抽象
- 组件级插槽已足够灵活（Navigator 和 Preview 完全由 Mode 控制）
- 配置对象（selector, fileConvention, skill）覆盖了声明式需求
- Phase 2 可以基于实际经验添加 hook

### 4.3 Manifest 解析责任

**决策：每个 Mode 自行解析 manifest（`parseManifest` 方法），核心层只负责读取文件。**

理由：
- 不同 Mode 的 manifest 结构不同
- 统一的 `ContentStructure` 输出足够 Navigator 使用
- Mode 对 manifest 有完全控制权

---

## 5. 被否决的方案

### 5.1 运行时插件加载

```typescript
// 否决: 动态 import mode 包
const mode = await import(`@pneuma/mode-${name}`);
```

- 否决原因：MVP 增加复杂度、需要 npm 包发布流程、对开发者体验无实质提升
- Phase 3 可以考虑

### 5.2 Web Components 作为 Mode 组件

- 否决原因：React 生态更丰富、开发效率更高、与 Companion 技术栈一致

### 5.3 统一 Manifest 格式

- 否决原因：不同 Mode 的内容结构差异大（线性 slides vs 树形 mindmap vs 自由 canvas），强制统一格式会导致不必要的抽象

---

## 6. 影响

1. **新增 Mode 的成本** — 需要实现 `ContentMode` 接口的全部必填字段 + UI 组件 + Skill 包
2. **接口可能在 Phase 2 调整** — MVP 验证后可能修改接口定义
3. **Mode 之间完全隔离** — 不共享 UI 状态或文件约定
4. **Skill 包是 Mode 的核心资产** — 模板和参考文档直接影响 Agent 的输出质量（见 ADR-006）
