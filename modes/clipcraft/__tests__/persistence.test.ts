import { describe, it, expect } from "bun:test";
import { parseProjectFile, projectFileToCommands, serializeProject, formatProjectJson } from "../persistence.js";
import type { ProjectFile } from "../persistence.js";
import { createTimelineCore } from "@pneuma-craft/timeline";

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

  it("asset:register envelope timestamp equals on-disk createdAt", () => {
    const file: ProjectFile = {
      $schema: "pneuma-craft/project/v1",
      title: "Test",
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [], transitions: [],
      },
      assets: [
        {
          id: "a1",
          type: "image",
          uri: "",
          name: "test",
          metadata: {},
          createdAt: 1712934000000,
        },
      ],
      provenance: [],
    };
    const cmds = projectFileToCommands(file);
    const registerCmd = cmds.find((c) => c.command.type === "asset:register");
    expect(registerCmd).toBeDefined();
    expect(registerCmd!.timestamp).toBe(1712934000000);
  });

  it("provenance:set-root envelope timestamp equals on-disk operation.timestamp", () => {
    const file: ProjectFile = {
      $schema: "pneuma-craft/project/v1",
      title: "Test",
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [], transitions: [],
      },
      assets: [
        {
          id: "a1",
          type: "video",
          uri: "/x.mp4",
          name: "x",
          metadata: {},
          createdAt: 2000,
        },
      ],
      provenance: [
        {
          toAssetId: "a1",
          fromAssetId: null,
          operation: {
            type: "generate",
            actor: "agent",
            timestamp: 3000,
            params: { model: "test" },
          },
        },
      ],
    };
    const cmds = projectFileToCommands(file);
    const rootCmd = cmds.find((c) => c.command.type === "provenance:set-root");
    expect(rootCmd).toBeDefined();
    expect(rootCmd!.timestamp).toBe(3000);
  });
});

describe("serializeProject", () => {
  it("returns a minimal ProjectFile for an empty composition", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.$schema).toBe("pneuma-craft/project/v1");
    expect(file.composition.settings).toEqual({
      width: 1920, height: 1080, fps: 30, aspectRatio: "16:9",
    });
    expect(file.composition.tracks).toEqual([]);
    expect(file.composition.transitions).toEqual([]);
    expect(file.assets).toEqual([]);
    expect(file.provenance).toEqual([]);
  });

  it("preserves the title argument through serialization", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition(), "Forest Opening");
    expect(file.title).toBe("Forest Opening");
  });

  it("defaults title to Untitled when argument is omitted", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.title).toBe("Untitled");
  });

  it("preserves AIGC asset status, tags, and metadata", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: {
        id: "a1",
        type: "image",
        uri: "",
        name: "pending-shot",
        metadata: { width: 1024 },
        tags: ["reference"],
        status: "generating",
      },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.assets).toHaveLength(1);
    const a = file.assets[0];
    expect(a.id).toBe("a1");
    expect(a.type).toBe("image");
    expect(a.name).toBe("pending-shot");
    expect(a.status).toBe("generating");
    expect(a.tags).toEqual(["reference"]);
    expect(a.metadata).toEqual({ width: 1024 });
  });

  it("serializes a provenance root edge with the operation intact", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: {
        id: "a1", type: "video", uri: "a.mp4", name: "a",
        metadata: {}, status: "ready",
      },
    });
    core.dispatch("agent", {
      type: "provenance:set-root",
      assetId: "a1",
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "clipcraft-videogen",
        timestamp: 1000,
        label: "runway gen3",
        params: { model: "gen3", prompt: "a forest", seed: 42 },
      },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.provenance).toHaveLength(1);
    const edge = file.provenance[0];
    expect(edge.toAssetId).toBe("a1");
    expect(edge.fromAssetId).toBeNull();
    expect(edge.operation.type).toBe("generate");
    expect(edge.operation.agentId).toBe("clipcraft-videogen");
    expect(edge.operation.params).toMatchObject({
      model: "gen3", prompt: "a forest", seed: 42,
    });
  });

  it("serializes a composition with a track and a clip, preserving ids", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: { id: "a1", type: "video", uri: "a.mp4", name: "a", metadata: { duration: 5 } },
    });
    core.dispatch("human", {
      type: "composition:add-track",
      track: {
        id: "v1",
        type: "video",
        name: "Video 1",
        clips: [],
        muted: false, volume: 1, locked: false, visible: true,
      },
    });
    core.dispatch("human", {
      type: "composition:add-clip",
      trackId: "v1",
      clip: {
        id: "c1", assetId: "a1",
        startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      },
    });

    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.composition.tracks).toHaveLength(1);
    const track = file.composition.tracks[0];
    expect(track.id).toBe("v1");
    expect(track.type).toBe("video");
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].id).toBe("c1");
    expect(track.clips[0].assetId).toBe("a1");
    expect(track.clips[0].startTime).toBe(0);
    expect(track.clips[0].duration).toBe(5);
  });

  it("returns an empty-settings ProjectFile when composition is null", () => {
    const core = createTimelineCore();
    // No composition:create — getComposition() returns null
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.composition.tracks).toEqual([]);
    expect(file.assets).toEqual([]);
    // Settings should fall back to sensible defaults matching the seed file
    expect(file.composition.settings.width).toBe(1920);
    expect(file.composition.settings.height).toBe(1080);
    expect(file.composition.settings.fps).toBe(30);
    expect(file.composition.settings.aspectRatio).toBe("16:9");
  });

  it("is deterministic — same input produces byte-identical output", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file1 = serializeProject(core.getCoreState(), core.getComposition());
    const file2 = serializeProject(core.getCoreState(), core.getComposition());
    expect(formatProjectJson(file1)).toBe(formatProjectJson(file2));
  });
});

describe("formatProjectJson", () => {
  it("produces JSON with 2-space indent and a trailing newline", () => {
    const file: ProjectFile = {
      $schema: "pneuma-craft/project/v1",
      title: "Test",
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [],
        transitions: [],
      },
      assets: [],
      provenance: [],
    };
    const text = formatProjectJson(file);
    // 2-space indent
    expect(text).toContain('  "title": "Test"');
    // Trailing newline
    expect(text.endsWith("\n")).toBe(true);
    // Round-trips through JSON.parse
    const parsed = JSON.parse(text);
    expect(parsed.title).toBe("Test");
  });
});
