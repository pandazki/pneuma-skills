import { useEffect, useState } from "react";
import type { SessionInfo } from "../../core/types/session-info.js";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";

const APP_TITLE = "Pneuma Skills";
const basename = (path: string | null | undefined) => path?.split(/[\\/]/).filter(Boolean).at(-1);

/** The page title is also Electron's native window/Dock title. */
export function useWindowTitle({
  session,
  projectRoot,
  chat,
}: {
  session: boolean;
  projectRoot: string | null;
  chat: boolean;
}): void {
  const sessionId = useStore((state) => state.sessionId);
  const sessionMetaTick = useStore((state) => state.sessionMetaTick);
  const project = useStore((state) => state.projectContext);
  const workspace = useStore((state) => state.sessionWorkspace);
  const modeName = useStore((state) => state.modeDisplayName);
  const [loaded, setLoaded] = useState<{ sessionId: string | null; info: SessionInfo } | null>(null);

  useEffect(() => {
    if (!session) return;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(`${getApiBase()}/api/session`, { signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const info: SessionInfo = await response.json();
        if (!request.signal.aborted) setLoaded({ sessionId, info });
      } catch (error) {
        if (!request.signal.aborted) console.warn("[window-title] Could not refresh session title:", error);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    // Renames from the launcher and sibling refinement do not notify the
    // target session. Revalidate so background Dock entries also catch up.
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [session, sessionId, sessionMetaTick]);

  const info = session && loaded?.sessionId === sessionId ? loaded.info : null;
  const projectName = session
    ? info ? info.project?.projectName || basename(info.project?.projectRoot) : project?.projectName
    : projectRoot ? (project?.projectRoot === projectRoot ? project.projectName : null) || basename(projectRoot) : null;
  const subject = session
    ? info?.title?.trim() || basename(info?.workspace || workspace) || modeName
    : null;
  const parts = [subject, projectName, session && chat ? "Chat" : null]
    .filter((part): part is string => !!part);
  const context = [...new Set(parts)].join(" · ");
  const title = context ? `${context} — ${APP_TITLE}` : APP_TITLE;

  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => () => { document.title = APP_TITLE; }, []);
}
