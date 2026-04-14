import { describe, it, expect } from "bun:test";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { parseProjectFile, projectFileToCommands } from "../persistence.js";
import { serializeProject, formatProjectJson } from "../persistence.js";
import type { ProjectFile } from "../persistence.js";

/**
 * Full-stack hydration test. Builds a complete ProjectFile, feeds it through
 * the persistence loader into a real TimelineCore, and verifies every piece
 * of state projects correctly with ids preserved.
 *
 * This is the canonical test for the Plan 3a id-stability contract:
 * if craft or the persistence layer loses id identity anywhere in the
 * round-trip, this test fails loudly.
 */

const completeFile: ProjectFile = {
  $schema: "pneuma-craft/project/v1",
  title: "Forest Opening",
  composition: {
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    tracks: [
      {
        id: "track-video-1",
        type: "video",
        name: "Main Video",
        muted: false,
        volume: 1,
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip-opener",
            assetId: "asset-forest-shot",
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
      id: "asset-forest-shot",
      type: "video",
      uri: "assets/clips/forest-dawn.mp4",
      name: "forest-dawn",
      metadata: { width: 1920, height: 1080, duration: 5, fps: 30 },
      createdAt: 1712934000000,
      status: "ready",
      tags: ["opener"],
    },
  ],
  provenance: [
    {
      toAssetId: "asset-forest-shot",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "clipcraft-videogen",
        timestamp: 1712934000000,
        label: "runway gen3-alpha-turbo",
        params: {
          model: "gen3-alpha-turbo",
          prompt: "wide shot of a foggy forest at dawn",
          seed: 42,
        },
      },
    },
  ],
};

function hydrate(file: ProjectFile): ReturnType<typeof createTimelineCore> {
  const core = createTimelineCore();
  const cmds = projectFileToCommands(file);
  for (const env of cmds) {
    core.dispatchEnvelope(env);
  }
  return core;
}

