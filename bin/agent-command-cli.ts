/**
 * `pneuma agent-command (status|install|uninstall|update)` — manages the
 * `/handoff-pneuma` slash command shipped into Claude Code's
 * `~/.claude/commands/` and Codex's `~/.codex/prompts/`.
 *
 * Pure handler + IO surface (mirrors `bin/handoff-cli.ts`) so tests can run
 * the dispatch logic without spawning a subprocess. Filesystem effects live
 * inside `core/agent-command-installer.ts`; this file only translates argv
 * into installer calls and renders human-readable output.
 *
 * The launcher's `/api/agent-commands/*` HTTP routes wrap the same
 * installer functions — the CLI here is for headless usage (CI, scripts,
 * power users) and parity with `pneuma plugin add` / `pneuma mode add`.
 */

import {
  install,
  uninstall,
  getAllStatus,
  getStatus,
  loadBundledTemplate,
  listBackends,
  type AgentCommandBackend,
  type AgentCommandStatus,
} from "../core/agent-command-installer.js";

export type CliBackendSelector = AgentCommandBackend | "all";

export interface AgentCommandCliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface AgentCommandCliDeps {
  /** Current pneuma version — stamped into installed files. */
  pneumaVersion: string;
  /** Template source. Defaults to bundled template; tests inject a fixture. */
  loadTemplate?: () => string;
}

// ── Arg parsing ────────────────────────────────────────────────────────────

interface ParsedArgs {
  sub?: "status" | "install" | "uninstall" | "update" | "help";
  backend: CliBackendSelector;
  force: boolean;
  json: boolean;
  help: boolean;
}

const ALL_BACKENDS: AgentCommandBackend[] = ["claude-code", "codex"];

function parseBackend(raw: string | undefined): CliBackendSelector | null {
  if (!raw || raw === "all") return "all";
  if (raw === "claude-code" || raw === "codex") return raw;
  return null;
}

