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
  layout?: string;
  inspiredBy?: { name: string; url: string };
  /** Internal mode — hidden from user-pickable mode lists. See ModeManifest.hidden. */
  hidden?: boolean;
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
/** Extract the inspiredBy object: `inspiredBy: { name: "...", url: "..." }` */
function extractInspiredBy(source: string): { name: string; url: string } | undefined {
  const re = /inspiredBy:\s*\{([^}]*)\}/s;
  const match = re.exec(source);
  if (!match) return undefined;
  const block = match[1];
  const name = extractString(block, "name");
  const url = extractString(block, "url");
  if (name && url) return { name, url };
  return undefined;
}

/** Extract a boolean literal field: `fieldName: true` / `fieldName: false`. */
function extractBoolean(source: string, field: string): boolean | undefined {
  const re = new RegExp(`${field}:\\s*(true|false)\\b`);
  const match = re.exec(source);
  if (!match) return undefined;
  return match[1] === "true";
}

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
    layout: extractString(content, "layout"),
    inspiredBy: extractInspiredBy(content),
    hidden: extractBoolean(content, "hidden"),
  };
}
