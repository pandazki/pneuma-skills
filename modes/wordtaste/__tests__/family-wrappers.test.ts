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
const primaryWrapper = readFileSync(join(scriptsDir, "leaf_primary.sh"), "utf8");
const crosscheckWrapper = readFileSync(
  join(scriptsDir, "leaf_crosscheck.sh"),
  "utf8",
);
const neutralRouterPath = join(scriptsDir, "run_leaf.sh");

describe("isolated family wrappers", () => {
  it("ships only the two opaque Claude Code and Codex adapters", () => {
    expect(existsSync(join(scriptsDir, "leaf_primary.sh"))).toBe(true);
    expect(existsSync(join(scriptsDir, "leaf_crosscheck.sh"))).toBe(true);
    expect(existsSync(join(scriptsDir, "run_codex.sh"))).toBe(false);
    expect(existsSync(join(scriptsDir, "run_claude.sh"))).toBe(false);
    expect(
      existsSync(join(scriptsDir, ["run_", "gem", "ini.sh"].join(""))),
    ).toBe(false);
  });

  it("runs both families from clean temporary working directories", () => {
    for (const wrapper of [primaryWrapper, crosscheckWrapper]) {
      expect(wrapper).toContain('clean_work_dir="$(mktemp -d');
      expect(wrapper).toContain('cd "${clean_work_dir}"');
      expect(wrapper).toContain(
        'promptfile="$(cd "$(dirname "${promptfile}")" && pwd)/$(basename "${promptfile}")"',
      );
    }
  });

  it("starts Claude Code as a non-persistent tool-free leaf process", () => {
    expect(crosscheckWrapper).toContain("--no-session-persistence");
    expect(crosscheckWrapper).toContain("--safe-mode");
    expect(crosscheckWrapper).toContain('--tools ""');
  });

  it("returns only the Codex final message on stdout", () => {
    expect(primaryWrapper).toContain("--output-last-message");
    expect(primaryWrapper).toContain('cat "${last_message_file}"');
  });

  it("keeps CLI transcripts in a private diagnostic file", () => {
    for (const wrapper of [primaryWrapper, crosscheckWrapper]) {
      expect(wrapper).toContain("WORDTASTE_PRIVATE_LOG");
      expect(wrapper).toContain('diagnostic_file=');
      expect(wrapper).not.toContain("generating from");
    }
    expect(primaryWrapper).toContain('> "${diagnostic_file}" 2>&1');
    expect(primaryWrapper).not.toMatch(
      /< "\$\{promptfile\}" \\\s+>&2/,
    );
    expect(crosscheckWrapper).toContain('2> "${diagnostic_file}"');
  });

  it("exposes one neutral writer/checker/repair router to the orchestrator", () => {
    expect(existsSync(neutralRouterPath)).toBe(true);
    const router = readFileSync(neutralRouterPath, "utf8");
    expect(router).toContain("<writer|checker|repair>");
    expect(router).toContain('case "${role}" in');
    expect(router).toContain("writer)");
    expect(router).toContain("checker|repair)");
    expect(router).toContain("repair)");
    expect(router).toContain("MAX_REPAIR_CYCLES=2");
    expect(router).toContain('exec "${runner}" "${promptfile}"');
    expect(router).not.toContain("echo \"${runner}\"");
  });

  it("routes neutral roles without emitting family metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "wordtaste-neutral-router-"));
    const bin = join(root, "bin");
    const pneuma = join(root, ".pneuma");
    const prompt = join(root, "prompt.txt");
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
        'out=""',
        'while [[ $# -gt 0 ]]; do',
        '  if [[ "$1" == "--output-last-message" ]]; then out="$2"; shift 2; else shift; fi',
        "done",
        'printf "writer-result\\n" > "${out}"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "claude"),
      '#!/usr/bin/env bash\nprintf "checker-result\\n"\n',
    );
    chmodSync(join(bin, "codex"), 0o755);
    chmodSync(join(bin, "claude"), 0o755);

    try {
      for (const [role, expected] of [
        ["writer", "writer-result\n"],
        ["checker", "checker-result\n"],
      ] as const) {
        const proc = Bun.spawn(["bash", neutralRouterPath, role, prompt], {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            PNEUMA_SESSION_DIR: root,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [status, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        expect(status).toBe(0);
        expect(stdout).toBe(expected);
        expect(stderr).toBe("");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hard-stops a third repair at the same passage scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "wordtaste-repair-budget-"));
    const bin = join(root, "bin");
    const pneuma = join(root, ".pneuma");
    const prompt = join(root, "prompt.txt");
    mkdirSync(bin, { recursive: true });
    mkdirSync(pneuma, { recursive: true });
    writeFileSync(prompt, "private repair prompt\n");
    writeFileSync(
      join(pneuma, "cross-family.json"),
      '{"claude":true,"codex":true}\n',
    );
    writeFileSync(
      join(bin, "codex"),
      [
        "#!/usr/bin/env bash",
        'out=""',
        'while [[ $# -gt 0 ]]; do',
        '  if [[ "$1" == "--output-last-message" ]]; then out="$2"; shift 2; else shift; fi',
        "done",
        'printf "writer-result\\n" > "${out}"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "claude"),
      '#!/usr/bin/env bash\nprintf "repair-result\\n"\n',
    );
    chmodSync(join(bin, "codex"), 0o755);
    chmodSync(join(bin, "claude"), 0o755);

    try {
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const proc = Bun.spawn(
          ["bash", neutralRouterPath, "repair", prompt, "u1-length"],
          {
            cwd: root,
            env: {
              ...process.env,
              PATH: `${bin}:/usr/bin:/bin`,
              PNEUMA_SESSION_DIR: root,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [status, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        if (cycle <= 2) {
          expect(status).toBe(0);
          expect(stdout).toBe("repair-result\n");
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
          join(pneuma, "repair-budget", "u1-length.count"),
          "utf8",
        ).trim(),
      ).toBe("2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards termination to the active leaf process", () => {
    for (const wrapper of [primaryWrapper, crosscheckWrapper]) {
      expect(wrapper).toContain("terminate_leaf");
      expect(wrapper).toContain("trap 'terminate_leaf TERM' TERM");
      expect(wrapper).toContain("trap 'terminate_leaf INT' INT");
      expect(wrapper).toContain('wait "${leaf_pid}"');
    }
  });

  it("reaps a real leaf stub when its wrapper is stopped", async () => {
    for (const family of ["codex", "claude"]) {
      const root = mkdtempSync(join(tmpdir(), `wordtaste-${family}-signal-`));
      const bin = join(root, "bin");
      const prompt = join(root, "prompt.txt");
      const pidFile = join(root, "leaf.pid");
      const cli = join(bin, family);
      await Bun.$`mkdir -p ${bin}`.quiet();
      writeFileSync(prompt, "private prompt\n");
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
      const wrapper = family === "codex"
        ? join(scriptsDir, "leaf_primary.sh")
        : join(scriptsDir, "leaf_crosscheck.sh");
      const proc = Bun.spawn(["bash", wrapper, prompt], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          WORDTASTE_TEST_LEAF_PID: pidFile,
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      try {
        // Starting a real CLI-shaped child can take longer while the full test
        // suite, typecheck, and build are competing for CPU. Keep this bounded,
        // but give the wrapper enough time to reach the stub before asserting.
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
            throw new Error(`${family} wrapper did not stop`);
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
