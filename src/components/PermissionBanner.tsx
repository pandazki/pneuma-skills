import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { sendPermissionResponse } from "../ws.js";
import { deriveSubagentLabel } from "./subagent-display.js";
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
  const { t } = useTranslation("permission");
  const { t: tAgent } = useTranslation("subagent");
  const agentId = perm.parent_tool_use_id ?? null;
  const entry = useStore((s) => (agentId ? s.subagents.get(agentId) : undefined));
  const displayName = perm.display_name || perm.tool_name;
  // A request from a subagent must name it (§2.4). The roster label is the
  // same name the card and the strip use; `agent_id` is Claude's own display
  // name for the agent and the honest fallback when no roster entry exists.
  const agentLabel = agentId
    ? deriveSubagentLabel(entry, undefined, perm.agent_id || tAgent("generic_label"))
    : null;
  return (
    <div className="bg-amber-900/40 border border-amber-700/50 rounded-lg p-3">
      {agentLabel && (
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-300/80 mb-1">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0">
            <circle cx="8" cy="5" r="3" />
            <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" strokeLinecap="round" />
          </svg>
          <span className="truncate">{tAgent("permission_prefix", { label: agentLabel })}</span>
        </div>
      )}
      <div className="text-sm font-medium text-amber-200 mb-1">
        {t("permission_request", { tool: displayName })}
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
          {t("allow")}
        </button>
        <button
          onClick={() => sendPermissionResponse(perm.request_id, "deny")}
          className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
        >
          {t("deny")}
        </button>
      </div>
    </div>
  );
}
