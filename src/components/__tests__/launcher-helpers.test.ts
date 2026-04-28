import { describe, expect, test } from "bun:test";
import { buildContinueItems } from "../launcher-helpers";

describe("buildContinueItems", () => {
  test("excludes running project processes from global recent sessions", () => {
    const items = buildContinueItems(
      [
        { workspace: "/tmp/quick", mode: "doc" },
      ],
      [
        { pid: 1, specifier: "webcraft", workspace: "/tmp/project", projectRoot: "/tmp/project" },
        { pid: 2, specifier: "doc", workspace: "/tmp/quick" },
      ],
    );

    expect(items.map((item) => item.key)).toEqual(["running:2"]);
  });
});