describe("full-stack hydration", () => {
  it("hydrates a complete project file into a real TimelineCore", () => {
    const core = hydrate(completeFile);
    const coreState = core.getCoreState();
    const composition = core.getComposition();

    // Composition exists with the right settings
    expect(composition).not.toBeNull();
    expect(composition!.settings).toEqual(completeFile.composition.settings);

    // Asset registry has the asset under its on-disk id
    expect(coreState.registry.size).toBe(1);
    expect(coreState.registry.has("asset-forest-shot")).toBe(true);
    const asset = coreState.registry.get("asset-forest-shot");
    expect(asset!.type).toBe("video");
    expect(asset!.uri).toBe("assets/clips/forest-dawn.mp4");
    expect(asset!.status).toBe("ready");
    expect(asset!.tags).toEqual(["opener"]);

    // Provenance node + edge exist with the right operation
    expect(coreState.provenance.nodes.size).toBe(1);
    expect(coreState.provenance.nodes.has("asset-forest-shot")).toBe(true);
    const node = coreState.provenance.nodes.get("asset-forest-shot");
    expect(node!.parentIds).toEqual([]);
    expect(node!.rootOperation.type).toBe("generate");
    expect(node!.rootOperation.agentId).toBe("clipcraft-videogen");
    expect(node!.rootOperation.params).toMatchObject({
      model: "gen3-alpha-turbo",
      prompt: "wide shot of a foggy forest at dawn",
      seed: 42,
    });

    // Composition has the track under its on-disk id
    expect(composition!.tracks).toHaveLength(1);
    const track = composition!.tracks[0];
    expect(track.id).toBe("track-video-1");
    expect(track.type).toBe("video");
    expect(track.name).toBe("Main Video");

    // The track has the clip under its on-disk id, referencing the asset id
    expect(track.clips).toHaveLength(1);
    const clip = track.clips[0];
    expect(clip.id).toBe("clip-opener");
    expect(clip.assetId).toBe("asset-forest-shot");
    expect(clip.trackId).toBe("track-video-1");
    expect(clip.startTime).toBe(0);
    expect(clip.duration).toBe(5);
  });

  it("preserves ids when hydrating the actual seed project.json", async () => {
    // Read the actual seed file so this test fails if the seed drifts
    // from the plan's expected shape.
    const seedPath = new URL("../seed/project.json", import.meta.url).pathname;
    const text = await Bun.file(seedPath).text();
    const parsed = parseProjectFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const core = hydrate(parsed.value);
    const coreState = core.getCoreState();
    const composition = core.getComposition();

    // The Panda demo seed ships three real veo3.1-generated videos, a BGM
    // track, and a text-asset stub for captions. Two panda variants
    // (v1 / v2) demonstrate the variant switcher; v2 is the active take.
    expect(coreState.registry.has("asset-panda-sad-v1")).toBe(true);
    expect(coreState.registry.has("asset-panda-sad-v2")).toBe(true);
    expect(coreState.registry.has("asset-panda-bamboo")).toBe(true);
    expect(coreState.registry.has("asset-bgm-token-meme")).toBe(true);
    expect(coreState.registry.has("asset-caption-stub")).toBe(true);

    expect(coreState.registry.get("asset-panda-sad-v2")!.type).toBe("video");
    expect(coreState.registry.get("asset-panda-sad-v2")!.uri).toBe(
      "assets/clips/panda-sad-v2.mp4",
    );
    expect(coreState.registry.get("asset-bgm-token-meme")!.type).toBe("audio");

    // Provenance: 5 edges (3 panda + bgm + caption stub). The v2 panda
    // is derived from v1 — a real AIGC variant relationship.
    expect(coreState.provenance.edges.size).toBe(5);
    const v2Node = coreState.provenance.nodes.get("asset-panda-sad-v2");
    expect(v2Node!.parentIds).toEqual(["asset-panda-sad-v1"]);
    expect(v2Node!.rootOperation.type).toBe("derive");

    // Composition has three tracks: video, subtitle, audio.
    expect(composition).not.toBeNull();
    expect(composition!.tracks).toHaveLength(3);
    const videoTrack = composition!.tracks.find((t) => t.type === "video")!;
    const subtitleTrack = composition!.tracks.find((t) => t.type === "subtitle")!;
    const audioTrack = composition!.tracks.find((t) => t.type === "audio")!;
    expect(videoTrack.clips).toHaveLength(2);
    expect(subtitleTrack.clips).toHaveLength(2);
    expect(audioTrack.clips).toHaveLength(1);
    // Video clip 1 references the v2 variant (the selected take).
    expect(videoTrack.clips[0].assetId).toBe("asset-panda-sad-v2");
    expect(videoTrack.clips[0].startTime).toBe(0);
    expect(videoTrack.clips[0].duration).toBe(4);
    // Subtitle clips carry the Chinese caption text inline.
    expect(subtitleTrack.clips[0].text).toBe("别跟我说话！");
    expect(subtitleTrack.clips[1].text).toBe("……除非你带了竹子 🎋");
  });

  it("rejects a duplicate hydration attempt by throwing in dispatch", () => {
    const core = hydrate(completeFile);
    // Dispatching the same asset:register again should throw because the id
    // already exists in the registry.
    expect(() =>
      core.dispatch("human", {
        type: "asset:register",
        asset: {
          id: "asset-forest-shot",
          type: "video",
          uri: "assets/clips/other.mp4",
          name: "other",
          metadata: {},
        },
      }),
    ).toThrow();
  });

  it("round-trips: hydrate → serialize → hydrate → assert same state", () => {
    const core1 = hydrate(completeFile);
    const serialized = serializeProject(
      core1.getCoreState(),
      core1.getComposition(),
      completeFile.title,
    );

    // Plan 3c: title must round-trip through serialization as a side-channel.
    expect(serialized.title).toBe(completeFile.title);

    // Serialize → format → parse — simulates a full disk roundtrip
    const text = formatProjectJson(serialized);
    const parsed = parseProjectFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Hydrate the parsed output into a fresh TimelineCore
    const core2 = hydrate(parsed.value);

    // Assert the second core has the same observable state as the first
    const s1 = core1.getCoreState();
    const s2 = core2.getCoreState();

    // Plan 3c: first-pass hydration must preserve the on-disk createdAt
    const fixtureAsset = completeFile.assets[0];
    expect(s1.registry.get(fixtureAsset.id)?.createdAt).toBe(fixtureAsset.createdAt);

    // Assets: same size and same ids
    expect(s2.registry.size).toBe(s1.registry.size);
    for (const [id, asset] of s1.registry.entries()) {
      const a2 = s2.registry.get(id);
      expect(a2).toBeDefined();
      expect(a2!.type).toBe(asset.type);
      expect(a2!.uri).toBe(asset.uri);
      expect(a2!.name).toBe(asset.name);
      expect(a2!.status).toBe(asset.status);
      expect(a2!.tags).toEqual(asset.tags);
      expect(a2!.metadata).toEqual(asset.metadata);
      expect(a2!.createdAt).toBe(asset.createdAt); // Plan 3c: locked down via dispatchEnvelope
    }

    // Provenance: same edges
    expect(s2.provenance.edges.size).toBe(s1.provenance.edges.size);
    const edges1 = Array.from(s1.provenance.edges.values());
    const edges2 = Array.from(s2.provenance.edges.values());
    expect(edges2).toHaveLength(edges1.length);
    // Order-independent compare by toAssetId
    const byTo = (m: Map<string, typeof edges1[0]>, e: typeof edges1[0]) => {
      m.set(e.toAssetId, e);
      return m;
    };
    const map1 = edges1.reduce(byTo, new Map());
    const map2 = edges2.reduce(byTo, new Map());
    for (const [toAssetId, e1] of map1.entries()) {
      const e2 = map2.get(toAssetId);
      expect(e2).toBeDefined();
      expect(e2!.fromAssetId).toBe(e1.fromAssetId);
      expect(e2!.operation.type).toBe(e1.operation.type);
      expect(e2!.operation.params).toEqual(e1.operation.params);
    }

    // Composition: same tracks with same clip ids
    const c1 = core1.getComposition();
    const c2 = core2.getComposition();
    expect(c2).not.toBeNull();
    expect(c2!.settings).toEqual(c1!.settings);
    expect(c2!.tracks).toHaveLength(c1!.tracks.length);
    for (let i = 0; i < c1!.tracks.length; i++) {
      const t1 = c1!.tracks[i];
      const t2 = c2!.tracks[i];
      expect(t2.id).toBe(t1.id);
      expect(t2.clips).toHaveLength(t1.clips.length);
      for (let j = 0; j < t1.clips.length; j++) {
        expect(t2.clips[j].id).toBe(t1.clips[j].id);
        expect(t2.clips[j].assetId).toBe(t1.clips[j].assetId);
        expect(t2.clips[j].startTime).toBe(t1.clips[j].startTime);
        expect(t2.clips[j].duration).toBe(t1.clips[j].duration);
      }
    }
  });

  it("round-trip is stable after a second pass", () => {
    // Invariant: serialize(hydrate(serialize(hydrate(x)))) === serialize(hydrate(x))
    // Catches any serialization pass that's non-deterministic or accumulates
    // small differences (whitespace, field order, default values).
    const core1 = hydrate(completeFile);
    const text1 = formatProjectJson(
      serializeProject(core1.getCoreState(), core1.getComposition(), completeFile.title),
    );

    const parsed = parseProjectFile(text1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const core2 = hydrate(parsed.value);
    const text2 = formatProjectJson(
      serializeProject(core2.getCoreState(), core2.getComposition(), parsed.value.title),
    );

    expect(text2).toBe(text1);
  });
});
