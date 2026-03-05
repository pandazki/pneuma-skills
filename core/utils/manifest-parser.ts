/**
 * Manifest Parser — extract key fields from manifest.ts source text via regex.
 *
 * Since manifest.ts is a pure data declaration with a fixed structure,
 * regex extraction is reliable and avoids runtime TS evaluation.
 */

export interface ParsedManifest {
  name?: string;
  version?: string;
  displayName?: string;
  description?: string;
  icon?: string;
  watchPatterns?: string[];
  installName?: string;
  workspaceType?: string;
}

/** Extract a single string field value: `fieldName: "value"` or `fieldName: 'value'` */
function extractString(source: string, field: string): string | undefined {
  const re = new RegExp(`${field}:\\s*["'\`]([^"'\`]*)["'\`]`);
  return re.exec(source)?.[1];
}

/** Extract a backtick template string field: `` fieldName: `value` `` (may span multiple lines) */
function extractBacktickString(source: string, field: string): string | undefined {
  const re = new RegExp(`${field}:\\s*\`([^\`]*)\``,"s");
  return re.exec(source)?.[1]?.trim();
}

/** Extract a string array field: `fieldName: ["a", "b"]` */
function extractStringArray(source: string, field: string): string[] | undefined {
  const re = new RegExp(`${field}:\\s*\\[([^\\]]*?)\\]`, "s");
  const match = re.exec(source);
  if (!match) return undefined;
  const items: string[] = [];
  const itemRe = /["'`]([^"'`]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(match[1])) !== null) {
    items.push(m[1]);
  }
  return items.length > 0 ? items : undefined;
}

/**
 * Parse a manifest.ts source file and extract key metadata.
 * Uses regex — no TS compiler or eval needed.
 */
export function parseManifestTs(content: string): ParsedManifest {
  return {
    name: extractString(content, "name"),
    version: extractString(content, "version"),
    displayName: extractString(content, "displayName"),
    description: extractString(content, "description"),
    icon: extractBacktickString(content, "icon") || extractString(content, "icon"),
    watchPatterns: extractStringArray(content, "watchPatterns"),
    installName: extractString(content, "installName"),
    workspaceType: extractString(content, "type"),
  };
}
