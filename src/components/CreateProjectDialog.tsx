import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBase } from "../utils/api.js";
import { basename, basenameToTitleCase, shortenPath } from "../utils/string.js";
import { timeAgo } from "../utils/timeAgo.js";
import { useAnimatedMount } from "../utils/useAnimatedMount.js";
import { DirBrowser } from "./DirBrowser.js";

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called after a successful create. `skipOnboard=false` is the
   * "Create & discover" path — the parent should navigate the user
   * straight into the new project so EmptyShell's auto-trigger fires.
   * `skipOnboard=true` is the "Create without discovery" path — the
   * project's manifest already has `onboardedAt` stamped server-side,
   * so the parent can just refresh its project list and stay put.
   */
  onCreated: (root: string, skipOnboard: boolean) => void;
  /** Used as fallback start path for the directory browser. */
  homeDir?: string;
}

interface ImportableSession {
  id: string;
  mode: string;
  displayName: string;
  workspace: string;
  lastAccessed: number;
  hasThumbnail?: boolean;
}

/**
 * Outer wrapper: handles the animated mount/unmount lifecycle so the
 * inner dialog component can rely on `open` truly meaning "rendering".
 */
export function CreateProjectDialog({ open, onClose, onCreated, homeDir }: CreateProjectDialogProps) {
  const anim = useAnimatedMount(open);
  if (!anim.mounted) return null;
  return (
    <CreateProjectDialogInner
      onClose={onClose}
      onCreated={onCreated}
      homeDir={homeDir}
      closing={anim.closing}
    />
  );
}

interface InnerProps {
  onClose: () => void;
  onCreated: (root: string) => void;
  homeDir?: string;
  closing: boolean;
}

