---
paths:
  - "modes/**"
---

# Mode Authoring Rules

## Baseline

- **Creating a new mode?** Use the `create-mode` skill (`.claude/skills/create-mode/`) — discovery interview → design brief → skeleton. Do not hand-roll the structure.
- **`manifest.ts` must have no React imports** — it is read by both the Bun backend and the frontend. React bindings live in `pneuma-mode.ts` (`ModeDefinition = { manifest, viewer }`); that split exists on purpose.
- **Hidden modes**: `hidden: true` removes a mode from user-pickable lists (launcher grids, ProjectPanel tiles). Internal modes (`evolve`, `project-evolve`, `project-onboard`, `project-tidy`) are hidden — triggered by UI affordances or programmatically only.
- **Shared assets**: global skills in `modes/_shared/skills/` (e.g. `pneuma-preferences`); shared scripts in `modes/_shared/scripts/` opted in via `SkillConfig.sharedScripts`, copied per-mode at install. Share *script sources* across modes, not SKILL.md guidance — each mode owns its own skill text.
- **Language exception**: Chinese is allowed in mode seed templates (`zh-light/`, `zh-dark/`) and showcase content. Everything else stays English.

## Gotchas

- **Seed gallery auto-derive is directory-only**:mode 没声明 `init.seeds[]` 时,`resolveSeedCatalog` 只把 directory-shaped 的 `seedFiles`(src/dst 以 `/` 结尾,或 dst 是 `./`/`""`)做成 gallery card;单文件条目被视为 framework setup 直接丢弃。真想要单文件模板的 mode **必须**显式声明 `init.seeds[]`。前端 `App.tsx` 的 `hasSeedsDeclared` 镜像了这条规则,两处要同步改。
- **Mode skill version bump 必须带 `changelog`**:`manifest.ts` 的 `version` 动了,就要在 `changelog` map 加同 key 的条目(launcher 的 skill-update 提示从这里取 bullets)。同时 grep 旧版本字符串——`server/__tests__/` 与 backend lifecycle harness 里有测试硬编码 manifest version。
- **Viewer 改动遵守 frontend rules**(`.claude/rules/frontend.md`):视觉验证、design tokens、snapdom/缩略图约束都适用于 `modes/*/viewer/`。
- **SKILL.md 模板变量**:`{{key}}` / `{{viewerCapabilities}}` 由 skill-installer 替换;不要在 skill 文本里发明新的模板语法。
- **Seed/showcase 物料**:showcase 内容在 `modes/<name>/showcase/showcase.json` + `hero.png` + 3-4 `highlight-*.png`,由 `/showcase` command 生成,不要手画占位图。
