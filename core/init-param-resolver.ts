/**
 * Launch-time resolution of an init parameter's options.
 *
 * A manifest declares *what kind of thing* to look for
 * (`InitParamOptionsSource`); this module is the only place that actually
 * looks. That split is why `modes/<name>/manifest.ts` can stay free of both
 * React and filesystem logic while still offering choices that only exist on
 * this machine.
 *
 * Failure is always "no options", never a thrown error: a missing, unreadable,
 * or nonsensically-declared directory must degrade the launch sheet to the
 * static presets, not break it. Every refusal is logged with the parameter
 * name so it is diagnosable rather than silent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { InitParam, InitParamOption, InitParamOptionsSource } from "./types/mode-manifest.js";
import { normalizeInitParamOptions } from "./init-param-options.js";

/** Where a `directory-scan` source is allowed to look. */
export interface InitParamOptionsContext {
  /**
   * The user's home directory. Defaults to `$HOME` — read from the environment
   * rather than `os.homedir()` because Bun caches the latter at startup, so a
   * test (or a sandbox) that sets `HOME` would otherwise be ignored.
   */
  homeDir?: string;
  /** The Pneuma project root. Absent for a quick session; that root is skipped. */
  projectRoot?: string;
}

/**
 * A pathological directory must not turn the launch sheet into a thousand
 * chips, and must not cost an unbounded scan.
 */
const MAX_DISCOVERED_OPTIONS = 200;

function currentHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A source's `path` addresses a directory *under* a root. Absolute paths and
 * `..` segments are refused outright — a manifest is code, but the option
 * surface is not a place to hand one an arbitrary filesystem read.
 */
function safeRelativePath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (isAbsolute(path)) return null;
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) {
    return null;
  }
  return normalized;
}

/** Label + description out of a marker file, when it is JSON that carries them. */
function readMarkerMetadata(markerPath: string): { label?: string; description?: string } {
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const value = parsed[key];
      return typeof value === "string" && value.trim().length > 0 ? value : undefined;
    };
    return { label: pick("displayName") ?? pick("name"), description: pick("description") };
  } catch {
    // A marker that exists but does not parse still declares the directory —
    // downstream readers only check that it is there. Offer it, unlabelled.
    return {};
  }
}

function scanRoot(
  root: string,
  source: InitParamOptionsSource,
  relativePath: string,
  seen: Set<string>,
  out: InitParamOption[],
): void {
  const base = join(root, relativePath);
  if (!isDir(base)) return; // Not every user has one; that is not an error.
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return; // Unreadable (permissions, a racing delete) yields no options.
  }
  for (const name of entries.sort()) {
    if (out.length >= MAX_DISCOVERED_OPTIONS) return;
    if (name.startsWith(".")) continue; // dotfiles are plumbing, not choices
    if (seen.has(name)) continue; // first root wins, as a named lookup would
    const dir = join(base, name);
    if (!isDir(dir)) continue;
    let label: string | undefined;
    let description: string | undefined;
    if (source.markerFile) {
      const marker = join(dir, source.markerFile);
      if (!existsSync(marker)) continue; // undeclared directory: not offered
      ({ label, description } = readMarkerMetadata(marker));
    }
    seen.add(name);
    out.push({
      value: name,
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(source.group ? { group: source.group } : {}),
    });
  }
}

/**
 * Discover the options a source describes. Returns `[]` for anything it cannot
 * read — a caller never has to handle a failure mode here.
 */
export function discoverInitParamOptions(
  source: InitParamOptionsSource,
  ctx: InitParamOptionsContext = {},
  paramName = "(unnamed)",
): InitParamOption[] {
  if (source.kind !== "directory-scan") {
    console.warn(
      `[init-params] parameter "${paramName}" declares unknown optionsSource kind ` +
        `"${(source as { kind: string }).kind}" — no options discovered`,
    );
    return [];
  }
  const relativePath = safeRelativePath(source.path);
  if (relativePath === null) {
    console.warn(
      `[init-params] parameter "${paramName}" declares an unsafe optionsSource path ` +
        `"${source.path}" — must be relative and free of ".." — no options discovered`,
    );
    return [];
  }
  const out: InitParamOption[] = [];
  const seen = new Set<string>();
  for (const rootKind of source.roots ?? []) {
    const root =
      rootKind === "user-home"
        ? ctx.homeDir ?? currentHome()
        : rootKind === "project-root"
          ? ctx.projectRoot
          : undefined;
    if (!root) continue; // a quick session simply has no project root
    scanRoot(root, source, relativePath, seen, out);
  }
  return out;
}

/**
 * The full option list for one parameter: what the manifest declared, then
 * what this machine has. Parameters without an `optionsSource` are returned
 * normalized and otherwise untouched, so every existing declaration keeps
 * behaving exactly as before.
 */
export function resolveInitParamOptions(
  param: InitParam,
  ctx: InitParamOptionsContext = {},
): InitParamOption[] {
  const declared = normalizeInitParamOptions(param.options);
  if (!param.optionsSource) return declared;
  const discovered = discoverInitParamOptions(param.optionsSource, ctx, param.name);
  const seen = new Set(declared.map((option) => option.value));
  return [...declared, ...discovered.filter((option) => !seen.has(option.value))];
}

/**
 * Decorate a parameter list with resolved options, in place of the declaration.
 * The shape returned is still an `InitParam` — the browser and the CLI both
 * read `options` and never learn that discovery happened.
 */
export function withResolvedInitParamOptions(
  params: ReadonlyArray<InitParam>,
  ctx: InitParamOptionsContext = {},
): InitParam[] {
  return params.map((param) => {
    if (!param.optionsSource) return param;
    return { ...param, options: resolveInitParamOptions(param, ctx) };
  });
}
