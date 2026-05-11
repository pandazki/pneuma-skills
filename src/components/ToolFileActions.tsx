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
import { useEffect, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside-click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

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

  const toggleMenu = () => {
    setMenuOpen((open) => {
      const next = !open;
      if (next && editors === null) void loadEditors();
      return next;
    });
  };

  const onEditorMainClick = () => {
    const remembered = readRememberedEditor();
    if (remembered) {
      openInEditor(remembered);
      return;
    }
    if (!menuOpen && editors === null) void loadEditors();
    setMenuOpen(true);
  };

  return (
    <div ref={rootRef} className="mt-2 flex flex-wrap items-center gap-1.5">
      <button type="button" className={btnBase} disabled={busy} onClick={openDefault} title="Open in the default app">
        <OpenIcon />
        Open
      </button>

      <div className="relative inline-flex">
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
        {menuOpen ? (
          <div
            role="menu"
            className="absolute top-full left-0 mt-1 min-w-[180px] rounded-lg border border-cc-border bg-cc-surface shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] py-1 z-20"
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
          </div>
        ) : null}
      </div>

      <button type="button" className={btnBase} disabled={busy} onClick={reveal} title="Reveal in Finder / Explorer">
        <RevealIcon />
        Reveal
      </button>

      {err ? <span className="text-[11px] text-cc-error/90 ml-0.5">{err}</span> : null}
    </div>
  );
}
