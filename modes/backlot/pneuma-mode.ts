/**
 * Backlot Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded by the frontend via mode-loader's dynamic import; the Bun backend
 * reads `manifest.ts` directly, which is why React only appears here.
 *
 * One project = one content set directory = one short film. The workspace
 * items are its SHOTS, because a shot is what the user picks off the rail and
 * what an address names.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ContentSet,
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";

import {
  beatAt,
  checkTally,
  frameAt,
  loadFilm,
  projectDirOf,
  selectedTake,
  shotStages,
  type Project,
  type Shot,
} from "./domain.js";
import backlotManifest from "./manifest.js";
import BacklotPreview from "./viewer/BacklotPreview.js";
import { formatSeconds, probeFacts, selectProject, takeLabel } from "./viewer/stage-model.js";

// ── Content sets ───────────────────────────────────────────────────────────

/**
 * A project is a directory holding a `backlot.json`.
 *
 * The generic directory resolver would offer `node_modules/` and every stray
 * folder, and it hides a LONE directory on the theory that one set is not
 * switchable. Both are wrong here: the manifest is the membership test, and a
 * single project still has to be surfaced so the store activates it and every
 * `/content/<dir>/…` URL the stage builds resolves.
 */
export function resolveBacklotContentSets(files: ViewerFileContent[]): ContentSet[] {
  const sets: ContentSet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const dir = projectDirOf(file.path);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    let label = dir.charAt(0).toUpperCase() + dir.slice(1);
    try {
      const parsed = JSON.parse(file.content) as { title?: unknown };
      if (typeof parsed.title === "string" && parsed.title.trim()) label = parsed.title;
    } catch {
      /* a half-written manifest keeps the directory name */
    }
    sets.push({ prefix: dir, label, traits: {} });
  }

  // Discovery order, not alphabetical — the seed project stays first.
  return sets;
}

// ── Workspace items ────────────────────────────────────────────────────────

/** The project these files describe; they arrive content-set-filtered. */
function activeProject(files: ViewerFileContent[]): Project | null {
  return selectProject(loadFilm(files), null);
}

/** Workspace items = one per shot, in `backlot.json` order. */
export function resolveBacklotItems(files: ViewerFileContent[]): WorkspaceItem[] {
  const project = activeProject(files);
  if (!project) return [];
  return project.shots.map((shot, index) => ({
    path: `${shot.dir}/shot.json`,
    label: shot.title || shot.id,
    index,
    metadata: {
      shot: shot.id,
      seconds: shot.spec.seconds,
      stages: shotStages(shot),
    },
  }));
}

// ── Context ────────────────────────────────────────────────────────────────

