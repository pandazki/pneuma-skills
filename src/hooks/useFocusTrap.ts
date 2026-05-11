import { useEffect, useRef } from "react";

/**
 * Focus-trap + autofocus + focus-restore for modal dialogs.
 *
 * Wires a container ref to:
 *   - move focus inside on mount (the container itself if `tabIndex=-1`,
 *     otherwise the first focusable descendant),
 *   - cycle Tab / Shift+Tab between the first and last focusable
 *     descendants so keyboard users can't escape the modal into the
 *     underlying app while the dialog is open,
 *   - restore focus to the element that was active before the dialog
 *     opened on unmount, matching the OS-modal convention.
 *
 * Usage:
 *
 *   const ref = useFocusTrap<HTMLDivElement>(true);
 *   return <div ref={ref} tabIndex={-1} role="dialog" aria-modal>…</div>;
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "audio[controls]",
  "video[controls]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    // Remember the element that had focus before the dialog opened so
    // we can restore it on close. document.activeElement may be the
    // body element on some browsers — that's fine, restoring to body
    // is the no-op outcome.
    restoreRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Move focus into the container. Prefer the container itself
    // (when tabIndex=-1) so screen readers announce the dialog before
    // diving into an inner control. Fall back to the first focusable
    // descendant if the container can't take focus.
    const initial =
      node.matches("[tabindex]") || node.tabIndex >= 0
        ? node
        : (node.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null);
    initial?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus on the container so Tab
        // doesn't leak out to the underlying app.
        e.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === node || !node.contains(activeEl)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else {
        if (activeEl === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to where it was before the dialog opened.
      // Guard against the previous element having been removed from
      // the DOM while the dialog was open.
      const prev = restoreRef.current;
      if (prev && document.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
      restoreRef.current = null;
    };
  }, [active]);

  return ref;
}
