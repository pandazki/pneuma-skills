/**
 * ModeMakerPreview — Mode Maker's viewer component.
 *
 * Four-tab dashboard for developing Pneuma modes:
 * - Overview: Mode identity card + structure completeness checklist
 * - Preview: Render seed/ files with type-appropriate renderers
 * - Skill: Render skill/SKILL.md as markdown
 * - Files: File tree + CodeMirror read-only preview
 */

import { useState, useMemo, useCallback, useEffect, useRef, Component } from "react";
import type { ComponentType, ErrorInfo, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown as mdLang } from "@codemirror/lang-markdown";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { parseManifestTs, type ParsedManifest } from "./utils/manifest-parser.js";
import { classifyFile, detectLanguage, type FileCategory } from "./utils/file-classifier.js";

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

type TabId = "overview" | "preview" | "skill" | "files";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "preview", label: "Preview" },
  { id: "skill", label: "Skill" },
  { id: "files", label: "Files" },
];

/** Get CodeMirror language extension for a file */
function getLanguageExtension(lang: string) {
  switch (lang) {
    case "typescript":
    case "javascript":
      return javascript({ typescript: lang === "typescript", jsx: true });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "markdown":
      return mdLang();
    default:
      return [];
  }
}

// ── Completeness check ──────────────────────────────────────────────────────

interface CheckItem {
  label: string;
  done: boolean;
  detail?: string;
}

function getChecklist(files: ViewerPreviewProps["files"]): CheckItem[] {
  const paths = files.map((f) => f.path);
  const categories = paths.map((p) => classifyFile(p));

  return [
    {
      label: "manifest.ts",
      done: categories.includes("manifest"),
      detail: paths.find((p) => classifyFile(p) === "manifest"),
    },
    {
      label: "pneuma-mode.ts",
      done: categories.includes("mode-def"),
      detail: paths.find((p) => classifyFile(p) === "mode-def"),
    },
    {
      label: "viewer component",
      done: categories.includes("viewer"),
      detail: paths.filter((p) => classifyFile(p) === "viewer").join(", ") || undefined,
    },
    {
      label: "skill/SKILL.md",
      done: files.some((f) => f.path === "skill/SKILL.md"),
    },
    {
      label: "seed content",
      done: categories.includes("seed"),
      detail: `${paths.filter((p) => classifyFile(p) === "seed").length} file(s)`,
    },
  ];
}

// ── Shared types ──────────────────────────────────────────────────────────────

interface AvailableMode {
  name: string;
  displayName?: string;
  description?: string;
  fileCount: number;
}

interface PlayStatus {
  running: boolean;
  pid?: number;
  port?: number;
  url?: string;
}

// ── Modal Dialog ──────────────────────────────────────────────────────────────

