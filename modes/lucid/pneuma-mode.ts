/**
 * Lucid Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded by the frontend via mode-loader's dynamic import; the Bun backend
 * reads `manifest.ts` directly, which is why React only appears here.
 *
 * One project = one content set directory = one dream, one scene, one score
 * trajectory. The workspace items are the project's ROUNDS, because a round
 * is what the user picks off the rail and what an address names.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ContentSet,
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";

import {
  budgetRemainingMinutes,
  loadLoops,
  projectDirOf,
  type Loop,
  type Loops,
} from "./domain.js";
import lucidManifest from "./manifest.js";
import { bestPoint, formatScore } from "./viewer/stage.js";
import LucidPreview from "./viewer/LucidPreview.js";

// ── Content sets ───────────────────────────────────────────────────────────

/**
 * A project is a directory holding a `lucid.json`.
 *
 * The generic directory resolver would offer `node_modules/` and every stray
 * folder, and it hides a LONE directory on the theory that one set is not
 * switchable. Both are wrong here: the manifest is the membership test, and a
 * single project still has to be surfaced so the store activates it and every
 * `/content/<dir>/…` URL the stage builds resolves. Same shape as webcraft's.
 */
export function resolveLucidContentSets(files: ViewerFileContent[]): ContentSet[] {
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
function activeLoop(loops: Loops | null): Loop | null {
  if (!loops) return null;
  const first = Object.keys(loops.projects).sort()[0];
  return first === undefined ? null : loops.projects[first];
}

const padIndex = (index: number): string => String(index).padStart(2, "0");

/** Workspace items = one per recorded round, in order. */
export function resolveLucidItems(files: ViewerFileContent[]): WorkspaceItem[] {
  const loop = activeLoop(loadLoops(files));
  if (!loop) return [];
  const prefix = loop.dir ? `${loop.dir}/` : "";
  return loop.rounds.map((round, index) => ({
    path: `${prefix}${round.capture ?? `rounds/${padIndex(round.index)}/capture.png`}`,
    label: round.verdict
      ? `Round ${round.index} · ${formatScore(round.verdict.total)}`
      : `Round ${round.index}`,
    index,
    metadata: {
      round: round.index,
      kind: round.kind,
      total: round.verdict ? round.verdict.total : null,
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

function selectLoop(loops: Loops | null, contentSet: string | undefined): Loop | null {
  if (!loops) return null;
  if (contentSet != null && loops.projects[contentSet]) return loops.projects[contentSet];
  return activeLoop(loops);
}

/**
 * What the user is looking at, written for the agent.
 *
 * The exit line is the script's verdict quoted back, not a second opinion —
 * the agent must not be able to read a different answer here from the one
 * `lucid.mjs status` gives it. The gaps are trimmed to the first two because
 * this block rides in front of EVERY message; the rest are one script call
 * away, and a wall of text in front of every turn is how a context block
 * stops being read.
 */
export function extractLucidContext(
  selection: ViewerSelectionContext | null,
  files: ViewerFileContent[],
): string {
  const loops = loadLoops(files);
  const address = selection?.address as Record<string, unknown> | undefined;
  const loop = selectLoop(loops, addressString(address, "contentSet"));
  if (!loop) return "";

  const lines: string[] = [];
  lines.push(`Project: "${loop.title}" (${loop.status})`);
  if (loop.brief) lines.push(`Direction: "${loop.brief}"`);
  lines.push(
    `Target: ${loop.target.path ? `${loop.target.path} (v${loop.target.version})` : "not locked yet"}`,
  );

  const evaluation = loop.evaluation;
  if (evaluation) {
    const best = evaluation.best ? `round ${evaluation.best.index} at ${formatScore(evaluation.best.total)}` : "none";
    const last = evaluation.last ? `round ${evaluation.last.index} at ${formatScore(evaluation.last.total)}` : "none";
    lines.push(`Exit: ${evaluation.exit} — best ${best}, last ${last}`);
    if (evaluation.reasons.length > 0) lines.push(`Because: ${evaluation.reasons.join("; ")}`);
    if (evaluation.repeatedGaps.length > 0) {
      lines.push(`Gaps repeated across the last two verdicts: ${evaluation.repeatedGaps.join(", ")}`);
    }
  } else {
    lines.push(`Exit: not evaluated yet (${loop.rounds.length} round${loop.rounds.length === 1 ? "" : "s"} recorded)`);
  }

  const remaining = budgetRemainingMinutes(loop);
  if (remaining !== null) lines.push(`Budget: ${Math.round(remaining)} min left of ${loop.budget!.minutes}`);
  lines.push(`fps target: ${loop.fpsTarget}`);

  const roundIndex = addressNumber(address, "round");
  if (roundIndex !== undefined) {
    const round = loop.rounds.find((r) => r.index === roundIndex);
    if (!round) {
      lines.push(`Round ${roundIndex} is not recorded in this project.`);
    } else {
      const total = round.verdict ? formatScore(round.verdict.total) : "not judged";
      // A round judged against a replaced target keeps its score on file, but
      // that score measured a different dream — it is not comparable with the
      // current trajectory, and `lucid.mjs` leaves it out of the exit rules.
      const superseded =
        loop.target.version > 0 && round.targetVersion !== loop.target.version
          ? ` · judged against target v${round.targetVersion}, now v${loop.target.version}`
          : "";
      lines.push(
        `Selected: round ${round.index} of ${loop.rounds.length} · ${total}${
          round.kind === "rethink" ? " · rethink" : ""
        }${superseded}`,
      );
      if (round.capture) lines.push(`Capture: ${round.capture}`);
      if (round.fps !== null) lines.push(`Measured fps at capture: ${round.fps}`);
      if (round.verdict) {
        lines.push(
          `Scores: composition ${round.verdict.composition} · lighting ${round.verdict.lighting} · materials ${round.verdict.materials} · details ${round.verdict.details}`,
        );
        if (round.verdict.summary) lines.push(`Judge: ${round.verdict.summary}`);
        lines.push(`Gaps: ${round.verdict.gaps.length}`);
        for (const gap of round.verdict.gaps.slice(0, 2)) {
          lines.push(`  - [${gap.area}] ${gap.issue}`);
        }
      }
    }
  } else {
    // `bestPoint` quotes the script's `evaluation.best`, which counts only
    // the rounds judged against the LOCKED target. Scanning every round here
    // would name a round scored against a dream this loop has replaced —
    // and the Exit line two lines up would name a different one.
    const best = bestPoint(loop);
    lines.push(
      best
        ? `Rounds: ${loop.rounds.length} recorded, best is round ${best.index} at ${formatScore(best.total)}`
        : `Rounds: ${loop.rounds.length} recorded, none judged yet`,
    );
  }

  const view = addressString(address, "view");
  if (view) lines.push(`Stage view: ${view}`);

  if (loop.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of loop.warnings) lines.push(`  - ${warning}`);
  }

  // The Address line is the machine-routable handle: verbatim JSON the agent
  // copies straight into `capture`, `navigate-to`, or a <viewer-locator>.
  if (selection?.address) lines.push(`Address: ${JSON.stringify(selection.address)}`);

  const attrs = [`mode="lucid"`];
  if (loop.dir) attrs.push(`content-set="${loop.dir}"`);
  return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
}

// ── Capture seam ───────────────────────────────────────────────────────────

/**
 * The mounted stage's frame renderer, registered by `LucidPreview`.
 *
 * `capture` screenshots whatever the framework hands it, and for this mode
 * the generic answer is wrong twice over: the whole viewer pane includes the
 * rail and the strip, and the WebGL canvas inside the scene iframe rasterizes
 * BLACK under snapdom (no `preserveDrawingBuffer`). The scene's own bridge is
 * the only thing that can draw a real frame, so it is registered here and
 * `captureViewer` asks it before anything else
 * (`src/utils/viewer-capture.ts`).
 *
 * Returning `null` is not a failure — a recorded round or the target on the
 * stage is an ordinary PNG the framework can rasterize itself, and a scene
 * with no bridge falls through to the same strategies as every other mode.
 */
type StageCapture = () => Promise<{ data: string; media_type: string } | null>;

const stageCapture: { current: StageCapture | null } = { current: null };

export function setLucidStageCapture(capture: StageCapture | null): void {
  stageCapture.current = capture;
}

// ── Mode Definition ────────────────────────────────────────────────────────

const workspace = lucidManifest.viewerApi!.workspace!;

const lucidMode: ModeDefinition = {
  manifest: lucidManifest,

  viewer: {
    PreviewComponent: LucidPreview,

    workspace: {
      type: workspace.type,
      multiFile: workspace.multiFile,
      ordered: workspace.ordered,
      hasActiveFile: workspace.hasActiveFile,
      manifestFile: workspace.manifestFile,
      topBarNavigation: workspace.topBarNavigation,
      resolveContentSets: resolveLucidContentSets,
      resolveItems: resolveLucidItems,

      /**
       * No "new project" button. A loop starts by describing what you want
       * to see; `lucid.mjs init` then writes `lucid.json`, copies the
       * bridge into `scene/`; `--budget-minutes` starts the clock there. An empty skeleton
       * written from here would be a project the script did not set up —
       * no bridge, no clock, and an exit evaluation that never runs.
       */
      createEmpty: () => null,
    },

    extractContext: extractLucidContext,

    // The manifest is the single source of truth for the action space —
    // re-listing them here is how modes end up declaring two different sets.
    actions: lucidManifest.viewerApi?.actions,

    async captureViewport() {
      return stageCapture.current ? stageCapture.current() : null;
    },

    updateStrategy: "incremental",
  },
};

export default lucidMode;
