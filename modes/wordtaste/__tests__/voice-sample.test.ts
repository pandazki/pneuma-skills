import { describe, expect, it } from "bun:test";
import {
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

const samplerPath = join(
  import.meta.dir,
  "..",
  "skill",
  "scripts",
  "voice_sample.ts",
);

/**
 * Everything below is synthetic. The "user's" Chinese is invented filler
 * written for this suite: no published text, no real person's writing, and no
 * author's name appears anywhere. Every spawn gets its own temp HOME and its
 * own taste directory, so the sampler can never reach a real content set.
 *
 * What these tests hold the sampler to is the one rule that matters for it:
 * it copies and it samples. Every Chinese character it emits must be findable,
 * byte for byte, in the artifact it read — because the block it feeds sits in
 * front of a writer, and Chinese this repo composed is exactly what the whole
 * prompt pipeline exists to keep out of there.
 */

interface Taste {
  root: string;
  taste: string;
  out: string;
}

function makeTaste(prefix: string): Taste {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const taste = join(root, "taste");
  const out = join(root, "parts");
  mkdirSync(join(taste, "examples", "positive"), { recursive: true });
  mkdirSync(out, { recursive: true });
  return { root, taste, out };
}

async function sample(
  t: Taste,
  seed = "task-1|u1|0",
  tasteDir: string = t.taste,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, samplerPath, tasteDir, t.out, "--seed", seed],
    {
      cwd: t.root,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: join(t.root, "home"),
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        LANG: "en_US.UTF-8",
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
  return { status, stdout, stderr };
}

async function withTaste(prefix: string, fn: (t: Taste) => Promise<void>) {
  const t = makeTaste(prefix);
  try {
    await fn(t);
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
}

function styleFile(t: Taste): string {
  return join(t.out, "voice_style.en.md");
}

function examplesFile(t: Taste): string {
  return join(t.out, "voice_examples.md");
}

/**
 * The `style.en.md` the seeds actually ship, read off disk rather than restated
 * here. Every fresh content set starts with this exact file, so if someone
 * later adds a line to the header that is not a comment, the block would start
 * appearing in every new session's writer prompts with a header in it. Reading
 * the real file is what makes that a test failure instead of a surprise.
 */
const SEED_STYLE_FILES = ["from-idea", "from-draft"].map((seed) =>
  join(import.meta.dir, "..", "seed", seed, "taste", "style.en.md"),
);

const SWAP_PAIRS = [
  { before: "这个问题值得注意的是并不简单。", after: "这个问题不简单。" },
  { before: "他花了非常长的一段时间去思考这件事情。", after: "他想了很久。" },
  { before: "在某种意义上来讲这是可以被理解的。", after: "这说得通。" },
];

function jsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

/** N invented paragraphs, each about `chars` characters long. */
function positivePiece(count: number, chars: number, marker: string): string {
  const sentence = `第${marker}段这是一段没有来源的测试文字只用来凑够长度。`;
  const paragraphs: string[] = [];
  for (let i = 0; i < count; i += 1) {
    paragraphs.push(
      `${i + 1}、${sentence.repeat(Math.max(1, Math.round(chars / sentence.length)))}`,
    );
  }
  return `${paragraphs.join("\n\n")}\n`;
}

describe("voice_sample.ts — the directives", () => {
  it("strips the evidence comments and keeps the imperatives verbatim", async () => {
    await withTaste("wordtaste-voice-style-", async (t) => {
      writeFileSync(
        join(t.taste, "style.en.md"),
        [
          "<!-- This file grows from real judgments. -->",
          'Open on the concrete case, never on a definition. <!-- evidence: swap 2026-08-24#3 -->',
          'Never open a paragraph with "值得注意的是". <!-- evidence: rejected candidate B -->',
          "Keep the qualification in the sentence that makes the claim.",
          "<!-- evidence: hand edit 2026-08-20#1 -->",
          "",
        ].join("\n"),
      );

      const result = await sample(t);
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);

      const lines = readFileSync(styleFile(t), "utf8").split("\n").filter(Boolean);
      expect(lines).toEqual([
        "Open on the concrete case, never on a definition.",
        'Never open a paragraph with "值得注意的是".',
        "Keep the qualification in the sentence that makes the claim.",
      ]);
      // No trace of the audit trail reaches a prompt.
      expect(readFileSync(styleFile(t), "utf8")).not.toContain("evidence:");
      expect(readFileSync(styleFile(t), "utf8")).not.toContain("<!--");
    });
  }, 20_000);

  it("removes a comment that runs across several lines", async () => {
    await withTaste("wordtaste-voice-multiline-", async (t) => {
      writeFileSync(
        join(t.taste, "style.en.md"),
        [
          "Cut the throat-clearing sentence that opens a paragraph.",
          "<!-- evidence: swap 2026-08-24#3,",
          "     and the same edit again in 2026-08-25#1 -->",
          "Let one paragraph carry one move.",
          "",
        ].join("\n"),
      );

      expect((await sample(t)).status).toBe(0);
      expect(readFileSync(styleFile(t), "utf8")).toBe(
        [
          "Cut the throat-clearing sentence that opens a paragraph.",
          "Let one paragraph carry one move.",
          "",
        ].join("\n"),
      );
    });
  }, 20_000);

  it("caps the list at ten directives", async () => {
    await withTaste("wordtaste-voice-cap-", async (t) => {
      const many: string[] = [];
      for (let i = 1; i <= 14; i += 1) {
        many.push(`Directive number ${i} stands here. <!-- evidence: e${i} -->`);
      }
      writeFileSync(join(t.taste, "style.en.md"), `${many.join("\n")}\n`);

      expect((await sample(t)).status).toBe(0);
      const lines = readFileSync(styleFile(t), "utf8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe("Directive number 1 stands here.");
      expect(lines[9]).toBe("Directive number 10 stands here.");
    });
  }, 20_000);

  it("writes no part for the file the seeds ship, which is a comment header and nothing else", async () => {
    for (const seedFile of SEED_STYLE_FILES) {
      await withTaste("wordtaste-voice-seeded-", async (t) => {
        const seeded = readFileSync(seedFile, "utf8");
        // The shipped header really is comments only — the sampler's silence
        // below would otherwise be proving nothing.
        expect([seedFile, /^\s*$|^<!--/.test(seeded.trim())]).toEqual([seedFile, true]);
        writeFileSync(join(t.taste, "style.en.md"), seeded);

        const result = await sample(t);
        expect([seedFile, result.status, result.stdout, result.stderr]).toEqual([
          seedFile,
          0,
          "",
          "",
        ]);
        expect(existsSync(styleFile(t))).toBe(false);
        expect(readdirSync(t.out)).toEqual([]);
      });
    }
  }, 30_000);
});

describe("voice_sample.ts — the user's own Chinese", () => {
  it("renders hand edits verbatim behind ASCII diff markers", async () => {
    await withTaste("wordtaste-voice-swaps-", async (t) => {
      writeFileSync(
        join(t.taste, "examples", "swaps.jsonl"),
        jsonl(SWAP_PAIRS.slice(0, 2)),
      );

      expect((await sample(t)).status).toBe(0);
      const text = readFileSync(examplesFile(t), "utf8");

      const marked = text.split("\n").filter((line) => /^[-+] /.test(line));
      expect(marked).toHaveLength(4);
      for (const pair of SWAP_PAIRS.slice(0, 2)) {
        expect(marked).toContain(`- ${pair.before}`);
        expect(marked).toContain(`+ ${pair.after}`);
      }
      // The markers are ASCII: a Chinese label here would be a sentence this
      // repo wrote, in front of a writer.
      expect(text).not.toContain("改前");
      expect(text).not.toContain("改后");
    });
  }, 20_000);

  it("samples at most two pairs, and the same two for the same seed", async () => {
    await withTaste("wordtaste-voice-swap-cap-", async (t) => {
      writeFileSync(join(t.taste, "examples", "swaps.jsonl"), jsonl(SWAP_PAIRS));

      expect((await sample(t)).status).toBe(0);
      const first = readFileSync(examplesFile(t), "utf8");
      expect(first.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);

      expect((await sample(t)).status).toBe(0);
      expect(readFileSync(examplesFile(t), "utf8")).toBe(first);
    });
  }, 20_000);

  it("skips junk lines and pairs a diff marker cannot carry", async () => {
    await withTaste("wordtaste-voice-junk-", async (t) => {
      writeFileSync(
        join(t.taste, "examples", "swaps.jsonl"),
        [
          "not json at all",
          "",
          JSON.stringify({ before: "只有前半句。" }),
          JSON.stringify({ before: "", after: "空的前半句。" }),
          // A multi-line side cannot be told apart from the next pair once it
          // is behind a `-` / `+` marker, so it is dropped rather than mangled.
          JSON.stringify({ before: "第一行。\n第二行。", after: "并成一行。" }),
          JSON.stringify(SWAP_PAIRS[0]),
          "{ truncated",
          "",
        ].join("\n"),
      );

      const result = await sample(t);
      expect([result.status, result.stderr]).toEqual([0, ""]);
      const text = readFileSync(examplesFile(t), "utf8");
      expect(text).toContain(`- ${SWAP_PAIRS[0].before}`);
      expect(text).toContain(`+ ${SWAP_PAIRS[0].after}`);
      expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1);
      expect(text).not.toContain("空的前半句");
      expect(text).not.toContain("并成一行");
    });
  }, 20_000);

  it("takes a paragraph-aligned window out of an accepted piece", async () => {
    await withTaste("wordtaste-voice-window-", async (t) => {
      const piece = positivePiece(12, 120, "甲");
      writeFileSync(join(t.taste, "examples", "positive", "accepted.md"), piece);

      expect((await sample(t)).status).toBe(0);
      const window = readFileSync(examplesFile(t), "utf8");

      const sourceParagraphs = piece.split("\n\n").map((p) => p.trim()).filter(Boolean);
      const windowParagraphs = window.split("\n\n").map((p) => p.trim()).filter(Boolean);
      expect(windowParagraphs.length).toBeGreaterThan(0);
      // Every paragraph is a whole one of the user's, never half of one.
      for (const paragraph of windowParagraphs) {
        expect(sourceParagraphs).toContain(paragraph);
      }
      // And they are consecutive, in the order the user wrote them.
      const first = sourceParagraphs.indexOf(windowParagraphs[0]);
      expect(
        sourceParagraphs.slice(first, first + windowParagraphs.length),
      ).toEqual(windowParagraphs);

      const chars = window.replace(/\s/g, "").length;
      expect(chars).toBeGreaterThanOrEqual(300);
      expect(chars).toBeLessThanOrEqual(600);
    });
  }, 20_000);

  it("draws the same window for one seed and moves it for another", async () => {
    await withTaste("wordtaste-voice-seeded-window-", async (t) => {
      writeFileSync(
        join(t.taste, "examples", "positive", "accepted.md"),
        positivePiece(12, 120, "乙"),
      );

      expect((await sample(t, "task-1|u1|0")).status).toBe(0);
      const once = readFileSync(examplesFile(t), "utf8");
      expect((await sample(t, "task-1|u1|0")).status).toBe(0);
      expect(readFileSync(examplesFile(t), "utf8")).toBe(once);

      const drawn = new Set<string>([once]);
      for (const seed of ["task-1|u2|0", "task-1|u3|0", "task-1|u4|0", "task-2|u1|0"]) {
        expect((await sample(t, seed)).status).toBe(0);
        drawn.add(readFileSync(examplesFile(t), "utf8"));
      }
      // Two sections of one essay do not read the same window back to back.
      expect(drawn.size).toBeGreaterThan(1);
    });
  }, 30_000);

  it("keeps the whole block inside its budget, dropping the window before it overflows", async () => {
    await withTaste("wordtaste-voice-budget-", async (t) => {
      // Two pairs of roughly 400 characters each leave no room for a window.
      const long = "这是一段很长的原句子只用来把这一对改写撑到接近预算的上限所以要重复很多次。";
      writeFileSync(
        join(t.taste, "examples", "swaps.jsonl"),
        jsonl([
          { before: long.repeat(6), after: long.repeat(5) },
          { before: long.repeat(6), after: long.repeat(5) },
        ]),
      );
      writeFileSync(
        join(t.taste, "examples", "positive", "accepted.md"),
        positivePiece(12, 120, "丙"),
      );

      expect((await sample(t)).status).toBe(0);
      const text = readFileSync(examplesFile(t), "utf8");
      expect(text.replace(/\s/g, "").length).toBeLessThanOrEqual(900);
      // The window is dropped whole rather than truncated mid-paragraph.
      expect(text).not.toContain("这是一段没有来源的测试文字");
    });
  }, 20_000);
});

describe("voice_sample.ts — degradation", () => {
  it("says nothing and writes nothing when the taste directory is missing", async () => {
    await withTaste("wordtaste-voice-missing-", async (t) => {
      const result = await sample(t, "task-1|u1|0", join(t.root, "no-such-taste"));
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);
      expect(readdirSync(t.out)).toEqual([]);
    });
  }, 20_000);

  it("says nothing and writes nothing when the taste directory is empty", async () => {
    await withTaste("wordtaste-voice-empty-", async (t) => {
      const result = await sample(t);
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);
      expect(readdirSync(t.out)).toEqual([]);
    });
  }, 20_000);

  it("writes only the directives when the user has no Chinese artifacts yet", async () => {
    await withTaste("wordtaste-voice-style-only-", async (t) => {
      writeFileSync(
        join(t.taste, "style.en.md"),
        "Open on the concrete case, never on a definition.\n",
      );

      expect((await sample(t)).status).toBe(0);
      expect(existsSync(styleFile(t))).toBe(true);
      expect(existsSync(examplesFile(t))).toBe(false);
    });
  }, 20_000);

  it("clears a part it no longer has material for", async () => {
    await withTaste("wordtaste-voice-stale-", async (t) => {
      writeFileSync(join(t.taste, "examples", "swaps.jsonl"), jsonl([SWAP_PAIRS[0]]));
      expect((await sample(t)).status).toBe(0);
      expect(existsSync(examplesFile(t))).toBe(true);

      // The user emptied taste/; a re-composed unit must not inherit the old
      // block from the parts directory it is rebuilt into.
      rmSync(join(t.taste, "examples", "swaps.jsonl"));
      expect((await sample(t)).status).toBe(0);
      expect(existsSync(examplesFile(t))).toBe(false);
      expect(readdirSync(t.out)).toEqual([]);
    });
  }, 20_000);

  it("refuses a usage error with one neutral line", async () => {
    await withTaste("wordtaste-voice-usage-", async (t) => {
      const proc = Bun.spawn([process.execPath, samplerPath, t.taste, t.out], {
        cwd: t.root,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: t.root },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect([status, stdout, stderr]).toEqual([
        2,
        "",
        "wordtaste: voice — --seed is required\n",
      ]);
    });
  }, 20_000);
});
