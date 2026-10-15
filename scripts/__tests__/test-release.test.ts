import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildReleaseTestPlan, metadataOnlyManifest, releaseBaseline, releaseTestCommand, versionOnlyPackage } from "../test-release.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function write(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
const manifest = (version = "1.0.0", watch = "*.png") => `import type { ModeManifest } from "../../core/types.js";
const mode: ModeManifest = { name: "alpha", version: "${version}", changelog: { "${version}": ["change"] }, viewer: { watchPatterns: ["${watch}"] }, nested: { version: "keep" } };
export default mode;`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pneuma-release-test-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  write(root, "package.json", '{"version":"1.0.0","scripts":{"test":"bun test"}}');
  write(root, "desktop/package.json", '{"version":"1.0.0"}');
  write(root, "core/__tests__/contract.test.ts", 'import { test } from "bun:test"; test("contract", () => {});');
  write(root, "modes/alpha/manifest.ts", manifest());
  write(root, "modes/beta/manifest.ts", manifest());
  write(root, "modes/_shared/scripts/generate_image.mjs", "export const model = 'old';");
  write(root, "modes/alpha/skill/SKILL.md", "Original guidance");
  write(root, "modes/alpha/skill/scripts/process.mjs", "export const process = () => 1;");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Released baseline");
  git(root, "tag", "v1.0.0");
  write(root, "package.json", '{"version":"1.0.1","scripts":{"test":"bun test"}}');
  write(root, "desktop/package.json", '{"version":"1.0.1"}');
  return root;
}

