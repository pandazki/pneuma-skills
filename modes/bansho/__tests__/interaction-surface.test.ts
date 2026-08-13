/**
 * T6 — the declared interaction surface: what the agent is told it can do
 * with the board, and what the user can hand back.
 *
 * The manifest is the single source of truth for both (`skill-installer`
 * renders `viewerApi.actions` into the instructions file; the runtime
 * injects `viewerApi.commands` into the viewer's props), so the shape is
 * worth pinning:
 *
 *  - the §9 action space exactly: `navigate-to` / `play-from` /
 *    `check-board`, all agent-invocable, addresses declared as structured
 *    objects (a `ViewerAddress` is not a string);
 *  - transport is NOT in the action space — play / pause / scrub / rate are
 *    the user's local controls, and §9 opens by ruling them out. An action
 *    for them would be the agent taking the remote off the user;
 *  - commands are the OTHER direction: things a user asks the agent for,
 *    never things the viewer could do by itself.
 *
 * Word purity over these strings is one gate for the whole mode now —
 * `word-purity.test.ts` walks the surface list in `vocabulary.ts`, actions
 * and commands included.
 */

import { describe, expect, test } from "bun:test";

import banshoManifest from "../manifest.js";
import banshoMode from "../pneuma-mode.js";

const actions = banshoManifest.viewerApi?.actions ?? [];
const commands = banshoManifest.viewerApi?.commands ?? [];

describe("actions (§9) — Agent → Viewer", () => {
  test("exactly the seven declared, no more", () => {
    expect(actions.map((a) => a.id).sort()).toEqual([
      "check-board",
      "frame-board",
      "glance-board",
      "narrate",
      "navigate-to",
      "play-from",
      "subtitles",
    ]);
  });

  test("all of them are callable by the agent", () => {
    for (const action of actions) {
      expect(action.agentInvocable).toBe(true);
      expect(action.label.length).toBeGreaterThan(0);
      expect((action.description ?? "").length).toBeGreaterThan(0);
    }
  });

  test("addresses are declared as structured values, never as strings", () => {
    const navigate = actions.find((a) => a.id === "navigate-to")!;
    expect(navigate.category).toBe("navigate");
    expect(navigate.params?.address?.type).toBe("object");
    expect(navigate.params?.address?.required).toBe(true);

    const play = actions.find((a) => a.id === "play-from")!;
    expect(play.params?.address?.type).toBe("object");
    // Omitting it means "from the top" — a real, useful call.
    expect(play.params?.address?.required).not.toBe(true);
  });

  test("check-board takes nothing and is the mode's own QA verb", () => {
    const check = actions.find((a) => a.id === "check-board")!;
    expect(check.category).toBe("custom");
    expect(Object.keys(check.params ?? {})).toEqual([]);
  });

  test("the transport stays the user's — no action reaches for it", () => {
    const forbidden = ["play", "pause", "scrub", "seek", "rate", "speed", "live"];
    for (const action of actions) {
      for (const verb of forbidden) {
        // `play-from` is the one legitimate playback verb (§9): it is a
        // demonstration ("watch this part again"), not remote control.
        if (action.id === "play-from" && verb === "play") continue;
        // `narrate` (T10) collides with "rate" by spelling alone — it is
        // the voice-over planning verb, nowhere near the playback speed.
        if (action.id === "narrate" && verb === "rate") continue;
        expect(action.id).not.toContain(verb);
      }
    }
  });

  test("the address vocabulary is explained where the agent will read it", () => {
    const navigate = actions.find((a) => a.id === "navigate-to")!;
    const doc = navigate.params!.address!.description;
    expect(doc).toContain("section");
    expect(doc).toContain("step");
  });
});

describe("commands — User → Agent", () => {
  test("the four the board offers", () => {
    // The first three ask about a pointed-at step; export-subtitles is the
    // one deliverable-shaped ask — it needs the agent because the answer
    // is files in the workspace (T10-4).
    expect(commands.map((c) => c.id)).toEqual([
      "continue-here",
      "retell-this",
      "another-angle",
      "export-subtitles",
    ]);
  });

  test("each one tells the agent what response is expected", () => {
    for (const command of commands) {
      expect(command.label.length).toBeGreaterThan(0);
      expect((command.description ?? "").length).toBeGreaterThan(20);
    }
  });
});

describe("the skill registers what the manifest declares", () => {
  // `skill-installer.ts::generateViewerApiSection` is a PURE ROUTER: the
  // instructions file names the channels and then points at this skill for
  // the concrete shapes. So an action declared in the manifest but absent
  // from SKILL.md is an action the agent can never discover — declared and
  // undiscoverable is worse than not declared at all.
  const skill = Bun.file(
    new URL("../skill/SKILL.md", import.meta.url).pathname,
  ).text();

  test("has the viewer-protocol section the instructions file points at", async () => {
    expect(await skill).toContain("## Viewer protocol");
  });

  test("registers the address vocabulary, since the framework never does", async () => {
    const text = await skill;
    expect(text).toContain('"section"');
    expect(text).toContain('"step"');
    // The counting rule is the part an agent cannot guess.
    expect(text).toMatch(/section.*counts from \*\*0\*\*/);
    expect(text).toMatch(/step.*counts from \*\*1\*\*/);
  });

  test("every declared action and command is documented", async () => {
    const text = await skill;
    for (const action of actions) expect(text).toContain(action.id);
    for (const command of commands) expect(text).toContain(command.label);
  });

  test("the three notification kinds are named where the agent will meet them", async () => {
    const text = await skill;
    for (const type of ["stepParseError", "refUnresolved", "boardOverflow"]) {
      expect(text).toContain(type);
    }
  });
});

describe("the ModeDefinition binding", () => {
  test("the viewer re-exports the manifest's actions — one source of truth", () => {
    expect(banshoMode.viewer.actions).toBe(banshoManifest.viewerApi?.actions);
  });

  test("replaying a lecture is a supported way to use this mode", () => {
    expect(banshoManifest.editing?.supported).toBe(true);
  });

  test("still no React in the manifest (G4)", async () => {
    const source = await Bun.file(
      new URL("../manifest.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toContain("react");
    expect(source).not.toContain("./viewer/");
  });
});
