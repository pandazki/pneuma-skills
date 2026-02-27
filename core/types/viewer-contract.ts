/**
 * ViewerContract — 内容查看器契约
 *
 * 定义内容查看器的 UI 能力：查看、编辑、交互捕捉、热更新。
 * 每个 Mode 提供一个实现此接口的对象。
 * Runtime Shell 通过此接口渲染预览和处理用户交互。
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
}

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
}
