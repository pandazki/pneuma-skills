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
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const cycleScript = join(scriptsDir, "run_check_cycle.ts");
const projectionScript = join(scriptsDir, "project_check_cycle.ts");

function makeHarness() {
  const root = mkdtempSync(join("/tmp", "wordtaste-check-cycle-"));
  const bin = join(root, "bin");
  const privateDir = join(root, ".pneuma", "private");
  mkdirSync(bin, { recursive: true });
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(
    join(root, ".pneuma", "cross-family.json"),
    '{"claude":true,"codex":false}\n',
  );
  writeFileSync(
    join(bin, "claude"),
    [
      "#!/usr/bin/env bash",
      'input="$(command cat)"',
      'case "${WORDTASTE_TEST_MODE:-accept}" in',
      "  accept)",
      '    if [[ "${input}" == *WORDTASTE_REPAIR* ]]; then',
      '      printf "fixed candidate\\n"',
      '    elif [[ "${input}" == *"fixed candidate"* ]]; then',
      '      printf \'{"pass":true,"kernelOk":true,"issues":[]}\\n\'',
      "    else",
      '      printf \'{"pass":false,"kernelOk":true,"issues":[{"kind":"meaning","quote":"bad","problem":"SECRET_JUDGE_MEANING"}]}\\n\'',
      "    fi",
      "    ;;",
      "  style)",
      '    printf \'{"pass":false,"kernelOk":true,"issues":[{"kind":"style","quote":"plain","problem":"SECRET_JUDGE_STYLE"}]}\\n\'',
      "    ;;",
      "  blocked)",
      '    if [[ "${input}" == *WORDTASTE_REPAIR* ]]; then',
      '      printf "still unsafe\\n"',
      "    else",
      '      printf \'{"pass":false,"kernelOk":false,"issues":[{"kind":"meaning","quote":"unsafe","problem":"SECRET_JUDGE_MEANING"}]}\\n\'',
      "    fi",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "claude"), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    PNEUMA_SESSION_DIR: root,
    // Hermetic: the repair leg is primed, and priming resolves user libraries
    // from HOME. Point both roots at the harness so the real `~/.pneuma/` is
    // never read.
    HOME: root,
    PNEUMA_PROJECT_ROOT: root,
  };
  return { root, privateDir, env };
}

