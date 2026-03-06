# Pneuma Skills 2.0 Proposal: Continuous Learning — Skill 自动个性化与进化

> **日期**: 2026-03-05
> **版本**: v1.18.1 → v2.0.0
> **作者**: Sisyphus (AI Architect)
> **状态**: Draft — Pending Review

---

## 〇、Executive Summary

Pneuma 1.x 实现了 **静态 Skill 注入**：Mode 预置的领域知识（SKILL.md + 参考文档 + 模板）在安装时一次性写入 workspace，Agent 始终使用同一份 prompt。无论用户是设计极简主义者还是信息密度爱好者，Agent 给出的输出都遵循相同的默认风格。

**2.0 的核心命题：让 Skill 认识它的用户。**

三层进化模型：

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: In-Session Adaptation (实时适应)               │
│  Agent 在当前会话中根据反馈模式实时调整                      │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Dynamic Skill Augmentation (动态增强)           │
│  每次会话启动时，将学到的偏好注入 Skill prompt               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Cross-Session Preference Extraction (跨会话提取) │
│  会话结束后，从对话历史中挖掘用户风格/偏好/模式               │
└─────────────────────────────────────────────────────────┘
```

---

## 一、现状分析：我们有什么，缺什么

### 1.1 已有的数据基础

| 数据源 | 位置 | 格式 | 可用性 |
|--------|------|------|--------|
| 完整对话历史 | `.pneuma/history.json` | `BrowserIncomingMessage[]` JSON | ✅ 每 5s 自动保存 |
| Agent 输出 | history 中 `type: "assistant"` | 含 model, content blocks, usage, tool_use | ✅ 结构化 |
| 用户消息 | history 中 `type: "user_message"` | 含 viewer-context, user-actions | ✅ 结构化 |
| 工具调用详情 | history 中 `tool_use` content blocks | tool_name, input params | ✅ 结构化 |
| 会话结果 | history 中 `type: "result"` | cost, duration, turns, lines added/removed | ✅ 结构化 |
| 会话元数据 | `.pneuma/session.json` | sessionId, agentSessionId, mode | ✅ |
| 配置参数 | `.pneuma/config.json` | init params (slideWidth etc.) | ✅ |
| 全局会话注册 | `~/.pneuma/sessions.json` | mode, workspace, lastAccessed | ✅ |
| Viewer 上下文 | 消息中 `<viewer-context>` XML | active file, selection, viewport | ✅ 嵌入消息 |
| 用户操作事件 | 消息中 `<user-actions>` XML | edit diff, reorder, delete | ✅ 嵌入消息 |

### 1.2 缺失的关键能力

| 能力 | 缺失原因 | 影响 |
|------|---------|------|
| **偏好提取** | 无分析管道 | 无法从历史中学习 |
| **用户画像持久化** | 无 profile 存储 | 跨会话记忆为零 |
| **Skill 动态注入** | 模板引擎只处理 init params | 无法注入个性化内容 |
| **反馈信号识别** | 无 correction/rejection 检测 | 不知道 Agent 做错了什么 |
| **偏好版本管理** | — | 偏好无法回退或对比 |

### 1.3 现有架构的扩展点

从 `skill-installer.ts` 分析出的注入机制：

```
CLAUDE.md 注入体系（已有三个 marker 区段）：
  <!-- pneuma:start -->            ← Mode 身份 + Skill 引用
  <!-- pneuma:viewer-api:start --> ← Viewer 能力描述
  <!-- pneuma:skills:start -->     ← 外部 Skill 依赖列表
  
  → 可新增第四个区段：
  <!-- pneuma:preferences:start --> ← 用户偏好注入 ✨
