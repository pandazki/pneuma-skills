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
import type { ViewerPreviewProps, ViewerFileContent } from "../../../core/types/viewer-contract.js";
import type { FileChannel, Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { parseManifestTs, type ParsedManifest } from "./utils/manifest-parser.js";
import { classifyFile, detectLanguage, type FileCategory } from "./utils/file-classifier.js";

/**
 * No-op FileChannel passed to the dynamically loaded preview viewer in
 * Mode Maker's Preview tab. The preview is read-only mock data, so
 * writes/subscriptions are unreachable in practice. Providing a stub
 * satisfies ViewerPreviewProps' required fileChannel prop added in P3.
 */
const STUB_FILE_CHANNEL: FileChannel = {
  snapshot: () => [],
  subscribe: () => () => { },
  write: async () => { },
  delete: async () => { },
};

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

function getChecklist(files: ViewerFileContent[]): CheckItem[] {
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

// ── Smart summary generators ─────────────────────────────────────────────────

function getManifestSummary(parsed: ParsedManifest): string {
  if (!parsed.name) return "Mode identity and configuration";
  const parts: string[] = [];
  parts.push(parsed.name);
  if (parsed.version) parts[0] += ` v${parsed.version}`;
  if (parsed.watchPatterns && parsed.watchPatterns.length > 0) {
    const shown = parsed.watchPatterns.slice(0, 3).join(", ");
    const more = parsed.watchPatterns.length > 3 ? ` +${parsed.watchPatterns.length - 3} more` : "";
    parts.push(`watches ${shown}${more}`);
  }
  if (parsed.workspaceType) parts.push(`${parsed.workspaceType} workspace`);
  return parts.join(" — ");
}

function getModeDefSummary(files: ViewerFileContent[]): string {
  const modeDef = files.find((f) => f.path === "pneuma-mode.ts" || f.path === "pneuma-mode.js");
  if (!modeDef) return "Manifest + viewer binding";
  const match = modeDef.content.match(/import\s+(\w+)\s+from\s+["']\.\/(viewer\/[^"']+)["']/);
  if (!match) return "Manifest + viewer binding";
  return `Binds ${match[1]} from ${match[2].replace(/\.[jt]sx?$/, "").replace(/\.js$/, "")}`;
}

function getViewerSummary(files: ViewerFileContent[]): string {
  const viewerFiles = files.filter((f) => classifyFile(f.path) === "viewer");
  if (viewerFiles.length === 0) return "Preview component";
  const totalLines = viewerFiles.reduce((sum, f) => sum + f.content.split("\n").length, 0);
  if (viewerFiles.length === 1) {
    const name = viewerFiles[0].path.split("/").pop() || viewerFiles[0].path;
    return `${name} — ${totalLines} lines`;
  }
  return `${viewerFiles.length} files, ${totalLines} lines`;
}

function getSkillSummary(files: ViewerFileContent[]): string {
  const skill = files.find((f) => f.path === "skill/SKILL.md");
  if (!skill) return "Domain knowledge prompt";
  const headings = skill.content.split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
  if (headings.length === 0) {
    const lineCount = skill.content.split("\n").length;
    return `Skill prompt — ${lineCount} lines`;
  }
  const shown = headings.slice(0, 3).join(", ");
  const more = headings.length > 3 ? `...+${headings.length - 3}` : "";
  return `${headings.length} sections: ${shown}${more}`;
}

function getSeedSummary(files: ViewerFileContent[]): string {
  const seedFiles = files.filter((f) => classifyFile(f.path) === "seed");
  if (seedFiles.length === 0) return "Initial workspace files";
  const names = seedFiles.map((f) => f.path.replace(/^seed\//, "").split("/").pop() || f.path);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` +${names.length - 3} more` : "";
  return `${seedFiles.length} file${seedFiles.length > 1 ? "s" : ""}: ${shown}${more}`;
}

// ── Detail renderers ─────────────────────────────────────────────────────────

function ManifestDetail({ parsed }: { parsed: ParsedManifest }) {
  const entries: [string, string | string[]][] = [];
  if (parsed.name) entries.push(["name", parsed.name]);
  if (parsed.version) entries.push(["version", parsed.version]);
  if (parsed.displayName) entries.push(["displayName", parsed.displayName]);
  if (parsed.description) entries.push(["description", parsed.description]);
  if (parsed.installName) entries.push(["installName", parsed.installName]);
  if (parsed.workspaceType) entries.push(["workspaceType", parsed.workspaceType]);
  if (parsed.watchPatterns) entries.push(["watchPatterns", parsed.watchPatterns]);

  if (entries.length === 0) return <div className="text-xs text-cc-muted">No manifest fields parsed</div>;

  return (
    <div className="space-y-1.5">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-3 text-xs">
          <span className="text-cc-muted w-28 shrink-0 font-mono">{key}</span>
          <span className="text-cc-fg min-w-0">
            {Array.isArray(val)
              ? val.map((v, i) => <code key={i} className="bg-cc-surface border border-cc-border px-1 py-0.5 rounded break-all mr-1 text-cc-muted">{v}</code>)
              : val}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModeDefDetail({ files }: { files: ViewerFileContent[] }) {
  const modeDef = files.find((f) => f.path === "pneuma-mode.ts" || f.path === "pneuma-mode.js");
  if (!modeDef) return <div className="text-xs text-cc-muted">File not found</div>;

  const content = modeDef.content;
  const manifestMatch = content.match(/import\s+(\w+)\s+from\s+["']\.\/manifest[^"']*["']/);
  const viewerMatch = content.match(/import\s+(\w+)\s+from\s+["']\.\/(viewer\/[^"']+)["']/);
  const wsTypeMatch = content.match(/type:\s*["'](\w+)["']/);
  const hasExtractContext = /extractContext\s*\(/.test(content);
  const strategyMatch = content.match(/updateStrategy:\s*["']([^"']+)["']/);

  const rows: [string, string][] = [];
  if (manifestMatch) rows.push(["Manifest", `${manifestMatch[1]} from ./manifest`]);
  if (viewerMatch) rows.push(["Viewer", `${viewerMatch[1]} from ./${viewerMatch[2]}`]);
  if (wsTypeMatch) rows.push(["Workspace", wsTypeMatch[1]]);
  if (hasExtractContext) rows.push(["extractContext", "defined"]);
  if (strategyMatch) rows.push(["updateStrategy", strategyMatch[1]]);

  if (rows.length === 0) return <div className="text-xs text-cc-muted">Could not parse bindings</div>;

  return (
    <div className="space-y-1.5">
      {rows.map(([key, val]) => (
        <div key={key} className="flex gap-3 text-xs">
          <span className="text-cc-muted w-28 shrink-0 font-mono">{key}</span>
          <span className="text-cc-fg">{val}</span>
        </div>
      ))}
    </div>
  );
}

function SkillOutline({ files }: { files: ViewerFileContent[] }) {
  const skill = files.find((f) => f.path === "skill/SKILL.md");
  if (!skill) return <div className="text-xs text-cc-muted">File not found</div>;

  const lines = skill.content.split("\n");
  const headings = lines
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (!match) return null;
      return { depth: match[1].length, text: match[2].trim() };
    })
    .filter((h): h is { depth: number; text: string } => h !== null);

  const depthColors = ["text-cc-fg", "text-cc-fg/80", "text-cc-muted", "text-cc-muted/80"];

  return (
    <div className="space-y-0.5">
      {headings.map((h, i) => (
        <div
          key={i}
          className={`text-xs ${depthColors[Math.min(h.depth - 1, depthColors.length - 1)]}`}
          style={{ paddingLeft: `${(h.depth - 1) * 16}px` }}
        >
          {h.text}
        </div>
      ))}
      <div className="text-[11px] text-cc-muted pt-1.5 mt-1 border-t border-cc-border">
        {lines.length} lines total
      </div>
    </div>
  );
}

// ── Shared types ──────────────────────────────────────────────────────────────

interface AvailableMode {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  version?: string;
  source: "builtin" | "local";
  path?: string;
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
        className="bg-cc-surface/90 backdrop-blur-2xl border border-cc-border/60 rounded-xl shadow-2xl w-[560px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-cc-border/50">
          <h3 className="text-base font-medium text-cc-fg">{title}</h3>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Structure Card ───────────────────────────────────────────────────────────

function StructureCard({ title, subtitle, done, expandable, expanded, onToggle, onClick, children }: {
  title: string;
  subtitle: string;
  done: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const handleClick = () => {
    if (expandable && done) {
      onToggle?.();
    } else {
      onClick?.();
    }
  };

  return (
    <div
      className={`rounded-xl border bg-cc-surface/50 p-4 cursor-pointer hover:bg-cc-surface transition-all ${done ? "border-cc-border hover:border-cc-primary/30" : "border-cc-border/30 opacity-80"
        } ${expanded ? "col-span-2" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-cc-fg">{title}</span>
          {expandable && done && (
            <svg
              className={`w-3.5 h-3.5 text-cc-muted transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
          {!expandable && done && (
            <svg className="w-3 h-3 text-cc-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 17l9.2-9.2M17 17V7H7" />
            </svg>
          )}
        </div>
        <span className={`flex items-center gap-1.5 text-xs ${done ? "text-cc-success" : "text-cc-muted"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${done ? "bg-cc-success drop-shadow-[0_0_8px_rgba(45,212,191,0.5)]" : "bg-cc-border"}`} />
          {done ? "Ready" : "Missing"}
        </span>
      </div>
      <div className="text-xs text-cc-muted">{subtitle}</div>
      {expanded && children && (
        <div className="mt-4 pt-4 border-t border-cc-border/50" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-surface p-4 flex flex-col min-w-[180px] flex-1">
      <h4 className="text-sm font-medium text-cc-fg mb-0.5">{title}</h4>
      <p className="text-xs text-cc-muted mb-4 flex-1">{description}</p>
      {children}
    </div>
  );
}

// ── Publish result type ──────────────────────────────────────────────────────

interface PublishResult {
  url: string;
  version: string;
  runCommand: string;
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ files, parsed, onSelectFile, onTabChange }: {
  files: ViewerFileContent[];
  parsed: ParsedManifest;
  onSelectFile: (path: string) => void;
  onTabChange: (tab: TabId) => void;
}) {
  const checklist = getChecklist(files);
  const doneCount = checklist.filter((c) => c.done).length;

  // ── Expand state ──
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const toggleCard = useCallback((title: string) => {
    setExpandedCard((prev) => prev === title ? null : title);
  }, []);

  // ── Computed summaries ──
  const summaries = useMemo(() => ({
    manifest: getManifestSummary(parsed),
    modeDef: getModeDefSummary(files),
    viewer: getViewerSummary(files),
    skill: getSkillSummary(files),
    seed: getSeedSummary(files),
  }), [files, parsed]);

  // ── Import state ──
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importTab, setImportTab] = useState<"modes" | "url">("modes");
  const [availableModes, setAvailableModes] = useState<AvailableMode[]>([]);
  const [selectedMode, setSelectedMode] = useState<string>("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string>("");
  const [importUrl, setImportUrl] = useState("");

  // ── Play state ──
  const [playState, setPlayState] = useState<PlayStatus>({ running: false });
  const [playLoading, setPlayLoading] = useState(false);
  const [playError, setPlayError] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Publish state ──
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string>("");
  const [publishErrorCode, setPublishErrorCode] = useState<string>("");
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

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
        .catch(() => { });
    };
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [api]);

  // Whether the workspace already has files the fork will overwrite. Shown
  // up front so the confirm warning appears BEFORE the first click — the
  // earlier two-step dance (click, read warning, click again) was easy to
  // abandon halfway and made fork look broken.
  const workspaceHasFiles = files.length > 0;

  // ── Import handlers ──
  const openImportDialog = useCallback(() => {
    setImportError("");
    setSelectedMode("");
    setImportTab("modes");
    setImportUrl("");
    setShowImportDialog(true);
    fetch(`${api}/api/mode-maker/modes`)
      .then((r) => r.json())
      .then((data: { modes: AvailableMode[] }) => {
        setAvailableModes(data.modes);
        if (data.modes.length > 0) setSelectedMode(data.modes[0].name);
      })
      .catch((err) => setImportError(err.message));
  }, [api]);

  const doImport = useCallback(() => {
    if (!selectedMode) return;
    const selected = availableModes.find((m) => m.name === selectedMode);
    setImportLoading(true);
    setImportError("");
    fetch(`${api}/api/mode-maker/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceMode: selectedMode,
        sourcePath: selected?.source === "local" ? selected.path : undefined,
        overwrite: workspaceHasFiles,
      }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.success) {
          setShowImportDialog(false);
        } else {
          setImportError(data.message || "Import failed");
        }
      })
      .catch((err) => setImportError(err.message))
      .finally(() => setImportLoading(false));
  }, [api, selectedMode, availableModes, workspaceHasFiles]);

  // Auto-fork on first mount when the launcher passed forkSource in the URL.
  // Triggered by "Edit" in the Mode Gallery: launcher navigates the user here
  // with `?forkSource=slide` (builtin) or `?forkSourcePath=/abs/path` (local)
  // so this freshly-seeded workspace gets the selected mode's code without
  // a second manual step. The query params are stripped after firing so a
  // reload doesn't re-trigger.
  const autoForkTriggered = useRef(false);
  useEffect(() => {
    if (autoForkTriggered.current) return;
    const params = new URLSearchParams(window.location.search);
    const sourceMode = params.get("forkSource");
    const sourcePath = params.get("forkSourcePath");
    if (!sourceMode && !sourcePath) return;
    autoForkTriggered.current = true;
    const clean = new URL(window.location.href);
    clean.searchParams.delete("forkSource");
    clean.searchParams.delete("forkSourcePath");
    window.history.replaceState({}, "", clean.pathname + clean.search);
    fetch(`${api}/api/mode-maker/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceMode: sourceMode || sourcePath || "",
        sourcePath: sourcePath || undefined,
        overwrite: true,
      }),
    }).catch(() => { /* best-effort; user can still fork via Import... */ });
  }, [api]);

  const doImportUrl = useCallback(() => {
    if (!importUrl.trim()) return;
    setImportLoading(true);
    setImportError("");
    fetch(`${api}/api/mode-maker/fork-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importUrl.trim(), overwrite: workspaceHasFiles }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.success) {
          setShowImportDialog(false);
        } else {
          setImportError(data.message || "Import failed");
        }
      })
      .catch((err) => setImportError(err.message))
      .finally(() => setImportLoading(false));
  }, [api, importUrl, workspaceHasFiles]);

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
      .catch(() => { });
  }, [api]);

  // ── Publish handler ──
  const doPublish = useCallback((force = false) => {
    setPublishLoading(true);
    setPublishError("");
    setPublishErrorCode("");
    setPublishResult(null);
    fetch(`${api}/api/mode-maker/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.success) {
          setPublishResult({ url: data.url, version: data.version, runCommand: data.runCommand });
        } else {
          setPublishError(data.message || "Publish failed");
          setPublishErrorCode(data.errorCode || "");
        }
      })
      .catch((err) => {
        setPublishError(err.message);
        setPublishErrorCode("");
      })
      .finally(() => setPublishLoading(false));
  }, [api]);

  const copyUrl = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  }, []);

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
      .catch(() => { })
      .finally(() => setResetLoading(false));
  }, [api]);

  // Map checklist items to structure card props
  const structureCards: {
    title: string; subtitle: string; done: boolean;
  }[] = [
      { title: "Manifest", subtitle: summaries.manifest, done: checklist[0].done },
      { title: "Mode Definition", subtitle: summaries.modeDef, done: checklist[1].done },
      { title: "Viewer", subtitle: summaries.viewer, done: checklist[2].done },
      { title: "Agent Skill", subtitle: summaries.skill, done: checklist[3].done },
      { title: "Seed Content", subtitle: summaries.seed, done: checklist[4].done },
    ];

  return (
    <div className="p-5 space-y-6">
      {/* ── Identity Header ── */}
      <div className="rounded-2xl border border-cc-border/50 bg-cc-card backdrop-blur-xl p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-cc-fg">
              {parsed.displayName || parsed.name || "Untitled Mode"}
            </h2>
            {parsed.name && (
              <code className="text-sm text-cc-muted mt-1 block">
                {parsed.name}
              </code>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              onClick={openImportDialog}
            >
              Import...
            </button>
            {parsed.version && (
              <span className="text-xs bg-cc-surface border border-cc-border text-cc-muted px-2 py-1 rounded-md tracking-wide">
                v{parsed.version}
              </span>
            )}
          </div>
        </div>
        {parsed.description && (
          <p className="text-sm text-cc-muted/80 mt-3">{parsed.description}</p>
        )}
        <div className="mt-4 flex gap-4 text-xs text-cc-muted">
          {parsed.installName && (
            <span className="flex items-center gap-1.5">Skill <code className="text-cc-fg bg-cc-surface border border-cc-border px-1.5 py-0.5 rounded-md">{parsed.installName}</code></span>
          )}
          {parsed.workspaceType && (
            <span className="flex items-center gap-1.5">Workspace <code className="text-cc-fg bg-cc-surface border border-cc-border px-1.5 py-0.5 rounded-md">{parsed.workspaceType}</code></span>
          )}
        </div>
        {parsed.watchPatterns && parsed.watchPatterns.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-cc-muted flex-wrap">
            Watch
            {parsed.watchPatterns.map((p, i) => (
              <code key={i} className="text-cc-fg bg-cc-surface border border-cc-border px-1.5 py-0.5 rounded-md">{p}</code>
            ))}
          </div>
        )}
      </div>

      {/* ── Package Structure ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-cc-fg">Package Structure</h3>
          <span className="text-xs text-cc-muted">{doneCount}/{checklist.length} components</span>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-cc-surface border border-cc-border/50 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-cc-success drop-shadow-[0_0_8px_rgba(45,212,191,0.5)] transition-all duration-300"
            style={{ width: `${(doneCount / checklist.length) * 100}%` }}
          />
        </div>
        {/* 2-column grid */}
        <div className="grid grid-cols-2 gap-3">
          {structureCards.map((card) => {
            const isExpandable = card.title === "Manifest" || card.title === "Mode Definition" || card.title === "Agent Skill";
            const isExpanded = expandedCard === card.title;
            return (
              <StructureCard
                key={card.title}
                title={card.title}
                subtitle={card.subtitle}
                done={card.done}
                expandable={isExpandable}
                expanded={isExpanded}
                onToggle={() => toggleCard(card.title)}
                onClick={() => {
                  if (card.title === "Viewer" || card.title === "Seed Content") {
                    onTabChange("preview");
                  }
                }}
              >
                {isExpanded && card.title === "Manifest" && <ManifestDetail parsed={parsed} />}
                {isExpanded && card.title === "Mode Definition" && <ModeDefDetail files={files} />}
                {isExpanded && card.title === "Agent Skill" && <SkillOutline files={files} />}
              </StructureCard>
            );
          })}
        </div>
      </div>

      {/* ── Actions ── */}
      <div>
        <h3 className="text-sm font-medium text-cc-fg mb-3">Actions</h3>
        <div className="flex gap-3 flex-wrap">
          {/* Test card */}
          <ActionCard title="Test" description="Launch in a temporary workspace">
            {playState.running ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <a
                    href={playState.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs bg-cc-primary hover:bg-cc-primary-hover text-cc-bg font-medium rounded-md transition-colors shadow-[0_0_10px_rgba(249,115,22,0.2)]"
                  >
                    Open
                  </a>
                  <button
                    className="px-3 py-1.5 text-xs border border-cc-border bg-cc-surface hover:border-cc-primary/50 hover:text-cc-primary text-cc-fg rounded-md transition-colors cursor-pointer"
                    onClick={stopPlay}
                  >
                    Stop
                  </button>
                </div>
                <div className="text-[11px] text-zinc-500">Port {playState.port} &middot; PID {playState.pid}</div>
              </div>
            ) : (
              <button
                className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:opacity-50 self-start"
                onClick={startPlay}
                disabled={playLoading}
              >
                {playLoading ? "Starting..." : "Play"}
              </button>
            )}
            {playError && <div className="text-xs text-red-400 mt-2">{playError}</div>}
          </ActionCard>

          {/* Publish card */}
          <ActionCard title="Publish" description="Upload mode package to registry">
            {publishResult ? (
              <div className="space-y-2">
                <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded p-2.5">
                  Published v{publishResult.version}
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-900/50 rounded p-2">
                  <code className="text-[11px] text-zinc-300 truncate flex-1">{publishResult.runCommand}</code>
                  <button
                    className="text-xs text-zinc-400 hover:text-zinc-200 shrink-0 transition-colors"
                    onClick={() => copyUrl(publishResult.runCommand)}
                  >
                    {copiedUrl ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {publishErrorCode === "NO_CREDENTIALS" && (
                  <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded p-2.5 mb-2">
                    {publishError}
                  </div>
                )}
                {publishErrorCode === "VERSION_EXISTS" && (
                  <div className="space-y-2">
                    <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded p-2.5">
                      {publishError}
                    </div>
                    <button
                      className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded transition-colors disabled:opacity-50"
                      onClick={() => doPublish(true)}
                      disabled={publishLoading}
                    >
                      {publishLoading ? "Publishing..." : "Force Publish"}
                    </button>
                  </div>
                )}
                {publishErrorCode && publishErrorCode !== "NO_CREDENTIALS" && publishErrorCode !== "VERSION_EXISTS" && (
                  <div className="text-xs text-red-400 mb-2">{publishError}</div>
                )}
                {!publishErrorCode && (
                  <button
                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50 self-start"
                    onClick={() => doPublish(false)}
                    disabled={publishLoading}
                  >
                    {publishLoading ? "Publishing..." : "Publish"}
                  </button>
                )}
              </>
            )}
          </ActionCard>

        </div>
      </div>

      {/* ── Reset footer ── */}
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
        title="Import Mode"
      >
        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-0.5 bg-cc-bg/50 rounded-lg border border-cc-border/30">
          {(["modes", "url"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setImportTab(tab); setImportError(""); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${importTab === tab ? "bg-cc-surface text-cc-fg shadow-sm" : "text-cc-muted hover:text-cc-fg"}`}
            >
              {tab === "modes" ? "Modes" : "From URL"}
            </button>
          ))}
        </div>

        {importError && (
          <div className="text-sm text-red-400 mb-3">{importError}</div>
        )}

        {importTab === "modes" && (
          <>
            {availableModes.length === 0 && !importError && (
              <div className="text-sm text-cc-muted py-6 text-center">Loading modes...</div>
            )}
            <div className="space-y-2 mb-4 max-h-64 overflow-auto pr-1">
              {availableModes.map((m) => {
                const isSelected = selectedMode === m.name;
                const hasSvg = m.icon && m.icon.trim().startsWith("<svg");
                return (
                  <div
                    key={m.name}
                    onClick={() => setSelectedMode(m.name)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? "border-cc-primary/60 bg-cc-primary/5 shadow-[0_0_12px_rgba(249,115,22,0.08)]" : "border-cc-border/40 bg-cc-bg/30 hover:border-cc-border hover:bg-cc-bg/60"}`}
                  >
                    {/* Icon */}
                    <div className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-full border ${isSelected ? "border-cc-primary/40 bg-cc-primary/10" : "border-cc-border/50 bg-cc-surface/50"}`}>
                      {hasSvg ? (
                        <div
                          className={`w-4 h-4 [&>svg]:w-full [&>svg]:h-full ${isSelected ? "text-cc-primary" : "text-cc-muted"}`}
                          dangerouslySetInnerHTML={{ __html: m.icon! }}
                        />
                      ) : (
                        <svg className={`w-4 h-4 ${isSelected ? "text-cc-primary" : "text-cc-muted"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
                      )}
                    </div>
                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSelected ? "text-cc-fg" : "text-cc-fg/80"}`}>
                          {m.displayName || m.name}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${m.source === "builtin" ? "bg-cc-border/40 text-cc-muted" : "bg-cc-primary-muted/50 text-cc-primary"}`}>
                          {m.source}
                        </span>
                        {m.version && m.version !== "builtin" && (
                          <span className="text-[10px] text-cc-muted">v{m.version}</span>
                        )}
                      </div>
                      {m.description && (
                        <div className="text-xs text-cc-muted mt-0.5 truncate">{m.description}</div>
                      )}
                    </div>
                    {/* File count */}
                    <span className="text-[10px] text-cc-muted shrink-0">{m.fileCount} files</span>
                  </div>
                );
              })}
            </div>
            {workspaceHasFiles && (
              <div className="text-xs text-amber-400 mb-3 bg-amber-900/20 border border-amber-800/30 rounded-lg p-2.5">
                Workspace has {files.length} existing file{files.length === 1 ? "" : "s"}. Importing will replace them with the selected mode's contents.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                onClick={() => setShowImportDialog(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-cc-primary hover:bg-cc-primary-hover text-cc-bg font-medium rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                onClick={() => doImport()}
                disabled={importLoading || !selectedMode}
              >
                {importLoading ? "Importing..." : workspaceHasFiles ? "Overwrite & Import" : "Import"}
              </button>
            </div>
          </>
        )}

        {importTab === "url" && (
          <>
            <p className="text-xs text-cc-muted mb-3">
              Enter a mode package URL (.tar.gz) to download and import.
            </p>
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://example.com/modes/my-mode/1.0.0.tar.gz"
              className="w-full px-3 py-2 bg-cc-bg/50 border border-cc-border/50 rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50 placeholder:text-cc-muted/40 mb-4"
            />
            {workspaceHasFiles && (
              <div className="text-xs text-amber-400 mb-3 bg-amber-900/20 border border-amber-800/30 rounded-lg p-2.5">
                Workspace has {files.length} existing file{files.length === 1 ? "" : "s"}. Importing will replace them with the downloaded mode's contents.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                onClick={() => setShowImportDialog(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-cc-primary hover:bg-cc-primary-hover text-cc-bg font-medium rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                onClick={() => doImportUrl()}
                disabled={importLoading || !importUrl.trim()}
              >
                {importLoading ? "Downloading..." : workspaceHasFiles ? "Overwrite & Import" : "Download & Import"}
              </button>
            </div>
          </>
        )}
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
function findViewerEntryFile(files: ViewerFileContent[]): string | null {
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

function PreviewTab({ files }: { files: ViewerFileContent[] }) {
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
        sources={{}}
        fileChannel={STUB_FILE_CHANNEL}
        selection={null}
        onSelect={() => { }}
        mode="view"
        imageVersion={0}
      />
    </ViewerErrorBoundary>
  );
}

// ── Skill Tab ────────────────────────────────────────────────────────────────

function SkillTab({ files }: { files: ViewerFileContent[] }) {
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

function groupFiles(files: ViewerFileContent[]): FileGroup[] {
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
  files: ViewerFileContent[];
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
                  className={`w-full text-left text-xs px-2 py-1 rounded truncate transition-colors ${f.path === selectedFile
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
  sources,
  onSelect,
  onActiveFileChange,
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];

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
    <div className="flex flex-col h-full bg-cc-bg text-cc-fg">
      {/* Tab bar */}
      <div className="flex border-b border-cc-border/50 shrink-0">
        <div className="flex items-center gap-1 bg-cc-surface/50 border border-cc-border/50 rounded-full p-1 shadow-inner mx-4 my-3">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${activeTab === tab.id
                  ? "bg-cc-primary text-cc-bg shadow-[0_0_12px_rgba(249,115,22,0.4)]"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover cursor-pointer"
                }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "overview" && (
          <div className="h-full overflow-auto">
            <OverviewTab files={files} parsed={parsed} onSelectFile={handleSelectFile} onTabChange={setActiveTab} />
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
