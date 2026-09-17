/**
 * The mode is actually registered — and the evolution agent knows what to
 * learn from it.
 *
 * Registration has three surfaces read by different consumers, and each one
 * fails differently and quietly when it is missed (shape adapted from
 * `modes/sprite/__tests__/registration.test.ts`, which follows eli5, which
 * follows bansho, which paid for the lesson):
 *
 *  - `core/mode-loader.ts` — miss it and the mode is "Unknown mode";
 *  - `server/index.ts::builtinNames` — miss it and `bun run dev lucid` still
 *    works, so nothing looks broken, but the launcher gallery never shows it;
 *  - the mode catalogs in both READMEs — miss it and the mode exists but
 *    nobody reading the project can find it.
 *
 * NOT covered here yet, on purpose: the skill-markdown invariants (template
 * variables naming real params, the `node {SKILL_PATH}/scripts/` call form,
 * every indexed reference existing on disk). `skill/SKILL.md` is currently a
 * placeholder so a session can start at all; the agent that writes the real
 * skill owns those tests and adds them with the text they pin.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import lucidManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const MODE_NAME = "lucid";

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
    expect(manifest.skill?.installName).toBe(lucidManifest.skill.installName);
  });
});

describe("registration 2/3 — the launcher gallery registry", () => {
  const serverSource = read("server/index.ts");

  test("`server/index.ts` declares builtinNames as a flat literal array", () => {
    expect(serverSource).toMatch(/const builtinNames = \[[^\]]*\];/);
  });

  test("the mode is in it — the omission that leaves a gallery silently empty", () => {
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
      const files = readdirSync(join(REPO_ROOT, dir), {
        recursive: true,
        encoding: "utf-8",
      });
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

  test("the gallery will show it — the manifest is not hidden", () => {
    expect(lucidManifest.hidden).toBeUndefined();
  });
});

describe("registration 3/3 — the docs", () => {
  test("`CLAUDE.md` stays the one-line import — content there is the bug", () => {
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  test("both READMEs carry a Built-in Modes row, not just the English one", () => {
    // The project has shipped a zh README two months behind before; there is
    // no automation guarding it, so this is the guard.
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
      const line = usage
        .split("\n")
        .find((l) => l.trimStart().startsWith(`${MODE_NAME} `));
      expect(line ?? `${rel}: not in CLI usage`).toContain(MODE_NAME);
    }
  });

  test("upstream is credited where a reader will see it", () => {
    // The mode is a port; `inspiredBy` is the manifest's credit and the
    // README row is the human-readable one. Renaming the mode away from
    // "dream-loop" makes losing the attribution easier, not harder.
    expect(lucidManifest.inspiredBy).toEqual({
      name: "achimala/dream-loop",
      url: "https://github.com/achimala/dream-loop",
    });
    for (const rel of ["README.md", "README.zh.md"]) {
      const row = read(rel)
        .split("\n")
        .find((l) => l.startsWith(`| **${MODE_NAME}**`))!;
      expect(row).toContain("achimala/dream-loop");
    }
  });
});

describe("the manifest carries no React", () => {
  test("`manifest.ts` imports nothing from react or a viewer component", () => {
    // manifest.ts is read by the Bun backend, which has no React. The split
    // from pneuma-mode.ts exists exactly so this stays true.
    const source = read("modes/lucid/manifest.ts");
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\/viewer\//);
  });
});

describe("the skill install surface", () => {
  test("a SKILL.md exists with a name matching installName", () => {
    // The installer copies this directory into the session; without the file
    // a session cannot start at all, whatever else is declared.
    const skill = read("modes/lucid/skill/SKILL.md");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain(`name: ${lucidManifest.skill.installName}`);
    expect(skill).toContain("<!-- pneuma:start -->");
    expect(skill).toContain("<!-- pneuma:end -->");
  });

  test("every shared script the mode needs is whitelisted", () => {
    // `sharedScripts` is a whitelist, and it is transitive: a listed script
    // that imports an unlisted sibling dies on its first import line at
    // runtime, in the user's session, with ERR_MODULE_NOT_FOUND. image-to-3d
    // drives fal through fal-queue.mjs, so the transport has to be listed.
    const declared = lucidManifest.skill.sharedScripts ?? [];
    expect(declared).toEqual(["fal-queue.mjs"]);
  });

  test("both external tools are mapped to the env vars the scripts read", () => {
    expect(lucidManifest.skill.envMapping).toEqual({
      BLENDER_PATH: "blenderPath",
      FAL_KEY: "falApiKey",
    });
    const params = lucidManifest.init!.params!;
    // The fal key buys inference and is cleared from snapshots; a Blender
    // path is a local filename and marking it sensitive would hide the one
    // value a user most often needs to check.
    expect(params.find((p) => p.name === "falApiKey")?.sensitive).toBe(true);
    expect(params.find((p) => p.name === "blenderPath")?.sensitive).toBeUndefined();
  });

  test("the backend lock is declared — the loop needs image generation", () => {
    expect(lucidManifest.supportedBackends).toEqual(["codex"]);
  });

  test("deriveParams gates the skill's conditional blocks on the two tools", () => {
    // `imageTo3dDisabled` is the complement of `imageTo3dEnabled`, not a
    // second opinion: the template engine has no inverted section, so the
    // "that rung is closed, tell the user why" paragraph needs its own truthy
    // key. Exactly one of the pair is ever truthy.
    const derive = lucidManifest.init!.deriveParams!;
    const withKey = derive({ blenderPath: "", falApiKey: "fal-x", fpsTarget: "60" });
    expect(withKey).toMatchObject({
      imageTo3dEnabled: "true",
      imageTo3dDisabled: "",
      blenderConfigured: "",
    });
    const withoutKey = derive({
      blenderPath: "/Applications/Blender.app/Contents/MacOS/Blender",
      falApiKey: "",
      fpsTarget: "30",
    });
    expect(withoutKey).toMatchObject({
      imageTo3dEnabled: "",
      imageTo3dDisabled: "true",
      blenderConfigured: "true",
    });
    for (const derived of [withKey, withoutKey]) {
      const truthy = [derived.imageTo3dEnabled, derived.imageTo3dDisabled].filter(Boolean);
      expect(truthy).toHaveLength(1);
    }
  });

  test("the user's own params survive derivation", () => {
    // `deriveParams` spreads its input; dropping that spread would blank
    // every `{{fpsTarget}}` in the skill and the seed at once.
    const derive = lucidManifest.init!.deriveParams!;
    expect(derive({ blenderPath: "", falApiKey: "", fpsTarget: "30" })).toMatchObject({
      fpsTarget: "30",
    });
  });
});

describe("showcase copy", () => {
  test("four highlights with localized titles and non-placeholder copy", () => {
    // Four, not three: the locked target, the wipe, the fresh judge and the
    // asset ladder are four independent claims — none implies another.
    const showcase = JSON.parse(read("modes/lucid/showcase/showcase.json"));
    expect(showcase.hero).toBe("hero.png");
    expect(showcase.highlights).toHaveLength(4);
    expect(Object.keys(showcase.tagline).sort()).toEqual(["en", "ja", "zh-CN"]);
    for (const highlight of showcase.highlights) {
      expect(Object.keys(highlight.title).sort()).toEqual(["en", "ja", "zh-CN"]);
      // The English description doubles as the image-generation brief, so a
      // one-liner leaves `/showcase` nothing to draw.
      expect(highlight.description.en.length).toBeGreaterThan(80);
      expect(highlight.media).toMatch(/^highlight-[\w-]+\.png$/);
      expect(JSON.stringify(highlight)).not.toContain("TODO");
    }
  });

  test("every referenced image is on disk", () => {
    // The copy and the art are written in separate passes, so a highlight can
    // name a file nobody ever captured. The launcher serves `showcase/*`
    // straight off disk, so that is a 404 on a gallery card and nothing else
    // reports it.
    const showcase = JSON.parse(read("modes/lucid/showcase/showcase.json"));
    const onDisk = new Set(readdirSync(join(REPO_ROOT, "modes/lucid/showcase")));
    const referenced: string[] = [
      showcase.hero,
      ...showcase.highlights.map((h: { media: string }) => h.media),
    ];
    const missing = referenced.filter((media) => !onDisk.has(media));
    expect(missing).toEqual([]);
  });
});

describe("changelog and version", () => {
  test("the declared version has changelog bullets — the update prompt reads them", () => {
    expect(lucidManifest.changelog?.[lucidManifest.version]?.length).toBeGreaterThan(0);
  });
});

describe("evolution directive", () => {
  const directive = lucidManifest.evolution?.directive ?? "";

  test("declared at all — without it `pneuma evolve lucid` has no target", () => {
    expect(lucidManifest.evolution).toBeDefined();
    expect(directive.trim().length).toBeGreaterThan(80);
  });

  test("it says what to LEARN about the user, not what to DO to a scene", () => {
    const text = directive.toLowerCase();
    expect(text).toContain("learn");
    for (const learnable of ["taste", "judge", "asset", "fps", "budget"]) {
      expect({ learnable, present: text.includes(learnable) }).toEqual({
        learnable,
        present: true,
      });
    }
  });
});

describe("the skill text the installer ships", () => {
  /** Every markdown file the installer copies into the session — SKILL.md
   *  and all references. The installer templates them all, and the agent
   *  reads them all, so an invariant that holds only in SKILL.md holds
   *  nowhere. */
  function skillMarkdown(): string[] {
    const dir = join(REPO_ROOT, "modes/lucid/skill");
    return readdirSync(dir, { recursive: true, encoding: "utf-8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f));
  }

  const derivedKeys = () =>
    new Set(
      Object.keys(
        lucidManifest.init!.deriveParams!({ blenderPath: "x", falApiKey: "x", fpsTarget: "60" }),
      ),
    );

  test("the skill carries its workflow, not a placeholder", () => {
    const skill = read("modes/lucid/skill/SKILL.md");
    expect(skill).not.toContain("Full skill text lands in the next wave");
    for (const heading of ["## Scene", "## Viewer contract", "## Core rules", "## Workflow", "## Commands", "## References"]) {
      expect({ heading, present: skill.includes(heading) }).toEqual({ heading, present: true });
    }
    expect(skill).toContain("<!-- pneuma:start -->");
    expect(skill).toContain("<!-- pneuma:end -->");
  });

  test("every template variable across the skill names a real param", () => {
    // The installer's `applyTemplateParams` substitutes only init params and
    // `deriveParams` output. Any other `{{…}}` reaches the agent verbatim.
    // `{SKILL_PATH}` is the single-brace literal the agent resolves itself.
    const known = derivedKeys();
    const files = skillMarkdown();
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const [, key] of source.matchAll(/\{\{[#/]?(\w+)\}\}/g)) {
        expect({ file, key, known: known.has(key) }).toEqual({ file, key, known: true });
      }
    }
  });

  test("every conditional block closes, and no inverted section is used", () => {
    // `{{#key}}…{{/key}}` is the only section syntax the installer supports;
    // an inverted `{{^key}}` block would be left in the agent's instructions
    // as literal text.
    for (const file of skillMarkdown()) {
      const source = readFileSync(file, "utf-8");
      expect({ file, inverted: source.includes("{{^") }).toEqual({ file, inverted: false });
      const opens = [...source.matchAll(/\{\{#(\w+)\}\}/g)].map((m) => m[1]).sort();
      const closes = [...source.matchAll(/\{\{\/(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect({ file, opens }).toEqual({ file, opens: closes });
    }
  });

  test("the image-to-3D rung is gated both ways, never printed to every session", () => {
    const assets = read("modes/lucid/skill/references/assets.md");
    expect(assets).toContain("{{#imageTo3dEnabled}}");
    expect(assets).toContain("{{#imageTo3dDisabled}}");
  });

  test("every script is invoked from the workspace, never behind a `cd`", () => {
    // `cd {SKILL_PATH} && node scripts/x.mjs lantern-shrine` re-roots every
    // workspace-relative argument inside the skill directory, where none of
    // those files exist. One form for the whole skill:
    // `node {SKILL_PATH}/scripts/<name>.mjs`, cwd untouched.
    for (const file of skillMarkdown()) {
      const source = readFileSync(file, "utf-8");
      expect({ file, cd: source.includes("cd {SKILL_PATH}") }).toEqual({ file, cd: false });
      for (const line of source.split("\n")) {
        if (!/\bnode .*\.mjs/.test(line)) continue;
        expect({ file, line: line.trim(), form: line.includes("node {SKILL_PATH}/scripts/") }).toEqual({
          file,
          line: line.trim(),
          form: true,
        });
      }
    }
  });

  test("each of the five mode scripts is shown in that form at least once", () => {
    const corpus = skillMarkdown()
      .map((file) => readFileSync(file, "utf-8"))
      .join("\n");
    for (const name of ["lucid.mjs", "image-to-3d.mjs", "glb.mjs", "blender.mjs", "texture.mjs"]) {
      expect({ name, shown: corpus.includes(`node {SKILL_PATH}/scripts/${name}`) }).toEqual({
        name,
        shown: true,
      });
    }
  });

  test("every references file the SKILL.md indexes exists on disk", () => {
    const skill = read("modes/lucid/skill/SKILL.md");
    const referenced = [...skill.matchAll(/`references\/([\w-]+\.md)`/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const onDisk = new Set(readdirSync(join(REPO_ROOT, "modes/lucid/skill/references")));
    for (const file of new Set(referenced)) {
      expect({ file, exists: onDisk.has(file) }).toEqual({ file, exists: true });
    }
  });

  test("the NOTICE pins the upstream and the rubric constant it credits", () => {
    const notice = read("modes/lucid/NOTICE.md");
    expect(notice).toContain("achimala/dream-loop");
    expect(notice).toContain("MIT");
    expect(notice).toContain("JUDGE_RUBRIC");
    expect(read("modes/lucid/skill/scripts/lucid.mjs")).toContain("JUDGE_RUBRIC");
  });
});