export function parseAgentCommandArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { backend: "all", force: false, json: false, help: false };
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    out.help = true;
    return out;
  }
  const subRaw = args[0];
  if (subRaw === "status" || subRaw === "install" || subRaw === "uninstall" || subRaw === "update") {
    out.sub = subRaw;
  } else {
    out.sub = "help";
    return out;
  }
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--backend" && i + 1 < args.length) {
      const next = args[++i];
      const parsed = parseBackend(next);
      if (parsed) out.backend = parsed;
      else out.backend = "all"; // unknown → treat as all, validate later
    } else if (a === "--force" || a === "-f") {
      out.force = true;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

// ── Output helpers ─────────────────────────────────────────────────────────

const HELP_TEXT = `pneuma agent-command — manage the /handoff-pneuma slash command

Usage:
  pneuma agent-command status    [--backend <claude-code|codex|all>] [--json]
  pneuma agent-command install   [--backend <claude-code|codex|all>] [--force] [--json]
  pneuma agent-command uninstall [--backend <claude-code|codex|all>] [--force] [--json]
  pneuma agent-command update    [--backend <claude-code|codex|all>] [--json]

Subcommands:
  status     Show which backends have /handoff-pneuma installed and at which version.
  install    Copy the slash command into the chosen backend's user-level dir.
             Refuses to overwrite a user-authored file with the same name unless --force.
  uninstall  Remove the pneuma-managed file. Refuses to delete a user-authored file unless --force.
  update     Re-stamp installed entries to match the current pneuma version (idempotent).

Backends:
  claude-code  → ~/.claude/commands/handoff-pneuma.md  (→ /handoff-pneuma in CC)
  codex        → ~/.codex/prompts/handoff-pneuma.md    (→ /handoff-pneuma in Codex)
  all          → both
`;

function formatStatus(rows: AgentCommandStatus[]): string {
  const lines: string[] = [];
  for (const s of rows) {
    const stateLabel = s.installed
      ? `installed ${s.fileVersion}${s.upToDate ? "" : " (out of date)"}`
      : s.conflict
        ? "conflict (non-pneuma file present)"
        : "not installed";
    lines.push(`  ${s.label.padEnd(14)} ${s.command.padEnd(18)} ${stateLabel}`);
    lines.push(`    ${s.path}`);
  }
  return lines.join("\n");
}

// ── Main entrypoint ────────────────────────────────────────────────────────

export async function runAgentCommandCli(
  args: string[],
  deps: AgentCommandCliDeps,
  io: AgentCommandCliIo,
): Promise<number> {
  const parsed = parseAgentCommandArgs(args);
  if (parsed.help || !parsed.sub || parsed.sub === "help") {
    io.stdout(HELP_TEXT);
    return parsed.help ? 0 : 2;
  }

  const targets: AgentCommandBackend[] = parsed.backend === "all" ? ALL_BACKENDS : [parsed.backend];

  if (parsed.sub === "status") {
    const rows = targets.map((b) => getStatus(b, deps.pneumaVersion));
    if (parsed.json) {
      io.stdout(JSON.stringify(rows, null, 2));
    } else {
      io.stdout("Agent commands:");
      io.stdout(formatStatus(rows));
    }
    return 0;
  }

  // install / update share the same code path: install is idempotent and
  // overwrites when our marker is already there. `update` differs only in
  // intent — when a backend isn't installed, install actively installs,
  // whereas update is a no-op on missing entries.
  if (parsed.sub === "install" || parsed.sub === "update") {
    let template: string;
    try {
      template = (deps.loadTemplate ?? loadBundledTemplate)();
    } catch (err) {
      io.stderr(`Failed to load slash-command template: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    const results: { backend: AgentCommandBackend; ok: boolean; reason: string; message?: string; path: string; newVersion?: string; previousVersion?: string; skipped?: boolean }[] = [];
    let anyFailure = false;
    for (const b of targets) {
      const status = getStatus(b, deps.pneumaVersion);
      if (parsed.sub === "update" && !status.installed) {
        results.push({ backend: b, ok: true, reason: "skipped-not-installed", path: status.path, skipped: true });
        continue;
      }
      const result = install({
        backend: b,
        pneumaVersion: deps.pneumaVersion,
        template,
        force: parsed.force,
      });
      results.push({
        backend: b,
        ok: result.ok,
        reason: result.reason,
        path: result.path,
        ...(result.message ? { message: result.message } : {}),
        ...(result.newVersion ? { newVersion: result.newVersion } : {}),
        ...(result.previousVersion ? { previousVersion: result.previousVersion } : {}),
      });
      if (!result.ok) anyFailure = true;
    }
    if (parsed.json) {
      io.stdout(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        if (r.skipped) {
          io.stdout(`  ${r.backend}: skipped (not installed)`);
        } else if (r.ok) {
          const verb = r.previousVersion ? `updated ${r.previousVersion} → ${r.newVersion}` : `installed ${r.newVersion}`;
          io.stdout(`  ${r.backend}: ${verb}`);
          io.stdout(`    ${r.path}`);
        } else {
          io.stderr(`  ${r.backend}: ${r.reason}${r.message ? ` — ${r.message}` : ""}`);
        }
      }
    }
    return anyFailure ? 1 : 0;
  }

  // uninstall
  if (parsed.sub === "uninstall") {
    const results: { backend: AgentCommandBackend; ok: boolean; reason: string; message?: string; path: string; removedVersion?: string }[] = [];
    let anyFailure = false;
    for (const b of targets) {
      const result = uninstall(b, { force: parsed.force });
      results.push({
        backend: b,
        ok: result.ok,
        reason: result.reason,
        path: result.path,
        ...(result.message ? { message: result.message } : {}),
        ...(result.removedVersion ? { removedVersion: result.removedVersion } : {}),
      });
      if (!result.ok) anyFailure = true;
    }
    if (parsed.json) {
      io.stdout(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        if (!r.ok) {
          io.stderr(`  ${r.backend}: ${r.reason}${r.message ? ` — ${r.message}` : ""}`);
          continue;
        }
        if (r.reason === "missing") io.stdout(`  ${r.backend}: not installed (nothing to remove)`);
        else io.stdout(`  ${r.backend}: removed${r.removedVersion ? ` (was ${r.removedVersion})` : ""}`);
      }
    }
    return anyFailure ? 1 : 0;
  }

  io.stderr("unhandled subcommand");
  return 2;
}

// Re-export for convenience in `bin/pneuma.ts`.
export { listBackends };
