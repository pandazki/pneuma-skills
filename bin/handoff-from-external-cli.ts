/**
 * `pneuma handoff-from-external` — stage a Pneuma session in the current
 * directory from a non-Pneuma agent (Claude Code, Codex, …) and spin up the
 * server so the user can continue the work in a browser.
 *
 * Single-shot, no running pneuma server required. The flow:
 *
 *   1. Validate `--mode` against `enumerateLocalModes`.
 *   2. If `--init-project` (default), ensure `<cwd>/.pneuma/project.json`.
 *      Otherwise launch a quick session.
 *   3. Mint a sessionId, write `inbound-handoff.json` to the target
 *      session's `.pneuma/` dir — same schema as Smart Handoff so the
 *      target agent sees the intent on its first turn.
 *   4. Pick a free TCP port, spawn `pneuma <mode>` detached, print the
 *      session URL. Exit 0 the moment the child is launched.
 *
 * The slash command `/handoff-pneuma` (shipped to CC/Codex via
 * `pneuma agent-command install`) is the primary caller. Humans can call
 * it directly too — the args are obvious.
 *
 * Pure handler + IO surface mirrors `bin/handoff-cli.ts` so tests can
 * exercise dispatch logic without spawning anything.
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join, basename, resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";

import { enumerateLocalModes, type LocalModeEntry } from "../core/local-modes.js";
import { loadProjectManifest, writeProjectManifest } from "../core/project-loader.js";

// ── Public types ───────────────────────────────────────────────────────────

export interface HandoffFromExternalIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface HandoffFromExternalDeps {
  /** Absolute path of the pneuma-skills package root. */
  projectRoot: string;
  /**
   * Resolve a free TCP port. Defaults to a Node `net.createServer` listen-
   * and-close. Tests inject a deterministic stub.
   */
  pickFreePort?: () => Promise<number>;
  /**
   * Spawn the long-running detached pneuma process. Default uses
   * `node:child_process.spawn` with `detached: true, stdio: 'ignore'`.
   * Returns the child's PID so the caller can report it; tests stub the
   * function and capture the requested argv.
   */
  spawnPneuma?: (cmd: string[], env: NodeJS.ProcessEnv) => { pid: number | undefined };
  /** Override for `process.cwd()` in tests. */
  getCwd?: () => string;
}

export interface ParsedHandoffArgs {
  intent?: string;
  mode?: string;
  cwd?: string;
  /** Tri-state: `true` → --init-project, `false` → --quick, undefined → default (project). */
  initProject?: boolean;
  sourceAgent?: string;
  displayName?: string;
  port?: number;
  json: boolean;
  help: boolean;
  /** Stop short of actually spawning (CI / dry-run). */
  dryRun: boolean;
}

const HELP_TEXT = `pneuma handoff-from-external — start a Pneuma session for the current directory from an external agent

Usage:
  pneuma handoff-from-external --intent <text> --mode <name> [options]

Required:
  --intent <text>      What the user wants Pneuma to build.
  --mode <name>        Mode identifier — see \`pneuma mode list --local --json\`.

Options:
  --cwd <path>         Workspace directory (default: current dir).
  --init-project       Initialize <cwd> as a Pneuma Project (default).
  --quick              Skip project init — one-off session in <cwd>.
  --source-agent <id>  Tag for telemetry (e.g. claude-code, codex).
  --display-name <s>   Override the project displayName when initialising.
  --port <n>           Force a specific server port (default: auto).
  --json               Emit the result as JSON instead of human text.
  --dry-run            Stage files but skip spawning the pneuma server.
  --help, -h           Show this help.
`;

// ── Arg parsing ────────────────────────────────────────────────────────────

