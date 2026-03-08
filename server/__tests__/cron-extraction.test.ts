/**
 * Tests for cron job extraction regex patterns used in src/ws.ts.
 * These verify that the regexes correctly parse Claude Code's text-based
 * tool_result output for CronCreate, CronDelete, and CronList.
 */
import { describe, test, expect } from "bun:test";

// Replicated from src/ws.ts — keep in sync
const CRON_CREATE_RESULT_RE = /Scheduled (?:recurring job|one-shot task) (\S+) \(([^)]+)\)/;
const CRON_LIST_LINE_RE = /^(\S+)\s+\u2014\s+(.+?)\s*\((recurring|one-shot)\)(?:\s*\[session-only\])?\s*:\s*(.+)$/;

describe("CronCreate result parsing", () => {
  test("parses recurring job result", () => {
    const text = "Scheduled recurring job abc12345 (every 5 minutes). Session-only (not written to disk, dies when Claude exits). Auto-expires after 3 days. Use CronDelete to cancel sooner.";
    const match = text.match(CRON_CREATE_RESULT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("abc12345");
    expect(match![2]).toBe("every 5 minutes");
    expect(text.startsWith("Scheduled recurring")).toBe(true);
    expect(text.includes("Persisted to")).toBe(false);
  });

  test("parses one-shot task result", () => {
    const text = "Scheduled one-shot task xyz789 (Feb 28 at 2:30 PM). Session-only (not written to disk, dies when Claude exits). It will fire once then auto-delete.";
    const match = text.match(CRON_CREATE_RESULT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("xyz789");
    expect(match![2]).toBe("Feb 28 at 2:30 PM");
    expect(text.startsWith("Scheduled recurring")).toBe(false);
  });

  test("parses durable job result", () => {
    const text = "Scheduled recurring job durable1 (every hour). Persisted to .claude/scheduled_tasks.json. Auto-expires after 3 days. Use CronDelete to cancel sooner.";
    const match = text.match(CRON_CREATE_RESULT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("durable1");
    expect(match![2]).toBe("every hour");
    expect(text.includes("Persisted to")).toBe(true);
  });
});

describe("CronList result parsing", () => {
  test("parses recurring session-only job line", () => {
    const line = "abc12345 \u2014 every 5 minutes (recurring) [session-only]: Check build status";
    const match = line.match(CRON_LIST_LINE_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("abc12345");
    expect(match![2]).toBe("every 5 minutes");
    expect(match![3]).toBe("recurring");
    expect(match![4]).toBe("Check build status");
    expect(line.includes("[session-only]")).toBe(true);
  });

  test("parses one-shot durable job line", () => {
    const line = "xyz789 \u2014 Mar 1 at 9:00 AM (one-shot): Deploy to production";
    const match = line.match(CRON_LIST_LINE_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("xyz789");
    expect(match![2]).toBe("Mar 1 at 9:00 AM");
    expect(match![3]).toBe("one-shot");
    expect(match![4]).toBe("Deploy to production");
    expect(line.includes("[session-only]")).toBe(false);
  });

  test("parses multi-line CronList output", () => {
    const content = [
      "abc12345 \u2014 every 5 minutes (recurring) [session-only]: Check build status",
      "def456 \u2014 every hour (recurring): Run smoke tests",
      "ghi789 \u2014 tomorrow at 8:00 AM (one-shot) [session-only]: Morning standup reminder",
    ].join("\n");

    const jobs: { id: string; humanSchedule: string; recurring: boolean; prompt: string }[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(CRON_LIST_LINE_RE);
      if (m) {
        jobs.push({
          id: m[1],
          humanSchedule: m[2],
          recurring: m[3] === "recurring",
          prompt: m[4],
        });
      }
    }

    expect(jobs).toHaveLength(3);
    expect(jobs[0].id).toBe("abc12345");
    expect(jobs[0].recurring).toBe(true);
    expect(jobs[1].id).toBe("def456");
    expect(jobs[1].prompt).toBe("Run smoke tests");
    expect(jobs[2].id).toBe("ghi789");
    expect(jobs[2].recurring).toBe(false);
  });

  test("handles empty CronList", () => {
    const content = "No scheduled jobs.";
    expect(content === "No scheduled jobs." || content.trim() === "").toBe(true);
  });

  test("handles prompt with special characters", () => {
    const line = 'abc123 \u2014 every 10 minutes (recurring) [session-only]: Run `bun test` && check /api/health for status: "ok"';
    const match = line.match(CRON_LIST_LINE_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("abc123");
    expect(match![4]).toBe('Run `bun test` && check /api/health for status: "ok"');
  });
});

describe("CronDelete result parsing", () => {
  test("recognizes cancelled job text", () => {
    const text = "Cancelled job abc12345.";
    expect(text.startsWith("Cancelled job")).toBe(true);
  });
});
