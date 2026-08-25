import { describe, expect, it } from "bun:test";
import wordtasteManifest from "../manifest.js";

describe("wordtaste v0.9 manifest", () => {
  it("declares the upstream method alignment and calibrated scope", () => {
    expect(wordtasteManifest.version).toBe("0.16.0");
    expect(wordtasteManifest.changelog?.["0.3.0"]).toBeDefined();
    expect(wordtasteManifest.changelog?.["0.4.0"]).toBeDefined();
    expect(wordtasteManifest.changelog?.["0.5.0"]).toHaveLength(3);
    expect(wordtasteManifest.changelog?.["0.7.0"]).toHaveLength(3);
    expect(wordtasteManifest.changelog?.["0.8.0"]).toHaveLength(3);
    expect(wordtasteManifest.changelog?.["0.9.0"]).toHaveLength(3);
    expect(wordtasteManifest.changelog?.["0.10.0"]).toHaveLength(3);
    // The skill-update prompt reads its bullets out of this map, so a
    // version bump without an entry ships a silent update.
    expect(wordtasteManifest.changelog?.[wordtasteManifest.version]).toBeDefined();
    expect(wordtasteManifest.changelog?.["0.11.0"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.11.1"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.12.0"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.12.1"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.13.0"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.14.0"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.15.0"]).toHaveLength(1);
    expect(wordtasteManifest.changelog?.["0.16.0"]).toHaveLength(1);
    const description = wordtasteManifest.description;
    expect(typeof description === "string" ? description : description?.en).toContain(
      "Chinese long-form",
    );
    expect(wordtasteManifest.layout).toBe("app");
    expect(wordtasteManifest.skill.mdScene).toContain(
      "A leaf has no workspace access",
    );
    expect(wordtasteManifest.skill.mdScene).toContain(
      "Send no progress commentary between human gates",
    );
  });

  it("tells the orchestrator up front that it writes no Chinese for a model", () => {
    // Every model-facing prompt is assembled by a script, so the first thing
    // the scene says about prompts is which script builds them.
    const mdScene = wordtasteManifest.skill.mdScene!;
    expect(mdScene).toContain("Write no Chinese for any model");
    for (
      const script of [
        "compose_plan_prompt.ts",
        "run_leaf.ts planner",
        "validate_plan.ts",
        "project_plan.ts",
        "compose_unit_parts.ts",
        "compose_leaf_prompt.ts",
        "compose_check_brief.ts",
      ]
    ) {
      expect(mdScene).toContain(script);
    }
    expect(mdScene).toContain("stay at intake");
    // The skill text returned to English with 0.7.0; the scene follows it.
    expect(mdScene).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
    expect(wordtasteManifest.agent?.greeting).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
  });

  it("is file-driven around draft + workflow + candidates", () => {
    const sources = wordtasteManifest.sources!;
    expect(sources.draft.kind).toBe("aggregate-file");
    expect(sources.workflow.kind).toBe("aggregate-file");
    expect(sources.materials.kind).toBe("file-glob");
    expect(sources.candidates.kind).toBe("file-glob");
    expect(sources.taste.kind).toBe("aggregate-file");
    expect(sources.crossFamily.kind).toBe("json-file");
    expect(sources.config.kind).toBe("json-file");

    expect(wordtasteManifest.viewer?.watchPatterns).toContain("**/workflow.json");
    expect(wordtasteManifest.viewer?.watchPatterns).toContain(
      "**/candidates/**/*.md",
    );
    expect(wordtasteManifest.viewer?.watchPatterns).not.toContain(
      "**/draft.freeze.json",
    );
    expect(wordtasteManifest.viewer?.watchPatterns).not.toContain(
      "**/draft.annotations.json",
    );
  });

  it("exposes only stage focus/navigation actions", () => {
    const ids = wordtasteManifest.viewerApi?.actions?.map((action) => action.id);
    expect(ids).toEqual(["navigate-to", "focus-stage"]);
    expect(ids).not.toContain("set-ladder");
    expect(ids).not.toContain("poke-symptom");
    expect(ids).not.toContain("set-block-frozen");
  });

  it("declares the three human gates as plain commands", () => {
    expect(
      wordtasteManifest.viewerApi?.commands?.map((command) => command.id),
    ).toEqual([
      "begin-from-idea",
      "begin-from-draft",
      "approve-layout",
      "revise-layout",
      "choose-candidate",
      "reject-candidates",
      "flag-selection",
      "request-variants",
      "accept-draft",
    ]);
  });

  it("lets the user pick which primer libraries a session reads", () => {
    // The choices are half declared (the two presets) and half discovered at
    // launch time (whatever libraries this machine has) — the full behaviour
    // is pinned in `primer-libraries-param.test.ts`, including the proof that
    // the stored value stays the string `session.ts` already parses.
    const params = wordtasteManifest.init?.params ?? [];
    const primer = params.find((param) => param.name === "primerLibraries");
    expect(primer).toBeDefined();
    expect(primer!.type).toBe("multi-select");
    expect(primer!.defaultValue).toBe("all");
    expect(primer!.label).toBe("Primer libraries");
    expect(primer!.options?.map((o) => (typeof o === "string" ? o : o.value))).toEqual([
      "all",
      "bundled",
    ]);
    expect(primer!.optionsSource?.kind).toBe("directory-scan");
    expect(primer!.sensitive).toBeUndefined();
  });

  it("takes an optional hosted-writer key and the model it names", () => {
    // The key is optional on purpose: without it the mode still writes, with
    // whichever CLI the session has.
    expect(wordtasteManifest.skill.envMapping).toEqual({
      OPENROUTER_API_KEY: "openrouterApiKey",
    });

    const params = wordtasteManifest.init?.params ?? [];
    const key = params.find((param) => param.name === "openrouterApiKey");
    expect(key).toBeDefined();
    expect(key!.type).toBe("string");
    expect(key!.sensitive).toBe(true);
    expect(key!.defaultValue).toBe("");
    expect(key!.description).toContain("optional");

    const model = params.find((param) => param.name === "writerModel");
    expect(model).toBeDefined();
    expect(model!.type).toBe("string");
    expect(model!.defaultValue).toBe("anthropic/claude-sonnet-5");
    expect(model!.description).toContain("only when an OpenRouter key is available");
    expect(model!.sensitive).toBeUndefined();
  });

  it("ships only the two honest entry seeds", () => {
    const seeds = wordtasteManifest.init?.seeds ?? [];
    expect(seeds.map((seed) => seed.id)).toEqual([
      "from-idea",
      "from-draft",
    ]);
    expect(seeds.map((seed) => seed.id)).not.toContain("worked-example");
    expect(wordtasteManifest.init?.contentCheckPattern).toBe("**/workflow.json");
    const seedFiles = wordtasteManifest.init?.seedFiles ?? {};
    expect(Object.keys(seedFiles)).toHaveLength(2);
  });

  it("parses family probe state without pretending a default family exists", () => {
    const config = wordtasteManifest.sources?.crossFamily.config as {
      parse: (raw: string) => {
        claude: boolean;
        codex: boolean;
        openrouter: boolean;
      };
    };
    expect(config.parse("{broken")).toEqual({
      claude: false,
      codex: false,
      openrouter: false,
    });
    expect(config.parse('{"codex":"true","claude":false}')).toEqual({
      claude: false,
      codex: true,
      openrouter: false,
    });
    expect(config.parse('{"claude":true,"codex":true,"openrouter":true}')).toEqual({
      claude: true,
      codex: true,
      openrouter: true,
    });
  });
});
