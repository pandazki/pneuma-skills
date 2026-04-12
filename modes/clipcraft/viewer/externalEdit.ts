/**
 * Pure helper: given the current disk content and the last content the
 * viewer has committed to, decide whether an external edit was detected.
 *
 * Extracted from ClipCraftPreview.tsx so unit tests can import it without
 * pulling in React/JSX and the pneuma-craft provider tree.
 */
export function isExternalEdit(
  diskContent: string | null,
  lastApplied: string | null,
): boolean {
  if (diskContent === null) return false;
  return diskContent !== lastApplied;
}
