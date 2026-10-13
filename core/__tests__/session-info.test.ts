import { describe, expect, test } from "bun:test";
import { resolveSessionTitle } from "../types/session-info.js";

describe("session title", () => {
  test("a manual registry rename wins over persisted names and refinements", () => {
    expect(resolveSessionTitle(
      { sessionName: "Earlier manual name", displayName: "Agent topic" },
      { sessionName: "Chosen name", displayName: "Cached topic" },
    )).toBe("Chosen name");
  });

  test("persisted manual names win over refinements, which win over registry defaults", () => {
    const cached = { displayName: "Doc" };
    expect(resolveSessionTitle({ sessionName: "Manual name", displayName: "Agent topic" }, cached)).toBe("Manual name");
    expect(resolveSessionTitle({ displayName: "Agent topic" }, cached)).toBe("Agent topic");
    expect(resolveSessionTitle({}, cached)).toBe("Doc");
  });

  test("blank names fall through and title whitespace becomes a single line", () => {
    expect(resolveSessionTitle(
      { sessionName: " \t ", displayName: "  Autumn\n launch\tplan  " },
      { sessionName: "\n", displayName: "Doc" },
    )).toBe("Autumn launch plan");
  });

  test("missing and malformed metadata cannot become a title", () => {
    for (const value of [undefined, null, [], "not metadata", 42, { sessionName: [], displayName: 12 }]) {
      expect(resolveSessionTitle(value, value)).toBeNull();
      expect(resolveSessionTitle(value, { displayName: "Registry fallback" })).toBe("Registry fallback");
    }
    expect(resolveSessionTitle({ displayName: " \n " }, {})).toBeNull();
  });
});
