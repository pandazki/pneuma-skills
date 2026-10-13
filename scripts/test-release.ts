#!/usr/bin/env bun
/**
 * Release checks are based on the last released ancestor, not the last commit.
 * Mode scripts often use spawn/readFile rather than imports, so Bun's --changed
 * graph alone cannot cover them. Select whole modes and retain common contracts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const COMMON = ["core", "server", "bin", "snapshot", "plugins", "src", "scripts/__tests__", "desktop/__tests__"];
// These adapters do not participate in the local raster/video pipelines.
// Storyboard's own cropping tests still run in _shared; Sprite never calls it.
const IMAGE_ADAPTERS = /^modes\/_shared\/scripts\/(?:generate_image\.(?:mjs|d\.mts)|edit_image\.mjs|storyboard\.(?:mjs|d\.mts)|__tests__\/(?:image-generation|storyboard)\.test\.ts)$/;
const DECLARATION_TEST = /^(?:__tests__\/)?(?:manifest|registration|mode-definition)\.test\.tsx?$/;

export interface ReleaseTestPlan {
  baseline: string | null;
  changedFiles: string[];
  scope: "affected" | "full";
  reasons: string[];
  modes: string[];
  mediaModes: string[] | "all";
  live: boolean;
  paths: string[];
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trimEnd();
}

function versionParts(tag: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}

function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

export function releaseBaseline(root: string): string {
  const target = versionParts(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version);
  if (!target) throw new Error("package version is not a stable release version");
  const tags = git(root, ["tag", "--merged", "HEAD"]).split("\n")
    .filter(tag => tag.startsWith("v") && versionParts(tag) && before(versionParts(tag)!, target));
  if (!tags.length) throw new Error("no earlier released ancestor tag found (fetch tags and full history)");
  return git(root, ["describe", "--tags", "--abbrev=0", ...tags.flatMap(tag => ["--match", tag]), "HEAD"]);
}

function previous(root: string, base: string, path: string): string | null {
  try { return git(root, ["show", `${base}:${path}`]); } catch { return null; }
}

function current(root: string, path: string): string | null {
  try { return readFileSync(resolve(root, path), "utf8"); } catch { return null; }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function versionOnlyPackage(oldText: string | null, newText: string | null): boolean {
  if (oldText === null || newText === null) return false;
  try {
    const oldValue = JSON.parse(oldText);
    const newValue = JSON.parse(newText);
    if (!oldValue || !newValue || Array.isArray(oldValue) || Array.isArray(newValue)) return false;
    delete oldValue.version;
    delete newValue.version;
    return canonical(oldValue) === canonical(newValue);
  } catch { return false; }
}

/** Strip only release metadata on an explicitly typed ModeManifest literal. */
function manifestWithoutReleaseMetadata(text: string): string | null {
  const source = ts.createSourceFile("manifest.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const transformed = ts.transform(source, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isVariableDeclaration(node) && node.type && ts.isTypeReferenceNode(node.type)
        && node.type.typeName.getText(source) === "ModeManifest" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        found = true;
        const properties = node.initializer.properties.filter(property =>
          !(ts.isPropertyAssignment(property) && ["version", "changelog"].includes(property.name.getText(source).replace(/["']/g, ""))));
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateObjectLiteralExpression(node.initializer, properties));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try { return found ? ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]!) : null; }
  finally { transformed.dispose(); }
}

export function metadataOnlyManifest(oldText: string | null, newText: string | null): boolean {
  if (oldText === null || newText === null) return false;
  const oldBody = manifestWithoutReleaseMetadata(oldText);
  return oldBody !== null && oldBody === manifestWithoutReleaseMetadata(newText);
}

export function buildReleaseTestPlan(root: string, options: { base?: string; full?: boolean } = {}): ReleaseTestPlan {
  const modes = readdirSync(resolve(root, "modes"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => entry.name).sort();
  const plan: ReleaseTestPlan = { baseline: null, changedFiles: [], scope: "affected", reasons: [], modes: [], mediaModes: [], live: false, paths: [] };
  const selected = new Set<string>();
  const media = new Set<string>();
  let allMedia = false;
  // Registration tests read root README/CLAUDE and installation declarations.
  // Keep them on every release without selecting every mode's runtime suite
  // merely because the bump updates CHANGELOG.md or AGENTS.md.
  const declarations = [...new Bun.Glob("modes/*/__tests__/{manifest,registration,mode-definition}.test.{ts,tsx}")
    .scanSync({ cwd: root, onlyFiles: true })].sort();
  const full = (why: string, includeAllMedia = true) => {
    plan.scope = "full";
    allMedia ||= includeAllMedia;
    if (!plan.reasons.includes(why)) plan.reasons.push(why);
  };
  try {
    const base = options.base ?? releaseBaseline(root);
    // Validate refs before passing them into other git subcommands.
    const commit = git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
    git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    plan.baseline = base;
    plan.changedFiles = [...new Set([
      ...git(root, ["diff", "--name-only", "--no-renames", "-z", commit, "--"]).split("\0"),
      ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ].filter(Boolean))].sort();
    for (const path of plan.changedFiles) {
      const match = /^modes\/([^/]+)\/(.+)$/.exec(path);
      if (match) {
        const name = match[1]!;
        const local = match[2]!;
        if (!modes.includes(name)) { full(`removed or unknown mode: ${name}`); continue; }
        selected.add(name);
        if (name === "_shared") {
          modes.forEach(mode => selected.add(mode));
          if (!IMAGE_ADAPTERS.test(path) && !/^skills\/.*\.md$/.test(local)) full(`shared mode runtime: ${path}`);
        } else if (/^(?:skill\/(?!scripts\/)|docs\/).*\.md$/.test(local)
          || /^[^/]+\.md$/.test(local) || DECLARATION_TEST.test(local)) {
          // Guidance and declaration checks run without invoking media tools.
        } else if (local === "manifest.ts" && metadataOnlyManifest(previous(root, commit, path), current(root, path))) {
          // Mode version/changelog alone do not alter the media pipeline.
        } else {
          media.add(name);
        }
        continue;
      }
      if (path === "package.json" || path === "desktop/package.json") {
        if (!versionOnlyPackage(previous(root, commit, path), current(root, path))) full(`package/configuration change: ${path}`);
      } else if (/^(?:docs\/|\.agents\/|\.claude\/).*\.md$/.test(path) || /^[^/]+\.md$/.test(path)) {
        // Common guidance and mode declaration checks cover these documents.
      } else if (COMMON.some(directory => path.startsWith(`${directory}/`)) && /(?:^|\/)__tests__\//.test(path)
        && path !== "core/__tests__/test-tier.ts") {
        // These tests are already in the mandatory common suite.
      } else if ((/^(?:core|server|bin|snapshot|plugins|src|desktop\/src)\/.*\.(?:[cm]?[jt]sx?|css)$/.test(path)
        && !/\.config\.[^/]+$/.test(path)
        && path !== "core/__tests__/test-tier.ts") || path === "scripts/test-release.ts") {
        // Application contracts can affect every viewer and backend, so retain
        // full discovery and live integration. Local media pipelines execute
        // mode scripts, not the shell: only their own changes opt into media.
        // Selector behavior is covered by Git-fixture and runner-exit tests.
        full(`shared application code: ${path}; media follows mode changes`, false);
      } else {
        full(`shared runtime or unclassified change: ${path}`);
      }
    }
  } catch (error) {
    full(`cannot establish change scope: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.full) full("explicit --full");
  if (plan.scope === "full") {
    plan.modes = modes;
    plan.mediaModes = allMedia ? "all" : [...media].sort();
    plan.live = true;
    // No positional filters: preserve Bun's full discovery, including new roots.
    plan.paths = [];
  } else {
    plan.modes = [...selected].sort();
    plan.mediaModes = [...media].sort();
    // Selected modes may verify real Blender/Chrome integrations. Backend
    // lifecycle suites remain excluded by path unless the scope is full.
    plan.live = media.size > 0;
    plan.paths = [...COMMON, ...plan.modes.map(mode => `modes/${mode}`),
      ...declarations.filter(path => !plan.modes.some(mode => path.startsWith(`modes/${mode}/`)))]
      .filter(path => existsSync(resolve(root, path))).map(path => `./${path}`);
    if (plan.paths.length === 0) throw new Error("test:release found no test roots; refusing an empty selection");
    plan.reasons.push("common contracts and mode declarations plus affected modes; media only for affected mode runtime/fixtures");
  }
  return plan;
}

export function releaseTestCommand(plan: ReleaseTestPlan): { command: string[]; env: Record<string, string | undefined> } {
  return {
    command: [process.execPath, "test", ...plan.paths, "--timeout", "60000"],
    env: { ...process.env, PNEUMA_TEST_LIVE: plan.live ? "1" : "0", PNEUMA_TEST_MEDIA: plan.mediaModes === "all" ? "1" : plan.mediaModes.join(",") },
  };
}

if (import.meta.main) {
  let base: string | undefined;
  let dryRun = false;
  let full = false;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === "--base") {
      base = process.argv[++index];
      if (!base || base.startsWith("-")) throw new Error("--base requires a Git ref");
    } else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--full") full = true;
    else throw new Error(`Unknown argument: ${arg}. Usage: bun run test:release [--base REF] [--dry-run] [--full]`);
  }
  const root = resolve(import.meta.dir, "..");
  const plan = buildReleaseTestPlan(root, { base, full });
  console.log(JSON.stringify(plan, null, 2));
  if (!dryRun) {
    const { command, env } = releaseTestCommand(plan);
    const proc = Bun.spawn(command, { cwd: root, env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    process.exit(await proc.exited);
  }
}
