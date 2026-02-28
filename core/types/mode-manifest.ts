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

  /** Skill 注入配置 */
  skill: SkillConfig;
  /** 内容查看器配置 */
  viewer: ViewerConfig;
  /** Agent 偏好配置 (可选) */
  agent?: AgentPreferences;
  /** 工作区初始化配置 (可选) */
  init?: InitConfig;
}
