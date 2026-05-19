/**
 * Agent Command Installer — manages the `/handoff-pneuma` slash command
 * shipped into each supported agent backend's user-level commands dir.
 *
 * Layout per backend:
 *   - claude-code: `~/.claude/commands/handoff-pneuma.md` (→ `/handoff-pneuma`)
 *   - codex:       `~/.codex/prompts/handoff-pneuma.md`   (→ `/handoff-pneuma`)
 *
 * State (single source of truth for the installer):
 *   `~/.pneuma/agent-commands.json` — first-run prompt dismissal, the
 *   auto-update flag, and a record of which backends we installed into.
 *
 * Identity / safety:
 *   Every file we write starts with a stamped header
 *
 *     <!-- pneuma:agent-command version="X.Y.Z" backend="..." -->
 *
 *   so a re-install / auto-update can tell "this is ours, overwrite is
 *   safe" from "user-authored file with the same name, leave alone unless
 *   --force". Conflict detection uses presence of that header line — no
 *   header → not ours.
 *
 * Pure (no spawn / no HTTP). All filesystem effects route through `node:fs`
 * so tests can swap HOME via env.
 */

import { homedir } from "node:os";

/**
 * Resolve the user's home directory. Honors `HOME` (POSIX) / `USERPROFILE`
 * (Windows) over `os.homedir()` so tests can override at runtime — Bun
 * caches `os.homedir()` at process start and ignores later env mutation.
 */
function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentCommandBackend = "claude-code" | "codex";

export interface BackendDescriptor {
  type: AgentCommandBackend;
  /** Human label for UI. */
  label: string;
  /** Absolute path of the directory we install into. */
  dir: string;
  /** Absolute path of the markdown file we manage. */
  file: string;
  /** Slash command name once installed (always `/handoff-pneuma` today). */
  command: string;
  /** Identifier baked into the template's `--source-agent` arg. */
  sourceAgent: string;
}

export interface InstalledRecord {
  version: string;
  path: string;
  installedAt: number;
}

export interface AgentCommandsState {
  version: 1;
  /** First-run launcher banner dismissed. */
  promptDismissed: boolean;
  /** Re-stamp installed commands on launcher boot when pneuma version changes. */
  autoUpdate: boolean;
  installed: { [k in AgentCommandBackend]?: InstalledRecord };
}

export interface AgentCommandStatus {
  backend: AgentCommandBackend;
  label: string;
  command: string;
  path: string;
  /** True iff our managed file exists on disk. */
  installed: boolean;
  /** Version stamped in the file header — only present when `installed`. */
  fileVersion?: string;
  /** Version we recorded in the registry (may diverge if file was hand-edited). */
  registryVersion?: string;
  /** `fileVersion === currentVersion`; undefined when not installed. */
  upToDate?: boolean;
  /**
   * True when a file exists at `path` but lacks our header — i.e. somebody
   * else authored a `handoff-pneuma.md`. We refuse to overwrite without
   * `--force` so we don't clobber their work.
   */
  conflict?: boolean;
}

export interface InstallParams {
  backend: AgentCommandBackend;
  pneumaVersion: string;
  /** Raw template body (with `{{pneumaVersion}}` / `{{sourceAgent}}`). */
  template: string;
  /** Overwrite even when an unrecognised file is present. */
  force?: boolean;
}

export type InstallReason =
  | "ok"
  | "conflict"
  | "io"
  | "unknown-backend";

export interface InstallResult {
  ok: boolean;
  reason: InstallReason;
  path: string;
  previousVersion?: string;
  newVersion?: string;
  message?: string;
}

export interface UninstallResult {
  ok: boolean;
  reason: "ok" | "missing" | "conflict" | "io";
  path: string;
  removedVersion?: string;
  message?: string;
}

export interface AutoUpdateResult {
  updated: AgentCommandBackend[];
  skipped: { backend: AgentCommandBackend; reason: "missing" | "up-to-date" | "conflict" | "error"; message?: string }[];
}

// ── Backend descriptors ────────────────────────────────────────────────────

/**
 * Per-backend install convention. Resolved fresh on each call so tests can
 * point `HOME` somewhere temporary between cases.
 */
export function getBackendDescriptor(b: AgentCommandBackend): BackendDescriptor {
  const home = getHome();
  if (b === "claude-code") {
    const dir = join(home, ".claude", "commands");
    return {
      type: "claude-code",
      label: "Claude Code",
      dir,
      file: join(dir, "handoff-pneuma.md"),
      command: "/handoff-pneuma",
      sourceAgent: "claude-code",
    };
  }
  // codex
  const dir = join(home, ".codex", "prompts");
  return {
    type: "codex",
    label: "Codex",
    dir,
    file: join(dir, "handoff-pneuma.md"),
    command: "/handoff-pneuma",
    sourceAgent: "codex",
  };
}

