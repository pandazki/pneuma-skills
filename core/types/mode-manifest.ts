/**
 * ModeManifest — 能力描述协议
 *
 * Mode 的声明式描述，定义了一个 Mode 的完整配置。
 * 由 Mode 包提供，Runtime Shell 读取并驱动启动流程。
 *
 * @example
 * ```typescript
 * const manifest: ModeManifest = {
 *   name: "doc",
 *   version: "0.5.0",
 *   displayName: "Document",
 *   description: "Markdown document editing with live preview",
 *   skill: { ... },
 *   viewer: { ... },
 * };
 * ```
 */

/** MCP 服务器声明 — skill 安装时自动注册到 workspace 的 .mcp.json */
export interface McpServerConfig {
  /** 服务器名称（.mcp.json 中 mcpServers 的 key） */
  name: string;
  /** stdio: 执行命令 */
  command?: string;
  /** stdio: 命令参数（支持 {{param}} 模板） */
  args?: string[];
  /**
   * 环境变量。值支持：
   * - {{param}} — 替换为 init param 值
   * - ${VAR} — 原样写入，Claude Code 运行时从进程 env 解析
   */
  env?: Record<string, string>;
  /** HTTP 服务器 URL */
  url?: string;
  /** HTTP 请求头（支持 {{param}} 模板） */
  headers?: Record<string, string>;
}

/** 外部 Skill 依赖声明 — skill 安装时自动拷贝到 .claude/skills/ */
export interface SkillDependency {
  /** Skill 名称（安装到 .claude/skills/<name>/） */
  name: string;
  /** Skill 来源：相对于 mode 包根目录的路径（包含 SKILL.md 的目录） */
  sourceDir: string;
  /**
   * 注入 CLAUDE.md 的描述片段（可选）。
   * 放在 <!-- pneuma:skills:start --> / <!-- pneuma:skills:end --> 标记内。
   * 如果不提供，自动从 SKILL.md 第一行 heading 提取摘要。
   */
  claudeMdSnippet?: string;
}

/** Skill 注入配置 — 描述如何将 Mode 的领域知识安装到 workspace */
export interface SkillConfig {
  /** Skill 源目录 (相对于 mode 包根目录) */
  sourceDir: string;
  /** 安装到 .claude/skills/ 下的目录名 (e.g. "pneuma-doc") */
  installName: string;
  /** 注入 CLAUDE.md 的内容片段 (不含 marker 注释) */
  claudeMdSection: string;
  /**
   * 环境变量文件映射 — 安装 skill 时自动生成 .env 文件。
   * key: 环境变量名 (e.g. "OPENROUTER_API_KEY")
   * value: 对应的 init param 名 (e.g. "openrouterApiKey")
   * 只有非空值的参数才会写入 .env。
   */
  envMapping?: Record<string, string>;
  /** MCP 服务器声明 — 安装时自动写入 workspace 的 .mcp.json */
  mcpServers?: McpServerConfig[];
  /** 外部 Skill 依赖 — 安装时自动拷贝到 .claude/skills/ */
  skillDependencies?: SkillDependency[];
}

/** 内容查看器配置 — 描述 Mode 的文件监听和服务规则 */
export interface ViewerConfig {
  /** 文件监听的 glob patterns (e.g. ["**\/*.md"]) */
  watchPatterns: string[];
  /** 忽略的 glob patterns (e.g. ["node_modules/**"]) */
  ignorePatterns: string[];
  /** 需要 HTTP 服务的子目录 (相对于 workspace，默认 ".") */
  serveDir?: string;
}

/** Agent 偏好配置 — 描述 Mode 对 Agent 行为的期望 */
export interface AgentPreferences {
  /** 权限模式 (默认 "bypassPermissions") */
  permissionMode?: string;
  /** 新会话自动问候语模板 (由 Agent 生成回复) */
  greeting?: string;
}

/** 模式初始化参数声明 — 在首次启动时交互式询问用户 */
export interface InitParam {
  /** 参数名，同时作为模板占位符 key (e.g. "slideWidth") */
  name: string;
  /** 交互式询问时的显示标签 (e.g. "Slide width") */
  label: string;
  /** 补充说明 (e.g. "pixels") */
  description?: string;
  /** 参数类型 */
  type: "number" | "string";
  /** 默认值 */
  defaultValue: number | string;
  /** 标记为敏感值 (API key 等)，snapshot 打包时会被清空 */
  sensitive?: boolean;
}

/** 工作区初始化配置 — 描述空 workspace 时的初始化行为 */
export interface InitConfig {
  /**
   * 判断 workspace 是否有内容的 glob pattern。
   * 匹配到至少一个非空文件时认为有内容，跳过种子文件。
   */
  contentCheckPattern?: string;
  /**
   * 空 workspace 时的种子文件。
   * key: 目标相对路径 (相对于 workspace)
   * value: 源文件相对路径 (相对于项目根目录)
   */
  seedFiles?: Record<string, string>;
  /**
   * 模式初始化参数。首次启动时交互式询问用户，结果持久化到 .pneuma/config.json。
   * 参数值通过 {{name}} 模板替换注入到 skill 文件和 seed 文件中。
   */
  params?: InitParam[];
  /**
   * 从用户提供的参数派生额外参数。
   * 在交互式参数收集之后、模板替换之前调用。
   * 用于计算条件变量 (e.g. imageGenEnabled) 等衍生值。
   */
  deriveParams?: (params: Record<string, number | string>) => Record<string, number | string>;
}

