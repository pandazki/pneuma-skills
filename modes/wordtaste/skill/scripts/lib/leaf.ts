/**
 * The leaf runner: role routing, brief lint, priming, the repair budget, and
 * the three isolated adapters (Claude Code, Codex, and the hosted OpenRouter
 * route). Ports the bash-era `run_leaf.sh` + `leaf_crosscheck.sh` + `leaf_primary.sh`
 * + `leaf_openrouter.sh` into one module with the same routing table, the same
 * exit codes, and the same one-line neutral failures.
 *
 * The CLI adapters spawn a fresh, non-persistent process with a clean
 * temporary working directory; the child leads its own process group and is
 * reaped on SIGTERM/SIGINT/SIGHUP and on parent exit. The hosted route holds
 * a bearer token itself, so everything the token touches is closed: it lives
 * in memory, reaches the API as a `fetch` header, and is never an argument,
 * never a log line, and never a file.
 *
 * A composed writer/repair prompt may carry a standing system charter beside
 * it (`system.en.md`, written by the composer). Each adapter sends it through
 * the strongest channel it has: the hosted route as a real system message,
 * Claude Code via `--system-prompt-file` (replacing that CLI's own default
 * system prompt, deliberately), and Codex — which has no system channel — as
 * text prepended to the one message. No sibling file, no change: the dispatch
 * is byte-identical to what it always was, and checker/planner prompts never
 * look for one.
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SYSTEM_PART } from "./compose.ts";
import { prependSystem } from "./prompt-assembly.ts";
import { SamplerError, samplePrimer } from "./sampling.ts";
import { loadOpenRouterKey, primerLibs, primerSeed, writerModel, scriptsDir } from "./session.ts";

export const MAX_REPAIR_CYCLES = 2;
export const COMPOSED_MARKER = "<!-- wordtaste:composed v1 -->";

export interface LeafOutcome {
  status: number;
  /** The leaf's final answer; empty unless status is 0. */
  output: string;
  /** Neutral stderr lines, in emit order. Never prompt text or key material. */
  messages: string[];
}

function outcome(status: number, message?: string): LeafOutcome {
  return { status, output: "", messages: message ? [message] : [] };
}

function fileNonEmpty(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

// ── process-group reaping ───────────────────────────────────────────────────
// Every spawned leaf leads its own process group. A signal to this process
// forwards TERM to the group, escalates to KILL after one second, then exits;
// a normal exit KILLs whatever is still alive. This is what keeps a stopped
// wrapper from leaving an orphan leaf running.

const activeLeaves = new Set<number>();
let handlersInstalled = false;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone — the expected case.
  }
}

function installReapHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const forward = (signal: NodeJS.Signals, code: number): void => {
    for (const pid of activeLeaves) killGroup(pid, "SIGTERM");
    setTimeout(() => {
      for (const pid of activeLeaves) killGroup(pid, "SIGKILL");
      process.exit(code);
    }, 1000);
  };
  process.on("SIGTERM", () => forward("SIGTERM", 143));
  process.on("SIGINT", () => forward("SIGINT", 130));
  process.on("SIGHUP", () => forward("SIGHUP", 129));
  process.on("exit", () => {
    for (const pid of activeLeaves) killGroup(pid, "SIGKILL");
  });
}

const SIGNAL_CODES: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

interface LeafStdio {
  stdinFile: string;
  stdoutFile: string;
  stderrFile: string;
}

/** Spawn one leaf process in its own group and wait for its exit status. */
function runLeafProcess(command: string, args: string[], cwd: string, stdio: LeafStdio): Promise<number> {
  installReapHandlers();
  const stdinFd = openSync(stdio.stdinFile, "r");
  const stdoutFd = openSync(stdio.stdoutFile, "a");
  const stderrFd = stdio.stderrFile === stdio.stdoutFile ? stdoutFd : openSync(stdio.stderrFile, "a");
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: [stdinFd, stdoutFd, stderrFd],
      env: process.env,
    });
    const done = (status: number): void => {
      if (child.pid !== undefined) activeLeaves.delete(child.pid);
      closeSync(stdinFd);
      closeSync(stdoutFd);
      if (stderrFd !== stdoutFd) closeSync(stderrFd);
      resolve(status);
    };
    if (child.pid !== undefined) activeLeaves.add(child.pid);
    child.on("error", () => done(127));
    child.on("close", (code, signal) => {
      done(code ?? 128 + (signal ? SIGNAL_CODES[signal] ?? 15 : 15));
    });
  });
}