export function parseHandoffFromExternalArgs(args: string[]): ParsedHandoffArgs {
  const out: ParsedHandoffArgs = { json: false, help: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--init-project") out.initProject = true;
    else if (a === "--quick") out.initProject = false;
    else if (a === "--intent" && i + 1 < args.length) out.intent = args[++i];
    else if (a === "--mode" && i + 1 < args.length) out.mode = args[++i];
    else if (a === "--cwd" && i + 1 < args.length) out.cwd = args[++i];
    else if (a === "--source-agent" && i + 1 < args.length) out.sourceAgent = args[++i];
    else if (a === "--display-name" && i + 1 < args.length) out.displayName = args[++i];
    else if (a === "--port" && i + 1 < args.length) {
      const n = parseInt(args[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) out.port = n;
    }
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function defaultPickFreePort(): Promise<number> {
  // node:net listen on port 0 → OS picks; read the bound port, close.
  // This races with anyone else who claims the port between close and the
  // child binding, but the window is sub-millisecond and the child falls
  // back to its own auto-port logic on collision.
  const { createServer } = await import("node:net");
  return new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => res(port));
      } else {
        srv.close();
        rej(new Error("no port assigned"));
      }
    });
  });
}

function defaultSpawnPneuma(cmd: string[], env: NodeJS.ProcessEnv): { pid: number | undefined } {
  // `child_process.spawn` keeps the child alive when we detach + ignore
  // stdio. Bun's spawn doesn't expose `detached` the same way; this is the
  // portable option.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const child = spawn(cmd[0]!, cmd.slice(1), {
    detached: true,
    stdio: "ignore",
    env,
    cwd: process.cwd(),
  });
  child.unref();
  return { pid: child.pid };
}

interface HandoffPayload {
  handoff_id: string;
  source_session_id: string;
  source_mode: string;
  source_display_name: string;
  target_mode: string;
  target_session: string;
  intent: string;
  summary?: string;
  proposed_at: number;
}

