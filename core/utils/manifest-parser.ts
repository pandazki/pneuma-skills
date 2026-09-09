/**
 * Manifest Parser — extract key fields from manifest.ts source text via regex.
 *
 * Since manifest.ts is a pure data declaration with a fixed structure,
 * regex extraction is reliable and avoids runtime TS evaluation.
 */

export interface ParsedManifest {
  name?: string;
  version?: string;
  /**
   * Declared Pneuma runtime range (semver), if the manifest sets one.
   * Used by the launcher to mark incompatible modes. See
   * `core/version-compat.ts` for matching semantics.
   */
  pneumaVersion?: string;
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
  /**
   * True when the manifest declares a non-empty `init.params` array — i.e.
   * the mode asks the user something before it launches. `false` for an
   * explicitly empty array; `undefined` when no `init.params` is declared, or
   * when its value cannot be read without evaluating TypeScript.
   *
   * `/api/registry` (`server/index.ts`) surfaces this to the launcher, which
   * previously carried a hardcoded list of mode names for the same fact.
   */
  hasInitParams?: boolean;
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

/** Characters that may appear inside a bare object key / identifier. */
const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * Advance past whitespace and comments (`//` and block form). Returns the
 * index of the next significant character, or `source.length` when only
 * trivia remains.
 */
function skipTrivia(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * Advance past the string literal starting at `index` (`"`, `'` or a
 * backtick), honoring escapes. Returns the index just past the closing quote,
 * or `source.length` when the literal never closes.
 */
function skipStringLiteral(source: string, index: number): number {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") { i += 2; continue; }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * Whether the array literal opening at `openIndex` holds anything at all.
 * Whitespace and comments do not count as content, so an empty array reads as
 * empty whether or not it carries a placeholder comment.
 */
function arrayLiteralHasEntries(source: string, openIndex: number): boolean {
  const first = skipTrivia(source, openIndex + 1);
  return first < source.length && source[first] !== "]";
}

/**
 * Whether the manifest declares a NON-EMPTY `init.params` array — "this mode
 * asks the user something before it launches".
 *
 * Source-level like every other extractor here; the parser never evaluates
 * TypeScript. The scan anchors on the canonical top-level `  init: {` line,
 * then looks for init's OWN `params` key (the init literal's first nesting
 * depth) whose value is an inline array literal. Everything else in the
 * manifest is deliberately out of reach: `viewerApi.actions[].params` is an
 * object of action parameters that every mode has, and a `params` inside a
 * seed descriptor is not init's.
 *
 * Unlike `findTopLevelField`, this walker also skips comments — a lone
 * apostrophe in a `//` line inside `init` (`modes/plotwise/manifest.ts` has
 * one) would otherwise read as an opening quote and swallow the block.
 *
 * Known limits, each answered with `undefined` ("cannot tell") rather than a
 * wrong claim: a manifest not formatted with the canonical two-space indent,
 * a quoted `"params":` key, and a value that is a reference rather than an
 * inline array (`params: SHARED_PARAMS`).
 */
function extractHasInitParams(source: string): boolean | undefined {
  const initMatch = /^ {2}init:\s*\{/m.exec(source);
  if (!initMatch) return undefined;

  let i = initMatch.index + initMatch[0].length;
  let depth = 1; // inside the init object literal
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") { i = skipStringLiteral(source, i); continue; }
    if (c === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) { i = skipTrivia(source, i); continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; i++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; i++; continue; }
    if (depth === 1 && IDENT_CHAR.test(c)) {
      // Read the whole identifier so a suffix match (`deriveParams`) cannot
      // pass for the key itself.
      let end = i;
      while (end < source.length && IDENT_CHAR.test(source[end])) end++;
      if (source.slice(i, end) === "params") {
        const colon = skipTrivia(source, end);
        if (source[colon] === ":") {
          const value = skipTrivia(source, colon + 1);
          return source[value] === "[" ? arrayLiteralHasEntries(source, value) : undefined;
        }
      }
      i = end;
      continue;
    }
    i++;
  }
  return undefined;
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
    pneumaVersion: extractString(content, "pneumaVersion"),
    displayName: extractLocalizedString(content, "displayName", locale),
    description: extractLocalizedString(content, "description", locale),
    icon: extractBacktickString(content, "icon") || extractString(content, "icon"),
    watchPatterns: extractStringArray(content, "watchPatterns"),
    installName: extractString(content, "installName"),
    workspaceType: extractString(content, "type"),
    layout: extractString(content, "layout"),
    inspiredBy: extractInspiredBy(content),
    hidden: extractBoolean(content, "hidden"),
    hasInitParams: extractHasInitParams(content),
  };
}
