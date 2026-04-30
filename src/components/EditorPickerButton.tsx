/**
 * EditorPickerButton — split-button "open this path in <IDE>" affordance.
 *
 * Detects installed editors via `/api/system/editors` (server scans
 * `/Applications/`), serves real `.app` icons via
 * `/api/system/editors/:id/icon`, and remembers the user's default
 * choice in localStorage. The main button opens with the default in one
 * click; the chevron drops a picker that lets the user choose
 * differently (and reset the default in the process).
 *
 * Used by:
 *  - `ProjectPanel` action row → opens the project root (the user's
 *    shared deliverable surface).
 *  - `EditorPanel` Files header → opens the active session's working
 *    dir (the agent's CWD — equals the project session dir for project
 *    sessions, the workspace for quick).
 *
 * Hidden entirely when no editor is detected (non-macOS platforms or
 * none of the supported apps installed) so the row never shows a
 * non-functional control.
 */
import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../utils/api.js";

interface DetectedEditor {
  id: string;
  displayName: string;
}

interface EditorPickerButtonProps {
  /**
   * Absolute directory to open in the chosen editor. Forwarded to
   * `/api/projects/:targetPath/open-in-editor`, which ultimately runs
   * `open -a <App> <targetPath>` on macOS. The endpoint name is a
   * historical relic — it accepts any directory, not just project roots.
   */
  targetPath: string;
  /**
   * Where the picker popover anchors. `above` for action rows pinned
   * to the bottom of a panel; `below` for headers pinned to the top.
   * Defaults to `above`.
   */
  menuPosition?: "above" | "below";
}

const DEFAULT_EDITOR_LS_KEY = "pneuma:default-editor";

export default function EditorPickerButton({
  targetPath,
  menuPosition = "above",
}: EditorPickerButtonProps) {
  const apiBase = getApiBase();
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [defaultEditorId, setDefaultEditorId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(DEFAULT_EDITOR_LS_KEY);
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Detect installed editors once on mount. The list is small and
  // stable across the panel's lifetime.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/system/editors`);
        if (!res.ok) return;
        const data = (await res.json()) as { editors: DetectedEditor[] };
        if (!cancelled) setEditors(data.editors ?? []);
      } catch {
        // Detection failure is non-fatal — the button stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  // Close on outside-click + Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  const openInEditor = async (editorId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEFAULT_EDITOR_LS_KEY, editorId);
    }
    setDefaultEditorId(editorId);
    setMenuOpen(false);
    try {
      await fetch(
        `${apiBase}/api/projects/${encodeURIComponent(targetPath)}/open-in-editor`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ editorId }),
        },
      );
    } catch {
      // Best-effort — failures don't surface today.
    }
  };

  if (editors.length === 0) return null;

  const defaultEditor = defaultEditorId
    ? editors.find((e) => e.id === defaultEditorId)
    : null;

  const menuClass =
    menuPosition === "above"
      ? "absolute bottom-full right-0 mb-2"
      : "absolute top-full right-0 mt-2";

  return (
    <div className="relative flex items-center" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          if (defaultEditor) {
            void openInEditor(defaultEditor.id);
          } else {
            setMenuOpen(true);
          }
        }}
        aria-label={
          defaultEditor
            ? `Open in ${defaultEditor.displayName}`
            : "Open in editor"
        }
        title={
          defaultEditor
            ? `Open in ${defaultEditor.displayName}`
            : "Open in editor"
        }
        className="flex items-center justify-center w-8 h-8 rounded-l-md rounded-r-none text-cc-muted hover:text-cc-fg hover:bg-cc-bg/40 transition-colors cursor-pointer"
      >
        {defaultEditor ? (
          <img
            src={`${apiBase}/api/system/editors/${encodeURIComponent(defaultEditor.id)}/icon`}
            alt=""
            className="w-5 h-5 object-contain"
            draggable={false}
          />
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Choose editor"
        title="Choose editor"
        className={`flex items-center justify-center w-5 h-8 rounded-r-md rounded-l-none text-cc-muted hover:text-cc-fg transition-colors cursor-pointer -ml-px ${
          menuOpen ? "bg-cc-bg/60 text-cc-fg" : "hover:bg-cc-bg/40"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-2.5 h-2.5"
          aria-hidden
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className={`${menuClass} min-w-[200px] rounded-lg border border-cc-border bg-cc-surface shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] py-1 [animation:overlayFadeIn_140ms_cubic-bezier(0.16,1,0.3,1)] z-10`}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-cc-muted/60">
            Open in
          </div>
          {editors.map((e) => {
            const isDefault = e.id === defaultEditorId;
            return (
              <button
                key={e.id}
                type="button"
                role="menuitem"
                onClick={() => void openInEditor(e.id)}
                className="w-full text-left px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer flex items-center gap-2"
              >
                <img
                  src={`${apiBase}/api/system/editors/${encodeURIComponent(e.id)}/icon`}
                  alt=""
                  className="w-4 h-4 object-contain shrink-0"
                  draggable={false}
                />
                <span className="flex-1 truncate">{e.displayName}</span>
                {isDefault ? (
                  <span className="text-cc-primary text-[10px]" aria-label="default">
                    ★
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
