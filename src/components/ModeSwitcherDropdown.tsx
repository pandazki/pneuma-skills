/**
 * ModeSwitcherDropdown — header-area mode label / switcher.
 *
 * Quick sessions (no `projectContext`): renders a static mode label, drop-in
 * replacement for the previous label.
 *
 * Project sessions: renders a dropdown that lists every other registered mode
 * plus any sibling sessions already attached to the current project. Selecting
 * a target prompts the user for an intent string, then injects a
 * `<pneuma:request-handoff ... />` message into chat. The source-side agent
 * is responsible for writing the handoff file (per the `pneuma-project`
 * skill); the rest of the handoff lifecycle is wired by Tasks 6, 10, and 11.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { sendUserMessage } from "../ws.js";

interface ModeInfo {
  name: string;
  displayName?: string;
}

interface SiblingSession {
  sessionId: string;
  mode: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function ModeSwitcherDropdown() {
  const projectContext = useStore((s) => s.projectContext);
  const sessionMode = useStore((s) => s.modeManifest?.name);
  const sessionDisplayName = useStore((s) => s.modeDisplayName);
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [siblings, setSiblings] = useState<SiblingSession[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const apiBase = getApiBase();

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Load modes + siblings when opening
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const r1 = await fetch(`${apiBase}/api/registry`);
        if (cancelled) return;
        if (r1.ok) {
          const d1 = await r1.json();
          // Dedupe by name — local copies of builtins (e.g. forked "slide")
          // share names; builtins win since they appear first.
          const seen = new Set<string>();
          const merged: ModeInfo[] = [];
          for (const m of [...(d1.builtins ?? []), ...(d1.local ?? [])] as Array<{ name: string; displayName?: string }>) {
            if (seen.has(m.name)) continue;
            seen.add(m.name);
            merged.push({ name: m.name, displayName: m.displayName });
          }
          setModes(merged);
        }
        if (projectContext?.projectRoot) {
          const r2 = await fetch(
            `${apiBase}/api/projects/${encodeURIComponent(projectContext.projectRoot)}/sessions`,
          );
          if (cancelled) return;
          if (r2.ok) {
            const d2 = await r2.json();
            setSiblings(d2.sessions ?? []);
          }
        }
      } catch {
        // tolerate transient errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectContext, apiBase]);

  // No active mode (empty shell or quick session before mode loads): suppress
  // the dropdown entirely. The Project chip (Phase 2) will be the only chip
  // in the strip when there's no session.
  if (!sessionMode) return null;

  // Quick sessions — static label, no dropdown
  if (!projectContext) {
    const label = sessionDisplayName || sessionMode || "";
    if (!label) return null;
    return (
      <span className="px-2 py-0.5 text-xs text-cc-muted">{label}</span>
    );
  }

  const switchTo = (target: string, targetSession: string | "auto" = "auto") => {
    const intent = window.prompt(
      `Switch to ${target}. What should the new session do?`,
      "",
    );
    if (intent === null) {
      setOpen(false);
      return;
    }
    const flat = intent.replace(/\s+/g, " ").trim();
    const tag = `<pneuma:request-handoff target="${escapeXml(target)}" target_session="${escapeXml(targetSession)}" intent="${escapeXml(flat)}" />`;
    void sendUserMessage(tag);
    setOpen(false);
  };

  // Group siblings by mode (excluding current session's mode)
  const otherSiblings = siblings.filter((s) => s.mode !== sessionMode);
  const siblingsByMode = new Map<string, SiblingSession[]>();
  for (const s of otherSiblings) {
    const list = siblingsByMode.get(s.mode) ?? [];
    list.push(s);
    siblingsByMode.set(s.mode, list);
  }

  const otherModes = modes.filter((m) => m.name !== sessionMode);
  const currentLabel = sessionDisplayName || sessionMode || "mode";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-cc-bg/40 border border-cc-border/60 hover:border-cc-primary/50 text-cc-fg transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
        title="Switch mode"
      >
        <span>{currentLabel}</span>
        <span className="text-cc-muted text-[10px] leading-none">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-cc-surface border border-cc-border rounded-lg shadow-2xl z-[100] max-h-96 overflow-auto">
          <div className="px-3 py-2 text-cc-muted text-[10px] uppercase tracking-wider border-b border-cc-border">
            Switch mode
          </div>
          {otherModes.length === 0 && (
            <div className="px-3 py-3 text-xs text-cc-muted">No other modes available</div>
          )}
          {otherModes.map((m) => {
            const existing = siblingsByMode.get(m.name);
            const hasMultiple = existing && existing.length > 1;
            return (
              <div key={m.name} className="border-t border-cc-border/40 first:border-t-0">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-cc-fg hover:bg-cc-hover/50 transition-colors"
                  onClick={() =>
                    switchTo(
                      m.name,
                      existing && existing.length > 0 ? existing[0].sessionId : "auto",
                    )
                  }
                >
                  {m.displayName ?? m.name}
                  {existing && existing.length > 0 && (
                    <span className="text-cc-muted text-[10px] ml-2">
                      ({existing.length} existing)
                    </span>
                  )}
                </button>
                {hasMultiple && (
                  <div className="pl-3 pb-1">
                    {existing!.map((e) => (
                      <button
                        key={e.sessionId}
                        type="button"
                        className="block w-full text-left px-3 py-1 text-cc-muted text-[11px] hover:text-cc-fg transition-colors"
                        onClick={() => switchTo(m.name, e.sessionId)}
                      >
                        Resume {e.sessionId.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                )}
                {existing && existing.length > 0 && (
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-1 pl-6 text-cc-muted text-[11px] hover:text-cc-fg transition-colors"
                    onClick={() => switchTo(m.name, "auto")}
                  >
                    + New {m.name} session
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
