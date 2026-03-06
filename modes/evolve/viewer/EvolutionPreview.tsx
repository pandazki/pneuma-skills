/**
 * EvolutionPreview — Evolution Mode's viewer component.
 *
 * Dashboard layout:
 * - Settings: target mode, workspace, directive, data sources
 * - Proposals: auto-polling list with evidence, content preview, actions
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Evidence {
  sessionFile: string;
  quote: string;
  reasoning: string;
}

interface ProposalChange {
  file: string;
  action: "modify" | "create";
  description: string;
  evidence: Evidence[];
  content: string;
  insertAt?: string;
}

interface Proposal {
  id: string;
  createdAt: string;
  mode: string;
  workspace: string;
  status: "pending" | "applied" | "rolled_back" | "discarded" | "forked";
  summary: string;
  changes: ProposalChange[];
  forkPath?: string;
}

interface EvolutionMetadata {
  targetMode?: string;
  targetDisplayName?: string;
  directive?: string;
  workspace?: string;
  primaryHistoryDir?: string;
  primarySessionCount?: number;
  primarySizeMB?: string;
  globalProjectCount?: number;
  globalSizeMB?: string;
  skillDir?: string;
}

// ── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  applied: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  forked: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  rolled_back: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  discarded: "bg-red-500/20 text-red-400 border-red-500/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-cc-border/30 rounded-xl bg-cc-surface/30 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-cc-border/20 bg-cc-surface/20">
        <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Evidence Item ────────────────────────────────────────────────────────────

function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-cc-primary shrink-0 mt-0.5">&#x2022;</span>
      <div>
        <span className="text-cc-fg/80 italic">&ldquo;{evidence.quote}&rdquo;</span>
        <span className="text-cc-muted ml-1.5">&mdash; {evidence.reasoning}</span>
      </div>
    </div>
  );
}

// ── Content Preview ──────────────────────────────────────────────────────────

function ContentPreview({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const preview = expanded ? content : lines.slice(0, 8).join("\n") + (lines.length > 8 ? "\n..." : "");

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer flex items-center gap-1"
      >
        <span className="text-[10px]">{expanded ? "\u25BE" : "\u25B8"}</span>
        Content preview
      </button>
      {(expanded || lines.length <= 8) && (
        <pre className="mt-1.5 text-xs text-cc-fg/70 bg-cc-bg/50 rounded-lg p-3 overflow-x-auto border border-cc-border/20 whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  );
}

// ── Change Card ──────────────────────────────────────────────────────────────

function ChangeCard({ change }: { change: ProposalChange }) {
  const [showEvidence, setShowEvidence] = useState(true);

  return (
    <div className="border border-cc-border/20 rounded-lg bg-cc-bg/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${change.action === "create" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`}>
              {change.action}
            </span>
            <span className="text-xs text-cc-fg/80 font-mono truncate">{change.file}</span>
          </div>
          <p className="text-xs text-cc-muted mt-1">{change.description}</p>
        </div>
      </div>

      {change.evidence.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer flex items-center gap-1"
          >
            <span className="text-[10px]">{showEvidence ? "\u25BE" : "\u25B8"}</span>
            Evidence ({change.evidence.length})
          </button>
          {showEvidence && (
            <div className="mt-1.5 space-y-1.5 pl-2 border-l border-cc-border/20">
              {change.evidence.map((ev, i) => (
                <EvidenceItem key={i} evidence={ev} />
              ))}
            </div>
          )}
        </div>
      )}

      {change.content && <ContentPreview content={change.content} />}
    </div>
  );
}

// ── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onApply,
  onFork,
  onDiscard,
  onRollback,
}: {
  proposal: Proposal;
  onApply: (id: string) => void;
  onFork: (id: string) => void;
  onDiscard: (id: string) => void;
  onRollback: (id: string) => void;
}) {
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = useCallback(
    async (action: string, handler: (id: string) => void) => {
      if (confirmAction !== action) {
        setConfirmAction(action);
        return;
      }
      setActionLoading(true);
      handler(proposal.id);
      // Reset after a brief delay (parent will re-poll)
      setTimeout(() => {
        setConfirmAction(null);
        setActionLoading(false);
      }, 1000);
    },
    [confirmAction, proposal.id],
  );

  const createdDate = new Date(proposal.createdAt).toLocaleString();

  return (
    <div className="border border-cc-border/30 rounded-xl bg-cc-surface/20 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-cc-border/20 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-cc-muted">{proposal.id}</span>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-sm text-cc-fg/90 leading-relaxed">{proposal.summary}</p>
          <p className="text-[10px] text-cc-muted mt-1">{createdDate}</p>
        </div>
      </div>

      {/* Changes */}
      {proposal.changes.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-cc-muted font-medium">
            Changes ({proposal.changes.length})
          </p>
          {proposal.changes.map((change, i) => (
            <ChangeCard key={i} change={change} />
          ))}
        </div>
      )}

      {/* Fork path info */}
      {proposal.forkPath && (
        <div className="px-4 py-2 border-t border-cc-border/20">
          <p className="text-xs text-cyan-400">
            Forked to: <span className="font-mono text-cc-fg/70">{proposal.forkPath}</span>
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-cc-border/20 flex items-center gap-2 flex-wrap">
        {proposal.status === "pending" && (
          <>
            <button
              onClick={() => handleAction("apply", onApply)}
              disabled={actionLoading}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                confirmAction === "apply"
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30"
              }`}
            >
              {confirmAction === "apply" ? "Confirm Apply" : "\u2713 Apply to Workspace"}
            </button>
            <button
              onClick={() => handleAction("fork", onFork)}
              disabled={actionLoading}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                confirmAction === "fork"
                  ? "bg-cyan-500 text-white"
                  : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/30"
              }`}
            >
              {confirmAction === "fork" ? "Confirm Fork" : "\uD83D\uDD00 Fork as Custom Mode"}
            </button>
            <button
              onClick={() => handleAction("discard", onDiscard)}
              disabled={actionLoading}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                confirmAction === "discard"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 text-red-400/70 hover:bg-red-500/20 border border-red-500/20"
              }`}
            >
              {confirmAction === "discard" ? "Confirm Discard" : "\u2715 Discard"}
            </button>
          </>
        )}
        {proposal.status === "applied" && (
          <button
            onClick={() => handleAction("rollback", onRollback)}
            disabled={actionLoading}
            className={`text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              confirmAction === "rollback"
                ? "bg-orange-500 text-white"
                : "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 border border-orange-500/30"
            }`}
          >
            {confirmAction === "rollback" ? "Confirm Rollback" : "\u21A9 Rollback"}
          </button>
        )}
        {confirmAction && (
          <button
            onClick={() => setConfirmAction(null)}
            className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function EvolutionPreview(props: ViewerPreviewProps) {
  const meta: EvolutionMetadata = (props.initParams as EvolutionMetadata) || {};
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ──────────────────────────────────────────────────────────────

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/evolve/proposals`);
      const data = await res.json();
      if (data.proposals) {
        // Sort newest first
        const sorted = [...data.proposals].sort(
          (a: Proposal, b: Proposal) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setProposals(sorted);
      }
      setError(null);
    } catch (err) {
      setError("Failed to fetch proposals");
    }
  }, []);

  useEffect(() => {
    fetchProposals();
    pollRef.current = setInterval(fetchProposals, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchProposals]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleApply = useCallback(
    async (id: string) => {
      try {
        await fetch(`${getApiBase()}/api/evolve/apply/${id}`, { method: "POST" });
        fetchProposals();
      } catch {}
    },
    [fetchProposals],
  );

  const handleFork = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${getApiBase()}/api/evolve/fork/${id}`, { method: "POST" });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        }
        fetchProposals();
      } catch {}
    },
    [fetchProposals],
  );

  const handleDiscard = useCallback(
    async (id: string) => {
      try {
        await fetch(`${getApiBase()}/api/evolve/discard/${id}`, { method: "POST" });
        fetchProposals();
      } catch {}
    },
    [fetchProposals],
  );

  const handleRollback = useCallback(
    async (id: string) => {
      try {
        await fetch(`${getApiBase()}/api/evolve/rollback/${id}`, { method: "POST" });
        fetchProposals();
      } catch {}
    },
    [fetchProposals],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const targetLabel = meta.targetDisplayName || meta.targetMode || "Unknown";
  const workspaceShort = meta.workspace
    ? meta.workspace.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")
    : "Unknown";

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-cc-bg/20">
      {/* Header */}
      <div className="px-6 py-4 border-b border-cc-border/20 bg-cc-surface/10 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gradient-to-b from-cc-primary/20 to-cc-primary/5 border border-cc-primary/30 text-cc-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M12 3c-1.5 0-2.5 1-3 2-.5-1-1.5-2-3-2C4 3 2 5 2 7c0 3 4 6 6 8 .5-.5 1.5-1.5 2-2" />
              <path d="M12 3c1.5 0 2.5 1 3 2 .5-1 1.5-2 3-2 2 0 4 2 4 4 0 3-4 6-6 8-.5-.5-1.5-1.5-2-2" />
              <path d="M12 21v-8" />
              <path d="M9 18l3-3 3 3" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-cc-fg">Skill Evolution</h1>
            <p className="text-xs text-cc-muted">
              Mode: <span className="text-cc-fg/80">{targetLabel}</span>
              {" \u00B7 "}
              Workspace: <span className="text-cc-fg/80 font-mono">{workspaceShort}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Directive */}
        {meta.directive && (
          <SectionCard title="Directive">
            <p className="text-sm text-cc-fg/80 leading-relaxed whitespace-pre-wrap">{meta.directive}</p>
          </SectionCard>
        )}

        {/* Data Sources */}
        <SectionCard title="Data Sources">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-cc-primary">&#x1F4C2;</span>
              <span className="text-cc-fg/80">
                Primary:{" "}
                {meta.primarySessionCount !== undefined
                  ? `${meta.primarySessionCount} sessions, ~${meta.primarySizeMB} MB`
                  : "Analyzing..."}
              </span>
              <span className="text-cc-muted text-xs">(workspace)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-400">&#x1F4C2;</span>
              <span className="text-cc-fg/80">
                Global:{" "}
                {meta.globalProjectCount !== undefined
                  ? `${meta.globalProjectCount} projects, ~${meta.globalSizeMB} MB`
                  : "Scanning..."}
              </span>
              <span className="text-cc-muted text-xs">(all CC history)</span>
            </div>
            {meta.skillDir && (
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">&#x1F4C4;</span>
                <span className="text-cc-fg/80 font-mono text-xs">{meta.skillDir}</span>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Error */}
        {error && (
          <div className="px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Proposals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider">
              Proposals
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-cc-muted">auto-polling</span>
            </div>
          </div>

          {proposals.length === 0 ? (
            <div className="border border-cc-border/20 rounded-xl bg-cc-surface/10 p-8 text-center">
              <p className="text-sm text-cc-muted">No proposals yet</p>
              <p className="text-xs text-cc-muted/60 mt-1">
                The agent is analyzing conversation history...
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onApply={handleApply}
                  onFork={handleFork}
                  onDiscard={handleDiscard}
                  onRollback={handleRollback}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