function buildPayload(opts: {
  mode: string;
  intent: string;
  sourceAgent?: string;
  sessionId: string;
  cwd: string;
}): HandoffPayload {
  const sourceAgent = opts.sourceAgent ?? "external";
  return {
    handoff_id: randomUUID(),
    source_session_id: `external:${sourceAgent}`,
    source_mode: "external",
    source_display_name: `${sourceAgent} (${basename(opts.cwd)})`,
    target_mode: opts.mode,
    target_session: opts.sessionId,
    intent: opts.intent,
    proposed_at: Date.now(),
  };
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ── Main entrypoint ────────────────────────────────────────────────────────

export async function runHandoffFromExternal(
  args: string[],
  deps: HandoffFromExternalDeps,
  io: HandoffFromExternalIo,
): Promise<number> {
  const parsed = parseHandoffFromExternalArgs(args);
  if (parsed.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  // 1. Validate required args.
  if (!parsed.intent || parsed.intent.trim().length === 0) {
    io.stderr("Missing --intent. See --help.");
    return 2;
  }
  if (!parsed.mode || parsed.mode.trim().length === 0) {
    io.stderr("Missing --mode. See `pneuma mode list --local --json`.");
    return 2;
  }

  const cwd = resolvePath((deps.getCwd ?? (() => process.cwd()))(), parsed.cwd ?? ".");
  if (!existsSync(cwd)) {
    io.stderr(`--cwd does not exist: ${cwd}`);
    return 2;
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      io.stderr(`--cwd is not a directory: ${cwd}`);
      return 2;
    }
  } catch (err) {
    io.stderr(`failed to stat --cwd: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  // 2. Validate mode is launchable here. We don't dynamic-import the
  //    manifest — `enumerateLocalModes` parses the manifest source, which
  //    is enough to confirm existence + hidden flag.
  const allModes = enumerateLocalModes({ projectRoot: deps.projectRoot });
  const modeEntry: LocalModeEntry | undefined = allModes.find((m) => m.name === parsed.mode);
  if (!modeEntry) {
    io.stderr(
      `Unknown mode: ${parsed.mode}. Try \`pneuma mode list --local --json\` for the list.`,
    );
    return 2;
  }

  // 3. Project init (default on; --quick opts out).
  const wantProject = parsed.initProject !== false;
  if (wantProject) {
    const manifest = await loadProjectManifest(cwd);
    if (!manifest) {
      const slug = basename(cwd) || "project";
      const now = Date.now();
      await writeProjectManifest(cwd, {
        version: 1,
        name: slug,
        displayName: parsed.displayName ?? slug,
        createdAt: now,
        onboardedAt: now,
      });
    }
  }

  // 4. Mint session id + compute sessionDir.
  const sessionId = randomUUID();
  const sessionDir = wantProject
    ? join(cwd, ".pneuma", "sessions", sessionId)
    : join(cwd, ".pneuma");

  // 5. Stage inbound-handoff.json. Path matches what `readInboundHandoff`
  //    expects: `<sessionDir>/.pneuma/inbound-handoff.json`.
  //
  //    Project: `<cwd>/.pneuma/sessions/<id>/.pneuma/inbound-handoff.json`
  //    Quick:   `<cwd>/.pneuma/.pneuma/inbound-handoff.json`  ← double-nest is
  //    intentional (mirrors the project layout so the same skill-installer
  //    code path picks it up; a future tidy-up can collapse to a single
  //    `.pneuma/`).
  const inboundFile = join(sessionDir, ".pneuma", "inbound-handoff.json");
  const payload = buildPayload({
    mode: parsed.mode,
    intent: parsed.intent.trim(),
    ...(parsed.sourceAgent ? { sourceAgent: parsed.sourceAgent } : {}),
    sessionId,
    cwd,
  });
  try {
    atomicWriteJson(inboundFile, payload);
  } catch (err) {
    io.stderr(`failed to write inbound-handoff: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // 6. Pick a free port. The child may still bump to a different port on
  //    collision, but pre-picking lets us print the URL synchronously.
  const port = parsed.port ?? (await (deps.pickFreePort ?? defaultPickFreePort)());

  // 7. Spawn the detached pneuma server.
  //    `--no-prompt` skips clack's interactive `init.params` prompts
  //    (e.g. webcraft's optional fal.ai API key). Without it the
  //    detached child blocks forever on stdin it can't read because we
  //    closed it with `stdio: "ignore"`. The agent can still configure
  //    keys inside the running session.
  const cmd: string[] = [
    process.argv[0]!,
    process.argv[1]!,
    parsed.mode,
    "--port", String(port),
    "--no-prompt",
  ];
  if (wantProject) {
    cmd.push("--project", cwd, "--session-id", sessionId);
  } else {
    cmd.push("--workspace", cwd);
  }

  // The session frontend keys off `?session=<id>&mode=<mode>` — without
  // those params the launcher mounts in a no-session state and renders
  // nothing (black screen). Mirrors the URL builder in the normal
  // `pneuma <mode>` boot path (`bin/pneuma.ts`'s `browserUrl`).
  const url =
    `http://localhost:${port}?session=${sessionId}&mode=${encodeURIComponent(parsed.mode)}`;
  if (parsed.dryRun) {
    if (parsed.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            mode: parsed.mode,
            cwd,
            sessionId,
            project: wantProject,
            inboundFile,
            url,
            cmd,
          },
          null,
          2,
        ),
      );
    } else {
      io.stdout(`[dry-run] Would spawn: ${cmd.join(" ")}`);
      io.stdout(`[dry-run] Inbound staged at: ${inboundFile}`);
    }
    return 0;
  }

  let pid: number | undefined;
  try {
    const result = (deps.spawnPneuma ?? defaultSpawnPneuma)(cmd, process.env);
    pid = result.pid;
  } catch (err) {
    io.stderr(`failed to spawn pneuma: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (parsed.json) {
    io.stdout(
      JSON.stringify(
        {
          ok: true,
          mode: parsed.mode,
          cwd,
          sessionId,
          project: wantProject,
          inboundFile,
          url,
          pid,
        },
        null,
        2,
      ),
    );
  } else {
    io.stdout(`Pneuma starting in ${cwd}`);
    io.stdout(`  mode:    ${modeEntry.displayName} (${parsed.mode})`);
    io.stdout(`  session: ${sessionId}`);
    io.stdout(`  project: ${wantProject ? "yes" : "no"}`);
    io.stdout(url);
  }
  return 0;
}
