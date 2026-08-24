import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const routerPath = join(scriptsDir, "run_leaf.ts");

/**
 * Synthetic libraries only: invented author tokens and generated filler
 * sentences. Every spawn below gets its own HOME, PNEUMA_SESSION_DIR, and
 * PNEUMA_PROJECT_ROOT under a temp dir, so the router can never reach the
 * real `~/.pneuma/primers/`.
 */
const MARKERS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸", "子", "丑"] as const;

function sentenceFor(marker: string): string {
  return `这是一段${marker}类测试文字没来源只用来凑字数。`;
}

function paragraph(chars: number, marker: string): string {
  const sentence = sentenceFor(marker);
  return sentence.repeat(Math.max(1, Math.round(chars / sentence.length)));
}

function markerPresent(text: string, marker: string): boolean {
  return text.includes(`这是一段${marker}类`);
}

/** Build a synthetic library of `authorCount` distinct authors. */
function writeLibrary(dir: string, markers: readonly string[], options?: { withManifest?: boolean }): void {
  mkdirSync(dir, { recursive: true });
  if (options?.withManifest !== false) {
    writeFileSync(join(dir, "library.json"), JSON.stringify({ name: "synthetic" }));
  }
  markers.forEach((marker, index) => {
    const body = [220, 260, 240, 200, 280].map((n) => paragraph(n, marker)).join("\n\n");
    const front = ["---", `author: 作者${marker}`, `title: piece-${index}`, "---", ""].join("\n");
    writeFileSync(join(dir, `piece-${index}.md`), `${front}${body}\n`);
  });
}

interface Harness {
  root: string;
  home: string;
  sessionDir: string;
  privateDir: string;
  capture: string;
  env: Record<string, string>;
}

