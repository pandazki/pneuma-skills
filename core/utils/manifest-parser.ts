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

/**
 * Find a top-level field on the manifest object. "Top-level" means the
 * field sits at the manifest literal's first nesting depth — in the
 * canonical formatting that is exactly two spaces of leading indent.
 * Returns either the string literal value, or the object body (for
 * further locale parsing). Returning `undefined` means the field is
 * absent at the top level.
 *
 * The strict 2-space match prevents nested fields with the same name
 * (e.g. `params: [{ description: "..." }]`) from being mistaken for the
 * top-level definition.
 */
function findTopLevelField(
  source: string,
  field: string,
): { kind: "string"; value: string } | { kind: "object"; body: string } | undefined {
  const lineStart = `^  ${field}:\\s*`;

  const stringRe = new RegExp(lineStart + `["'\`]([^"'\`]*)["'\`]`, "m");
  const sm = stringRe.exec(source);
  if (sm) return { kind: "string", value: sm[1] };

  const objStartRe = new RegExp(lineStart + `\\{`, "m");
  const om = objStartRe.exec(source);
  if (!om) return undefined;

  // Walk from the opening brace, tracking brace depth and string state,
  // to find the matching close. Sturdier than a greedy regex that
  // breaks the moment the object contains any nested literal.
  let depth = 1;
  let i = om.index + om[0].length;
  let inString: string | null = null;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
    } else {
      if (c === '"' || c === "'" || c === "`") inString = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    i++;
  }
  if (depth !== 0) return undefined;
  const body = source.slice(om.index + om[0].length, i - 1);
  return { kind: "object", body };
}

/**
 * Extract a localized top-level string field. Accepts either form:
 *   `field: "plain"` → returns "plain" for any locale
 *   `field: { en: "...", "zh-CN": "...", ja: "..." }` → returns matching locale
 * Fallback order: requested locale → `en` → first non-empty.
 *
 * Anchored to top-level so nested same-name fields (e.g. `params.description`)
 * cannot leak into the result.
 */
function extractLocalizedString(source: string, field: string, locale: string): string | undefined {
  const found = findTopLevelField(source, field);
  if (!found) return undefined;
  if (found.kind === "string") return found.value;

  const block = found.body;
  const tryKeys = [locale, "en"];
  for (const key of tryKeys) {
    const keyRe = new RegExp(`["']?${key}["']?\\s*:\\s*["'\`]([^"'\`]*)["'\`]`);
    const m = keyRe.exec(block);
    if (m && m[1]) return m[1];
  }
  const anyRe = /["']?([\w-]+)["']?\s*:\s*["'`]([^"'`]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = anyRe.exec(block)) !== null) {
    if (m[2]) return m[2];
  }
  return undefined;
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

/**
 * Parse a manifest.ts source file and extract key metadata.
 * Uses regex — no TS compiler or eval needed.
 *
 * `locale` controls which value is picked for fields that accept a
 * LocalizedString (displayName, description). Default "en". The same parsed
 * file can be passed through multiple times with different locales.
 */
export function parseManifestTs(content: string, locale: string = "en"): ParsedManifest {
  return {
    name: extractString(content, "name"),
    version: extractString(content, "version"),
    displayName: extractLocalizedString(content, "displayName", locale),
    description: extractLocalizedString(content, "description", locale),
    icon: extractBacktickString(content, "icon") || extractString(content, "icon"),
    watchPatterns: extractStringArray(content, "watchPatterns"),
    installName: extractString(content, "installName"),
    workspaceType: extractString(content, "type"),
    layout: extractString(content, "layout"),
    inspiredBy: extractInspiredBy(content),
    hidden: extractBoolean(content, "hidden"),
  };
}
