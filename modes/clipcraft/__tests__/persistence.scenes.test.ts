import { describe, expect, it } from "bun:test";
import {
  parseProjectFile,
  formatProjectJson,
  type ProjectFile,
} from "../persistence.js";

const FIXTURE: ProjectFile = {
  $schema: "pneuma-craft/project/v1",
  title: "Scene Round-Trip",
  composition: {
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    tracks: [
      {
        id: "track-video-1",
        type: "video",
        name: "Main",
        muted: false,
        volume: 1,
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip-1",
            assetId: "asset-a",
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
          },
        ],
      },
    ],
    transitions: [],
  },
  assets: [
    {
      id: "asset-a",
      type: "video",
      uri: "assets/a.mp4",
      name: "A",
      metadata: {},
      createdAt: 1700000000000,
    },
  ],
  provenance: [],
  scenes: [
    {
      id: "scene-1",
      order: 0,
      title: "Opening",
      prompt: "establishing shot",
      memberClipIds: ["clip-1"],
      memberAssetIds: ["asset-a"],
    },
    {
      id: "scene-2",
      order: 1,
      title: "B-roll",
      memberClipIds: [],
      memberAssetIds: [],
    },
  ],
};

describe("persistence — scenes round-trip", () => {
  it("parse(format(x)) === x", () => {
    const json = formatProjectJson(FIXTURE);
    const parsed = parseProjectFile(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(FIXTURE);
    }
  });

  it("tolerates missing scenes[] on old files", () => {
    const old: Omit<ProjectFile, "scenes"> = {
      ...FIXTURE,
    };
    delete (old as { scenes?: unknown }).scenes;
    const parsed = parseProjectFile(JSON.stringify(old));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.scenes).toBeUndefined();
    }
  });

  it("rejects non-array scenes", () => {
    const bad = { ...FIXTURE, scenes: "not an array" };
    const parsed = parseProjectFile(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
  });

  it("rejects scene entries with wrong shape", () => {
    const bad = {
      ...FIXTURE,
      scenes: [{ id: 123, order: 0, title: "x", memberClipIds: [], memberAssetIds: [] }],
    };
    const parsed = parseProjectFile(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
  });
});
