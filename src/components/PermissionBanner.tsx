import { useStore } from "../store.js";
import { sendPermissionResponse } from "../ws.js";
import type { PermissionRequest } from "../types.js";

export default function PermissionBanner() {
  const pendingPermissions = useStore((s) => s.pendingPermissions);

  // AskUserQuestion is now rendered inline in the chat flow (MessageBubble)
  const toolPerms = Array.from(pendingPermissions.values())
    .filter((p) => p.tool_name !== "AskUserQuestion");

  if (toolPerms.length === 0) return null;

  return (
    <div className="space-y-2 p-3">
      {toolPerms.map((perm) => (
        <ToolPermissionCard key={perm.request_id} perm={perm} />
      ))}
    </div>
  );
}

function ToolPermissionCard({ perm }: { perm: PermissionRequest }) {
  const displayName = perm.display_name || perm.tool_name;
  return (
    <div className="bg-amber-900/40 border border-amber-700/50 rounded-lg p-3">
      <div className="text-sm font-medium text-amber-200 mb-1">
        Permission Request: {displayName}
      </div>
      {perm.title && (
        <div className="text-xs text-amber-300/70 mb-1">
          {perm.title}
        </div>
      )}
      {perm.description && (
        <div className="text-xs text-amber-300/80 mb-2">
          {perm.description}
        </div>
      )}
      {perm.decision_reason && (
        <div className="text-xs text-amber-300/60 italic mb-2">
          {perm.decision_reason}
        </div>
      )}
      <div className="text-xs text-cc-muted mb-2 font-mono max-h-32 overflow-y-auto bg-cc-bg/50 rounded p-2">
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
  );
}