async function run(
  command: string[],
  cwd: string,
  env: Record<string, string | undefined>,
) {
  const proc = Bun.spawn(command, {
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

function writeWorkflow(root: string) {
  writeFileSync(
    join(root, "workflow.json"),
    JSON.stringify({
      version: 2,
      stage: "review",
      goal: "test",
      layout: { thesis: ["claim"], units: [], openQuestion: "" },
      progress: { currentUnit: "", completedUnits: [], totalUnits: 1, note: "" },
      review: { summary: "", issues: [] },
      candidates: [],
    }),
  );
}

/**
 * The composed repair path. A repairer handed the judge's brief answers like a
 * judge — a real run (unit u8) came back with commentary about the issues
 * instead of prose. So when the caller can name the writer's parts directory,
 * the repair prompt is composed by the same composer that wrote the unit, with
 * the writer's own framing, its own text under `<current_text>`, and the
 * problems under `<issues>`.
 */
function makeComposedHarness() {
  const root = mkdtempSync(join("/tmp", "wordtaste-composed-repair-"));
  const bin = join(root, "bin");
  const privateDir = join(root, ".pneuma", "private");
  const parts = join(privateDir, "u1");
  mkdirSync(bin, { recursive: true });
  mkdirSync(parts, { recursive: true });
  writeFileSync(
    join(root, ".pneuma", "cross-family.json"),
    '{"claude":true,"codex":false,"openrouter":false}\n',
  );

  // The parts the unit was written from. `constraints.en.md` carries the
  // first-unit title line, which a repair must not repeat back.
  writeFileSync(
    join(parts, "brief.en.md"),
    "This is the opening section. Walk through one job, then stop.\n",
  );
  writeFileSync(
    join(parts, "material.md"),
    "# 两张工作台\n\n第一张台子只做粗活，大部分时候够用。\n",
  );
  writeFileSync(join(parts, "kernel.md"), "「大部分时候」不能写成「一直」。\n");
  writeFileSync(
    join(parts, "constraints.en.md"),
    "- First line: the author's own title, exactly as it is given above, on a line of its own.\n",
  );

  // The leaf: a repair is recognised by the writer framing it now carries, not
  // by a marker the judge's brief used to supply. The repair dispatch also
  // records its argv, so the test can see the charter travel as
  // `--system-prompt-file` — checker dispatches never carry that flag.
  writeFileSync(
    join(bin, "claude"),
    [
      "#!/usr/bin/env bash",
      'input="$(command cat)"',
      'if [[ "${input}" == *"<current_text>"* ]]; then',
      '  printf "%s" "${input}" > "${WORDTASTE_TEST_PROMPT_CAPTURE}"',
      '  printf "%s\\n" "$@" > "${WORDTASTE_TEST_ARGV_CAPTURE}"',
      '  printf "composed fixed candidate\\n"',
      'elif [[ "${input}" == *"composed fixed candidate"* ]]; then',
      "  printf '{\"pass\":true,\"kernelOk\":true,\"issues\":[]}\\n'",
      "else",
      "  printf '{\"pass\":false,\"kernelOk\":true,\"issues\":[{\"kind\":\"meaning\",\"quote\":\"它一直够用\",\"problem\":\"SECRET_JUDGE_MEANING flattened a qualification\"}]}\\n'",
      "fi",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "claude"), 0o755);

  const capture = join(root, "repair-prompt.txt");
  const argvCapture = join(root, "repair-argv.txt");
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    PNEUMA_SESSION_DIR: root,
    HOME: root,
    PNEUMA_PROJECT_ROOT: root,
    WORDTASTE_TEST_PROMPT_CAPTURE: capture,
    WORDTASTE_TEST_ARGV_CAPTURE: argvCapture,
  };
  return { root, privateDir, parts, capture, argvCapture, env };
}

describe("composed repair", () => {
  it("frames the repair as writing, not as judging, when given the writer's parts", async () => {
    const { root, privateDir, parts, capture, argvCapture, env } = makeComposedHarness();
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "两张工作台\n\n它一直够用。\n");
    writeFileSync(brief, "You are checking one section. Report quoted evidence only.\n");

    try {
      const checked = await run(
        [process.execPath, cycleScript, candidate, brief, "u1", result, parts],
        root,
        env,
      );
      expect(checked).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({
        outcome: "accepted",
        repairs: 1,
      });
      expect(readFileSync(candidate, "utf8")).toBe("composed fixed candidate\n");

      const prompt = readFileSync(capture, "utf8");
      // A composed writer prompt, from the first line down.
      expect(prompt.split("\n")[0]).toBe("<!-- wordtaste:composed v1 -->");
      expect(prompt).toContain("<current_text>\n两张工作台\n\n它一直够用。\n</current_text>");
      expect(prompt).toContain("<issues>");
      expect(prompt).toContain("它一直够用");
      expect(prompt).toContain("flattened a qualification");
      expect(prompt.trimEnd().endsWith("Write the section now, in Chinese.")).toBe(true);

      // The writer framing rides beside it as the charter, dispatched through
      // the system channel: `--system-prompt-file` names the composed sibling.
      const argv = readFileSync(argvCapture, "utf8").split("\n");
      const flagAt = argv.indexOf("--system-prompt-file");
      expect(flagAt).toBeGreaterThan(-1);
      const systemFile = argv[flagAt + 1]!;
      expect(systemFile.endsWith("/system.en.md")).toBe(true);
      const system = readFileSync(systemFile, "utf8");
      expect(system).toContain("You are a writer of long-form Chinese knowledge essays");
      expect(system).toContain("`<current_text>` with `<issues>` — a repair.");

      // Not the judge's brief, and not the old tail that came with it.
      expect(prompt).not.toContain("You are checking one section");
      expect(prompt).not.toContain("WORDTASTE_REPAIR");
      expect(prompt).not.toContain("Return the complete repaired prose only");
      // The repaired text already opens with the title, so the first-unit
      // constraint is dropped instead of asking for it twice.
      expect(prompt).not.toContain("First line: the author's own title");
      // The unit's own material and frozen sentences came along.
      expect(prompt).toContain("第一张台子只做粗活");
      expect(prompt).toContain("<must_keep>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * A creation unit's repair is the same writing job under the same rules, so
   * the `entry` part rides into the cloned repair parts and the repair's
   * charter keeps the creation posture — material binding, development
   * expected, no unsupported facts.
   */
  it("keeps the creation charter through a composed repair", async () => {
    const { root, privateDir, parts, argvCapture, env } = makeComposedHarness();
    writeFileSync(join(parts, "entry"), "idea\n");
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "两张工作台\n\n它一直够用。\n");
    writeFileSync(brief, "You are checking one section. Report quoted evidence only.\n");

    try {
      const checked = await run(
        [process.execPath, cycleScript, candidate, brief, "u1", result, parts],
        root,
        env,
      );
      expect(checked).toEqual({ status: 0, stdout: "", stderr: "" });

      const argv = readFileSync(argvCapture, "utf8").split("\n");
      const flagAt = argv.indexOf("--system-prompt-file");
      expect(flagAt).toBeGreaterThan(-1);
      const system = readFileSync(argv[flagAt + 1]!, "utf8");
      expect(system).toContain("the anchor of the essay rather than its finished text");
      expect(system).toContain("Two things are hard constraints");
      expect(system).not.toContain("the only source of facts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses a parts directory that is missing or outside the private staging area", async () => {
    const { root, privateDir, parts, env } = makeComposedHarness();
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "两张工作台\n");
    writeFileSync(brief, "You are checking one section.\n");
    const outside = join(root, "parts-outside");
    mkdirSync(outside, { recursive: true });

    try {
      for (const dir of [join(privateDir, "no-such-unit"), outside]) {
        const refused = await run(
          [process.execPath, cycleScript, candidate, brief, "u1", result, dir],
          root,
          env,
        );
        expect([dir, refused.status]).toEqual([dir, 2]);
        expect(refused.stdout).toBe("");
        expect(refused.stderr.split("\n").filter(Boolean)).toHaveLength(1);
      }
      // A refusal happens before anything is checked or written.
      expect(readFileSync(candidate, "utf8")).toBe("两张工作台\n");
      expect(existsSync(result)).toBe(false);
      expect(existsSync(parts)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("private check cycle", () => {
  it("refuses to mutate a canonical draft in place", async () => {
    const { root, privateDir, env } = makeHarness();
    const draft = join(root, "draft.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(draft, "source draft\n");
    writeFileSync(brief, "Preserve the frozen claim.\n");

    try {
      const checked = await run(
        [process.execPath, cycleScript, draft, brief, "whole-article", result],
        root,
        { ...env, WORDTASTE_TEST_MODE: "accept" },
      );
      expect(checked.status).toBe(2);
      expect(checked.stdout).toBe("");
      expect(checked.stderr).toContain("must stay private");
      expect(readFileSync(draft, "utf8")).toBe("source draft\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a style-only report without repairing (advisory, not a gate)", async () => {
    const { root, privateDir, env } = makeHarness();
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "plain candidate\n");
    writeFileSync(brief, "Preserve the frozen claim.\n");
    writeWorkflow(root);
    try {
      const checked = await run(
        [process.execPath, cycleScript, ".pneuma/private/candidate.md", ".pneuma/private/brief.md", "u1", ".pneuma/private/result.json"],
        root,
        { ...env, WORDTASTE_TEST_MODE: "style" },
      );
      expect(checked).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({ outcome: "accepted", repairs: 0, advisory: 1 });
      expect(readFileSync(candidate, "utf8")).toBe("plain candidate\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs and projects an accepted candidate without stdout", async () => {
    const { root, privateDir, env } = makeHarness();
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "bad candidate\n");
    writeFileSync(brief, "Preserve the frozen claim.\n");
    writeWorkflow(root);

    try {
      const checked = await run(
        [
          process.execPath,
          cycleScript,
          ".pneuma/private/candidate.md",
          ".pneuma/private/brief.md",
          "whole-article",
          ".pneuma/private/result.json",
        ],
        root,
        { ...env, WORDTASTE_TEST_MODE: "accept" },
      );
      expect(checked).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({
        outcome: "accepted",
        repairs: 1,
      });
      expect(readFileSync(candidate, "utf8")).toBe("fixed candidate\n");

      const projected = await run(
        [
          process.execPath,
          projectionScript,
          "whole",
          ".pneuma/private/result.json",
          join(root, "workflow.json"),
          ".pneuma/private/candidate.md",
        ],
        root,
        env,
      );
      expect(projected).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(join(root, "draft.md"), "utf8")).toBe(
        "fixed candidate\n",
      );
      expect(JSON.parse(readFileSync(join(root, "workflow.json"), "utf8")))
        .toMatchObject({
          stage: "final",
          review: { summary: "全文检查完成。", issues: [] },
        });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks after two repairs without copying raw judge text or overwriting the draft", async () => {
    const { root, privateDir, env } = makeHarness();
    const candidate = join(privateDir, "candidate.md");
    const brief = join(privateDir, "brief.md");
    const result = join(privateDir, "result.json");
    writeFileSync(candidate, "unsafe candidate\n");
    writeFileSync(brief, "Preserve the frozen claim.\n");
    writeFileSync(join(root, "draft.md"), "existing source draft\n");
    writeWorkflow(root);

    try {
      const checked = await run(
        [process.execPath, cycleScript, candidate, brief, "whole-article", result],
        root,
        { ...env, WORDTASTE_TEST_MODE: "blocked" },
      );
      expect(checked).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({
        outcome: "blocked",
        repairs: 2,
      });

      const projected = await run(
        [
          process.execPath,
          projectionScript,
          "whole",
          result,
          join(root, "workflow.json"),
          candidate,
        ],
        root,
        env,
      );
      expect(projected).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(join(root, "draft.md"), "utf8")).toBe(
        "existing source draft\n",
      );

      const canonical = readFileSync(join(root, "workflow.json"), "utf8");
      expect(JSON.parse(canonical)).toMatchObject({
        stage: "review",
        review: {
          summary: "中心判断、事实或限定仍未稳定，当前版本暂不进入终稿。",
        },
      });
      expect(canonical).not.toContain("SECRET_JUDGE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
