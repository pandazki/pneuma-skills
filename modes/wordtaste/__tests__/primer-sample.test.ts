import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const samplerPath = join(scriptsDir, "primer_sample.ts");
const primerDir = join(import.meta.dir, "..", "skill", "references", "primer");
const framePath = join(primerDir, "frame.md");

/**
 * Every library below is synthetic: invented author tokens (作者甲 … 作者辛)
 * and generated filler sentences. No real library, author, or work is named
 * in this file, and no spawn ever sees the real home directory — each one
 * gets a throwaway HOME so the sampler can never reach `~/.pneuma/primers/`.
 */
const AUTHOR_MARKERS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"] as const;

function authorName(index: number): string {
  return `作者${AUTHOR_MARKERS[index]}`;
}

/** A 20-character filler sentence carrying the author's marker. */
function sentenceFor(marker: string): string {
  return `这是一段${marker}类测试文字没来源只用来凑字数。`;
}

function paragraph(chars: number, marker: string): string {
  const sentence = sentenceFor(marker);
  return sentence.repeat(Math.max(1, Math.round(chars / sentence.length)));
}

function nonSpaceChars(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

/** Which synthetic authors a rendered block drew from, read off the markers. */
function markersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const marker of AUTHOR_MARKERS) {
    if (text.includes(`这是一段${marker}类`)) found.add(marker);
  }
  return found;
}

interface PieceSpec {
  authorIndex: number;
  name: string;
  paragraphs: number[];
}

function writeLibrary(dir: string, pieces: PieceSpec[], options?: { withManifest?: boolean }): void {
  mkdirSync(dir, { recursive: true });
  if (options?.withManifest !== false) {
    writeFileSync(
      join(dir, "library.json"),
      JSON.stringify({ name: "synthetic", displayName: "Synthetic", description: "test only" }, null, 2),
    );
  }
  for (const piece of pieces) {
    const marker = AUTHOR_MARKERS[piece.authorIndex]!;
    const body = piece.paragraphs.map((n) => paragraph(n, marker)).join("\n\n");
    const front = [
      "---",
      `author: ${authorName(piece.authorIndex)}`,
      `title: ${piece.name}`,
      "license_tier: A",
      "---",
      "",
    ].join("\n");
    writeFileSync(join(dir, `${piece.name}.md`), `${front}${body}\n`);
  }
}

