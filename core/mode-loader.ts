/**
 * Mode Loader — 解析、安装、加载 Mode。
 *
 * 支持三种来源:
 * - builtin: 内置 mode，从 modes/ 目录动态 import
 * - local: 本地文件系统路径
 * - github: GitHub 仓库 (通过 mode-resolver 克隆到本地缓存)
 *
 * 核心流程: resolveMode → ensureInstalled → loadFromSource
 */

import type { ModeManifest } from "./types/mode-manifest.js";
import type { ModeDefinition } from "./types/mode-definition.js";

/**
 * Mode 来源类型:
 * - "builtin" — 内置 mode，从 modes/ 目录动态 import
 * - "external" — 外部 mode，从绝对路径动态 import (local path 或 github clone)
 */
type ModeSource =
  | {
      type: "builtin";
      manifestLoader: () => Promise<ModeManifest>;
      definitionLoader: () => Promise<ModeDefinition>;
    }
  | {
      type: "external";
      name: string;
      path: string;
      manifestLoader: () => Promise<ModeManifest>;
      definitionLoader: () => Promise<ModeDefinition>;
    };

/** 内置 mode 注册表 — 全部使用动态 import */
const builtinModes: Record<string, ModeSource> = {
  doc: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/doc/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/doc/pneuma-mode.js").then((m) => m.default),
  },
  slide: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/slide/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/slide/pneuma-mode.js").then((m) => m.default),
  },
  draw: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/draw/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/draw/pneuma-mode.js").then((m) => m.default),
  },
};

/** 外部 mode 注册表 — 由 CLI 在启动时通过 registerExternalMode 注册 */
const externalModes: Record<string, ModeSource> = {};

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
 * 列出所有已注册的 mode 名称 (包括 builtin 和已注册的 external)。
 */
export function listModes(): string[] {
  return [...Object.keys(builtinModes), ...Object.keys(externalModes)];
}

/**
 * 列出内置 mode 名称。
 */
export function listBuiltinModes(): string[] {
  return Object.keys(builtinModes);
}

/**
 * 注册外部 mode (由 CLI 在启动时调用)。
 *
 * Backend context (Bun): 直接用 import() 加载绝对路径。
 * Frontend context (browser/Vite): 用 /@fs/ URL 加载。
 *
 * @param name — Mode 名称 (用于注册和查找)
 * @param absPath — Mode 包的绝对路径
 */
export function registerExternalMode(name: string, absPath: string): void {
  const isBrowser = typeof window !== "undefined";

  if (isBrowser) {
    // Frontend: use Vite's /@fs/ URL scheme for dev mode
    externalModes[name] = {
      type: "external",
      name,
      path: absPath,
      manifestLoader: () =>
        import(/* @vite-ignore */ `/@fs${absPath}/manifest.ts`).then(
          (m) => m.default,
        ),
      definitionLoader: () =>
        import(/* @vite-ignore */ `/@fs${absPath}/pneuma-mode.ts`).then(
          (m) => m.default,
        ),
    };
  } else {
    // Backend (Bun): use direct absolute path import
    externalModes[name] = {
      type: "external",
      name,
      path: absPath,
      manifestLoader: () =>
        import(/* @vite-ignore */ absPath + "/manifest.ts").then((m) => m.default),
      definitionLoader: () =>
        import(/* @vite-ignore */ absPath + "/pneuma-mode.ts").then((m) => m.default),
    };
  }
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** 解析 mode 来源 (查 builtin 和 external 注册表) */
function resolveMode(name: string): ModeSource {
  // Check external modes first (allows overriding builtin names)
  const external = externalModes[name];
  if (external) return external;

  const builtin = builtinModes[name];
  if (builtin) return builtin;

  const available = listModes();
  throw new Error(
    `Unknown mode: "${name}". Available: ${available.join(", ")}`,
  );
}

/** 确保 mode 已安装 (builtin 直接跳过，external 已由 mode-resolver 处理) */
async function ensureInstalled(_source: ModeSource): Promise<void> {
  // Both builtin and external modes are already resolved to local paths
  return;
}

/** 从已安装的 source 加载完整 ModeDefinition */
async function loadDefinition(source: ModeSource): Promise<ModeDefinition> {
  return source.definitionLoader();
}