```

模板引擎 `applyTemplateParams()` 支持：
- `{{key}}` 简单替换
- `{{#key}}...{{/key}}` 条件块

→ 可扩展为 `{{preferences}}` 占位符，在 SKILL.md 中预留注入位。

---

## 二、设计方案

### 2.1 整体架构

```
                    ┌──────────────────────────┐
                    │   Session Runtime        │
                    │                          │
  User ◄──────────► │  Agent (Claude Code)    │
    │               │    ↑                     │
    │               │    │ SKILL.md            │
    │               │    │ + preferences.md  ✨│
    │               │    │ + CLAUDE.md         │
    │               └────┼─────────────────────┘
    │                    │
    ▼                    ▼
┌──────────┐      ┌──────────────┐      ┌────────────────┐
│ history  │ ───► │  Preference  │ ───► │  User Profile  │
│ .json    │      │  Extractor   │      │  .json         │
│          │      │  (offline)   │      │  (~/.pneuma/)  │
└──────────┘      └──────────────┘      └────────────────┘
                         ▲                      │
                         │                      ▼
                  ┌──────┴──────┐      ┌────────────────┐
                  │  Feedback   │      │ Skill Installer │
                  │  Signals    │      │ (augmented)     │
                  │  (runtime)  │      │ + preferences   │
                  └─────────────┘      └────────────────┘
```

### 2.2 核心概念模型

```typescript
/** 用户偏好画像 — 跨 Mode 的全局 + 每 Mode 的特化 */
interface UserProfile {
  version: number;                    // 画像版本（每次提取递增）
  lastUpdated: string;                // ISO timestamp
  
  /** 全局偏好 — 适用于所有 Mode */
  global: {
    language: string;                 // 用户沟通语言 ("zh-CN", "en", "ja")
    communicationStyle: string;       // "concise" | "detailed" | "conversational"
    technicalLevel: string;           // "beginner" | "intermediate" | "expert"
    customTraits: UserTrait[];        // 提取到的通用偏好
  };
  
  /** Mode 特化偏好 — 每个 Mode 独立积累 */
  modes: Record<string, ModePreferences>;
  
  /** 提取元数据 — 可追溯性 */
  extractionHistory: ExtractionRecord[];
}

interface ModePreferences {
  /** 风格偏好 — 从用户修改和反馈中提取 */
  styleTraits: UserTrait[];
  
  /** 正面模式 — 用户明确喜欢的做法 */
  positivePatterns: string[];
  
  /** 负面模式 — 用户纠正过的做法 */
  negativePatterns: string[];
  
  /** 频率统计 — 用户常用的操作/功能 */
  usagePatterns: {
    frequentTools: Record<string, number>;     // tool_name → count
    averageSessionLength: number;               // turns
    commonRequestTypes: string[];               // 分类后的请求类型
  };
  
  /** 会话计数 */
  sessionCount: number;
}

interface UserTrait {
  category: string;       // "typography" | "color" | "layout" | "tone" | "workflow" | ...
  trait: string;          // "prefers dark themes"
  confidence: number;     // 0.0 ~ 1.0
  evidence: string[];     // 支撑该 trait 的证据摘要（不存原文）
  firstSeen: string;      // ISO timestamp
  lastSeen: string;
}

interface ExtractionRecord {
  timestamp: string;
  sessionId: string;
  workspace: string;
  mode: string;
  traitsExtracted: number;
  traitsUpdated: number;
  traitsDecayed: number;
}
```

---

## 三、Layer 1: Cross-Session Preference Extraction（跨会话偏好提取）

### 3.1 触发时机

**选择：会话结束时（shutdown hook）**

```
用户退出 Pneuma（SIGINT/SIGTERM）
  │
  ├─ 1. 保存 history.json（已有）
  │
  └─ 2. 触发 Preference Extractor ✨
       ├─ 读取本次 history.json
       ├─ 提取偏好信号
       ├─ 合并到 ~/.pneuma/user-profile.json
       └─ 清理：不存储原始对话内容
```

为什么不是实时提取？
- 实时提取需要额外 LLM 调用，增加成本和延迟
- 会话结束后批量分析更高效，且不影响用户体验
- 历史已经完整持久化，不存在数据丢失风险

### 3.2 提取管道设计

```typescript
// server/preference-extractor.ts

interface ExtractionPipeline {
  /** Step 1: 信号采集 — 从原始历史中提取结构化信号 */
  collectSignals(history: BrowserIncomingMessage[]): PreferenceSignal[];
  
  /** Step 2: 信号分析 — 将信号聚合为偏好特征 */
  analyzeSignals(signals: PreferenceSignal[]): UserTrait[];
  
  /** Step 3: 画像合并 — 将新特征与已有画像合并 */
  mergeProfile(existing: UserProfile, newTraits: UserTrait[], mode: string): UserProfile;
}
```

### 3.3 信号类型与采集策略

关键洞察：**反馈信号 >> 正面信号**。用户纠正 Agent 的行为是最强的偏好信号。

| 信号类型 | 检测方法 | 偏好价值 | 示例 |
|---------|---------|---------|------|
| **Correction（纠正）** | 用户在 Agent 输出后要求修改 | ⭐⭐⭐⭐⭐ | "字体太小了" → 偏好大字号 |
| **Rejection（否定）** | 用户否定 Agent 方案 | ⭐⭐⭐⭐⭐ | "不要用这个配色" → 负面模式 |
| **Explicit preference（显式声明）** | 用户直接表达偏好 | ⭐⭐⭐⭐⭐ | "我喜欢极简风格" |
| **User edit（用户编辑）** | `<user-actions>` 中的 diff | ⭐⭐⭐⭐ | 用户手动改了 font-size |
| **Repeated pattern（重复模式）** | 跨会话统计 | ⭐⭐⭐ | 每次都要求深色主题 |
| **Tool usage pattern** | tool_use 频率统计 | ⭐⭐ | 常用 Edit 而非 Write |
| **Session structure** | 会话长度、turns | ⭐ | 偏好短对话 vs 长对话 |

### 3.4 提取实现：两阶段策略

**Phase A（v2.0 初版）：规则引擎 — 零 LLM 成本**

```typescript
// 基于规则的信号检测 — 无需额外 LLM 调用

function collectSignals(history: BrowserIncomingMessage[]): PreferenceSignal[] {
  const signals: PreferenceSignal[] = [];
  
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    
    // 1. 检测纠正信号：用户消息紧跟 Agent 输出，且包含修改指令
    if (msg.type === "user_message" && i > 0) {
      const prevAssistant = findPreviousAssistant(history, i);
      if (prevAssistant && isCorrectionMessage(msg.content)) {
        signals.push({
          type: "correction",
          userMessage: msg.content,
          agentContext: summarizeAssistant(prevAssistant),
          timestamp: msg.timestamp,
        });
      }
    }
    
    // 2. 检测显式偏好声明
    if (msg.type === "user_message") {
      const preferences = extractExplicitPreferences(msg.content);
      for (const pref of preferences) {
        signals.push({ type: "explicit", ...pref, timestamp: msg.timestamp });
      }
    }
    
    // 3. 检测用户手动编辑（user-actions diff）
    if (msg.type === "user_message" && msg.content?.includes("<user-actions>")) {
      const actions = parseUserActions(msg.content);
      for (const action of actions) {
        signals.push({ type: "user_edit", ...action, timestamp: msg.timestamp });
      }
    }
  }
  
  return signals;
}

// 纠正信号检测 — 关键词 + 上下文模式
function isCorrectionMessage(content: string): boolean {
  const correctionPatterns = [
    /太(大|小|长|短|密|稀|亮|暗)/,
    /不要|别用|换(成|个)|改(成|为)/,
    /font.?size|字[号体]|颜色|配色|间距|边距/i,
    /too (big|small|long|short|dark|light|dense|sparse)/i,
    /change|replace|swap|switch|use .+ instead/i,
    /don'?t (use|want|like|need)/i,
    /prefer|rather|instead/i,
  ];
  return correctionPatterns.some(p => p.test(content));
}
```

**Phase B（v2.1）：LLM 辅助提取 — 高精度**

当规则引擎积累足够信号后，可选地使用 LLM 做深层分析：

```typescript
// 可选的 LLM 辅助分析 — 仅在信号量足够时触发
async function llmAnalyzeSignals(
  signals: PreferenceSignal[],
  existingProfile: UserProfile,
): Promise<UserTrait[]> {
  // 只在满足条件时触发 LLM：
  // - 信号数 >= 10
  // - 上次 LLM 分析距今 >= 5 个会话
  // - 用户未禁用 LLM 分析
  
  const prompt = `
    Analyze these user interaction signals and extract preference traits.
    
    Existing profile: ${JSON.stringify(existingProfile.global)}
    
    New signals:
    ${signals.map(s => `- [${s.type}] ${s.summary}`).join("\n")}
    
    Extract traits in JSON format: { category, trait, confidence, evidence }
    Categories: typography, color, layout, tone, density, workflow, content-style
    
    Rules:
    - Only extract traits with clear evidence (confidence >= 0.5)
    - Corrections are strongest signals (confidence 0.8+)
    - Repeated patterns across sessions increase confidence
    - Return max 10 traits per analysis
  `;
  
  // 使用低成本模型（Haiku / GPT-4o-mini）
  return await extractTraits(prompt);
}
```

### 3.5 画像合并策略

```typescript
function mergeProfile(
  existing: UserProfile,
  newTraits: UserTrait[],
  mode: string,
): UserProfile {
  const profile = structuredClone(existing);
  profile.version++;
  profile.lastUpdated = new Date().toISOString();
  
  // 确保 mode 条目存在
  if (!profile.modes[mode]) {
    profile.modes[mode] = {
      styleTraits: [],
      positivePatterns: [],
      negativePatterns: [],
      usagePatterns: {
        frequentTools: {},
        averageSessionLength: 0,
        commonRequestTypes: [],
      },
      sessionCount: 0,
    };
  }
  profile.modes[mode].sessionCount++;
  
  for (const newTrait of newTraits) {
    const target = isGlobalTrait(newTrait)
      ? profile.global.customTraits
      : profile.modes[mode].styleTraits;
    const existing = target.find(
      t => t.category === newTrait.category && t.trait === newTrait.trait
    );
    
    if (existing) {
      // 强化已有 trait — 置信度取加权平均，向上收敛
      existing.confidence = Math.min(
        1.0,
        existing.confidence * 0.6 + newTrait.confidence * 0.4 + 0.05
      );
      // 保留最近 5 条证据
      existing.evidence = [
        ...existing.evidence.slice(-3),
        ...newTrait.evidence.slice(-2),
      ];
      existing.lastSeen = newTrait.lastSeen;
    } else {
      // 新 trait — 直接加入
      target.push(newTrait);
    }
  }
  
  // 衰减：长时间未见的 trait 降低置信度
  const DECAY_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 天
  const now = Date.now();
  for (const traits of [
    profile.global.customTraits,
    profile.modes[mode].styleTraits,
  ]) {
    for (const trait of traits) {
      const age = now - new Date(trait.lastSeen).getTime();
      if (age > DECAY_THRESHOLD) {
        trait.confidence *= 0.9; // 每次提取衰减 10%
      }
    }
    // 移除低置信度 trait
    const filtered = traits.filter(t => t.confidence >= 0.2);
    traits.length = 0;
    traits.push(...filtered);
  }
  
  return profile;
}
```

### 3.6 存储位置

```
~/.pneuma/
  ├── sessions.json           # 已有：全局会话注册
  ├── user-profile.json       # ✨ 新增：用户偏好画像
  └── preferences/
      └── extraction-log.jsonl # ✨ 新增：提取日志（调试 + 可追溯）
```

为什么是 `~/.pneuma/` 而不是 workspace 级？
- 偏好是**用户级**的，不是项目级的
- 同一个用户在不同 workspace 应该有一致的偏好体验
- 全局存储避免重复提取

---

## 四、Layer 2: Dynamic Skill Augmentation（动态 Skill 增强）

### 4.1 注入时机

```
pneuma slide --workspace ./my-deck
  │
  ├─ 1. Mode resolution（已有）
  ├─ 2. Load manifest（已有）
  ├─ 3. Load/create session（已有）
  │
  ├─ 4. ✨ Load user profile
  │     └─ ~/.pneuma/user-profile.json
  │
  ├─ 5. Skill installation（已有，增强）
  │     ├─ Copy skill files
  │     ├─ Apply template params
  │     ├─ ✨ Generate preferences.md
  │     ├─ Inject CLAUDE.md (4 sections now)
  │     └─ Install MCP servers
  │
  └─ 6. Agent launch（已有）
```

### 4.2 偏好注入方案

**方案：生成独立的 `preferences.md` 文件 + CLAUDE.md 新区段引用**

```typescript
// server/skill-installer.ts — 增强

function generatePreferencesFile(
  profile: UserProfile,
  mode: string,
  skillTarget: string,
): void {
  const modePrefs = profile.modes[mode];
  const globalPrefs = profile.global;
  
  if (!modePrefs && globalPrefs.customTraits.length === 0) return;
  
  const lines: string[] = [
    "# User Preferences (Auto-Generated)",
    "",
    "> These preferences were extracted from past sessions. Apply them as defaults,",
    "> but always defer to explicit user instructions in the current session.",
    "",
  ];
  
  // Global preferences
  if (globalPrefs.language) {
    lines.push(`## Communication`);
    lines.push(`- Language: ${globalPrefs.language}`);
    lines.push(`- Style: ${globalPrefs.communicationStyle}`);
    lines.push("");
  }
  
  if (globalPrefs.customTraits.length > 0) {
    lines.push("## General Preferences");
    for (const trait of globalPrefs.customTraits.filter(t => t.confidence >= 0.5)) {
      lines.push(`- ${trait.trait} (${trait.category})`);
    }
    lines.push("");
  }
  
  // Mode-specific preferences
  if (modePrefs) {
    if (modePrefs.styleTraits.length > 0) {
      lines.push(`## ${mode} Style Preferences`);
      // 按置信度排序，高置信度的偏好优先
      const sorted = [...modePrefs.styleTraits]
        .sort((a, b) => b.confidence - a.confidence);
      for (const trait of sorted.filter(t => t.confidence >= 0.5)) {
        lines.push(`- ${trait.trait}`);
      }
      lines.push("");
    }
    
    if (modePrefs.negativePatterns.length > 0) {
      lines.push("## Avoid These");
      for (const pattern of modePrefs.negativePatterns.slice(0, 10)) {
        lines.push(`- ${pattern}`);
      }
      lines.push("");
    }
    
    if (modePrefs.positivePatterns.length > 0) {
      lines.push("## Preferred Approaches");
      for (const pattern of modePrefs.positivePatterns.slice(0, 10)) {
        lines.push(`- ${pattern}`);
      }
      lines.push("");
    }
  }
  
  writeFileSync(join(skillTarget, "preferences.md"), lines.join("\n"), "utf-8");
}
```

### 4.3 CLAUDE.md 注入

新增第四个 marker 区段：

```markdown
<!-- pneuma:preferences:start -->
## User Preferences

