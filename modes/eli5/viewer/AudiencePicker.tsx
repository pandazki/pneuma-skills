/**
 * The per-pane audience picker — one pane's rung, chosen.
 *
 * Shown only while comparing, where each pane needs its own rung and the
 * rail alone cannot say which pane a click is meant for. It was a native
 * `<select>` for exactly one release: OS-drawn widgetry in the middle of
 * the Ethereal Tech chrome, and a popup no stylesheet can reach — a
 * platform popup is not restylable, so the control has to be rebuilt
 * rather than dressed up.
 *
 * What it is instead: a trigger pill in the rail's own vocabulary (ladder
 * badge + label + chevron, same type scale as the rung pills) over a
 * token-styled listbox.
 *
 * Two things about the popup are not cosmetic:
 *
 *  - It is PORTALLED to `document.body`. The menu opens across the page
 *    frame below it, and the pane chrome is exactly the kind of place
 *    where a `backdrop-filter` ancestor seals a child's z-index inside
 *    its own stacking context (see `.claude/rules/frontend.md`). A portal
 *    settles the question for every host this picker is ever put in,
 *    rather than for the one it was tested against.
 *  - Leaving the subtree costs it the theme: `cc-*` tokens are redefined
 *    on a `.cc-theme-light` ancestor, so the class is carried across by
 *    hand — without it, a light session gets a dark menu.
 *
 * Every rung is listed, including one whose page the agent has not
 * written yet: picking it is how a reader asks for that page, the same as
 * on the rail. Focus rings are `focus-visible:ring-*`, never `outline` —
 * a global `*:focus { outline: none }` silently wins over the latter.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AudienceEntry } from "../domain.js";

export interface AudiencePickerProps {
  /** Micro-label in front of the trigger — "In view" / "Compared with". */
  caption: string;
  /** The whole ladder, in manifest order. */
  audiences: AudienceEntry[];
  /** The rung this pane stands on, or null when it stands on none. */
  valueId: string | null;
  onChange: (id: string) => void;
}

/** Space between trigger and menu, and between menu and viewport edge. */
const GAP_PX = 4;
const MARGIN_PX = 8;

/**
 * Ladder badges, in the rail's own vocabulary (`AudienceRail`'s `active`
 * and `idle`). Deliberately never the rail's grey `pending` badge: on the
 * rail grey means "the agent has not written this page yet", and a menu
 * that greys out every rung it is not standing on would be saying that
 * about rungs which are perfectly written.
 */
const BADGE_ON = "border-cc-primary/60 bg-cc-primary/25 text-cc-primary";
const BADGE_OFF = "border-cc-primary/25 bg-cc-primary/10 text-cc-primary/80";

interface MenuPos {
  top: number;
  left: number;
  minWidth: number;
}

