import { describe, expect, test } from "bun:test";
import { isCollaborationPublicPath } from "../types/collaboration-publication.js";

describe("local copy publication boundary", () => {
  test("the shared private-path rule excludes attribution, retry receipts and incomplete stages at any nesting depth", () => {
    for (const path of ["imports/ref-a-r7/.pneuma-import.json", "imports/.import-staging/site/index.html", ".pneuma/collaboration-imports/request.json", "collaboration-imports/request.json", "nested/collaboration-imports/request.json"]) {
      expect(isCollaborationPublicPath(path)).toBe(false);
    }
    expect(isCollaborationPublicPath("imports/ref-a-r7/site/index.html")).toBe(true);
  });
});
