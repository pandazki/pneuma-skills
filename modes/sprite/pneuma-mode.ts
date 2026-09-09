/**
 * Sprite Mode — ModeDefinition binding manifest + viewer.
 * Loaded by the frontend via mode-loader's dynamic import; the Bun backend
 * reads `manifest.ts` directly, which is why React only appears here.
 *
 * One character = one content set directory. The workspace items are the
 * character's MOTIONS (not its files) because a motion is what the user picks
 * and what an address names; each item's path is the motion's atlas so the
 * framework has a real file to key on.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";

import {
  createCharacterProjectFile,
  findMotion,
  findRef,
  loadRoster,
  type CharacterProject,
  type Motion,
  type Roster,
} from "./domain.js";
import spriteManifest from "./manifest.js";
import SpritePreview from "./viewer/SpritePreview.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * The character the context/items should describe.
 *
 * `extractContext` and `resolveItems` are handed the file snapshot for the
 * ACTIVE content set only in the common case, but a selection address can
 * still name its `contentSet` explicitly — prefer that when present, so a
 * locator card built against another character keeps meaning what it said.
 */
export function selectCharacter(
  roster: Roster | null,
  contentSet: string | undefined,
): CharacterProject | null {
  if (!roster) return null;
  if (contentSet != null && roster.byContentSet[contentSet]) {
    return roster.byContentSet[contentSet];
  }
  const first = Object.keys(roster.byContentSet).sort()[0];
  return first === undefined ? null : roster.byContentSet[first];
}

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

/** One motion, described the way the agent needs to decide what to do next. */
function describeMotion(motion: Motion, lines: string[]): void {
  lines.push(`Motion: "${motion.label}" (${motion.id})`);
  lines.push(
    `Grid: ${motion.grid.cols}×${motion.grid.rows} · ${motion.fps} fps · ${
      motion.loop ? "loop" : "play once"
    } · anchor ${motion.anchor}`,
  );
  lines.push(`Status: ${motion.status}`);
  lines.push(`Frames: ${motion.frames.length}`);
  if (motion.prompt) lines.push(`Prompt: "${motion.prompt}"`);
  if (motion.notes) lines.push(`Notes: ${motion.notes}`);
  if (motion.videos.length > 0) {
    lines.push(
      `Videos: ${motion.videos
        .map((v) => `${v.model}/${v.mode} (${v.status})`)
        .join(", ")}`,
    );
  }
  // Inspect warnings are the deterministic half of "look before you claim" —
  // surfacing them here means the agent sees them without another tool call.
  if (motion.inspect && motion.inspect.warnings.length > 0) {
    lines.push("Inspect warnings:");
    for (const warning of motion.inspect.warnings) lines.push(`  - ${warning}`);
  }
}

/** The whole character, for a message sent with nothing selected. */
function describeCharacter(project: CharacterProject, lines: string[]): void {
  const { character, refs, motions } = project.sprite;
  lines.push(
    `Character: "${character.name}" (${character.cell.width}×${character.cell.height} cell${
      character.facing ? `, facing ${character.facing}` : ""
    })`,
  );
  if (character.style) lines.push(`Style: ${character.style}`);
  if (refs.length > 0) {
    lines.push(
      `Refs: ${refs.map((r) => `${r.id} (${r.role})`).join(", ")}`,
    );
  } else {
    lines.push("Refs: none yet");
  }
  if (motions.length > 0) {
    lines.push("Motions:");
    for (const motion of motions) {
      lines.push(
        `  - ${motion.id} "${motion.label}" — ${motion.status}, ${motion.grid.cols}×${motion.grid.rows}, ${motion.fps} fps, ${motion.frames.length} frames`,
      );
    }
  } else {
    lines.push("Motions: none yet");
  }
}

/** Workspace items = one per motion, in declared order. */
export function resolveSpriteItems(files: ViewerFileContent[]): WorkspaceItem[] {
  const roster = loadRoster(files);
  const project = selectCharacter(roster, undefined);
  if (!project) return [];
  return project.sprite.motions.map((motion, index) => ({
    path: `${project.contentSet ? `${project.contentSet}/` : ""}motions/${motion.id}/atlas.json`,
    label: motion.label,
    index,
    metadata: { motion: motion.id, status: motion.status },
  }));
}

