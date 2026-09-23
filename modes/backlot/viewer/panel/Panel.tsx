/**
 * The panel — everything about the shot that is not a moving picture.
 *
 * Six tabs, one per artefact the workflow produces: the plan the beats came
 * from, the lineup the previz gate is decided on, the acceptance record, the
 * prompt pack, the takes and the bill.
 */

import { useState } from "react";

import type { Check, Project, Shot } from "../../domain.js";
import { CoinsIcon } from "../icons.js";
import type { Clock } from "../usePlayhead.js";
import { ChecksTab } from "./ChecksTab.js";
import { CostTab } from "./CostTab.js";
import { LineupTab } from "./LineupTab.js";
import { PlanTab } from "./PlanTab.js";
import { PromptTab } from "./PromptTab.js";
import { TakesTab } from "./TakesTab.js";

export type PanelTab = "plan" | "lineup" | "checks" | "prompt" | "takes" | "cost";

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "plan", label: "Plan" },
  { id: "lineup", label: "Lineup" },
  { id: "checks", label: "Checks" },
  { id: "prompt", label: "Prompt" },
  { id: "takes", label: "Takes" },
  { id: "cost", label: "Cost" },
];

export interface PanelProps {
  shot: Shot;
  allShots: Shot[];
  project: Project;
  planMarkdown: string | null;
  promptMarkdown: string | null;
  dark: boolean;
  selectedLaneTake: string | null;
  onFocusCheck: (check: Check) => void;
  onShowTake: (id: string) => void;
  /**
   * Which check group the Checks tab opens on. The takes stage is about the
   * take, so its checks come first there; previz opens on the greybox.
   */
  checkFocus: "greybox" | "take";
  /** Shot-relative path + cache buster → `/content/…` URL, for QA stills. */
  urlFor: (path: string, rev: number | string) => string | null;
  /** The shot's one clock — the lineup's greybox tile follows it. */
  clock: Clock;
  /** Park the playhead (a beat click in the lineup). */
  onSeek: (seconds: number) => void;
}

export function Panel(props: PanelProps) {
  const [tab, setTab] = useState<PanelTab>("plan");
  const failing = props.shot.checks.filter((c) => c.status === "fail").length;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-cc-border bg-cc-surface/30 backdrop-blur">
      {/* The tabs wrap rather than overflow. Six tabs plus a failing-check
          and a take count can be wider than the 20rem panel, and a row that
          pokes past the panel's edge pans the whole viewer sideways. */}
      <nav className="flex shrink-0 flex-wrap items-center border-b border-cc-border px-1 py-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[11px] transition-colors ${
              tab === entry.id
                ? "bg-cc-primary/15 text-cc-primary"
                : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            }`}
          >
            {entry.id === "cost" ? <CoinsIcon size={11} /> : null}
            {entry.label}
            {entry.id === "checks" && failing > 0 ? (
              <span className="rounded-full bg-cc-error/20 px-1 text-[9px] tabular-nums text-cc-error">
                {failing}
              </span>
            ) : null}
            {entry.id === "takes" && props.shot.takes.length > 0 ? (
              <span className="text-[9px] tabular-nums text-cc-muted">
                {props.shot.takes.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {tab === "plan" ? (
          <PlanTab shot={props.shot} markdown={props.planMarkdown} dark={props.dark} />
        ) : null}
        {tab === "lineup" ? (
          <LineupTab
            shot={props.shot}
            urlFor={props.urlFor}
            clock={props.clock}
            onSeek={props.onSeek}
          />
        ) : null}
        {tab === "checks" ? (
          <ChecksTab
            shot={props.shot}
            onFocusCheck={props.onFocusCheck}
            first={props.checkFocus}
            urlFor={props.urlFor}
          />
        ) : null}
        {tab === "prompt" ? (
          <PromptTab markdown={props.promptMarkdown} dark={props.dark} />
        ) : null}
        {tab === "takes" ? (
          <TakesTab
            shot={props.shot}
            selectedLaneTake={props.selectedLaneTake}
            onShowTake={props.onShowTake}
          />
        ) : null}
        {tab === "cost" ? (
          <CostTab shot={props.shot} allShots={props.allShots} project={props.project} />
        ) : null}
      </div>
    </aside>
  );
}

export default Panel;