export default function AudiencePicker({
  caption,
  audiences,
  valueId,
  onChange,
}: AudiencePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [themeClass, setThemeClass] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Focus is moved into the menu once per opening, never on the renders
  // that follow — re-focusing on every render would fight the arrow keys.
  const focusedOnOpenRef = useRef(false);

  const scope = useId();
  const captionId = `${scope}caption`;
  const triggerId = `${scope}trigger`;
  const menuId = `${scope}menu`;

  const currentIndex = audiences.findIndex((a) => a.id === valueId);
  const current = currentIndex >= 0 ? audiences[currentIndex] : null;

  const optionNodes = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-eli5-option]") ?? [],
      ),
    [],
  );

  /**
   * Fixed-position placement, measured from the trigger: below it when
   * the menu fits, flipped above when it does not, and clamped inside the
   * viewport on both axes. `minWidth` ties the menu to the trigger it
   * came from; long labels are free to widen it.
   */
  const placeMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setThemeClass(rootRef.current?.closest(".cc-theme-light") ? "cc-theme-light" : "");

    const width = menuRef.current?.offsetWidth ?? rect.width;
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP_PX;
    const above = rect.top - height - GAP_PX;
    const top =
      below + height + MARGIN_PX <= window.innerHeight
        ? below
        : Math.max(MARGIN_PX, above);
    const left = Math.min(
      Math.max(MARGIN_PX, rect.left),
      Math.max(MARGIN_PX, window.innerWidth - width - MARGIN_PX),
    );
    setPos({ top, left, minWidth: rect.width });
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    // Placed before the menu exists (its own size is still unknown, the
    // trigger's is not), then corrected in the layout effect below —
    // which runs before paint, so the correction is never seen.
    placeMenu();
    setOpen(true);
  }, [placeMenu]);

  // Re-measure with the real menu on screen, and hand it the keyboard.
  useLayoutEffect(() => {
    if (!open) {
      focusedOnOpenRef.current = false;
      return;
    }
    placeMenu();
    if (focusedOnOpenRef.current) return;
    focusedOnOpenRef.current = true;
    const nodes = optionNodes();
    (nodes[currentIndex >= 0 ? currentIndex : 0] ?? menuRef.current)?.focus();
  }, [open, currentIndex, audiences.length, placeMenu, optionNodes]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    // Most of this viewer's surface is an iframe, and a mousedown inside
    // one never reaches this document — so the commonest "click outside"
    // a reader makes (clicking the page they are reading) would leave the
    // menu hanging. What the parent DOES see is losing focus to that
    // frame, which arrives here as a window blur.
    const onWindowBlur = () => close(false);
    const reposition = () => placeMenu();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("resize", reposition);
    // Capture phase: the pane, not the window, is what scrolls here.
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, close, placeMenu]);

  const pick = useCallback(
    (id: string) => {
      onChange(id);
      close(true);
    },
    [onChange, close],
  );

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    openMenu();
  };

  /**
   * Roving focus over the options. Clamped at both ends rather than
   * wrapped: a ladder has a bottom and a top, and wrapping would drop a
   * reader holding ArrowDown onto the simplest rung again.
   */
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = optionNodes();
    if (nodes.length === 0) return;
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => {
      e.preventDefault();
      nodes[Math.min(Math.max(index, 0), nodes.length - 1)]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return focusAt(at + 1);
      case "ArrowUp":
        return focusAt(at <= 0 ? 0 : at - 1);
      case "Home":
        return focusAt(0);
      case "End":
        return focusAt(nodes.length - 1);
      case "Tab":
        // Deterministic exit: the menu is about to unmount, so tabbing
        // out of it would leave focus nowhere. Hand it back instead.
        e.preventDefault();
        return close(true);
      default:
        return;
    }
  };

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-2">
      <span
        id={captionId}
        className="shrink-0 text-[10px] uppercase tracking-wider text-cc-muted"
      >
        {caption}
      </span>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        data-eli5-picker
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={`${captionId} ${triggerId}`}
        title={current?.tone || current?.label || caption}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
          open
            ? "border-cc-primary/60 bg-cc-primary/10 text-cc-fg"
            : "border-cc-border bg-cc-surface/60 text-cc-fg/85 hover:border-cc-primary/40 hover:bg-cc-surface/80 hover:text-cc-fg"
        }`}
      >
        {current ? (
          <>
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums ${BADGE_ON}`}
            >
              {currentIndex + 1}
            </span>
            <span className="max-w-[12rem] truncate">{current.label}</span>
          </>
        ) : (
          <span className="truncate text-cc-muted">Choose an audience</span>
        )}
        <Chevron open={open} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            data-eli5-picker-menu
            role="listbox"
            tabIndex={-1}
            aria-labelledby={captionId}
            onKeyDown={onMenuKeyDown}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: pos.minWidth,
            }}
            className={`${themeClass} z-[200] max-h-[min(20rem,calc(100vh-1rem))] max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-cc-border bg-cc-surface/95 p-1 shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl`}
          >
            {audiences.map((audience, i) => {
              const selected = i === currentIndex;
              return (
                <button
                  key={`${audience.id}-${i}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-eli5-option={audience.id}
                  aria-selected={selected}
                  title={audience.tone || audience.label}
                  onClick={() => pick(audience.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
                    selected
                      ? "bg-cc-primary/15 text-cc-fg"
                      : "text-cc-fg/80 hover:bg-cc-hover hover:text-cc-fg"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums ${
                      selected ? BADGE_ON : BADGE_OFF
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{audience.label}</span>
                  {selected && <Check />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-cc-muted transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3 w-3 shrink-0 text-cc-primary"
    >
      <path d="M2.5 6.25 4.75 8.5 9.5 3.5" />
    </svg>
  );
}
