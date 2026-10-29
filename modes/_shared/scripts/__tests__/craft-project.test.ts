/**
 * craft-project.mjs — the pure rules of a craft project file: validation with
 * named violations, the reserve → land | fail lifecycle, the dropAssets
 * cascade, the cost reading, and the URL a viewer loads an asset from.
 * No disk, no clock: every stamp is passed in.
 */

import { describe, expect, test } from "bun:test";

import {
  ASSET_ID_PATTERN,
  assetIdProblem,
  dropAssets,
  edgeInputs,
  emptyProject,
  failAsset,
  indexAssets,
  isCallEdge,
  landAsset,
  orderCraftKeys,
  readProjectFile,
  reserveAsset,
  resolveAssetUri,
  summarizeCosts,
  transition,
  validateProjectFile,
  type CraftAsset,
  type CraftProjectFile,
} from "../craft-project.mjs";

const T0 = 1_800_000_000_000;

function project(): CraftProjectFile {
  return emptyProject({ title: "Series", sidecarKey: "series", sidecar: { episodes: [] } });
}

/** A ready, measured image registered by a full reserve → land. */
function readyImage(doc: CraftProjectFile, id: string, at = T0, from?: string[]) {
  reserveAsset(doc, { id, type: "image", name: id, op: "generate", model: "m", prompt: `draw ${id}`, from }, at);
  return landAsset(doc, { id, uri: `refs/${id}.png`, metadata: { width: 64, height: 48 } }, at + 10);
}

function errorOf(value: unknown, options?: { sidecarKey?: string }): string | null {
  const result = validateProjectFile(value, options);
  return result.ok ? null : result.error;
}

describe("asset ids", () => {
  test("semantic lowercase ids pass; anything else is named", () => {
    expect(assetIdProblem("ep01-a-clip-2")).toBeNull();
    expect(assetIdProblem("ref-tangyuan")).toBeNull();
    expect(assetIdProblem("Ref")).toContain(ASSET_ID_PATTERN.source);
    expect(assetIdProblem("-lead")).not.toBeNull();
    expect(assetIdProblem("a_b")).not.toBeNull();
    expect(assetIdProblem("x".repeat(65))).not.toBeNull();
    expect(assetIdProblem("x".repeat(64))).toBeNull();
    expect(assetIdProblem("")).not.toBeNull();
  });
});

