# Viewer Contract Patterns

> 怎么把 `ViewerContract` 五个面填出来、ViewerAddress 词表怎么定、`pneuma-mode.ts` 怎么绑、workspace resolver 写什么。源头：`core/types/viewer-contract.ts`，语义在 `docs/reference/viewer-agent-protocol.md`。

## ViewerContract 的五个面

```ts
interface ViewerContract {
  PreviewComponent: ComponentType<ViewerPreviewProps>;
  extractContext(selection, files): string;
  updateStrategy: "full-reload" | "incremental";
  workspace?: FileWorkspaceModel;
  actions?: ViewerActionDescriptor[];
  captureViewport?: () => Promise<{ data, media_type } | null>;
}
```

| 面 | 必有 | 干什么 |
|---|---|---|
| `PreviewComponent` | ★ | React 组件；mode 的真正 UI |
| `extractContext` | ★ | 把 selection 翻成 `<viewer-context>` 文本，供 agent 理解"用户在指什么" |
| `updateStrategy` | ★ | `"incremental"` 几乎都用；`"full-reload"` 极少 |
| `workspace` | ○ | 文件组织模型（`resolveItems` / `createEmpty` / `resolveContentSets` / `topBarNavigation`） |
| `actions` | ○ | 直接复用 `manifest.viewerApi.actions` 即可 |
| `captureViewport` | ○ | viewer 给 framework 注入的实时截图方法；通常由 `useCaptureAction` 在挂载后动态注入 |

### 1. PreviewComponent — 主组件

最小骨架：

```tsx
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export function ModePreview(props: ViewerPreviewProps): JSX.Element {
  const { value: deck } = useSource(props.sources.deck);

  if (!deck) return <EmptyState />;

  return (
    <div className="cc-viewer-root">
      <Nav items={props.workspaceItems ?? []} active={props.activeFile} />
      <Canvas
        deck={deck}
        editing={props.editing ?? true}
        readonly={props.readonly ?? false}
        onSelect={props.onSelect}
      />
    </div>
  );
}
```

**常见错误：**
- 直接读 `props.sources.deck.current()` 而不用 `useSource`：少了 subscribe，文件变化不会触发 re-render。
- 在 PreviewComponent 顶层 useState 镜像 `deck`：Source 四不变量已经保证一致性，本地镜像只会引入 stale。
- 把 `props.editing` 默认成 `true` 之外的值：mode 永远先假设 editing，再按 `props.editing === false` 关闭交互。

### 2. extractContext — 把 selection 翻成文本

`extractContext` 决定 agent 在用户消息前看到什么。返回多行 markdown / 自定义文本块；空字符串表示无上下文。

```ts
extractContext(selection, files) {
  if (!selection) return "";

  // address 必须放在最显眼位置——agent 会逐字复制回 capture / locator
  const lines = [
    `Mode: slide`,
    selection.address ? `Address: ${JSON.stringify(selection.address)}` : null,
    selection.file ? `File: ${selection.file}` : null,
    selection.label ? `Label: ${selection.label}` : null,
    selection.nearbyText ? `Context: ${selection.nearbyText}` : null,
    selection.selector ? `Selector: ${selection.selector}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}