export function listBackends(): BackendDescriptor[] {
  return [
    getBackendDescriptor("claude-code"),
    getBackendDescriptor("codex"),
  ];
}

// ── Template rendering ─────────────────────────────────────────────────────

/**
 * Replace `{{pneumaVersion}}` and `{{sourceAgent}}` placeholders. Other
 * `{{key}}` tokens pass through unchanged so the template can use them as
 * literal markdown (unlikely, but no reason to be greedy).
 */
export function renderTemplate(
  raw: string,
  params: { pneumaVersion: string; backendType: AgentCommandBackend },
): string {
  const descriptor = getBackendDescriptor(params.backendType);
  return raw
    .replaceAll("{{pneumaVersion}}", params.pneumaVersion)
    .replaceAll("{{sourceAgent}}", descriptor.sourceAgent)
    .replaceAll("{{backendType}}", params.backendType);
}

/**
 * Find and parse our stamped marker in the file. We scan the whole content
 * rather than the first line because the marker sits below the YAML
 * frontmatter — putting an HTML comment on line 1 would break CC's and
 * Codex's frontmatter parsers.
 *
 * Returns `null` when the marker is absent (= user-authored or unrelated
 * file with the same name).
 */
export function parseHeader(content: string): { version: string; backend: string } | null {
  const match = content.match(
    /<!--\s*pneuma:agent-command\s+version="([^"]+)"\s+backend="([^"]+)"\s*-->/,
  );
  if (!match) return null;
  return { version: match[1] as string, backend: match[2] as string };
}

// ── Registry I/O ───────────────────────────────────────────────────────────

export function registryPath(): string {
  return join(getHome(), ".pneuma", "agent-commands.json");
}

const DEFAULT_STATE: AgentCommandsState = {
  version: 1,
  promptDismissed: false,
  autoUpdate: true,
  installed: {},
};

export function readState(): AgentCommandsState {
  const path = registryPath();
  if (!existsSync(path)) return { ...DEFAULT_STATE, installed: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<AgentCommandsState>;
    return {
      version: 1,
      promptDismissed: parsed.promptDismissed === true,
      autoUpdate: parsed.autoUpdate !== false, // default true
      installed: (parsed.installed && typeof parsed.installed === "object")
        ? (parsed.installed as AgentCommandsState["installed"])
        : {},
    };
  } catch {
    // Corrupt registry — log via caller, return defaults so install can
    // recover. We deliberately do not delete the file here; the user may
    // want to inspect it.
    return { ...DEFAULT_STATE, installed: {} };
  }
}

