import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import DiffViewer from "./DiffViewer.js";

interface ChangedFile {
  path: string;
  status: string; // A, M, D
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    A: "bg-green-700 text-green-100",
    M: "bg-amber-700 text-amber-100",
    D: "bg-red-700 text-red-100",
  };
  return (
    <span className={`text-[10px] font-bold px-1 rounded ${colors[status] || "bg-neutral-700 text-neutral-300"}`}>
      {status}
    </span>
  );
}

export default function DiffPanel() {
  const changedFilesTick = useStore((s) => s.changedFilesTick);
  const diffBase = useStore((s) => s.diffBase);
  const setDiffBase = useStore((s) => s.setDiffBase);

  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Fetch changed files
  useEffect(() => {
    const base = getApiBase();
    fetch(`${base}/api/git/changed-files?base=${diffBase}`)
      .then((r) => r.json())
      .then((data) => {
        const newFiles: ChangedFile[] = data.files || [];
        setFiles(newFiles);
        // Auto-select first file if current selection is gone
        if (newFiles.length > 0 && (!selectedFile || !newFiles.some((f) => f.path === selectedFile))) {
          setSelectedFile(newFiles[0].path);
        } else if (newFiles.length === 0) {
          setSelectedFile(null);
        }
      })
      .catch(() => setFiles([]));
  }, [changedFilesTick, diffBase]);

  // Fetch diff for selected file
  useEffect(() => {
    if (!selectedFile) {
      setDiff("");
      return;
    }
    setLoading(true);
    const base = getApiBase();
    fetch(`${base}/api/git/diff?path=${encodeURIComponent(selectedFile)}&base=${diffBase}`)
      .then((r) => r.json())
      .then((data) => setDiff(data.diff || ""))
      .catch(() => setDiff(""))
      .finally(() => setLoading(false));
  }, [selectedFile, diffBase, changedFilesTick]);

  return (
    <div className="flex h-full">
      {/* File list sidebar */}
      <div className="w-56 shrink-0 border-r border-neutral-800 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
          <span className="text-xs font-medium text-neutral-400">
            Changed Files ({files.length})
          </span>
          <button
            onClick={() => setDiffBase(diffBase === "last-commit" ? "default-branch" : "last-commit")}
            className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200"
            title={`Diff base: ${diffBase}`}
          >
            {diffBase === "last-commit" ? "HEAD" : "branch"}
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {files.length === 0 ? (
            <div className="px-3 py-8 text-center text-neutral-600 text-xs">No changes</div>
          ) : (
            files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelectedFile(f.path)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-neutral-800/50 ${
                  selectedFile === f.path ? "bg-neutral-800 text-neutral-100" : "text-neutral-400"
                }`}
              >
                {statusBadge(f.status)}
                <span className="truncate">{f.path}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 min-w-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">Loading...</div>
        ) : selectedFile ? (
          <DiffViewer diff={diff} />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            Select a file to view diff
          </div>
        )}
      </div>
    </div>
  );
}
