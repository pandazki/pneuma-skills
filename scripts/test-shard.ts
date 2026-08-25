#!/usr/bin/env bun
/**
 * Run the test suite as N parallel `bun test` processes.
 *
 * ⚠️  EXPERIMENTAL — `bun run test:shard`, NOT the routine gate. It is
 * correct on counts (measured: the same 4101 tests across 243 files as the
 * serial run) and roughly twice as fast (76s → 33–38s), but it is NOT yet
 * trustworthy, and the reason is worth reading before anyone promotes it:
 *
 *   Under parallel load this box could not exec a freshly written `bash`
 *   stub within 3 seconds. `modes/wordtaste/__tests__/cross-family-probe`
 *   drives the liveness probe against stub CLIs it writes to a temp dir; the
 *   probe kills anything that has not answered by its deadline. Serially the
 *   stub answers in milliseconds. In BOTH a 6-worker and a 4-worker run, the
 *   live stub missed the deadline and the probe reported an authenticated CLI
 *   as dead — a green suite turned red on a lie about the CLI, not about the
 *   code. Every other exec-heavy wordtaste file merely got 2–3x slower
 *   (their timeouts are generous enough to absorb it), which is the same
 *   symptom without the casualty.
 *
 *   Raising that one deadline is not a fix — it is buying silence, and it
 *   costs wall time in exactly the file we were trying to speed up. The
 *   honest reading is that spawn-and-exec of newly created executables is a
 *   serialization point on macOS, so a suite this exec-heavy does not shard
 *   cleanly yet. Anyone picking this up: measure where the exec latency
 *   actually goes (first-exec policy evaluation is the leading suspect —
 *   warming each stub with one throwaway exec before the timed run would test
 *   it) before touching a single deadline.
 *
 * WHY PROCESSES, NOT `--concurrent`. The suite spends its time waiting, not
 * computing: one process measured 76s wall at 27% CPU on a 16-core box. The
 * headroom is real, but blanket in-process concurrency is not safe here —
 * dozens of files mutate `process.env` (HOME, PNEUMA_SESSION_DIR) and one
 * registers a process-global `mock.module("node:os")`, so tests that share a
 * process are not independent. Separate processes give each shard its own
 * globals, which is the isolation those tests already assume.
 *
 * WHAT WAS CHECKED BEFORE TURNING THIS ON:
 *   - Ports: every server a test starts binds `port: 0` (ephemeral) except
 *     `server/__tests__/security-path-traversal.test.ts`, which pins 19876 —
 *     and a file lives in exactly one shard, so no two shards can claim it.
 *   - Temp dirs: every fixture root is `mkdtempSync`, or a `Date.now()`
 *     suffix under a prefix used by a single file. Neither collides across
 *     shards.
 *   - The real `~/.pneuma`: this was the one true shared mutable. Several
 *     files read it, and `security-path-traversal.test.ts` OVERWRITES the
 *     developer's `sessions.json` and restores it in `afterAll` — harmless
 *     while everything is sequential, a race the moment it is not. So each
 *     shard gets its own empty HOME (`os.homedir()` in Bun resolves `$HOME`
 *     at process start, verified). Proven equivalent: the single-process
 *     suite under a fresh HOME returns the same 4101 tests / 243 files /
 *     0 fail as under the real one.
 *
 * BALANCE. Files are cut into more chunks than there are workers and handed
 * out on demand, because file cost here spans three orders of magnitude
 * (0.001s to 12s) and no static split survives that: a first attempt with one
 * fixed group per worker finished 33s / 32s / 15s / 12s / 5s / 4s — the wall
 * was twice the average. A worker that draws a slow chunk simply draws fewer
 * chunks. The chunking itself is deterministic (round-robin over the sorted
 * file list, so a rerun reproduces the same chunks and siblings — which sort
 * adjacent — spread out); only the order chunks are claimed in varies.
 *
 * WORKER COUNT is deliberately below the core count. These suites spawn real
 * subprocesses, and oversubscription does not merely slow them: a `bash` stub
 * that normally answers in milliseconds was measured missing a 2s deadline
 * under 6 workers, turning a liveness probe's honest `true` into `false`.
 * Speed that makes a test lie is not speed.
 *
 * Usage:
 *   bun scripts/test-shard.ts [--shards N] [--junit-dir DIR] <root...>
 *
 * Every `<root>` is a directory to collect test files from. `--shards`
 * defaults to a quarter of the CPUs (2..4); `PNEUMA_TEST_SHARDS` overrides.
 * `--junit-dir` keeps the JUnit reports for measurement; without it they go
 * to a temp dir and are deleted.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** bun's own test-file patterns, so our list matches what `bun test` finds. */
