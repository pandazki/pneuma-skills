/**
 * ProjectCover — shared visual primitives for rendering a Pneuma project's
 * identity. Lifted out of `ProjectCard.tsx` so the launcher card and the
 * Project Panel (3.0 pivot) can use the same cover + meta line without
 * duplicating fetch / fallback logic.
 *
 * - `<CoverImage>` renders `<root>/.pneuma/cover.png` if the server reports
 *   it via `coverImageUrl`; otherwise falls back to `<DefaultProjectCover>`.
 * - `<SessionMeta>` renders the "N sessions · mode1, mode2" line.
 *
 * `DefaultProjectCover` is re-exported here so callers only need a single
 * import path for project identity visuals.
 */

import React from "react";
import { getApiBase } from "../utils/api.js";
import { DefaultProjectCover } from "./DefaultProjectCover.js";

export { DefaultProjectCover };

export interface ProjectCoverEntry {
  id: string;
  displayName: string;
  sessionCount: number;
  modeBreakdown: string[];
  coverImageUrl?: string;
}

export function CoverImage({ project }: { project: ProjectCoverEntry }) {
  const [errored, setErrored] = React.useState(false);
  if (project.coverImageUrl && !errored) {
    return (
      <img
        src={`${getApiBase()}${project.coverImageUrl}`}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setErrored(true)}
      />
    );
  }
  return <DefaultProjectCover seed={project.id} displayName={project.displayName} />;
}

export function SessionMeta({ project }: { project: ProjectCoverEntry }) {
  const count = project.sessionCount;
  if (count === 0) {
    return <span className="text-cc-muted/50">No sessions yet</span>;
  }
  const noun = count === 1 ? "session" : "sessions";
  const modeText = project.modeBreakdown.length
    ? ` · ${project.modeBreakdown.slice(0, 3).join(", ")}${
        project.modeBreakdown.length > 3 ? "…" : ""
      }`
    : "";
  return (
    <span>
      <span className="text-cc-fg/80">{count}</span>
      <span className="text-cc-muted/70"> {noun}{modeText}</span>
    </span>
  );
}
