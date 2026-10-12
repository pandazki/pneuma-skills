import { afterEach, describe, expect, test } from "bun:test";
import { mediaTierEnabled } from "./test-tier.js";

const originalMedia = process.env.PNEUMA_TEST_MEDIA;
const originalLive = process.env.PNEUMA_TEST_LIVE;
afterEach(() => {
  if (originalMedia === undefined) delete process.env.PNEUMA_TEST_MEDIA;
  else process.env.PNEUMA_TEST_MEDIA = originalMedia;
  if (originalLive === undefined) delete process.env.PNEUMA_TEST_LIVE;
  else process.env.PNEUMA_TEST_LIVE = originalLive;
});

describe("media test selection", () => {
  test("media processing is opt-in, independent of the live tier", () => {
    delete process.env.PNEUMA_TEST_MEDIA;
    process.env.PNEUMA_TEST_LIVE = "1";
    expect(mediaTierEnabled("sprite")).toBe(false);
    for (const value of ["", "0", "false", "true"]) {
      process.env.PNEUMA_TEST_MEDIA = value;
      expect(mediaTierEnabled("sprite")).toBe(false);
    }
  });

  test("1 enables every mode", () => {
    process.env.PNEUMA_TEST_MEDIA = " 1 ";
    expect(mediaTierEnabled("sprite")).toBe(true);
    expect(mediaTierEnabled("backlot")).toBe(true);
    expect(mediaTierEnabled("new-mode")).toBe(true);
  });

  test("comma-separated names match whole modes, with whitespace and empty entries ignored", () => {
    process.env.PNEUMA_TEST_MEDIA = " sprite, ,backlot,sprite ";
    expect(mediaTierEnabled("sprite")).toBe(true);
    expect(mediaTierEnabled("backlot")).toBe(true);
    expect(mediaTierEnabled("plotwise")).toBe(false);
    expect(mediaTierEnabled("spr")).toBe(false);
    expect(mediaTierEnabled("")).toBe(false);
  });
});