export function writeState(state: AgentCommandsState): void {
  const path = registryPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function setPromptDismissed(value: boolean): AgentCommandsState {
  const next: AgentCommandsState = { ...readState(), promptDismissed: value };
  writeState(next);
  return next;
}

export function setAutoUpdate(value: boolean): AgentCommandsState {
  const next: AgentCommandsState = { ...readState(), autoUpdate: value };
  writeState(next);
  return next;
}

// ── Status ─────────────────────────────────────────────────────────────────

export function getStatus(
  backend: AgentCommandBackend,
  currentVersion: string,
): AgentCommandStatus {
  const descriptor = getBackendDescriptor(backend);
  const base: AgentCommandStatus = {
    backend,
    label: descriptor.label,
    command: descriptor.command,
    path: descriptor.file,
    installed: false,
  };
  if (!existsSync(descriptor.file)) {
    // Registry may still have an orphan record — surface fileVersion as
    // undefined and don't pretend "installed".
    return base;
  }
  let content = "";
  try {
    content = readFileSync(descriptor.file, "utf-8");
  } catch {
    return base;
  }
  const header = parseHeader(content);
  const state = readState();
  const registryVersion = state.installed[backend]?.version;
  if (!header) {
    return {
      ...base,
      installed: false,
      conflict: true,
      ...(registryVersion ? { registryVersion } : {}),
    };
  }
  return {
    ...base,
    installed: true,
    fileVersion: header.version,
    ...(registryVersion ? { registryVersion } : {}),
    upToDate: header.version === currentVersion,
  };
}

export function getAllStatus(currentVersion: string): AgentCommandStatus[] {
  return listBackends().map((b) => getStatus(b.type, currentVersion));
}

// ── Install / Uninstall ────────────────────────────────────────────────────

export function install(params: InstallParams): InstallResult {
  const { backend, pneumaVersion, template, force } = params;
  const descriptor = getBackendDescriptor(backend);
  if (!descriptor) {
    return { ok: false, reason: "unknown-backend", path: "" };
  }

  // Conflict guard: if a file exists without our header, refuse unless
  // --force. We don't want to silently clobber a user-authored
  // `handoff-pneuma.md` they happened to write themselves.
  let previousVersion: string | undefined;
  if (existsSync(descriptor.file)) {
    try {
      const existing = readFileSync(descriptor.file, "utf-8");
      const header = parseHeader(existing);
      if (!header && !force) {
        return {
          ok: false,
          reason: "conflict",
          path: descriptor.file,
          message: `File already exists without pneuma marker: ${descriptor.file}. Pass --force to overwrite.`,
        };
      }
      if (header) previousVersion = header.version;
    } catch (err) {
      return {
        ok: false,
        reason: "io",
        path: descriptor.file,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    mkdirSync(descriptor.dir, { recursive: true });
    const rendered = renderTemplate(template, { pneumaVersion, backendType: backend });
    const tmp = `${descriptor.file}.tmp`;
    writeFileSync(tmp, rendered, "utf-8");
    renameSync(tmp, descriptor.file);
  } catch (err) {
    return {
      ok: false,
      reason: "io",
      path: descriptor.file,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const state = readState();
  state.installed[backend] = {
    version: pneumaVersion,
    path: descriptor.file,
    installedAt: Date.now(),
  };
  writeState(state);

  return {
    ok: true,
    reason: "ok",
    path: descriptor.file,
    ...(previousVersion ? { previousVersion } : {}),
    newVersion: pneumaVersion,
  };
}

export function uninstall(backend: AgentCommandBackend, opts: { force?: boolean } = {}): UninstallResult {
  const descriptor = getBackendDescriptor(backend);
  if (!existsSync(descriptor.file)) {
    // Remove from registry too — keep it consistent with disk.
    const state = readState();
    let removedVersion: string | undefined;
    if (state.installed[backend]) {
      removedVersion = state.installed[backend]?.version;
      delete state.installed[backend];
      writeState(state);
    }
    return {
      ok: true,
      reason: "missing",
      path: descriptor.file,
      ...(removedVersion ? { removedVersion } : {}),
    };
  }
  try {
    const content = readFileSync(descriptor.file, "utf-8");
    const header = parseHeader(content);
    if (!header && !opts.force) {
      return {
        ok: false,
        reason: "conflict",
        path: descriptor.file,
        message: `File at ${descriptor.file} lacks our marker — refusing to delete. Pass --force to remove anyway.`,
      };
    }
    rmSync(descriptor.file);
    const state = readState();
    const registryVersion = state.installed[backend]?.version;
    if (state.installed[backend]) {
      delete state.installed[backend];
      writeState(state);
    }
    const removedVersion = registryVersion ?? header?.version;
    return {
      ok: true,
      reason: "ok",
      path: descriptor.file,
      ...(removedVersion ? { removedVersion } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      reason: "io",
      path: descriptor.file,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Auto-update ────────────────────────────────────────────────────────────

/**
 * Re-stamp every installed (= pneuma-marker-present) file whose
 * `fileVersion !== currentVersion`. Silent on conflicts — those are
 * user-authored files we don't touch.
 *
 * Returns the diff so the launcher can log it.
 */
export function runAutoUpdate(
  currentVersion: string,
  template: string,
): AutoUpdateResult {
  const out: AutoUpdateResult = { updated: [], skipped: [] };
  const state = readState();
  if (!state.autoUpdate) {
    return out;
  }
  for (const desc of listBackends()) {
    const status = getStatus(desc.type, currentVersion);
    if (status.conflict) {
      out.skipped.push({ backend: desc.type, reason: "conflict" });
      continue;
    }
    if (!status.installed) {
      out.skipped.push({ backend: desc.type, reason: "missing" });
      continue;
    }
    if (status.upToDate) {
      out.skipped.push({ backend: desc.type, reason: "up-to-date" });
      continue;
    }
    const result = install({
      backend: desc.type,
      pneumaVersion: currentVersion,
      template,
    });
    if (result.ok) {
      out.updated.push(desc.type);
    } else {
      out.skipped.push({
        backend: desc.type,
        reason: "error",
        ...(result.message ? { message: result.message } : {}),
      });
    }
  }
  return out;
}

// ── Template loading helper ────────────────────────────────────────────────

/**
 * Resolve + read the bundled slash-command template. Path computed relative
 * to this module so it survives both source and installed npm package
 * layouts. Sync read because we run during launcher boot before any
 * async-aware UI exists.
 */
export function loadBundledTemplate(): string {
  // dirname(import.meta.path) → `<pkg>/core/`; template lives in
  // `<pkg>/templates/agent-commands/handoff-pneuma.md`.
  const here = dirname(new URL(import.meta.url).pathname);
  const path = join(here, "..", "templates", "agent-commands", "handoff-pneuma.md");
  return readFileSync(path, "utf-8");
}

