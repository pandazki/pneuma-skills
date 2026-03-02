/**
 * ViewerContract — Agent-Human Alignment Protocol
 *
 * ViewerContract 的核心职责是 Agent-Human 对齐：
 * 1. 感知对齐 — Agent 能看到 User 看到的东西 (extractContext, workspace)
 * 2. 能力对齐 — Agent 能做到 User 能做到的事情 (actions)
 *
 * 每个 Mode 提供一个实现此接口的对象。
 * Runtime Shell 通过此接口渲染预览、处理用户交互、桥接 Agent 操作。
 */

import type { ComponentType } from "react";

/** 文件内容 (与 src/types.ts 中的 FileContent 保持一致) */
export interface ViewerFileContent {
  path: string;
  content: string;
}

/** 选中上下文 (与 src/types.ts 中的 SelectionContext 保持一致) */
export interface ViewerSelectionContext {
  type: string;
  content: string;
  file?: string;
  level?: number;
  /** HTML tag name (e.g. "div", "section", "h2") */
  tag?: string;
  /** CSS class list (e.g. "card bg-white rounded-lg") */
  classes?: string;
  /** Unique CSS selector path (e.g. "section.hero > div.card:nth-child(2)") */
  selector?: string;
  /** SVG data URL thumbnail of the selected element (null if capture failed or element too large) */
  thumbnail?: string;
  /** 可见视窗行范围（仅 Doc 等文本 mode 使用） */
  viewport?: { startLine: number; endLine: number; heading?: string };
}

// ── File Workspace Model ───────────────────────────────────────────────────

/** 工作区项 — 文件导航模型中的一个逻辑单元 */
export interface WorkspaceItem {
  path: string;
  label: string;
  index?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 文件工作区模型 — 描述 Viewer 如何组织文件。
 *
 * - "all": 所有匹配文件平等展示 (Doc: 每个 .md 独立)
 * - "manifest": 由索引文件定义结构和顺序 (Slide: manifest.json)
 * - "single": 只操作一个主文件 (Draw: 单个 .excalidraw)
 */
export interface FileWorkspaceModel {
  type: "all" | "manifest" | "single";
  multiFile: boolean;
  ordered: boolean;
  hasActiveFile: boolean;
  /** type="manifest" 时的索引文件 */
  manifestFile?: string;
  /** 从文件列表解析工作区项（前端运行时使用） */
  resolveItems?: (files: ViewerFileContent[]) => WorkspaceItem[];
}

// ── Viewer Action (能力对齐) ───────────────────────────────────────────────

/** Viewer 操作参数描述 */
export interface ViewerActionParam {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

/**
 * Viewer 操作描述 — 能力对齐的基本单元。
 *
 * Viewer 声明自己支持的操作，Agent 通过执行通道调用。
 * 无论是 "导航到第 3 页"、"收起 outline"、还是 "截图当前视图"，
 * 对框架来说都是 action。
 */
export interface ViewerActionDescriptor {
  id: string;
  label: string;
  category: "file" | "navigate" | "ui" | "custom";
  agentInvocable: boolean;
  params?: Record<string, ViewerActionParam>;
  description?: string;
}

/** 执行通道中的请求 */
export interface ViewerActionRequest {
  requestId: string;
  actionId: string;
  params?: Record<string, unknown>;
}

/** 执行结果 */
export interface ViewerActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// ── Preview Props & Contract ───────────────────────────────────────────────

/** 预览组件的 Props */
export interface ViewerPreviewProps {
  /** 工作区文件列表 */
  files: ViewerFileContent[];
  /** 当前选中的元素 */
  selection: ViewerSelectionContext | null;
  /** 选中元素回调 */
  onSelect: (selection: ViewerSelectionContext | null) => void;
  /** 预览模式: view (只读) / edit (行内编辑) / select (选中捕捉) */
  mode: "view" | "edit" | "select";
  /** 内容版本号 (文件变更时递增，用于缓存失效) — 可选，部分 Viewer 不需要 */
  contentVersion?: number;
  /** 图片版本号 (图片变更时递增，用于图片缓存失效) */
  imageVersion: number;
  /** Mode 初始化参数（不可变，会话生命周期内固定） */
  initParams?: Record<string, number | string>;
  /** 当前查看的文件变更时的回调（用于追踪活跃文件上下文） */
  onActiveFileChange?: (file: string | null) => void;
  /** 由 runtime 通过 workspace.resolveItems 计算后传入 */
  workspaceItems?: WorkspaceItem[];
  /** Runtime 下发的 action 请求，Viewer 执行后调用 onActionResult 返回结果 */
  actionRequest?: ViewerActionRequest | null;
  /** Viewer 执行 action 后返回结果的回调 */
  onActionResult?: (requestId: string, result: ViewerActionResult) => void;
  /** 视窗变更回调 — Viewer 上报当前可见范围 */
  onViewportChange?: (viewport: { file: string; startLine: number; endLine: number; heading?: string }) => void;
}

/** 内容查看器的 UI 契约 */
export interface ViewerContract {
  /** 预览组件 — 渲染内容的 React 组件 */
  PreviewComponent: ComponentType<ViewerPreviewProps>;

  /**
   * 从用户选中状态提取上下文文本。
   * 返回的文本会被注入到 user_message 的前缀中，
   * 让 Agent 了解用户当前的视觉焦点。
   *
   * @param selection 当前选中的元素 (null 表示无选中)
   * @param files 当前工作区文件列表
   * @returns 上下文文本 (空字符串表示无上下文)
   */
  extractContext(
    selection: ViewerSelectionContext | null,
    files: ViewerFileContent[],
  ): string;

  /** 文件变更时的更新策略 */
  updateStrategy: "full-reload" | "incremental";

  /** 文件工作区模型 — 描述 Viewer 如何组织文件 */
  workspace?: FileWorkspaceModel;

  /** Viewer 支持的操作 — Agent 可通过执行通道调用 */
  actions?: ViewerActionDescriptor[];

  /** 捕获当前视窗截图（可选，由 PreviewComponent 在 mount 后动态注入实现） */
  captureViewport?: () => Promise<{ data: string; media_type: string } | null>;
}