function makeHarness(prefix: string): Harness {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const sessionDir = join(root, "session");
  const bin = join(root, "bin");
  const privateDir = join(sessionDir, ".pneuma", "private");
  const capture = join(root, "capture.txt");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sessionDir, ".pneuma"), { recursive: true });
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(sessionDir, ".pneuma", "cross-family.json"), '{"claude":true,"codex":true}\n');

  // Both stubs record the prompt they actually received on stdin.
  writeFileSync(
    join(bin, "codex"),
    [
      "#!/usr/bin/env bash",
      'out=""',
      "while [[ $# -gt 0 ]]; do",
      '  if [[ "$1" == "--output-last-message" ]]; then out="$2"; shift 2; else shift; fi',
      "done",
      'command cat > "${WORDTASTE_TEST_CAPTURE}"',
      'printf "leaf-result\\n" > "${out}"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(bin, "claude"),
    [
      "#!/usr/bin/env bash",
      'command cat > "${WORDTASTE_TEST_CAPTURE}"',
      'printf "leaf-result\\n"',
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "codex"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);

  return {
    root,
    home,
    sessionDir,
    privateDir,
    capture,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      PNEUMA_SESSION_DIR: sessionDir,
      WORDTASTE_TEST_CAPTURE: capture,
    },
  };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runRouter(
  harness: Harness,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, routerPath, ...args], {
    cwd: harness.sessionDir,
    env: { ...harness.env, ...extraEnv },
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

async function withHarness(prefix: string, fn: (harness: Harness) => Promise<void>): Promise<void> {
  const harness = makeHarness(prefix);
  try {
    await fn(harness);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
}

const BRIEF = "写一段引子。\n前面已经说过的例子别重复。\n";

function writePrompt(harness: Harness, name: string, content: string = BRIEF): string {
  const file = join(harness.privateDir, name);
  writeFileSync(file, content);
  return file;
}

describe("leaf priming", () => {
  it("dispatches a private .primed.md holding the brief and the primer block", async () => {
    await withHarness("wordtaste-primed-end-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md");

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");
      expect(result.stderr).toBe("");

      const primed = join(harness.privateDir, "u1.primed.md");
      expect(existsSync(primed)).toBe(true);
      const primedText = readFileSync(primed, "utf8");
      expect(primedText.startsWith(BRIEF)).toBe(true);
      expect(primedText.length).toBeGreaterThan(BRIEF.length);
      // The framing line the writer reads before the passages.
      expect(primedText).toContain("动笔之前");
      expect(primedText.trimEnd().endsWith("只写正文。")).toBe(true);
      // The adapter received exactly that composed file.
      expect(readFileSync(harness.capture, "utf8")).toBe(primedText);
      // The original brief is untouched.
      expect(readFileSync(prompt, "utf8")).toBe(BRIEF);
    });
  }, 20_000);

  it("moves the primer to the front for WORDTASTE_PRIMER_POSITION=top", async () => {
    await withHarness("wordtaste-primed-top-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md");

      const result = await runRouter(harness, ["writer", prompt], {
        WORDTASTE_PRIMER_LIBS: lib,
        WORDTASTE_PRIMER_POSITION: "top",
      });
      expect(result.status).toBe(0);
      const primedText = readFileSync(join(harness.privateDir, "u1.primed.md"), "utf8");
      expect(primedText.startsWith("动笔之前")).toBe(true);
      expect(primedText.endsWith(BRIEF)).toBe(true);
      expect(readFileSync(harness.capture, "utf8")).toBe(primedText);
    });
  }, 20_000);

  it("dispatches the original prompt when WORDTASTE_PRIMER=0", async () => {
    await withHarness("wordtaste-primed-off-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md");

      const result = await runRouter(harness, ["writer", prompt], {
        WORDTASTE_PRIMER_LIBS: lib,
        WORDTASTE_PRIMER: "0",
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(join(harness.privateDir, "u1.primed.md"))).toBe(false);
      expect(readFileSync(harness.capture, "utf8")).toBe(BRIEF);
    });
  }, 20_000);

  it("never primes the checker", async () => {
    await withHarness("wordtaste-primed-checker-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "check-1.md", "判断这段是否保住了原意。\n");

      const result = await runRouter(harness, ["checker", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(join(harness.privateDir, "check-1.primed.md"))).toBe(false);
      expect(readFileSync(harness.capture, "utf8")).toBe("判断这段是否保住了原意。\n");
    });
  }, 20_000);

  it("never primes the planner, and never lints its prompt", async () => {
    // The planner returns JSON, not prose. Priming would steep a structural
    // answer in literary Chinese, and there is no hand-written brief to lint:
    // compose_plan_prompt.ts writes the whole prompt, and the Chinese in it is
    // the user's own goal and the author's own material.
    await withHarness("wordtaste-planner-plain-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const planPrompt = [
        "<!-- wordtaste:composed v1 plan -->",
        "You are planning a long-form Chinese essay.",
        "",
        "<material>",
        "这一段里有中文，但它是作者自己的原文。",
        "</material>",
        "",
      ].join("\n");
      const prompt = writePrompt(harness, "plan.md", planPrompt);
      // A sibling brief that would draw a note on a writer dispatch.
      writeFileSync(join(harness.privateDir, "brief.en.md"), "这份说明是中文的。\n");

      const result = await runRouter(harness, ["planner", prompt], {
        WORDTASTE_PRIMER_LIBS: lib,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(join(harness.privateDir, "plan.primed.md"))).toBe(false);
      expect(readFileSync(harness.capture, "utf8")).toBe(planPrompt);
    });
  }, 20_000);

  it("primes a repair prompt without colliding with the check cycle's own naming", async () => {
    await withHarness("wordtaste-primed-repair-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1-join.repair-1.md");

      const result = await runRouter(harness, ["repair", prompt, "u1-join"], {
        WORDTASTE_PRIMER_LIBS: lib,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const primed = join(harness.privateDir, "u1-join.repair-1.primed.md");
      expect(existsSync(primed)).toBe(true);
      expect(readFileSync(prompt, "utf8")).toBe(BRIEF);
      expect(readFileSync(harness.capture, "utf8")).toBe(readFileSync(primed, "utf8"));
    });
  }, 20_000);

  it("gives the writer and the repairer of one passage different passages", async () => {
    await withHarness("wordtaste-primed-seed-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 8));
      writeFileSync(join(harness.sessionDir, "workflow.json"), JSON.stringify({ taskId: "t-1" }));
      const writerPrompt = writePrompt(harness, "u1.md");
      const repairPrompt = writePrompt(harness, "u1.repair-1.md");

      await runRouter(harness, ["writer", writerPrompt], { WORDTASTE_PRIMER_LIBS: lib });
      const writerBlock = readFileSync(harness.capture, "utf8");
      await runRouter(harness, ["repair", repairPrompt, "u1"], { WORDTASTE_PRIMER_LIBS: lib });
      const repairBlock = readFileSync(harness.capture, "utf8");
      expect(repairBlock).not.toBe(writerBlock);

      // The same call repeated reads the same passages.
      await runRouter(harness, ["writer", writerPrompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(readFileSync(harness.capture, "utf8")).toBe(writerBlock);
    });
  }, 30_000);

  it("leaves the prompt unprimed when the enabled libraries have nothing usable", async () => {
    await withHarness("wordtaste-primed-none-", async (harness) => {
      const empty = join(harness.root, "empty");
      mkdirSync(empty, { recursive: true });
      writeFileSync(join(empty, "library.json"), "{}\n");
      const prompt = writePrompt(harness, "u1.md");

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: empty });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(join(harness.privateDir, "u1.primed.md"))).toBe(false);
      expect(readFileSync(harness.capture, "utf8")).toBe(BRIEF);
    });
  }, 20_000);
});

