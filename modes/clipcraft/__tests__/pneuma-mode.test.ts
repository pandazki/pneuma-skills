import { describe, it, expect } from "bun:test";
import clipcraftMode from "../pneuma-mode.js";

const extract = (files: Array<{ path: string; content: string }>) =>
  clipcraftMode.viewer.extractContext(null, files);

describe("clipcraft extractContext", () => {
  it("returns bootstrap-only context when project.json is absent", () => {
    const files = [{ path: "README.md", content: "hi" }];
    const out = extract(files);
    expect(out).toBe(
      `<viewer-context mode="clipcraft" files="1">\nClipCraft bootstrap — 1 file(s) in workspace\n</viewer-context>`,
    );
    expect(out).not.toContain("<preview-frames");
  });

  it("emits <preview-frames total=\"0\" /> when project.json has no preview frames", () => {
    const project = {
      composition: {
        tracks: [
          { id: "track-1", name: "Video", previewFrames: [] },
          { id: "track-2", name: "Audio" }, // no previewFrames field
        ],
      },
    };
    const files = [{ path: "project.json", content: JSON.stringify(project) }];
    const out = extract(files);
    expect(out).toBe(
      `<viewer-context mode="clipcraft" files="1">\n` +
        `ClipCraft bootstrap — 1 file(s) in workspace\n` +
        `<preview-frames total="0" />\n` +
        `</viewer-context>`,
    );
  });

  it("emits per-track counts when project.json has preview frames", () => {
    const project = {
      composition: {
        tracks: [
          {
            id: "track-1",
            name: "Video",
            previewFrames: [
              { id: "pf-a", time: 0, assetId: "asset-1" },
              { id: "pf-b", time: 1.5, assetId: "asset-2" },
            ],
          },
          {
            id: "track-2",
            name: "B-Roll",
            previewFrames: [{ id: "pf-c", time: 3.0, assetId: "asset-3" }],
          },
          {
            id: "track-3",
            name: "Audio",
            previewFrames: [], // excluded — count is 0
          },
        ],
      },
    };
    const files = [{ path: "project.json", content: JSON.stringify(project) }];
    const out = extract(files);
    expect(out).toBe(
      `<viewer-context mode="clipcraft" files="1">\n` +
        `ClipCraft bootstrap — 1 file(s) in workspace\n` +
        `<preview-frames total="3">\n` +
        `  <track id="track-1" name="Video" count="2" />\n` +
        `  <track id="track-2" name="B-Roll" count="1" />\n` +
        `</preview-frames>\n` +
        `</viewer-context>`,
    );
  });

  it("falls back to bootstrap-only context when project.json is malformed", () => {
    const files = [
      { path: "project.json", content: "{not valid json" },
      { path: "README.md", content: "hi" },
    ];
    const out = extract(files);
    expect(out).toBe(
      `<viewer-context mode="clipcraft" files="2">\nClipCraft bootstrap — 2 file(s) in workspace\n</viewer-context>`,
    );
    expect(out).not.toContain("<preview-frames");
  });

  it("escapes XML special characters in track id and name", () => {
    const project = {
      composition: {
        tracks: [
          {
            id: 'tr&"<>',
            name: 'Name & "quotes"',
            previewFrames: [{ id: "pf-a", time: 0, assetId: "asset-1" }],
          },
        ],
      },
    };
    const files = [{ path: "project.json", content: JSON.stringify(project) }];
    const out = extract(files);
    expect(out).toContain(
      `<track id="tr&amp;&quot;&lt;&gt;" name="Name &amp; &quot;quotes&quot;" count="1" />`,
    );
  });
});
