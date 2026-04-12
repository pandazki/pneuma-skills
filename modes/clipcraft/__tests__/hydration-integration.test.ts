import { describe, it, expect } from "bun:test";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { parseProjectFile, projectFileToCommands } from "../persistence.js";
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
    core.dispatch(env.actor, env.command);
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

    // The seed has seed-asset-1 as a pending image
    expect(coreState.registry.has("seed-asset-1")).toBe(true);
    expect(coreState.registry.get("seed-asset-1")!.status).toBe("pending");

    // And a provenance root edge that now lands correctly (Plan 2 saw this rejected)
    expect(coreState.provenance.nodes.has("seed-asset-1")).toBe(true);
    expect(coreState.provenance.edges.size).toBe(1);
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
});
