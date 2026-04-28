/**
 * EmptyShell — renders the editor chrome (mesh gradient, glassmorphism
 * border, TopBar) without any active session, mode viewer, or WebSocket
 * connection. Activated when the URL carries `?project=<root>` but no
 * `session` or `mode` params.
 *
 * Phase 2 of the 3.0 project pivot will mount the ProjectChip + dropdown
 * panel inside the surviving TopBar; for now the panel area shows a single
 * sentence of guidance (no card, no decoration).
 *
 * This path intentionally short-circuits the main `App` useEffect chain
 * (mode loading, file fetch, WS connect) — there's no agent here.
 */
import { useEffect } from "react";
import TopBar from "./TopBar.js";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";

export function EmptyShell({ projectRoot }: { projectRoot: string }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/api/projects/${encodeURIComponent(projectRoot)}/sessions`,
        );
        if (cancelled || !res.ok) return;
        const data = await res.json();
        const project = data?.project;
        if (!project) return;
        useStore.getState().setProjectContext({
          projectRoot,
          projectName: project.displayName,
          projectDescription: project.description,
        });
      } catch {
        // tolerate transient errors; the chip will fall back to projectRoot
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  return (
    <div className="flex flex-col h-screen bg-cc-bg text-cc-fg relative overflow-hidden p-4 sm:p-6 md:p-8">
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[50%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] right-[-10%] w-[50%] h-[60%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />

      <div className="relative z-10 flex flex-col flex-1 border border-cc-primary/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5 before:absolute before:inset-0 before:bg-cc-surface/40 before:backdrop-blur-3xl before:-z-10">
        <TopBar />
        {/* Empty body — the Project Panel auto-opens from the chip and is
            the active call-to-action. A static hint here would be redundant
            and would peek from behind the panel anyway. */}
        <div className="flex-1" />
      </div>
    </div>
  );
}
