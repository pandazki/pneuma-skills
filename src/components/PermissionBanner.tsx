import { useStore } from "../store.js";
import { sendPermissionResponse } from "../ws.js";

export default function PermissionBanner() {
  const pendingPermissions = useStore((s) => s.pendingPermissions);

  if (pendingPermissions.size === 0) return null;

  return (
    <div className="space-y-2 p-3">
      {Array.from(pendingPermissions.values()).map((perm) => (
        <div
          key={perm.request_id}
          className="bg-amber-900/40 border border-amber-700/50 rounded-lg p-3"
        >
          <div className="text-sm font-medium text-amber-200 mb-1">
            Permission Request: {perm.tool_name}
          </div>
          {perm.description && (
            <div className="text-xs text-amber-300/80 mb-2">
              {perm.description}
            </div>
          )}
          <div className="text-xs text-neutral-400 mb-2 font-mono max-h-32 overflow-y-auto bg-neutral-900/50 rounded p-2">
            {JSON.stringify(perm.input, null, 2)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => sendPermissionResponse(perm.request_id, "allow")}
              className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              Allow
            </button>
            <button
              onClick={() => sendPermissionResponse(perm.request_id, "deny")}
              className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
