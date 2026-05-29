import { useState, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import DiffPanel from "./DiffPanel.js";
import ProcessPanel from "./ProcessPanel.js";
import ContextPanel from "./ContextPanel.js";
import SchedulePanel from "./SchedulePanel.js";

const EditorPanel = lazy(() => import("./EditorPanel.js"));
const TerminalPanel = lazy(() => import("./TerminalPanel.js"));

function ToolFallback() {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-center justify-center h-full text-cc-muted text-sm">
      {t("loading")}
    </div>
  );
}

/**
 * ToolDock — the inspection / dev surfaces (editor, diff, terminal, processes,
 * context, schedules), keyed off `activeTab`. Chat used to live here as one
 * tab; it has moved to the relocatable Agent Surface. The dock is only
 * mounted when a tool is active (App gates it), so when `activeTab` is null
 * the viewer reclaims the space.
 *
 * The terminal stays mounted once first visited to preserve its PTY
 * connection — it is hidden, not unmounted, when another tool is active.
 */
export default function ToolDock() {
  const activeTab = useStore((s) => s.activeTab);
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (activeTab === "terminal") setTerminalMounted(true);
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      {activeTab === "editor" && (
        <Suspense fallback={<ToolFallback />}>
          <EditorPanel />
        </Suspense>
      )}
      {activeTab === "diff" && <DiffPanel />}
      {/* Terminal stays mounted once visited to preserve PTY connection */}
      {terminalMounted && (
        <Suspense fallback={activeTab === "terminal" ? <ToolFallback /> : null}>
          <div className={activeTab === "terminal" ? "flex flex-col h-full" : "hidden"}>
            <TerminalPanel />
          </div>
        </Suspense>
      )}
      {activeTab === "processes" && <ProcessPanel />}
      {activeTab === "context" && <ContextPanel />}
      {activeTab === "schedules" && <SchedulePanel />}
    </div>
  );
}
