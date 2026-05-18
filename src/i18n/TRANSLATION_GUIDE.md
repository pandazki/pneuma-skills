# Translation Guide

Internal guide for translating UI strings in Pneuma Skills. Read this end-to-end before editing any component.

## File layout

```
src/i18n/
├── index.ts                        # i18n bootstrap (already wired)
└── locales/
    ├── en/<namespace>.json         # English (source-of-truth)
    ├── zh-CN/<namespace>.json      # Simplified Chinese
    └── ja/<namespace>.json         # Japanese
```

Every translated component owns one namespace. Existing namespaces: `common`, `settings`, `topbar`.

## How to use

```tsx
import { useTranslation } from "react-i18next";

function MyComponent() {
  // Pick the namespace that matches this component.
  const { t } = useTranslation("my-namespace");
  return (
    <>
      <button>{t("save_button")}</button>
      <button>{t("common:cancel")}</button>     {/* cross-namespace */}
      <p>{t("greeting", { name: user.name })}</p>  {/* interpolation */}
    </>
  );
}
```

For module-level constants (arrays of tab/menu items), store keys not labels:

```tsx
const TABS = [{ id: "chat", labelKey: "tabs.chat" }, …];
// inside the component: {t(tab.labelKey)}
```

## Translation conventions

### Vocabulary (use these exact translations)

| English | zh-CN | ja |
|---|---|---|
| Project | 项目 | プロジェクト |
| Mode | 模式 | モード |
| Session | 会话 | セッション |
| Workspace | 工作区 | ワークスペース |
| Skill | 技能 | スキル |
| Backend | 后端 | バックエンド |
| Agent | 代理 | エージェント |
| Replay | 回放 | 再生 |
| Showcase | 展示 | ショーケース |
| Launcher | 启动器 | ランチャー |
| Launch | 启动 | 起動 |
| Library | 模式库 | ライブラリ |
| Mode library | 模式库 | モードライブラリ |
| Plugin | 插件 | プラグイン |
| Snapshot | 快照 | スナップショット |
| Checkpoint | 检查点 | チェックポイント |
| Handoff | 交接 | ハンドオフ |
| Evolve / Evolution | 演进 | 進化 |
| Settings | 设置 | 設定 |
| Workspace items | 工作区项目 | ワークスペース項目 |
| Content set | 内容集 | コンテンツセット |
| Cancel | 取消 | キャンセル |
| Confirm | 确认 | 確認 |
| Save | 保存 | 保存 |
| Done | 完成 | 完了 |
| Loading… | 加载中… | 読み込み中… |

### Style

- Use ellipsis character `…` (not `...`), match source.
- Chinese: no spaces around English/numbers within Chinese text (`Pneuma 启动器`, `R2 凭据`).
- Japanese: full-width punctuation `。、！？「」`. Half-width parentheses `()` for code/parameters.
- Keep punctuation parity: if EN ends with `.` or `!`, target should match the locale's equivalent ending.
- Brand names (Pneuma, GitHub, Vercel, Cloudflare, R2, Bun, Vite, etc.) stay unchanged.
- Code/CLI snippets (e.g. `git init`, `brew install gh`) stay unchanged.
- Tool tooltips, ARIA labels, alt text count as user-visible — translate them.

### What NOT to translate

- `console.log/error/warn` debug strings — agent-facing logs, not user UI.
- Template `<pneuma:env>`, `<pneuma:handoff-cancelled>`, etc. — protocol tags.
- Skill prompt markdown under `modes/<mode>/skill/`. Skill content stays English.
- File paths, env var names, route paths.
- Variable identifiers in interpolation: `t("hello", { name })` — the `name` key stays English; only translate template text.

### JSON structure

- Keep keys in **snake_case** or **lowerCamelCase** — pick one and stay consistent per namespace. The existing convention is **lower_snake_case for action/event keys** and **dotted nesting for groupings** (e.g. `share.result_desc`).
- Mirror the structure exactly across en/zh-CN/ja — a missing key in zh-CN falls back to en silently and looks broken.
- Don't reuse the same key for different visual contexts. Two "Open" buttons that mean different things → two keys.

## Workflow per file

1. Read the component end-to-end. Make a mental list of every user-facing string.
2. Decide a namespace name (e.g. `project-panel`, `create-project`).
3. Create `src/i18n/locales/en/<ns>.json`, `zh-CN/<ns>.json`, `ja/<ns>.json` with mirrored key trees.
4. Import `useTranslation` from `react-i18next`, call inside the component.
5. Replace each English string with `t("key.path")`. Preserve interpolation: `t("foo", { count })`.
6. Run `bunx tsc --noEmit` and grep for the file's name to confirm no new errors.
7. If the component had a module-level constant array with English labels, refactor to `labelKey` and resolve via `t(item.labelKey)` inside the component.
8. Do NOT translate strings in `console.*`, `throw new Error("…")` (internal), comments, or test fixtures.

## Existing reference

- `src/components/TopBar.tsx` ↔ `src/i18n/locales/{en,zh-CN,ja}/topbar.json` — canonical pattern.
- `src/components/Launcher.tsx` `LanguageSection` — minimal example.