function addressString(
  address: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = address?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function addressNumber(
  address: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = address?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * What the user is looking at, written for the agent.
 *
 * The playhead is the point of this block: an address carries the shot, the
 * lane, the take, the second and the frame, so "the hand goes through the
 * console here" arrives with its moment instead of a pronoun. The acceptance
 * summary is the script's own tally quoted back, never a second opinion — the
 * agent must not be able to read "accepted" here and `unverified` from
 * `previz.mjs status`.
 */
export function extractBacklotContext(
  selection: ViewerSelectionContext | null,
  files: ViewerFileContent[],
): string {
  const film = loadFilm(files);
  const address = selection?.address as Record<string, unknown> | undefined;
  const project = selectProject(film, addressString(address, "contentSet"));
  if (!project) return "";

  const lines: string[] = [];
  lines.push(`Project: "${project.title}" · ${project.shots.length} shot(s)`);

  const shotId = addressString(address, "shot");
  const shot: Shot | null =
    (shotId ? project.shots.find((s) => s.id === shotId) : null) ?? project.shots[0] ?? null;

  if (!shot) {
    lines.push("No shot has been scaffolded yet.");
    return wrap(project, lines, selection);
  }
  if (shotId && !project.shots.some((s) => s.id === shotId)) {
    lines.push(`Shot "${shotId}" is not in this project; describing "${shot.id}" instead.`);
  }

  lines.push(
    `Shot: "${shot.title}" (${shot.id}) · ${shot.entry} · ${shot.spec.seconds} s · ${shot.spec.fps} fps · ${shot.spec.width}×${shot.spec.height} · ${shot.spec.frames} frames`,
  );
  lines.push(
    `Greybox: ${
      shot.greybox.final
        ? `revision ${shot.greybox.final.revision} — ${probeFacts(shot.greybox.final.probe)}`
        : "not rendered yet"
    }`,
  );

  const greyboxChecks = shot.checks.filter((c) => c.target === "greybox");
  const tally = checkTally(greyboxChecks);
  lines.push(
    `Greybox checks: ${tally.pass} pass · ${tally.fail} fail · ${tally.unverified} unverified${
      shot.stuck.length > 0 ? ` · STUCK: ${shot.stuck.join(", ")}` : ""
    }`,
  );
  const failing = greyboxChecks.filter((c) => c.status === "fail");
  for (const check of failing.slice(0, 3)) {
    const range = check.range
      ? ` [${formatSeconds(check.range[0])}–${formatSeconds(check.range[1])} s]`
      : "";
    lines.push(`  - fail ${check.id}${range}: ${check.note || check.label}`);
  }

  const take = selectedTake(shot);
  lines.push(
    `Takes: ${shot.takes.length}${
      take ? ` · showing ${take.id} (${take.status})${take.selected ? ", delivered" : ""}` : ""
    }`,
  );

  // ── The playhead ──────────────────────────────────────────────────────────
  const time = addressNumber(address, "time");
  if (time !== undefined) {
    const lane = addressString(address, "lane") ?? "greybox";
    const addressedTake = addressString(address, "take");
    const laneName = lane === "take" && addressedTake ? takeLabel(addressedTake) : lane;
    const beat = beatAt(shot.beats, time);
    lines.push(
      `Playhead: ${formatSeconds(time)} s · frame ${frameAt(time, shot.spec)} of ${shot.spec.frames} · ${laneName} lane${
        beat ? ` · beat "${beat.id}" (${beat.label})` : " · between beats"
      }`,
    );
    if (beat?.causedBy) lines.push(`  that beat is caused by "${beat.causedBy}"`);
  }

  const range = address?.range;
  if (Array.isArray(range) && range.length >= 2 && typeof range[0] === "number" && typeof range[1] === "number") {
    lines.push(
      `Marked range: ${formatSeconds(range[0])}–${formatSeconds(range[1])} s — the user marked this span on the timeline.`,
    );
  }

  const layout = addressString(address, "layout");
  if (layout) lines.push(`Layout: ${layout}`);

  if (shot.assumptions.length > 0) {
    lines.push("Assumptions on record:");
    for (const assumption of shot.assumptions.slice(0, 3)) lines.push(`  - ${assumption}`);
  }
  if (shot.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of shot.warnings) lines.push(`  - ${warning}`);
  }

  return wrap(project, lines, selection);
}

function wrap(
  project: Project,
  lines: string[],
  selection: ViewerSelectionContext | null,
): string {
  // The Address line is the machine-routable handle: verbatim JSON the agent
  // copies straight into `navigate-to` or a <viewer-locator>.
  if (selection?.address) lines.push(`Address: ${JSON.stringify(selection.address)}`);
  const attrs = [`mode="backlot"`];
  if (project.dir) attrs.push(`content-set="${project.dir}"`);
  return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
}

// ── Mode Definition ────────────────────────────────────────────────────────

const workspace = backlotManifest.viewerApi!.workspace!;

const backlotMode: ModeDefinition = {
  manifest: backlotManifest,

  viewer: {
    PreviewComponent: BacklotPreview,

    workspace: {
      type: workspace.type,
      multiFile: workspace.multiFile,
      ordered: workspace.ordered,
      hasActiveFile: workspace.hasActiveFile,
      manifestFile: workspace.manifestFile,
      topBarNavigation: workspace.topBarNavigation,
      resolveContentSets: resolveBacklotContentSets,
      resolveItems: resolveBacklotItems,

      /**
       * No "new project" button. A film starts with `previz.mjs init`, which
       * writes `backlot.json` with the defaults the user was asked for; a shot
       * starts with `previz.mjs shot`, which scaffolds a Blender script that
       * already renders and an acceptance list. An empty skeleton written
       * from here would be a project the script did not set up.
       */
      createEmpty: () => null,
    },

    extractContext: extractBacklotContext,

    // The manifest is the single source of truth for the action space —
    // re-listing them here is how modes end up declaring two different sets.
    actions: backlotManifest.viewerApi?.actions,

    updateStrategy: "incremental",
  },
};

export default backlotMode;