```

**几条经验：**
- `Address:` 一行必给（如果 selection 带 address）。这是 ViewerAddress 协议在 chat 里的注入面。
- 把 human-readable 字段（label / nearbyText / selector）也带上——agent 解释指代时这些更友好。
- 单条 selection 上限 ~200 token；超长内容（图片 base64、长 HTML 片段）走 `thumbnail` SVG data URL 字段，不要直接灌文本。

### 3. workspace — 文件组织模型

`FileWorkspaceModel` 决定 framework 怎么解析 workspace 里的"创作单元"。

```ts
interface FileWorkspaceModel {
  type: "all" | "manifest" | "single";
  multiFile: boolean;
  ordered: boolean;
  hasActiveFile: boolean;
  manifestFile?: string;     // type === "manifest" 时填
  resolveItems?(files): WorkspaceItem[];
  resolveContentSets?(files): ContentSet[];
  topBarNavigation?: boolean;
  createEmpty?(files): { path; content }[] | null;
}
```

**三种 type 对应三类 mode：**

| type | 含义 | 例子 |
|------|------|------|
| `"all"` | 每个文件独立、平等 | doc（每个 .md 自成一篇） |
| `"manifest"` | 有顺序 / 结构，由 index 文件定义 | slide（manifest.json 列出 slides）、kami（manifest 定义 paper） |
| `"single"` | 单一主文件 | draw（一个 .excalidraw）、diagram（一张 .drawio per content set） |

**`resolveItems`：** files 列表 → 有序 `WorkspaceItem[]`。typical pattern：

```ts
resolveItems(files) {
  const manifest = files.find(f => f.path.endsWith("manifest.json"));
  if (!manifest) return [];
  const parsed = JSON.parse(manifest.content);
  return parsed.slides.map((s, i) => ({
    path: s.file,
    label: s.title ?? `Slide ${i + 1}`,
    index: i,
  }));
}
```

**`resolveContentSets`：** 文件按 content set 分组。如果你的 mode 支持多内容集（`pneuma-brand/` / `feature-cards/` 等顶层目录），使用框架 helper：

```ts
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";

workspace: {
  resolveContentSets: createDirectoryContentSetResolver(),
}
```

Helper 接受可选配置 `{ dirPattern?, minFiles? }`——前者过滤目录名，后者要求一个内容集至少有 N 个文件才算成立。完整签名见 `core/utils/content-set-resolver.ts`。

**`createEmpty`：** 用户在空 content set 上点"新建"时调用，返回要写入的初始文件列表。

```ts
createEmpty(files) {
  const next = nextSlideNumber(files);
  return [{
    path: `slide-${next}.html`,
    content: SLIDE_TEMPLATE,
  }];
}
```

**`topBarNavigation`：** `true` 时 framework 在 TopBar 渲染 item 切换器；`false` 时 viewer 自己渲染（slide 用 `SlideNavigator`）。复杂导航选 `false`。

### 4. actions — 直接复用 manifest

```ts
viewer: {
  ...
  actions: manifest.viewerApi?.actions,
}
```

不要在 pneuma-mode.ts 重新定义 actions——manifest 是 single source of truth；skill-installer 会把 actions 渲染进指令文件，pneuma-mode 只是把同样的描述子转给 framework 让 viewer 监听 `actionRequest`。

### 5. captureViewport — 动态注入

`captureViewport` 在 ViewerContract 上**声明为 optional**，但实际是由 viewer 内部的 `useCaptureAction` hook 在挂载后通过框架机制注入的：

```tsx
// 在 PreviewComponent 里
useCaptureAction({
  onCapture: async (address) => {
    // 根据 address 决定截哪里
    // 返回 { data: "data:image/png;base64,…", media_type: "image/png" }
  },
});
```

`useCaptureAction` 在 `src/hooks/useCaptureAction.ts`；它把回调挂到 framework 的 capture-action dispatch 上。**框架内建 `capture` action，无需在 manifest 声明。**

---

## ViewerAddress 词表设计

`ViewerAddress = Record<string, unknown>` — 每个 mode 自己定。设计时遵循：

### 原则：粒度 = 用户可点的最小单位

| Mode | Address shape | Why this granularity |
|------|---------------|---------------------|
| slide | `{ contentSet?, slide, file?, selector? }` | 用户主要操作粒度是 slide；`selector` fine 半允许指 slide 内 DOM |
| webcraft | `{ contentSet?, page, anchor?, selector? }` | 用户在多页 site 上操作，`anchor` 与 `selector` 同时给定位深度 |
| illustrate | `{ contentSet?, file?, rowId? }` | 行级 / 图级粒度；图本身不可分割 |
| diagram | `{ pageId?, nodeId? }` | draw.io 多页文件，到 cell 为止 |
| doc | `{ file, heading?, lineRange? }` | 文本文档，标题 / 行号定位 |
| draw | `{ elementId? }` | 单画布，Excalidraw 元素 id |

### 推荐模式

**Coarse + Optional fine。** 一个 address 通常包含：
- 1 个 **coarse "where"** key（必有，但可以是 mode 私有名）：page / slide / file / heading / nodeId 之一
- 0-2 个 **fine "within"** keys（可选）：selector / anchor / lineRange

**`contentSet` 是框架保留键。** 如果你的 mode 支持多 content set，所有 address 都允许（不要求）带 `contentSet`，store 会自动按它切 active set。

**Address 要可 JSON 序列化。** Agent 会把它逐字复制进 `<viewer-locator>` 标签 / `capture` 工具调用——里头不能塞 React component、Function、Symbol。

### 在 SKILL.md 里登记

你的 mode 的 SKILL.md 必须有一节 `## ViewerAddress vocabulary`，每个 key 标 *coarse* 或 *fine* + 一行含义。例：

