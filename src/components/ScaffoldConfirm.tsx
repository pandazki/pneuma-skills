/**
 * ScaffoldConfirm — Modal confirmation dialog for workspace scaffold operations.
 *
 * Shows what will be cleared (glob patterns) and what files will be created,
 * with a destructive-action warning. Used by all mode viewers.
 */

interface ScaffoldConfirmProps {
  clearPatterns: string[];
  files: { path: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ScaffoldConfirm({
  clearPatterns,
  files,
  onConfirm,
  onCancel,
}: ScaffoldConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-cc-card border border-cc-border rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <h3 className="text-sm font-semibold text-cc-fg">Initialize Workspace</h3>
          </div>
          <p className="text-xs text-cc-muted">
            This will clear existing files and create new ones. This action cannot be undone.
          </p>
        </div>

        {/* Content */}
        <div className="px-5 pb-4 space-y-3">
          {/* Clear patterns */}
          {clearPatterns.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-red-400 mb-1">Files to clear:</div>
              <div className="bg-cc-bg/60 rounded p-2 text-xs font-mono text-cc-muted space-y-0.5 max-h-24 overflow-y-auto">
                {clearPatterns.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            </div>
          )}

          {/* Files to create */}
          {files.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-green-400 mb-1">
                Files to create ({files.length}):
              </div>
              <div className="bg-cc-bg/60 rounded p-2 text-xs font-mono text-cc-muted space-y-0.5 max-h-32 overflow-y-auto">
                {files.map((f) => (
                  <div key={f.path}>{f.path}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-cc-border bg-cc-bg/30">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg bg-cc-bg hover:bg-cc-hover rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs text-white bg-amber-600 hover:bg-amber-500 rounded transition-colors cursor-pointer"
          >
            Initialize
          </button>
        </div>
      </div>
    </div>
  );
}
