import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const composerPath = join(scriptsDir, "compose_leaf_prompt.ts");
const routerPath = join(scriptsDir, "run_leaf.ts");
const fixturesDir = join(import.meta.dir, "fixtures");

const COMPOSED_MARKER = "<!-- wordtaste:composed v1 -->";
const SYSTEM_PART = "system.en.md";

/**
 * The three sentences that frame the draft so far. They are pinned here as
 * literals, not read out of the scaffolding file, because their position is
 * the claim: the writer reads the finished text last and is told, on the last
 * line of the prompt, to carry straight on from where it stops.
 */
const PRECEDING_HEADING = "## The text so far — you are continuing it";
const PRECEDING_CLOSING =
  "Continue directly from where that text stops. Output only your own section.";
const WRITE_NOW = "Write the section now, in Chinese.";

/**
 * The first line of the standing system charter, pinned as a literal: the
 * persona lives in `system.en.md` now, not in the task message, and these
 * tests assert both halves of that move.
 */
const CHARTER_OPENING = "You are a writer of long-form Chinese knowledge essays.";

/**
 * Everything below is synthetic: invented author tokens, generated filler
 * sentences, and an invented essay. Every spawn gets its own HOME,
 * PNEUMA_SESSION_DIR, and PNEUMA_PROJECT_ROOT under a temp dir, so the
 * composer can never reach a real primer library.
 */
const MARKERS = ["甲", "乙", "丙", "丁", "戊", "己"] as const;

function paragraph(chars: number, marker: string): string {
  const sentence = `这是一段${marker}类测试文字没来源只用来凑字数。`;
  return sentence.repeat(Math.max(1, Math.round(chars / sentence.length)));
}

function writeLibrary(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "library.json"), JSON.stringify({ name: "synthetic" }));
  MARKERS.forEach((marker, index) => {
    const body = [220, 260, 240, 200, 280]
      .map((n) => paragraph(n, marker))
      .join("\n\n");
    const front = ["---", `author: 作者${marker}`, `title: piece-${index}`, "---", ""]
      .join("\n");
    writeFileSync(join(dir, `piece-${index}.md`), `${front}${body}\n`);
  });
}

const BRIEF_EN =
  [
    "This is the opening section of an essay about how a workshop splits its two benches.",
    "Readers already build things; do not explain what a bench is.",
    "Walk through one complete job first, then name the two benches. Stop there.",
  ].join("\n") + "\n";

const MATERIAL =
  [
    "# 两张工作台",
    "",
    "第一张台子只做粗活，三年里换过四套夹具，大部分时候够用。",
    "",
    "第二张台子做细活，谁也不许在上面放锤子。",
  ].join("\n") + "\n";

const KERNEL = "「三年里换过四套夹具」这句里的数字一个都不能改。\n";
const PRECEDING = "上一节说完了那间屋子的门朝哪边开。\n";
const ISSUES = "第二段把「大部分时候」写成了「一直」。\n";
const CURRENT = "两张台子的事，先说清楚第一张。它一直够用。\n";
const CONSTRAINTS_EN = "- First line: the author's own title, exactly as it appears in the material.\n";

/**
 * The two parts `voice_sample.ts` writes. Directives are English, because the
 * distill model writes English; the Chinese is the user's own, verbatim — here
 * an invented hand edit and an invented paragraph of theirs.
 */
const VOICE_STYLE = [
  "Open on the concrete case, never on a definition.",
  'Never open a paragraph with "值得注意的是".',
  "",
].join("\n");
const VOICE_EXAMPLES = [
  "- 这个问题值得注意的是并不简单。",
  "+ 这个问题不简单。",
  "",
  "他想了很久，最后还是把那套夹具换了。换完那天谁也没提这件事。",
  "",
].join("\n");

interface Harness {
  root: string;
  parts: string;
  lib: string;
  sessionDir: string;
  env: Record<string, string>;
}

function makeHarness(prefix: string, partsName = "u1"): Harness {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const sessionDir = join(root, "session");
  const parts = join(root, "parts", partsName);
  const lib = join(root, "lib");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(sessionDir, ".pneuma"), { recursive: true });
  mkdirSync(parts, { recursive: true });
  writeLibrary(lib);

  return {
    root,
    parts,
    lib,
    sessionDir,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      PNEUMA_SESSION_DIR: sessionDir,
      PNEUMA_PROJECT_ROOT: home,
      WORDTASTE_PRIMER_LIBS: lib,
    },
  };
}

