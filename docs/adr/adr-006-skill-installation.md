# ADR-006: Skill 安装机制

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-004, ADR-011

---

## 1. 背景

Pneuma 的核心价值之一是让 Code Agent 具备领域知识。这通过 **Skill 安装** 实现：

- 每个 Content Mode 包含一个完整的 **Skill 包**（prompt、模板、参考文档、脚本）
- 启动时，将 Skill 包安装到工作目录的 `.claude/skills/` 下
- Claude Code 会自动发现和加载 `.claude/skills/` 中的 SKILL.md
- 同时在 `CLAUDE.md` 中注入对 Skill 的引用

这个机制与 Claude Code 的原生 Skill 系统对齐，不需要自定义加载器。

### 关键前提

Claude Code 的 Skill 发现机制：
1. 读取项目根目录的 `CLAUDE.md`
2. 自动扫描 `.claude/skills/*/SKILL.md`
3. SKILL.md 中的指令作为 system prompt 的一部分

---

## 2. 决策

### 2.1 安装策略：复制而非链接

**将 Skill 包完整复制到工作目录**，不使用 symlink。

理由：
- 用户可以自定义修改安装后的 Skill（覆盖默认行为）
- 工作目录可以独立存在（不依赖 Pneuma 安装路径）
- 版本管理清晰（安装后的文件 = 当时的版本快照）
- Claude Code 不一定能 follow symlink

### 2.2 版本检测：基于版本号

使用 `.claude/skills/pneuma-<mode>/VERSION` 文件记录已安装版本。

### 2.3 CLAUDE.md 管理：区段注入

使用 marker comments 标记 Pneuma 管理的区段，避免覆盖用户手写内容。

---

## 3. 详细设计

### 3.1 Skill 包目录结构

每个 Content Mode 的 Skill 包在框架源码中的位置：

```
modes/slide/skill/
├── SKILL.md                     # Skill 入口 (Claude Code 自动加载)
├── VERSION                      # 版本号文件: "0.1.0"
├── templates/
│   ├── themes/
│   │   ├── minimal-light.css    # 浅色主题
│   │   ├── minimal-dark.css     # 深色主题
│   │   └── corporate.css        # 企业主题
│   └── layouts/
│       ├── title.html           # 标题页布局
│       ├── content.html         # 内容页布局
│       ├── two-column.html      # 双栏布局
│       ├── image-full.html      # 全图布局
│       └── chart.html           # 图表布局
├── references/
│   ├── slide-codegen-guide.md   # HTML slide 代码生成详细指南
│   ├── design-principles.md     # 排版/配色/字体最佳实践
│   └── chart-patterns.md        # 数据可视化模式
└── scripts/
    ├── validate-manifest.js     # 校验 manifest.json 完整性
    └── export-pdf.js            # PDF 导出辅助脚本
```

### 3.2 安装流程

```typescript
// core/server/skill-installer.ts

interface SkillInstallResult {
  installed: boolean;
  upgraded: boolean;
  version: string;
  path: string;
}

async function installSkill(
  mode: ContentMode,
  workspace: string,
): Promise<SkillInstallResult> {
  const targetDir = join(workspace, mode.skill.installDir);
  const versionFile = join(targetDir, "VERSION");
  const currentVersion = mode.skill.version;

  // 1. 检查是否已安装
  const existingVersion = await readVersion(versionFile);

  if (existingVersion === currentVersion) {
    // 已是最新版本，跳过
    return {
      installed: false,
      upgraded: false,
      version: currentVersion,
      path: targetDir,
    };
  }

  const isUpgrade = existingVersion !== null;

  if (isUpgrade) {
    console.log(
      `[skill-installer] Upgrading ${mode.name} skill: ${existingVersion} → ${currentVersion}`
    );
    // 备份旧版本 (防止用户自定义内容丢失)
    const backupDir = `${targetDir}.backup-${existingVersion}`;
    await rename(targetDir, backupDir);
    console.log(`[skill-installer] Old version backed up to: ${backupDir}`);
  }

  // 2. 复制 Skill 包
  const sourceDir = resolveSkillSource(mode);
  await copyDir(sourceDir, targetDir);

  // 3. 写入版本号
  await writeFile(versionFile, currentVersion);

  // 4. 注入 CLAUDE.md
  await injectClaudeMd(workspace, mode);

  console.log(
    `[skill-installer] ${isUpgrade ? "Upgraded" : "Installed"} ${mode.name} skill v${currentVersion} → ${targetDir}`
  );

  return {
    installed: true,
    upgraded: isUpgrade,
    version: currentVersion,
    path: targetDir,
  };
}
```

### 3.3 CLAUDE.md 区段管理