This user has established preferences from previous sessions.
Read `{SKILL_PATH}/preferences.md` for their style preferences.
Apply these as defaults, but always defer to explicit instructions.
<!-- pneuma:preferences:end -->
```

### 4.4 SKILL.md 中的预留占位

在各 Mode 的 SKILL.md 中添加占位指引：

```markdown
## Personalization

If a `preferences.md` file exists in this skill directory, it contains
learned preferences from this user's past sessions. Treat these as:
- **Default values** — use them when the user hasn't specified otherwise
- **Not rules** — if the user explicitly asks for something different, follow their instruction
- **Context** — they help you understand what "good" looks like for this user
```

---

## 五、Layer 3: In-Session Adaptation（会话内实时适应）

### 5.1 设计哲学

Layer 3 **不需要额外基础设施**。它利用 Claude Code 的原生上下文窗口能力。

核心洞察：Claude 已经能在同一会话中"学习"——如果你在第 3 轮纠正它的字号选择，它在第 10 轮会记住。Layer 3 的目标是让这种学习**更显式、更可靠**。

### 5.2 实现方式：Feedback Signal Injection

```typescript
// server/ws-bridge.ts — 增强 handleUserMessage

function enrichUserMessage(
  content: string,
  history: BrowserIncomingMessage[],
): string {
  // 检测是否是纠正信号
  const prevAssistant = findLastAssistant(history);
  if (prevAssistant && isCorrectionMessage(content)) {
    // 注入显式的反馈标记，帮助 Agent 更好地理解纠正意图
    return `<session-feedback type="correction">
The user is correcting your previous output. Remember this preference for the rest of this session.
</session-feedback>

${content}`;
  }
  
  return content;
}
```

### 5.3 会话内偏好累积

当 Agent 在当前会话中被纠正多次后，在后续消息中注入"会话偏好摘要"：

```typescript
// 当纠正次数 >= 3 时，注入累积的偏好摘要
function generateSessionPreferenceSummary(
  corrections: CorrectionSignal[],
): string {
  if (corrections.length < 3) return "";
  
  return `<session-preferences>
Based on your corrections in this session:
${corrections.map(c => `- ${c.summary}`).join("\n")}
Please apply these going forward.
</session-preferences>`;
}
```

这比 Layer 1/2 轻量得多——不需要持久化，不需要 LLM 分析，只利用已有的消息流。

---

## 六、隐私与控制设计

### 6.1 原则

1. **本地优先** — 所有偏好数据存储在本地 `~/.pneuma/`，永不上传
2. **透明可控** — 用户可查看、编辑、删除偏好画像
3. **Opt-out** — 可完全禁用学习功能
4. **不存原文** — profile 只存摘要和 trait，不存原始对话内容

### 6.2 用户控制界面

Launcher 中新增 "Preferences" 面板：

```
┌────────────────────────────────────────────┐
│  ⚙ Your Preferences                       │
│                                            │
│  🌍 Global                                │
│    Language: zh-CN                         │
│    Style: concise                          │
│    • Prefers dark themes (92%)             │
│    • Likes generous whitespace (78%)       │
│    • Prefers sans-serif fonts (65%)    [✕] │
│                                            │
│  📊 Slide Mode (12 sessions)              │
│    • Prefers 16:9 aspect ratio (95%)       │
│    • Likes minimal text per slide (88%)    │
│    • Avoids emoji as icons (85%)           │
│    • Prefers Noto Sans font (72%)      [✕] │
│                                            │
│  📝 Doc Mode (8 sessions)                 │
│    • Prefers h2 over h3 nesting (70%)      │
│    • Likes code blocks with language (68%) │
│                                            │
│  [Reset All] [Disable Learning] [Export]   │
└────────────────────────────────────────────┘
```

### 6.3 CLI 控制

```bash
pneuma preferences show          # 查看当前画像
pneuma preferences reset          # 清除所有偏好
pneuma preferences reset --mode slide  # 清除特定 Mode 偏好
pneuma preferences export         # 导出为 JSON
pneuma preferences disable        # 禁用学习
```

---

## 七、实施路线图

### Phase 1（2~3 周）：数据管道 + 规则提取

**目标**：建立从"历史 → 信号 → 画像"的完整管道。

| 工作项 | 预估 | 优先级 |
|--------|------|--------|
| 定义 `UserProfile` / `UserTrait` 类型 | 0.5 天 | P0 |
| 实现 `preference-extractor.ts` — 规则引擎信号采集 | 2 天 | P0 |
| 实现画像合并 + 衰减逻辑 | 1 天 | P0 |
| 在 `bin/pneuma.ts` shutdown hook 中触发提取 | 0.5 天 | P0 |
| `~/.pneuma/user-profile.json` 读写 + 版本迁移 | 0.5 天 | P0 |
| 提取日志 (`extraction-log.jsonl`) | 0.5 天 | P1 |
| 单元测试：信号检测、画像合并、衰减 | 2 天 | P0 |
| **小计** | **~7 天** | |

### Phase 2（1~2 周）：动态注入 + SKILL.md 适配

**目标**：Session 启动时将偏好注入 Agent prompt。

| 工作项 | 预估 | 优先级 |
|--------|------|--------|
| `generatePreferencesFile()` 实现 | 1 天 | P0 |
| `skill-installer.ts` 增强：第四个 CLAUDE.md 区段 | 0.5 天 | P0 |
| 各 Mode SKILL.md 添加 personalization 指引 | 1 天 | P0 |
| `bin/pneuma.ts` 启动流程集成 user profile 加载 | 0.5 天 | P0 |
| `--no-preferences` CLI flag | 0.5 天 | P1 |
| 集成测试：完整 install→inject→agent 读取 流程 | 1 天 | P0 |
| **小计** | **~5 天** | |

### Phase 3（1 周）：会话内适应 + 反馈强化

**目标**：在当前会话中更好地利用纠正信号。

| 工作项 | 预估 | 优先级 |
|--------|------|--------|
| `ws-bridge.ts` 增强：correction detection + feedback injection | 1 天 | P0 |
| 会话偏好累积逻辑 | 1 天 | P1 |
| 测试：feedback 注入不破坏消息流 | 0.5 天 | P0 |
| **小计** | **~3 天** | |

### Phase 4（1 周）：用户控制 + 打磨

**目标**：让用户掌控学习过程。

| 工作项 | 预估 | 优先级 |
|--------|------|--------|
| Launcher "Preferences" 面板 UI | 2 天 | P0 |
| 偏好管理 API endpoints | 1 天 | P0 |
| `pneuma preferences` CLI 子命令 | 0.5 天 | P1 |
| 首次使用引导（opt-in 提示） | 0.5 天 | P1 |
| E2E 测试 | 1 天 | P1 |
| **小计** | **~5 天** | |

### 总计：~4~5 周

### 后续迭代（v2.1+）

| 特性 | 优先级 | 说明 |
|------|--------|------|
| LLM 辅助提取（Phase B） | P2 | 使用低成本模型做深层语义分析 |
| 偏好导入/导出 | P2 | 团队偏好共享 |
| 偏好冲突解决 | P2 | 全局 vs Mode 级偏好冲突时的优先级 |
| A/B 对比 | P3 | 有偏好 vs 无偏好的输出对比 |
| 外部 Mode 偏好 SDK | P3 | Mode 开发者可定义 extractable traits |

---

## 八、技术风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| 规则引擎提取精度不够 | 偏好噪声大 | 高置信度阈值（0.5+）+ 衰减机制自然清除误判 |
| preferences.md 过长占用 context window | Agent 性能下降 | 限制 top-N traits（max 20），按置信度排序截断 |
| 偏好与当前请求冲突 | Agent 行为混乱 | 明确指引："显式指令 > 偏好 > 默认值" |
| 跨 Mode 偏好泄露 | 不相关偏好影响输出 | 严格的 global vs mode-specific 分离 |
| 用户不想被"记住" | 隐私顾虑 | 默认 opt-in + 一键清除 + 完全禁用选项 |
| history.json 过大导致提取慢 | shutdown 延迟 | 只分析增量（上次提取后的新消息） |

---

## 九、成功指标

| 指标 | 衡量方法 | 目标 |
|------|---------|------|
| 纠正率下降 | 对比启用/禁用偏好时的 correction 消息比例 | -30% |
| 会话效率提升 | 平均 turns per task | -20% |
| 用户感知 | 偏好面板使用率（查看/编辑 vs 禁用） | 80%+ 查看, <10% 禁用 |
| 偏好覆盖率 | 经过 5+ 会话后，profile 中 trait 数量 | 5~15 traits per mode |
| 提取精度 | 用户主动删除 trait 的比例 | <20% |

---

## 十、与现有 Roadmap 的关系

**2.0 Continuous Learning 是独立于 Mode 扩展的正交工作线。**

```
v1.18 (current)
  │
  ├─ Mode 扩展线（可并行）
  │   ├─ site mode
  │   ├─ chart mode
  │   └─ flow mode
  │
  └─ 2.0 学习线（本 proposal）
      ├─ Phase 1: 数据管道
      ├─ Phase 2: 动态注入
      ├─ Phase 3: 会话适应
      └─ Phase 4: 用户控制
              │
              ▼
         v2.0.0 Release