const TEST_PATTERNS = [
  "**/*.test.{js,jsx,ts,tsx,mjs,cjs}",
  "**/*.spec.{js,jsx,ts,tsx,mjs,cjs}",
  "**/*_test.{js,jsx,ts,tsx,mjs,cjs}",
  "**/*_spec.{js,jsx,ts,tsx,mjs,cjs}",
];

interface Options {
  roots: string[];
  shards: number;
  junitDir: string | null;
}

function parseArgs(argv: string[]): Options {
  const roots: string[] = [];
  let shards = defaultShards();
  let junitDir: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--shards") {
      shards = Number(argv[++i]);
      continue;
    }
    if (arg === "--junit-dir") {
      junitDir = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`test-shard: unknown flag ${arg}`);
    }
    roots.push(arg);
  }
  if (roots.length === 0) throw new Error("test-shard: no roots given");
  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error(`test-shard: --shards must be a positive integer, got ${shards}`);
  }
  return { roots, shards, junitDir };
}

function defaultShards(): number {
  const override = process.env.PNEUMA_TEST_SHARDS;
  if (override !== undefined && override !== "") return Number(override);
  const cpus = navigator.hardwareConcurrency || 4;
  return Math.min(4, Math.max(2, Math.floor(cpus / 4)));
}

/** How many chunks each worker should have to draw from, on average. */
const CHUNKS_PER_WORKER = 5;

/** Every test file under `roots`, sorted, deduplicated, repo-relative. */
function collectTestFiles(roots: string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`test-shard: root does not exist: ${root}`);
    for (const pattern of TEST_PATTERNS) {
      for (const hit of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
        if (hit.split("/").includes("node_modules")) continue;
        found.add(join(root, hit));
      }
    }
  }
  return [...found].sort();
}

/**
 * Round-robin over the sorted list into `count` chunks. Deterministic (a
 * rerun reproduces the same chunks) and it spreads each directory's files —
 * including whichever ones happen to be slow — instead of stacking them.
 */
function split(files: string[], count: number): string[][] {
  const groups: string[][] = Array.from({ length: count }, () => []);
  files.forEach((file, index) => groups[index % count]!.push(file));
  return groups.filter((group) => group.length > 0);
}

interface ShardResult {
  index: number;
  files: number;
  exitCode: number;
  output: string;
  seconds: number;
  report: Report | null;
}

/**
 * Draw chunks from a shared queue with `workers` in flight. Dynamic on
 * purpose: see the balance note in the header.
 */
async function runPool(
  chunks: string[][],
  workers: number,
  junitDir: string,
  homeRoot: string,
): Promise<ShardResult[]> {
  const results: ShardResult[] = [];
  let next = 0;
  const worker = async (slot: number): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= chunks.length) return;
      results.push(await runShard(index, chunks[index]!, junitDir, join(homeRoot, `w${slot}`)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, chunks.length) }, (_, i) => worker(i)));
  return results.sort((a, b) => a.index - b.index);
}

interface Report {
  tests: number;
  failures: number;
  skipped: number;
  files: number;
}

/** Roll a shard's JUnit report up into the four numbers the summary needs. */
async function readReport(path: string): Promise<Report | null> {
  if (!existsSync(path)) return null;
  const xml = await Bun.file(path).text();
  const head = /<testsuites\b([^>]*)>/.exec(xml)?.[1];
  if (head === undefined) return null;
  const num = (key: string): number => Number(new RegExp(`\\b${key}="([^"]*)"`).exec(head)?.[1] ?? "0");
  const files = new Set<string>();
  for (const m of xml.matchAll(/<testcase\b[^>]*?\bfile="([^"]*)"/g)) files.add(m[1]!);
  return { tests: num("tests"), failures: num("failures"), skipped: num("skipped"), files: files.size };
}