async function compose(
  harness: Harness,
  outFile: string,
  extraEnv: Record<string, string> = {},
  partsDir: string = harness.parts,
) {
  const proc = Bun.spawn([process.execPath, composerPath, partsDir, outFile], {
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

function writeRequiredParts(harness: Harness): void {
  writeFileSync(join(harness.parts, "brief.en.md"), BRIEF_EN);
  writeFileSync(join(harness.parts, "material.md"), MATERIAL);
}

function writeVoiceParts(
  harness: Harness,
  style: string | null = VOICE_STYLE,
  examples: string | null = VOICE_EXAMPLES,
): void {
  if (style !== null) {
    writeFileSync(join(harness.parts, "voice_style.en.md"), style);
  }
  if (examples !== null) {
    writeFileSync(join(harness.parts, "voice_examples.md"), examples);
  }
}

/** The text between a tag's own lines, exclusive. */
function blockBetween(text: string, tag: string): string | null {
  const open = `<${tag}>\n`;
  const close = `\n</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start);
  if (end < 0) return null;
  return text.slice(start + open.length, end + 1);
}

async function withHarness(
  prefix: string,
  fn: (harness: Harness) => Promise<void>,
  partsName?: string,
): Promise<void> {
  const harness = makeHarness(prefix, partsName);
  try {
    await fn(harness);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
}

describe("compose_leaf_prompt.ts", () => {
  it("assembles the sections in a fixed order behind the composed marker", async () => {
    await withHarness("wordtaste-compose-order-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      writeVoiceParts(harness);
      const out = join(harness.parts, "prompt.md");

      const result = await compose(harness, out);
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });

      const text = readFileSync(out, "utf8");
      expect(text.split("\n")[0]).toBe(COMPOSED_MARKER);

      // Two positions carry a claim. The user's voice sits after the reference
      // prose, because its own framing says it wins where the two disagree and
      // a claim like that only holds if the writer reads it after what it
      // overrides. The draft so far sits last of everything, past the
      // constraints, because continuation is what the writer does first and
      // the momentum it picks up is the momentum of whatever it read last.
      const order = [
        "## What you are writing",
        "## Source material",
        "<material>",
        "## What must survive",
        "<must_keep>",
        "## What to fix",
        "<issues>",
        "## How it should read",
        "<reference_prose>",
        "## The voice of the person this is for",
        "<user_voice>",
        "</user_voice>",
        "## Constraints",
        WRITE_NOW,
        PRECEDING_HEADING,
        "<preceding_prose>",
        "</preceding_prose>",
        PRECEDING_CLOSING,
      ];
      let cursor = 0;
      for (const marker of order) {
        const at = text.indexOf(marker, cursor);
        expect([marker, at > -1]).toEqual([marker, true]);
        cursor = at;
      }
    });
  }, 20_000);

  /**
   * The tail, byte for byte. The finished text is the last thing the writer
   * reads and the instruction to carry on from it is the last line of the
   * whole prompt — nothing follows it, not even the standing constraints.
   */
  it("ends on the draft so far, with the continuation instruction last", async () => {
    await withHarness("wordtaste-compose-tail-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out, { WORDTASTE_PRIMER: "0" })).status).toBe(0);
      const text = readFileSync(out, "utf8");

      expect(text.endsWith([
        WRITE_NOW,
        "",
        PRECEDING_HEADING,
        "",
        "<preceding_prose>",
        PRECEDING.trimEnd(),
        "</preceding_prose>",
        "",
        PRECEDING_CLOSING,
        "",
      ].join("\n"))).toBe(true);

      // Past the constraints, not before them.
      expect(text.indexOf(PRECEDING_HEADING)).toBeGreaterThan(
        text.indexOf("## Constraints"),
      );
      // The old mid-prompt heading is gone, not merely moved.
      expect(text).not.toContain("## What comes before this section");
    });
  }, 20_000);

  // The composer's own sentences moved out of the script and into
  // `references/prompt-scaffolding.en.json`, so that the Claude Workflow path
  // can assemble the same prompt from the same source; the standing treatment
  // sentences then moved again, into the system charter written beside the
  // prompt (0.14.0). These goldens pin both halves of the split. Regenerate
  // them only when the wording is meant to change, and say so in the same
  // commit.
  it("composes the recorded prompt and its charter byte for byte", async () => {
    await withHarness("wordtaste-compose-golden-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      const out = join(harness.parts, "prompt.md");

      // Priming off: the passages are sampled, so only the scaffolding around
      // them is byte-stable across runs.
      const result = await compose(harness, out, { WORDTASTE_PRIMER: "0" });
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(out, "utf8")).toBe(
        readFileSync(join(fixturesDir, "leaf-prompt.golden.md"), "utf8"),
      );
      expect(readFileSync(join(harness.parts, SYSTEM_PART), "utf8")).toBe(
        readFileSync(join(fixturesDir, "leaf-system.golden.md"), "utf8"),
      );
    });
  }, 20_000);

  /**
   * A repair is the same writer prompt with two more parts, so it obeys the
   * same order rule: the section it is revising sits right after what must
   * survive, the list of problems keeps its own place further down, and the
   * draft so far is still the last thing read. The repairer reads its own text
   * framed as a writer, never a judge's brief — and the writer's persona now
   * lives in the charter beside the prompt, not in the task message.
   */
  it("places the section under repair after what must survive", async () => {
    await withHarness("wordtaste-compose-current-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "current.md"), CURRENT);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(blockBetween(text, "current_text")).toBe(CURRENT);

      const order = [
        "<material>",
        "## What must survive",
        "<must_keep>",
        "## The section as it stands",
        "<current_text>",
        "## What to fix",
        "<issues>",
        "## Constraints",
        WRITE_NOW,
        PRECEDING_HEADING,
        "<preceding_prose>",
      ];
      let cursor = 0;
      for (const marker of order) {
        const at = text.indexOf(marker, cursor);
        expect([marker, at > -1]).toEqual([marker, true]);
        cursor = at;
      }
      // The writer framing is the charter beside the prompt, not a rubric —
      // and its repair rule is present, because the repair blocks are.
      const system = readFileSync(join(harness.parts, SYSTEM_PART), "utf8");
      expect(system.startsWith(CHARTER_OPENING)).toBe(true);
      expect(system).toContain("`<current_text>` with `<issues>` — a repair.");
      expect(text.trimEnd().endsWith(PRECEDING_CLOSING)).toBe(true);
    });
  }, 20_000);

  it("puts the section under repair straight after the material when nothing is frozen", async () => {
    await withHarness("wordtaste-compose-current-nokernel-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "current.md"), CURRENT);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).not.toContain("<must_keep>");
      expect(text.indexOf("<current_text>")).toBeGreaterThan(
        text.indexOf("</material>"),
      );
    });
  }, 20_000);

  // The repair prompt is a composed writer prompt with two extra parts, and
  // these goldens are the whole of it: the task message, and the charter whose
  // typology gains the repair rule because the repair blocks are present.
  it("composes the recorded repair prompt and its charter byte for byte", async () => {
    await withHarness("wordtaste-compose-repair-golden-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "current.md"), CURRENT);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      const out = join(harness.parts, "prompt.md");

      const result = await compose(harness, out, { WORDTASTE_PRIMER: "0" });
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(out, "utf8")).toBe(
        readFileSync(join(fixturesDir, "repair-prompt.golden.md"), "utf8"),
      );
      expect(readFileSync(join(harness.parts, SYSTEM_PART), "utf8")).toBe(
        readFileSync(join(fixturesDir, "repair-system.golden.md"), "utf8"),
      );
    });
  }, 20_000);

  it("copies the author's material through byte for byte", async () => {
    await withHarness("wordtaste-compose-verbatim-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(blockBetween(text, "material")).toBe(MATERIAL);
      expect(blockBetween(text, "must_keep")).toBe(KERNEL);
      expect(blockBetween(text, "preceding_prose")).toBe(PRECEDING);
    });
  }, 20_000);

  it("leaves out every optional part that was not prepared", async () => {
    await withHarness("wordtaste-compose-minimal-", async (harness) => {
      writeRequiredParts(harness);
      // An empty optional part is the same as an absent one: no empty block.
      writeFileSync(join(harness.parts, "kernel.md"), "");
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      for (const tag of ["must_keep", "current_text", "preceding_prose", "issues"]) {
        expect(text).not.toContain(`<${tag}>`);
      }
      expect(text).not.toContain("## What must survive");
      expect(text).not.toContain("## The section as it stands");
      expect(text).not.toContain(PRECEDING_HEADING);
      expect(text).not.toContain("## What to fix");
      // A first unit has no draft behind it, so it gets neither the block nor
      // the line that tells a writer to continue from one: the prompt ends
      // where it always ended, on the constraints and the standing closing.
      expect(text).not.toContain(PRECEDING_CLOSING);
      expect(text.trimEnd().endsWith(WRITE_NOW)).toBe(true);
      // The required halves are still there.
      expect(blockBetween(text, "material")).toBe(MATERIAL);
      expect(text).toContain(BRIEF_EN.trimEnd());
    });
  }, 20_000);

  it("appends extra English constraints as written, after the standing ones", async () => {
    await withHarness("wordtaste-compose-constraints-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      const standing = text.indexOf("- Output the section only.");
      const extra = text.indexOf("- First line: the author's own title");
      expect(standing).toBeGreaterThan(0);
      expect(extra).toBeGreaterThan(standing);
    });
  }, 20_000);

  it("carries reference prose that is the same every time for one parts directory", async () => {
    await withHarness("wordtaste-compose-seed-", async (harness) => {
      writeRequiredParts(harness);
      const first = join(harness.root, "first.md");
      const second = join(harness.root, "second.md");

      expect((await compose(harness, first)).status).toBe(0);
      expect((await compose(harness, second)).status).toBe(0);
      const firstText = readFileSync(first, "utf8");
      expect(readFileSync(second, "utf8")).toBe(firstText);

      const passages = blockBetween(firstText, "reference_prose");
      expect(passages).not.toBeNull();
      expect(
        MARKERS.some((marker) => passages!.includes(`这是一段${marker}类`)),
      ).toBe(true);

      // The Chinese framing lines of the plain-prompt path are not reused: the
      // English sentence around the tag does that job here.
      expect(firstText).not.toContain("动笔之前");
      expect(firstText).not.toContain("读完就放下");
    });
  }, 30_000);

  it("gives two sections of the same essay different reference prose", async () => {
    await withHarness("wordtaste-compose-scope-a-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(
        join(harness.sessionDir, "workflow.json"),
        JSON.stringify({ taskId: "t-1" }),
      );
      const firstOut = join(harness.root, "u1.md");
      expect((await compose(harness, firstOut)).status).toBe(0);

      const otherParts = join(harness.root, "parts", "u2");
      mkdirSync(otherParts, { recursive: true });
      writeFileSync(join(otherParts, "brief.en.md"), BRIEF_EN);
      writeFileSync(join(otherParts, "material.md"), MATERIAL);
      const secondOut = join(harness.root, "u2.md");
      expect(
        (await compose(harness, secondOut, {}, otherParts)).status,
      ).toBe(0);

      expect(blockBetween(readFileSync(secondOut, "utf8"), "reference_prose"))
        .not.toBe(blockBetween(readFileSync(firstOut, "utf8"), "reference_prose"));
    });
  }, 30_000);

  it("writes no Chinese of its own — every Chinese sentence sits inside a quoted block", async () => {
    await withHarness("wordtaste-compose-english-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "current.md"), CURRENT);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      writeVoiceParts(harness);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      let scaffolding = readFileSync(out, "utf8");
      for (
        const tag of [
          "material",
          "must_keep",
          "current_text",
          "preceding_prose",
          "issues",
          "reference_prose",
          // The directives are English, but they may quote a short Chinese tic
          // to avoid, and the examples are the user's own Chinese. Both live
          // inside this block, so the block is stripped with the others.
          "user_voice",
        ]
      ) {
        const before = scaffolding;
        scaffolding = scaffolding.replace(
          new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"),
          "",
        );
        expect(scaffolding.length).toBeLessThan(before.length);
      }
      // What is left is the script's own scaffolding, not an empty string.
      expect(scaffolding).toContain(COMPOSED_MARKER);
      expect(scaffolding).toContain("Write the section now, in Chinese.");
      expect(scaffolding).toContain(BRIEF_EN.trimEnd());
      // CJK punctuation and ideographs; an em dash is ordinary English
      // typography and stays allowed.
      expect(scaffolding).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
    });
  }, 20_000);

  /**
   * The creation posture (0.15.0). An `entry` part holding the word `idea`
   * flips exactly two lines of the charter — the `<material>` treatment and
   * the closing hard-constraint paragraph — and moves nothing in the task
   * message: the two entries differ in what the writer may do with the
   * material, not in what the material is. The task message is asserted
   * against the same rewrite golden the draft entry composes.
   */
  it("selects the creation charter from the entry part, leaving the task message alone", async () => {
    await withHarness("wordtaste-compose-entry-idea-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      writeFileSync(join(harness.parts, "entry"), "idea\n");
      const out = join(harness.parts, "prompt.md");

      const result = await compose(harness, out, { WORDTASTE_PRIMER: "0" });
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
      // The task message is byte-identical to the rewrite entry's.
      expect(readFileSync(out, "utf8")).toBe(
        readFileSync(join(fixturesDir, "leaf-prompt.golden.md"), "utf8"),
      );

      const system = readFileSync(join(harness.parts, SYSTEM_PART), "utf8");
      expect(system).toBe(
        readFileSync(join(fixturesDir, "leaf-system-idea.golden.md"), "utf8"),
      );
      // The creation posture, in its own words: the material anchors and
      // binds, the development belongs to the writer, and the second hard
      // constraint forbids unsupported facts.
      expect(system.startsWith(CHARTER_OPENING)).toBe(true);
      expect(system).toContain("the anchor of the essay rather than its finished text");
      expect(system).toContain("You are expected to develop");
      expect(system).toContain("Two things are hard constraints");
      expect(system).toContain("stay at the level of common knowledge or explicit generality");
      // The rewrite-only sentences are gone, not merely joined.
      expect(system).not.toContain("the only source of facts");
      expect(system).not.toContain("One thing is a hard constraint");
      // Still entirely English.
      expect(system).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
    });
  }, 20_000);

  it("treats anything but the exact word idea as the rewrite default", async () => {
    await withHarness("wordtaste-compose-entry-default-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      const out = join(harness.parts, "prompt.md");

      // An explicit `draft`, an unknown word, and an empty part all compose
      // the same bytes as no part at all — the recorded rewrite charter.
      for (const stray of ["draft\n", "creation\n", ""]) {
        writeFileSync(join(harness.parts, "entry"), stray);
        const result = await compose(harness, out, { WORDTASTE_PRIMER: "0" });
        expect([stray, result.status]).toEqual([stray, 0]);
        expect([stray, readFileSync(join(harness.parts, SYSTEM_PART), "utf8")]).toEqual([
          stray,
          readFileSync(join(fixturesDir, "leaf-system.golden.md"), "utf8"),
        ]);
        expect(readFileSync(out, "utf8")).toBe(
          readFileSync(join(fixturesDir, "leaf-prompt.golden.md"), "utf8"),
        );
      }
    });
  }, 20_000);

  it("refuses a scaffolding whose creation variant is missing", async () => {
    await withHarness("wordtaste-compose-entry-scaffold-", async (harness) => {
      writeRequiredParts(harness);
      // An installed skill whose scaffolding lost the idea variant would
      // compose the word "undefined" into a charter; it must refuse instead,
      // whichever entry the parts carry.
      const skill = join(harness.root, "skill");
      mkdirSync(join(skill, "scripts"), { recursive: true });
      mkdirSync(join(skill, "references"), { recursive: true });
      cpSync(scriptsDir, join(skill, "scripts"), { recursive: true });
      const scaffolding = JSON.parse(
        readFileSync(
          join(import.meta.dir, "..", "skill", "references", "prompt-scaffolding.en.json"),
          "utf8",
        ),
      ) as { system: { given: { material: Record<string, string> } } };
      delete scaffolding.system.given.material.idea;
      writeFileSync(
        join(skill, "references", "prompt-scaffolding.en.json"),
        JSON.stringify(scaffolding, null, 2),
      );

      const out = join(harness.parts, "prompt.md");
      const composer = join(skill, "scripts", "compose_leaf_prompt.ts");
      const broken = Bun.spawn([process.execPath, composer, harness.parts, out], {
        cwd: harness.sessionDir,
        env: harness.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        broken.exited,
        new Response(broken.stdout).text(),
        new Response(broken.stderr).text(),
      ]);
      expect([status, stdout, stderr]).toEqual([
        2,
        "",
        "wordtaste: compose — the English scaffolding file is missing or incomplete\n",
      ]);
      expect(existsSync(out)).toBe(false);
    });
  }, 20_000);

  it("refuses with one neutral line when a required part is missing", async () => {
    await withHarness("wordtaste-compose-missing-", async (harness) => {
      writeFileSync(join(harness.parts, "material.md"), MATERIAL);
      const out = join(harness.parts, "prompt.md");

      const missingBrief = await compose(harness, out);
      expect(missingBrief.status).toBe(2);
      expect(missingBrief.stdout).toBe("");
      expect(missingBrief.stderr).toBe(
        "wordtaste: compose — required part is missing: brief.en.md\n",
      );

      writeFileSync(join(harness.parts, "brief.en.md"), BRIEF_EN);
      rmSync(join(harness.parts, "material.md"));
      const missingMaterial = await compose(harness, out);
      expect(missingMaterial.status).toBe(2);
      expect(missingMaterial.stderr).toBe(
        "wordtaste: compose — required part is missing: material.md\n",
      );

      const missingDir = await compose(
        harness,
        out,
        {},
        join(harness.root, "no-such-parts"),
      );
      expect(missingDir.status).toBe(2);
      expect(missingDir.stderr.split("\n").filter(Boolean)).toHaveLength(1);
    });
  }, 20_000);

  it("refuses an incomplete scaffolding file instead of composing the word null", async () => {
    await withHarness("wordtaste-compose-scaffold-", async (harness) => {
      writeRequiredParts(harness);
      // An installed copy of the skill whose scaffolding lost one key. `jq -r`
      // would print `null` for it and exit 0, so the check has to be explicit.
      const skill = join(harness.root, "skill");
      mkdirSync(join(skill, "scripts"), { recursive: true });
      mkdirSync(join(skill, "references"), { recursive: true });
      cpSync(scriptsDir, join(skill, "scripts"), { recursive: true });
      const scaffolding = JSON.parse(
        readFileSync(
          join(import.meta.dir, "..", "skill", "references", "prompt-scaffolding.en.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const installed = join(skill, "references", "prompt-scaffolding.en.json");
      delete scaffolding.closing;
      writeFileSync(installed, JSON.stringify(scaffolding, null, 2));

      const out = join(harness.parts, "prompt.md");
      const composer = join(skill, "scripts", "compose_leaf_prompt.ts");
      const broken = Bun.spawn([process.execPath, composer, harness.parts, out], {
        cwd: harness.sessionDir,
        env: harness.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        broken.exited,
        new Response(broken.stdout).text(),
        new Response(broken.stderr).text(),
      ]);
      expect([status, stdout, stderr]).toEqual([
        2,
        "",
        "wordtaste: compose — the English scaffolding file is missing or incomplete\n",
      ]);
      expect(existsSync(out)).toBe(false);
    });
  }, 20_000);

  it("carries both voice parts through byte for byte, directives first", async () => {
    await withHarness("wordtaste-compose-voice-body-", async (harness) => {
      writeRequiredParts(harness);
      writeVoiceParts(harness);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      // One block holding the directives, a blank line, then the examples —
      // the sampler copies, and so does the composer.
      expect(blockBetween(text, "user_voice")).toBe(
        `${VOICE_STYLE}\n${VOICE_EXAMPLES}`,
      );
      expect(text.indexOf("Open on the concrete case")).toBeLessThan(
        text.indexOf("- 这个问题值得注意的是并不简单。"),
      );
    });
  }, 20_000);

  it("leaves the block out when the sampler wrote no parts", async () => {
    await withHarness("wordtaste-compose-voice-none-", async (harness) => {
      writeRequiredParts(harness);
      // An empty part is the same as an absent one, exactly as elsewhere.
      writeFileSync(join(harness.parts, "voice_style.en.md"), "");
      writeFileSync(join(harness.parts, "voice_examples.md"), "");
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out)).status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).not.toContain("<user_voice>");
      expect(text).not.toContain("## The voice of the person this is for");
    });
  }, 20_000);

  it("renders the block from either part on its own", async () => {
    await withHarness("wordtaste-compose-voice-style-only-", async (harness) => {
      writeRequiredParts(harness);
      writeVoiceParts(harness, VOICE_STYLE, null);
      const styleOnly = join(harness.root, "style-only.md");
      expect((await compose(harness, styleOnly)).status).toBe(0);
      expect(blockBetween(readFileSync(styleOnly, "utf8"), "user_voice")).toBe(
        VOICE_STYLE,
      );

      rmSync(join(harness.parts, "voice_style.en.md"));
      writeVoiceParts(harness, null, VOICE_EXAMPLES);
      const examplesOnly = join(harness.root, "examples-only.md");
      expect((await compose(harness, examplesOnly)).status).toBe(0);
      expect(blockBetween(readFileSync(examplesOnly, "utf8"), "user_voice")).toBe(
        VOICE_EXAMPLES,
      );
    });
  }, 20_000);

  it("keeps the voice last even when nothing was primed", async () => {
    await withHarness("wordtaste-compose-voice-unprimed-", async (harness) => {
      writeRequiredParts(harness);
      writeVoiceParts(harness);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out, { WORDTASTE_PRIMER: "0" })).status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).not.toContain("<reference_prose>");
      // The reading heading labels the passages, so with nothing sampled the
      // whole section is left out rather than standing empty.
      expect(text).not.toContain("## How it should read");
      // Its place is defined against the constraints, not against a block that
      // may not have been sampled.
      expect(text.indexOf("</user_voice>")).toBeLessThan(
        text.indexOf("## Constraints"),
      );
    });
  }, 20_000);

  // The whole composed prompt with the voice block in it, and the charter
  // whose typology gains the `<user_voice>` rule because the voice parts are
  // present.
  it("composes the recorded prompt with the user's voice byte for byte", async () => {
    await withHarness("wordtaste-compose-voice-golden-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      writeFileSync(join(harness.parts, "constraints.en.md"), CONSTRAINTS_EN);
      writeVoiceParts(harness);
      const out = join(harness.parts, "prompt.md");

      const result = await compose(harness, out, { WORDTASTE_PRIMER: "0" });
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(out, "utf8")).toBe(
        readFileSync(join(fixturesDir, "voice-prompt.golden.md"), "utf8"),
      );
      expect(readFileSync(join(harness.parts, SYSTEM_PART), "utf8")).toBe(
        readFileSync(join(fixturesDir, "voice-system.golden.md"), "utf8"),
      );
    });
  }, 20_000);

  it("composes without the reference block when priming is switched off", async () => {
    await withHarness("wordtaste-compose-noprimer-", async (harness) => {
      writeRequiredParts(harness);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out, { WORDTASTE_PRIMER: "0" })).status)
        .toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).not.toContain("<reference_prose>");
      expect(text).not.toContain("## How it should read");
      expect(text.trimEnd().endsWith("Write the section now, in Chinese.")).toBe(
        true,
      );
    });
  }, 20_000);

  /**
   * The system/user split itself. The treatment sentences live in the charter
   * and only there; the task message keeps the short labels and the blocks.
   * Saying a rule in both places would double its weight, so the absence from
   * the task message is as much the contract as the presence in the charter.
   */
  it("says each treatment rule once — in the charter, not in the task message", async () => {
    await withHarness("wordtaste-compose-split-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      const out = join(harness.parts, "prompt.md");

      expect((await compose(harness, out, { WORDTASTE_PRIMER: "0" })).status).toBe(0);
      const prompt = readFileSync(out, "utf8");
      const system = readFileSync(join(harness.parts, SYSTEM_PART), "utf8");

      for (const movedSentence of [
        "the only source of facts. Keep every number, name, and qualification",
        "sentences whose meaning must survive exactly",
        "pick up its momentum and its register",
        "a person explaining rather than a system describing itself",
      ]) {
        expect([movedSentence, system.includes(movedSentence)]).toEqual([movedSentence, true]);
        expect([movedSentence, prompt.includes(movedSentence)]).toEqual([movedSentence, false]);
      }
      // The task message begins at the brief, right after the marker.
      expect(prompt.split("\n").slice(0, 3)).toEqual([
        COMPOSED_MARKER,
        "",
        "## What you are writing",
      ]);
      // The charter is entirely English — it quotes nothing.
      expect(system).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
    });
  }, 20_000);

  /**
   * The charter varies only by which blocks the task message carries: the
   * standing paragraphs are shared to the byte, and the typology gains or
   * loses exactly the entries whose blocks appear.
   */
  it("varies the charter only by the blocks that are present", async () => {
    await withHarness("wordtaste-compose-system-variants-", async (harness) => {
      writeRequiredParts(harness);
      const firstUnit = join(harness.root, "first-unit.md");
      expect((await compose(harness, firstUnit, { WORDTASTE_PRIMER: "0" })).status).toBe(0);
      const firstSystem = readFileSync(join(harness.root, SYSTEM_PART), "utf8");

      writeFileSync(join(harness.parts, "kernel.md"), KERNEL);
      writeFileSync(join(harness.parts, "current.md"), CURRENT);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      writeFileSync(join(harness.parts, "preceding.md"), PRECEDING);
      const repair = join(harness.root, "repair.md");
      expect((await compose(harness, repair, { WORDTASTE_PRIMER: "0" })).status).toBe(0);
      const repairSystem = readFileSync(join(harness.root, SYSTEM_PART), "utf8");

      // One charter, prefix-shared to the byte through the standing paragraphs
      // and the first typology entry.
      const shared = `${firstSystem.split("- `<material>`")[0]}- \`<material>\``;
      expect(repairSystem.startsWith(shared)).toBe(true);

      // A first unit's charter has no preceding rule and no repair rule…
      expect(firstSystem).not.toContain("`<preceding_prose>`");
      expect(firstSystem).not.toContain("`<current_text>`");
      expect(firstSystem).not.toContain("`<must_keep>`");
      // …and the repair's has all three.
      expect(repairSystem).toContain("`<preceding_prose>` — the finished draft so far");
      expect(repairSystem).toContain("`<current_text>` with `<issues>` — a repair.");
      expect(repairSystem).toContain("`<must_keep>` — sentences whose meaning must survive");
      // Neither was primed and neither has voice parts, so neither names them.
      for (const system of [firstSystem, repairSystem]) {
        expect(system).not.toContain("`<reference_prose>`");
        expect(system).not.toContain("`<user_voice>`");
        expect(system).toContain("`Constraints` — the requirements of this one task.");
      }
    });
  }, 20_000);
});

