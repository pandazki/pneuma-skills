import { describe, expect, it } from "bun:test";
import { isPneumaMarkerOnly } from "../utils/pneuma-markers.js";

describe("isPneumaMarkerOnly", () => {
  it("accepts self-closing envelopes", () => {
    expect(isPneumaMarkerOnly('<pneuma:env reason="opened" />')).toBe(true);
    expect(isPneumaMarkerOnly("<pneuma:handoff-cancelled />")).toBe(true);
  });

  it("accepts paired envelopes with matching names", () => {
    expect(isPneumaMarkerOnly("<pneuma:askq-answer>x</pneuma:askq-answer>")).toBe(true);
    expect(
      isPneumaMarkerOnly(
        '<pneuma:askq-answer tool_use_id="abc">multi\nline body</pneuma:askq-answer>',
      ),
    ).toBe(true);
  });

  it("rejects mismatched open/close tag names", () => {
    expect(isPneumaMarkerOnly("<pneuma:foo>x</pneuma:bar>")).toBe(false);
  });

  it("rejects two adjacent markers as a single marker", () => {
    // The previous greedy regex would mis-classify this as a single
    // marker because `[\s\S]*` ate the middle. We reject it now so
    // legitimate user input between markers is not treated as noise.
    const s =
      '<pneuma:env reason="opened" />\nplease continue\n<pneuma:askq-answer>ok</pneuma:askq-answer>';
    expect(isPneumaMarkerOnly(s)).toBe(false);
    const t =
      "<pneuma:env>x</pneuma:env>\nfoo\n<pneuma:env>y</pneuma:env>";
    expect(isPneumaMarkerOnly(t)).toBe(false);
  });

  it("rejects content trailing after a marker", () => {
    expect(isPneumaMarkerOnly("<pneuma:env>x</pneuma:env>foo")).toBe(false);
    expect(isPneumaMarkerOnly("<pneuma:env />trailing")).toBe(false);
  });

  it("rejects content preceding a marker", () => {
    expect(isPneumaMarkerOnly("hello <pneuma:env />")).toBe(false);
  });

  it("rejects bare open or close tags", () => {
    expect(isPneumaMarkerOnly("<pneuma:env>")).toBe(false);
    expect(isPneumaMarkerOnly("</pneuma:env>")).toBe(false);
  });

  it("rejects empty / non-pneuma input", () => {
    expect(isPneumaMarkerOnly("")).toBe(false);
    expect(isPneumaMarkerOnly("   ")).toBe(false);
    expect(isPneumaMarkerOnly("hello world")).toBe(false);
    expect(isPneumaMarkerOnly("<other>x</other>")).toBe(false);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(isPneumaMarkerOnly("  <pneuma:env />  ")).toBe(true);
    expect(
      isPneumaMarkerOnly("\n<pneuma:askq-answer>x</pneuma:askq-answer>\n"),
    ).toBe(true);
  });
});
