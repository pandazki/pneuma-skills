/**
 * Shared server utilities.
 */

export const isWin = process.platform === "win32";

/** Cross-platform path containment check (case-insensitive on Windows). */
export function pathStartsWith(child: string, parent: string): boolean {
  if (isWin) return child.toLowerCase().startsWith(parent.toLowerCase());
  return child.startsWith(parent);
}
