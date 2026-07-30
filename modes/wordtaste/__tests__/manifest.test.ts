import { describe, expect, it } from "bun:test";
import wordtasteManifest from "../manifest.js";

describe("wordtaste v0.3 manifest", () => {
  it("declares the upstream method alignment and calibrated scope", () => {
    expect(wordtasteManifest.version).toBe("0.3.0");
    expect(wordtasteManifest.changelog?.["0.3.0"]).toBeDefined();
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
      };
    };
    expect(config.parse("{broken")).toEqual({
      claude: false,
      codex: false,
    });
    expect(config.parse('{"codex":"true","claude":false}')).toEqual({
      claude: false,
      codex: true,
    });
  });
});
