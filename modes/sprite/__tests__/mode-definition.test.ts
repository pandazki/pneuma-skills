/**
 * The mode definition — what the agent sees and what the framework navigates.
 *
 * `extractContext` is the only channel through which a click in the viewer
 * becomes something the agent can act on, and its `Address:` line is the one
 * part that must be machine-exact: the agent copies it verbatim into
 * `capture`, `navigate-to`, and `<viewer-locator>` cards. Everything else on
 * the block is prose for a reader; that line is a contract.
 *
 * `resolveItems` is the framework's model of "what is in this workspace". For
 * sprite the answer is motions, not files — that is what the user picks and
 * what an address names.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import spriteManifest from "../manifest.js";
import spriteMode, {
  extractSpriteContext,
  resolveSpriteItems,
  selectCharacter,
} from "../pneuma-mode.js";

const MINI = readFileSync(
  join(import.meta.dir, "fixtures", "mini", "project.json"),
  "utf-8",
);

/** The fixture with a second, still-planned motion — the common mid-work state. */
function withWalk(): string {
  const body = JSON.parse(MINI);
  body.sprite.motions.push({
    id: "walk",
    label: "Walk",
    prompt: "4x2 walk cycle",
    grid: { rows: 2, cols: 4 },
    fps: 10,
    loop: true,
    anchor: "bottom",
    status: "planned",
    frames: [],
    videos: [],
  });
  body.sprite.refs.push({
    id: "turnaround",
    asset: "ref-turnaround",
    role: "turnaround",
    label: "Turnaround",
  });
  return JSON.stringify(body);
}

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const MINI_FILES = files({ "mini/project.json": MINI });

describe("resolveItems", () => {
  test("one item per motion, in declared order, addressed by its atlas", () => {
    const items = resolveSpriteItems(files({ "mini/project.json": withWalk() }));
    expect(items).toEqual([
      {
        path: "mini/motions/bounce/atlas.json",
        label: "Bounce",
        index: 0,
        metadata: { motion: "bounce", status: "ready" },
      },
      {
        path: "mini/motions/walk/atlas.json",
        label: "Walk",
        index: 1,
        metadata: { motion: "walk", status: "planned" },
      },
    ]);
  });

  test("a root-level character produces unprefixed paths", () => {
    const items = resolveSpriteItems(files({ "project.json": MINI }));
    expect(items[0].path).toBe("motions/bounce/atlas.json");
  });

  test("an empty workspace has no items rather than a placeholder one", () => {
    expect(resolveSpriteItems([])).toEqual([]);
  });
});

describe("extractContext — motion selection", () => {
  const context = extractSpriteContext(
    {
      type: "motion",
      content: "",
      address: { contentSet: "mini", motion: "bounce" },
    },
    MINI_FILES,
  );

  test("the Address line is the selection's address, verbatim JSON", () => {
    // Verbatim because the agent round-trips it into capture / navigate-to;
    // a re-serialized-with-extra-keys version would silently miss.
    expect(context).toContain(
      `Address: ${JSON.stringify({ contentSet: "mini", motion: "bounce" })}`,
    );
  });

  test("it opens a sprite-tagged block naming the content set", () => {
    expect(context.startsWith('<viewer-context mode="sprite" content-set="mini">')).toBe(true);
    expect(context.endsWith("</viewer-context>")).toBe(true);
  });

  test("the motion summary carries grid, fps, loop, anchor, status and frame count", () => {
    expect(context).toContain('Motion: "Bounce" (bounce)');
    expect(context).toContain("Grid: 2×2 · 8 fps · loop · anchor bottom");
    expect(context).toContain("Status: ready");
    expect(context).toContain("Frames: 4");
  });

  test("a frame in the address is reported, so 'this frame' resolves", () => {
    const withFrame = extractSpriteContext(
      {
        type: "frame",
        content: "",
        address: { contentSet: "mini", motion: "bounce", frame: 2 },
      },
      MINI_FILES,
    );
    expect(withFrame).toContain("Selected frame: 2");
  });

  test("inspect warnings ride along — the agent should not need a second call", () => {
    const body = JSON.parse(MINI);
    body.sprite.motions[0].inspect.warnings = [
      "frame 03 is empty",
      "anchor jumps between frames 01 and 02",
    ];
    const context = extractSpriteContext(
      {
        type: "motion",
        content: "",
        address: { contentSet: "mini", motion: "bounce" },
      },
      files({ "mini/project.json": JSON.stringify(body) }),
    );
    expect(context).toContain("Inspect warnings:");
    expect(context).toContain("  - frame 03 is empty");
    expect(context).toContain("  - anchor jumps between frames 01 and 02");
  });

  test("a clean motion contributes no warnings section", () => {
    expect(context).not.toContain("Inspect warnings:");
  });

  test("an address naming a motion this character lacks says so plainly", () => {
    // Better than silently describing the character: the agent needs to know
    // its address was stale, not that the motion has no detail.
    const context = extractSpriteContext(
      {
        type: "motion",
        content: "",
        address: { contentSet: "mini", motion: "attack" },
      },
      MINI_FILES,
    );
    expect(context).toContain('Motion "attack" is not in this character.');
  });
});