describe("release test scope", () => {
  test("uses the released ancestor across multiple commits and excludes current-version tags on retry", () => {
    const root = fixture();
    write(root, "modes/alpha/skill/scripts/process.mjs", "export const process = () => 2;");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Feature before bump");
    git(root, "tag", "v1.0.1");
    git(root, "commit", "--allow-empty", "-qm", "Release retry");
    expect(releaseBaseline(root)).toBe("v1.0.0");
    const plan = buildReleaseTestPlan(root);
    expect(plan.scope).toBe("affected");
    expect(plan.modes).toEqual(["alpha"]);
    expect(plan.mediaModes).toEqual(["alpha"]);
    expect(plan.live).toBe(true);
    expect(plan.paths).toContain("./core");
    expect(plan.paths).not.toContain("./modes/beta");
  });

  test("includes staged, unstaged, untracked files and both sides of a rename", () => {
    const root = fixture();
    git(root, "mv", "modes/alpha/skill/scripts/process.mjs", "modes/beta/process.mjs");
    write(root, "modes/alpha/skill/SKILL.md", "Unstaged guidance");
    write(root, "modes/beta/new file.test.ts", "// untracked");
    const plan = buildReleaseTestPlan(root);
    expect(plan.changedFiles).toContain("modes/alpha/skill/scripts/process.mjs");
    expect(plan.changedFiles).toContain("modes/beta/process.mjs");
    expect(plan.changedFiles).toContain("modes/alpha/skill/SKILL.md");
    expect(plan.changedFiles).toContain("modes/beta/new file.test.ts");
    expect(plan.mediaModes).toEqual(["alpha", "beta"]);
  });

  test("guidance and declaration/version updates keep owning contracts without media", () => {
    const root = fixture();
    write(root, "modes/alpha/skill/SKILL.md", "Use a different image model");
    write(root, "modes/alpha/manifest.ts", manifest("1.0.1"));
    write(root, "modes/alpha/__tests__/mode-definition.test.ts", "// updated version assertion");
    const plan = buildReleaseTestPlan(root);
    expect(plan.scope).toBe("affected");
    expect(plan.modes).toEqual(["alpha"]);
    expect(plan.mediaModes).toEqual([]);
  });

  test("release notes and shared README edits retain declaration checks without every mode runtime", () => {
    const root = fixture();
    write(root, "modes/beta/__tests__/registration.test.ts", "// reads root README");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Add declaration check");
    // Pin the fixture baseline after the declaration exists, so its addition
    // is not itself a beta-mode change in this release.
    const base = git(root, "rev-parse", "HEAD");
    write(root, "modes/alpha/skill/SKILL.md", "Changed alpha guidance");
    write(root, "CHANGELOG.md", "Release notes");
    write(root, "AGENTS.md", "New version");
    write(root, "README.md", "Changed public catalog");
    const plan = buildReleaseTestPlan(root, { base });
    expect(plan.modes).toEqual(["alpha"]);
    expect(plan.paths).toContain("./modes/beta/__tests__/registration.test.ts");
    expect(plan.paths).not.toContain("./modes/beta");
    expect(plan.mediaModes).toEqual([]);
  });

  test("manifest behavior, seed Markdown and media test fixtures enable owning media", () => {
    for (const [path, text] of [
      ["modes/alpha/manifest.ts", manifest("1.0.1", "*.mp4")],
      ["modes/alpha/seed/README.md", "Input consumed by a seed test"],
      ["modes/alpha/__tests__/fixtures/input.md", "Input consumed by a media test"],
      ["modes/alpha/__tests__/video.test.ts", "// changed video assertions"],
    ]) {
      const root = fixture();
      write(root, path!, text!);
      expect(buildReleaseTestPlan(root).mediaModes).toEqual(["alpha"]);
    }
  });

  test("shared image adapters select every mode without unrelated media or model calls", () => {
    const root = fixture();
    write(root, "modes/_shared/scripts/generate_image.mjs", "export const model = 'new';");
    const plan = buildReleaseTestPlan(root);
    expect(plan.scope).toBe("affected");
    expect(plan.modes).toEqual(["_shared", "alpha", "beta"]);
    expect(plan.mediaModes).toEqual([]);
    expect(plan.live).toBe(false);
  });

  test("shared video, dependencies and unknown paths conservatively run everything", () => {
    for (const [path, text] of [
      ["modes/_shared/scripts/fal-queue.mjs", "export const queue = 2;"],
      ["package.json", '{"version":"1.0.1","dependencies":{"new":"1"}}'],
      ["core/__tests__/test-tier.ts", "// changed gating"],
      ["bun.lock", "changed dependencies"],
      ["desktop/tsup.config.ts", "export default { changed: true };"],
      ["src/test.config.ts", "export default { changed: true };"],
      ["templates/session-commands/helper.mjs", "export const changed = true;"],
      ["templates/session-commands/nested/prompt.md", "Unknown nested template"],
      ["templates/agent-commands/handoff-pneuma.md", "Other template family"],
      ["unknown/input", "unknown impact"],
    ]) {
      const root = fixture();
      write(root, path!, text!);
      const plan = buildReleaseTestPlan(root);
      expect(plan.scope).toBe("full");
      expect(plan.live).toBe(true);
      expect(plan.mediaModes).toBe("all");
      expect(plan.paths).toEqual([]);
      expect(plan.reasons.length).toBeGreaterThan(0);
    }
  });

  test("shared application code retains every suite and live backends without unrelated media", () => {
    for (const path of ["src/App.tsx", "server/index.ts", "core/types/session-info.ts", "bin/pneuma.ts", "scripts/test-release.ts"]) {
      const root = fixture();
      write(root, path, "export const changed = true;");
      const plan = buildReleaseTestPlan(root);
      expect(plan.scope).toBe("full");
      expect(plan.paths).toEqual([]);
      expect(plan.live).toBe(true);
      expect(plan.mediaModes).toEqual([]);
      expect(releaseTestCommand(plan).env.PNEUMA_TEST_MEDIA).toBe("");
      write(root, "modes/alpha/skill/scripts/process.mjs", "export const changed = true;");
      expect(buildReleaseTestPlan(root).mediaModes).toEqual(["alpha"]);
      write(root, "bun.lock", "dependency changes override application scope");
      expect(buildReleaseTestPlan(root).mediaModes).toBe("all");
    }
  });

  test("session-command prompts retain all suites and live backends while media follows runtime changes", () => {
    for (const name of ["handoff", "borrow"]) {
      const root = fixture();
      write(root, `templates/session-commands/${name}.md`, "Updated backend prompt");
      const plan = buildReleaseTestPlan(root);
      expect(plan.scope).toBe("full");
      expect(plan.paths).toEqual([]);
      expect(plan.modes).toEqual(["_shared", "alpha", "beta"]);
      expect(plan.live).toBe(true);
      expect(plan.mediaModes).toEqual([]);
      expect(releaseTestCommand(plan).env.PNEUMA_TEST_LIVE).toBe("1");
      expect(releaseTestCommand(plan).env.PNEUMA_TEST_MEDIA).toBe("");

      write(root, "modes/alpha/skill/scripts/process.mjs", "export const changed = true;");
      expect(buildReleaseTestPlan(root).mediaModes).toEqual(["alpha"]);
      write(root, "unknown/input", "Unknown impact still requires media");
      expect(buildReleaseTestPlan(root).mediaModes).toBe("all");
    }
  });

  test("deleted mode and missing, invalid or non-ancestor baselines cannot silently skip coverage", () => {
    const root = fixture();
    expect(buildReleaseTestPlan(root, { base: "missing-ref" }).scope).toBe("full");
    const branch = git(root, "branch", "--show-current");
    git(root, "checkout", "--orphan", "unrelated");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Unrelated history");
    expect(buildReleaseTestPlan(root, { base: "v1.0.0" }).scope).toBe("full");
    git(root, "checkout", branch);
    rmSync(join(root, "modes/alpha"), { recursive: true });
    expect(buildReleaseTestPlan(root).scope).toBe("full");
    git(root, "tag", "-d", "v1.0.0");
    expect(buildReleaseTestPlan(root).scope).toBe("full");
  });

  test("an empty diff still runs common tests; explicit full opts into every tier", () => {
    const root = fixture();
    const plan = buildReleaseTestPlan(root);
    expect(plan.scope).toBe("affected");
    expect(plan.paths).toEqual(["./core"]);
    expect(plan.mediaModes).toEqual([]);
    const full = buildReleaseTestPlan(root, { full: true });
    expect(full.scope).toBe("full");
    const command = releaseTestCommand(full);
    expect(command.command.slice(1)).toEqual(["test", "--timeout", "60000"]);
    expect(command.env.PNEUMA_TEST_MEDIA).toBe("1");
    expect(command.env.PNEUMA_TEST_LIVE).toBe("1");
  });

  test("cloud contracts run on every release and cloud-owned changes retain their own scope", () => {
    const root = fixture();
    write(root, "cloud/collaboration/tests/contract.test.ts", 'import { test, expect } from "bun:test"; test("cloud contract", () => expect(1).toBe(2));');
    git(root, "add", ".");
    git(root, "commit", "-qm", "Add cloud contract");
    const base = git(root, "rev-parse", "HEAD");
    const plan = buildReleaseTestPlan(root, { base });
    expect(plan.paths).toContain("./cloud/collaboration/tests");
    const { command, env } = releaseTestCommand(plan);
    const result = Bun.spawnSync(command, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cloud contract");

    for (const path of ["src/worker.ts", "package.json", "bun.lock", "wrangler.jsonc", "tests/acceptance.test.ts"]) {
      write(root, `cloud/collaboration/${path}`, "changed cloud input");
      const changed = buildReleaseTestPlan(root, { base });
      expect(changed.scope).toBe("affected");
      expect(changed.paths).toContain("./cloud/collaboration/tests");
      expect(changed.modes).toEqual([]);
      expect(changed.mediaModes).toEqual([]);
      expect(changed.live).toBe(false);
    }
    write(root, "cloud/unknown/worker.ts", "unknown cloud surface");
    expect(buildReleaseTestPlan(root, { base }).scope).toBe("full");
  });

  test("selected runner keeps failing-test exit status and overrides inherited tier flags", () => {
    const root = fixture();
    write(root, "core/__tests__/contract.test.ts", 'import { test, expect } from "bun:test"; test("failed contract", () => expect(1).toBe(2));');
    const plan = buildReleaseTestPlan(root);
    const { command, env } = releaseTestCommand(plan);
    expect(env.PNEUMA_TEST_LIVE).toBe("0");
    expect(env.PNEUMA_TEST_MEDIA).toBe("");
    const result = Bun.spawnSync(command, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("1 fail");
  });
});

test("metadata exemptions compare semantics and never erase nested runtime versions", () => {
  expect(versionOnlyPackage('{"version":"1","scripts":{"a":"x","b":"y"}}', '{"scripts":{"b":"y","a":"x"},"version":"2"}')).toBe(true);
  expect(versionOnlyPackage('{"version":"1","scripts":{"a":"x"}}', '{"version":"2","scripts":{"a":"y"}}')).toBe(false);
  expect(versionOnlyPackage(null, "{}")).toBe(false);
  expect(metadataOnlyManifest(manifest(), manifest("1.0.1"))).toBe(true);
  expect(metadataOnlyManifest(manifest(), manifest().replace('version: "keep"', 'version: "changed"'))).toBe(false);
  expect(metadataOnlyManifest("export default {}", "export default {}")).toBe(false);
});
