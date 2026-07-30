import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const cycleScript = join(scriptsDir, "run_check_cycle.sh");
const projectionScript = join(scriptsDir, "project_check_cycle.sh");

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
      '      printf \'{"pass":false,"kernelOk":true,"issues":[{"kind":"style","quote":"bad","problem":"SECRET_JUDGE_STYLE"}]}\\n\'',
      "    fi",
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
        ["bash", cycleScript, draft, brief, "whole-article", result],
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
          "bash",
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
          "bash",
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
        ["bash", cycleScript, candidate, brief, "whole-article", result],
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
          "bash",
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
