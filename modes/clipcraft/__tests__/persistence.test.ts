import { describe, it, expect } from "bun:test";
import { parseProjectFile, projectFileToCommands } from "../persistence.js";
import type { ProjectFile } from "../persistence.js";

const minimalValid: ProjectFile = {
  $schema: "pneuma-craft/project/v1",
  title: "Untitled",
  composition: {
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    tracks: [],
    transitions: [],
  },
  assets: [],
  provenance: [],
};

describe("parseProjectFile", () => {
  it("accepts a minimal valid file", () => {
    const result = parseProjectFile(JSON.stringify(minimalValid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("Untitled");
  });

  it("rejects non-JSON input", () => {
    const result = parseProjectFile("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/parse/i);
  });

  it("rejects files missing composition", () => {
    const bad = { ...minimalValid } as Partial<ProjectFile>;
    delete (bad as { composition?: unknown }).composition;
    const result = parseProjectFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("rejects files with wrong $schema", () => {
    const bad = { ...minimalValid, $schema: "something-else" };
    const result = parseProjectFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("accepts AIGC asset with status=generating and empty uri", () => {
    const withPending: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "image",
          uri: "",
          name: "forest-dawn (generating)",
          metadata: {},
          createdAt: 1000,
          status: "generating",
        },
      ],
    };
    const result = parseProjectFile(JSON.stringify(withPending));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets[0].status).toBe("generating");
  });
});

describe("projectFileToCommands", () => {
  it("emits exactly composition:create for an empty project", () => {
    const cmds = projectFileToCommands(minimalValid);
    const types = cmds.map((c) => c.command.type);
    expect(types).toEqual(["composition:create"]);
  });

  it("emits composition:create → asset:register → provenance:set-root in order for an AIGC asset with null parent", () => {
    const file: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "video",
          uri: "assets/clips/shot01.mp4",
          name: "shot01",
          metadata: { width: 1920, height: 1080, duration: 5 },
          createdAt: 1000,
          status: "ready",
        },
      ],
      provenance: [
        {
          toAssetId: "a1",
          fromAssetId: null,
          operation: {
            type: "generate",
            actor: "agent",
            timestamp: 1000,
            label: "runway gen3",
            params: { model: "gen3-alpha-turbo", prompt: "a forest" },
          },
        },
      ],
    };
    const cmds = projectFileToCommands(file);
    const types = cmds.map((c) => c.command.type);
    expect(types).toEqual([
      "composition:create",
      "asset:register",
      "provenance:set-root",
    ]);
    // ID stability: the on-disk asset.id must flow through to the command payload
    const registerCmd = cmds.find((c) => c.command.type === "asset:register");
    expect(registerCmd).toBeDefined();
    const assetPayload = (registerCmd!.command as { asset: { id?: string } }).asset;
    expect(assetPayload.id).toBe("a1");
  });

  it("emits composition:create → asset:register → composition:add-track → composition:add-clip in order when composition has tracks", () => {
    const file: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "video",
          uri: "assets/clips/shot01.mp4",
          name: "shot01",
          metadata: { duration: 5 },
          createdAt: 1000,
        },
      ],
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [
          {
            id: "v1",
            type: "video",
            name: "Video 1",
            muted: false,
            volume: 1,
            locked: false,
            visible: true,
            clips: [
              { id: "c1", assetId: "a1", startTime: 0, duration: 5, inPoint: 0, outPoint: 5 },
            ],
          },
        ],
        transitions: [],
      },
    };
    const cmds = projectFileToCommands(file);
    const types = cmds.map((c) => c.command.type);
    expect(types).toEqual([
      "composition:create",
      "asset:register",
      "composition:add-track",
      "composition:add-clip",
    ]);
    // ID stability: asset, track, and clip ids all flow through
    const registerCmd = cmds.find((c) => c.command.type === "asset:register");
    const addTrackCmd = cmds.find((c) => c.command.type === "composition:add-track");
    const addClipCmd = cmds.find((c) => c.command.type === "composition:add-clip");
    expect((registerCmd!.command as { asset: { id?: string } }).asset.id).toBe("a1");
    expect((addTrackCmd!.command as { track: { id?: string } }).track.id).toBe("v1");
    expect((addClipCmd!.command as { clip: { id?: string } }).clip.id).toBe("c1");
    expect((addClipCmd!.command as { trackId: string }).trackId).toBe("v1");
  });
});
