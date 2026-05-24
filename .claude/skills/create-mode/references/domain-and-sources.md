# Domain & Sources

> 决定一个 mode 长什么样的关键问题是：**它的 domain 是什么？** 这决定 Source kind，决定 `domain.ts` 要不要写，决定 viewer 看到什么类型。本篇是选型决策树。源头契约在 `core/types/source.ts` 与 `docs/reference/viewer-agent-protocol.md::Sources`。

## 核心原则

**Source 是 player 抽象，不是编辑器抽象。** Viewer 通过 `Source<T>` 订阅 agent 在 workspace 上的工作成果——`T` 是 domain 类型（`Deck`、`Studio`、`Site`、`Project`、`Paper`），不是文件数组。Source 的存在让 viewer 只看 domain，不看 storage。

数据流主方向：

```
Agent (Edit/Write) → chokidar → pendingSelfWrites → WS → Source<T> → viewer
```

Viewer 通过 `Source.write()` 写回是**补充能力**（人的可选参与），不是主路径。

## Source kind 决策树

从用户的 domain 出发，按这个顺序问：

```
Q1: domain 持久化吗？
  └─ 否（ephemeral，刷新即丢） → `memory`
  └─ 是 ↓

Q2: domain 在磁盘上是一个文件还是多个？
  └─ 一个文件 ↓
  │   Q3: 文件结构化（JSON / TOML / YAML / 任何可 parse/serialize）吗？
  │     └─ 是 → `json-file`（最常用）
  │     └─ 否（domain 就是文本） → 还是用 `file-glob`，patterns 设为单个文件
  └─ 多个文件 ↓
      Q4: viewer 看的 T 是"一堆独立文件"还是"由多文件拼成的聚合对象"？
        └─ 一堆独立文件，每个有意义自成单位 → `file-glob`
        └─ 多文件拼成一个 domain object（去掉某个文件就破坏整体） → `aggregate-file`
```

### 四类 provider 速查（`core/sources/`）

| kind | 文件 | T 类型示例 | 读 | 写 | 配 domain.ts？ |
|---|---|---|---|---|---|
| `file-glob` | `core/sources/file-glob.ts` | `ViewerFileContent[]` | 多文件按 glob 聚合 | ✗ 不支持 | 否 |
| `json-file` | `core/sources/json-file.ts` | mode 自定义结构化类型 | 单文件 parse | full round-trip 时序锁 | 视复杂度 |
| `aggregate-file` | `core/sources/aggregate-file.ts` | mode 自定义聚合类型 | provider 跑 `load(files) → T` | provider 跑 `save(value, current) → { writes, deletes }` 拆回多文件 | ★ 必配 |
| `memory` | `core/sources/memory.ts` | mode 自定义类型 | 内存 | 内存 | 否 |

### 六个现役 mode 选了哪种？

| Mode | Source kind | Domain T | 选这个的理由 |
|------|-------------|----------|------------|
| webcraft | `aggregate-file` | `Site`（多页 + assets + meta） | 用户编辑一个 site，但它散落在 page-html / assets / meta 文件里 |
| slide | `aggregate-file` | `Deck`（per content-set：slides 列表 + manifest + theme） | Deck 是结构化整体，但 slides 是独立 .html 文件 |
| illustrate | `aggregate-file` | `Studio`（per content-set：rows of images + manifest） | 同上，rows + images 拼出 Studio |
| diagram | `file-glob` | `ViewerFileContent[]`（.drawio 文件们） | 每张 diagram 自成 unit；不需聚合 |
| remotion | `file-glob` | `ViewerFileContent[]`（src/**/*.tsx） | viewer 不直接消费 domain；它把 .tsx 喂给 Babel JIT 编译 |
| kami | `aggregate-file` | `Paper`（page-html + manifest + assets） | 同 slide，但只有单页 |

**模式：** 当 viewer 需要把"散落的多文件视作一个 domain object"——绝大多数视觉创作 mode——`aggregate-file` 是默认选择，并配 `domain.ts`。

---

## 设计 domain type T

T 是 viewer 实际订阅的类型。设计 T 时的几条建议：

### 1. T 应该是 domain noun，不是 storage 结构

```ts
// ❌ 把存储结构暴露给 viewer
type T = { manifestFile: string; slidesDir: string; htmlFiles: string[] };

// ✓ domain noun
type Deck = {
  byContentSet: Record<string, DeckManifest>;
};
type DeckManifest = {
  title: string;
  slides: Slide[];
};
type Slide = {
  id: string;
  file: string;
  title?: string;
};
```

Viewer 看到 `Deck`，渲染时通过 `deck.byContentSet[active]` 选当前 content set，循环 `slides[]`——没有 file path 拼接逻辑，没有 manifest parse 调用。这些都关进 `domain.ts::load`。

### 2. T 支持 partial state

第一次加载之前，`current()` 返回 `null`。Viewer 必须能处理。常见模式：

```tsx
const { value: deck } = useSource(props.sources.deck);
if (!deck) return <EmptySkeleton />;
// 安全地用 deck.byContentSet[…]
```

`load(files) → T | null` 允许返回 null 表示"目录里还没有有效 domain"（例如还没 scaffold）。

### 3. 多 content set 在 T 顶层而非外面

如果 mode 支持多 content set，把 `byContentSet: Record<string, X>` 设计到 T 顶层。这样 `aggregate-file` 的 `load` / `save` 是对**整个 domain** 的纯函数，content set 切换在 viewer 内消化（`useStore` 读 active content set，从 `deck.byContentSet[active]` 取）。

