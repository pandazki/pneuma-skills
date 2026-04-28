/**
 * HandoffCard — fixed overlay surfacing pending handoff files for the active
 * project. Renders one card per pending handoff whose target_mode does NOT
 * match the current session's mode (the current session's own pending ones
 * are surfaced inline via the CLAUDE.md `pneuma:handoff` block).
 *
 * Lifecycle: handoff files appear in `<projectRoot>/.pneuma/handoffs/*.md`,
 * the server's chokidar watcher (Task 10) emits `handoff_event` over WS, and
 * `project-slice` keeps the inbox in sync. Confirm/Cancel POST to handlers
 * that will be implemented in Task 16.
 */

import { useStore } from "../store/index.js";
import { getApiBase } from "../utils/api.js";

export default function HandoffCard() {
  const inbox = useStore((s) => s.handoffInbox);
  const projectContext = useStore((s) => s.projectContext);
  const sessionMode = useStore((s) => s.modeManifest?.name);

  if (!projectContext) return null;

  // Show handoffs targeted at OTHER modes (the current session's inbound
  // handoffs are presented to the agent via the pneuma:handoff CLAUDE.md
  // block — we don't want to double-surface them in the UI).
  const items = Array.from(inbox.values()).filter(
    (h) => h.frontmatter.target_mode !== sessionMode,
  );

  if (items.length === 0) return null;

  const handleConfirm = async (handoffId: string) => {
    if (!projectContext.projectRoot) return;
    try {
      const res = await fetch(
        `${getApiBase()}/api/handoffs/${encodeURIComponent(handoffId)}/confirm?project=${encodeURIComponent(projectContext.projectRoot)}`,
        { method: "POST" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { launchUrl?: string };
      // Navigate the browser to the spawned target session so the user
      // lands in the new mode without an extra click.
      if (data.launchUrl) window.location.href = data.launchUrl;
    } catch {
      /* tolerate transient errors */
    }
  };
  const handleCancel = async (handoffId: string) => {
    if (!projectContext.projectRoot) return;
    await fetch(
      `${getApiBase()}/api/handoffs/${encodeURIComponent(handoffId)}/cancel?project=${encodeURIComponent(projectContext.projectRoot)}`,
      { method: "POST" },
    ).catch(() => { /* see above */ });
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] flex flex-col gap-3 pointer-events-none">
      {items.map((h) => (
        <div
          key={h.frontmatter.handoff_id}
          className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl p-4 pointer-events-auto backdrop-blur-xl"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-cc-muted text-sm">Handoff Ready</span>
            <span className="text-cc-primary text-sm">
              {(h.frontmatter.source_mode || "?")} → {h.frontmatter.target_mode}
            </span>
          </div>
          {h.frontmatter.intent && (
            <div className="text-cc-fg text-sm mb-3">{h.frontmatter.intent}</div>
          )}
          <details className="mb-3">
            <summary className="cursor-pointer text-cc-muted text-xs">
              Show full handoff
            </summary>
            <pre className="text-xs text-cc-muted whitespace-pre-wrap mt-2 max-h-64 overflow-auto">
              {h.body}
            </pre>
          </details>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="px-3 py-1 text-sm border border-cc-border rounded hover:border-cc-muted"
              onClick={() => handleCancel(h.frontmatter.handoff_id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1 text-sm bg-cc-primary text-white rounded hover:opacity-90"
              onClick={() => handleConfirm(h.frontmatter.handoff_id)}
            >
              Confirm Switch
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
