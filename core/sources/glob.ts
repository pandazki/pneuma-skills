/**
 * Shared minimal glob matcher for Source providers.
 *
 * Supported syntax: `*` (any chars except /), `**` (any chars including /),
 * `?` (single char), literal paths. No brace expansion, no character classes.
 *
 * Extracted from file-glob.ts / aggregate-file.ts (which kept byte-identical
 * inline copies) so the matching semantics the Source contract depends on have
 * a single definition. Any future provider needing glob matching imports here.
 */

/**
 * Compile a list of glob patterns into a single predicate.
 * If the list is empty, the predicate returns false (use this for the ignore
 * list; patterns-list callers should guarantee non-empty).
 */
export function compileGlobList(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(compileGlob);
  return (path: string) => regexes.some((r) => r.test(path));
}

/** Compile a single glob pattern into an anchored RegExp. */
export function compileGlob(pattern: string): RegExp {
  // Normalize leading ./ — watchPatterns don't typically use it, but be safe.
  let p = pattern.replace(/^\.\//, "");
  // Escape regex specials except for the glob metachars we care about.
  let rx = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // ** — any characters including /
        rx += ".*";
        i += 2;
        // Swallow a following / so `**/foo` matches `foo` too.
        if (p[i] === "/") i++;
      } else {
        // * — any characters except /
        rx += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      rx += "[^/]";
      i++;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      rx += "\\" + ch;
      i++;
    } else {
      rx += ch;
      i++;
    }
  }
  return new RegExp("^" + rx + "$");
}
