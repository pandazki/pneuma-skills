import React, { useState, useEffect, useRef, useCallback } from "react";

/**
 * DirBrowser — file-system directory picker overlay used by dialogs that
 * need to choose a working directory (LaunchDialog, CreateProjectDialog).
 *
 * Filesystem listing is fetched from the backend at `${apiBase}/api/browse-dirs`
 * which returns `{ current, parent, dirs: [{ name, path }] }`.
 *
 * Renders absolutely positioned (top-full of nearest `relative` ancestor).
 * The host is responsible for the wrapping `relative` container and for
 * mounting/unmounting based on its own toggle state.
 */
export interface DirBrowserProps {
  /** Initial directory to show */
  startPath: string;
  /** Base URL for backend (`getApiBase()`) */
  apiBase: string;
  /** Called when user clicks Select on a directory */
  onSelect: (path: string) => void;
  /** Called when user clicks outside the overlay or selects */
  onClose: () => void;
}

export function DirBrowser({ startPath, apiBase, onSelect, onClose }: DirBrowserProps) {
  const [currentPath, setCurrentPath] = useState(startPath);
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/browse-dirs?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error && data.dirs?.length === 0) {
        setError(data.error);
      }
      setCurrentPath(data.current || path);
      setDirs(data.dirs || []);
      setParentPath(data.parent || null);
    } catch {
      setError("Failed to browse directory");
    }
    setLoading(false);
  }, [apiBase]);

  useEffect(() => { browse(startPath); }, [browse, startPath]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const segments = currentPath.split("/").filter(Boolean);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-cc-surface border border-cc-border/60 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.25)] overflow-hidden"
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-cc-border/40 overflow-x-auto text-xs">
        <button onClick={() => browse("/")} className="text-cc-muted hover:text-cc-fg cursor-pointer shrink-0">/</button>
        {segments.map((seg, i) => {
          const path = "/" + segments.slice(0, i + 1).join("/");
          return (
            <React.Fragment key={path}>
              <span className="text-cc-muted/30">/</span>
              <button
                onClick={() => browse(path)}
                className="text-cc-muted hover:text-cc-fg cursor-pointer shrink-0 max-w-[120px] truncate"
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Directory list */}
      <div className="max-h-52 overflow-y-auto py-1">
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-4 h-4 rounded-full border-2 border-cc-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {error && <div className="px-3 py-2 text-xs text-cc-error">{error}</div>}
            {parentPath && (
              <button
                onClick={() => browse(parentPath)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-cc-muted hover:bg-cc-hover cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                ..
              </button>
            )}
            {dirs.map((dir) => (
              <button
                key={dir.path}
                onClick={() => browse(dir.path)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-cc-fg hover:bg-cc-hover cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0 text-cc-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                <span className="truncate flex-1 text-left">{dir.name}</span>
              </button>
            ))}
            {dirs.length === 0 && !error && (
              <div className="py-4 text-center text-cc-muted/60 text-xs">Empty directory</div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-cc-border/40">
        <span className="text-xs text-cc-muted truncate mr-2">{currentPath}</span>
        <button
          type="button"
          onClick={() => { onSelect(currentPath); onClose(); }}
          className="shrink-0 rounded-md px-3 py-1 text-xs font-medium bg-cc-primary text-white transition-all duration-200 cursor-pointer hover:brightness-110 hover:shadow-[0_0_16px_rgba(249,115,22,0.2)]"
        >
          Select
        </button>
      </div>
    </div>
  );
}
