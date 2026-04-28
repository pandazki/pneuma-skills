import { describe, expect, test } from "bun:test";
import { buildEnvTag } from "../env-tag.js";

describe("buildEnvTag", () => {
  test("returns null when mode missing", () => {
    expect(buildEnvTag({ mode: "" })).toBeNull();
  });

  test("opened — quick session has no project attr", () => {
    expect(buildEnvTag({ mode: "doc" })).toBe('<pneuma:env reason="opened" mode="doc" />');
  });

  test("opened — project session includes project name", () => {
    expect(
      buildEnvTag({ mode: "webcraft", projectName: "Pneuma Demo Project" }),
    ).toBe('<pneuma:env reason="opened" project="Pneuma Demo Project" mode="webcraft" />');
  });

  test("switched — populates from_* attrs from CLI flags", () => {
    expect(
      buildEnvTag({
        mode: "webcraft",
        projectName: "Demo",
        fromSessionId: "src-1",
        fromMode: "illustrate",
        fromDisplayName: "Brand exploration",
      }),
    ).toBe(
      '<pneuma:env reason="switched" project="Demo" mode="webcraft" from_session="src-1" from_mode="illustrate" from_display_name="Brand exploration" />',
    );
  });

  test("switched skips empty optional fromMode/fromDisplayName", () => {
    expect(
      buildEnvTag({
        mode: "webcraft",
        projectName: "Demo",
        fromSessionId: "src-1",
        fromMode: "",
        fromDisplayName: "",
      }),
    ).toBe(
      '<pneuma:env reason="switched" project="Demo" mode="webcraft" from_session="src-1" />',
    );
  });

  test("handed-off — pulls from inbound payload (overrides fromSessionId)", () => {
    expect(
      buildEnvTag({
        mode: "webcraft",
        projectName: "Demo",
        inbound: {
          handoff_id: "hf-1",
          source_session_id: "inbound-src",
          source_mode: "illustrate",
          source_display_name: "Brand exploration",
        },
        fromSessionId: "should-be-ignored",
      }),
    ).toBe(
      '<pneuma:env reason="handed-off" project="Demo" mode="webcraft" from_session="inbound-src" from_mode="illustrate" from_display_name="Brand exploration" />',
    );
  });

  test("escapes quotes / ampersands / angle brackets in attrs", () => {
    expect(
      buildEnvTag({
        mode: "doc",
        projectName: 'Project "X" & <Y>',
      }),
    ).toBe(
      '<pneuma:env reason="opened" project="Project &quot;X&quot; &amp; &lt;Y&gt;" mode="doc" />',
    );
  });

  test("opened with no project still includes mode", () => {
    expect(buildEnvTag({ mode: "draw" })).toBe('<pneuma:env reason="opened" mode="draw" />');
  });
});
