/**
 * ModeDefinition — Runtime Mode object
 *
 * Binds ModeManifest (declarative config) and ViewerContract (UI component) together.
 * Default-exported from the Mode package's entry file.
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

/** Complete runtime Mode definition */
export interface ModeDefinition {
  /** Declarative configuration */
  manifest: ModeManifest;
  /** Content viewer implementation */
  viewer: ViewerContract;
}
