import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface SelectorItem {
  id: string;
  label: string;
}

interface ContentSetSelectorProps {
  items: SelectorItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  icon?: "folder" | "file";
  unread?: Set<string>;
  /**
   * When provided, each item gets a per-row delete affordance (× icon
   * revealed on hover, morphs to an inline "Delete? Cancel/Confirm"
   * prompt on click — same pattern as ProjectPanel's archive flow, no
   * modal). The handler should run the destructive action and resolve
   * once the underlying store/disk update has been broadcast. A thrown
   * error keeps the row in its error state.
   */
  onDelete?: (id: string) => Promise<void>;
}

type RowState =
  | { kind: "idle" }
  | { kind: "confirming"; id: string }
  | { kind: "deleting"; id: string }
  | { kind: "error"; id: string };

type ElectronCSSProperties = CSSProperties & { WebkitAppRegion?: string };

export default function ContentSetSelector({
  items,
  activeId,
  onSelect,
  icon = "folder",
  unread,
  onDelete,
}: ContentSetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [rowState, setRowState] = useState<RowState>({ kind: "idle" });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [portalThemeClass, setPortalThemeClass] = useState("");
  const { t } = useTranslation("topbar");

  const placeMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPortalThemeClass(ref.current?.closest(".cc-theme-light") ? "cc-theme-light" : "");

    const margin = 12;
    const menuWidth = menuRef.current?.offsetWidth ?? 260;
    const menuHeight = menuRef.current?.offsetHeight ?? 240;
    const below = rect.bottom + 4;
    const above = rect.top - menuHeight - 4;
    const top = below + menuHeight + margin <= window.innerHeight
      ? below
      : Math.max(margin, above);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - menuWidth - margin),
    );

    setMenuPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = ref.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) {
        setOpen(false);
        setRowState({ kind: "idle" });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setRowState({ kind: "idle" });
      }
    };
    const onReposition = () => placeMenu();
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placeMenu]);

  useLayoutEffect(() => {
    if (open) placeMenu();
  }, [open, items.length, rowState, placeMenu]);

  const activeLabel = items.find((item) => item.id === activeId)?.label || "Select";
  const hasUnread = unread && unread.size > 0;
  const menuStyle: ElectronCSSProperties | undefined = menuPos
    ? {
        position: "fixed",
        top: menuPos.top,
        left: menuPos.left,
        WebkitAppRegion: "no-drag",
      }
    : undefined;

  const runDelete = async (id: string) => {
    if (!onDelete) return;
    setRowState({ kind: "deleting", id });
    try {
      await onDelete(id);
      setRowState({ kind: "idle" });
      setOpen(false);
    } catch {
      setRowState({ kind: "error", id });
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (open) {
            setOpen(false);
            setRowState({ kind: "idle" });
          } else {
            placeMenu();
            setOpen(true);
          }
        }}
        className="relative flex items-center gap-1.5 px-2 py-1 text-xs font-medium
          rounded-md text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon === "folder" ? <FolderIcon /> : <FileIcon />}
        <span>{activeLabel}</span>
        {hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cc-primary
            shadow-[0_0_6px_rgba(249,115,22,0.6)] animate-pulse" />
        )}
        <svg
          className={`w-3 h-3 text-cc-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`${portalThemeClass} min-w-[220px] max-w-[min(360px,calc(100vw-24px))]
            max-h-[min(320px,calc(100vh-24px))] overflow-y-auto
            bg-cc-surface border border-cc-border rounded-md shadow-lg z-[200]`}
          style={menuStyle}
        >
          {items.map((item) => {
            const isActive = item.id === activeId;
            const isConfirming = rowState.kind === "confirming" && rowState.id === item.id;
            const isDeleting = rowState.kind === "deleting" && rowState.id === item.id;
            const isErrored = rowState.kind === "error" && rowState.id === item.id;

            if (isConfirming || isDeleting || isErrored) {
              return (
                <div
                  key={item.id}
                  className={`group flex items-center gap-2 px-3 py-2 text-xs
                    ${isActive ? "bg-cc-primary/15 text-cc-fg" : "text-cc-fg"}`}
                >
                  <span className="flex-1 truncate text-cc-muted">
                    {isErrored
                      ? t("content_set.delete_failed")
                      : t("content_set.delete_confirm")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRowState({ kind: "idle" })}
                    disabled={isDeleting}
                    className="text-cc-muted hover:text-cc-fg transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {t("content_set.delete_cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runDelete(item.id)}
                    disabled={isDeleting}
                    className="text-cc-error/80 hover:text-cc-error transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isDeleting ? t("content_set.deleting") : t("content_set.delete_action")}
                  </button>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                className={`group flex items-center gap-1 hover:bg-cc-hover transition-colors
                  ${isActive ? "bg-cc-primary/15" : ""}`}
              >
                <button
                  onClick={() => { onSelect(item.id); setOpen(false); }}
                  className={`flex-1 text-left px-3 py-2 text-xs flex items-center gap-2 cursor-pointer
                    ${isActive ? "text-cc-fg" : "text-cc-muted"}`}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                  {unread?.has(item.id) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cc-primary shrink-0" />
                  )}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    aria-label={t("content_set.delete_aria")}
                    title={t("content_set.delete_aria")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRowState({ kind: "confirming", id: item.id });
                    }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                      px-2 py-2 text-cc-muted hover:text-cc-error transition-opacity cursor-pointer"
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-muted">
      <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6.5a1 1 0 00-1-1H8L6.5 4H3a1 1 0 00-1 .5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-muted">
      <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}
