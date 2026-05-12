/**
 * ToolFileActions — action row under a file-touching tool-call block.
 *
 * Renders three small controls:
 *   - "Open"   → POST /api/system/open          { path }            (default app)
 *   - "Editor" → split-button: main button opens with the remembered
 *                editor (POST /api/system/open-in-editor { editorId, path })
 *                or, if none remembered, opens the dropdown; the "▾" toggle
 *                always opens the dropdown. The dropdown lazily fetches
 *                GET /api/system/editors on first open, lists each editor's
 *                `displayName`, persists the chosen `editorId` to
 *                localStorage[LAST_EDITOR_STORAGE_KEY], then opens with it.
 *   - "Reveal" → POST /api/system/reveal        { path }            (Finder/Explorer)
 *
 * Request failures (non-2xx, or 2xx body `{ success: false }`) surface as a
 * small inline error text after the row — no toast, no dialog.
 *
 * No emoji: plain text labels paired with tiny inline SVG icons in the
 * `ToolIcon` style used elsewhere in the chat chrome.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getApiBase } from "../utils/api.js";

/** localStorage key for the remembered "open in editor" choice. Part of the persistence contract — keep stable. */
export const LAST_EDITOR_STORAGE_KEY = "pneuma:default-editor";

interface DetectedEditor {
  id: string;
  displayName: string;
}

/** POST a system action; returns true on success, false on any failure (network, non-2xx, or `{ success: false }`). */
async function postSystem(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    return data.success !== false;
  } catch {
    return false;
  }
}

function readRememberedEditor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_EDITOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberEditor(editorId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_EDITOR_STORAGE_KEY, editorId);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

const iconCls = "w-3 h-3 shrink-0";

function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconCls} aria-hidden>
      <path d="M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V7" strokeLinecap="round" />
      <path d="M9 2h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2L7.5 8.5" strokeLinecap="round" />
    </svg>
  );
}

function EditorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconCls} aria-hidden>
      <polyline points="6 4 2.5 8 6 12" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="10 4 13.5 8 10 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RevealIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconCls} aria-hidden>
      <path d="M2 5.5l1-2h3.5l1 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5.5z" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-2 h-2 shrink-0" aria-hidden>
      <path d="M3 6l5 5 5-5z" />
    </svg>
  );
}

const btnBase =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-cc-border/60 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default";

export function ToolFileActions({ path }: { path: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = not yet loaded; [] = loaded but none detected.
  const [editors, setEditors] = useState<DetectedEditor[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Fixed-position coordinates for the (portaled) editor dropdown. Kept in a
  // portal so an ancestor's `overflow: hidden` (the tool block has rounded
  // corners; the chat scroller clips) can't eat the menu.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_W = 188;

  /** Anchor the dropdown below the split-button, flipping above / clamping to the viewport. */
  const placeMenu = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const measured = menuRef.current?.offsetHeight ?? 0;
    const estH = measured > 0
      ? measured
      : editors === null
        ? 60
        : Math.max(34, Math.min(editors.length || 1, 8) * 30 + 12);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + 4;
    if (top + estH > vh - 8) top = Math.max(8, r.top - estH - 4);
    let left = r.left;
    if (left + MENU_W > vw - 8) left = Math.max(8, vw - MENU_W - 8);
    setMenuPos({ top, left });
  };

  // Place / re-place the menu once it's in the DOM (real height available),
  // and whenever the editor list loads and changes the menu's height.
  useLayoutEffect(() => {
    if (menuOpen) placeMenu();
    // placeMenu reads stable refs + `editors`; deps cover what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, editors]);

  // Close the dropdown on outside-click / Esc; keep it glued to the anchor
  // while open (chat scroll, window resize).
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const insideRow = rootRef.current?.contains(t) ?? false;
      const insideMenu = menuRef.current?.contains(t) ?? false;
      if (!insideRow && !insideMenu) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    const reposition = () => placeMenu();
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, editors]);

  const run = async (label: string, fn: () => Promise<boolean>) => {
    setErr(null);
    setBusy(true);
    try {
      const ok = await fn();
      if (!ok) setErr(`Couldn't ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  };

  const openDefault = () => void run("open the file", () => postSystem("/api/system/open", { path }));

  const reveal = () => void run("reveal the file", () => postSystem("/api/system/reveal", { path }));

  const openInEditor = (editorId: string) => {
    rememberEditor(editorId);
    setMenuOpen(false);
    void run("open in editor", () => postSystem("/api/system/open-in-editor", { editorId, path }));
  };

  const loadEditors = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/system/editors`);
      if (!res.ok) {
        setEditors([]);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { editors?: DetectedEditor[] };
      setEditors(Array.isArray(data.editors) ? data.editors : []);
    } catch {
      setEditors([]);
    }
  };

  const openMenu = () => {
    if (editors === null) void loadEditors();
    placeMenu();
    setMenuOpen(true);
  };

  const toggleMenu = () => {
    if (menuOpen) setMenuOpen(false);
    else openMenu();
  };

  const onEditorMainClick = () => {
    const remembered = readRememberedEditor();
    if (remembered) {
      openInEditor(remembered);
      return;
    }
    openMenu();
  };

  return (
    <div ref={rootRef} className="mt-2 flex flex-wrap items-center gap-1.5">
      <button type="button" className={btnBase} disabled={busy} onClick={openDefault} title="Open in the default app">
        <OpenIcon />
        Open
      </button>

      <div ref={anchorRef} className="relative inline-flex">
        <button
          type="button"
          className={`${btnBase} rounded-r-none`}
          disabled={busy}
          onClick={onEditorMainClick}
          title="Open in a code editor"
        >
          <EditorIcon />
          Editor
        </button>
        <button
          type="button"
          className={`${btnBase} rounded-l-none -ml-px px-1 ${menuOpen ? "bg-cc-hover/40 text-cc-fg" : ""}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Choose editor"
          title="Choose editor"
          onClick={toggleMenu}
        >
          <ChevronIcon />
        </button>
        {menuOpen && menuPos
          ? createPortal(
              <div
                ref={menuRef}
                role="menu"
                style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
                className="min-w-[180px] max-h-[60vh] overflow-y-auto rounded-lg border border-cc-border bg-cc-surface shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] py-1 z-[100]"
              >
                {editors === null ? (
                  <div className="px-3 py-1.5 text-[11px] text-cc-muted/70">Loading…</div>
                ) : editors.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-cc-muted/70">No code editor detected</div>
                ) : (
                  editors.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="menuitem"
                      onClick={() => openInEditor(e.id)}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer truncate"
                    >
                      {e.displayName}
                    </button>
                  ))
                )}
              </div>,
              document.body,
            )
          : null}
      </div>

      <button type="button" className={btnBase} disabled={busy} onClick={reveal} title="Reveal in Finder / Explorer">
        <RevealIcon />
        Reveal
      </button>

      {err ? <span className="text-[11px] text-cc-error/90 ml-0.5">{err}</span> : null}
    </div>
  );
}
