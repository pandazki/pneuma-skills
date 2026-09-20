/**
 * Plan — the shot plan as the agent wrote it, with the assumptions pulled to
 * the top.
 *
 * `assumptions` is a first-class field in `shot.json` because most shots are
 * specified by nobody: "8 s / 24 fps / 1280×720" is what the mode chose when
 * the user gave no numbers, and it is far cheaper to correct here than after
 * a paid take.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Shot } from "../../domain.js";
import { AlertIcon } from "../icons.js";

export interface PlanTabProps {
  shot: Shot;
  markdown: string | null;
  dark: boolean;
}

export function PlanTab({ shot, markdown, dark }: PlanTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-cc-muted">Spec</dt>
        <dd className="tabular-nums text-cc-fg">
          {shot.spec.seconds} s · {shot.spec.fps} fps · {shot.spec.width}×{shot.spec.height} ·{" "}
          {shot.spec.frames} frames
        </dd>
        <dt className="text-cc-muted">Entry</dt>
        <dd className="text-cc-fg">
          {shot.entry === "recreate" ? "recreate from a reference video" : "original, from an idea"}
        </dd>
        <dt className="text-cc-muted">Greybox</dt>
        <dd className="text-cc-fg">
          {shot.greybox.final
            ? `revision ${shot.greybox.final.revision}`
            : "not rendered yet"}
        </dd>
      </dl>

      {shot.assumptions.length > 0 ? (
        <section className="rounded-md border border-cc-warning/40 bg-cc-warning/10 px-2.5 py-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-cc-warning">
            <AlertIcon size={11} />
            Assumptions
          </h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {shot.assumptions.map((assumption) => (
              <li key={assumption} className="text-[11px] leading-relaxed text-cc-fg">
                {assumption}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shot.warnings.length > 0 ? (
        <section className="rounded-md border border-cc-error/40 bg-cc-error/10 px-2.5 py-2">
          <h3 className="text-[11px] font-medium text-cc-error">shot.json could not be trusted</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {shot.warnings.map((warning) => (
              <li key={warning} className="text-[11px] leading-relaxed text-cc-fg">
                {warning}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {markdown ? (
        <div
          className={`prose prose-sm max-w-none text-[12px] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:block [&_table]:overflow-x-auto ${
            dark ? "prose-invert prose-neutral" : "prose-neutral"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-cc-muted">
          No <code>shot-plan.md</code> yet. The plan is where the beats come from — ask the agent
          to write it before the blocking.
        </p>
      )}
    </div>
  );
}

export default PlanTab;
