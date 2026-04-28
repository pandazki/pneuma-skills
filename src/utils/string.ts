/**
 * Take the basename (last segment) of a path and convert to a Title Case
 * display name suitable for showing to humans.
 *
 *   /Users/x/Code/my-startup → "My Startup"
 *   /tmp/pneuma_skills        → "Pneuma Skills"
 *   foo.bar.baz               → "Foo.bar.baz"  (only - and _ are split)
 *   ""                        → ""
 */
export function basenameToTitleCase(p: string): string {
  if (!p) return "";
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  if (!base) return "";
  return base
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Last path segment, no transformation. Mirrors `path.basename` for / and \.
 */
export function basename(p: string): string {
  if (!p) return "";
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Shorten an absolute path by replacing the home directory with "~".
 * If the path doesn't start with homeDir, return it as-is.
 */
export function shortenPath(path: string, homeDir: string): string {
  if (path.startsWith(homeDir)) return "~" + path.slice(homeDir.length);
  return path;
}

/**
 * Escape a string for safe inclusion in an XML / HTML attribute or text node.
 * Used by the request-handoff chat-tag dispatcher (Smart Handoff in
 * ProjectPanel and the legacy ModeSwitcherDropdown) so that user-provided
 * intent strings can never break the surrounding `<pneuma:request-handoff />`
 * tag the source agent receives.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
