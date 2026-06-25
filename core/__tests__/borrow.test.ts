/**
 * Borrow contract tests — round-trip cross-mode handoff (peer delegation).
 *
 * Pins the three contract shapes in `core/types/borrow.ts`:
 *   - BorrowDispatchPayload — caller A → server (the bounded brief)
 *   - BorrowResult          — borrowed mode B → disk → A (the return leg)
 *   - BorrowLink            — server in-memory link record
 *
 * plus the pure helpers/guards that keep the contract's defaults in one place:
 *   - isBorrowResult(value)        — runtime guard for the JSON A reads off disk
 *   - normalizeBorrowScope(scope)  — resolves the `scope` default to "return" (D3)
 *   - MAX_CONCURRENT_BORROWS_PER_SESSION — concurrency default (OQ-5: 1 active, queue rest)
 *
 * These are behavior tests through the public interface, not shape-snapshots:
 * they pin what callers can rely on (a malformed result is rejected; a brief
 * with no scope behaves as "return"; the queue cap is exactly 1).
 */

import { describe, expect, test } from "bun:test";
import {
  isBorrowResult,
  normalizeBorrowScope,
  MAX_CONCURRENT_BORROWS_PER_SESSION,
  type BorrowDispatchPayload,
  type BorrowResult,
  type BorrowLink,
  type BorrowScope,
  type BorrowReturnVia,
} from "../types/borrow.js";

describe("BorrowDispatchPayload", () => {
  test("a minimal brief carries only mode + brief", () => {
    const payload: BorrowDispatchPayload = {
      mode: "wordtaste",
      brief: "Polish the hero copy in the user's voice; keep it under 40 words.",
    };
    expect(payload.mode).toBe("wordtaste");
    expect(payload.brief.length).toBeGreaterThan(0);
    // No scope on a minimal dispatch — the default resolves to "return".
    expect(payload.scope).toBeUndefined();
  });

  test("a full brief carries inputs / expects / scope / in_place_targets / return_via", () => {
    const returnVia: BorrowReturnVia = {
      borrow_id: "brw-123",
      host_server_url: "http://127.0.0.1:17996",
    };
    const payload: BorrowDispatchPayload = {
      mode: "wordtaste",
      brief: "Rewrite section copy in a 中国风 register.",
      inputs: ["/proj/site/index.html", "/proj/site/copy.md"],
      expects: "polished markdown + a per-section change-notes list mapping each edit to a rationale",
      scope: "in-place",
      in_place_targets: ["/proj/site/copy.md"],
      summary: "Ink-wash landing page; copy must stay unified with the visual tone.",
      language: "zh-CN",
      return_via: returnVia,
    };
    expect(payload.scope).toBe("in-place");
    expect(payload.in_place_targets).toEqual(["/proj/site/copy.md"]);
    expect(payload.return_via?.borrow_id).toBe("brw-123");
    expect(payload.inputs).toHaveLength(2);
  });
});

describe("normalizeBorrowScope", () => {
  test("defaults to 'return' when scope is absent (D3: host applies the diff)", () => {
    expect(normalizeBorrowScope(undefined)).toBe("return");
  });

  test("preserves an explicit 'return'", () => {
    expect(normalizeBorrowScope("return")).toBe("return");
  });

  test("preserves an explicit 'in-place' (the opt-in escape hatch)", () => {
    expect(normalizeBorrowScope("in-place")).toBe("in-place");
  });

  test("falls back to 'return' for any unrecognized value read off disk", () => {
    // Defensive: the brief is JSON, so a stray string must not become an
    // accidental in-place write. Anything that is not "in-place" is "return".
    expect(normalizeBorrowScope("nonsense" as unknown as BorrowScope)).toBe("return");
  });
});