// ── prompt validation, shared by every adapter ──────────────────────────────

function validatePromptFile(promptFile: string | undefined): LeafOutcome | string {
  if (!promptFile) return outcome(2, "wordtaste: leaf adapter — usage: <promptfile>");
  if (!existsSync(promptFile) || !statSync(promptFile).isFile()) {
    return outcome(2, `wordtaste: leaf adapter — prompt file not found: ${promptFile}`);
  }
  if (statSync(promptFile).size === 0) {
    return outcome(2, `wordtaste: leaf adapter — prompt file is empty: ${promptFile}`);
  }
  return join(dirname(promptFile), basename(promptFile));
}

interface Diagnostic {
  file: string;
  ephemeral: boolean;
}

function openDiagnostic(prefix: string): Diagnostic {
  const configured = process.env.WORDTASTE_PRIVATE_LOG;
  if (configured && configured.length > 0) {
    mkdirSync(dirname(configured), { recursive: true });
    return { file: configured, ephemeral: false };
  }
  const scratch = mkdtempSync(join(tmpdir(), `${prefix}-log-`));
  return { file: join(scratch, "leaf.log"), ephemeral: true };
}

function dropDiagnostic(diagnostic: Diagnostic): void {
  rmSync(diagnostic.file, { force: true });
  if (diagnostic.ephemeral) rmSync(dirname(diagnostic.file), { recursive: true, force: true });
}

// ── the Claude Code adapter (cross-check) ───────────────────────────────────

async function runCrosscheck(promptFileArg: string, systemFile: string | null): Promise<LeafOutcome> {
  const validated = validatePromptFile(promptFileArg);
  if (typeof validated !== "string") return validated;
  if (Bun.which("claude") === null) return outcome(3, "wordtaste: leaf adapter unavailable");

  const cleanWorkDir = mkdtempSync(join(tmpdir(), "wordtaste-claude-cwd-"));
  const outputFile = join(cleanWorkDir, ".wordtaste-answer");
  writeFileSync(outputFile, "");
  const diagnostic = openDiagnostic("wordtaste-claude");
  // The charter replaces the CLI's own default system prompt, deliberately:
  // this leaf is a writer, and Claude Code's coding-agent preamble is exactly
  // the register the charter exists to keep out. The path is not a secret —
  // the contents never enter argv.
  const systemArgs = systemFile !== null ? ["--system-prompt-file", systemFile] : [];
  try {
    const status = await runLeafProcess(
      "claude",
      [
        "-p",
        "--model", process.env.WORDTASTE_CLAUDE_MODEL || "claude-sonnet-5",
        "--output-format", "text",
        "--no-session-persistence",
        "--safe-mode",
        "--tools", "",
        ...systemArgs,
      ],
      cleanWorkDir,
      { stdinFile: validated, stdoutFile: outputFile, stderrFile: diagnostic.file },
    );
    if (status !== 0) return outcome(status, `wordtaste: leaf adapter failed (exit ${status})`);
    if (!fileNonEmpty(outputFile)) return outcome(4, "wordtaste: leaf adapter returned no final text");
    dropDiagnostic(diagnostic);
    return { status: 0, output: readFileSync(outputFile, "utf8"), messages: [] };
  } finally {
    if (diagnostic.ephemeral) dropDiagnostic(diagnostic);
    rmSync(cleanWorkDir, { recursive: true, force: true });
  }
}

// ── the Codex adapter (primary) ─────────────────────────────────────────────

