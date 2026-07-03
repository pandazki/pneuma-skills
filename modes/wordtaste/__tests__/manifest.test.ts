import { describe, it, expect } from "bun:test";
import wordtasteManifest from "../manifest.js";

describe("wordtaste manifest — identity", () => {
  it("declares the expected name and version with a matching changelog entry", () => {
    expect(wordtasteManifest.name).toBe("wordtaste");
    expect(wordtasteManifest.version).toBe("0.1.0");
    expect(wordtasteManifest.changelog?.["0.1.0"]).toBeDefined();
    expect(wordtasteManifest.changelog?.["0.1.0"]!.length).toBeGreaterThan(0);
  });

  it("is not hidden and leaves supportedBackends unset (any orchestrator)", () => {
    expect(wordtasteManifest.hidden).toBeUndefined();
    expect(wordtasteManifest.supportedBackends).toBeUndefined();
  });

  it("uses the editor layout and incremental update strategy hints", () => {
    expect(wordtasteManifest.layout).toBe("editor");
  });
});

describe("wordtaste manifest — sources", () => {
  it("declares the five sources from the brief", () => {
    const s = wordtasteManifest.sources!;
    expect(s.draft.kind).toBe("aggregate-file");
    expect(s.materials.kind).toBe("file-glob");
    expect(s.taste.kind).toBe("aggregate-file");
    // crossFamily tracks the on-disk probe result so chokidar reloads the
    // family banner when the probe writes it — a memory source could never
    // observe that file (brief §3.2).
    expect(s.crossFamily.kind).toBe("json-file");
    expect(s.config.kind).toBe("json-file");
  });

  it("wires draft to aggregate load/save and materials to a read-only glob", () => {
    const draftCfg = wordtasteManifest.sources!.draft.config as {
      load: unknown;
      save: unknown;
    };
    expect(typeof draftCfg.load).toBe("function");
    expect(typeof draftCfg.save).toBe("function");

    // Patterns are `**/`-anchored so they match a content-set subdirectory
    // (a writing project lives at `<project>/materials/…`, brief §6.1), not
    // only the workspace root.
    const matCfg = wordtasteManifest.sources!.materials.config as { patterns: string[] };
    expect(matCfg.patterns).toContain("**/materials/**/*.md");
    expect(matCfg.patterns).toContain("**/materials/**/*.txt");

    const tasteCfg = wordtasteManifest.sources!.taste.config as { patterns: string[] };
    expect(tasteCfg.patterns).toContain("**/taste/**/*.md");
    expect(tasteCfg.patterns).toContain("**/taste/**/*.jsonl");
  });

  it("reads crossFamily from the probe-written .pneuma/cross-family.json", () => {
    const cfg = wordtasteManifest.sources!.crossFamily.config as {
      path: string;
      parse: (raw: string) => { claude: boolean; codex: boolean; gemini: boolean };
      serialize: (v: unknown) => string;
    };
    expect(cfg.path).toBe(".pneuma/cross-family.json");
    expect(typeof cfg.parse).toBe("function");
    expect(typeof cfg.serialize).toBe("function");
  });

  it("parses the probe JSON into the three-family boolean triple", () => {
    const cfg = wordtasteManifest.sources!.crossFamily.config as {
      parse: (raw: string) => { claude: boolean; codex: boolean; gemini: boolean };
    };
    expect(cfg.parse('{"claude":true,"codex":true,"gemini":true}')).toEqual({
      claude: true,
      codex: true,
      gemini: true,
    });
  });

  it("degrades the crossFamily parse to single-family (claude-only) on bad/partial JSON", () => {
    const cfg = wordtasteManifest.sources!.crossFamily.config as {
      parse: (raw: string) => { claude: boolean; codex: boolean; gemini: boolean };
    };
    // Malformed JSON → single-family default, never a throw (so the source
    // emits a value, not an E_PARSE error, keeping the banner sane).
    expect(cfg.parse("not json")).toEqual({ claude: true, codex: false, gemini: false });
    // Partial / wrong-typed fields coerce to booleans with claude defaulting true.
    expect(cfg.parse('{"codex":true}')).toEqual({ claude: true, codex: true, gemini: false });
    expect(cfg.parse('{"claude":false,"codex":"yes","gemini":1}')).toEqual({
      claude: false,
      codex: true,
      gemini: true,
    });
  });

  it("watches .pneuma/cross-family.json so the probe write reloads the banner", () => {
    expect(wordtasteManifest.viewer!.watchPatterns).toContain(".pneuma/cross-family.json");
  });

  it("declares the annotations source and watches draft.annotations.json (the annotation channel)", () => {
    const ann = wordtasteManifest.sources!.annotations;
    expect(ann.kind).toBe("aggregate-file");
    const cfg = ann.config as { patterns: string[]; load: unknown; save: unknown };
    expect(cfg.patterns).toContain("**/draft.annotations.json");
    expect(typeof cfg.load).toBe("function");
    expect(typeof cfg.save).toBe("function");
    // chokidar must reload the annotation column when the agent writes a note.
    expect(wordtasteManifest.viewer!.watchPatterns).toContain("**/draft.annotations.json");
  });
});

