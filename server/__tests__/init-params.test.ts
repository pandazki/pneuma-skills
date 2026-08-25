/**
 * `/api/launch/prepare`'s enrichment seam.
 *
 * Both prepare routes (launcher-scope and per-session) used to carry their own
 * copy of the API-key auto-fill block; they now share `prepareInitParams`, and
 * launch-time option resolution rides the same call. What is pinned here is
 * that the two decorations compose without either eating the other, and that a
 * parameter which asked for neither comes back untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InitParam } from "../../core/types/mode-manifest.js";
import { matchStoredKey, prepareInitParams } from "../init-params.js";

let home: string;

function makeLibrary(name: string, marker: Record<string, unknown>): void {
  const dir = join(home, ".pneuma", "primers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "library.json"), JSON.stringify(marker));
}

const LIBRARIES: InitParam = {
  name: "primerLibraries",
  label: "Primer libraries",
  type: "multi-select",
  options: [
    { value: "all", label: "Everything", exclusive: true, group: "Presets" },
    { value: "bundled", label: "Bundled only", exclusive: true, group: "Presets" },
  ],
  optionsSource: {
    kind: "directory-scan",
    roots: ["user-home"],
    path: ".pneuma/primers",
    markerFile: "library.json",
    group: "Your libraries",
  },
  defaultValue: "all",
};

const API_KEY: InitParam = {
  name: "openrouterApiKey",
  label: "OpenRouter API Key",
  type: "string",
  defaultValue: "",
  sensitive: true,
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pneuma-prepare-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("matchStoredKey", () => {
  it("matches the exact name, and across the UPPER_SNAKE ↔ camelCase boundary", () => {
    expect(matchStoredKey({ openrouterApiKey: "exact" }, "openrouterApiKey")).toBe("exact");
    expect(matchStoredKey({ OPENROUTER_API_KEY: "snake" }, "openrouterApiKey")).toBe("snake");
    expect(matchStoredKey({ FAL_API_KEY: "other" }, "openrouterApiKey")).toBeNull();
  });
});

describe("prepareInitParams", () => {
  it("auto-fills a stored key with a masked preview, exactly as the routes did", () => {
    const [param] = prepareInitParams([API_KEY], {
      homeDir: home,
      storedKeys: { OPENROUTER_API_KEY: "sk-or-v1-1234567890abcdef" },
    });
    expect(param).toMatchObject({
      name: "openrouterApiKey",
      defaultValue: "sk-or-v1-1234567890abcdef",
      autoFilled: true,
      maskedPreview: "sk-o****cdef",
    });
  });

  it("leaves a param with no stored key and no options source alone", () => {
    const [param] = prepareInitParams([API_KEY], { homeDir: home, storedKeys: {} });
    expect(param).toBe(API_KEY);
  });

  it("resolves launch-time options onto the param the browser reads", () => {
    makeLibrary("topaz-notebook", { displayName: "Topaz Notebook", description: "Field notes" });
    const [param] = prepareInitParams([LIBRARIES], { homeDir: home, storedKeys: {} });
    expect(param!.options).toEqual([
      { value: "all", label: "Everything", exclusive: true, group: "Presets" },
      { value: "bundled", label: "Bundled only", exclusive: true, group: "Presets" },
      {
        value: "topaz-notebook",
        label: "Topaz Notebook",
        description: "Field notes",
        group: "Your libraries",
      },
    ]);
    expect(param!.defaultValue).toBe("all");
    expect((param as { autoFilled?: boolean }).autoFilled).toBeUndefined();
  });

  it("still opens the sheet when there is nothing to discover", () => {
    const [param] = prepareInitParams([LIBRARIES], { homeDir: home, storedKeys: {} });
    expect(param!.options).toHaveLength(2);
  });

  it("carries both decorations through one pass over a mixed param list", () => {
    makeLibrary("cobalt-letters", { displayName: "Cobalt Letters" });
    const prepared = prepareInitParams([LIBRARIES, API_KEY], {
      homeDir: home,
      storedKeys: { openrouterApiKey: "sk-or-v1-abcdefghijkl" },
    });
    expect(prepared[0]!.options?.map((o) => (typeof o === "string" ? o : o.value))).toEqual([
      "all",
      "bundled",
      "cobalt-letters",
    ]);
    expect(prepared[1]).toMatchObject({ autoFilled: true, defaultValue: "sk-or-v1-abcdefghijkl" });
  });

  it("accepts a mode with no init params at all", () => {
    expect(prepareInitParams(undefined, { storedKeys: {} })).toEqual([]);
  });
});