describe("primerLibraries resolution", () => {
  it("finds a library under the session's own HOME, never the real one", async () => {
    await withHarness("wordtaste-libs-home-", async (harness) => {
      const mine = join(harness.home, ".pneuma", "primers", "mine");
      writeLibrary(mine, MARKERS.slice(0, 12));
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "all" }),
      );

      let found = false;
      for (const name of ["u1.md", "u2.md", "u3.md", "u4.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt]);
        expect(result.status).toBe(0);
        const received = readFileSync(harness.capture, "utf8");
        if (MARKERS.slice(0, 12).some((marker) => markerPresent(received, marker))) {
          found = true;
        }
      }
      expect(found).toBe(true);
    });
  }, 40_000);

  it("reads primerLibraries from the project-session config.json at the session root", async () => {
    await withHarness("wordtaste-libs-project-", async (harness) => {
      const mine = join(harness.home, ".pneuma", "primers", "mine");
      writeLibrary(mine, MARKERS.slice(0, 6));
      // Project sessions persist init params at `<sessionDir>/config.json`.
      writeFileSync(
        join(harness.sessionDir, "config.json"),
        JSON.stringify({ primerLibraries: "bundled" }),
      );

      for (const name of ["p1.md", "p2.md", "p3.md", "p4.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt]);
        expect(result.status).toBe(0);
        const received = readFileSync(harness.capture, "utf8");
        expect(received.length).toBeGreaterThan(BRIEF.length);
        for (const marker of MARKERS.slice(0, 6)) {
          expect(markerPresent(received, marker)).toBe(false);
        }
      }
    });
  }, 40_000);

  it("restricts a comma-separated list to the named libraries", async () => {
    await withHarness("wordtaste-libs-named-", async (harness) => {
      const primers = join(harness.home, ".pneuma", "primers");
      writeLibrary(join(primers, "mine"), MARKERS.slice(0, 6));
      writeLibrary(join(primers, "other"), MARKERS.slice(6, 12));
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "mine" }),
      );

      let sawMine = false;
      for (const name of ["n1.md", "n2.md", "n3.md", "n4.md", "n5.md", "n6.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt]);
        expect(result.status).toBe(0);
        const received = readFileSync(harness.capture, "utf8");
        for (const marker of MARKERS.slice(6, 12)) {
          expect(markerPresent(received, marker)).toBe(false);
        }
        if (MARKERS.slice(0, 6).some((marker) => markerPresent(received, marker))) {
          sawMine = true;
        }
      }
      expect(sawMine).toBe(true);
    });
  }, 60_000);

  it("drops a path-shaped library name instead of walking out of the primer roots", async () => {
    await withHarness("wordtaste-libs-traversal-", async (harness) => {
      const outside = join(harness.root, "outside");
      writeLibrary(outside, MARKERS.slice(0, 12));
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "../../outside, .. , ." }),
      );

      for (const name of ["x1.md", "x2.md", "x3.md", "x4.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt]);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const received = readFileSync(harness.capture, "utf8");
        for (const marker of MARKERS.slice(0, 12)) {
          expect(markerPresent(received, marker)).toBe(false);
        }
        // The bundled library still primes the prompt.
        expect(received.length).toBeGreaterThan(BRIEF.length);
      }
    });
  }, 40_000);

  it("skips a user library directory that carries no library.json", async () => {
    await withHarness("wordtaste-libs-unmarked-", async (harness) => {
      const primers = join(harness.home, ".pneuma", "primers");
      writeLibrary(join(primers, "loose"), MARKERS.slice(0, 12), { withManifest: false });
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "all" }),
      );

      for (const name of ["s1.md", "s2.md", "s3.md", "s4.md", "s5.md", "s6.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt]);
        expect(result.status).toBe(0);
        const received = readFileSync(harness.capture, "utf8");
        for (const marker of MARKERS.slice(0, 12)) {
          expect(markerPresent(received, marker)).toBe(false);
        }
      }
    });
  }, 60_000);

  it("also resolves a named library under the project root", async () => {
    await withHarness("wordtaste-libs-projectroot-", async (harness) => {
      const projectRoot = join(harness.root, "project");
      const mine = join(projectRoot, ".pneuma", "primers", "team");
      writeLibrary(mine, MARKERS.slice(0, 12));
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "config.json"),
        JSON.stringify({ primerLibraries: "team" }),
      );

      let found = false;
      for (const name of ["t1.md", "t2.md", "t3.md", "t4.md"]) {
        const prompt = writePrompt(harness, name);
        const result = await runRouter(harness, ["writer", prompt], {
          PNEUMA_PROJECT_ROOT: projectRoot,
        });
        expect(result.status).toBe(0);
        if (MARKERS.slice(0, 12).some((marker) => markerPresent(readFileSync(harness.capture, "utf8"), marker))) {
          found = true;
        }
      }
      expect(found).toBe(true);
    });
  }, 40_000);
});

