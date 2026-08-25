/**
 * Launch-time option discovery.
 *
 * Everything here builds its own throwaway libraries in a temp directory with
 * invented names — no real user library is named, listed, or depended on.
 *
 * The behaviour that matters most is the *failure* behaviour: a launch sheet
 * must still open when the scanned directory is missing, unreadable, empty, or
 * full of things that are not libraries at all. Each of those is a test.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InitParam, InitParamOptionsSource } from "../types/mode-manifest.js";
import {
  discoverInitParamOptions,
  resolveInitParamOptions,
  withResolvedInitParamOptions,
} from "../init-param-resolver.js";

const SOURCE: InitParamOptionsSource = {
  kind: "directory-scan",
  roots: ["user-home", "project-root"],
  path: ".pneuma/primers",
  markerFile: "library.json",
  group: "Your libraries",
};

let root: string;
let home: string;
let project: string;

/** A throwaway library with an invented name. */
function makeLibrary(
  under: string,
  name: string,
  marker?: Record<string, unknown> | string,
): string {
  const dir = join(under, ".pneuma", "primers", name);
  mkdirSync(dir, { recursive: true });
  if (marker !== undefined) {
    writeFileSync(
      join(dir, "library.json"),
      typeof marker === "string" ? marker : JSON.stringify(marker),
    );
  }
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pneuma-init-param-"));
  home = join(root, "home");
  project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverInitParamOptions — directory-scan", () => {
  it("offers one option per declared library, labelled from its marker file", () => {
    makeLibrary(home, "quartz-notes", {
      name: "quartz-notes",
      displayName: "Quartz Notes",
      description: "Loose notebook prose",
    });
    makeLibrary(home, "amber-clippings", { name: "amber-clippings" });

    expect(discoverInitParamOptions(SOURCE, { homeDir: home })).toEqual([
      { value: "amber-clippings", label: "amber-clippings", group: "Your libraries" },
      {
        value: "quartz-notes",
        label: "Quartz Notes",
        description: "Loose notebook prose",
        group: "Your libraries",
      },
    ]);
  });

  it("falls back to the directory name when the marker names nothing", () => {
    makeLibrary(home, "unnamed-lib", {});
    expect(discoverInitParamOptions(SOURCE, { homeDir: home })).toEqual([
      { value: "unnamed-lib", group: "Your libraries" },
    ]);
  });

  it("still offers a library whose marker is unparseable — downstream only checks it exists", () => {
    makeLibrary(home, "broken-marker", "{ not json");
    expect(discoverInitParamOptions(SOURCE, { homeDir: home }).map((o) => o.value)).toEqual([
      "broken-marker",
    ]);
  });

  it("does not offer a directory that never declared itself a library", () => {
    makeLibrary(home, "undeclared");
    makeLibrary(home, "declared", { name: "declared" });
    expect(discoverInitParamOptions(SOURCE, { homeDir: home }).map((o) => o.value)).toEqual([
      "declared",
    ]);
  });

  it("scans the project root too, and the first root wins a name collision", () => {
    makeLibrary(home, "shared-name", { displayName: "From home" });
    makeLibrary(project, "shared-name", { displayName: "From project" });
    makeLibrary(project, "project-only", { displayName: "Project Only" });

    const options = discoverInitParamOptions(SOURCE, { homeDir: home, projectRoot: project });
    expect(options).toEqual([
      { value: "shared-name", label: "From home", group: "Your libraries" },
      { value: "project-only", label: "Project Only", group: "Your libraries" },
    ]);
  });

  it("skips the project root entirely for a quick session", () => {
    makeLibrary(project, "project-only", { name: "project-only" });
    expect(discoverInitParamOptions(SOURCE, { homeDir: home })).toEqual([]);
  });

  it("ignores files and dot-directories sitting beside the libraries", () => {
    const base = join(home, ".pneuma", "primers");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "README.md"), "not a library");
    mkdirSync(join(base, ".git"), { recursive: true });
    makeLibrary(home, "real-lib", { name: "real-lib" });
    expect(discoverInitParamOptions(SOURCE, { homeDir: home }).map((o) => o.value)).toEqual([
      "real-lib",
    ]);
  });

  it("follows a symlinked library, matching how a named lookup resolves it", () => {
    const target = join(root, "elsewhere");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "library.json"), JSON.stringify({ displayName: "Linked" }));
    mkdirSync(join(home, ".pneuma", "primers"), { recursive: true });
    symlinkSync(target, join(home, ".pneuma", "primers", "linked-lib"));
    expect(discoverInitParamOptions(SOURCE, { homeDir: home }).map((o) => o.value)).toEqual([
      "linked-lib",
    ]);
  });
});