async function runPrimary(promptFileArg: string, systemFile: string | null): Promise<LeafOutcome> {
  const validated = validatePromptFile(promptFileArg);
  if (typeof validated !== "string") return validated;
  if (Bun.which("codex") === null) return outcome(3, "wordtaste: leaf adapter unavailable");

  const cleanWorkDir = mkdtempSync(join(tmpdir(), "wordtaste-codex-cwd-"));
  const lastMessageFile = join(cleanWorkDir, ".wordtaste-last-message");
  writeFileSync(lastMessageFile, "");
  const diagnostic = openDiagnostic("wordtaste-codex");
  // Codex has no system channel. The degradation is the charter prepended to
  // the one message, one blank line between — the same bytes the workflow
  // path hands `agent()`. The combined file stays in the leaf's own private
  // cwd, exactly where the answer file already lives.
  let stdinFile = validated;
  if (systemFile !== null) {
    stdinFile = join(cleanWorkDir, ".wordtaste-stdin");
    writeFileSync(
      stdinFile,
      prependSystem(readFileSync(systemFile, "utf8"), readFileSync(validated, "utf8")),
    );
  }
  // An unset model leaves the flag off entirely rather than passing an empty
  // model name.
  const modelArgs = process.env.WORDTASTE_CODEX_MODEL
    ? ["-m", process.env.WORDTASTE_CODEX_MODEL]
    : [];
  try {
    const status = await runLeafProcess(
      "codex",
      [
        "exec", "--skip-git-repo-check", "--color", "never",
        ...modelArgs,
        "--output-last-message", lastMessageFile,
        "-",
      ],
      cleanWorkDir,
      { stdinFile, stdoutFile: diagnostic.file, stderrFile: diagnostic.file },
    );
    if (status !== 0) return outcome(status, `wordtaste: leaf adapter failed (exit ${status})`);
    if (!fileNonEmpty(lastMessageFile)) {
      return outcome(4, "wordtaste: leaf adapter returned no final message");
    }
    dropDiagnostic(diagnostic);
    return { status: 0, output: readFileSync(lastMessageFile, "utf8"), messages: [] };
  } finally {
    if (diagnostic.ephemeral) dropDiagnostic(diagnostic);
    rmSync(cleanWorkDir, { recursive: true, force: true });
  }
}

// ── the hosted adapter (OpenRouter) ─────────────────────────────────────────

async function runHosted(
  promptFileArg: string,
  sessionRoot: string,
  systemFile: string | null,
): Promise<LeafOutcome> {
  const validated = validatePromptFile(promptFileArg);
  if (typeof validated !== "string") return validated;

  // A missing key is the same answer as a missing tool used to be: this route
  // is not available, try the next one.
  const key = loadOpenRouterKey(sessionRoot);
  if (key === null) return outcome(3, "wordtaste: leaf adapter unavailable");

  const model = writerModel(sessionRoot);
  const endpoint =
    process.env.WORDTASTE_OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions";
  const diagnostic = openDiagnostic("wordtaste-openrouter");
  const keepResponse = (bodyText: string): void => {
    if (bodyText.length > 0) appendFileSync(diagnostic.file, `${bodyText}\n`);
  };

  try {
    // `reasoning` is added only off the Anthropic routes: those reject the
    // field, while a reasoning model without it spends the whole token budget
    // thinking and returns an empty answer. Both were measured.
    // The hosted route is the one channel with a real system role: the
    // charter travels as the system message, the task message as the user
    // message.
    const messages =
      systemFile !== null
        ? [
            { role: "system", content: readFileSync(systemFile, "utf8") },
            { role: "user", content: readFileSync(validated, "utf8") },
          ]
        : [{ role: "user", content: readFileSync(validated, "utf8") }];
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 30000,
    };
    if (!model.startsWith("anthropic/")) body.reasoning = { effort: "low" };

    const timeoutMs = Number(process.env.WORDTASTE_OPENROUTER_TIMEOUT || "900") * 1000;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        // The key is built into the header in memory: never an argument,
        // never a file, never an environment line a child could read.
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return outcome(4, "wordtaste: leaf adapter failed (exit 4)");
    }
    const responseText = await response.text();
    if (response.status !== 200) {
      keepResponse(responseText);
      return outcome(4, "wordtaste: leaf adapter failed (upstream refused the request)");
    }
    let content: unknown;
    try {
      const parsed = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      content = parsed.choices?.[0]?.message?.content;
    } catch {
      content = undefined;
    }
    // An answer that is absent, null, or empty is a failure, not empty prose:
    // the caller redirects stdout straight into a candidate file.
    if (typeof content !== "string" || content.length === 0) {
      keepResponse(responseText);
      return outcome(4, "wordtaste: leaf adapter returned no final text");
    }
    dropDiagnostic(diagnostic);
    return {
      status: 0,
      output: content.endsWith("\n") ? content : `${content}\n`,
      messages: [],
    };
  } finally {
    if (diagnostic.ephemeral) dropDiagnostic(diagnostic);
  }
}