export function extractSpriteContext(
  selection: ViewerSelectionContext | null,
  files: ViewerFileContent[],
): string {
  const roster = loadRoster(files);
  const address = selection?.address as Record<string, unknown> | undefined;
  const contentSet = addressString(address, "contentSet");
  const project = selectCharacter(roster, contentSet);
  if (!project) return "";

  const lines: string[] = [];
  const motionId = addressString(address, "motion");
  const refId = addressString(address, "ref");
  const frame = addressNumber(address, "frame");

  if (motionId) {
    const motion = findMotion(project, motionId);
    if (motion) {
      describeMotion(motion, lines);
      if (frame !== undefined) lines.push(`Selected frame: ${frame}`);
    } else {
      lines.push(`Motion "${motionId}" is not in this character.`);
    }
  } else if (refId) {
    const ref = findRef(project, refId);
    if (ref) {
      lines.push(`Reference: "${ref.label}" (${ref.id}, role ${ref.role})`);
    } else {
      lines.push(`Reference "${refId}" is not in this character.`);
    }
  } else {
    describeCharacter(project, lines);
  }

  if (lines.length === 0) return "";

  // The Address line is the machine-routable handle: verbatim JSON the agent
  // copies straight into `capture`, `navigate-to`, or a <viewer-locator>.
  if (selection?.address) {
    lines.push(`Address: ${JSON.stringify(selection.address)}`);
  }

  const attrs = [`mode="sprite"`];
  if (project.contentSet) attrs.push(`content-set="${project.contentSet}"`);
  return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
}

// ── Capture seam ───────────────────────────────────────────────────────────

/**
 * The mounted stage's canvas renderer, registered by `SpritePreview`.
 *
 * `capture` screenshots whatever the framework hands it — by default the whole
 * viewer pane, chrome and rails included. For this mode the answer to "what am
 * I looking at" is the STAGE: the sprite, its background and its pivot guides,
 * at the frame the agent asked for. `captureViewer` prefers a viewer-supplied
 * renderer over both the Electron window grab and snapdom, so returning the
 * canvas here is what makes `navigate-to` + `capture` produce a picture of one
 * frame rather than a picture of the UI.
 *
 * Returning `null` (nothing mounted, or a tainted canvas) is not a failure —
 * the framework falls through to its own strategies.
 */
type StageCapture = () => Promise<{ data: string; media_type: string } | null>;

const stageCapture: { current: StageCapture | null } = { current: null };

export function setSpriteStageCapture(capture: StageCapture | null): void {
  stageCapture.current = capture;
}

// ── Mode Definition ────────────────────────────────────────────────────────

const workspace = spriteManifest.viewerApi!.workspace!;

const spriteMode: ModeDefinition = {
  manifest: spriteManifest,

  viewer: {
    PreviewComponent: SpritePreview,

    workspace: {
      type: workspace.type,
      multiFile: workspace.multiFile,
      ordered: workspace.ordered,
      hasActiveFile: workspace.hasActiveFile,
      manifestFile: workspace.manifestFile,
      topBarNavigation: workspace.topBarNavigation,
      resolveContentSets: createDirectoryContentSetResolver(),
      resolveItems: resolveSpriteItems,

      /**
       * "New character" from the empty state. The body is the same skeleton
       * `sprite-project.mjs init` writes — shared, not copied, so the two
       * cannot drift.
       */
      createEmpty(files: ViewerFileContent[]) {
        const existingDirs = new Set<string>();
        for (const file of files) {
          const slashIdx = file.path.indexOf("/");
          if (slashIdx > 0) existingDirs.add(file.path.slice(0, slashIdx));
        }
        let dirName = "character-1";
        let n = 1;
        while (existingDirs.has(dirName)) dirName = `character-${++n}`;

        return [
          {
            path: `${dirName}/project.json`,
            content: createCharacterProjectFile({ name: "New character" }),
          },
        ];
      },
    },

    extractContext: extractSpriteContext,

    // The manifest is the single source of truth for the action space —
    // re-listing them here is how modes end up declaring two different sets.
    actions: spriteManifest.viewerApi?.actions,

    async captureViewport() {
      return stageCapture.current ? stageCapture.current() : null;
    },

    updateStrategy: "incremental",
  },
};

export default spriteMode;
