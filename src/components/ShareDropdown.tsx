import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../utils/api.js";

export default function ShareDropdown() {
  const [open, setOpen] = useState(false);
  const [r2Status, setR2Status] = useState<{ configured: boolean; publicUrl: string | null } | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "sharing" | "done" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check R2 status when dropdown opens
  useEffect(() => {
    if (open && !r2Status) {
      fetch(`${getApiBase()}/api/r2/status`)
        .then((r) => r.json())
        .then(setR2Status)
        .catch(() => setR2Status({ configured: false, publicUrl: null }));
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleShare = async (type: "result" | "process") => {
    setShareStatus("sharing");
    setShareError(null);
    try {
      const resp = await fetch(`${getApiBase()}/api/share/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Shared ${type}` }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setShareUrl(data.url);
      setShareStatus("done");
    } catch (err: any) {
      setShareError(err.message || "Share failed");
      setShareStatus("error");
    }
  };

  const handleExportLocal = async () => {
    setShareStatus("sharing");
    try {
      const resp = await fetch(`${getApiBase()}/api/history/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setShareUrl(data.outputPath);
      setShareStatus("done");
    } catch (err: any) {
      setShareError(err.message || "Export failed");
      setShareStatus("error");
    }
  };

  const copyUrl = () => {
    if (shareUrl) navigator.clipboard.writeText(shareUrl);
  };

  const reset = () => {
    setShareStatus("idle");
    setShareUrl(null);
    setShareError(null);
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) reset(); }}
        title="Share"
        className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-primary hover:bg-cc-hover transition-colors cursor-pointer"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <circle cx="4" cy="8" r="2" />
          <circle cx="12" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M6 7l4-2M6 9l4 2" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-cc-border bg-cc-surface shadow-xl z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-cc-border">
            <div className="text-xs font-semibold text-cc-fg">Share</div>
          </div>

          {shareStatus === "idle" && (
            <div className="p-2 space-y-1">
              {r2Status?.configured ? (
                <>
                  <button
                    onClick={() => handleShare("result")}
                    className="w-full px-3 py-2.5 text-left rounded hover:bg-cc-hover transition-colors group"
                  >
                    <div className="text-xs font-medium text-cc-fg group-hover:text-cc-primary">Share Result</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Upload current files (no history)</div>
                  </button>
                  <button
                    onClick={() => handleShare("process")}
                    className="w-full px-3 py-2.5 text-left rounded hover:bg-cc-hover transition-colors group"
                  >
                    <div className="text-xs font-medium text-cc-fg group-hover:text-cc-primary">Share Process</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Upload with chat history & checkpoints</div>
                  </button>
                  <div className="border-t border-cc-border my-1" />
                  <button
                    onClick={handleExportLocal}
                    className="w-full px-3 py-2 text-left rounded hover:bg-cc-hover transition-colors"
                  >
                    <div className="text-xs text-cc-muted">Export to local file</div>
                  </button>
                </>
              ) : (
                <div className="px-3 py-3 space-y-2">
                  <div className="text-xs text-cc-muted">Cloud sharing requires R2 storage configuration.</div>
                  <div className="text-[10px] text-cc-muted/60">Configure R2 credentials in the Launcher settings to enable cloud sharing.</div>
                  <div className="border-t border-cc-border my-2" />
                  <button
                    onClick={handleExportLocal}
                    className="w-full px-3 py-2 text-left rounded hover:bg-cc-hover transition-colors"
                  >
                    <div className="text-xs text-cc-fg">Export to local file</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Save as .tar.gz without cloud upload</div>
                  </button>
                </div>
              )}
            </div>
          )}

          {shareStatus === "sharing" && (
            <div className="px-3 py-4 text-center">
              <div className="text-xs text-cc-muted animate-pulse">Sharing...</div>
            </div>
          )}

          {shareStatus === "done" && shareUrl && (
            <div className="p-3 space-y-2">
              <div className="text-xs text-cc-primary font-medium">Shared successfully!</div>
              <div className="flex items-center gap-1">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 text-[10px] bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-muted truncate"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={copyUrl}
                  className="px-2 py-1 text-[10px] rounded border border-cc-border hover:border-cc-primary hover:text-cc-primary text-cc-muted transition-colors"
                >
                  Copy
                </button>
              </div>
              <button onClick={reset} className="text-[10px] text-cc-muted/50 hover:text-cc-fg">
                Share again
              </button>
            </div>
          )}

          {shareStatus === "error" && (
            <div className="p-3 space-y-2">
              <div className="text-xs text-red-400">{shareError || "Share failed"}</div>
              <button onClick={reset} className="text-[10px] text-cc-muted/50 hover:text-cc-fg">
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
