/**
 * Tests for cron job extraction logic used in src/ws.ts.
 *
 * The current approach extracts cron job data directly from CronCreate/CronDelete
 * tool_use blocks (optimistic extraction), because tool_result blocks are NOT
 * forwarded through the SDK WebSocket stream.
 *
 * We also keep the regex tests for the text-based tool_result format as protocol
 * documentation — these patterns match what Claude Code returns internally, even
 * though we can't observe them in the SDK stream.
 */
import { describe, test, expect } from "bun:test";

// === Optimistic extraction helpers (replicated from src/ws.ts — keep in sync) ===

function cronIdFromToolUseId(toolUseId: string): string {
  return toolUseId.replace(/^toolu_/, "").slice(0, 8);
}

function cronToHuman(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(min.slice(2), 10);
    return n === 1 ? "every minute" : `every ${n} minutes`;
  }
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? "every hour" : `every ${n} hours`;
  }
  if (min === "0" && hour === "0" && dom.startsWith("*/") && mon === "*" && dow === "*") {
    const n = parseInt(dom.slice(2), 10);
    return n === 1 ? "every day" : `every ${n} days`;
  }
  return cron;
}

// === cronIdFromToolUseId tests ===

describe("cronIdFromToolUseId", () => {
  test("strips toolu_ prefix and takes first 8 chars", () => {
    expect(cronIdFromToolUseId("toolu_01Pxo1jBabcdefgh")).toBe("01Pxo1jB");
  });

  test("handles ID without toolu_ prefix", () => {
    expect(cronIdFromToolUseId("abcdefghijklmnop")).toBe("abcdefgh");
  });

  test("handles short ID", () => {
    expect(cronIdFromToolUseId("toolu_abc")).toBe("abc");
  });
});

// === cronToHuman tests ===

describe("cronToHuman", () => {
  test("converts */N minute patterns", () => {
    expect(cronToHuman("*/5 * * * *")).toBe("every 5 minutes");
    expect(cronToHuman("*/1 * * * *")).toBe("every minute");
    expect(cronToHuman("*/30 * * * *")).toBe("every 30 minutes");
  });

  test("converts */N hour patterns", () => {
    expect(cronToHuman("0 */2 * * *")).toBe("every 2 hours");
    expect(cronToHuman("0 */1 * * *")).toBe("every hour");
  });

  test("converts */N day patterns", () => {
    expect(cronToHuman("0 0 */1 * *")).toBe("every day");
    expect(cronToHuman("0 0 */3 * *")).toBe("every 3 days");
  });

  test("returns raw cron for unrecognized patterns", () => {
    expect(cronToHuman("0 9 * * 1")).toBe("0 9 * * 1");
    expect(cronToHuman("30 14 1 * *")).toBe("30 14 1 * *");
  });

  test("returns raw string for invalid cron", () => {
    expect(cronToHuman("invalid")).toBe("invalid");
    expect(cronToHuman("* * *")).toBe("* * *");
  });
});

// === tool_use block extraction simulation ===

describe("CronCreate tool_use extraction", () => {
  test("extracts job from CronCreate tool_use input", () => {
    const block = {
      type: "tool_use" as const,
      id: "toolu_01Pxo1jBabcdefghijklmnop",
      name: "CronCreate",
      input: {
        cron: "*/5 * * * *",
        prompt: "Check README status",
        recurring: true,
      },
    };

    const input = block.input as Record<string, unknown>;
    const job = {
      id: cronIdFromToolUseId(block.id),
      cron: (input.cron as string) || "",
      humanSchedule: cronToHuman((input.cron as string) || ""),
      prompt: (input.prompt as string) || "",
      recurring: (input.recurring as boolean) ?? true,
      durable: (input.durable as boolean) ?? false,
    };

    expect(job.id).toBe("01Pxo1jB");
    expect(job.cron).toBe("*/5 * * * *");
    expect(job.humanSchedule).toBe("every 5 minutes");
    expect(job.prompt).toBe("Check README status");
    expect(job.recurring).toBe(true);
    expect(job.durable).toBe(false);
  });

  test("defaults recurring to true when omitted", () => {
    const input = { cron: "*/10 * * * *", prompt: "test" };
    expect((input as Record<string, unknown>).recurring ?? true).toBe(true);
  });

  test("extracts durable flag", () => {
    const input = { cron: "0 */1 * * *", prompt: "test", recurring: true, durable: true };
    expect(input.durable).toBe(true);
  });
});

describe("CronDelete tool_use extraction", () => {
  test("extracts job ID from CronDelete tool_use input", () => {
    const block = {
      type: "tool_use" as const,
      id: "toolu_xyz789",
      name: "CronDelete",
      input: { id: "abc12345" },
    };
    const input = block.input as Record<string, unknown>;
    expect(input.id).toBe("abc12345");
  });
});

// === Protocol documentation: tool_result text patterns ===
// These regexes match Claude Code's internal tool_result format.
// They are NOT used in the current extraction logic (tool_results are not
// forwarded via SDK stream), but are preserved for protocol reference.

const CRON_CREATE_RESULT_RE = /Scheduled (?:recurring job|one-shot task) (\S+) \(([^)]+)\)/;
const CRON_LIST_LINE_RE = /^(\S+)\s+\u2014\s+(.+?)\s*\((recurring|one-shot)\)(?:\s*\[session-only\])?\s*:\s*(.+)$/;

describe("[Protocol ref] CronCreate result text parsing", () => {
  test("parses recurring job result", () => {
    const text = "Scheduled recurring job abc12345 (every 5 minutes). Session-only (not written to disk, dies when Claude exits). Auto-expires after 3 days. Use CronDelete to cancel sooner.";
    const match = text.match(CRON_CREATE_RESULT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("abc12345");
    expect(match![2]).toBe("every 5 minutes");
  });

  test("parses one-shot task result", () => {
    const text = "Scheduled one-shot task xyz789 (Feb 28 at 2:30 PM). Session-only (not written to disk, dies when Claude exits). It will fire once then auto-delete.";
    const match = text.match(CRON_CREATE_RESULT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("xyz789");
    expect(match![2]).toBe("Feb 28 at 2:30 PM");
  });
});

describe("[Protocol ref] CronList result text parsing", () => {
  test("parses recurring session-only job line", () => {
    const line = "abc12345 \u2014 every 5 minutes (recurring) [session-only]: Check build status";
    const match = line.match(CRON_LIST_LINE_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("abc12345");
    expect(match![2]).toBe("every 5 minutes");
    expect(match![3]).toBe("recurring");
    expect(match![4]).toBe("Check build status");
  });

  test("parses multi-line CronList output", () => {
    const content = [
      "abc12345 \u2014 every 5 minutes (recurring) [session-only]: Check build status",
      "def456 \u2014 every hour (recurring): Run smoke tests",
    ].join("\n");

    const jobs: { id: string }[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(CRON_LIST_LINE_RE);
      if (m) jobs.push({ id: m[1] });
    }
    expect(jobs).toHaveLength(2);
  });
});
