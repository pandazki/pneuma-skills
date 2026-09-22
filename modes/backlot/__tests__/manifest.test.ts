/**
 * The manifest and the three registration surfaces.
 *
 * Each one fails differently and quietly when it is missed (shape adapted
 * from `modes/lucid/__tests__/registration.test.ts`):
 *
 *  - `core/mode-loader.ts` — miss it and the mode is "Unknown mode";
 *  - `server/index.ts::builtinNames` — miss it and `bun run dev backlot` still
 *    works, so nothing looks broken, but the launcher gallery never shows it;
 *  - the mode catalogs in both READMEs — miss it and the mode exists but
 *    nobody reading the project can find it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import backlotManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

/** Total bytes of every file under `dir` — what npm packs, not disk blocks. */
function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(path) : statSync(path).size;
  }
  return total;
}

const MODE_NAME = "backlot";

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
    expect(manifest.skill?.installName).toBe(backlotManifest.skill.installName);
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
    expect(backlotManifest.hidden).toBeUndefined();
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
    expect(backlotManifest.inspiredBy).toEqual({
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
    const notice = read("modes/backlot/NOTICE.md");
    expect(notice).toContain("8dbcdc4b7d1f1d8b701e8de6e9258b63d63a5afb");
    expect(notice).toContain("MIT");
  });
});

describe("the manifest carries no React", () => {
  test("`manifest.ts` imports nothing from react or a viewer component", () => {
    // manifest.ts is read by the Bun backend, which has no React. The split
    // from pneuma-mode.ts exists exactly so this stays true.
    const source = read("modes/backlot/manifest.ts");
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\/viewer\//);
  });
});