function ModalDialog({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-800 border border-zinc-600 rounded-lg shadow-2xl w-[420px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-700">
          <h3 className="text-base font-medium text-zinc-100">{title}</h3>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ files, parsed, onSelectFile }: {
  files: ViewerPreviewProps["files"];
  parsed: ParsedManifest;
  onSelectFile: (path: string) => void;
}) {
  const checklist = getChecklist(files);
  const doneCount = checklist.filter((c) => c.done).length;

  // ── Import state ──
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableModes, setAvailableModes] = useState<AvailableMode[]>([]);
  const [selectedMode, setSelectedMode] = useState<string>("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string>("");
  const [importNeedsConfirm, setImportNeedsConfirm] = useState(false);

  // ── Play state ──
  const [playState, setPlayState] = useState<PlayStatus>({ running: false });
  const [playLoading, setPlayLoading] = useState(false);
  const [playError, setPlayError] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Reset state ──
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const api = getApiBase();

  // Poll play status
  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${api}/api/mode-maker/play/status`)
        .then((r) => r.json())
        .then((data: PlayStatus) => setPlayState(data))
        .catch(() => {});
    };
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [api]);

  // ── Import handlers ──
  const openImportDialog = useCallback(() => {
    setImportError("");
    setImportNeedsConfirm(false);
    setSelectedMode("");
    setShowImportDialog(true);
    fetch(`${api}/api/mode-maker/modes`)
      .then((r) => r.json())
      .then((data: { modes: AvailableMode[] }) => {
        setAvailableModes(data.modes);
        if (data.modes.length > 0) setSelectedMode(data.modes[0].name);
      })
      .catch((err) => setImportError(err.message));
  }, [api]);

  const doImport = useCallback((overwrite = false) => {
    if (!selectedMode) return;
    setImportLoading(true);
    setImportError("");
    fetch(`${api}/api/mode-maker/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceMode: selectedMode, overwrite }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.requireConfirmation) {
          setImportNeedsConfirm(true);
        } else if (data.success) {
          setShowImportDialog(false);
          setImportNeedsConfirm(false);
        } else {
          setImportError(data.message || "Import failed");
        }
      })
      .catch((err) => setImportError(err.message))
      .finally(() => setImportLoading(false));
  }, [api, selectedMode]);

  // ── Play handlers ──
  const startPlay = useCallback(() => {
    setPlayLoading(true);
    setPlayError("");
    fetch(`${api}/api/mode-maker/play`, { method: "POST" })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.success) {
          setPlayState({ running: true, pid: data.pid, port: data.port, url: data.url });
        } else {
          setPlayError(data.message || "Failed to start");
        }
      })
      .catch((err) => setPlayError(err.message))
      .finally(() => setPlayLoading(false));
  }, [api]);

  const stopPlay = useCallback(() => {
    fetch(`${api}/api/mode-maker/play/stop`, { method: "POST" })
      .then(() => setPlayState({ running: false }))
      .catch(() => {});
  }, [api]);

  // ── Reset handler ──
  const doReset = useCallback(() => {
    setResetLoading(true);
    fetch(`${api}/api/mode-maker/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    })
      .then((r) => r.json())
      .then(() => setShowResetConfirm(false))
      .catch(() => {})
      .finally(() => setResetLoading(false));
  }, [api]);

  return (
    <div className="p-5 space-y-6">
      {/* Identity card */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">
              {parsed.displayName || parsed.name || "Untitled Mode"}
            </h2>
            {parsed.name && (
              <code className="text-sm text-zinc-400 mt-1 block">
                {parsed.name}
              </code>
            )}
          </div>
          {parsed.version && (
            <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-1 rounded">
              v{parsed.version}
            </span>
          )}
        </div>
        {parsed.description && (
          <p className="text-sm text-zinc-400 mt-3">{parsed.description}</p>
        )}
        <div className="mt-4 flex gap-4 text-xs text-zinc-500">
          {parsed.installName && (
            <span>Skill: <code className="text-zinc-400">{parsed.installName}</code></span>
          )}
          {parsed.workspaceType && (
            <span>Workspace: <code className="text-zinc-400">{parsed.workspaceType}</code></span>
          )}
        </div>
        {parsed.watchPatterns && parsed.watchPatterns.length > 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            Watch: {parsed.watchPatterns.map((p, i) => (
              <code key={i} className="text-zinc-400 bg-zinc-700/50 px-1.5 py-0.5 rounded mr-1">{p}</code>
            ))}
          </div>
        )}
      </div>

      {/* Completeness checklist */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-3">
          Structure Completeness ({doneCount}/{checklist.length})
        </h3>
        <div className="space-y-2">
          {checklist.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 text-sm cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1.5 -mx-2"
              onClick={() => {
                if (item.detail) {
                  const firstFile = item.detail.split(",")[0].trim();
                  onSelectFile(firstFile);
                }
              }}
            >
              <span className={item.done ? "text-emerald-400" : "text-zinc-600"}>
                {item.done ? "\u2705" : "\u2B1C"}
              </span>
              <span className={item.done ? "text-zinc-200" : "text-zinc-500"}>
                {item.label}
              </span>
              {item.detail && item.done && (
                <span className="text-xs text-zinc-500 ml-auto">{item.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Import from Mode ── */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Import from Mode</h3>
            <p className="text-xs text-zinc-500 mt-1">Copy files from an existing builtin mode as a starting point</p>
          </div>
          <button
            className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
            onClick={openImportDialog}
          >
            Import...
          </button>
        </div>
      </div>

      {/* ── Test Mode (Play) ── */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Test Mode</h3>
            <p className="text-xs text-zinc-500 mt-1">Launch this mode in a temporary workspace to test it</p>
          </div>
          <div className="flex items-center gap-2">
            {playState.running ? (
              <>
                <a
                  href={playState.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                >
                  Open
                </a>
                <button
                  className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                  onClick={stopPlay}
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:opacity-50"
                onClick={startPlay}
                disabled={playLoading}
              >
                {playLoading ? "Starting..." : "Play"}
              </button>
            )}
          </div>
        </div>
        {playState.running && (
          <div className="mt-2 text-xs text-zinc-500">
            Port {playState.port} &middot; PID {playState.pid}
          </div>
        )}
        {playError && (
          <div className="mt-2 text-xs text-red-400">{playError}</div>
        )}
      </div>

      {/* ── Reset ── */}
      <div className="pt-2 border-t border-zinc-800">
        <button
          className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          onClick={() => setShowResetConfirm(true)}
        >
          Reset to Seed Templates
        </button>
      </div>

      {/* ── Import Dialog ── */}
      <ModalDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        title="Import from Existing Mode"
      >
        {availableModes.length === 0 && !importError && (
          <div className="text-sm text-zinc-400 py-4 text-center">Loading modes...</div>
        )}
        {importError && (
          <div className="text-sm text-red-400 mb-3">{importError}</div>
        )}
        <div className="space-y-1 mb-4 max-h-48 overflow-auto">
          {availableModes.map((m) => (
            <label
              key={m.name}
              className={`flex items-start gap-3 p-2.5 rounded cursor-pointer transition-colors ${
                selectedMode === m.name ? "bg-zinc-700" : "hover:bg-zinc-700/50"
              }`}
            >
              <input
                type="radio"
                name="importMode"
                value={m.name}
                checked={selectedMode === m.name}
                onChange={() => setSelectedMode(m.name)}
                className="mt-0.5 accent-blue-500"
              />
              <div className="min-w-0">
                <div className="text-sm text-zinc-200 font-medium">{m.name}</div>
                {m.description && (
                  <div className="text-xs text-zinc-400 mt-0.5">{m.description}</div>
                )}
                <div className="text-xs text-zinc-500 mt-0.5">{m.fileCount} files</div>
              </div>
            </label>
          ))}
        </div>
        {importNeedsConfirm && (
          <div className="text-xs text-amber-400 mb-3 bg-amber-900/20 border border-amber-800/30 rounded p-2.5">
            Workspace has existing files. Importing will add/overwrite files from the selected mode.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={() => setShowImportDialog(false)}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
            onClick={() => doImport(importNeedsConfirm)}
            disabled={importLoading || !selectedMode}
          >
            {importLoading ? "Importing..." : importNeedsConfirm ? "Overwrite & Import" : "Import"}
          </button>
        </div>
      </ModalDialog>

      {/* ── Reset Confirm Dialog ── */}
      <ModalDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset Workspace?"
      >
        <p className="text-sm text-zinc-300 mb-2">
          All files will be deleted and replaced with seed templates.
        </p>
        <p className="text-xs text-zinc-500 mb-4">
          <code>.pneuma/</code> <code>.claude/</code> <code>.git/</code> directories are preserved.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={() => setShowResetConfirm(false)}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
            onClick={doReset}
            disabled={resetLoading}
          >
            {resetLoading ? "Resetting..." : "Reset"}
          </button>
        </div>
      </ModalDialog>
    </div>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────

class ViewerErrorBoundary extends Component<
  { children: ReactNode; onError?: (err: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-5 text-red-400 text-sm">
          <div className="font-medium mb-1">Viewer render error</div>
          <pre className="text-xs whitespace-pre-wrap opacity-80 bg-red-900/20 border border-red-800/30 rounded p-3">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Preview Tab (dynamic viewer) ──────────────────────────────────────────────

/** Parse pneuma-mode.ts to find the viewer component file path. */
function findViewerEntryFile(files: ViewerPreviewProps["files"]): string | null {
  const modeDef = files.find((f) => f.path === "pneuma-mode.ts" || f.path === "pneuma-mode.js");
  if (!modeDef) return null;

  // Match: import <Name> from "./viewer/<path>"
  const match = modeDef.content.match(/import\s+\w+\s+from\s+["']\.\/(viewer\/[^"']+)["']/);
  if (!match) return null;

  const importPath = match[1]; // e.g. "viewer/Preview.js"
  const basePath = importPath.replace(/\.[jt]sx?$/, ""); // "viewer/Preview"

  // Find the actual source file (.tsx > .ts > .jsx > .js)
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = basePath + ext;
    if (files.some((f) => f.path === candidate)) return candidate;
  }

  return null;
}

function PreviewTab({ files }: { files: ViewerPreviewProps["files"] }) {
  const [dynViewer, setDynViewer] = useState<{ C: ComponentType<ViewerPreviewProps> } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [importVersion, setImportVersion] = useState(0);

  const workspacePath = (import.meta.env.VITE_MODE_MAKER_WORKSPACE as string) || "";
  const isDev = import.meta.env.DEV;

  // Find viewer entry from pneuma-mode.ts import
  const viewerEntry = useMemo(() => findViewerEntryFile(files), [files]);

  // Track viewer file content changes → trigger re-import
  const viewerContentHash = useMemo(() => {
    const relevant = files.filter(
      (f) => f.path.startsWith("viewer/") || f.path === "pneuma-mode.ts" || f.path === "manifest.ts",
    );
    // Use content length + sampled chars as change fingerprint
    return relevant.map((f) => {
      const c = f.content;
      return `${f.path}:${c.length}:${c.slice(0, 32)}${c.slice(-32)}`;
    }).join("|");
  }, [files]);

  // Re-import when viewer content changes (via file watcher)
  const prevHashRef = useRef(viewerContentHash);
  useEffect(() => {
    if (prevHashRef.current !== viewerContentHash) {
      prevHashRef.current = viewerContentHash;
      setImportVersion((v) => v + 1);
    }
  }, [viewerContentHash]);

  // Listen for Vite HMR event — workspace file changed on disk, module cache invalidated
  useEffect(() => {
    if (!isDev || !import.meta.hot) return;
    const handler = () => {
      console.log("[mode-maker] Workspace file changed, re-importing viewer...");
      setImportVersion((v) => v + 1);
    };
    import.meta.hot.on("pneuma:workspace-update", handler);
    return () => {
      import.meta.hot!.off("pneuma:workspace-update", handler);
    };
  }, [isDev]);

  // Dynamic import of the viewer component
  useEffect(() => {
    if (!isDev || !workspacePath || !viewerEntry) {
      setDynViewer(null);
      if (!isDev && viewerEntry) {
        setLoadError("Live preview requires dev mode (bun run dev)");
      } else if (!viewerEntry) {
        setLoadError("");
      }
      return;
    }

    setLoadError("");
    const url = `/@fs${workspacePath}/${viewerEntry}?t=${Date.now()}`;

    import(/* @vite-ignore */ url)
      .then((mod) => {
        const C = mod.default;
        if (typeof C === "function") {
          setDynViewer({ C });
          setLoadError("");
        } else {
          setLoadError(`${viewerEntry} doesn't export a default React component`);
          setDynViewer(null);
        }
      })
      .catch((err) => {
        console.error("[mode-maker] Dynamic viewer import failed:", err);
        setLoadError(String(err.message || err));
        setDynViewer(null);
      });
  }, [isDev, workspacePath, viewerEntry, importVersion]);

  // Prepare seed files as mock workspace data (strip seed/ prefix)
  const mockFiles = useMemo(() => {
    const seeds = files
      .filter((f) => classifyFile(f.path) === "seed")
      .map((f) => ({ path: f.path.replace(/^seed\//, ""), content: f.content }));
    // Provide a default file if no seeds exist
    return seeds.length > 0
      ? seeds
      : [{ path: "example.md", content: "# Hello\n\nThis is a preview. Add files to `seed/` to customize." }];
  }, [files]);

  // No viewer component in workspace
  if (!viewerEntry) {
    const hasViewerFiles = files.some((f) => classifyFile(f.path) === "viewer");
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 p-8">
        <div className="text-4xl opacity-50">&#9654;&#65039;</div>
        <p className="text-center text-sm">
          {hasViewerFiles
            ? <>Could not find viewer import in <code className="text-zinc-400">pneuma-mode.ts</code>. Ensure it imports from <code className="text-zinc-400">./viewer/...</code></>
            : <>Create a viewer component in <code className="text-zinc-400">viewer/</code> and import it in <code className="text-zinc-400">pneuma-mode.ts</code></>
          }
        </p>
      </div>
    );
  }

  // Import error — show error + source fallback
  if (loadError) {
    const viewerFile = files.find((f) => f.path === viewerEntry);
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 shrink-0">
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded p-3">
            <div className="font-medium mb-1">Preview failed to load</div>
            <pre className="text-xs whitespace-pre-wrap opacity-80">{loadError}</pre>
          </div>
        </div>
        {viewerFile && (
          <div className="flex-1 overflow-auto border-t border-zinc-700">
            <div className="px-3 py-1.5 text-xs text-zinc-500 bg-zinc-800/50 border-b border-zinc-700">
              {viewerEntry} (source)
            </div>
            <CodeMirror
              value={viewerFile.content}
              readOnly
              editable={false}
              theme="dark"
              extensions={[javascript({ typescript: true, jsx: true })]}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
              className="h-full text-sm"
            />
          </div>
        )}
      </div>
    );
  }

  // Loading state
  if (!dynViewer) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading viewer...
      </div>
    );
  }

  // Render the dynamically loaded viewer with mock data
  const DynComponent = dynViewer.C;
  return (
    <ViewerErrorBoundary key={importVersion}>
      <DynComponent
        files={mockFiles}
        selection={null}
        onSelect={() => {}}
        mode="view"
        imageVersion={0}
      />
    </ViewerErrorBoundary>
  );
}

