import { describe, expect, test } from "bun:test";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { resolveWordtasteContentSets } from "../pneuma-mode.js";

function files(...paths: string[]): ViewerFileContent[] {
  return paths.map((path) => ({ path, content: "" }));
}

describe("WordTaste content sets", () => {
  test("keeps support folders inside a root-level piece", () => {
    expect(
      resolveWordtasteContentSets(
        files(
          "draft.md",
          "workflow.json",
          "materials/brief.md",
          "taste/taste-profile.md",
          "candidates/a.md",
        ),
      ),
    ).toEqual([]);
  });

  test("only treats directories containing a piece contract as content sets", () => {
    expect(
      resolveWordtasteContentSets(
        files(
          "essay-a/workflow.json",
          "essay-a/materials/brief.md",
          "essay-b/draft.md",
          "essay-b/taste/taste-profile.md",
          "shared/notes.md",
        ),
      ).map((set) => set.prefix),
    ).toEqual(["essay-a", "essay-b"]);
  });

  test("does not mistake support-only directories for empty pieces", () => {
    expect(
      resolveWordtasteContentSets(
        files("materials/brief.md", "taste/taste-profile.md"),
      ),
    ).toEqual([]);
  });
});
