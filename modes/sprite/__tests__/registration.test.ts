/**
 * The mode is actually registered — and the evolution agent knows what to
 * learn from it.
 *
 * Registration is four files read by three different processes, and each one
 * fails differently and quietly when it is missed (the shape of this suite
 * follows `modes/eli5/__tests__/registration.test.ts`, which follows
 * `modes/bansho/`, which paid for the lesson):
 *
 *  - `core/mode-loader.ts` — miss it and the mode is "Unknown mode";
 *  - `server/index.ts::builtinNames` — miss it and `bun run dev sprite` still
 *    works, so nothing looks broken, but the launcher gallery never shows it;
 *  - the docs (`AGENTS.md` + both READMEs) — miss it and the mode exists but
 *    nobody reading the project can find it.
 *
 * `builtinNames` is a function-local array inside a route handler, so it is
 * pinned against the source text — the honest option, and the same shape this
 * repo already uses for source-level invariants.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import { applyTemplateParams } from "../../../server/skill-installer.js";
import spriteManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

/** Every markdown file the installer copies into the session — SKILL.md and
 *  all four references. The installer templates them all, and the agent reads
 *  them all, so an invariant that holds only in SKILL.md holds nowhere. */
function skillMarkdown(): string[] {
  const dir = join(REPO_ROOT, "modes/sprite/skill");
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f));
}

const MODE_NAME = "sprite";

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
    expect(manifest.skill?.installName).toBe(spriteManifest.skill?.installName);
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
    expect(spriteManifest.hidden).toBeUndefined();
  });
});

describe("registration 3/3 — the docs", () => {
  test("`AGENTS.md` lists it on the Builtin Modes line", () => {
    const line = read("AGENTS.md")
      .split("\n")
      .find((l) => l.startsWith("**Builtin Modes:**"));
    expect(line).toBeDefined();
    expect(line).toContain(`\`${MODE_NAME}\``);
  });

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
});

describe("the manifest carries no React", () => {
  test("`manifest.ts` imports nothing from react or a viewer component", () => {
    // manifest.ts is read by the Bun backend, which has no React. The split
    // from pneuma-mode.ts exists exactly so this stays true.
    const source = read("modes/sprite/manifest.ts");
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\/viewer\//);
  });
});