/** Viewer 自描述 API — 纯数据声明，后端 (pneuma.ts / skill-installer) 可读 */
export interface ViewerApiConfig {
  workspace?: {
    type: "all" | "manifest" | "single";
    multiFile: boolean;
    ordered: boolean;
    hasActiveFile: boolean;
    manifestFile?: string;
    /** If true, the workspace supports multiple content sets (e.g. locale/theme directories) */
    supportsContentSets?: boolean;
  };
  actions?: Array<{
    id: string;
    label: string;
    category: "file" | "navigate" | "ui" | "custom";
    agentInvocable: boolean;
    params?: Record<string, { type: "string" | "number" | "boolean"; description: string; required?: boolean }>;
    description?: string;
  }>;
  /** Locator cards — clickable navigation targets in agent messages.
   *  When set, instructions for `<viewer-locator>` tags are injected into CLAUDE.md. */
  locatorDescription?: string;
  /** Scaffold — workspace initialization/reset capability. Requires user confirmation in browser. */
  scaffold?: {
    description: string;
    params: Record<string, { type: "string" | "number" | "boolean"; description: string; required?: boolean }>;
    clearPatterns: string[];
  };
}

/**
 * Skill 演进配置 — 定义 Evolution Agent 的目标方向和可用工具。
 *
 * Evolution Agent 是一个独立的 Agent 过程，分析用户历史并增强 skill 文件。
 * 它输出一个 proposal（附带证据和引用），用户审核后可 apply 或取消。
 */
export interface EvolutionConfig {
  /**
   * 演进方向 — 给 Evolution Agent 的目标描述。
   * 告诉 Agent 这个 Mode 的 skill 应该朝什么方向个性化。
   *
   * @example
   * "Learn the user's presentation style preferences: typography choices,
   *  color palette tendencies, layout density, slide structure patterns.
   *  Augment the skill to guide the main agent toward these preferences
   *  as defaults while respecting explicit user instructions."
   */
  directive: string;

  /**
   * 额外的数据获取工具（预留，第一版不实现）。
   * 框架已内置基础工具（读取 CC 历史等），这里声明 Mode 特有的。
   */
  tools?: EvolutionTool[];
}

/**
 * Evolution Agent 可用的外部数据获取工具（预留）。
 * 第一版不实现，框架内置工具足够。
 */
export interface EvolutionTool {
  /** 工具名称 */
  name: string;
  /** 工具描述（给 Agent 看的） */
  description: string;
  /** 实现方式 */
  type: "command" | "http" | "mcp";
  /** 具体配置 */
  config: Record<string, unknown>;
}

/** Showcase highlight — a single feature to display in the carousel */
export interface ShowcaseHighlight {
  /** Feature title (e.g. "Responsive Preview") */
  title: string;
  /** Short description (1-2 sentences) */
  description: string;
  /** Media file path relative to showcase/ directory */
  media: string;
  /** Media type — determines rendering (default: "image") */
  mediaType?: "image" | "gif" | "video";
}

/**
 * Mode showcase configuration — rich marketing content for the launcher gallery.
 * Assets are stored in the mode's `showcase/` directory and served via
 * `GET /api/modes/:name/showcase/*`.
 */
export interface ModeShowcase {
  /** Short tagline shown under the mode name (e.g. "17 AI design commands") */
  tagline?: string;
  /** Hero image path relative to showcase/ directory (16:9 recommended) */
  hero?: string;
  /** Feature highlights — displayed as a carousel with hover-to-switch */
  highlights?: ShowcaseHighlight[];
}

/** Mode 的完整声明式描述 */
export interface ModeManifest {
  /** Mode 唯一标识 (e.g. "doc", "slide") */
  name: string;
  /** 语义化版本号 */
  version: string;
  /** 人类可读的显示名 (e.g. "Document") */
  displayName: string;
  /** 简短描述 */
  description: string;
  /** Mode icon as inline SVG string (e.g. `<svg viewBox="0 0 24 24">...</svg>`) */
  icon?: string;

  /** Skill 注入配置 */
  skill: SkillConfig;
  /** 内容查看器配置 */
  viewer: ViewerConfig;
  /** Agent 偏好配置 (可选) */
  agent?: AgentPreferences;
  /** 工作区初始化配置 (可选) */
  init?: InitConfig;
  /** Viewer 自描述 API — 纯数据声明，后端可读，自动注入 CLAUDE.md */
  viewerApi?: ViewerApiConfig;
  /** Skill 演进配置 — 定义 Evolution Agent 的演进方向 (可选) */
  evolution?: EvolutionConfig;
  /** Showcase — rich marketing content for launcher gallery (optional) */
  showcase?: ModeShowcase;
  /** Supported agent backends. When omitted, all implemented backends are allowed. */
  supportedBackends?: string[];
}
