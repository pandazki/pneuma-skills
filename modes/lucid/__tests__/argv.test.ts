import { describe, expect, test } from "bun:test";
import { parseArgs } from "node:util";

import { joinNegativeNumbers } from "../skill/scripts/argv.mjs";

describe("joinNegativeNumbers", () => {
  test("a negative number after its option becomes one token parseArgs accepts", () => {
    expect(joinNegativeNumbers(["prep", "in.glb", "--yaw", "-90", "--height", "1.8"]))
      .toEqual(["prep", "in.glb", "--yaw=-90", "--height", "1.8"]);
    expect(joinNegativeNumbers(["--offset", "-0.25", "--scale", "-1e-3", "--x", "-.5"]))
      .toEqual(["--offset=-0.25", "--scale=-1e-3", "--x=-.5"]);
    const parsed = parseArgs({
      args: joinNegativeNumbers(["--yaw", "-90"]),
      options: { yaw: { type: "string" } },
      strict: true,
    });
    expect(parsed.values.yaw).toBe("-90");
    expect(() => parseArgs({ args: ["--yaw", "-90"], options: { yaw: { type: "string" } }, strict: true })).toThrow();
  });

  test("everything that is not a negative number after a bare option is left alone", () => {
    const untouched = ["--merge", "-", "--name=-90", "--thin", "leaf,-flag", "-90", "--yaw", "90", "--yaw", "-x"];
    expect(joinNegativeNumbers(untouched)).toEqual(untouched);
    expect(joinNegativeNumbers([])).toEqual([]);
  });
});
