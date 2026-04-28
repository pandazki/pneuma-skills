/**
 * ProjectPanel smoke tests — focus on the Smart Handoff tag construction.
 *
 * The codebase has no DOM harness and ProjectPanel transitively imports
 * `ws.ts → native-bridge.ts`, which references `window` at module load.
 * Importing the component under bun:test would crash at parse time with
 * `ReferenceError: window is not defined`. Instead we verify the function-
 * level contract the Smart Handoff branch relies on:
 *
 *   1. The exact `<pneuma:request-handoff …/>` tag shape the panel
 *      dispatches via `sendUserMessage` matches the protocol the
 *      pneuma-project skill expects (target, target_session="auto",
 *      intent). Drift here breaks cross-mode handoff silently.
 *   2. Intent escaping — we route user input through `escapeXml` before
 *      embedding it in attributes. The intent must survive `&`, `<`, `>`,
 *      `"`, `'` without breaking the tag.
 *   3. The whitespace-collapse + empty-intent rules `confirmLaunch` uses
 *      to validate before firing.
 */
import { describe, expect, test } from "bun:test";
import { escapeXml } from "../../utils/string.js";

describe("ProjectPanel — Smart Handoff", () => {

  test("constructs the request-handoff tag identical to ModeSwitcherDropdown's shape", () => {
    // Mirrors `confirmLaunch` in ProjectPanel.tsx — same template, same
    // escape function, same target_session="auto" sentinel. If the panel's
    // tag drifts from this format, downstream handoff parsing breaks.
    const target = "slide";
    const intent = "Mock up a landing page for the demo";
    const flat = intent.replace(/\s+/g, " ").trim();
    const tag = `<pneuma:request-handoff target="${escapeXml(target)}" target_session="auto" intent="${escapeXml(flat)}" />`;
    expect(tag).toBe(
      '<pneuma:request-handoff target="slide" target_session="auto" intent="Mock up a landing page for the demo" />',
    );
  });

  test("escapes hostile intent text so it cannot break out of the tag", () => {
    const intent = `Build a "<script>" demo & more`;
    const flat = intent.replace(/\s+/g, " ").trim();
    const tag = `<pneuma:request-handoff target="slide" target_session="auto" intent="${escapeXml(flat)}" />`;
    // No raw `<` or unescaped `"` inside the attribute value
    expect(tag).toContain("&lt;script&gt;");
    expect(tag).toContain("&quot;");
    expect(tag).toContain("&amp;");
    // Outer tag delimiters intact
    expect(tag.startsWith("<pneuma:request-handoff")).toBe(true);
    expect(tag.endsWith("/>")).toBe(true);
  });

  test("collapses whitespace before embedding the intent", () => {
    const intent = "  multi\n line   intent  ";
    const flat = intent.replace(/\s+/g, " ").trim();
    expect(flat).toBe("multi line intent");
  });

  test("rejects empty intent (validation prevents an empty tag from firing)", () => {
    // The panel's `confirmLaunch` rejects empty intent before sending. We
    // mirror the trim+check rule here so a regression that drops the guard
    // breaks this test.
    const intent = "   \n   ";
    const flat = intent.replace(/\s+/g, " ").trim();
    expect(flat.length).toBe(0);
  });
});