function sixAuthorLibrary(dir: string): void {
  const pieces: PieceSpec[] = [];
  for (let author = 0; author < 6; author += 1) {
    for (let piece = 0; piece < 2; piece += 1) {
      pieces.push({
        authorIndex: author,
        name: `syn-${author}-${piece}`,
        paragraphs: [220, 260, 240, 200, 280, 240],
      });
    }
  }
  writeLibrary(dir, pieces);
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runSampler(args: string[], home: string): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, samplerPath, ...args], {
    cwd: home,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
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

function frameBlock(section: "before" | "after" | "voice"): string {
  const lines = readFileSync(framePath, "utf8").split("\n");
  const captured: string[] = [];
  let current = "";
  let inFence = false;
  let done = false;
  for (const line of lines) {
    if (done) break;
    if (/^##\s+/.test(line)) {
      current = line.replace(/^##\s+/, "").trim();
      inFence = false;
      continue;
    }
    if (current !== section) continue;
    if (line.startsWith("```")) {
      if (inFence) {
        done = true;
        continue;
      }
      inFence = true;
      continue;
    }
    if (inFence) captured.push(line);
  }
  return captured.join("\n").trim();
}

async function withTempAsync<T>(prefix: string, fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The passage bodies between the ※ separators, framing text stripped. */
function passageBodies(output: string): string[] {
  const before = frameBlock("before");
  const after = frameBlock("after");
  expect(output.startsWith(before)).toBe(true);
  const trimmed = output.trimEnd();
  expect(trimmed.endsWith(after)).toBe(true);
  const inner = trimmed.slice(before.length, trimmed.length - after.length);
  return inner
    .split("\n※\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

describe("primer sampler", () => {
  it("ships an executable sampler next to the leaf router", () => {
    expect(existsSync(samplerPath)).toBe(true);
  });

  it("produces byte-identical output for the same seed and different output for another", async () => {
    await withTempAsync("wordtaste-primer-det-", async (root) => {
      const lib = join(root, "lib");
      sixAuthorLibrary(lib);
      const a1 = await runSampler(["--seed", "unit-1|writer|0", "--libs", lib], root);
      const a2 = await runSampler(["--seed", "unit-1|writer|0", "--libs", lib], root);
      expect(a1.status).toBe(0);
      expect(a1.stderr).toBe("");
      expect(a1.stdout.length).toBeGreaterThan(0);
      expect(a2.stdout).toBe(a1.stdout);

      const others = new Set<string>();
      for (const seed of ["unit-1|writer|1", "unit-2|writer|0", "unit-3|repair|1", "unit-4|writer|0"]) {
        const other = await runSampler(["--seed", seed, "--libs", lib], root);
        expect(other.status).toBe(0);
        others.add(other.stdout);
      }
      expect(others.has(a1.stdout)).toBe(false);
      expect(others.size).toBeGreaterThan(1);
    });
  }, 40_000);

  it("frames the block with the verbatim frame.md text and lone ※ separators", async () => {
    await withTempAsync("wordtaste-primer-frame-", async (root) => {
      const lib = join(root, "lib");
      sixAuthorLibrary(lib);
      const result = await runSampler(["--seed", "frame-seed", "--libs", lib], root);
      expect(result.status).toBe(0);
      expect(result.stdout.startsWith(frameBlock("before"))).toBe(true);
      expect(result.stdout.trimEnd().endsWith(frameBlock("after"))).toBe(true);
      const separators = result.stdout.split("\n").filter((line) => line.trim() === "※");
      for (const line of separators) expect(line).toBe("※");
      expect(separators.length).toBe(passageBodies(result.stdout).length - 1);
      expect(separators.length).toBeGreaterThan(0);
    });
  }, 20_000);

  it("keeps every window paragraph-aligned and inside the min/max/total bounds", async () => {
    await withTempAsync("wordtaste-primer-bounds-", async (root) => {
      const lib = join(root, "lib");
      sixAuthorLibrary(lib);
      const knownParagraphs = new Set<string>();
      for (const file of readdirSync(lib).filter((name) => name.endsWith(".md"))) {
        const raw = readFileSync(join(lib, file), "utf8");
        const body = raw.slice(raw.indexOf("\n---\n", 4) + 5);
        for (const para of body.split(/\n\s*\n/)) {
          const text = para.trim();
          if (text) knownParagraphs.add(text);
        }
      }

      for (const seed of ["b1", "b2", "b3", "b4", "b5"]) {
        const result = await runSampler(
          ["--seed", seed, "--libs", lib, "--min", "350", "--max", "900", "--total", "2000"],
          root,
        );
        expect(result.status).toBe(0);
        const passages = passageBodies(result.stdout);
        expect(passages.length).toBeGreaterThan(0);
        let total = 0;
        for (const passage of passages) {
          const count = nonSpaceChars(passage);
          expect(count).toBeGreaterThanOrEqual(350);
          expect(count).toBeLessThanOrEqual(900);
          total += count;
          for (const para of passage.split(/\n\s*\n/)) {
            expect(knownParagraphs.has(para.trim())).toBe(true);
          }
        }
        expect(total).toBeLessThanOrEqual(2000);
      }
    });
  }, 60_000);

  it("respects a tight --total by dropping the window that would overflow it", async () => {
    await withTempAsync("wordtaste-primer-total-", async (root) => {
      const lib = join(root, "lib");
      sixAuthorLibrary(lib);
      const result = await runSampler(
        ["--seed", "tight", "--libs", lib, "--min", "350", "--max", "900", "--total", "700"],
        root,
      );
      expect(result.status).toBe(0);
      const passages = passageBodies(result.stdout);
      expect(passages.length).toBe(1);
      expect(nonSpaceChars(passages[0]!)).toBeLessThanOrEqual(700);
    });
  }, 20_000);

  it("uses the whole piece when it is shorter than --min", async () => {
    await withTempAsync("wordtaste-primer-short-", async (root) => {
      const lib = join(root, "lib");
      writeLibrary(lib, [{ authorIndex: 0, name: "short-piece", paragraphs: [60, 60] }]);
      const result = await runSampler(["--seed", "short", "--libs", lib, "--count", "1"], root);
      expect(result.status).toBe(0);
      const passages = passageBodies(result.stdout);
      expect(passages.length).toBe(1);
      expect(passages[0]!.split(/\n\s*\n/).length).toBe(2);
      expect(nonSpaceChars(passages[0]!)).toBe(120);
    });
  }, 20_000);

  it("uses a single oversized paragraph alone rather than splitting it", async () => {
    await withTempAsync("wordtaste-primer-oversize-", async (root) => {
      const lib = join(root, "lib");
      writeLibrary(lib, [{ authorIndex: 0, name: "one-huge", paragraphs: [1400, 400] }]);
      const result = await runSampler(
        ["--seed", "oversize", "--libs", lib, "--count", "1", "--min", "350", "--max", "900", "--total", "4000"],
        root,
      );
      expect(result.status).toBe(0);
      const passages = passageBodies(result.stdout);
      expect(passages.length).toBe(1);
      const paragraphs = passages[0]!.split(/\n\s*\n/);
      expect(paragraphs.length).toBe(1);
      expect([1400, 400]).toContain(nonSpaceChars(paragraphs[0]!));
    });
  }, 20_000);

  it("runs an author lottery, not a file lottery, when one author owns most files", async () => {
    await withTempAsync("wordtaste-primer-lottery-", async (root) => {
      const lib = join(root, "lib");
      const pieces: PieceSpec[] = [];
      for (let i = 0; i < 16; i += 1) {
        pieces.push({ authorIndex: 0, name: `dominant-${i}`, paragraphs: [220, 260, 240, 200] });
      }
      for (let author = 1; author < 5; author += 1) {
        pieces.push({ authorIndex: author, name: `minor-${author}`, paragraphs: [220, 260, 240, 200] });
      }
      writeLibrary(lib, pieces);

      for (const seed of ["l1", "l2", "l3", "l4", "l5", "l6"]) {
        const result = await runSampler(
          ["--seed", seed, "--libs", lib, "--count", "3", "--total", "4000"],
          root,
        );
        expect(result.status).toBe(0);
        const passages = passageBodies(result.stdout);
        expect(passages.length).toBe(3);
        // One marker per window, three distinct markers across the block.
        for (const passage of passages) expect(markersIn(passage).size).toBe(1);
        expect(markersIn(result.stdout).size).toBe(3);
      }
    });
  }, 60_000);

  it("appends a voice window with its own framing when --voice-dir has files", async () => {
    await withTempAsync("wordtaste-primer-voice-", async (root) => {
      const lib = join(root, "lib");
      sixAuthorLibrary(lib);
      const voice = join(root, "voice");
      mkdirSync(voice, { recursive: true });
      writeFileSync(join(voice, "own.md"), `${paragraph(400, "辛")}\n\n${paragraph(400, "辛")}\n`);

      const withoutVoice = await runSampler(["--seed", "v1", "--libs", lib], root);
      const withVoice = await runSampler(["--seed", "v1", "--libs", lib, "--voice-dir", voice], root);
      expect(withVoice.status).toBe(0);
      expect(withVoice.stderr).toBe("");
      expect(withVoice.stdout).toContain(frameBlock("voice"));
      expect(withoutVoice.stdout).not.toContain(frameBlock("voice"));
      const voiceAt = withVoice.stdout.indexOf(frameBlock("voice"));
      const afterAt = withVoice.stdout.indexOf(frameBlock("after"));
      expect(voiceAt).toBeGreaterThan(0);
      expect(afterAt).toBeGreaterThan(voiceAt);
    });
  }, 30_000);

  it("prints nothing and exits 0 when no library has usable pieces", async () => {
    await withTempAsync("wordtaste-primer-empty-", async (root) => {
      const empty = join(root, "empty");
      mkdirSync(empty, { recursive: true });
      writeFileSync(join(empty, "library.json"), "{}\n");
      writeFileSync(join(empty, "notes.md"), "no frontmatter here\n");

      const result = await runSampler(["--seed", "nothing", "--libs", empty], root);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const missing = await runSampler(["--seed", "nothing", "--libs", join(root, "does-not-exist")], root);
      expect(missing.status).toBe(0);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toBe("");
    });
  }, 20_000);

  it("skips a user library directory that has no library.json", async () => {
    await withTempAsync("wordtaste-primer-manifest-", async (root) => {
      const unmarked = join(root, "unmarked");
      writeLibrary(unmarked, [{ authorIndex: 0, name: "loose", paragraphs: [400, 400] }], {
        withManifest: false,
      });
      const result = await runSampler(["--seed", "nomanifest", "--libs", unmarked], root);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  }, 20_000);

  it("reads the bundled public-domain library without a library.json", async () => {
    await withTempAsync("wordtaste-primer-bundled-", async (root) => {
      const result = await runSampler(["--seed", "bundled-seed"], root);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).toContain(frameBlock("before"));
      expect(result.stdout).toContain(frameBlock("after"));
    });
  }, 20_000);
});

describe("bundled primer library", () => {
  it("gives every piece an author and a non-empty body", () => {
    const files = readdirSync(primerDir).filter((name) => name.startsWith("A-") && name.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = readFileSync(join(primerDir, file), "utf8");
      expect(raw.startsWith("---\n")).toBe(true);
      const end = raw.indexOf("\n---\n", 4);
      expect(end).toBeGreaterThan(0);
      const front = raw.slice(4, end);
      const author = front.split("\n").find((line) => line.startsWith("author:"));
      expect(author).toBeDefined();
      expect(author!.replace("author:", "").trim().length).toBeGreaterThan(0);
      const body = raw.slice(end + 5).trim();
      expect(nonSpaceChars(body)).toBeGreaterThan(300);
    }
  });

  it("keeps the three framing blocks fenced and non-empty", () => {
    for (const section of ["before", "after", "voice"] as const) {
      expect(frameBlock(section).length).toBeGreaterThan(0);
    }
  });

  it("ships no user library inside the repository", () => {
    for (const entry of readdirSync(primerDir)) {
      expect(
        entry.startsWith("A-") || ["README.md", "frame.md", "brief-lint.txt"].includes(entry),
      ).toBe(true);
    }
  });
});
