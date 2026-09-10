/** Validate the repository's shared guidance and native harness entry points. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const read = (path: string) => readFileSync(join(root, path), "utf8");

function metadata(path: string): Record<string, unknown> {
  const text = read(path);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    failures.push(`${path}: missing YAML frontmatter`);
    return {};
  }
  try {
    const value = Bun.YAML.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a YAML mapping");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    failures.push(`${path}: ${String(error)}`);
    return {};
  }
}

function skill(path: string, expectedName: string) {
  const meta = metadata(path);
  check(meta.name === expectedName, `${path}: name must match ${expectedName}`);
  check(
    typeof meta.description === "string" && meta.description.trim().length > 0
      && meta.description.length <= 1024,
    `${path}: description must be a non-empty string of at most 1024 characters`,
  );
  return meta;
}

const startup = read("AGENTS.md");
check(Buffer.byteLength(startup, "utf8") < 24 * 1024, "AGENTS.md exceeds the 24 KiB startup budget");
check(read("CLAUDE.md") === "@AGENTS.md\n", "CLAUDE.md must remain a single @AGENTS.md import");
for (const rule of ["frontend", "server", "modes", "backends", "testing", "desktop"]) {
  const path = `.claude/rules/${rule}.md`;
  check(existsSync(join(root, path)), `Missing domain rule: ${path}`);
  check(startup.includes(path), `AGENTS.md does not route to ${path}`);
}

const skillsRoot = ".agents/skills";
const repoSkills = readdirSync(join(root, skillsRoot), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
for (const name of repoSkills) {
  const path = `${skillsRoot}/${name}/SKILL.md`;
  const canonical = skill(path, name);
  const skillAdapter = `.claude/skills/${name}/SKILL.md`;
  const commandAdapter = `.claude/commands/${name}.md`;
  const adapters = [skillAdapter, commandAdapter].filter((candidate) => existsSync(join(root, candidate)));
  check(adapters.length === 1, `${name}: expected exactly one Claude entry point`);
  for (const adapter of adapters) {
    check(read(adapter).includes(path), `${adapter}: does not route to ${path}`);
    check(metadata(adapter).description === canonical.description, `${adapter}: discovery description drift`);
  }
  check(startup.includes(path), `AGENTS.md does not route to ${path}`);
}
for (const name of ["bump", "showcase", "create-adr"]) {
  const path = `${skillsRoot}/${name}/agents/openai.yaml`;
  const policy = Bun.YAML.parse(read(path)) as { policy?: { allow_implicit_invocation?: boolean } };
  check(policy.policy?.allow_implicit_invocation === false, `${name}: must remain explicitly invoked`);
}

let roleCount = 0;
for (const entry of readdirSync(join(root, ".claude/agents"))) {
  if (!entry.endsWith(".md")) continue;
  const path = `.claude/agents/${entry}`;
  const target = read(path).match(/`(\.agents\/skills\/dev-workflow\/references\/roles\/[^`]+\.md)`/)?.[1];
  check(target && existsSync(join(root, target)), `${path}: missing shared role instruction`);
  roleCount++;
}

let modeCount = 0;
for (const entry of readdirSync(join(root, "modes"), { withFileTypes: true })) {
  const manifestPath = join(root, "modes", entry.name, "manifest.ts");
  if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
  const { default: manifest } = await import(manifestPath);
  skill(`modes/${entry.name}/${manifest.skill.sourceDir}/SKILL.md`, manifest.skill.installName);
  modeCount++;
}
for (const entry of readdirSync(join(root, "modes/_shared/skills"), { withFileTypes: true })) {
  if (entry.isDirectory()) skill(`modes/_shared/skills/${entry.name}/SKILL.md`, entry.name);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Guidance OK: ${repoSkills.length} shared skills, ${roleCount} role adapters, ${modeCount} mode skills; AGENTS.md ${Buffer.byteLength(startup, "utf8")} bytes`);
}