```typescript
const MARKER_START = "<!-- pneuma:start -->";
const MARKER_END = "<!-- pneuma:end -->";

async function injectClaudeMd(workspace: string, mode: ContentMode): Promise<void> {
  const claudeMdPath = join(workspace, "CLAUDE.md");
  let content = "";

  // 读取已有内容
  try {
    content = await readFile(claudeMdPath, "utf-8");
  } catch {
    // 文件不存在，创建新的
  }

  // 构造注入片段
  const snippet = [
    MARKER_START,
    mode.skill.claudeMdSnippet,
    MARKER_END,
  ].join("\n");

  if (content.includes(MARKER_START)) {
    // 替换已有的 Pneuma 区段
    const regex = new RegExp(
      `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
    );
    content = content.replace(regex, snippet);
  } else {
    // 追加到末尾
    content = content.trim()
      ? `${content.trim()}\n\n${snippet}\n`
      : `${snippet}\n`;
  }

  await writeFile(claudeMdPath, content);
}
```

### 3.4 安装后的工作目录结构

```
my-deck/                              # workspace
├── CLAUDE.md                          # ← Pneuma 自动管理的区段
│   内容:
│   ```
│   <!-- pneuma:start -->
│   ## Pneuma Slide Mode
│   ...skill 引用和关键约定...
│   <!-- pneuma:end -->
│   ```
│
├── .claude/
│   └── skills/
│       └── pneuma-slide/              # ← 安装的 Skill 包
│           ├── SKILL.md               # Claude Code 自动发现的入口
│           ├── VERSION                # "0.1.0"
│           ├── templates/
│           │   ├── themes/
│           │   │   ├── minimal-light.css
│           │   │   ├── minimal-dark.css
│           │   │   └── corporate.css
│           │   └── layouts/
│           │       ├── title.html
│           │       ├── content.html
│           │       └── ...
│           ├── references/
│           │   ├── slide-codegen-guide.md
│           │   ├── design-principles.md
│           │   └── chart-patterns.md
│           └── scripts/
│               ├── validate-manifest.js
│               └── export-pdf.js
│
├── manifest.json                      # slide 元数据
├── slides/
│   ├── slide-01.html
│   └── ...
├── assets/
├── theme.css
└── index.html
```

### 3.5 版本管理策略

```
安装决策树:

pneuma slide --workspace ./my-deck
  │
  ├── .claude/skills/pneuma-slide/ 不存在
  │   └─→ 全新安装 → 复制 Skill 包 + 注入 CLAUDE.md
  │
  ├── .claude/skills/pneuma-slide/VERSION == 当前版本
  │   └─→ 跳过 (已是最新)
  │
  ├── .claude/skills/pneuma-slide/VERSION < 当前版本
  │   └─→ 升级:
  │       1. 备份旧版本 → .backup-{old_version}
  │       2. 复制新 Skill 包
  │       3. 更新 CLAUDE.md 区段
  │       4. 输出升级日志
  │
  └── .claude/skills/pneuma-slide/VERSION 不存在
      └─→ 当作全新安装 (旧版本无版本号)
```

### 3.6 Skill 包辅助工具

```typescript
// 解析 Skill 包源路径
function resolveSkillSource(mode: ContentMode): string {
  // modes/slide/skill/ → 绝对路径
  // 从 Pneuma 安装目录解析
  const modeDir = join(PNEUMA_ROOT, "modes", mode.name);
  return join(modeDir, mode.skill.sourceDir);
}

// 递归复制目录
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

// 读取版本号
async function readVersion(versionFile: string): Promise<string | null> {
  try {
    const content = await readFile(versionFile, "utf-8");
    return content.trim();
  } catch {
    return null;
  }
}
```

---

## 4. 关键设计决策

### 4.1 Skill 包 vs System Prompt 注入

**决策：使用 Claude Code 原生 Skill 系统（.claude/skills/），而非直接注入 system prompt。**

理由：
- Claude Code 原生支持 `.claude/skills/` 自动发现
- Skill 包可以包含模板文件、参考文档、脚本 — 不只是 prompt 文本
- Agent 可以在运行时读取 Skill 包中的文件（如模板和参考文档）
- 用户可以自行修改 Skill 包来定制行为

### 4.2 升级时备份旧版本

**决策：升级时备份旧 Skill 到 `.backup-{version}` 目录。**

理由：
- 用户可能修改了 Skill 包中的内容（如自定义模板）
- 备份允许用户手动恢复或对比差异
- 备份目录以版本号命名，清晰可辨

### 4.3 CLAUDE.md 共存策略

**决策：使用 marker comments 管理 Pneuma 区段，保留用户手写内容。**

理由：
- 用户可能在 CLAUDE.md 中有自己的 prompt
- 完全覆盖 CLAUDE.md 会丢失用户内容
- marker comments 是成熟的区段管理模式

---

## 5. 被否决的方案

### 5.1 Symlink 到 Skill 包

```bash
# 否决: 使用 symlink
ln -s /path/to/pneuma/modes/slide/skill .claude/skills/pneuma-slide
```

- 否决原因：用户无法自定义修改；依赖 Pneuma 安装路径；跨平台兼容问题

### 5.2 npm 包安装 Skill

```bash
# 否决: 作为 npm 包
npm install @pneuma/skill-slide
```

- 否决原因：过度工程化；Skill 是项目级的，不适合 npm 全局安装；增加发布流程

### 5.3 运行时动态注入 System Prompt

- 否决原因：无法利用 Claude Code 原生 Skill 机制；Skill 包中的文件（模板等）不可用

---

## 6. 影响

1. **每个 workspace 有独立的 Skill 副本** — 磁盘空间开销（每个 Skill 包约 50-200KB）
2. **用户可以自定义 Skill** — 修改 SKILL.md 或模板即可覆盖默认行为
3. **升级会产生备份目录** — 需要定期清理（或在 UI 中提供清理选项）
4. **CLAUDE.md 有 Pneuma 管理区段** — 用户不应手动编辑 marker 之间的内容
5. **Skill 质量直接影响 Agent 输出** — SKILL.md + 模板 + 参考文档的质量是产品核心竞争力
