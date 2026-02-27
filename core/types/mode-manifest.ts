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