describe("brief lint", () => {
  const MARKED_BAD = [
    "<!-- brief:start -->",
    "这一段要让读者明白问题在哪里。",
    "注意收束，把节奏方向压住。",
    "<!-- brief:end -->",
    "",
    "前面已经写好的话：",
    "秋天来的时候，院子里只剩下两棵树。",
    "",
  ].join("\n");

  const MARKED_GOOD = [
    "<!-- brief:start -->",
    "这一段要让读者明白问题在哪里。",
    "前面已经说过的例子别重复。",
    "最后这几句的意思一个字不能改。",
    "<!-- brief:end -->",
    "",
    "前面已经写好的话：",
    "秋天来的时候，院子里只剩下两棵树。",
    "",
  ].join("\n");

  it("refuses a marked brief that carries orchestration wording, before any dispatch", async () => {
    await withHarness("wordtaste-lint-hard-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md", MARKED_BAD);

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "wordtaste: leaf — the brief contains orchestration wording; rewrite it in plain Chinese\n",
      );
      // Neither the term nor the offending line is echoed.
      expect(result.stderr).not.toContain("收束");
      expect(result.stderr).not.toContain("节奏方向");
      expect(existsSync(harness.capture)).toBe(false);
      expect(existsSync(join(harness.privateDir, "u1.primed.md"))).toBe(false);
    });
  }, 20_000);

  it("accepts a marked brief written in plain Chinese", async () => {
    await withHarness("wordtaste-lint-good-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md", MARKED_GOOD);

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(harness.capture, "utf8").startsWith(MARKED_GOOD)).toBe(true);
    });
  }, 20_000);

  it("ignores orchestration wording that sits outside the marked region", async () => {
    await withHarness("wordtaste-lint-outside-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const withMaterial = `${MARKED_GOOD}这段材料里出现了收束和节奏方向这些词。\n`;
      const prompt = writePrompt(harness, "u1.md", withMaterial);

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(harness.capture, "utf8").startsWith(withMaterial)).toBe(true);
    });
  }, 20_000);

  it("warns but still dispatches when an unmarked prompt carries orchestration wording", async () => {
    await withHarness("wordtaste-lint-warn-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md", "这一段的落点要压住。\n");

      const result = await runRouter(harness, ["writer", prompt], { WORDTASTE_PRIMER_LIBS: lib });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");
      expect(result.stderr).toBe(
        "wordtaste: leaf — note: orchestration wording detected outside the marked brief\n",
      );
      expect(result.stderr).not.toContain("落点要压住");
      expect(existsSync(join(harness.privateDir, "u1.primed.md"))).toBe(true);
      expect(readFileSync(harness.capture, "utf8").startsWith("这一段的落点要压住。\n")).toBe(true);
    });
  }, 20_000);

  it("never lints a checker prompt, whose rubric legitimately uses that vocabulary", async () => {
    await withHarness("wordtaste-lint-checker-", async (harness) => {
      const prompt = writePrompt(harness, "check-1.md", `${MARKED_BAD}`);
      const result = await runRouter(harness, ["checker", prompt]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(harness.capture, "utf8")).toBe(MARKED_BAD);
    });
  }, 20_000);

  it("does not spend a repair cycle on a brief it refuses", async () => {
    await withHarness("wordtaste-lint-budget-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const bad = writePrompt(harness, "u1.repair-1.md", MARKED_BAD);
      const good = writePrompt(harness, "u1.repair-2.md");

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const refused = await runRouter(harness, ["repair", bad, "u1-join"], {
          WORDTASTE_PRIMER_LIBS: lib,
        });
        expect(refused.status).toBe(6);
      }
      expect(existsSync(join(harness.sessionDir, ".pneuma", "repair-budget", "u1-join.count"))).toBe(
        false,
      );

      // The two real repair cycles are still available afterwards.
      for (let cycle = 1; cycle <= 2; cycle += 1) {
        const allowed = await runRouter(harness, ["repair", good, "u1-join"], {
          WORDTASTE_PRIMER_LIBS: lib,
        });
        expect(allowed.status).toBe(0);
      }
      const exhausted = await runRouter(harness, ["repair", good, "u1-join"], {
        WORDTASTE_PRIMER_LIBS: lib,
      });
      expect(exhausted.status).toBe(5);
    });
  }, 30_000);

  it("can be switched off with WORDTASTE_BRIEF_LINT=0", async () => {
    await withHarness("wordtaste-lint-off-", async (harness) => {
      const lib = join(harness.root, "lib");
      writeLibrary(lib, MARKERS.slice(0, 6));
      const prompt = writePrompt(harness, "u1.md", MARKED_BAD);

      const result = await runRouter(harness, ["writer", prompt], {
        WORDTASTE_PRIMER_LIBS: lib,
        WORDTASTE_BRIEF_LINT: "0",
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(harness.capture, "utf8").startsWith(MARKED_BAD)).toBe(true);
    });
  }, 20_000);

  it("ships the jargon list next to the primer, one term per line", () => {
    const list = readFileSync(
      join(import.meta.dir, "..", "skill", "references", "primer", "brief-lint.txt"),
      "utf8",
    );
    const terms = list.split("\n").filter((line) => line.trim().length > 0);
    expect(terms).toContain("落点");
    expect(terms).toContain("收束");
    expect(terms).toContain("换挡");
    expect(terms).toContain("立住");
    expect(terms).toContain("节奏方向");
    expect(terms).toContain("功能角色");
    expect(terms).toContain("写作单元");
    expect(terms).toContain("本单元");
    expect(terms).toContain("当前单元");
    expect(terms).toContain("落笔重点");
    expect(terms).toContain("主线");
    for (const term of terms) expect(term).toBe(term.trim());
  });
});
