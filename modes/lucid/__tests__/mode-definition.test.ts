/**
 * The mode definition — what the agent sees and what the framework navigates.
 *
 * `extractContext` is the only channel through which a click in the viewer
 * becomes something the agent can act on, and its `Address:` line is the one
 * part that must be machine-exact: the agent copies it verbatim into
 * `capture`, `navigate-to` and `<viewer-locator>` cards. Everything else in
 * the block is prose for a reader; that line is a contract.
 *
 * `resolveItems` is the framework's model of "what is in this workspace". For
 * lucid the answer is ROUNDS, not files — that is what the user picks off the
 * rail and what an address names.
 *
 * `resolveContentSets` is load-bearing in a way the generic resolver is not:
 * it must surface a LONE project, because the whole stage is built out of
 * `/content/<dir>/…` URLs that only exist once the store has a content set
 * to strip and prefix with.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractWatchExtensions } from "../../../server/file-watcher.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import lucidManifest from "../manifest.js";
import lucidMode, {
  extractLucidContext,
  resolveLucidContentSets,
  resolveLucidItems,
  setLucidStageCapture,
} from "../pneuma-mode.js";

const SHRINE = readFileSync(
  join(import.meta.dir, "fixtures", "lantern-shrine.json"),
  "utf-8",
);

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const SHRINE_FILES = files({ "lantern-shrine/lucid.json": SHRINE });

describe("resolveContentSets", () => {
  test("a directory holding lucid.json is a project, labelled by its title", () => {
    expect(resolveLucidContentSets(SHRINE_FILES)).toEqual([
      { prefix: "lantern-shrine", label: "Lantern shrine", traits: {} },
    ]);
  });

  test("ONE project is still surfaced — the generic resolver would hide it", () => {
    // Hiding it leaves `activeContentSet` null, so every `/content/<dir>/…`
    // URL the stage builds points at the workspace root and 404s.
    expect(resolveLucidContentSets(SHRINE_FILES)).toHaveLength(1);
  });

  test("directories without a manifest are not projects", () => {
    const sets = resolveLucidContentSets(
      files({
        "lantern-shrine/lucid.json": SHRINE,
        "node_modules/three/package.json": "{}",
        "lantern-shrine/scene/index.html": "<!doctype html>",
        ".pneuma/config.json": "{}",
      }),
    );
    expect(sets.map((s) => s.prefix)).toEqual(["lantern-shrine"]);
  });

  test("a half-written manifest keeps the directory name rather than vanishing", () => {
    // The file is rewritten mid-loop while the viewer watches; a project that
    // disappeared from the switcher for one frame would take the stage with it.
    const sets = resolveLucidContentSets(files({ "half/lucid.json": '{"title": "Half' }));
    expect(sets).toEqual([{ prefix: "half", label: "Half", traits: {} }]);
  });

  test("a root-level project has no content set to switch to", () => {
    expect(resolveLucidContentSets(files({ "lucid.json": SHRINE }))).toEqual([]);
  });
});

describe("resolveItems", () => {
  test("one item per recorded round, labelled with its score", () => {
    // The framework hands content-set-FILTERED files here, so the paths are
    // project-relative — matching what `activeFile` is compared against.
    expect(resolveLucidItems(files({ "lucid.json": SHRINE }))).toEqual([
      {
        path: "rounds/01/capture.png",
        label: "Round 1 · 4.5",
        index: 0,
        metadata: { round: 1, kind: "iterate", total: 4.5 },
      },
      {
        path: "rounds/02/capture.png",
        label: "Round 2 · 6.8",
        index: 1,
        metadata: { round: 2, kind: "iterate", total: 6.8 },
      },
    ]);
  });

  test("an unjudged round is listed without a score, not skipped", () => {
    const body = JSON.parse(SHRINE);
    body.rounds.push({
      index: 3,
      kind: "rethink",
      at: "2026-09-16T10:10:00.000Z",
      capture: null,
      fps: null,
      verdict: null,
    });
    const items = resolveLucidItems(files({ "lucid.json": JSON.stringify(body) }));
    expect(items[2]).toEqual({
      // No capture on disk yet — the path still names where it will land, so
      // the item has a stable identity across the round being judged.
      path: "rounds/03/capture.png",
      label: "Round 3",
      index: 2,
      metadata: { round: 3, kind: "rethink", total: null },
    });
  });

  test("an unfiltered snapshot keeps the project prefix", () => {
    expect(resolveLucidItems(SHRINE_FILES)[0].path).toBe(
      "lantern-shrine/rounds/01/capture.png",
    );
  });

  test("an empty workspace has no items rather than a placeholder one", () => {
    expect(resolveLucidItems([])).toEqual([]);
  });
});

describe("extractContext — a selected round", () => {
  const context = extractLucidContext(
    {
      type: "image",
      content: "",
      address: { contentSet: "lantern-shrine", round: 2 },
    },
    SHRINE_FILES,
  );

  test("the Address line is the selection's address, verbatim JSON", () => {
    // Verbatim because the agent round-trips it into capture / navigate-to;
    // a re-serialized-with-extra-keys version would silently miss.
    expect(context).toContain(
      `Address: ${JSON.stringify({ contentSet: "lantern-shrine", round: 2 })}`,
    );
  });

  test("it opens a lucid-tagged block naming the project", () => {
    expect(context.startsWith('<viewer-context mode="lucid" content-set="lantern-shrine">')).toBe(
      true,
    );
    expect(context.endsWith("</viewer-context>")).toBe(true);
  });

  test("the project header carries title, status, target and direction", () => {
    expect(context).toContain('Project: "Lantern shrine" (looping)');
    expect(context).toContain(
      'Direction: "an isometric shrine courtyard at dusk, lanterns on wet stone"',
    );
    expect(context).toContain("Target: target.png (v1)");
    expect(context).toContain("fps target: 60");
  });

  test("the exit line quotes the script's verdict rather than re-deriving one", () => {
    // Two authorities for "are we done" is how the viewer starts
    // contradicting `lucid.mjs status` in front of the user.
    expect(context).toContain("Exit: continue — best round 2 at 6.8, last round 2 at 6.8");
    expect(context).toContain("Because: best score 6.8 is below 8; gap wet-stone-flat repeated");
    expect(context).toContain("Gaps repeated across the last two verdicts: wet-stone-flat");
  });

  test("the selected round reports its position, score, capture and gap count", () => {
    expect(context).toContain("Selected: round 2 of 2 · 6.8");
    expect(context).toContain("Capture: rounds/02/capture.png");
    expect(context).toContain("Measured fps at capture: 58");
    expect(context).toContain(
      "Scores: composition 2.5 · lighting 2 · materials 1.5 · details 0.8",
    );
    expect(context).toContain("Gaps: 2");
  });

  test("only the first two gap issues ride along — the rest are a script call away", () => {
    // This block prefixes EVERY message; a wall of text in front of every
    // turn is how a context block stops being read.
    expect(context).toContain("  - [materials] The stone still reads dry under the new lanterns.");
    expect(context).toContain("  - [composition] Nothing occupies the upper third");
    expect(context).not.toContain("Add a roughness map");
  });

  test("an address naming a round this project lacks says so plainly", () => {
    // Better than silently describing the project: the agent needs to know
    // its address was stale, not that the round has no detail.
    const stale = extractLucidContext(
      { type: "image", content: "", address: { contentSet: "lantern-shrine", round: 9 } },
      SHRINE_FILES,
    );
    expect(stale).toContain("Round 9 is not recorded in this project.");
  });

  test("the stage view rides along when the address names one", () => {
    const split = extractLucidContext(
      {
        type: "image",
        content: "",
        address: { contentSet: "lantern-shrine", round: 1, view: "split" },
      },
      SHRINE_FILES,
    );
    expect(split).toContain("Stage view: split");
  });
});

describe("extractContext — no selection", () => {
  const context = extractLucidContext(null, SHRINE_FILES);

  test("falls back to the project overview with the best round named", () => {
    expect(context).toContain("Rounds: 2 recorded, best is round 2 at 6.8");
  });

  test("no Address line without a selection — there is nothing to route to", () => {
    expect(context).not.toContain("Address:");
  });

  test("an empty workspace yields no block at all", () => {
    expect(extractLucidContext(null, [])).toBe("");
  });

  test("the best round is the script's, so it cannot name an abandoned dream", () => {
    // After a re-dream `evaluation.best` counts only the rounds judged
    // against the locked target. Scanning every round here would put a
    // higher, meaningless score on this line — one the Exit line above it
    // contradicts in the same block.
    const body = JSON.parse(SHRINE);
    body.target.version = 2;
    body.rounds[0].targetVersion = 2; // 4.5, against the new dream
    body.rounds[1].targetVersion = 1; // 6.8, against the one it replaced
    body.evaluation.targetVersion = 2;
    body.evaluation.best = { index: 1, total: 4.5 };
    body.evaluation.trend = [4.5];
    const context = extractLucidContext(
      null,
      files({ "lantern-shrine/lucid.json": JSON.stringify(body) }),
    );
    expect(context).toContain("Rounds: 2 recorded, best is round 1 at 4.5");
    expect(context).not.toContain("best is round 2");
  });

  test("a selected round says when its score measured an earlier dream", () => {
    const body = JSON.parse(SHRINE);
    body.target.version = 2;
    body.rounds[1].targetVersion = 1;
    const context = extractLucidContext(
      { type: "image", content: "", address: { contentSet: "lantern-shrine", round: 2 } },
      files({ "lantern-shrine/lucid.json": JSON.stringify(body) }),
    );
    expect(context).toContain("Selected: round 2 of 2 · 6.8 · judged against target v1, now v2");
  });

  test("a project the script has not evaluated says so instead of guessing", () => {
    const body = JSON.parse(SHRINE);
    body.evaluation = null;
    body.rounds = [];
    const fresh = extractLucidContext(null, files({ "lantern-shrine/lucid.json": JSON.stringify(body) }));
    expect(fresh).toContain("Exit: not evaluated yet (0 rounds recorded)");
    expect(fresh).toContain("Rounds: 0 recorded, none judged yet");
  });

  test("loader warnings reach the agent — a defaulted field is not silent", () => {
    const body = JSON.parse(SHRINE);
    delete body.rounds;
    const warned = extractLucidContext(
      null,
      files({ "lantern-shrine/lucid.json": JSON.stringify(body) }),
    );
    expect(warned).toContain("Warnings:");
    expect(warned).toContain("  - rounds missing, shown as none");
  });
});

describe("the capture seam", () => {
  test("no mounted stage means no viewer capture, not a failure", () => {
    // Returning null lets `captureViewer` fall through to its own strategies;
    // throwing here would break `capture` for a viewer that is merely closed.
    setLucidStageCapture(null);
    return expect(lucidMode.viewer.captureViewport!()).resolves.toBeNull();
  });

  test("a mounted stage answers through the registered renderer", async () => {
    setLucidStageCapture(async () => ({ data: "QUJD", media_type: "image/png" }));
    await expect(lucidMode.viewer.captureViewport!()).resolves.toEqual({
      data: "QUJD",
      media_type: "image/png",
    });
    setLucidStageCapture(null);
  });

  test("unmounting clears the ref rather than leaving a stale closure", async () => {
    setLucidStageCapture(async () => ({ data: "QUJD", media_type: "image/png" }));
    setLucidStageCapture(null);
    await expect(lucidMode.viewer.captureViewport!()).resolves.toBeNull();
  });
});

describe("the definition and the manifest agree", () => {
  test("actions are the manifest's own array, not a second copy", () => {
    // Two hand-written lists is how a mode ends up advertising an action the
    // viewer never implements (and vice versa).
    expect(lucidMode.viewer.actions).toBe(lucidManifest.viewerApi!.actions);
  });

  test("the three actions the design commissions are all agent-invocable", () => {
    const actions = lucidManifest.viewerApi!.actions!;
    expect(actions.map((a) => a.id)).toEqual([
      "navigate-to",
      "get-scene-state",
      "reload-scene",
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

  test("get-scene-state documents the exact shape it returns", () => {
    // The agent has no other way to know what comes back, and a state report
    // it cannot parse is worse than none.
    const action = lucidManifest.viewerApi!.actions!.find((a) => a.id === "get-scene-state")!;
    for (const key of [
      "bridge",
      "registered",
      "ready",
      "loading",
      "fps",
      "rafFps",
      "fpsSource",
      "frameMs",
      "passesPerFrame",
      "drawCalls",
      "triangles",
      "textures",
      "errors",
      "notes",
      "viewport",
      "stage",
      "lastCapture",
      "source",
      "reloadedAt",
    ]) {
      expect({ key, documented: action.description!.includes(key) }).toEqual({
        key,
        documented: true,
      });
    }
    expect(action.description).toContain("bridge: false");
  });

  test("the description says what an extra render pass costs", () => {
    // `fps` counts displayed frames, so a scene drawing a reflection pass
    // first is not 60 fps because it called render 120 times. Without this
    // clause `passesPerFrame` is one more unexplained number.
    const description = lucidManifest.viewerApi!.actions!.find(
      (a) => a.id === "get-scene-state",
    )!.description!;
    expect(description).toMatch(/passesPerFrame.{0,80}(above 1|extra passes)/s);
  });

  test("the description sends the agent here BEFORE it dreams the target", () => {
    // The blind trial dreamed 16:9 against a 1091 × 738 stage and every round
    // after that was judged against a differently shaped picture. The stage
    // size is always answerable — that is the whole reason to ask first — so
    // the action that reports it has to say when to call it.
    const description = lucidManifest.viewerApi!.actions!.find(
      (a) => a.id === "get-scene-state",
    )!.description!;
    expect(description).toMatch(/before you dream/i);
    expect(description).toContain("aspect");
  });

  test("the description says what an unready screenshot means", () => {
    // `lastCapture.ready === false` is the one field that invalidates a
    // picture the agent is holding; a shape documented without that rule
    // reads like four more diagnostics.
    const description = lucidManifest.viewerApi!.actions!.find(
      (a) => a.id === "get-scene-state",
    )!.description!;
    expect(description).toContain("lastCapture.ready === false");
    expect(description).toMatch(/must not be judged/i);
  });

  test("the description says how to tell a live frame from a returned still", () => {
    // `capture` answers with a PNG path whichever way it went, so "I shot the
    // scene" and "the viewer handed me the target back" are indistinguishable
    // in the reply. `lastCapture.source` is the only place the difference
    // shows, and the rule is worth nothing if the action does not state it.
    const description = lucidManifest.viewerApi!.actions!.find(
      (a) => a.id === "get-scene-state",
    )!.description!;
    expect(description).toContain("lastCapture.source");
    expect(description).toContain('source === "live"');
    for (const source of ['"live"', '"round"', '"target"']) {
      expect({ source, documented: description.includes(source) }).toEqual({
        source,
        documented: true,
      });
    }
  });

  test("navigate-to says that a view with no round clears the selection", () => {
    // The step the skill's judged capture depends on: the round the user left
    // on the rail is what `capture` would hand back instead of a frame.
    const description = lucidManifest.viewerApi!.actions!.find(
      (a) => a.id === "navigate-to",
    )!.description!;
    expect(description).toContain('{ "view": "live" }');
    expect(description).toMatch(/clears/i);
    // And that an address naming a round the project does not have is
    // refused, rather than answered with whatever happens to be on stage.
    expect(description).toMatch(/refused/i);
  });

  test("the two commands the design commissions are declared", () => {
    const commands = lucidManifest.viewerApi!.commands!;
    expect(commands.map((c) => c.id)).toEqual(["judge-round", "re-dream"]);
    for (const command of commands) {
      expect(command.label.length).toBeGreaterThan(0);
      const description = command.description ?? "";
      // A command's description is what the USER reads on hover: it has to
      // say something, fit one tooltip line, and never leak the agent's
      // vocabulary (script names, flags, file paths).
      expect(description.length).toBeGreaterThan(30);
      expect(description.length).toBeLessThanOrEqual(120);
      expect(description).not.toContain("\n");
      expect(description).not.toMatch(/\.mjs|--[a-z]|`|lucid\.json|rounds\//);
    }
  });

  test("the workspace model is copied from the manifest, not restated", () => {
    const declared = lucidManifest.viewerApi!.workspace!;
    const bound = lucidMode.viewer.workspace!;
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

  test("createEmpty refuses — a project is set up by the script, not the viewer", () => {
    // An empty skeleton written from the viewer would be a project with no
    // bridge in its scene, no budget clock and no exit evaluation.
    expect(lucidMode.viewer.workspace!.createEmpty!([])).toBeNull();
  });

  test("updates are incremental — a full reload would restart the scene", () => {
    expect(lucidMode.viewer.updateStrategy).toBe("incremental");
  });

  test("the watched patterns yield an extension allowlist covering the scene", () => {
    // Measured 2026-09-16: the watcher derives a file-TYPE allowlist from
    // these globs, and a bare directory pattern (`**/scene/**`) contributes
    // nothing to it. With the first version of this manifest the allowlist was
    // `{.json, .png}`, so an edit to `scene/main.js` never reached the viewer
    // and the debounced auto-reload could not fire — silently, because the
    // initial scan still listed the file.
    const derived = extractWatchExtensions(lucidManifest.viewer.watchPatterns);
    expect(derived).not.toBeNull();
    for (const ext of [".json", ".png", ".html", ".js", ".mjs", ".css"]) {
      expect({ ext, watched: derived!.has(ext) }).toEqual({ ext, watched: true });
    }
    // A GLB is binary; the file store is text, and a new model is what
    // `reload-scene` is for.
    expect(derived!.has(".glb")).toBe(false);
  });

  test("every watched pattern names a file type, not just a directory", () => {
    for (const pattern of lucidManifest.viewer.watchPatterns) {
      expect({ pattern, typed: /\.\w+$/.test(pattern) }).toEqual({ pattern, typed: true });
    }
  });

  test("the scene source ignores the vendored three build", () => {
    // It is ~1.2 MB of text that never changes after `init`; shipping it to
    // the browser on every snapshot buys nothing — the iframe loads it itself.
    const scene = lucidManifest.sources!.sceneFiles as {
      kind: string;
      config: { patterns: string[]; ignore: string[] };
    };
    expect(scene.kind).toBe("file-glob");
    expect(scene.config.ignore).toContain("**/scene/vendor/**");
  });
});