describe("identity", () => {
  test("the version and its changelog land together", () => {
    expect(backlotManifest.version).toBe("0.1.0");
    const entry = backlotManifest.changelog?.["0.1.0"];
    expect(entry?.length ?? 0).toBeGreaterThan(5);
    // Changelog bullets are user-facing one-liners, not markdown.
    for (const bullet of entry!) expect(bullet).not.toMatch(/^[-*#]|`[a-z]+\.ts`/);
  });

  test("the display name is localized in all three locales", () => {
    expect(backlotManifest.displayName).toEqual({ en: "Backlot", "zh-CN": "片场", ja: "バックロット" });
  });

  test("the description is localized and the Chinese is real Chinese", () => {
    const description = backlotManifest.description as Record<string, string>;
    for (const locale of ["en", "zh-CN", "ja"]) expect(description[locale]).toBeTruthy();
    expect((description["zh-CN"].match(/[一-鿿]/g) ?? []).length).toBeGreaterThan(30);
  });

  test("the icon is inline SVG with no emoji", () => {
    expect(backlotManifest.icon).toMatch(/^<svg /);
    expect(backlotManifest.icon).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the skill install surface", () => {
  test("both backends are declared — nothing here needs a model-side tool", () => {
    expect(backlotManifest.supportedBackends).toEqual(["claude-code", "codex"]);
  });

  test("the reasoning effort is the level the work was accepted at", () => {
    // Blocking is judgement, but the acceptance baseline is Codex GPT-6 Astra
    // at medium and blind trials 2 and 3 passed there. Asking for more than
    // the level the mode was accepted at buys latency, not judgement.
    expect(backlotManifest.agent?.reasoningEffort).toBe("medium");
    expect(backlotManifest.agent?.permissionMode).toBe("bypassPermissions");
    expect(backlotManifest.agent?.greeting).toContain("<system-info");
  });

  test("all three external tools are mapped to the env vars the scripts read", () => {
    // fal buys the takes, the voices and the transcripts; OpenRouter buys
    // the bible frames, the board frames and the music.
    expect(backlotManifest.skill.envMapping).toEqual({
      BLENDER_PATH: "blenderPath",
      FAL_KEY: "falApiKey",
      OPENROUTER_API_KEY: "openrouterApiKey",
    });
    const params = backlotManifest.init!.params!;
    // Both keys buy inference and are cleared from snapshots; a Blender path
    // is a local filename and marking it sensitive would hide the one value
    // a user most often needs to check.
    expect(params.find((p) => p.name === "falApiKey")?.sensitive).toBe(true);
    expect(params.find((p) => p.name === "openrouterApiKey")?.sensitive).toBe(true);
    expect(params.find((p) => p.name === "blenderPath")?.sensitive).toBeUndefined();
    // Every mapped env var has a param to fill it, or the installer writes
    // an .env line with nothing in it.
    for (const param of Object.values(backlotManifest.skill.envMapping!)) {
      expect(params.some((p) => p.name === param)).toBe(true);
    }
  });

  test("every shared script the mode runs is whitelisted, transport and adapters included", () => {
    // `sharedScripts` is a whitelist and it is transitive: seedance-video.mjs
    // drives fal through fal-queue.mjs and edit_image.mjs imports
    // generate_image.mjs, so both have to be listed even though the agent
    // never invokes them directly. A missing entry dies on its first import
    // line, in the user's session, with ERR_MODULE_NOT_FOUND.
    expect(backlotManifest.skill.sharedScripts).toEqual([
      "seedance-video.mjs",
      "fal-queue.mjs",
      "generate_image.mjs",
      "edit_image.mjs",
      "generate-tts.mjs",
      "generate-bgm.mjs",
      "transcribe.mjs",
    ]);
    for (const script of backlotManifest.skill.sharedScripts!) {
      expect(existsSync(join(REPO_ROOT, "modes/_shared/scripts", script))).toBe(true);
    }
    // The three the SCRIPTS spawn by name: a rename upstream would leave the
    // gate answering for a command that can no longer run.
    for (const spawned of ["generate-tts.mjs", "generate-bgm.mjs", "transcribe.mjs"]) {
      expect(backlotManifest.skill.sharedScripts).toContain(spawned);
      expect(read("modes/backlot/skill/scripts/backlot.mjs") + read("modes/backlot/skill/scripts/previz.mjs")).toContain(spawned);
    }
  });

  test("deriveParams gates the skill's conditional blocks on each key", () => {
    // `videoDisabled` is the complement of `videoEnabled`, not a second
    // opinion: the template engine has no inverted section, so the "that
    // stage is closed, tell the user why" paragraph needs its own truthy key.
    const derive = backlotManifest.init!.deriveParams!;
    expect(derive({ falApiKey: "k" })).toMatchObject({ videoEnabled: "true", videoDisabled: "" });
    expect(derive({ falApiKey: "" })).toMatchObject({ videoEnabled: "", videoDisabled: "true" });
    expect(derive({ openrouterApiKey: "k" })).toMatchObject({ imagesEnabled: "true", imagesDisabled: "" });
    expect(derive({ openrouterApiKey: "" })).toMatchObject({ imagesEnabled: "", imagesDisabled: "true" });
    expect(derive({ blenderPath: "/x" }).blenderConfigured).toBe("true");
  });
});

describe("the viewer surface", () => {
  test("the workspace model is the brief's", () => {
    expect(backlotManifest.viewerApi?.workspace).toMatchObject({
      type: "manifest",
      multiFile: true,
      ordered: true,
      manifestFile: "backlot.json",
      supportsContentSets: true,
      // The shots rail is the navigation; a TopBar selector would be a
      // second, stage-blind copy of it.
      topBarNavigation: false,
    });
  });

  test("the two declared actions are the ones the skill will name", () => {
    const actions = backlotManifest.viewerApi!.actions!;
    expect(actions.map((a) => a.id)).toEqual(["navigate-to", "get-player-state"]);
    for (const action of actions) {
      expect(action.agentInvocable).toBe(true);
      expect((action.description ?? "").length).toBeGreaterThan(120);
    }
    expect(actions[0].params?.address?.required).toBe(true);
  });

  test("the three user commands are declared with one-line hints", () => {
    const commands = backlotManifest.viewerApi!.commands!;
    // `approve-stage` is the stage rail's button, and it is a COMMAND TO THE
    // AGENT: the viewer writes nothing, the agent runs `backlot.mjs approve`
    // and the approval is recorded with the hash of what was seen.
    expect(commands.map((c) => c.id)).toEqual(["approve-stage", "check-greybox", "generate-take"]);
    expect(commands[0].label).toBe("Approve this stage");
    for (const command of commands) {
      // The description is the hover hint the USER reads — never a script,
      // a flag or a file name.
      expect(command.description).toBeTruthy();
      expect(command.description).not.toMatch(/previz\.mjs|backlot\.mjs|--|\.json/);
    }
  });

  test("every watch pattern ends in a literal extension", () => {
    // `server/file-watcher.ts::extractWatchExtensions` derives its file-type
    // allowlist from these globs; a directory pattern contributes NOTHING and
    // the viewer silently stops updating.
    for (const pattern of backlotManifest.viewer.watchPatterns) {
      expect(pattern).toMatch(/\.[a-z0-9]+$/);
    }
  });

  test("no media extension is watched — /api/files would ship the bytes", () => {
    // Measured 2026-09-20 on the fixture workspace: adding the contact-sheet
    // PNGs made `GET /api/files` 4.1 MB of mangled binary against 10.6 KB
    // without them, and `.mp4`/`.glb` would be far worse. The media's change
    // signal is `greybox.revision` inside `shot.json`, which IS watched.
    const extensions = new Set(
      backlotManifest.viewer.watchPatterns.map((p) => p.slice(p.lastIndexOf("."))),
    );
    expect([...extensions].sort()).toEqual([".json", ".md"]);
  });

  test("the sources are the three the viewer reads", () => {
    const sources = backlotManifest.sources!;
    expect(Object.keys(sources).sort()).toEqual(["docs", "film", "metas"]);
    expect(sources.film.kind).toBe("aggregate-file");
    expect(sources.docs.kind).toBe("file-glob");
  });
});

describe("the seed and the evolution directive", () => {
  test("the declared seed points at a directory that exists", () => {
    const seedFiles = backlotManifest.init!.seedFiles!;
    expect(seedFiles).toEqual({ "modes/backlot/seed/one-inch-of-wind/": "one-inch-of-wind/" });
    expect(existsSync(join(REPO_ROOT, "modes/backlot/seed/one-inch-of-wind"))).toBe(true);
  });

  test("the seed card names the same key and ships its thumbnail", () => {
    const seed = backlotManifest.init!.seeds![0];
    expect(seed.sourceKey).toBe("modes/backlot/seed/one-inch-of-wind/");
    expect(seed.id).toBe("one-inch-of-wind");
    expect((seed.displayName as Record<string, string>)["zh-CN"]).toBeTruthy();
    // The gallery serves `seed-gallery/<thumbnail>` straight off disk, so a
    // renamed seed with a stale thumbnail is a 404 on the card and nothing
    // else reports it.
    expect(
      existsSync(join(REPO_ROOT, "modes/backlot/seed-gallery", seed.thumbnail!)),
    ).toBe(true);
  });

  test("the seed is a film that reached the cut, and it fits in the package", () => {
    const root = join(REPO_ROOT, "modes/backlot/seed/one-inch-of-wind");
    // Every stage of the flow has to be openable from the seed, or the mode's
    // own example teaches half a workflow.
    for (const path of [
      "backlot.json",
      "idea.md",
      "screenplay.md",
      "bible/characters/keeper/character.json",
      "bible/sets/courtyard/set.json",
      "shots/s03-orbit/shot.json",
      "shots/s03-orbit/greybox/greybox.mp4",
      "shots/s03-orbit/greybox/scene.glb",
      "shots/s03-orbit/takes/take-01.mp4",
      "sound/sound.json",
      "sound/music.mp3",
      "cut/edl.json",
      "cut/final.mp4",
    ]) {
      expect(existsSync(join(root, path))).toBe(true);
    }
    // A seed is shipped in the npm package, which has hit the registry's
    // payload limit before; the film was slimmed to 17 MB to fit and this is
    // the line that says so out loud (see the `seedFiles` comment).
    expect(dirBytes(root)).toBeLessThan(18 * 1024 * 1024);
  });

  test("a content check pattern exists so the gallery knows an empty workspace", () => {
    expect(backlotManifest.init!.contentCheckPattern).toBe("**/backlot.json");
  });

  test("the evolution directive names what to learn", () => {
    const directive = backlotManifest.evolution!.directive;
    for (const word of ["duration", "camera", "acceptance", "spend"]) {
      expect(directive).toContain(word);
    }
  });
});