function CreateProjectDialogInner({ onClose, onCreated, homeDir, closing }: InnerProps) {
  const [root, setRoot] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const rootInputRef = useRef<HTMLInputElement>(null);
  const displayNameTouchedRef = useRef(false);

  // Split-button alternate-action menu (the chevron next to "Create &
  // discover" reveals "Create without discovery"). Closes on outside-
  // click + Esc.
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Init-from-sessions section state
  const [importExpanded, setImportExpanded] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<ImportableSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const sessionsLoadedRef = useRef(false);

  // Reset every time we mount
  useEffect(() => {
    setRoot("");
    setDisplayName("");
    setDescription("");
    setError("");
    setSubmitting(false);
    setBrowsing(false);
    setImportExpanded(false);
    setSelectedIds(new Set());
    sessionsLoadedRef.current = false;
    displayNameTouchedRef.current = false;
    // Focus the path input on mount
    requestAnimationFrame(() => rootInputRef.current?.focus());
  }, []);

  // Esc-to-close — but only when the alternate-action menu is closed.
  // When the menu is open, Esc should close the menu first, leaving
  // the dialog up for the user to keep working.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (actionMenuOpen) {
        e.stopPropagation();
        setActionMenuOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, actionMenuOpen]);

  // Close the alternate-action menu on outside-click.
  useEffect(() => {
    if (!actionMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [actionMenuOpen]);

  // Lazy-load importable quick sessions when section first expands
  useEffect(() => {
    if (!importExpanded || sessionsLoadedRef.current) return;
    sessionsLoadedRef.current = true;
    setSessionsLoading(true);
    setSessionsError(null);
    fetch(`${getApiBase()}/api/sessions`)
      .then((r) => r.json())
      .then((data) => {
        const list: ImportableSession[] = (data.sessions || [])
          .filter((s: { kind?: string }) => (s.kind ?? "quick") === "quick")
          .map((s: {
            id: string;
            mode: string;
            displayName: string;
            workspace: string;
            lastAccessed: number;
            hasThumbnail?: boolean;
          }) => ({
            id: s.id,
            mode: s.mode,
            displayName: s.displayName,
            workspace: s.workspace,
            lastAccessed: s.lastAccessed,
            hasThumbnail: s.hasThumbnail,
          }));
        setAvailableSessions(list);
        setSessionsLoading(false);
      })
      .catch((err) => {
        setSessionsError(String(err));
        setSessionsLoading(false);
      });
  }, [importExpanded]);

  const handleRootChange = useCallback((next: string) => {
    setRoot(next);
    if (!displayNameTouchedRef.current) {
      const auto = basenameToTitleCase(next);
      setDisplayName(auto);
    }
  }, []);

  const handleDisplayNameChange = useCallback((next: string) => {
    setDisplayName(next);
    displayNameTouchedRef.current = true;
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const submit = async (skipOnboard: boolean) => {
    setError("");
    setSubmitting(true);
    setActionMenuOpen(false);
    try {
      const inferredName = basename(root);
      const payload: {
        root: string;
        name: string;
        displayName: string;
        description: string;
        initFromSessions?: string[];
        skipOnboard?: boolean;
      } = {
        root,
        name: inferredName || "project",
        displayName: displayName || inferredName || "Untitled",
        description,
      };
      if (selectedIds.size > 0) {
        payload.initFromSessions = Array.from(selectedIds);
      }
      if (skipOnboard) {
        payload.skipOnboard = true;
      }
      const res = await fetch(`${getApiBase()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `create failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onCreated(data.root, skipOnboard);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
      style={{
        animation: `${closing ? "overlayFadeOut" : "overlayFadeIn"} 0.2s ease-out${closing ? " forwards" : ""}`,
      }}
    >
      <div
        className="bg-cc-surface border border-cc-border rounded-xl p-6 w-[520px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-dialog-title"
      >
        <h2 id="create-project-dialog-title" className="text-cc-fg text-lg mb-4">
          Create Project
        </h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="cp-root" className="block text-sm">
              <span className="text-cc-muted">Project root path (must already exist or be createable)</span>
            </label>
            <div className="relative mt-1">
              <div className="flex gap-1.5">
                <input
                  id="cp-root"
                  ref={rootInputRef}
                  className="flex-1 min-w-0 bg-cc-input-bg border border-cc-border rounded px-2 py-1 text-cc-fg outline-none focus:border-cc-primary"
                  value={root}
                  onChange={(e) => handleRootChange(e.target.value)}
                  placeholder="/Users/x/Code/my-project"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const desktop = (window as unknown as {
                      pneumaDesktop?: { showOpenDialog: (opts: { title: string; defaultPath?: string }) => Promise<string | null> };
                    }).pneumaDesktop;
                    if (desktop?.showOpenDialog) {
                      const selected = await desktop.showOpenDialog({
                        title: "Select Project Root",
                        defaultPath: root || homeDir || undefined,
                      });
                      if (selected) handleRootChange(selected);
                    } else {
                      setBrowsing((b) => !b);
                    }
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                    browsing
                      ? "bg-cc-primary/20 border-cc-primary/50 text-cc-primary"
                      : "bg-cc-input-bg border-cc-border text-cc-muted hover:text-cc-fg"
                  }`}
                  title="Browse directories"
                  aria-label="Browse directories"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                </button>
              </div>
              {browsing && (
                <DirBrowser
                  startPath={root || homeDir || "/"}
                  apiBase={getApiBase()}
                  onSelect={(p) => handleRootChange(p)}
                  onClose={() => setBrowsing(false)}
                />
              )}
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-cc-muted">Display name</span>
            <input
              className="w-full mt-1 bg-cc-input-bg border border-cc-border rounded px-2 py-1 text-cc-fg outline-none focus:border-cc-primary"
              value={displayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              placeholder={basenameToTitleCase(root) || "My Project"}
            />
          </label>
          <label className="block text-sm">
            <span className="text-cc-muted">Description (optional)</span>
            <textarea
              className="w-full mt-1 bg-cc-input-bg border border-cc-border rounded px-2 py-1 text-cc-fg outline-none focus:border-cc-primary"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {/* Init from existing sessions */}
          <div className="border border-cc-border/60 rounded">
            <button
              type="button"
              onClick={() => setImportExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-cc-fg hover:bg-cc-hover/40 cursor-pointer"
              aria-expanded={importExpanded}
            >
              <span className="flex items-center gap-2">
                <svg
                  className={`w-3 h-3 text-cc-muted transition-transform ${importExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-cc-muted">Initialize from existing sessions</span>
                <span className="text-cc-muted/50 text-xs">(optional)</span>
              </span>
              {selectedIds.size > 0 && (
                <span className="text-xs text-cc-primary font-medium">
                  {selectedIds.size} selected
                </span>
              )}
            </button>
            {importExpanded && (
              <div className="border-t border-cc-border/60 max-h-56 overflow-y-auto">
                {sessionsLoading && (
                  <div className="px-3 py-4 text-center">
                    <div className="inline-block w-4 h-4 rounded-full border-2 border-cc-primary border-t-transparent animate-spin" />
                  </div>
                )}
                {sessionsError && (
                  <div className="px-3 py-2 text-xs text-cc-error">{sessionsError}</div>
                )}
                {!sessionsLoading && !sessionsError && availableSessions.length === 0 && (
                  <div className="px-3 py-4 text-center text-cc-muted/60 text-xs">
                    No quick sessions to import.
                  </div>
                )}
                {!sessionsLoading && availableSessions.map((s) => {
                  const checked = selectedIds.has(s.id);
                  const displayPath = shortenPath(s.workspace, homeDir || "");
                  return (
                    <label
                      key={s.id}
                      className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-cc-hover/40 border-b border-cc-border/30 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(s.id)}
                        className="accent-cc-primary mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Mode badge + Display name (left) + Timestamp (right) */}
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-cc-input-bg border border-cc-border text-cc-muted shrink-0">
                              {s.mode}
                            </span>
                            <span className="text-sm text-cc-fg truncate">{s.displayName}</span>
                          </div>
                          <span className="text-[10px] text-cc-muted/60 shrink-0 whitespace-nowrap">
                            {timeAgo(s.lastAccessed)}
                          </span>
                        </div>
                        {/* Line 2: Full path with truncate + title for hover */}
                        <div className="text-[10px] text-cc-muted/60 font-mono truncate" title={s.workspace}>
                          {displayPath}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {error && <div className="mt-3 text-cc-error text-sm">{error}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            className="px-3 py-1 text-sm border border-cc-border rounded text-cc-fg hover:border-cc-muted cursor-pointer"
            onClick={onClose}
          >
            Cancel
          </button>
          {/* Split button: primary fires "Create & discover" (auto
              project-onboard on entry); the chevron reveals "Create
              without discovery" for users who want to bring their
              own setup. Both share one rounded outline so the pair
              reads as a single control. */}
          <div ref={actionMenuRef} className="relative inline-flex">
            <button
              type="button"
              className="px-3 py-1 text-sm bg-cc-primary text-white rounded-l border-r border-white/20 disabled:opacity-50 hover:brightness-110 cursor-pointer"
              disabled={!root || submitting}
              onClick={() => void submit(false)}
            >
              {submitting ? "Creating…" : "Create & discover"}
            </button>
            <button
              type="button"
              aria-label="More create options"
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              className="px-2 py-1 text-sm bg-cc-primary text-white rounded-r disabled:opacity-50 hover:brightness-110 cursor-pointer flex items-center"
              disabled={!root || submitting}
              onClick={() => setActionMenuOpen((v) => !v)}
            >
              <svg
                className={`w-3 h-3 transition-transform ${actionMenuOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {actionMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full right-0 mb-2 min-w-[240px] rounded-lg border border-cc-border bg-cc-surface shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] py-1 [animation:overlayFadeIn_140ms_cubic-bezier(0.16,1,0.3,1)] z-10"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void submit(true)}
                  className="w-full text-left px-3 py-2 text-xs text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer flex flex-col gap-0.5"
                >
                  <span>Create without discovery</span>
                  <span className="text-cc-muted/70 text-[11px]">Skip the auto-introduction; set up sessions manually.</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