describe("the skill install surface", () => {
  test("every shared script the mode needs is whitelisted", () => {
    // `sharedScripts` is a whitelist, and it is transitive: a listed script
    // that imports an unlisted sibling dies on its first import line at
    // runtime, in the user's session, with ERR_MODULE_NOT_FOUND.
    const declared = spriteManifest.skill.sharedScripts ?? [];
    for (const script of [
      "generate_image.mjs",
      "edit_image.mjs",
      "generate-video.mjs",
      "fal-queue.mjs",
      "seedance-video.mjs",
      "remove-background.mjs",
    ]) {
      expect({ script, declared: declared.includes(script) }).toEqual({
        script,
        declared: true,
      });
    }
  });

  test("both sensitive keys are mapped to env vars the scripts read", () => {
    expect(spriteManifest.skill.envMapping).toEqual({
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    });
    const params = spriteManifest.init!.params!;
    for (const name of ["openrouterApiKey", "falApiKey"]) {
      expect(params.find((p) => p.name === name)?.sensitive).toBe(true);
    }
  });

  test("deriveParams gates the skill's conditional blocks on the two keys", () => {
    // `videoGenDisabled` is the complement of `videoGenEnabled`, not a second
    // opinion: the template engine has no inverted section, so the "video is
    // off, tell the user why" paragraph needs its own truthy key. Exactly one
    // of the pair is ever truthy — both blocks showing, or neither, is what
    // this pins.
    const derive = spriteManifest.init!.deriveParams!;
    expect(
      derive({ openrouterApiKey: "sk-x", falApiKey: "", defaultVideoModel: "seedance-2.5" }),
    ).toMatchObject({
      imageGenEnabled: "true",
      videoGenEnabled: "",
      videoGenDisabled: "true",
    });
    expect(
      derive({ openrouterApiKey: "", falApiKey: "fal-x", defaultVideoModel: "h3-max" }),
    ).toMatchObject({
      imageGenEnabled: "",
      videoGenEnabled: "true",
      videoGenDisabled: "",
    });
  });

  test("the no-fal-key sentence is gated, not printed to every session", () => {
    // It sat outside `{{/videoGenEnabled}}` once: a session that COULD render
    // video read "video preview is off" right under the steps for doing it.
    const skill = read("modes/sprite/skill/SKILL.md");
    const enabled = applyTemplateParams(skill, {
      defaultVideoModel: "seedance-2.5",
      imageGenEnabled: "true",
      videoGenEnabled: "true",
      videoGenDisabled: "",
    });
    const disabled = applyTemplateParams(skill, {
      defaultVideoModel: "seedance-2.5",
      imageGenEnabled: "true",
      videoGenEnabled: "",
      videoGenDisabled: "true",
    });

    expect(enabled).toContain("Pick the model");
    expect(enabled).not.toContain("needs a fal.ai key");
    expect(disabled).not.toContain("Pick the model");
    expect(disabled).toContain("Video previews need a fal.ai key");
    // The reference stays indexed either way — the flags are still the truth
    // about those scripts, and the row says what it costs to use them.
    for (const rendered of [enabled, disabled]) {
      expect(rendered).toContain("(needs the fal key) | `references/video-preview.md`");
    }
  });

  test("every conditional block in SKILL.md closes, and uses a real flag", () => {
    // `{{#key}}…{{/key}}` is the only section syntax the installer supports —
    // an inverted `{{^key}}` block would be silently left in the agent's
    // instructions as literal text.
    const skill = read("modes/sprite/skill/SKILL.md");
    expect(skill).not.toContain("{{^");
    const opens = [...skill.matchAll(/\{\{#(\w+)\}\}/g)].map((m) => m[1]);
    const closes = [...skill.matchAll(/\{\{\/(\w+)\}\}/g)].map((m) => m[1]);
    expect(opens.sort()).toEqual(closes.sort());
    const derived = Object.keys(
      spriteManifest.init!.deriveParams!({
        openrouterApiKey: "x",
        falApiKey: "x",
        defaultVideoModel: "seedance-2.5",
      }),
    );
    for (const key of opens) {
      expect({ key, known: derived.includes(key) }).toEqual({ key, known: true });
    }
  });

  test("every template variable across the skill names a real param", () => {
    // The installer templates EVERY .md under the skill dir, references
    // included — an unknown key there survives into the agent's reading as
    // literal `{{…}}`, which is how a reference silently stops being advice.
    const known = new Set(
      Object.keys(
        spriteManifest.init!.deriveParams!({
          openrouterApiKey: "x",
          falApiKey: "x",
          defaultVideoModel: "seedance-2.5",
        }),
      ),
    );
    // The installer's `applyTemplateParams` substitutes only init params and
    // `deriveParams` output — there is no framework-supplied key beyond them
    // (`{{viewerCapabilities}}` was once documented but never implemented).
    // `SKILL_PATH` is deliberately NOT in this set either: the repo's
    // convention is the single-brace literal `{SKILL_PATH}`, which the
    // installer never substitutes — the agent resolves it against its own
    // installed skill directory. Any other `{{…}}` would reach the agent
    // verbatim, so this test has to keep failing on it.

    const markdown = skillMarkdown();
    expect(markdown.length).toBeGreaterThan(1);

    for (const file of markdown) {
      const source = readFileSync(file, "utf-8");
      for (const [, key] of source.matchAll(/\{\{(\w+)\}\}/g)) {
        expect({ file, key, known: known.has(key) }).toEqual({
          file,
          key,
          known: true,
        });
      }
    }
  });

  test("every script is invoked from the workspace, never behind a `cd`", () => {
    // `cd {SKILL_PATH} && node scripts/x.mjs motions/idle/sheet-raw.png`
    // re-roots every workspace-relative argument inside the skill directory,
    // where none of those files exist — so the call dies on ENOENT, and for
    // the model scripts it dies AFTER the image was paid for. One form for
    // the whole skill: `node {SKILL_PATH}/scripts/<name>.mjs`, cwd untouched.
    for (const file of skillMarkdown()) {
      const source = readFileSync(file, "utf-8");
      expect({ file, cd: source.includes("cd {SKILL_PATH}") }).toEqual({
        file,
        cd: false,
      });
      for (const line of source.split("\n")) {
        if (!/\bnode .*\.mjs/.test(line)) continue;
        expect({
          file,
          line: line.trim(),
          form: line.includes("node {SKILL_PATH}/scripts/"),
        }).toEqual({ file, line: line.trim(), form: true });
      }
    }
  });

  test("every shared script the skill calls is shown in that form at least once", () => {
    // `sharedScripts` is the whitelist of what gets installed; the skill text
    // is where the agent learns how to call it. A script listed but never
    // shown is a capability the agent has to guess the shape of — which is
    // how `--prompt` gets written for a script that takes a positional.
    const invoked = spriteManifest.skill!.sharedScripts!.filter(
      // fal-queue.mjs is a dependency of the two video scripts, never a
      // command the agent runs.
      (name) => name !== "fal-queue.mjs",
    );
    const corpus = skillMarkdown()
      .map((file) => readFileSync(file, "utf-8"))
      .join("\n");
    for (const name of [...invoked, "sprite-sheet.mjs", "sprite-project.mjs"]) {
      expect({
        name,
        shown: corpus.includes(`node {SKILL_PATH}/scripts/${name}`),
      }).toEqual({ name, shown: true });
    }
  });

  test("every references file the SKILL.md indexes exists on disk", () => {
    const skill = read("modes/sprite/skill/SKILL.md");
    const referenced = [...skill.matchAll(/`references\/([\w-]+\.md)`/g)].map(
      (m) => m[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    const onDisk = new Set(
      readdirSync(join(REPO_ROOT, "modes/sprite/skill/references")),
    );
    for (const file of new Set(referenced)) {
      expect({ file, exists: onDisk.has(file) }).toEqual({ file, exists: true });
    }
  });
});

describe("showcase copy", () => {
  test("four highlights with localized titles and non-placeholder copy", () => {
    // Four, not three: the sheet-vs-video choice and the style/grid range are
    // separate claims, and neither is implied by the other two.
    const showcase = JSON.parse(read("modes/sprite/showcase/showcase.json"));
    expect(showcase.hero).toBe("hero.png");
    expect(showcase.highlights).toHaveLength(4);
    expect(Object.keys(showcase.tagline).sort()).toEqual(["en", "ja", "zh-CN"]);
    for (const highlight of showcase.highlights) {
      expect(Object.keys(highlight.title).sort()).toEqual(["en", "ja", "zh-CN"]);
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
    const showcase = JSON.parse(read("modes/sprite/showcase/showcase.json"));
    const onDisk = new Set(readdirSync(join(REPO_ROOT, "modes/sprite/showcase")));
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
    expect(spriteManifest.changelog?.[spriteManifest.version]?.length).toBeGreaterThan(0);
  });
});

describe("evolution directive", () => {
  const directive = spriteManifest.evolution?.directive ?? "";

  test("declared at all — without it `pneuma evolve sprite` has no target", () => {
    expect(spriteManifest.evolution).toBeDefined();
    expect(directive.trim().length).toBeGreaterThan(80);
  });

  test("it says what to LEARN about the user, not what to DO to a sheet", () => {
    // The learnables the design brief commissions.
    const text = directive.toLowerCase();
    expect(text).toContain("learn");
    for (const learnable of [
      "style",
      "grid",
      "fps",
      "loop",
      "anchor",
      "video model",
      "motion",
    ]) {
      expect({ learnable, present: text.includes(learnable) }).toEqual({
        learnable,
        present: true,
      });
    }
  });
});