// ── the repair budget ───────────────────────────────────────────────────────

const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

async function reserveRepairCycle(budgetDir: string, scope: string): Promise<LeafOutcome | null> {
  if (!scope || !SCOPE_PATTERN.test(scope)) {
    return outcome(2, "wordtaste: leaf — repair requires a stable passage scope");
  }
  mkdirSync(budgetDir, { recursive: true });
  const countFile = join(budgetDir, `${scope}.count`);
  const lockDir = join(budgetDir, `${scope}.lock`);

  let waited = 0;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      waited += 1;
      if (waited >= 40) {
        return outcome(4, "wordtaste: leaf — repair budget is temporarily busy");
      }
      await Bun.sleep(50);
    }
  }

  let count = 0;
  if (existsSync(countFile)) {
    const firstLine = readFileSync(countFile, "utf8").split("\n")[0] ?? "";
    if (!/^[0-9]+$/.test(firstLine)) {
      rmdirSync(lockDir);
      return outcome(4, "wordtaste: leaf — repair budget state is invalid");
    }
    count = Number(firstLine);
  }
  if (count >= MAX_REPAIR_CYCLES) {
    rmdirSync(lockDir);
    return outcome(5, "wordtaste: leaf — repair budget exhausted for this passage");
  }
  const next = `${countFile}.tmp.${process.pid}`;
  writeFileSync(next, `${count + 1}\n`);
  renameSync(next, countFile);
  rmdirSync(lockDir);
  return null;
}

function readRepairCount(budgetDir: string, scope: string): number {
  if (!scope) return 0;
  const countFile = join(budgetDir, `${scope}.count`);
  if (!existsSync(countFile)) return 0;
  const firstLine = readFileSync(countFile, "utf8").split("\n")[0] ?? "";
  return /^[0-9]+$/.test(firstLine) ? Number(firstLine) : 0;
}

// ── brief lint ──────────────────────────────────────────────────────────────
// The brief is read by a writer as Chinese prose, so every sentence in it is a
// style example. Orchestration vocabulary inside the marked instruction region
// is a hard stop before dispatch. The checker is never linted — a judge brief
// legitimately carries rubric vocabulary.

const BRIEF_START = "<!-- brief:start -->";
const BRIEF_END = "<!-- brief:end -->";

function briefLint(promptFile: string): LeafOutcome | string | null {
  if (process.env.WORDTASTE_BRIEF_LINT === "0") return null;
  const termsFile = join(scriptsDir, "..", "references", "primer", "brief-lint.txt");
  if (!existsSync(termsFile) || !existsSync(promptFile)) return null;

  const terms = readFileSync(termsFile, "utf8")
    .split("\n")
    .filter((line) => !/^[\t\v\f\r ]*$/.test(line));
  if (terms.length === 0) return null;

  const prompt = readFileSync(promptFile, "utf8");
  const marked = prompt.includes(BRIEF_START) && prompt.includes(BRIEF_END);

  let scan = prompt;
  if (marked) {
    // Only the marked instruction region is scanned. Inlined material — kernel
    // excerpts, preceding prose — lives outside the markers on purpose.
    const kept: string[] = [];
    let inside = false;
    for (const line of prompt.split("\n")) {
      if (line.includes(BRIEF_START)) {
        inside = true;
        continue;
      }
      if (line.includes(BRIEF_END)) {
        inside = false;
        continue;
      }
      if (inside) kept.push(line);
    }
    scan = kept.join("\n");
  }

  const hit = terms.some((term) => scan.includes(term));
  if (!hit) return null;
  // Neither branch names the term or quotes the line: the diagnosis itself
  // must not become one more visible artifact.
  if (marked) {
    return outcome(6, "wordtaste: leaf — the brief contains orchestration wording; rewrite it in plain Chinese");
  }
  return "wordtaste: leaf — note: orchestration wording detected outside the marked brief";
}