```markdown
## ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | (framework reserved) | Active content set prefix; passed through by the runtime |
| `slide` | coarse | Slide index (0-based) within the active content set |
| `file` | coarse | Relative slide file path; equivalent to `slide` but verbose |
| `selector` | fine | CSS selector inside the slide's iframe document |
```

Agent 读到这一节才能正确生成 address；这是 ViewerAddress 协议的"mode 侧 schema"。

---

## Action 设计

### 几条经验

1. **数量 2-5 个。** 多了说明你在用 action 表达 UI 操作——那是 Command（① → ⑥）的活，不是 Action（⑤）。
2. **必有一个 navigate-to。** 几乎每个 mode 都有；params 通常是 `{ address: object }`。
3. **`capture` 不在 manifest 列出**，框架内建。
4. **custom category 留给 mode 特定诊断**：slide 的 `checkContentFit`、illustrate 的 `zoom-to-row`。
5. **agentInvocable=false 的 action** 仅供 viewer 内部调用（很少用，主要是历史包袱）。

### 描述要 imperative + 给 agent 足够上下文

```ts
{
  id: "navigate-to",
  label: "Navigate to slide",
  category: "navigate",
  agentInvocable: true,
  description: "Move the viewer to a specific slide by address. Used after editing a slide so the user can review the result.",
  params: {
    address: {
      type: "object",
      description: "ViewerAddress for the target slide, e.g. `{ slide: 3 }` or `{ contentSet: 'en-light', slide: 5 }`",
      required: true,
    },
  },
}
```

`description` 是 agent 选用 action 的唯一线索（skill-installer 把它渲染进指令文件）。**不要写 "navigate to" 这种没信息量的描述**——写"什么时候应该用"。

---

## pneuma-mode.ts 绑定模板

完整 binding：

```ts
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import manifest from "./manifest.js";
import { ModePreview } from "./viewer/ModePreview.js";
import { load } from "./domain.js";  // 仅 aggregate-file 时

const mode: ModeDefinition = {
  manifest,
  viewer: {
    PreviewComponent: ModePreview,
    updateStrategy: "incremental",

    extractContext(selection, files) {
      if (!selection) return "";
      const lines = [
        `Mode: ${manifest.name}`,
        selection.address ? `Address: ${JSON.stringify(selection.address)}` : null,
        selection.file ? `File: ${selection.file}` : null,
        selection.label ? `Label: ${selection.label}` : null,
        selection.nearbyText ? `Context: ${selection.nearbyText}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    },

    workspace: {
      type: manifest.viewerApi!.workspace!.type,
      multiFile: manifest.viewerApi!.workspace!.multiFile,
      ordered: manifest.viewerApi!.workspace!.ordered,
      hasActiveFile: manifest.viewerApi!.workspace!.hasActiveFile,
      resolveItems(files) {
        // 解析 files → WorkspaceItem[]
        return [];
      },
      resolveContentSets: /* 多 content set 时用 createDirectoryContentSetResolver() */ undefined,
      createEmpty(files) {
        return null;  // 不支持空状态时返 null
      },
    },

    actions: manifest.viewerApi?.actions,
  },
};

export default mode;
```

**关键：** 不要重新定义 manifest 字段——`workspace.type` 等直接从 `manifest.viewerApi!.workspace!` 转抄过来；`actions` 直接转引用。这样 manifest 是真 single source of truth。