describe("run_leaf.ts with a composed prompt", () => {
  function installStubs(harness: Harness): {
    bin: string;
    capture: string;
    argvCapture: string;
  } {
    const bin = join(harness.root, "bin");
    const capture = join(harness.root, "capture.txt");
    const argvCapture = join(harness.root, "argv.txt");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(harness.sessionDir, ".pneuma", "cross-family.json"),
      '{"claude":true,"codex":true}\n',
    );
    writeFileSync(
      join(bin, "claude"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" > "${WORDTASTE_TEST_ARGV}"',
        'command cat > "${WORDTASTE_TEST_CAPTURE}"',
        'printf "leaf-result\\n"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "codex"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" > "${WORDTASTE_TEST_ARGV}"',
        'out=""',
        "while [[ $# -gt 0 ]]; do",
        '  if [[ "$1" == "--output-last-message" ]]; then out="$2"; shift 2; else shift; fi',
        "done",
        'command cat > "${WORDTASTE_TEST_CAPTURE}"',
        'printf "leaf-result\\n" > "${out}"',
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "claude"), 0o755);
    chmodSync(join(bin, "codex"), 0o755);
    return { bin, capture, argvCapture };
  }

  async function dispatch(
    harness: Harness,
    bin: string,
    capture: string,
    args: string[],
    extraEnv: Record<string, string> = {},
  ) {
    const proc = Bun.spawn([process.execPath, routerPath, ...args], {
      cwd: harness.sessionDir,
      env: {
        ...harness.env,
        PATH: `${bin}:/usr/bin:/bin`,
        WORDTASTE_TEST_CAPTURE: capture,
        WORDTASTE_TEST_ARGV: join(harness.root, "argv.txt"),
        ...extraEnv,
      },
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

  it("dispatches a composed prompt unchanged, without priming it a second time", async () => {
    await withHarness("wordtaste-composed-dispatch-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      const composed = readFileSync(prompt, "utf8");

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");
      expect(result.stderr).toBe("");
      expect(readFileSync(capture, "utf8")).toBe(composed);
      // No `.primed.md` twin, and the reference block appears exactly once.
      expect(composed.split("<reference_prose>")).toHaveLength(2);
      expect(readFileSync(prompt, "utf8")).toBe(composed);
    });
  }, 30_000);

  /**
   * The Claude channel: the charter travels as `--system-prompt-file` — a
   * path in argv, never contents — replacing that CLI's own default system
   * prompt, while stdin stays the task message byte for byte.
   */
  it("hands the Claude CLI the charter as a system prompt file", async () => {
    await withHarness("wordtaste-composed-claude-system-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture, argvCapture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      const system = readFileSync(join(harness.parts, SYSTEM_PART), "utf8");

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");

      const argv = readFileSync(argvCapture, "utf8").split("\n");
      const flagAt = argv.indexOf("--system-prompt-file");
      expect(flagAt).toBeGreaterThan(-1);
      const namedFile = argv[flagAt + 1]!;
      expect(namedFile.endsWith(`/${SYSTEM_PART}`)).toBe(true);
      expect(readFileSync(namedFile, "utf8")).toBe(system);
      // The contents stay out of argv, and stdin is still the task message.
      expect(argv).not.toContain(CHARTER_OPENING);
      expect(readFileSync(capture, "utf8")).toBe(readFileSync(prompt, "utf8"));
    });
  }, 30_000);

  /**
   * The Codex channel: no system role exists, so the charter is prepended to
   * the one message with a blank line between — the documented degradation,
   * and the same bytes the workflow path hands `agent()`.
   */
  it("prepends the charter for Codex, which has no system channel", async () => {
    await withHarness("wordtaste-composed-codex-system-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture, argvCapture } = installStubs(harness);
      // Only codex answers, so the writer falls back to it.
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "cross-family.json"),
        '{"claude":false,"codex":true}\n',
      );
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      const system = readFileSync(join(harness.parts, SYSTEM_PART), "utf8");
      const composed = readFileSync(prompt, "utf8");

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");
      expect(readFileSync(capture, "utf8")).toBe(`${system}\n${composed}`);
      // The charter rode the payload, not the argv.
      expect(readFileSync(argvCapture, "utf8")).not.toContain("--system-prompt-file");
    });
  }, 30_000);

  /**
   * Backward compatibility is byte-exact: without the sibling file the
   * dispatch is what it always was, on both CLI channels.
   */
  it("dispatches exactly as before when no system file is present", async () => {
    await withHarness("wordtaste-composed-nosystem-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture, argvCapture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      rmSync(join(harness.parts, SYSTEM_PART));
      const composed = readFileSync(prompt, "utf8");

      const viaClaude = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(viaClaude.status).toBe(0);
      expect(readFileSync(capture, "utf8")).toBe(composed);
      expect(readFileSync(argvCapture, "utf8")).not.toContain("--system-prompt-file");

      writeFileSync(
        join(harness.sessionDir, ".pneuma", "cross-family.json"),
        '{"claude":false,"codex":true}\n',
      );
      const viaCodex = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(viaCodex.status).toBe(0);
      expect(readFileSync(capture, "utf8")).toBe(composed);
    });
  }, 30_000);

  /**
   * Checker and planner keep their single-message prompts: a stray
   * `system.en.md` beside whatever prompt they are handed changes nothing.
   */
  it("never attaches a system file to a checker dispatch", async () => {
    await withHarness("wordtaste-composed-checker-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture, argvCapture } = installStubs(harness);
      // Route the checker to the claude stub, whose argv capture we read.
      writeFileSync(
        join(harness.sessionDir, ".pneuma", "cross-family.json"),
        '{"claude":true,"codex":false}\n',
      );
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      expect(readFileSync(join(harness.parts, SYSTEM_PART), "utf8").length).toBeGreaterThan(0);

      const result = await dispatch(harness, bin, capture, ["checker", prompt]);
      expect(result.status).toBe(0);
      expect(readFileSync(argvCapture, "utf8")).not.toContain("--system-prompt-file");
      expect(readFileSync(capture, "utf8")).toBe(readFileSync(prompt, "utf8"));
    });
  }, 30_000);

  it("notes Chinese in the English brief and dispatches anyway", async () => {
    await withHarness("wordtaste-composed-cjk-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(
        join(harness.parts, "brief.en.md"),
        `${BRIEF_EN}The author calls this bench 细活台; keep that word.\n`,
      );
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("leaf-result\n");
      expect(result.stderr).toBe(
        "wordtaste: leaf — note: the English brief carries Chinese; a writer reads every sentence of it as a style sample\n",
      );
      // The note never quotes what it found.
      expect(result.stderr).not.toContain("细活台");
      expect(readFileSync(capture, "utf8")).toBe(readFileSync(prompt, "utf8"));
    });
  }, 30_000);

  it("says nothing when the composed prompt has no brief beside it", async () => {
    await withHarness("wordtaste-composed-nobrief-", async (harness) => {
      writeRequiredParts(harness);
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.root, "detached.md");
      expect((await compose(harness, prompt)).status).toBe(0);
      // Composed elsewhere, with no `brief.en.md` sibling to look at.
      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(capture, "utf8")).toBe(readFileSync(prompt, "utf8"));
    });
  }, 30_000);

  it("goes quiet on the composed path too when the lint is switched off", async () => {
    await withHarness("wordtaste-composed-lintoff-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(
        join(harness.parts, "brief.en.md"),
        `${BRIEF_EN}整段中文写在这里。\n`,
      );
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);

      // The same prompt warns with the lint on …
      const warned = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(warned.stderr).toContain("note: the English brief carries Chinese");

      // … and says nothing with it off.
      const off = Bun.spawn([process.execPath, routerPath, "writer", prompt], {
        cwd: harness.sessionDir,
        env: {
          ...harness.env,
          PATH: `${bin}:/usr/bin:/bin`,
          WORDTASTE_TEST_CAPTURE: capture,
          WORDTASTE_BRIEF_LINT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stderr] = await Promise.all([
        off.exited,
        new Response(off.stderr).text(),
      ]);
      expect(status).toBe(0);
      expect(stderr).toBe("");
    });
  }, 30_000);

  it("says nothing about an English brief that is English", async () => {
    await withHarness("wordtaste-composed-clean-", async (harness) => {
      writeRequiredParts(harness);
      // Em dashes, curly quotes and ellipses are English typography.
      writeFileSync(
        join(harness.parts, "brief.en.md"),
        `${BRIEF_EN}Stop before the “how” — that comes later…\n`,
      );
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });
  }, 30_000);

  it("never refuses a composed prompt over the plain-prompt jargon list", async () => {
    await withHarness("wordtaste-composed-nolint-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(
        join(harness.parts, "material.md"),
        `${MATERIAL}作者自己在这段里用了「收束」和「节奏方向」。\n`,
      );
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);

      const result = await dispatch(harness, bin, capture, ["writer", prompt]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(capture, "utf8")).toContain("收束");
    });
  }, 30_000);

  it("still spends a repair cycle when a composed prompt is repaired", async () => {
    await withHarness("wordtaste-composed-budget-", async (harness) => {
      writeRequiredParts(harness);
      writeFileSync(join(harness.parts, "issues.md"), ISSUES);
      const { bin, capture } = installStubs(harness);
      const prompt = join(harness.parts, "prompt.md");
      expect((await compose(harness, prompt)).status).toBe(0);

      for (let cycle = 1; cycle <= 2; cycle += 1) {
        const allowed = await dispatch(harness, bin, capture, [
          "repair",
          prompt,
          "u1-length",
        ]);
        expect(allowed.status).toBe(0);
      }
      const exhausted = await dispatch(harness, bin, capture, [
        "repair",
        prompt,
        "u1-length",
      ]);
      expect(exhausted.status).toBe(5);
    });
  }, 30_000);
});