describe("isBorrowResult", () => {
  test("accepts a completed result with produced artifacts", () => {
    const result: BorrowResult = {
      borrow_id: "brw-123",
      mode: "wordtaste",
      status: "completed",
      produced: [
        { path: "/tmp/pneuma-borrow-brw-123/polished.md", kind: "markdown", role: "polished-copy" },
      ],
      change_notes: "Tightened the hero line; warmed the CTA verb. See per-section notes.",
      produced_at: 1714200000000,
    };
    expect(isBorrowResult(result)).toBe(true);
  });

  test("accepts a failed result with an empty produced[] and open questions", () => {
    const result: BorrowResult = {
      borrow_id: "brw-9",
      mode: "illustrate",
      status: "failed",
      produced: [],
      change_notes: "Could not match the requested 水墨 mark; need a reference image.",
      open_questions: ["Which existing asset should the logo echo?"],
      produced_at: 1,
    };
    expect(isBorrowResult(result)).toBe(true);
  });

  test("accepts a partial result that lists in-place edits", () => {
    const result: BorrowResult = {
      borrow_id: "brw-7",
      mode: "wordtaste",
      status: "partial",
      produced: [{ path: "/proj/site/copy.md", role: "polished-copy" }],
      change_notes: "Edited two of three sections; third needs a product fact I lacked.",
      applied_in_place: ["/proj/site/copy.md"],
      produced_at: 2,
    };
    expect(isBorrowResult(result)).toBe(true);
  });

  test("rejects null / non-objects", () => {
    expect(isBorrowResult(null)).toBe(false);
    expect(isBorrowResult(undefined)).toBe(false);
    expect(isBorrowResult("brw")).toBe(false);
    expect(isBorrowResult(42)).toBe(false);
  });

  test("rejects when required scalar fields are missing or mistyped", () => {
    expect(isBorrowResult({})).toBe(false);
    // missing produced[]
    expect(
      isBorrowResult({ borrow_id: "x", mode: "m", status: "completed", change_notes: "", produced_at: 1 }),
    ).toBe(false);
    // missing change_notes
    expect(
      isBorrowResult({ borrow_id: "x", mode: "m", status: "completed", produced: [], produced_at: 1 }),
    ).toBe(false);
    // missing produced_at
    expect(
      isBorrowResult({ borrow_id: "x", mode: "m", status: "completed", produced: [], change_notes: "" }),
    ).toBe(false);
  });

  test("rejects an unknown status value", () => {
    expect(
      isBorrowResult({
        borrow_id: "x",
        mode: "m",
        status: "done", // not one of completed | failed | partial
        produced: [],
        change_notes: "",
        produced_at: 1,
      }),
    ).toBe(false);
  });

  test("rejects when produced is not an array, or an entry lacks a path", () => {
    expect(
      isBorrowResult({
        borrow_id: "x",
        mode: "m",
        status: "completed",
        produced: "nope",
        change_notes: "",
        produced_at: 1,
      }),
    ).toBe(false);
    expect(
      isBorrowResult({
        borrow_id: "x",
        mode: "m",
        status: "completed",
        produced: [{ kind: "markdown" }], // no path
        change_notes: "",
        produced_at: 1,
      }),
    ).toBe(false);
  });

  test("round-trips through JSON (the disk transport B writes / A reads)", () => {
    const result: BorrowResult = {
      borrow_id: "brw-rt",
      mode: "wordtaste",
      status: "completed",
      produced: [{ path: "/x/p.md", kind: "markdown", role: "polished-copy" }],
      change_notes: "ok",
      open_questions: [],
      produced_at: 1714200000001,
    };
    const reparsed: unknown = JSON.parse(JSON.stringify(result));
    expect(isBorrowResult(reparsed)).toBe(true);
    // The guard narrows the type so callers can read fields without casts.
    if (isBorrowResult(reparsed)) {
      expect(reparsed.produced[0]?.role).toBe("polished-copy");
    }
  });
});

describe("BorrowLink", () => {
  test("models the server's in-memory link with a lifecycle state", () => {
    const link: BorrowLink = {
      borrow_id: "brw-123",
      host_session_id: "A-session",
      borrow_session_id: "brw-123",
      mode: "wordtaste",
      project_root: "/proj",
      borrow_dir: "/proj/.pneuma/sessions/brw-123",
      state: "running",
      dispatched_at: 1714200000000,
    };
    expect(link.state).toBe("running");
    // project_root is absent for quick sessions (B runs in a temp dir).
    const quick: BorrowLink = {
      borrow_id: "brw-q",
      host_session_id: "A-q",
      borrow_session_id: "brw-q",
      mode: "illustrate",
      borrow_dir: "/tmp/pneuma-borrow-brw-q",
      state: "completed",
      dispatched_at: 2,
    };
    expect(quick.project_root).toBeUndefined();
  });
});

describe("concurrency default (OQ-5)", () => {
  test("one active borrow per session; extras queue", () => {
    // Encoded as a documented constant so the server task enforces a single
    // source of truth rather than re-deciding the cap inline.
    expect(MAX_CONCURRENT_BORROWS_PER_SESSION).toBe(1);
  });
});
