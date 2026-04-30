/**
 * EmptyShell — renders the editor chrome (mesh gradient, glassmorphism
 * border, TopBar) without any active session, mode viewer, or WebSocket
 * connection. Activated when the URL carries `?project=<root>` but no
 * `session` or `mode` params.
 *
 * On mount we hydrate `projectContext` from `/api/projects/:id/sessions`,
 * then check whether this is a *fresh* project — `manifest.onboardedAt`
 * is undefined AND there are no existing sessions. If so, we
 * auto-launch the hidden `project-onboard` mode. The user lands directly
 * in the Discovery Report instead of staring at an empty panel and
 * having to find the right starting move themselves.
 *
 * For returning projects (any session exists, or `onboardedAt` is set),
 * we just render the panel and let the user pick their next move.
 *
 * This path intentionally short-circuits the main `App` useEffect chain
 * (mode loading, file fetch, WS connect) — there's no agent here.
 */
import { useEffect, useState } from "react";
import TopBar from "./TopBar.js";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";

interface FetchedProject {
  displayName: string;
  description?: string;
  onboardedAt?: number;
}

export function EmptyShell({ projectRoot }: { projectRoot: string }) {
  // `triggering` covers the brief window between deciding to auto-launch
  // and the navigation actually firing. Showing it as a soft inline hint
  // (rather than a full-screen takeover) keeps the editor chrome stable
  // and signals "we're working on it" without obstructing the panel.
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const apiBase = getApiBase();
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/sessions`,
        );
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          project?: FetchedProject;
          sessions?: Array<unknown>;
        };
        const project = data?.project;
        if (!project) return;
        useStore.getState().setProjectContext({
          projectRoot,
          projectName: project.displayName,
          projectDescription: project.description,
        });

        // Auto-trigger project-onboard on a truly fresh project. Both
        // gates must be empty: never-onboarded AND no sessions yet.
        // A returning user with existing sessions but no onboardedAt
        // (e.g. they migrated from 2.x) shouldn't get auto-redirected
        // — only the panel's manual "Re-discover" affordance fires it.
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const isFresh = !project.onboardedAt && sessions.length === 0;
        if (!isFresh) return;

        setTriggering(true);
        try {
          const launchRes = await fetch(`${apiBase}/api/launch`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              specifier: "project-onboard",
              workspace: projectRoot,
              project: projectRoot,
            }),
          });
          const launchData = (await launchRes.json()) as { url?: string; error?: string };
          if (launchData.url) {
            window.location.href = launchData.url;
            return;
          }
          // Surface the failure but keep the panel usable — the user
          // can still launch any other mode manually.
          console.warn(`[EmptyShell] auto-onboard failed: ${launchData.error ?? launchRes.status}`);
        } catch (err) {
          console.warn("[EmptyShell] auto-onboard error:", err);
        } finally {
          if (!cancelled) setTriggering(false);
        }
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
        <div className="flex-1 flex items-center justify-center">
          {triggering ? (
            <div className="flex flex-col items-center gap-3 text-cc-muted/80">
              <div className="w-8 h-8 rounded-full border-2 border-cc-border border-t-cc-primary animate-spin" />
              <div className="text-sm">Reading your project — a discovery report will open in a moment.</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
