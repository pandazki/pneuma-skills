/**
 * `primerLibraries` end to end: manifest declaration → launch-time discovery →
 * the clicks a user makes → the bytes in `config.json` → what the scripts read
 * back out of them.
 *
 * The parameter used to be a free-text box you had to type `all` into. It is
 * now a set of chips, and the whole point of the change is that **nothing
 * downstream noticed**: `session.ts::primerSelection` parses the same three
 * shapes (`all` / `bundled` / a comma-separated list) it always did, and
 * `primerLibs` resolves them to the same directories. That equivalence is what
 * these tests pin — the control changed, the wire format did not.
 *
 * Every library here is built in a temp dir with an invented name. Nothing in
 * this file names, reads, or depends on a real user library.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InitParam } from "../../../core/types/mode-manifest.js";
import { resolveInitParamOptions } from "../../../core/init-param-resolver.js";
import {
  parseInitParamSelection,
  serializeInitParamSelection,
  toggleInitParamSelection,
} from "../../../core/init-param-options.js";
import wordtasteManifest from "../manifest.js";
import { primerLibs, primerSelection, scriptsDir } from "../skill/scripts/lib/session.js";

const BUNDLED = join(scriptsDir, "..", "references", "primer");

let root: string;
let home: string;
let project: string;
let session: string;
let savedEnv: Record<string, string | undefined>;

const param = (): InitParam => {
  const found = wordtasteManifest.init?.params?.find((p) => p.name === "primerLibraries");
  if (!found) throw new Error("wordtaste no longer declares primerLibraries");
  return found;
};

/** A throwaway library with an invented name. */
function makeLibrary(under: string, name: string, marker: Record<string, unknown>): string {
  const dir = join(under, ".pneuma", "primers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "library.json"), JSON.stringify(marker));
  return dir;
}

/** Persist a resolved init param exactly as `saveConfig` does, then read it back. */
function storeAndRead(value: string): { selection: string; libs: string[] } {
  writeFileSync(join(session, "config.json"), JSON.stringify({ primerLibraries: value }, null, 2));
  return { selection: primerSelection(session), libs: primerLibs(session).split(":") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wordtaste-primer-param-"));
  home = join(root, "home");
  project = join(root, "project");
  session = join(root, "session");
  for (const dir of [home, project, session]) mkdirSync(dir, { recursive: true });
  savedEnv = {
    HOME: process.env.HOME,
    PNEUMA_PROJECT_ROOT: process.env.PNEUMA_PROJECT_ROOT,
    WORDTASTE_PRIMER_LIBS: process.env.WORDTASTE_PRIMER_LIBS,
  };
  process.env.HOME = home;
  delete process.env.PNEUMA_PROJECT_ROOT;
  delete process.env.WORDTASTE_PRIMER_LIBS;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("primerLibraries declaration", () => {
  it("is a set of choices, not a box you type a magic word into", () => {
    expect(param().type).toBe("multi-select");
    expect(param().defaultValue).toBe("all");
  });

  it("declares both presets as exclusive — a preset stands alone by definition", () => {
    const options = param().options ?? [];
    expect(options).toEqual([
      expect.objectContaining({ value: "all", exclusive: true, group: "Presets" }),
      expect.objectContaining({ value: "bundled", exclusive: true, group: "Presets" }),
    ]);
  });

  it("looks for libraries in exactly the two roots the sampler reads at dispatch time", () => {
    // Drift here is invisible until a user picks a library the scripts never
    // look for, so the manifest's roots are pinned against session.ts's.
    expect(param().optionsSource).toEqual({
      kind: "directory-scan",
      roots: ["user-home", "project-root"],
      path: ".pneuma/primers",
      markerFile: "library.json",
      group: "Your libraries",
    });
  });
});

describe("what the launch sheet offers", () => {
  it("presets first, then this machine's libraries under their own display names", () => {
    makeLibrary(home, "zircon-notes", {
      name: "zircon-notes",
      displayName: "Zircon Notes",
      description: "Notebook prose",
    });
    makeLibrary(home, "marigold-essays", { name: "marigold-essays" });

    const options = resolveInitParamOptions(param(), { homeDir: home });
    expect(options.map((o) => o.value)).toEqual([
      "all",
      "bundled",
      "marigold-essays",
      "zircon-notes",
    ]);
    expect(options.at(-1)).toEqual({
      value: "zircon-notes",
      label: "Zircon Notes",
      description: "Notebook prose",
      group: "Your libraries",
    });
  });

  it("adds the project's own libraries for a project session", () => {
    makeLibrary(home, "personal-lib", { name: "personal-lib" });
    makeLibrary(project, "team-lib", { displayName: "Team Library" });
    const options = resolveInitParamOptions(param(), { homeDir: home, projectRoot: project });
    expect(options.map((o) => o.value)).toEqual(["all", "bundled", "personal-lib", "team-lib"]);
  });

  it("offers the presets alone on a machine with no libraries at all", () => {
    expect(resolveInitParamOptions(param(), { homeDir: home }).map((o) => o.value)).toEqual([
      "all",
      "bundled",
    ]);
  });
});

describe("the stored value is byte-for-byte what it always was", () => {
  it("the untouched default is still the single word `all`", () => {
    // Before this change the box was pre-filled with "all" and the user had to
    // leave it alone. After it, the default chip is lit. Same three bytes.
    expect(serializeInitParamSelection(parseInitParamSelection(param().defaultValue))).toBe("all");
  });

  it("`all` reads back as every library on this machine, presets included", () => {
    const a = makeLibrary(home, "amber-lib", { name: "amber-lib" });
    const b = makeLibrary(home, "basalt-lib", { name: "basalt-lib" });
    const { selection, libs } = storeAndRead("all");
    expect(selection).toBe("all");
    expect(libs).toEqual([BUNDLED, a, b]);
  });

  it("clicking `Bundled only` stores `bundled`, and the sampler reads just the bundled set", () => {
    makeLibrary(home, "amber-lib", { name: "amber-lib" });
    const options = resolveInitParamOptions(param(), { homeDir: home });
    const stored = serializeInitParamSelection(
      toggleInitParamSelection(options, parseInitParamSelection("all"), "bundled"),
    );
    expect(stored).toBe("bundled");
    expect(storeAndRead(stored)).toEqual({ selection: "bundled", libs: [BUNDLED] });
  });

  it("clicking two libraries stores `a,b` — the comma-separated list session.ts parses", () => {
    const amber = makeLibrary(home, "amber-lib", { name: "amber-lib" });
    const basalt = makeLibrary(home, "basalt-lib", { name: "basalt-lib" });
    makeLibrary(home, "cobalt-lib", { name: "cobalt-lib" });

    const options = resolveInitParamOptions(param(), { homeDir: home });
    let selection = parseInitParamSelection(param().defaultValue);
    selection = toggleInitParamSelection(options, selection, "basalt-lib");
    selection = toggleInitParamSelection(options, selection, "amber-lib");
    const stored = serializeInitParamSelection(selection);

    // Declared order, not click order — the same set always writes the same bytes.
    expect(stored).toBe("amber-lib,basalt-lib");
    expect(stored).not.toContain(" ");
    expect(storeAndRead(stored)).toEqual({
      selection: "amber-lib,basalt-lib",
      libs: [BUNDLED, amber, basalt],
    });
  });

  it("a single library stores its bare name, exactly as typing it did", () => {
    const amber = makeLibrary(home, "amber-lib", { name: "amber-lib" });
    const options = resolveInitParamOptions(param(), { homeDir: home });
    const stored = serializeInitParamSelection(
      toggleInitParamSelection(options, parseInitParamSelection("all"), "amber-lib"),
    );
    expect(stored).toBe("amber-lib");
    expect(storeAndRead(stored).libs).toEqual([BUNDLED, amber]);
  });

  it("a project library selected by name resolves under the project root", () => {
    process.env.PNEUMA_PROJECT_ROOT = project;
    const team = makeLibrary(project, "team-lib", { displayName: "Team Library" });
    const options = resolveInitParamOptions(param(), { homeDir: home, projectRoot: project });
    const stored = serializeInitParamSelection(
      toggleInitParamSelection(options, parseInitParamSelection("all"), "team-lib"),
    );
    expect(stored).toBe("team-lib");
    expect(storeAndRead(stored).libs).toEqual([BUNDLED, team]);
  });

  it("every value the control can produce is one session.ts already understood", () => {
    // The three shapes in `primerSelection`'s contract, and nothing else: no
    // JSON array, no bracket syntax, no separator the parser would keep as
    // part of a library name.
    const amber = makeLibrary(home, "amber-lib", { name: "amber-lib" });
    const basalt = makeLibrary(home, "basalt-lib", { name: "basalt-lib" });
    const options = resolveInitParamOptions(param(), { homeDir: home });
    const reachable = new Set<string>();
    for (const first of options) {
      let selection = toggleInitParamSelection(options, parseInitParamSelection("all"), first.value);
      reachable.add(serializeInitParamSelection(selection));
      for (const second of options) {
        selection = toggleInitParamSelection(options, selection, second.value);
        reachable.add(serializeInitParamSelection(selection));
      }
    }
    expect([...reachable].sort()).toEqual([
      "all",
      "amber-lib",
      "amber-lib,basalt-lib",
      "basalt-lib",
      "bundled",
    ]);
    for (const value of reachable) {
      const { selection, libs } = storeAndRead(value);
      expect(selection).toBe(value);
      expect(libs[0]).toBe(BUNDLED); // the bundled set always leads
      expect(libs.every((dir) => dir === BUNDLED || dir === amber || dir === basalt)).toBe(true);
    }
  });
});