/**
 * A composed prompt has no marked Chinese brief to scan: its instructions are
 * English, and the only part an orchestrator wrote by hand is the sibling
 * `brief.en.md`. Chinese there is a note, never a refusal.
 */
function composedBriefLint(promptFile: string): string | null {
  if (process.env.WORDTASTE_BRIEF_LINT === "0") return null;
  const brief = join(dirname(promptFile), "brief.en.md");
  if (!fileNonEmpty(brief)) return null;
  // U+3000–U+9FFF (UTF-8 lead bytes E3–E9) covers CJK punctuation and every
  // common ideograph; an em dash or a curly quote is ordinary English
  // typography and is not flagged.
  if (/[　-鿿]/.test(readFileSync(brief, "utf8"))) {
    return "wordtaste: leaf — note: the English brief carries Chinese; a writer reads every sentence of it as a style sample";
  }
  return null;
}

// ── the neutral router ──────────────────────────────────────────────────────

/**
 * Dispatch one role to the strongest route the session actually has, exactly
 * as the bash-era `run_leaf.sh` routed: writer/repair take the hosted adapter when the
 * probe says it answers, then the cross-check adapter, then the primary one;
 * checker/planner take the primary adapter first and the cross-check adapter
 * second, so the model that judges prose is never the model that wrote it.
 * Availability is read once from the probe file and never revisited — an
 * adapter that fails takes the run down, because a silent mid-run swap would
 * attribute one route's prose to another.
 */
