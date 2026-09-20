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
  cutPoints,
  frameAt,
  loadFilm,
  nextOpenStage,
  primaryAnchor,
  projectDirOf,
  selectedTake,
  shotStages,
  stageLabel,
  totalCost,
  type Project,
  type Shot,
} from "./domain.js";
import backlotManifest from "./manifest.js";
import BacklotPreview from "./viewer/BacklotPreview.js";
import { formatSeconds, probeFacts, selectProject, takeLabel } from "./viewer/player-model.js";

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
 * Two things are the point of this block. THE STAGE STATE: which of the eight
 * stages hold something, which of them the creator has approved, which have
 * MOVED since they approved them, whether the gates are open and what the
 * film has cost so far — the same derivation `backlot.mjs` refuses to spend
 * against, so the agent can never read "approved" here and be refused there.
 * THE PLAYHEAD: an address carries the stage, the shot, the lane, the take,
 * the second and the frame, so "the hand goes through the console here"
 * arrives with its moment instead of a pronoun.
 *
 * The acceptance summary is the script's own tally quoted back, never a
 * second opinion — the agent must not be able to read "accepted" here and
 * `unverified` from `previz.mjs status`.
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
  const spent = totalCost(project.cost);
  lines.push(
    `Project: "${project.title}" · ${project.shots.length} shot(s) · gates ${project.gates} · $${spent.toFixed(2)} spent`,
  );

  // One line for all eight. `changed` is shouted because it is the state the
  // creator cannot see from the files alone: they approved something else,
  // and the gate in front of the next paid command is closed again.
  lines.push(
    `Stages: ${project.stages
      .map((stage) => {
        const status = stage.status === "changed" ? "CHANGED" : stage.status;
        return `${stage.id} ${status}${stage.usd > 0 ? ` $${stage.usd.toFixed(2)}` : ""}`;
      })
      .join(" · ")}`,
  );
  const open = nextOpenStage(project);
  lines.push(
    open
      ? `Next open stage: ${open.id} (${open.status}${
          open.status === "changed" ? " — approved once, the files have moved since" : ""
        })${
          project.gates === "open"
            ? " — gates are open, so paid work may run through"
            : " — paid work in the stage after it waits for this approval"
        }`
      : "Next open stage: none — every stage is approved.",
  );
  // An address with no `stage` is a previz address — the brief's appendix.
  const stageOnScreen = addressString(address, "stage") ?? "previz";
  const stageIndex = project.stages.findIndex((s) => s.id === stageOnScreen);
  lines.push(
    `On screen: ${stageOnScreen}${stageIndex >= 0 ? ` — stage ${stageIndex + 1} of 8, ${stageLabel(project.stages[stageIndex].id)}` : ""}`,
  );
  for (const focus of describeStageFocus(project, stageOnScreen, address)) lines.push(focus);

  // The shot block belongs to the stages that are ABOUT a shot, or to an
  // address that names one. On the bible or the cut, describing a shot
  // nobody is looking at would give "this one" a second referent.
  const shotId = addressString(address, "shot");
  const shotStage = ["boards", "previz", "takes"].includes(stageOnScreen);
  if (!shotStage && !shotId) return wrap(project, lines, selection);

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

  // The hand-off, when there is one. Its ABSENCE is never reported: a shot
  // that declares no continuity is the default and the right answer for
  // every cut meant to break it, and a line saying so would read as a gap.
  if (shot.continuity?.from) {
    lines.push(
      `Hand-off: continues "${shot.continuity.from}" · entry: ${shot.continuity.entry ?? "(not written)"}${
        shot.continuity.exit ? ` · exit: ${shot.continuity.exit}` : ""
      }`,
    );
  } else if (shot.continuity?.exit) {
    lines.push(`Exit state on record (no hand-off): ${shot.continuity.exit}`);
  }

  if (shot.anchors.length > 0) {
    const primary = primaryAnchor(shot);
    lines.push(
      `Anchors: ${shot.anchors
        .map((a) => `${a.id}${a.at === null ? "" : ` @ ${a.at} s`}${a.id === primary?.id ? " (lineup)" : ""}`)
        .join(" · ")}`,
    );
  }

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
    // The design, not the handle: `label` is what fits on a beat block, and
    // judging a greybox against the handle is how a designed picture goes
    // missing between the boards and the take.
    if (beat?.detail) lines.push(`  designed as: ${beat.detail}`);
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