```

新 Mode 的开发反而为学习系统提供更多训练数据——每个新 Mode 的对话历史都会被偏好提取管道处理，无需额外适配。Mode 扩展和学习系统完全解耦。

---

## 附录 A：关键文件影响清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `core/types/user-profile.ts` | **新增** | UserProfile, UserTrait, ModePreferences 类型 |
| `server/preference-extractor.ts` | **新增** | 提取管道：信号采集 + 分析 + 合并 |
| `server/skill-installer.ts` | **修改** | 新增 preferences.md 生成 + 第四个 CLAUDE.md 区段 |
| `bin/pneuma.ts` | **修改** | shutdown hook 触发提取 + 启动时加载 profile |
| `server/ws-bridge.ts` | **修改** | Layer 3 feedback injection |
| `modes/*/skill/SKILL.md` | **修改** | 添加 personalization 指引 |
| `src/components/PreferencesPanel.tsx` | **新增** | Launcher 偏好管理 UI |
| `server/index.ts` | **修改** | 偏好管理 API endpoints |

## 附录 B：现有 Skill 系统架构参考

```
Skill 安装流程（当前 v1.x）：

  ModeManifest.skill
    │
    ├─ sourceDir: "skill"          → modes/<mode>/skill/
    ├─ installName: "pneuma-slide" → .claude/skills/pneuma-slide/
    ├─ claudeMdSection: "..."      → CLAUDE.md <!-- pneuma:start -->
    ├─ envMapping: {...}           → .claude/skills/<name>/.env
    ├─ mcpServers: [...]           → .mcp.json
    └─ skillDependencies: [...]    → .claude/skills/<dep-name>/

  Template Engine:
    {{key}}              → simple replacement
    {{#key}}...{{/key}}  → conditional block
    
  CLAUDE.md Sections:
    <!-- pneuma:start -->           ← Mode identity
    <!-- pneuma:viewer-api:start --> ← Viewer capabilities
    <!-- pneuma:skills:start -->     ← Skill dependencies
    <!-- pneuma:preferences:start --> ← ✨ User preferences (v2.0)
```
