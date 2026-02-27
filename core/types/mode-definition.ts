/**
 * ModeDefinition — 运行时 Mode 对象
 *
 * 将 ModeManifest (声明式配置) 和 ViewerContract (UI 组件) 绑定在一起。
 * 由 Mode 包的入口文件默认导出。
 *
 * @example
 * ```typescript
 * // modes/doc/pneuma-mode.ts
 * import type { ModeDefinition } from "../../core/types/mode-definition.js";
 *
 * const docMode: ModeDefinition = {
 *   manifest: { name: "doc", version: "0.5.0", ... },
 *   viewer: { PreviewComponent: DocPreview, ... },
 * };
 *
 * export default docMode;
 * ```
 */

import type { ModeManifest } from "./mode-manifest.js";
import type { ViewerContract } from "./viewer-contract.js";

/** 运行时的完整 Mode 定义 */
export interface ModeDefinition {
  /** 声明式配置 */
  manifest: ModeManifest;
  /** 内容查看器实现 */
  viewer: ViewerContract;
}