async function runShard(
  index: number,
  files: string[],
  junitDir: string,
  home: string,
): Promise<ShardResult> {
  const reportPath = join(junitDir, `shard-${index}.xml`);
  // One HOME per worker, not per chunk: a worker runs its chunks one after
  // another, so they cannot race each other, and reusing the directory keeps
  // the tree small.
  mkdirSync(home, { recursive: true });
  const started = Bun.nanoseconds();
  const proc = Bun.spawn(
    [
      process.execPath,
      "test",
      ...files,
      "--reporter=junit",
      `--reporter-outfile=${reportPath}`,
    ],
    {
      cwd: process.cwd(),
      // Each shard owns its HOME so no two shards can race the real
      // `~/.pneuma` (see the header note).
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    index,
    files: files.length,
    exitCode,
    // bun writes its report to stderr and console output to stdout; a reader
    // debugging a failure wants both, in that order.
    output: `${stderr}${stdout}`,
    seconds: (Bun.nanoseconds() - started) / 1e9,
    report: await readReport(reportPath),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = collectTestFiles(options.roots);
  const chunks = split(files, options.shards * CHUNKS_PER_WORKER);
  if (chunks.length === 0) throw new Error("test-shard: found no test files");

  const keepReports = options.junitDir !== null;
  const junitDir = options.junitDir ?? mkdtempSync(join(tmpdir(), "pneuma-test-junit-"));
  mkdirSync(junitDir, { recursive: true });
  const homeRoot = mkdtempSync(join(tmpdir(), "pneuma-test-home-"));

  console.log(
    `test-shard: ${files.length} files in ${chunks.length} chunks across ` +
      `${options.shards} workers (roots: ${options.roots.join(" ")})`,
  );
  const started = Bun.nanoseconds();
  let results: ShardResult[];
  try {
    results = await runPool(chunks, options.shards, junitDir, homeRoot);
  } finally {
    rmSync(homeRoot, { recursive: true, force: true });
  }
  const wall = (Bun.nanoseconds() - started) / 1e9;

  for (const result of results) {
    console.log(
      `\n${"─".repeat(72)}\n` +
        `chunk ${result.index} — ${result.files} files, ${result.seconds.toFixed(2)}s, ` +
        `exit ${result.exitCode}\n${"─".repeat(72)}`,
    );
    process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
  }

  const totals = results.reduce(
    (acc, r) => {
      const report = r.report;
      if (report === null) {
        // A chunk that died before writing a report is a failure we must not
        // round down to "0 tests" — say so, and keep the exit code non-zero.
        acc.missing += 1;
        return acc;
      }
      acc.tests += report.tests;
      acc.failures += report.failures;
      acc.skipped += report.skipped;
      acc.files += report.files;
      return acc;
    },
    { tests: 0, failures: 0, skipped: 0, files: 0, missing: 0 },
  );
  const failedChunks = results.filter((r) => r.exitCode !== 0).map((r) => r.index);

  console.log(`\n${"═".repeat(72)}`);
  console.log(
    ` ${totals.tests - totals.skipped - totals.failures} pass  ` +
      `${totals.skipped} skip  ${totals.failures} fail`,
  );
  console.log(
    `Ran ${totals.tests} tests across ${totals.files} files ` +
      `in ${chunks.length} chunks / ${options.shards} workers. [${wall.toFixed(2)}s]`,
  );
  if (totals.missing > 0) console.log(`${totals.missing} chunk(s) produced NO report — see above.`);
  if (failedChunks.length > 0) console.log(`Failing chunks: ${failedChunks.join(", ")}`);
  if (keepReports) console.log(`JUnit reports: ${relative(process.cwd(), junitDir) || junitDir}`);
  else rmSync(junitDir, { recursive: true, force: true });

  process.exit(failedChunks.length > 0 || totals.failures > 0 || totals.missing > 0 ? 1 : 0);
}

await main();
