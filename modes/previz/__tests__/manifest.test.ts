/**
 * The manifest and the three registration surfaces.
 *
 * Each one fails differently and quietly when it is missed (shape adapted
 * from `modes/lucid/__tests__/registration.test.ts`):
 *
 *  - `core/mode-loader.ts` — miss it and the mode is "Unknown mode";
 *  - `server/index.ts::builtinNames` — miss it and `bun run dev previz` still
 *    works, so nothing looks broken, but the launcher gallery never shows it;
 *  - the mode catalogs in both READMEs — miss it and the mode exists but
 *    nobody reading the project can find it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import previzManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const MODE_NAME = "previz";

describe("registration 1/3 — the frontend dynamic-import registry", () => {
  test("`core/mode-loader.ts` knows the mode by name", () => {
    expect(listBuiltinModes()).toContain(MODE_NAME);
  });

  test("the manifest it resolves to is this mode's own", async () => {
    // Not a tautology: the loader entry is two hand-written import paths, and
    // a copy-paste pointing at the wrong mode would still list the right name.
    const { loadModeManifest } = await import("../../../core/mode-loader.js");
    const manifest = await loadModeManifest(MODE_NAME);
    expect(manifest.name).toBe(MODE_NAME);
    expect(manifest.skill?.installName).toBe(previzManifest.skill.installName);
  });
});

describe("registration 2/3 — the launcher gallery registry", () => {
  const serverSource = read("server/index.ts");

  test("the mode is in builtinNames — the omission that leaves a gallery empty", () => {
    const literal = serverSource.match(/const builtinNames = \[([^\]]*)\];/)![1];
    const names = literal
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(names).toContain(MODE_NAME);
  });

  test("the mode is not otherwise hardcoded into server or CLI logic", () => {
    // `server/` and `bin/` are ModeManifest-driven. The gallery registry array
    // is the one sanctioned mention of the name; anything else quoting it is a
    // branch on mode identity.
    const quoted = `"${MODE_NAME}"`;
    const offenders: string[] = [];
    for (const dir of ["server", "bin"]) {
      const files = readdirSync(join(REPO_ROOT, dir), { recursive: true, encoding: "utf-8" });
      for (const file of files) {
        if (!file.endsWith(".ts") || file.includes("__tests__")) continue;
        const rel = `${dir}/${file}`;
        for (const [i, line] of read(rel).split("\n").entries()) {
          if (!line.includes(quoted)) continue;
          if (line.includes("const builtinNames = [")) continue;
          offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the mode is NOT on a cloud surface — 0.1 ships no hosted player", () => {
    // The viewer would work from files alone but has never been run in a
    // player build, and claiming a surface that has not been exercised is
    // exactly the "silent success" the brief's invariant 8 forbids.
    expect(read("core/player-support.ts")).not.toContain(`"${MODE_NAME}"`);
  });

  test("the gallery will show it — the manifest is not hidden", () => {
    expect(previzManifest.hidden).toBeUndefined();
  });
});

describe("registration 3/3 — the docs", () => {
  test("`CLAUDE.md` stays the one-line import — content there is the bug", () => {
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  test("both READMEs carry a Built-in Modes row, not just the English one", () => {
    for (const rel of ["README.md", "README.zh.md"]) {
      const row = read(rel)
        .split("\n")
        .find((l) => l.startsWith(`| **${MODE_NAME}**`));
      expect(row ?? `${rel}: no row`).toContain(`| **${MODE_NAME}**`);
      expect((row ?? "").length).toBeGreaterThan(80);
    }
  });

  test("the zh row is written in Chinese, not the English row pasted over", () => {
    const row = read("README.zh.md")
      .split("\n")
      .find((l) => l.startsWith(`| **${MODE_NAME}**`))!;
    const han = row.match(/[一-鿿]/g) ?? [];
    expect(han.length).toBeGreaterThan(20);
  });

  test("both CLI usage blocks list it among the modes", () => {
    for (const rel of ["README.md", "README.zh.md"]) {
      const chunks = read(rel).split("```");
      const usage = chunks[chunks.findIndex((c) => c.includes("\nModes:\n"))];
      expect(usage).toBeDefined();
      const line = usage.split("\n").find((l) => l.trimStart().startsWith(`${MODE_NAME} `));
      expect(line ?? `${rel}: not in CLI usage`).toContain(MODE_NAME);
    }
  });

  test("upstream is credited where a reader will see it", () => {
    expect(previzManifest.inspiredBy).toEqual({
      name: "modengsir/blender-video-workflows",
      url: "https://github.com/modengsir/blender-video-workflows",
    });
    for (const rel of ["README.md", "README.zh.md"]) {
      const row = read(rel)
        .split("\n")
        .find((l) => l.startsWith(`| **${MODE_NAME}**`))!;
      expect(row).toContain("modengsir/blender-video-workflows");
    }
  });

  test("NOTICE.md pins the upstream commit that was actually read", () => {
    const notice = read("modes/previz/NOTICE.md");
    expect(notice).toContain("8dbcdc4b7d1f1d8b701e8de6e9258b63d63a5afb");
    expect(notice).toContain("MIT");
  });
});

describe("the manifest carries no React", () => {
  test("`manifest.ts` imports nothing from react or a viewer component", () => {
    // manifest.ts is read by the Bun backend, which has no React. The split
    // from pneuma-mode.ts exists exactly so this stays true.
    const source = read("modes/previz/manifest.ts");
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\/viewer\//);
  });
});

describe("identity", () => {
  test("the version and its changelog land together", () => {
    expect(previzManifest.version).toBe("0.1.0");
    const entry = previzManifest.changelog?.["0.1.0"];
    expect(entry?.length ?? 0).toBeGreaterThan(5);
    // Changelog bullets are user-facing one-liners, not markdown.
    for (const bullet of entry!) expect(bullet).not.toMatch(/^[-*#]|`[a-z]+\.ts`/);
  });

  test("the display name is localized in all three locales", () => {
    expect(previzManifest.displayName).toEqual({ en: "Previz", "zh-CN": "预演", ja: "プリビズ" });
  });

  test("the description is localized and the Chinese is real Chinese", () => {
    const description = previzManifest.description as Record<string, string>;
    for (const locale of ["en", "zh-CN", "ja"]) expect(description[locale]).toBeTruthy();
    expect((description["zh-CN"].match(/[一-鿿]/g) ?? []).length).toBeGreaterThan(30);
  });

  test("the icon is inline SVG with no emoji", () => {
    expect(previzManifest.icon).toMatch(/^<svg /);
    expect(previzManifest.icon).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the skill install surface", () => {
  test("both backends are declared — nothing here needs a model-side tool", () => {
    expect(previzManifest.supportedBackends).toEqual(["claude-code", "codex"]);
  });

  test("blocking is judgement, so the mode asks for high reasoning effort", () => {
    expect(previzManifest.agent?.reasoningEffort).toBe("high");
    expect(previzManifest.agent?.permissionMode).toBe("bypassPermissions");
    expect(previzManifest.agent?.greeting).toContain("<system-info");
  });

  test("both external tools are mapped to the env vars the scripts read", () => {
    expect(previzManifest.skill.envMapping).toEqual({
      BLENDER_PATH: "blenderPath",
      FAL_KEY: "falApiKey",
    });
    const params = previzManifest.init!.params!;
    // The fal key buys inference and is cleared from snapshots; a Blender
    // path is a local filename and marking it sensitive would hide the one
    // value a user most often needs to check.
    expect(params.find((p) => p.name === "falApiKey")?.sensitive).toBe(true);
    expect(params.find((p) => p.name === "blenderPath")?.sensitive).toBeUndefined();
  });

  test("the shared video scripts are whitelisted, transport included", () => {
    // `sharedScripts` is a whitelist and it is transitive: seedance-video.mjs
    // drives fal through fal-queue.mjs, so the transport has to be listed even
    // though the agent never invokes it directly. A missing entry dies on its
    // first import line, in the user's session, with ERR_MODULE_NOT_FOUND.
    expect(previzManifest.skill.sharedScripts).toEqual(["seedance-video.mjs", "fal-queue.mjs"]);
    for (const script of previzManifest.skill.sharedScripts!) {
      expect(existsSync(join(REPO_ROOT, "modes/_shared/scripts", script))).toBe(true);
    }
  });

  test("deriveParams gates the skill's conditional blocks on the fal key", () => {
    // `videoDisabled` is the complement of `videoEnabled`, not a second
    // opinion: the template engine has no inverted section, so the "that
    // stage is closed, tell the user why" paragraph needs its own truthy key.
    const derive = previzManifest.init!.deriveParams!;
    expect(derive({ falApiKey: "k" })).toMatchObject({ videoEnabled: "true", videoDisabled: "" });
    expect(derive({ falApiKey: "" })).toMatchObject({ videoEnabled: "", videoDisabled: "true" });
    expect(derive({ blenderPath: "/x" }).blenderConfigured).toBe("true");
  });
});

describe("the viewer surface", () => {
  test("the workspace model is the brief's", () => {
    expect(previzManifest.viewerApi?.workspace).toMatchObject({
      type: "manifest",
      multiFile: true,
      ordered: true,
      manifestFile: "previz.json",
      supportsContentSets: true,
      // The shots rail is the navigation; a TopBar selector would be a
      // second, stage-blind copy of it.
      topBarNavigation: false,
    });
  });

  test("the two declared actions are the ones the skill will name", () => {
    const actions = previzManifest.viewerApi!.actions!;
    expect(actions.map((a) => a.id)).toEqual(["navigate-to", "get-player-state"]);
    for (const action of actions) {
      expect(action.agentInvocable).toBe(true);
      expect((action.description ?? "").length).toBeGreaterThan(120);
    }
    expect(actions[0].params?.address?.required).toBe(true);
  });

  test("the two user commands are declared with one-line hints", () => {
    const commands = previzManifest.viewerApi!.commands!;
    expect(commands.map((c) => c.id)).toEqual(["check-greybox", "generate-take"]);
    for (const command of commands) {
      // The description is the hover hint the USER reads — never a script,
      // a flag or a file name.
      expect(command.description).toBeTruthy();
      expect(command.description).not.toMatch(/previz\.mjs|--|\.json/);
    }
  });

  test("every watch pattern ends in a literal extension", () => {
    // `server/file-watcher.ts::extractWatchExtensions` derives its file-type
    // allowlist from these globs; a directory pattern contributes NOTHING and
    // the viewer silently stops updating.
    for (const pattern of previzManifest.viewer.watchPatterns) {
      expect(pattern).toMatch(/\.[a-z0-9]+$/);
    }
  });

  test("no media extension is watched — /api/files would ship the bytes", () => {
    // Measured 2026-09-20 on the fixture workspace: adding the contact-sheet
    // PNGs made `GET /api/files` 4.1 MB of mangled binary against 10.6 KB
    // without them, and `.mp4`/`.glb` would be far worse. The media's change
    // signal is `greybox.revision` inside `shot.json`, which IS watched.
    const extensions = new Set(
      previzManifest.viewer.watchPatterns.map((p) => p.slice(p.lastIndexOf("."))),
    );
    expect([...extensions].sort()).toEqual([".json", ".md"]);
  });

  test("the sources are the three the viewer reads", () => {
    const sources = previzManifest.sources!;
    expect(Object.keys(sources).sort()).toEqual(["docs", "film", "metas"]);
    expect(sources.film.kind).toBe("aggregate-file");
    expect(sources.docs.kind).toBe("file-glob");
  });
});

describe("the seed and the evolution directive", () => {
  test("the declared seed points at a directory that exists", () => {
    const seedFiles = previzManifest.init!.seedFiles!;
    expect(seedFiles).toEqual({ "modes/previz/seed/first-light/": "first-light/" });
    expect(existsSync(join(REPO_ROOT, "modes/previz/seed/first-light"))).toBe(true);
  });

  test("the seed card names the same key", () => {
    const seed = previzManifest.init!.seeds![0];
    expect(seed.sourceKey).toBe("modes/previz/seed/first-light/");
    expect(seed.id).toBe("first-light");
    expect((seed.displayName as Record<string, string>)["zh-CN"]).toBeTruthy();
  });

  test("a content check pattern exists so the gallery knows an empty workspace", () => {
    expect(previzManifest.init!.contentCheckPattern).toBe("**/previz.json");
  });

  test("the evolution directive names what to learn", () => {
    const directive = previzManifest.evolution!.directive;
    for (const word of ["duration", "camera", "acceptance", "spend"]) {
      expect(directive).toContain(word);
    }
  });
});