describe("validateProjectFile — invariants with named violations", () => {
  test("an empty project is valid and carries its sidecar", () => {
    const doc = project();
    expect(errorOf(doc, { sidecarKey: "series" })).toBeNull();
    expect(doc.composition.settings).toEqual({ width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" });
  });

  test("a project without the mode's sidecar belongs to another mode", () => {
    expect(errorOf(project(), { sidecarKey: "sprite" })).toContain("no 'sprite' sidecar");
  });

  test("duplicate ids, dangling edges and a second edge per asset are refused", () => {
    const doc = project();
    readyImage(doc, "ref-a");
    const dup = structuredClone(doc);
    dup.assets.push(structuredClone(dup.assets[0]!));
    expect(errorOf(dup)).toContain("duplicate asset id 'ref-a'");

    const dangling = structuredClone(doc);
    dangling.provenance[0]!.fromAssetId = "ghost";
    expect(errorOf(dangling)).toContain("comes from unknown asset 'ghost'");

    const orphanEdge = structuredClone(doc);
    orphanEdge.provenance.push({ ...orphanEdge.provenance[0]!, toAssetId: "ghost" });
    expect(errorOf(orphanEdge)).toContain("points at unknown asset 'ghost'");

    const twice = structuredClone(doc);
    twice.provenance.push(structuredClone(twice.provenance[0]!));
    expect(errorOf(twice)).toContain("one edge per asset");
  });

  test("ready means a uri, and an image is measured", () => {
    const doc = project();
    readyImage(doc, "ref-a");
    const noUri = structuredClone(doc);
    noUri.assets[0]!.uri = "";
    expect(errorOf(noUri)).toContain("a ready image must have a uri");

    const unmeasured = structuredClone(doc);
    unmeasured.assets[0]!.metadata = {};
    expect(errorOf(unmeasured)).toContain("must be measured");

    // Absent status is upstream's `ready`.
    const legacy = structuredClone(doc);
    delete (legacy.assets[0] as Partial<CraftAsset>).status;
    legacy.assets[0]!.uri = "";
    expect(errorOf(legacy)).toContain("must have a uri");

    // A text holder may keep its content inline (clipcraft's caption stub).
    const text = structuredClone(doc);
    text.assets.push({ id: "caption", type: "text", uri: "", name: "c", metadata: {}, createdAt: T0 });
    expect(errorOf(text)).toBeNull();
  });

  test("an operation type outside upstream's six is named — storyboard's 'slice' drift", () => {
    const doc = project();
    readyImage(doc, "board");
    const drift = structuredClone(doc);
    (drift.provenance[0]!.operation as { type: string }).type = "slice";
    expect(errorOf(drift)).toContain('got "slice"');
  });

  test("a failed asset carries its failure; nothing else does", () => {
    const doc = project();
    reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate" }, T0);
    failAsset(doc, { id: "clip", reason: "timeout", billing: "unknown" }, T0 + 5);
    expect(errorOf(doc)).toBeNull();

    const missing = structuredClone(doc);
    delete missing.provenance[0]!.operation.params!.failure;
    expect(errorOf(missing)).toContain("carries no operation.params.failure");

    const stray = structuredClone(doc);
    stray.assets[0]!.status = "pending";
    expect(errorOf(stray)).toContain("failure is set but 'clip' is pending");
  });

  test("params.inputs names registered assets and starts at the parent", () => {
    const doc = project();
    readyImage(doc, "a");
    readyImage(doc, "b");
    readyImage(doc, "sheet", T0 + 100, ["a", "b"]);
    expect(errorOf(doc)).toBeNull();
    const edge = doc.provenance.find((e) => e.toAssetId === "sheet")!;
    expect(edge.fromAssetId).toBe("a");
    expect(edge.operation.params!.inputs).toEqual(["a", "b"]);

    const swapped = structuredClone(doc);
    swapped.provenance.find((e) => e.toAssetId === "sheet")!.operation.params!.inputs = ["b", "a"];
    expect(errorOf(swapped)).toContain("must be the edge's fromAssetId");
  });

  test("a cost names where its number came from", () => {
    const doc = project();
    reserveAsset(doc, { id: "x", type: "image", name: "x", op: "generate" }, T0);
    const bad = structuredClone(doc);
    // A hand-edited file can say anything; the types cannot.
    bad.provenance[0]!.operation.params = { cost: { usd: 1, basis: "guess" } } as never;
    expect(errorOf(bad)).toContain("basis must be one of estimate, reported, table");
  });

  test("readProjectFile reports bad JSON and bad schema by name", () => {
    expect(readProjectFile("{")).toMatchObject({ ok: false });
    const result = readProjectFile(JSON.stringify({ ...project(), $schema: "other/v2" }));
    expect(result.ok ? "" : result.error).toContain('$schema must be "pneuma-craft/project/v1"');
  });
});

describe("lifecycle — reserve → land | fail", () => {
  test("reserve writes pending, an empty metadata and the call's params before anything is sent", () => {
    const doc = project();
    const { asset, edge } = reserveAsset(doc, {
      id: "ep01-a-storyboard", type: "image", name: "ep01 A storyboard", op: "generate",
      uri: "ep01/storyboard-a.png", model: "openai/gpt-image-2.5-flare", prompt: "grid", provider: "openrouter",
      params: { panels: 9 }, cost: { usd: 0.04, basis: "estimate" },
    }, T0);
    expect(asset).toEqual({
      id: "ep01-a-storyboard", type: "image", uri: "ep01/storyboard-a.png", name: "ep01 A storyboard",
      metadata: {}, createdAt: T0, status: "pending",
    });
    expect(edge).toEqual({
      toAssetId: "ep01-a-storyboard", fromAssetId: null,
      operation: {
        type: "generate", actor: "agent", timestamp: T0,
        params: { model: "openai/gpt-image-2.5-flare", prompt: "grid", provider: "openrouter", panels: 9, cost: { usd: 0.04, basis: "estimate" } },
      },
    });
    expect(errorOf(doc)).toBeNull();
  });

  test("land measures, readies, stamps and lets a reported cost replace the estimate", () => {
    const doc = project();
    reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate", generating: true, cost: { usd: 1, basis: "estimate" } }, T0);
    const { asset, edge } = landAsset(doc, {
      id: "clip", uri: "ep01/parts/a.mp4", metadata: { width: 1280, height: 720, duration: 15 }, requestId: "req-1",
      cost: { usd: 0.93, basis: "reported" },
    }, T0 + 60_000);
    expect(asset.status).toBe("ready");
    expect(asset.createdAt).toBe(T0 + 60_000);
    expect(edge.operation.params).toMatchObject({ requestId: "req-1", finishedAt: T0 + 60_000, cost: { usd: 0.93, basis: "reported" } });
    expect(edge.operation.timestamp).toBe(T0);
  });

  test("fail records reason, time and billing; a final status cannot move", () => {
    const doc = project();
    reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate" }, T0);
    const { edge } = failAsset(doc, { id: "clip", reason: "fal FAILED: policy", billing: "unknown", requestId: "req-9" }, T0 + 1);
    expect(edge.operation.params).toMatchObject({ requestId: "req-9", failure: { reason: "fal FAILED: policy", at: T0 + 1, billing: "unknown" } });
    expect(() => landAsset(doc, { id: "clip", uri: "x.mp4" }, T0 + 2)).toThrow("is failed and cannot become ready");
  });

  test("transitions follow pending → generating → ready|failed and pending → ready|failed", () => {
    const asset = { id: "a", type: "image", uri: "", name: "a", metadata: {}, createdAt: 0 } as CraftAsset;
    expect(transition({ ...asset, status: "pending" }, "generating").status).toBe("generating");
    expect(transition({ ...asset, status: "pending" }, "ready").status).toBe("ready");
    expect(transition({ ...asset, status: "generating" }, "failed").status).toBe("failed");
    expect(() => transition({ ...asset, status: "generating" }, "pending")).toThrow("cannot become pending");
    expect(() => transition(asset, "failed")).toThrow("is ready and cannot become failed");
  });

  test("a ready id is refused without force", () => {
    const doc = project();
    readyImage(doc, "ref-a");
    expect(() => reserveAsset(doc, { id: "ref-a", type: "image", name: "a", op: "generate" }, T0 + 50)).toThrow("already ready");
    expect(reserveAsset(doc, { id: "ref-a", type: "image", name: "a", op: "generate", force: true }, T0 + 50).asset.status).toBe("pending");
  });

  test("re-reserving keeps the earlier model, prompt and inputs when they are not given", () => {
    const doc = project();
    readyImage(doc, "ref-a");
    reserveAsset(doc, { id: "sheet", type: "image", name: "sheet", op: "generate", model: "m1", prompt: "turnaround", from: ["ref-a"] }, T0);
    failAsset(doc, { id: "sheet", reason: "refused", billing: "none" }, T0 + 1);
    const { edge } = reserveAsset(doc, { id: "sheet", type: "image", name: "sheet", op: "generate" }, T0 + 2);
    expect(edge.fromAssetId).toBe("ref-a");
    expect(edge.operation.params).toMatchObject({ model: "m1", prompt: "turnaround" });
    // Replaced in place: the asset keeps its position in the file.
    expect(doc.assets.map((a) => a.id)).toEqual(["ref-a", "sheet"]);
  });

  test("a replaced call is carried forward, so a possibly billed attempt never disappears", () => {
    const doc = project();
    reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate", cost: { usd: 1.2, basis: "table" } }, T0);
    failAsset(doc, { id: "clip", reason: "timeout", billing: "unknown", requestId: "req-1" }, T0 + 1);
    // A second reservation while the first is generating (its process died).
    reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate", generating: true, cost: { usd: 1.2, basis: "table" } }, T0 + 2);
    const { edge } = reserveAsset(doc, { id: "clip", type: "video", name: "clip", op: "generate", cost: { usd: 1.2, basis: "table" } }, T0 + 3);
    const earlier = edge.operation.params!.earlier as Array<Record<string, unknown>>;
    expect(earlier).toHaveLength(2);
    expect(earlier[0]).toMatchObject({ at: T0, status: "failed", requestId: "req-1", failure: { billing: "unknown", reason: "timeout" } });
    expect(earlier[1]).toMatchObject({ at: T0 + 2, status: "failed", failure: { billing: "unknown" } });
    expect(String((earlier[1]!.failure as { reason: string }).reason)).toContain("replaced while generating");
    expect(errorOf(doc)).toBeNull();

    const cost = summarizeCosts(doc);
    expect(cost.total).toBe(3.6);
    expect(cost.uncertain).toEqual(["clip#1", "clip#2"]);
    expect(cost.inFlight).toEqual(["clip"]);
  });

  test("an upload is the human's by default; free-form params cannot set lifecycle keys", () => {
    const doc = project();
    const { edge } = reserveAsset(doc, { id: "ref-up", type: "image", name: "uploaded", op: "upload" }, T0);
    expect(edge.operation.actor).toBe("human");
    expect(() => reserveAsset(doc, { id: "x", type: "image", name: "x", op: "generate", params: { cost: { usd: 1 } } }, T0))
      .toThrow("params may not set cost");
    expect(() => reserveAsset(doc, { id: "x", type: "image", name: "x", op: "generate", cost: { usd: 1, basis: "reported" } }, T0))
      .toThrow("estimate, table");
    expect(() => reserveAsset(doc, { id: "x", type: "image", name: "x", op: "generate", from: ["ghost"] }, T0))
      .toThrow("unknown asset 'ghost'");
  });

  test("a refused reservation leaves the document unchanged", () => {
    const doc = project();
    readyImage(doc, "ref-a");
    const before = JSON.stringify(doc);
    expect(() => reserveAsset(doc, { id: "Bad Id", type: "image", name: "x", op: "generate" }, T0)).toThrow();
    expect(() => reserveAsset(doc, { id: "ref-a", type: "image", name: "x", op: "generate" }, T0)).toThrow();
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("dropAssets — the fan-in cascade", () => {
  test("a surviving edge loses a dropped parent from its parent and its input list", () => {
    const doc = project();
    readyImage(doc, "a");
    readyImage(doc, "b");
    readyImage(doc, "c");
    readyImage(doc, "grid", T0 + 100, ["a", "b", "c"]);
    readyImage(doc, "pair", T0 + 200, ["a", "b"]);
    dropAssets(doc, ["a"]);
    const { edges } = indexAssets(doc);
    expect(edges.get("grid")!.fromAssetId).toBe("b");
    expect(edges.get("grid")!.operation.params!.inputs).toEqual(["b", "c"]);
    // One entry is no list.
    expect(edges.get("pair")!.fromAssetId).toBe("b");
    expect(edges.get("pair")!.operation.params!.inputs).toBeUndefined();
    expect(edgeInputs(edges.get("pair"))).toEqual(["b"]);
    expect(errorOf(doc)).toBeNull();
  });
});

describe("summarizeCosts — no ledger, unpriced is not free", () => {
  test("calls are priced, unpriced, uncertain or provably unbilled; local steps cost nothing", () => {
    const doc = project();
    reserveAsset(doc, { id: "sheet", type: "image", name: "s", op: "generate", cost: { usd: 0.04, basis: "estimate" } }, T0);
    landAsset(doc, { id: "sheet", uri: "s.png", metadata: { width: 1, height: 1 }, cost: { usd: 0.0412, basis: "reported" } }, T0 + 1);
    reserveAsset(doc, { id: "board", type: "image", name: "b", op: "generate" }, T0 + 2);
    landAsset(doc, { id: "board", uri: "b.png", metadata: { width: 1, height: 1 } }, T0 + 3);
    reserveAsset(doc, { id: "clip", type: "video", name: "c", op: "generate", from: ["sheet", "board"], cost: { usd: 1.5, basis: "table" } }, T0 + 4);
    failAsset(doc, { id: "clip", reason: "timeout", billing: "unknown" }, T0 + 5);
    reserveAsset(doc, { id: "clip-2", type: "video", name: "c", op: "generate", cost: { usd: 1.5, basis: "table" } }, T0 + 6);
    failAsset(doc, { id: "clip-2", reason: "ECONNREFUSED", billing: "none" }, T0 + 7);
    reserveAsset(doc, { id: "review", type: "image", name: "r", op: "derive", from: ["sheet"], params: { op: "contact-sheet" } }, T0 + 8);
    landAsset(doc, { id: "review", uri: "r.png", metadata: { width: 1, height: 1 } }, T0 + 9);

    expect(isCallEdge(indexAssets(doc).edges.get("review"))).toBe(false);
    const cost = summarizeCosts(doc);
    expect(cost.calls).toBe(4);
    expect(cost.total).toBe(1.5412);
    expect(cost.byBasis).toEqual({ estimate: 0, reported: 0.0412, table: 1.5 });
    expect(cost.unpriced).toEqual(["board"]);
    expect(cost.uncertain).toEqual(["clip"]);
    expect(cost.notBilled).toEqual(["clip-2"]);
    expect(cost.lines.find((l) => l.assetId === "clip")).toMatchObject({ status: "failed", usd: 1.5, basis: "table", billing: "unknown", at: T0 + 4 });
  });

  test("a timed-out job landed later by its request id is one call, not two", () => {
    const doc = project();
    reserveAsset(doc, { id: "clip", type: "video", name: "c", op: "generate", provider: "fal", cost: { usd: 6.17, basis: "estimate" } }, T0);
    failAsset(doc, { id: "clip", reason: "exceeded 1800s", billing: "unknown", requestId: "req-9" }, T0 + 1);
    // The retry attaches to req-9 instead of sending again, and lands it.
    reserveAsset(doc, { id: "clip", type: "video", name: "c", op: "generate", cost: { usd: 6.17, basis: "estimate" } }, T0 + 2);
    landAsset(doc, { id: "clip", uri: "c.mp4", metadata: {}, requestId: "req-9", cost: { usd: 6.2, basis: "estimate" } }, T0 + 3);
    const cost = summarizeCosts(doc);
    expect(cost.total).toBe(6.2);
    expect(cost.uncertain).toEqual([]);
    expect(cost.reconciled).toEqual(["clip#1"]);
    expect(cost.lines.map((l) => [l.attempt, l.requestId, l.sameCallAsLater])).toEqual([[1, "req-9", true], [null, "req-9", false]]);

    // A re-send under a new request id is a second call: both stay counted.
    const resent = project();
    reserveAsset(resent, { id: "clip", type: "video", name: "c", op: "generate", provider: "fal", cost: { usd: 6.17, basis: "estimate" } }, T0);
    failAsset(resent, { id: "clip", reason: "exceeded 1800s", billing: "unknown", requestId: "req-9" }, T0 + 1);
    reserveAsset(resent, { id: "clip", type: "video", name: "c", op: "generate", cost: { usd: 6.17, basis: "estimate" } }, T0 + 2);
    landAsset(resent, { id: "clip", uri: "c.mp4", metadata: {}, requestId: "req-10", cost: { usd: 6.2, basis: "estimate" } }, T0 + 3);
    expect(summarizeCosts(resent)).toMatchObject({ total: 12.37, uncertain: ["clip#1"], reconciled: [] });
  });

  test("clipcraft-shaped derive edges that name a model count as calls", () => {
    const doc = project();
    readyImage(doc, "start");
    reserveAsset(doc, { id: "shot", type: "video", name: "s", op: "derive", model: "bytedance/seedance", from: ["start"] }, T0);
    expect(summarizeCosts(doc).unpriced).toEqual(["start", "shot"]);
  });
});

describe("viewer helpers", () => {
  test("resolveAssetUri stamps the landing time and encodes each segment", () => {
    const doc = project();
    reserveAsset(doc, { id: "c", type: "video", name: "c", op: "generate", uri: "ep 01/parts/a#1.mp4" }, T0);
    const { assets } = indexAssets(doc);
    expect(resolveAssetUri("/content", assets.get("c"))).toBeNull();
    landAsset(doc, { id: "c", uri: "ep 01/parts/a#1.mp4" }, T0 + 9);
    expect(resolveAssetUri("/content/", indexAssets(doc).assets.get("c"))).toBe(`/content/ep%2001/parts/a%231.mp4?r=${T0 + 9}`);
    expect(resolveAssetUri("/content", { ...indexAssets(doc).assets.get("c")!, uri: "https://cdn/x.mp4" })).toBe("https://cdn/x.mp4");
    expect(resolveAssetUri("/content", undefined)).toBeNull();
  });

  test("orderCraftKeys restores craft order and leaves the sidecar where it was", () => {
    const shuffled = {
      series: { b: 1, a: [{ y: 1, x: 2 }] },
      provenance: [],
      assets: [{ status: "ready", tags: ["t"], metadata: { height: 1, width: 1 }, name: "n", id: "a", type: "image", uri: "a.png", createdAt: 1 }],
      title: "t",
      $schema: "pneuma-craft/project/v1",
      composition: { transitions: [], tracks: [], settings: { aspectRatio: "1:1", fps: 1, height: 1, width: 1 } },
      notes: "kept",
    };
    const ordered = orderCraftKeys(shuffled);
    expect(Object.keys(ordered)).toEqual(["$schema", "title", "composition", "assets", "provenance", "series", "notes"]);
    expect(Object.keys(ordered.assets[0]!)).toEqual(["id", "type", "uri", "name", "metadata", "createdAt", "status", "tags"]);
    expect(Object.keys(ordered.composition.settings)).toEqual(["width", "height", "fps", "aspectRatio"]);
    expect(ordered.series).toBe(shuffled.series);
    expect(JSON.stringify(ordered.series)).toBe('{"b":1,"a":[{"y":1,"x":2}]}');
  });

  test("emptyProject derives the aspect ratio from a given size", () => {
    const doc = emptyProject({ title: "t", sidecarKey: "series", settings: { width: 1080, height: 1920, fps: 24 } });
    expect(doc.composition.settings).toEqual({ width: 1080, height: 1920, fps: 24, aspectRatio: "9:16" });
    expect(() => emptyProject({ title: "t", sidecarKey: "assets" })).toThrow("craft key");
  });
});