/**
 * What the OPEN stage has in focus, when it is not one of the shot stages.
 *
 * Each line is what that stage's body actually shows — the scene the user is
 * reading, the card they clicked, the line they highlighted, the second of
 * the cut they parked on — so a question about "this one" has a referent.
 */
function describeStageFocus(
  project: Project,
  stage: string,
  address: Record<string, unknown> | undefined,
): string[] {
  const lines: string[] = [];
  switch (stage) {
    case "idea":
      if (project.logline) lines.push(`Logline: ${project.logline}`);
      break;
    case "script": {
      lines.push(
        `Scenes: ${
          project.scenes.length === 0
            ? "none registered"
            : project.scenes
                .map((s) => `${s.number}:${s.id} (${s.shots.length} shot(s))`)
                .join(" · ")
        }`,
      );
      const scene = addressString(address, "scene");
      const focused = project.scenes.find((s) => s.id === scene);
      if (focused) {
        lines.push(`Scene in focus: ${focused.number} — ${focused.heading}. ${focused.summary}`);
      }
      break;
    }
    case "bible": {
      lines.push(
        `Bible: ${project.characters.length} character(s) — ${
          project.characters.map((c) => `${c.id}${c.sheet ? "" : " (no sheet)"}${c.voice?.sample ? "" : " (no voice)"}`).join(", ") || "none"
        }; ${project.sets.length} set(s) — ${
          project.sets.map((s) => `${s.id}${s.concept ? "" : " (no concept)"}`).join(", ") || "none"
        }`,
      );
      const character = addressString(address, "character");
      const set = addressString(address, "set");
      if (character) lines.push(`Card in focus: character "${character}"`);
      else if (set) lines.push(`Card in focus: set "${set}"`);
      break;
    }
    case "sound": {
      const { lines: spoken, music } = project.sound;
      lines.push(
        `Sound: ${spoken.length} line(s) — ${spoken.filter((l) => l.kind === "vo").length} vo, ${spoken.filter((l) => l.kind === "spoken").length} spoken; music ${music ? `${music.file}${music.seconds ? ` (${music.seconds.toFixed(1)} s)` : ""}` : "not generated"}`,
      );
      const line = addressString(address, "line");
      const focused = spoken.find((l) => l.id === line);
      if (focused) {
        lines.push(
          `Line in focus: ${focused.id} · ${focused.speaker} · ${focused.kind} · "${focused.text}" (shot ${focused.shot})`,
        );
      }
      break;
    }
    case "cut": {
      const cut = project.cut;
      if (!cut) {
        lines.push("Cut: nothing assembled yet.");
        break;
      }
      const standIns = cut.segments.filter((s) => s.source === "greybox").length;
      lines.push(
        `Cut: ${cut.kind} · ${cut.file} · ${cut.seconds.toFixed(1)} s · ${cut.segments.length} segment(s)${
          standIns > 0 ? ` · ${standIns} greybox stand-in(s)` : ""
        }`,
      );
      // The joins, in the same words the cut view badges them with. Only the
      // boundaries that DECLARE a hand-off carry a verdict; the rest are
      // cuts, which is an editing decision and not a defect.
      const points = cutPoints(project, cut);
      const declared = points.filter((p) => p.continuity);
      if (declared.length > 0) {
        lines.push(
          `Cut points claiming continuity: ${declared
            .map(
              (p) =>
                `${p.fromSegment.shot}→${p.toSegment.shot} at ${p.at.toFixed(1)} s (take-handoff ${
                  p.handoffCheck?.status ?? "unverified"
                })`,
            )
            .join(" · ")}`,
        );
      }
      if (points.length > declared.length) {
        lines.push(
          `Plain cuts (no hand-off declared, which is a choice, not a gap): ${points
            .filter((p) => !p.continuity)
            .map((p) => `${p.fromSegment.shot}→${p.toSegment.shot}`)
            .join(" · ")}`,
        );
      }
      const segment = addressString(address, "segment");
      const focused = cut.segments.find((s) => s.shot === segment);
      if (focused) {
        lines.push(
          `Segment in focus: ${focused.shot} from ${focused.source} at ${focused.offset.toFixed(1)}–${(focused.offset + focused.seconds).toFixed(1)} s`,
        );
      }
      break;
    }
    default:
      break;
  }
  return lines;
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
