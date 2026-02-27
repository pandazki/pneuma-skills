/**
 * Mode Loader — 解析、安装、加载 Mode。
 *
 * v1.0: 只支持 builtin mode，通过动态 import 加载。
 * v1.x: 支持 local path 和 remote URL。
 *
 * 核心流程: resolveMode → ensureInstalled → loadFromSource
 */

import type { ModeManifest } from "./types/mode-manifest.js";
import type { ModeDefinition } from "./types/mode-definition.js";

/**
 * Mode 来源类型:
 * - "builtin" — 内置 mode，从 modes/ 目录动态 import
 */
type ModeSource = {
  type: "builtin";
  manifestLoader: () => Promise<ModeManifest>;
  definitionLoader: () => Promise<ModeDefinition>;
};
// v1.x:
// | { type: "local"; path: string }
// | { type: "remote"; url: string }

/** 内置 mode 注册表 — 全部使用动态 import */
const builtinModes: Record<string, ModeSource> = {
  doc: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/doc/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/doc/pneuma-mode.js").then((m) => m.default),
  },
  // slide: {
  //   type: "builtin",
  //   manifestLoader: () => import("../modes/slide/manifest.js").then(m => m.default),
  //   definitionLoader: () => import("../modes/slide/pneuma-mode.js").then(m => m.default),
  // },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 加载 Mode 的完整定义 (manifest + viewer)。
 * 前端使用 — 需要 PreviewComponent。
 */
export async function loadMode(name: string): Promise<ModeDefinition> {
  const source = resolveMode(name);
  await ensureInstalled(source);
  return loadDefinition(source);
}

/**
 * 只加载 Mode 的 manifest (不含 React 组件)。
 * 后端使用 — 只需要配置信息。
 */
export async function loadModeManifest(name: string): Promise<ModeManifest> {
  const source = resolveMode(name);
  await ensureInstalled(source);
  return source.manifestLoader();
}

/**
 * 列出所有已注册的 mode 名称。
 */
export function listModes(): string[] {
  return Object.keys(builtinModes);
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** 解析 mode 来源 (v1.0: 只查 builtin 注册表) */
function resolveMode(name: string): ModeSource {
  const source = builtinModes[name];
  if (!source) {
    const available = Object.keys(builtinModes).join(", ");
    throw new Error(`Unknown mode: "${name}". Available: ${available}`);
  }
  return source;
}

/** 确保 mode 已安装 (v1.0: builtin 直接跳过) */
async function ensureInstalled(_source: ModeSource): Promise<void> {
  if (_source.type === "builtin") return;
  // v1.x: 检查 .pneuma/modes/{name}/ 是否存在
  //        不存在 → 从 source.url 拉取/安装
  //        非信任来源 → 用户确认
}

/** 从已安装的 source 加载完整 ModeDefinition */
async function loadDefinition(source: ModeSource): Promise<ModeDefinition> {
  if (source.type === "builtin") return source.definitionLoader();
  // v1.x: dynamic import from .pneuma/modes/{name}/pneuma-mode.js
  throw new Error("Non-builtin mode loading not yet implemented");
}