export async function routeLeaf(role: string, promptFileArg: string, scope = ""): Promise<LeafOutcome> {
  const sessionRoot = process.env.PNEUMA_SESSION_DIR ?? ".";
  const probeFile =
    process.env.WORDTASTE_PROBE_FILE ?? join(sessionRoot, ".pneuma", "cross-family.json");
  const privateDir =
    process.env.WORDTASTE_PRIVATE_DIR ?? join(sessionRoot, ".pneuma", "leaf-logs");
  const budgetDir =
    process.env.WORDTASTE_REPAIR_BUDGET_DIR ?? join(sessionRoot, ".pneuma", "repair-budget");

  const available = (family: string): boolean => {
    if (!existsSync(probeFile)) return false;
    const pattern = new RegExp(`"${family}"[\\t ]*:[\\t ]*true`);
    return pattern.test(readFileSync(probeFile, "utf8"));
  };

  let runner: ((promptFile: string, systemFile: string | null) => Promise<LeafOutcome>) | null =
    null;
  switch (role) {
    case "writer":
    case "repair":
      if (available("openrouter")) runner = (prompt, system) => runHosted(prompt, sessionRoot, system);
      else if (available("claude")) runner = runCrosscheck;
      else if (available("codex")) runner = runPrimary;
      break;
    case "checker":
    case "planner":
      if (available("codex")) runner = runPrimary;
      else if (available("claude")) runner = runCrosscheck;
      break;
    default:
      return outcome(2, "wordtaste: leaf — role must be writer, planner, checker, or repair");
  }
  if (runner === null) {
    return outcome(3, "wordtaste: leaf — no usable isolated process is available");
  }

  // ── composed-prompt detection: only the first line decides ──
  let composed = false;
  if (existsSync(promptFileArg) && statSync(promptFileArg).isFile()) {
    const firstLine = readFileSync(promptFileArg, "utf8").split("\n")[0] ?? "";
    composed = firstLine === COMPOSED_MARKER;
  }

  // ── the standing system charter, when the composer wrote one ──
  // Only the composer emits `system.en.md`, always beside the prompt, and only
  // writer/repair prompts have one — so the lookup is gated on both. A prompt
  // without the sibling dispatches exactly as it always did, and checker and
  // planner prompts never grow a system half.
  let systemFile: string | null = null;
  if (composed && (role === "writer" || role === "repair")) {
    const sibling = join(dirname(promptFileArg), SYSTEM_PART);
    if (fileNonEmpty(sibling)) systemFile = sibling;
  }

  const notes: string[] = [];
  if (role === "writer" || role === "repair") {
    // Ahead of the repair-budget reservation on purpose: a brief that is
    // refused was never dispatched, so it must not spend a repair cycle.
    if (composed) {
      const note = composedBriefLint(promptFileArg);
      if (note !== null) notes.push(note);
    } else {
      const verdict = briefLint(promptFileArg);
      if (verdict !== null && typeof verdict !== "string") return verdict;
      if (typeof verdict === "string") notes.push(verdict);
    }
  }

  if (role === "repair") {
    const refused = await reserveRepairCycle(budgetDir, scope);
    if (refused !== null) return { ...refused, messages: [...notes, ...refused.messages] };
  }

  mkdirSync(privateDir, { recursive: true });
  process.env.WORDTASTE_PRIVATE_LOG = join(privateDir, `${role}-${process.pid}.log`);
  // One resolution for the whole dispatch: the adapter reads the environment,
  // and the environment is what the caller named or what the session stored.
  process.env.WORDTASTE_WRITER_MODEL = writerModel(sessionRoot);

  // ── priming (plain writer/repair prompts only) ──
  // A composed prompt already carries its passages inside <reference_prose>;
  // appending a second block would prime it twice. The checker is never
  // primed: it needs a clinical eye.
  let promptFile = promptFileArg;
  if (
    (role === "writer" || role === "repair") &&
    !composed &&
    process.env.WORDTASTE_PRIMER !== "0" &&
    // An unreadable prompt is the adapter's refusal to make, with its own
    // neutral line — never a primer crash.
    existsSync(promptFileArg)
  ) {
    const primedDir = process.env.WORDTASTE_PRIVATE_DIR ?? join(sessionRoot, ".pneuma", "private");
    const scopePart = scope || basename(promptFileArg);
    const repairs = role === "repair" ? readRepairCount(budgetDir, scope) : 0;
    const voiceDir = process.env.WORDTASTE_VOICE_DIR ?? join(sessionRoot, "materials", "voice");
    let block = "";
    try {
      block = samplePrimer({
        seed: primerSeed(sessionRoot, scopePart, repairs),
        libs: primerLibs(sessionRoot),
        voiceDir,
      });
    } catch (error) {
      // Priming is optional and never fatal. A sampler failure leaves its one
      // neutral line in the private log and the original prompt is dispatched.
      if (error instanceof SamplerError) {
        mkdirSync(privateDir, { recursive: true });
        appendFileSync(join(privateDir, `primer-${process.pid}.log`), `wordtaste: primer — ${error.message}\n`);
      } else {
        throw error;
      }
    }
    if (block.length > 0) {
      mkdirSync(primedDir, { recursive: true });
      const target = join(primedDir, `${basename(promptFileArg, ".md")}.primed.md`);
      const original = readFileSync(promptFileArg, "utf8");
      const primed =
        process.env.WORDTASTE_PRIMER_POSITION === "top"
          ? `${block}\n${original}`
          : `${original}\n${block}`;
      writeFileSync(target, primed);
      // Everything downstream — the adapter, the private log, the caller's
      // redirection — keeps operating on one prompt file path.
      promptFile = target;
    }
  }

  const result = await runner(promptFile, systemFile);
  return { ...result, messages: [...notes, ...result.messages] };
}
