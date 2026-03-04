/**
 * Content Set Resolver — 从工作区文件树发现可编辑的内容集合。
 *
 * 内容集合 = 顶层目录，目录名按约定解析 locale 和 theme。
 * Mode 一行接入: `resolveContentSets: createDirectoryContentSetResolver()`
 */

import type { ContentSet, ContentSetTraits, ViewerFileContent } from "../types/viewer-contract.js";

export interface DirectoryContentSetOptions {
  /**
   * 自定义目录名解析。返回 null 表示排除该目录。
   * 默认: 按 "-"/"_" 分割，识别已知 locale 和 theme。
   */
  parseName?: (dirName: string) => (ContentSetTraits & { label?: string }) | null;
  /** 目录至少包含多少文件才算有效内容集合 (默认 1) */
  minFiles?: number;
  /** 只考虑匹配此正则的目录 */
  dirPattern?: RegExp;
}

/** Well-known BCP-47 language codes for auto-detection */
const KNOWN_LOCALES = new Set([
  "en", "ja", "zh", "ko", "fr", "de", "es", "pt", "it", "ru",
  "ar", "nl", "sv", "pl", "tr", "vi", "th", "id",
]);

/** Default name parser: splits on "-"/"_", detects locale and theme. */
function defaultParseName(dirName: string): (ContentSetTraits & { label?: string }) | null {
  const parts = dirName.toLowerCase().split(/[-_]/);
  const traits: ContentSetTraits = {};
  const labelParts: string[] = [];

  for (const part of parts) {
    if (part === "light" || part === "dark") {
      traits.theme = part;
      labelParts.push(part.charAt(0).toUpperCase() + part.slice(1));
    } else if (KNOWN_LOCALES.has(part)) {
      traits.locale = part;
      labelParts.push(part.toUpperCase());
    } else {
      labelParts.push(part.charAt(0).toUpperCase() + part.slice(1));
    }
  }

  return { ...traits, label: labelParts.join(" ") };
}

/**
 * Create a resolveContentSets function that discovers content sets
 * from the top-level directory structure.
 *
 * Returns empty array if fewer than 2 valid content set directories are found.
 */
export function createDirectoryContentSetResolver(
  options: DirectoryContentSetOptions = {},
): (files: ViewerFileContent[]) => ContentSet[] {
  const parseName = options.parseName ?? defaultParseName;
  const minFiles = options.minFiles ?? 1;
  const dirPattern = options.dirPattern;

  return (files: ViewerFileContent[]): ContentSet[] => {
    // Collect top-level directories and their file counts
    const dirFileCounts = new Map<string, number>();

    for (const file of files) {
      const slashIdx = file.path.indexOf("/");
      if (slashIdx > 0) {
        const topDir = file.path.slice(0, slashIdx);
        dirFileCounts.set(topDir, (dirFileCounts.get(topDir) ?? 0) + 1);
      }
    }

    // Filter and parse directories
    const sets: ContentSet[] = [];
    for (const [dirName, count] of dirFileCounts) {
      if (dirName.startsWith(".")) continue; // Skip hidden directories
      if (count < minFiles) continue;
      if (dirPattern && !dirPattern.test(dirName)) continue;

      const parsed = parseName(dirName);
      if (!parsed) continue;

      const { label, ...traits } = parsed;
      sets.push({
        prefix: dirName,
        label: label || dirName,
        traits,
      });
    }

    // Only return content sets if 2+ found — one directory isn't a switchable set
    if (sets.length < 2) return [];

    // Sort by prefix for stable ordering
    sets.sort((a, b) => a.prefix.localeCompare(b.prefix));
    return sets;
  };
}
