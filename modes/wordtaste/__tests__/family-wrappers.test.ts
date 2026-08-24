import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const leafLibPath = join(scriptsDir, "lib", "leaf.ts");
const neutralRouterPath = join(scriptsDir, "run_leaf.ts");
const leafSource = readFileSync(leafLibPath, "utf8");
const routerSource = readFileSync(neutralRouterPath, "utf8");

/** An invented token; the string the hosted-route leak assertions look for. */
const HOSTED_KEY = "sk-or-v1-router-testonly-0123456789";

interface HostedServer {
  url: string;
  requests: Array<{ auth: string | null; body: string }>;
  stop(): void;
}

/** A local stand-in for the hosted route, answering with the adapter's shape. */
function startHosted(options: { status?: number } = {}): HostedServer {
  const requests: Array<{ auth: string | null; body: string }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ auth: request.headers.get("authorization"), body: await request.text() });
      return new Response('{"choices":[{"message":{"content":"hosted-result"}}]}', {
        status: options.status ?? 200,
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/api/v1/chat/completions`,
    requests,
    stop: () => server.stop(true),
  };
}

describe("isolated family wrappers", () => {
  it("ships only the opaque runner, named for roles and never for a family", () => {
    expect(existsSync(neutralRouterPath)).toBe(true);
    expect(existsSync(leafLibPath)).toBe(true);
    expect(existsSync(join(scriptsDir, "leaf_primary.sh"))).toBe(false);
    expect(existsSync(join(scriptsDir, "leaf_crosscheck.sh"))).toBe(false);
    expect(existsSync(join(scriptsDir, "leaf_openrouter.sh"))).toBe(false);
    expect(existsSync(join(scriptsDir, "run_codex.ts"))).toBe(false);
    expect(existsSync(join(scriptsDir, "run_claude.ts"))).toBe(false);
    expect(
      existsSync(join(scriptsDir, ["run_", "gem", "ini.ts"].join(""))),
    ).toBe(false);
  });

  it("runs both families from clean temporary working directories", () => {
    expect(leafSource).toContain('mkdtempSync(join(tmpdir(), "wordtaste-claude-cwd-"))');
    expect(leafSource).toContain('mkdtempSync(join(tmpdir(), "wordtaste-codex-cwd-"))');
    // The prompt path is made absolute before the leaf changes directory.
    expect(leafSource).toContain("join(dirname(promptFile), basename(promptFile))");
  });

  it("starts Claude Code as a non-persistent tool-free leaf process", () => {
    expect(leafSource).toContain('"--no-session-persistence"');
    expect(leafSource).toContain('"--safe-mode"');
    expect(leafSource).toContain('"--tools", ""');
  });

  it("names the leaf model instead of inheriting whatever the account prefers", () => {
    expect(leafSource).toContain('process.env.WORDTASTE_CLAUDE_MODEL || "claude-sonnet-5"');
    // Codex is the checker by default, so its model stays opt-in: no flag at
    // all unless someone names one.
    expect(leafSource).toContain("process.env.WORDTASTE_CODEX_MODEL");
    expect(leafSource).toContain('["-m", process.env.WORDTASTE_CODEX_MODEL]');
    expect(leafSource).toContain(": []");
  });

  it("returns only the Codex final message on stdout", () => {
    expect(leafSource).toContain('"--output-last-message", lastMessageFile');
    expect(leafSource).toContain('readFileSync(lastMessageFile, "utf8")');
  });

  it("keeps CLI transcripts in a private diagnostic file", () => {
    expect(leafSource).toContain("WORDTASTE_PRIVATE_LOG");
    expect(leafSource).toContain("openDiagnostic");
    expect(leafSource).not.toContain("generating from");
    // Codex's whole transcript goes to the diagnostic file, stdout and stderr
    // both; Claude's stderr goes there while its answer file stays separate.
    expect(leafSource).toContain("stdoutFile: diagnostic.file, stderrFile: diagnostic.file");
    expect(leafSource).toContain("stdoutFile: outputFile, stderrFile: diagnostic.file");
  });

  it("exposes one neutral writer/planner/checker/repair router to the orchestrator", () => {
    expect(routerSource).toContain("<writer|planner|checker|repair>");
    // Writing and repairing share one family; checking deliberately gets the
    // other, so the prose and its judge never come from the same place. The
    // planner returns JSON, so it rides with the checker rather than the prose.
    expect(leafSource).toContain('case "writer":\n    case "repair":');
    expect(leafSource).toContain('case "checker":\n    case "planner":');
    expect(leafSource).toContain("MAX_REPAIR_CYCLES = 2");
    expect(routerSource).toContain("routeLeaf(role, promptFile, scope ?? \"\")");
  });

  /**
   * Both families answer, each with its own recognisable string, and each
   * records the argv it was handed. Hermetic: HOME and PNEUMA_PROJECT_ROOT
   * point inside the temp root so priming can never reach a real library.
   */
  function makeRouterHarness(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const bin = join(root, "bin");
    const pneuma = join(root, ".pneuma");
    const prompt = join(root, "prompt.txt");
    const claudeArgv = join(root, "claude.argv");
    const codexArgv = join(root, "codex.argv");
    mkdirSync(bin, { recursive: true });
    mkdirSync(pneuma, { recursive: true });
    writeFileSync(prompt, "private prompt\n");
    writeFileSync(
      join(pneuma, "cross-family.json"),
      '{"claude":true,"codex":true}\n',
    );
    writeFileSync(
      join(bin, "codex"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" > "${WORDTASTE_TEST_CODEX_ARGV}"',
        'out=""',
        "while [[ $# -gt 0 ]]; do",
        '  if [[ "$1" == "--output-last-message" ]]; then out="$2"; shift 2; else shift; fi',
        "done",
        'printf "primary-result\\n" > "${out}"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "claude"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" > "${WORDTASTE_TEST_CLAUDE_ARGV}"',
        'exit_code="${WORDTASTE_TEST_CLAUDE_EXIT:-0}"',
        'if [[ "${exit_code}" != "0" ]]; then exit "${exit_code}"; fi',
        'printf "crosscheck-result\\n"',
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "codex"), 0o755);
    chmodSync(join(bin, "claude"), 0o755);

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      PNEUMA_SESSION_DIR: root,
      HOME: root,
      PNEUMA_PROJECT_ROOT: root,
      WORDTASTE_TEST_CLAUDE_ARGV: claudeArgv,
      WORDTASTE_TEST_CODEX_ARGV: codexArgv,
      // The probe below decides the hosted route; a stray key in the ambient
      // environment must not make one appear, and neither may a stray URL.
      OPENROUTER_API_KEY: undefined,
      WORDTASTE_OPENROUTER_URL: undefined,
    };
    /** Rewrite the probe result the router reads once, before dispatch. */
    const setProbe = (families: Record<string, boolean>) => {
      writeFileSync(
        join(pneuma, "cross-family.json"),
        `${JSON.stringify(families)}\n`,
      );
    };
    return { root, prompt, claudeArgv, codexArgv, env, setProbe };
  }

  async function runRouter(
    args: string[],
    cwd: string,
    env: Record<string, string | undefined>,
  ) {
    const proc = Bun.spawn([process.execPath, neutralRouterPath, ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { status, stdout, stderr };
  }

  it("sends prose to one family and judgement to the other, without naming either", async () => {
    const harness = makeRouterHarness("wordtaste-neutral-router-");
    try {
      for (const [role, expected] of [
        ["writer", "crosscheck-result\n"],
        ["checker", "primary-result\n"],
      ] as const) {
        const result = await runRouter(
          [role, harness.prompt],
          harness.root,
          harness.env,
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(expected);
        expect(result.stderr).toBe("");
      }
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("sends planning to the checking family, and falls back when it is missing", async () => {
    const harness = makeRouterHarness("wordtaste-planner-route-");
    try {
      const preferred = await runRouter(
        ["planner", harness.prompt],
        harness.root,
        harness.env,
      );
      expect(preferred.status).toBe(0);
      expect(preferred.stdout).toBe("primary-result\n");
      expect(preferred.stderr).toBe("");
      expect(existsSync(harness.claudeArgv)).toBe(false);

      // Availability is read from the probe, so a machine without the
      // preferred family still plans instead of failing.
      harness.setProbe({ claude: true, codex: false });
      const fallback = await runRouter(
        ["planner", harness.prompt],
        harness.root,
        harness.env,
      );
      expect(fallback.status).toBe(0);
      expect(fallback.stdout).toBe("crosscheck-result\n");
      expect(fallback.stderr).toBe("");
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("hands the writer a named model, overridable by environment", async () => {
    const harness = makeRouterHarness("wordtaste-router-model-");
    try {
      const byDefault = await runRouter(
        ["writer", harness.prompt],
        harness.root,
        harness.env,
      );
      expect(byDefault.status).toBe(0);
      const defaultArgv = readFileSync(harness.claudeArgv, "utf8").split("\n");
      expect(defaultArgv).toContain("--model");
      expect(defaultArgv[defaultArgv.indexOf("--model") + 1]).toBe(
        "claude-sonnet-5",
      );
      // A plain prompt has no composed charter beside it, so its dispatch
      // never grows the system flag.
      expect(defaultArgv).not.toContain("--system-prompt-file");

      const overridden = await runRouter(["writer", harness.prompt], harness.root, {
        ...harness.env,
        WORDTASTE_CLAUDE_MODEL: "claude-opus-4-5",
      });
      expect(overridden.status).toBe(0);
      const overriddenArgv = readFileSync(harness.claudeArgv, "utf8").split("\n");
      expect(overriddenArgv[overriddenArgv.indexOf("--model") + 1]).toBe(
        "claude-opus-4-5",
      );
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("fails the run when the chosen family fails, instead of writing with the other one", async () => {
    // Availability is decided once, from the probe. If a session could silently
    // swap families mid-run, it would report prose as written by one family
    // when another wrote it — so a failure has to end the run.
    const harness = makeRouterHarness("wordtaste-router-nofallback-");
    try {
      const result = await runRouter(["writer", harness.prompt], harness.root, {
        ...harness.env,
        WORDTASTE_TEST_CLAUDE_EXIT: "3",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("leaf adapter failed");
      expect(result.stderr).not.toMatch(/claude|codex/i);
      // The other family was never reached.
      expect(existsSync(harness.codexArgv)).toBe(false);
      expect(existsSync(harness.claudeArgv)).toBe(true);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("hard-stops a third repair at the same passage scope", async () => {
    const harness = makeRouterHarness("wordtaste-repair-budget-");
    try {
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const { status, stdout, stderr } = await runRouter(
          ["repair", harness.prompt, "u1-length"],
          harness.root,
          harness.env,
        );

        if (cycle <= 2) {
          expect(status).toBe(0);
          // Repair goes to the same family as the writer.
          expect(stdout).toBe("crosscheck-result\n");
          expect(stderr).toBe("");
        } else {
          expect(status).toBe(5);
          expect(stdout).toBe("");
          expect(stderr).toContain("repair budget exhausted");
          expect(stderr).not.toMatch(/claude|codex/i);
        }
      }

      expect(
        readFileSync(
          join(harness.root, ".pneuma", "repair-budget", "u1-length.count"),
          "utf8",
        ).trim(),
      ).toBe("2");
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  /**
   * The hosted route is preferred for prose when the probe says it answers,
   * and the checker still goes to the other family — the cross-check is what
   * makes a judge's verdict worth having.
   */
  it("sends prose to the hosted route when the probe says it answers", async () => {
    const harness = makeRouterHarness("wordtaste-hosted-route-");
    const hosted = startHosted();
    try {
      harness.setProbe({ claude: true, codex: true, openrouter: true });
      const env = {
        ...harness.env,
        OPENROUTER_API_KEY: HOSTED_KEY,
        WORDTASTE_OPENROUTER_URL: hosted.url,
      };

      for (const args of [["writer", harness.prompt], ["repair", harness.prompt, "u1"]]) {
        const result = await runRouter(args, harness.root, env);
        expect([args[0], result.status, result.stdout, result.stderr]).toEqual([
          args[0],
          0,
          "hosted-result\n",
          "",
        ]);
      }
      // Neither CLI family was reached for prose…
      expect(existsSync(harness.claudeArgv)).toBe(false);

      // …and the checker still is.
      const checked = await runRouter(["checker", harness.prompt], harness.root, env);
      expect(checked.status).toBe(0);
      expect(checked.stdout).toBe("primary-result\n");
      expect(existsSync(harness.codexArgv)).toBe(true);
    } finally {
      hosted.stop();
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps the writer with a CLI family when the hosted route is not usable", async () => {
    const harness = makeRouterHarness("wordtaste-hosted-absent-");
    const hosted = startHosted();
    try {
      // A key exists, but the probe's one real call failed — that verdict, not
      // the key's presence, is what routing reads.
      harness.setProbe({ claude: true, codex: true, openrouter: false });
      const result = await runRouter(["writer", harness.prompt], harness.root, {
        ...harness.env,
        OPENROUTER_API_KEY: HOSTED_KEY,
        WORDTASTE_OPENROUTER_URL: hosted.url,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("crosscheck-result\n");
      expect(hosted.requests).toHaveLength(0);
    } finally {
      hosted.stop();
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("fails the run when the hosted route fails, instead of writing with a CLI family", async () => {
    const harness = makeRouterHarness("wordtaste-hosted-nofallback-");
    const hosted = startHosted({ status: 403 });
    try {
      harness.setProbe({ claude: true, codex: true, openrouter: true });
      const result = await runRouter(["writer", harness.prompt], harness.root, {
        ...harness.env,
        OPENROUTER_API_KEY: HOSTED_KEY,
        WORDTASTE_OPENROUTER_URL: hosted.url,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("leaf adapter failed");
      // The diagnosis names no route, and no other route was tried.
      expect(result.stderr).not.toMatch(/claude|codex|openrouter|anthropic/i);
      expect(existsSync(harness.claudeArgv)).toBe(false);
      expect(existsSync(harness.codexArgv)).toBe(false);
    } finally {
      hosted.stop();
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("hands the hosted writer the model the session chose, and never the key", async () => {
    const harness = makeRouterHarness("wordtaste-hosted-model-");
    const hosted = startHosted();
    try {
      harness.setProbe({ claude: false, codex: false, openrouter: true });
      writeFileSync(
        join(harness.root, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "bundled", writerModel: "qwen/qwen3-max" }),
      );
      const env = {
        ...harness.env,
        OPENROUTER_API_KEY: HOSTED_KEY,
        WORDTASTE_OPENROUTER_URL: hosted.url,
      };
      const result = await runRouter(["writer", harness.prompt], harness.root, env);
      expect(result.status).toBe(0);
      const body = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(body.model).toBe("qwen/qwen3-max");
      // Off the Anthropic routes the reasoning budget is capped explicitly.
      expect(body.reasoning).toEqual({ effort: "low" });
      // The key travels as the in-memory header, and only there.
      expect(hosted.requests[0]!.auth).toBe(`Bearer ${HOSTED_KEY}`);
      expect(hosted.requests[0]!.body).not.toContain(HOSTED_KEY);

      // The environment still wins over the stored parameter.
      const overridden = await runRouter(["writer", harness.prompt], harness.root, {
        ...env,
        WORDTASTE_WRITER_MODEL: "anthropic/claude-opus-4-5",
      });
      expect(overridden.status).toBe(0);
      const overriddenBody = JSON.parse(hosted.requests[1]!.body) as Record<string, unknown>;
      expect(overriddenBody.model).toBe("anthropic/claude-opus-4-5");
      expect(overriddenBody.reasoning).toBeUndefined();
    } finally {
      hosted.stop();
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("holds the hosted adapter to the same privacy discipline", () => {
    // The token is built into a fetch header in memory: never an argument,
    // never a spawned process, never a file.
    expect(leafSource).toContain("Authorization: `Bearer ${key}`");
    expect(leafSource).not.toMatch(/\bcurl\b|execSync/);
    expect(leafSource).toContain("WORDTASTE_PRIVATE_LOG");
    expect(leafSource).toContain("AbortSignal.timeout");
  });

  it("forwards termination to the active leaf process", () => {
    expect(leafSource).toContain("installReapHandlers");
    expect(leafSource).toContain('process.on("SIGTERM"');
    expect(leafSource).toContain('process.on("SIGINT"');
    expect(leafSource).toContain('process.on("exit"');
    expect(leafSource).toContain('killGroup(pid, "SIGKILL")');
  });

  it("reaps a real leaf stub when its runner is stopped", async () => {
    for (const [family, role] of [
      ["codex", "checker"],
      ["claude", "writer"],
    ] as const) {
      const root = mkdtempSync(join(tmpdir(), `wordtaste-${family}-signal-`));
      const bin = join(root, "bin");
      const prompt = join(root, "prompt.txt");
      const pidFile = join(root, "leaf.pid");
      const cli = join(bin, family);
      mkdirSync(join(root, ".pneuma"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(prompt, "private prompt\n");
      writeFileSync(join(root, ".pneuma", "cross-family.json"), '{"claude":true,"codex":true}\n');
      writeFileSync(
        cli,
        [
          "#!/usr/bin/env bash",
          'echo "$$" > "${WORDTASTE_TEST_LEAF_PID}"',
          "trap 'exit 0' TERM INT",
          "while true; do sleep 1; done",
          "",
        ].join("\n"),
      );
      chmodSync(cli, 0o755);

      let leafPid = 0;
      const proc = Bun.spawn([process.execPath, neutralRouterPath, role, prompt], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          WORDTASTE_TEST_LEAF_PID: pidFile,
          PNEUMA_SESSION_DIR: root,
          HOME: root,
          PNEUMA_PROJECT_ROOT: root,
          WORDTASTE_PRIMER: "0",
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      try {
        // Starting a real CLI-shaped child can take longer while the full test
        // suite, typecheck, and build are competing for CPU. Keep this bounded,
        // but give the runner enough time to reach the stub before asserting.
        for (let attempt = 0; attempt < 200 && !existsSync(pidFile); attempt += 1) {
          await Bun.sleep(25);
        }
        expect(existsSync(pidFile)).toBe(true);
        leafPid = Number(readFileSync(pidFile, "utf8").trim());
        expect(Number.isInteger(leafPid) && leafPid > 0).toBe(true);

        proc.kill("SIGTERM");
        await Promise.race([
          proc.exited,
          Bun.sleep(2_000).then(() => {
            throw new Error(`${family} runner did not stop`);
          }),
        ]);
        await Bun.sleep(50);

        let alive = true;
        try {
          process.kill(leafPid, 0);
        } catch {
          alive = false;
        }
        expect(alive).toBe(false);
      } finally {
        proc.kill("SIGKILL");
        if (leafPid > 0) {
          try {
            process.kill(leafPid, "SIGKILL");
          } catch {
            // Already reaped, which is the expected path.
          }
        }
        rmSync(root, { recursive: true, force: true });
      }
    }
  }, 20_000);
});
