/**
 * PneumaSignalPill parse tests.
 *
 * The chat-side signal pill renders `<pneuma:*>` system tags as quiet
 * conversation markers. These tests pin the pure `parsePneumaTag` parse for the
 * borrow round-trip's two new tags — `<pneuma:request-borrow>` (the affordance,
 * symmetric with request-handoff) and `<pneuma:borrow-returned>` (the queued
 * return poke A actually receives). The tag must parse cleanly so the pill can
 * summarize it rather than dumping a raw XML blob into the chat flow.
 */

import { describe, expect, test } from "bun:test";
import { parsePneumaTag } from "../PneumaSignalPill.js";

describe("parsePneumaTag — borrow round-trip tags", () => {
  test("parses <pneuma:borrow-returned> with its result_path + status attrs", () => {
    const tag = parsePneumaTag(
      '<pneuma:borrow-returned borrow_id="brw-1" mode="wordtaste" status="completed" result_path="/abs/path/borrow-result.json" />',
    );
    expect(tag).not.toBeNull();
    expect(tag!.kind).toBe("borrow-returned");
    expect(tag!.attrs.mode).toBe("wordtaste");
    expect(tag!.attrs.status).toBe("completed");
    expect(tag!.attrs.result_path).toBe("/abs/path/borrow-result.json");
  });

  test("parses <pneuma:request-borrow> with its target mode", () => {
    const tag = parsePneumaTag('<pneuma:request-borrow mode="illustrate" />');
    expect(tag).not.toBeNull();
    expect(tag!.kind).toBe("request-borrow");
    expect(tag!.attrs.mode).toBe("illustrate");
  });

  test("parses a borrow env-start tag (reason=borrow) like other env tags", () => {
    const tag = parsePneumaTag(
      '<pneuma:env reason="borrow" mode="wordtaste" borrow_id="brw-1" from_mode="webcraft" />',
    );
    expect(tag).not.toBeNull();
    expect(tag!.kind).toBe("env");
    expect(tag!.attrs.reason).toBe("borrow");
    expect(tag!.attrs.from_mode).toBe("webcraft");
  });

  test("decodes XML entities in a borrow-returned result_path (paths may carry & / quotes)", () => {
    const tag = parsePneumaTag(
      '<pneuma:borrow-returned borrow_id="b" mode="m" status="completed" result_path="/a &amp; b/result.json" />',
    );
    expect(tag).not.toBeNull();
    expect(tag!.attrs.result_path).toBe("/a & b/result.json");
  });
});