// ── Skill Tab ────────────────────────────────────────────────────────────────

function SkillTab({ files }: { files: ViewerPreviewProps["files"] }) {
  const skillFile = files.find((f) => f.path === "skill/SKILL.md");

  if (!skillFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 p-8">
        <div className="text-4xl opacity-50">&#128220;</div>
        <p className="text-center text-sm">
          No skill file yet. Create <code className="text-zinc-400">skill/SKILL.md</code> to
          define the Agent's domain knowledge for this mode.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto prose prose-invert prose-sm overflow-auto h-full">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {skillFile.content}
      </ReactMarkdown>
    </div>
  );
}

// ── Files Tab ────────────────────────────────────────────────────────────────

interface FileGroup {
  dir: string;
  files: { path: string; name: string }[];
}

function groupFiles(files: ViewerPreviewProps["files"]): FileGroup[] {
  const groups = new Map<string, { path: string; name: string }[]>();

  for (const f of files) {
    const lastSlash = f.path.lastIndexOf("/");
    const dir = lastSlash >= 0 ? f.path.slice(0, lastSlash) : ".";
    const name = lastSlash >= 0 ? f.path.slice(lastSlash + 1) : f.path;
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push({ path: f.path, name });
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({ dir, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
}

function FilesTab({ files, onSelectFile }: {
  files: ViewerPreviewProps["files"];
  onSelectFile: (path: string) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const groups = useMemo(() => groupFiles(files), [files]);

  // Auto-select first file
  useEffect(() => {
    if (files.length > 0 && (!selectedFile || !files.some((f) => f.path === selectedFile))) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);

  const activeFile = files.find((f) => f.path === selectedFile);
  const lang = selectedFile ? detectLanguage(selectedFile) : "text";

  const handleSelect = useCallback((path: string) => {
    setSelectedFile(path);
    onSelectFile(path);
  }, [onSelectFile]);

  return (
    <div className="flex h-full">
      {/* File tree */}
      <div className="w-52 shrink-0 border-r border-zinc-700 overflow-auto">
        <div className="p-2 space-y-3">
          {groups.map((group) => (
            <div key={group.dir}>
              <div className="text-xs text-zinc-500 font-medium px-2 py-1">
                {group.dir === "." ? "root" : group.dir}/
              </div>
              {group.files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full text-left text-xs px-2 py-1 rounded truncate transition-colors ${
                    f.path === selectedFile
                      ? "bg-zinc-600 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300"
                  }`}
                  onClick={() => handleSelect(f.path)}
                  title={f.path}
                >
                  {f.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* File content */}
      <div className="flex-1 overflow-auto">
        {activeFile ? (
          <CodeMirror
            value={activeFile.content}
            readOnly
            editable={false}
            theme="dark"
            extensions={[getLanguageExtension(lang)].flat()}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
            className="h-full text-sm"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ModeMakerPreview({
  files,
  onSelect,
  onActiveFileChange,
}: ViewerPreviewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Parse manifest for Overview tab
  const manifestFile = files.find((f) => f.path === "manifest.ts" || f.path === "manifest.js");
  const parsed = useMemo<ParsedManifest>(
    () => manifestFile ? parseManifestTs(manifestFile.content) : {},
    [manifestFile?.content],
  );

  // File selection → update context
  const handleSelectFile = useCallback((path: string) => {
    onActiveFileChange?.(path);
    onSelect?.({
      type: "file",
      content: path,
      file: path,
    });
  }, [onSelect, onActiveFileChange]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-700 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "overview" && (
          <div className="h-full overflow-auto">
            <OverviewTab files={files} parsed={parsed} onSelectFile={handleSelectFile} />
          </div>
        )}
        {activeTab === "preview" && <PreviewTab files={files} />}
        {activeTab === "skill" && (
          <div className="h-full overflow-auto">
            <SkillTab files={files} />
          </div>
        )}
        {activeTab === "files" && <FilesTab files={files} onSelectFile={handleSelectFile} />}
      </div>
    </div>
  );
}
