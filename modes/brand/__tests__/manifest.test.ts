import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import manifest from "../manifest.js";

const shared = join(import.meta.dir, "../../_shared/scripts");
const skillDir = join(import.meta.dir, "../skill");
const skillText = [join(skillDir, "SKILL.md"), ...readdirSync(join(skillDir, "references")).map((f) => join(skillDir, "references", f))]
  .map((path) => readFileSync(path, "utf8")).join("\n");

describe("brand install surface", () => {
  it("whitelists every shared script a listed script imports", () => {
    // `sharedScripts` is a whitelist and it is transitive: an installed script
    // whose sibling was not copied dies on its first import line.
    const declared = manifest.skill.sharedScripts ?? [];
    expect(declared).toContain("generate_svg.mjs");
    for (const script of declared) {
      const imports = [...readFileSync(join(shared, script), "utf8").matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]);
      for (const name of imports) expect({ script, imports: name, declared: declared.includes(name) }).toEqual({ script, imports: name, declared: true });
    }
  });

  it("maps both keys to the environment the scripts read, and documents the optional fal key", () => {
    expect(manifest.skill.envMapping).toEqual({ OPENROUTER_API_KEY: "openrouterApiKey", FAL_KEY: "falApiKey" });
    const params = manifest.init!.params!;
    expect(params.map((p) => p.name)).toEqual(["openrouterApiKey", "falApiKey"]);
    const fal = params.find((p) => p.name === "falApiKey")!;
    expect(fal).toMatchObject({ type: "string", defaultValue: "", sensitive: true });
    expect(fal.description).toContain("SVG");
  });

  it("shows the agent how to run every script it may call, and records the version", () => {
    for (const name of (manifest.skill.sharedScripts ?? []).filter((n) => n !== "fal-queue.mjs")) {
      expect({ name, shown: skillText.includes(`"<SKILL_DIR>/scripts/${name}"`) }).toEqual({ name, shown: true });
    }
    expect(manifest.version).toBe("0.3.1");
    expect(manifest.changelog?.[manifest.version]?.length).toBeGreaterThan(0);
  });
});