describe("wordtaste manifest — action space", () => {
  const ids = () => wordtasteManifest.viewerApi!.actions!.map((a) => a.id);

  it("declares exactly the 8 actions from §4.1 with exact ids", () => {
    expect(ids()).toEqual([
      "navigate-to",
      "rewrite-span",
      "mask-and-complete",
      "set-block-frozen",
      "poke-symptom",
      "set-ladder",
      "propose-directions",
      "mark-resolved",
    ]);
  });

  it("marks every action agent-invocable", () => {
    for (const a of wordtasteManifest.viewerApi!.actions!) {
      expect(a.agentInvocable).toBe(true);
    }
  });

  it("assigns the brief's categories", () => {
    const byId = Object.fromEntries(
      wordtasteManifest.viewerApi!.actions!.map((a) => [a.id, a.category]),
    );
    expect(byId["navigate-to"]).toBe("navigate");
    expect(byId["rewrite-span"]).toBe("custom");
    expect(byId["mask-and-complete"]).toBe("custom");
    expect(byId["set-block-frozen"]).toBe("ui");
    expect(byId["poke-symptom"]).toBe("custom");
    expect(byId["set-ladder"]).toBe("ui");
    expect(byId["propose-directions"]).toBe("ui");
    expect(byId["mark-resolved"]).toBe("ui");
  });

  it("declares the 6 commands from §4.2 with exact ids", () => {
    expect(wordtasteManifest.viewerApi!.commands!.map((c) => c.id)).toEqual([
      "start-from-idea",
      "start-from-draft",
      "calibrate-style-sample",
      "request-directions",
      "still-ai",
      "good-enough",
    ]);
  });

  it("supports content sets in the workspace declaration", () => {
    expect(wordtasteManifest.viewerApi!.workspace!.supportsContentSets).toBe(true);
  });
});

describe("wordtaste manifest — init / seeds", () => {
  it("checks content with the draft.md glob", () => {
    expect(wordtasteManifest.init!.contentCheckPattern).toBe("**/draft.md");
  });

  it("declares the three explicit seed cards", () => {
    expect(wordtasteManifest.init!.seeds!.map((s) => s.id)).toEqual([
      "from-idea",
      "from-draft",
      "worked-example",
    ]);
  });

  it("every seed card's sourceKey resolves to a seedFiles entry", () => {
    const seedFiles = wordtasteManifest.init!.seedFiles!;
    for (const card of wordtasteManifest.init!.seeds!) {
      const keys = Array.isArray(card.sourceKey) ? card.sourceKey : [card.sourceKey];
      for (const k of keys) {
        expect(seedFiles[k]).toBeDefined();
      }
    }
  });
});

describe("wordtaste manifest — agent + evolution", () => {
  it("runs in bypassPermissions and references the cross-family probe in its greeting", () => {
    expect(wordtasteManifest.agent!.permissionMode).toBe("bypassPermissions");
    expect(wordtasteManifest.agent!.greeting).toContain("cross_family_probe.sh");
    // Never instructs the user to "set up their taste" (brief §1, §7.3).
    expect(wordtasteManifest.agent!.greeting!.toLowerCase()).not.toContain("set up taste");
    expect(wordtasteManifest.agent!.greeting!.toLowerCase()).not.toContain("set up your taste");
  });

  it("scopes the evolution directive to the federated summary only", () => {
    const d = wordtasteManifest.evolution!.directive.toLowerCase();
    expect(d).toContain("mode-wordtaste.md");
    // Must explicitly NOT touch the heavy per-content-set taste/ artifacts.
    expect(d).toContain("taste/");
  });
});