不要为每个 content set 实例化一个 Source——`SourceRegistry` 是 per-mode 一份，跨 content set 共享。

---

## `domain.ts` 的写法

`aggregate-file` provider 需要一对纯函数：

```ts
// modes/<name>/domain.ts

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// domain types
export interface Deck { /* ... */ }
export interface DeckManifest { /* ... */ }

// load: files → T | null（纯函数，无 IO）
export function load(files: ViewerFileContent[]): Deck | null {
  const byContentSet: Record<string, DeckManifest> = {};
  // group files by content set prefix
  // for each group: parse manifest.json, resolve slides[]
  // ...
  if (Object.keys(byContentSet).length === 0) return null;
  return { byContentSet };
}

// save: T → { writes, deletes }（纯函数；provider 把 diff 翻成 file ops）
export function save(
  next: Deck,
  current: Deck | null,
): { writes: { path: string; content: string }[]; deletes: string[] } {
  const writes: { path: string; content: string }[] = [];
  const deletes: string[] = [];
  // diff next vs current per content set
  // - manifest 变了 → writes.push({ path: "<prefix>/manifest.json", content: JSON.stringify(...) })
  // - slide 文件新增 → writes.push({ path, content })
  // - slide 文件删了 → deletes.push(path)
  return { writes, deletes };
}
```

**核心特性：**
- 纯函数（无 fs 调用、无 fetch、无副作用）——`aggregate-file` provider 自己接 FileChannel 写文件。
- `load` 失败时返回 `null` 而非抛错，让 viewer 渲染 empty state 而非崩。
- `save` 必须能从 `next` + `current` 算出最小 diff（写最少的文件、删最少的文件）——否则每次小改动都会触发整 deck 重写，性能不行。

**例外：** `aggregate-file` 设计上支持只读——`save` 可以 stub 成 `{ writes: [], deletes: [] }`。illustrate 现状如此：domain 由 agent Edit 工具直接写，viewer 不回写。如果你不打算让 viewer 写 domain，stub `save` 是合法的。

---

## 多 Source per mode

一个 mode 可以声明多个 Source。常见模式：

```ts
// manifest.ts
sources: {
  deck: {                    // 主 domain：聚合的 Deck
    kind: "aggregate-file",
    config: { patterns: ["**/*.html", "**/manifest.json"], load, save, ... },
  },
  files: {                   // raw 文件逃生口（agent 写过的 HTML, viewer 想读原文）
    kind: "file-glob",
    config: { patterns: ["**/*.html"] },
  },
}
```

Viewer 通过 `props.sources.deck` 拿到聚合，`props.sources.files` 拿到 raw 文件视图。两者订阅同一份磁盘状态、`origin` 标记一致。

**何时拆多个 Source：**
- 主 domain 之外还需要 raw 文件查阅（slide 用这模式）
- domain 有"主"和"辅"两种类型（如 ClipCraft 的 project json + asset files）

**何时不拆：**
- 同一 domain 不同视图——viewer 内部派生即可，别新建 Source

---

## 跟 agent 共享磁盘的契约

Source 层与 agent 的 file tools **共享同一份磁盘**，通过 `origin` 标记互识：

- Agent 调 Edit / Write → chokidar 监到 → `origin: "external"`
- Source 调 `.write()` → `pendingSelfWrites` 标记 → `origin: "self"`
- 启动时首次快照 → `origin: "initial"`

Viewer 通常这样消费：

```tsx
useEffect(() => {
  const unsub = source.subscribe((evt) => {
    if (evt.kind !== "value") return;
    if (evt.origin === "external") {
      // agent 改了什么 — 可考虑高亮、滚动到变化位置、prompt 用户合并
    }
  });
  return unsub;
}, [source]);
```

`origin: "self"` 不需要特殊处理——`source.write(v)` 的 await 已经保证渲染时 `current() === v`。

---

## 反模式

- ❌ **在 viewer 里 `fs.readFile` / `fetch('/api/files?path=…')`**——绕过 Source 层。所有文件读应该走 `useSource`。
- ❌ **viewer 维护乐观 state**：`const [local, setLocal] = useState(value); setLocal(next); await source.write(next);`——四不变量已经保证 `await source.write(v)` 之后渲染时 `value === v`；不需要 local 镜像。
- ❌ **`aggregate-file` 的 `load` 抛错**：返回 `null` 而非 throw，让 viewer 显 empty state。
- ❌ **多 Source 跨实例共享 mutation**：每个 Source 是独立 single-writer；不要在 source A 的 subscribe 里调 source B.write。如果两者真的有联动关系，用 `useEffect` 编排在 viewer 层。

---

## 进阶：自定义 SourceProvider

如果你的 domain 不在磁盘上（Redis / Yjs / S3 / Figma / 内部 BFF），实现一个 `SourceProvider`：

```ts
import type { SourceProvider, Source } from "../../core/types/source.js";

export const figmaProvider: SourceProvider = {
  kind: "figma-file",
  create<T>(config, ctx) {
    // 返回一个 Source<T>；继承 BaseSource 自动得到四不变量
    return new FigmaSource(config, ctx) as Source<T>;
  },
};
```

通过 `PluginManifest.sources` 在 plugin 里注册。详见 `docs/reference/viewer-agent-protocol.md::自定义 provider`。一般 mode 不需要走到这一步。
