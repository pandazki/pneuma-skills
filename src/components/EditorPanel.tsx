import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { useStore } from "../store.js";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

function langForPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md": case "mdx": return markdown();
    case "js": case "jsx": case "mjs": return javascript({ jsx: true });
    case "ts": case "tsx": return javascript({ jsx: true, typescript: true });
    case "json": return json();
    case "css": return css();
    case "html": case "htm": return html();
    case "py": return python();
    default: return markdown(); // fallback
  }
}

type PreviewKind = "image" | "video" | "audio" | "pdf" | null;

function getPreviewKind(path: string): PreviewKind {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "ogg", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return null;
}

function FilePreview({ path }: { path: string }) {
  const kind = getPreviewKind(path);
  const base = getApiBase();
  // Encode each path segment individually to preserve '/'
  const src = `${base}/content/${path.split("/").map(encodeURIComponent).join("/")}`;

  if (kind === "image") {
    return (
      <div className="flex items-center justify-center h-full p-4 overflow-auto bg-neutral-900/50">
        <img
          src={src}
          alt={path}
          className="max-w-full max-h-full object-contain rounded"
          style={{ imageRendering: "auto" }}
        />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <video src={src} controls className="max-w-full max-h-full rounded" />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-neutral-500 text-sm">{path.split("/").pop()}</span>
        <audio src={src} controls />
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <iframe src={src} className="w-full h-full border-0" title={path} />
    );
  }

  return null;
}

function FileTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  gitStatuses,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  gitStatuses: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDir = node.type === "directory";
  const gitStatus = gitStatuses[node.path];

  // Check if any descendant has git changes
  const hasDirtyChild = isDir && node.children?.some(function hasChanges(n: TreeNode): boolean {
    if (gitStatuses[n.path]) return true;
    return n.children?.some(hasChanges) ?? false;
  });

  return (
    <>
      <button
        onClick={() => isDir ? setExpanded(!expanded) : onSelect(node.path)}
        className={`w-full text-left flex items-center gap-1 py-0.5 text-xs hover:bg-neutral-800/50 ${
          selectedPath === node.path ? "bg-neutral-800 text-neutral-100" : "text-neutral-400"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-4 text-center text-neutral-600 shrink-0">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className={`truncate ${hasDirtyChild ? "text-amber-400" : ""}`}>{node.name}</span>
        {gitStatus && (
          <span className={`ml-auto mr-2 text-[10px] font-bold px-1 rounded ${
            gitStatus === "A" ? "bg-green-700 text-green-100"
            : gitStatus === "D" ? "bg-red-700 text-red-100"
            : "bg-amber-700 text-amber-100"
          }`}>{gitStatus}</span>
        )}
      </button>
      {isDir && expanded && node.children?.map((child) => (
        <FileTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          gitStatuses={gitStatuses}
        />
      ))}
    </>
  );
}

export default function EditorPanel() {
  const changedFilesTick = useStore((s) => s.changedFilesTick);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [gitStatuses, setGitStatuses] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const base = getApiBase();

  // Fetch file tree
  useEffect(() => {
    fetch(`${base}/api/files/tree`).then((r) => r.json()).then((d) => setTree(d.tree || [])).catch(() => {});
    fetch(`${base}/api/git/status`).then((r) => r.json()).then((d) => setGitStatuses(d.statuses || {})).catch(() => {});
  }, [changedFilesTick]);

  const previewKind = selectedPath ? getPreviewKind(selectedPath) : null;

  // Load file content (skip for preview-only files)
  useEffect(() => {
    if (!selectedPath || previewKind) return;
    // Don't overwrite unsaved edits
    if (dirty) return;
    fetch(`${base}/api/files/read?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content || "");
        setOriginalContent(d.content || "");
        setDirty(false);
      })
      .catch(() => {});
  }, [selectedPath, changedFilesTick, previewKind]);

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setDirty(value !== originalContent);
  }, [originalContent]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !dirty) return;
    setSaving(true);
    try {
      await fetch(`${base}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content }),
      });
      setOriginalContent(content);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [selectedPath, content, dirty, base]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const extensions = selectedPath ? [langForPath(selectedPath)] : [markdown()];

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-52 shrink-0 border-r border-neutral-800 flex flex-col">
        <div className="px-3 py-2 border-b border-neutral-800">
          <span className="text-xs font-medium text-neutral-400">Files</span>
        </div>
        <div className="flex-1 overflow-auto">
          {tree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              gitStatuses={gitStatuses}
            />
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedPath ? (
          previewKind ? (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 text-xs">
                <span className="text-neutral-400 truncate">{selectedPath}</span>
              </div>
              <div className="flex-1 min-h-0">
                <FilePreview path={selectedPath} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 text-xs">
                <span className="text-neutral-400 truncate">{selectedPath}</span>
                {dirty && <span className="text-amber-400">●</span>}
                <div className="ml-auto">
                  <button
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    className={`px-2 py-0.5 rounded text-xs ${
                      dirty
                        ? "bg-blue-600 text-white hover:bg-blue-500"
                        : "bg-neutral-800 text-neutral-600"
                    }`}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <CodeMirror
                  value={content}
                  onChange={handleChange}
                  extensions={extensions}
                  theme="dark"
                  basicSetup={{
                    foldGutter: true,
                    dropCursor: false,
                    allowMultipleSelections: false,
                  }}
                  className="h-full text-sm"
                  height="100%"
                />
              </div>
            </>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
