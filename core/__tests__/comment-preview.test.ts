import { describe, expect, test } from "bun:test";
import { COMMENT_PREVIEW_LIMITS, isCommentThumbnail, normalizeCommentPreview, validateCommentPreview } from "../collaboration/comment-preview.js";

describe("shared collaboration comment preview boundary", () => {
  test("accepts existing SVG selection previews and inert raster image URLs only", () => {
    const thumbnail = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>');
    expect(validateCommentPreview({ label: "Heading", thumbnail })).toEqual({ label: "Heading", thumbnail });
    expect(isCommentThumbnail("data:image/png;base64,aGVsbG8=")).toBe(true);
    for (const value of ["https://example.test/image.png", "data:text/html,<script/>", "javascript:alert(1)", "data:image/png;base64,!", "data:image/svg+xml;charset=utf-8,%XX"]) {
      expect(isCommentThumbnail(value)).toBe(false);
      expect(() => validateCommentPreview({ thumbnail: value })).toThrow();
    }
  });
  test("API validation rejects malformed and unbounded metadata without retaining unknown properties", () => {
    for (const value of [null, [], "preview", { label: 4 }, { content: "x".repeat(2001) }, { thumbnail: "data:image/png;base64," + "a".repeat(COMMENT_PREVIEW_LIMITS.thumbnail) }]) expect(() => validateCommentPreview(value)).toThrow();
    expect(validateCommentPreview({ label: "Heading", credentials: "secret" })).toEqual({ label: "Heading" });
    expect(validateCommentPreview(undefined)).toBeUndefined();
  });
  test("local selection normalization truncates text and omits failed or oversized thumbnails", () => {
    expect(normalizeCommentPreview({ label: "h".repeat(300), content: "x".repeat(2100), thumbnail: "data:image/png;base64," + "a".repeat(50000) })).toEqual({ label: "h".repeat(200), content: "x".repeat(2000) });
    expect(normalizeCommentPreview({ thumbnail: null, label: "" })).toBeUndefined();
  });
});