describe("extractContext — reference selection", () => {
  test("a ref address describes the reference, not the motion list", () => {
    const context = extractSpriteContext(
      {
        type: "ref",
        content: "",
        address: { contentSet: "mini", ref: "portrait" },
      },
      MINI_FILES,
    );
    expect(context).toContain('Reference: "Portrait" (portrait, role portrait)');
    expect(context).not.toContain("Motions:");
  });
});

describe("extractContext — no selection", () => {
  const context = extractSpriteContext(null, files({ "mini/project.json": withWalk() }));

  test("falls back to a character overview instead of an empty block", () => {
    expect(context).toContain('Character: "Mini" (64×64 cell, facing right)');
    expect(context).toContain("Style: flat vector blob, thick outline");
    expect(context).toContain("Refs: portrait (portrait), turnaround (turnaround)");
  });

  test("the overview lists every motion with its status", () => {
    expect(context).toContain('- bounce "Bounce" — ready, 2×2, 8 fps, 4 frames');
    expect(context).toContain('- walk "Walk" — planned, 4×2, 10 fps, 0 frames');
  });

  test("no Address line without a selection — there is nothing to route to", () => {
    expect(context).not.toContain("Address:");
  });

  test("an empty workspace yields no block at all", () => {
    expect(extractSpriteContext(null, [])).toBe("");
  });
});

describe("selectCharacter", () => {
  const roster = {
    byContentSet: {
      zephyr: { contentSet: "zephyr" },
      lumi: { contentSet: "lumi" },
    },
  } as never;

  test("prefers the content set the address names", () => {
    expect(selectCharacter(roster, "zephyr")!.contentSet).toBe("zephyr");
  });

  test("falls back to the first character by name, deterministically", () => {
    // A single-character workspace never surfaces a content set (the shared
    // resolver needs two), so this fallback is the ordinary path, not an edge.
    expect(selectCharacter(roster, undefined)!.contentSet).toBe("lumi");
    expect(selectCharacter(roster, "gone")!.contentSet).toBe("lumi");
  });

  test("null roster stays null", () => {
    expect(selectCharacter(null, "lumi")).toBeNull();
  });
});

describe("the definition and the manifest agree", () => {
  test("actions are the manifest's own array, not a second copy", () => {
    // Two hand-written lists is how a mode ends up advertising an action the
    // viewer never implements (and vice versa).
    expect(spriteMode.viewer.actions).toBe(spriteManifest.viewerApi!.actions);
  });

  test("the four actions the design commissions are all agent-invocable", () => {
    const actions = spriteManifest.viewerApi!.actions!;
    expect(actions.map((a) => a.id)).toEqual([
      "navigate-to",
      "play",
      "pause",
      "get-playback-state",
    ]);
    for (const action of actions) {
      expect({ id: action.id, invocable: action.agentInvocable }).toEqual({
        id: action.id,
        invocable: true,
      });
      // A description that does not say WHEN is a label with extra words.
      expect((action.description ?? "").length).toBeGreaterThan(60);
    }
    // `capture` is framework-built-in; declaring it would shadow the real one.
    expect(actions.map((a) => a.id)).not.toContain("capture");
  });

  test("the three commands the design commissions are declared", () => {
    const commands = spriteManifest.viewerApi!.commands!;
    expect(commands.map((c) => c.id)).toEqual([
      "render-video",
      "regenerate-motion",
      "fix-alignment",
    ]);
    for (const command of commands) {
      expect((command.description ?? "").length).toBeGreaterThan(60);
    }
  });

  test("the workspace model is copied from the manifest, not restated", () => {
    const declared = spriteManifest.viewerApi!.workspace!;
    const bound = spriteMode.viewer.workspace!;
    expect({
      type: bound.type,
      multiFile: bound.multiFile,
      ordered: bound.ordered,
      hasActiveFile: bound.hasActiveFile,
      manifestFile: bound.manifestFile,
      topBarNavigation: bound.topBarNavigation,
    }).toEqual({
      type: declared.type,
      multiFile: declared.multiFile,
      ordered: declared.ordered,
      hasActiveFile: declared.hasActiveFile,
      manifestFile: declared.manifestFile,
      topBarNavigation: declared.topBarNavigation,
    });
  });

  test("createEmpty writes one loadable project into a fresh directory", () => {
    const created = spriteMode.viewer.workspace!.createEmpty!([
      { path: "lumi/project.json", content: MINI },
    ])!;
    expect(created).toHaveLength(1);
    // `lumi/` is taken, so the new character must not land on top of it.
    expect(created[0].path).toBe("character-1/project.json");
    expect(JSON.parse(created[0].content).$schema).toBe(
      "pneuma-craft/project/v1",
    );
  });
});