describe("discoverInitParamOptions — failure yields no options, never a throw", () => {
  it("a missing primers directory is not an error", () => {
    expect(discoverInitParamOptions(SOURCE, { homeDir: home })).toEqual([]);
  });

  it("a missing home directory is not an error", () => {
    expect(discoverInitParamOptions(SOURCE, { homeDir: join(root, "nope") })).toEqual([]);
  });

  it("an unreadable primers directory is not an error", () => {
    const base = join(home, ".pneuma", "primers");
    mkdirSync(base, { recursive: true });
    chmodSync(base, 0o000);
    try {
      expect(discoverInitParamOptions(SOURCE, { homeDir: home })).toEqual([]);
    } finally {
      chmodSync(base, 0o755);
    }
  });

  it("refuses a traversal-shaped path instead of reading outside the root", () => {
    const escaping: InitParamOptionsSource = { ...SOURCE, path: "../../etc" };
    expect(discoverInitParamOptions(escaping, { homeDir: home })).toEqual([]);
    const absolute: InitParamOptionsSource = { ...SOURCE, path: "/etc" };
    expect(discoverInitParamOptions(absolute, { homeDir: home })).toEqual([]);
  });

  it("refuses an unknown source kind", () => {
    const unknown = { kind: "oracle", roots: ["user-home"], path: "x" } as unknown as InitParamOptionsSource;
    expect(discoverInitParamOptions(unknown, { homeDir: home })).toEqual([]);
  });
});

describe("resolveInitParamOptions", () => {
  const param: InitParam = {
    name: "primerLibraries",
    label: "Primer libraries",
    type: "multi-select",
    options: [
      { value: "all", label: "Everything", exclusive: true, group: "Presets" },
      { value: "bundled", label: "Bundled only", exclusive: true, group: "Presets" },
    ],
    optionsSource: SOURCE,
    defaultValue: "all",
  };

  it("keeps the declared presets first and appends what this machine has", () => {
    makeLibrary(home, "jade-essays", { displayName: "Jade Essays" });
    expect(resolveInitParamOptions(param, { homeDir: home }).map((o) => o.value)).toEqual([
      "all",
      "bundled",
      "jade-essays",
    ]);
  });

  it("degrades to the presets alone when nothing is discovered", () => {
    expect(resolveInitParamOptions(param, { homeDir: home }).map((o) => o.value)).toEqual([
      "all",
      "bundled",
    ]);
  });

  it("never lets a discovered directory shadow a declared preset", () => {
    makeLibrary(home, "all", { displayName: "A library literally called all" });
    const options = resolveInitParamOptions(param, { homeDir: home });
    expect(options.filter((o) => o.value === "all")).toEqual([
      { value: "all", label: "Everything", exclusive: true, group: "Presets" },
    ]);
  });

  it("leaves a parameter without an optionsSource exactly as declared", () => {
    const paperSize: InitParam = {
      name: "paperSize",
      label: "Paper size",
      type: "select",
      options: ["A4", "A5", "Letter"],
      defaultValue: "A4",
    };
    expect(resolveInitParamOptions(paperSize)).toEqual([
      { value: "A4" },
      { value: "A5" },
      { value: "Letter" },
    ]);
    // …and the untouched param object survives the list pass by identity, so
    // every existing declaration is provably unchanged on the wire.
    const [passedThrough] = withResolvedInitParamOptions([paperSize]);
    expect(passedThrough).toBe(paperSize);
  });

  it("replaces only the sourced parameter's options in a mixed list", () => {
    makeLibrary(home, "onyx-drafts", { displayName: "Onyx Drafts" });
    const apiKey: InitParam = {
      name: "openrouterApiKey",
      label: "OpenRouter API Key",
      type: "string",
      defaultValue: "",
      sensitive: true,
    };
    const [resolved, untouched] = withResolvedInitParamOptions([param, apiKey], { homeDir: home });
    expect(resolved!.options?.map((o) => (typeof o === "string" ? o : o.value))).toEqual([
      "all",
      "bundled",
      "onyx-drafts",
    ]);
    expect(untouched).toBe(apiKey);
  });
});
