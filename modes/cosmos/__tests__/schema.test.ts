/**
 * Cosmos schema guard.
 *
 * Locks the three representations together so they can't drift:
 *   1. `schema.ts` (zod, structured-output truth)
 *   2. `types.ts`  (TS interfaces + normalizeCosmos, viewer truth)
 *   3. the shipped seed cosmoses (real data the viewer renders)
 *
 * If a future edit changes one without the others, this suite fails.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeCosmos, type Cosmos } from "../types.js";
import {
  NODE_CATEGORIES,
  NODE_COMPLEXITIES,
  NODE_TRUST,
  SOURCE_KINDS,
  EDGE_DIRECTIONS,
  allJsonSchemas,
  toJsonSchema,
  validateCosmos,
  zNode,
  zSourceRef,
  type CosmosJsonSchemaName,
} from "../schema.js";

const SEED_DIR = join(import.meta.dir, "..", "seed");
const SEEDS = ["en", "zh-CN"] as const;

function loadSeed(locale: string): Cosmos {
  const raw = JSON.parse(readFileSync(join(SEED_DIR, locale, "cosmos.json"), "utf8"));
  return normalizeCosmos(raw);
}

describe("seed cosmoses satisfy the contract", () => {
  for (const locale of SEEDS) {
    test(`${locale} seed validates against zCosmos`, () => {
      const cosmos = loadSeed(locale);
      const { ok, errors } = validateCosmos(cosmos);
      if (!ok) console.error(`${locale} seed errors:\n` + errors.join("\n"));
      expect(errors).toEqual([]);
      expect(ok).toBe(true);
    });

    test(`${locale} seed has the expected scale`, () => {
      const cosmos = loadSeed(locale);
      // Sanity: the seed is the bootstrap projection of pneuma-skills.
      expect(cosmos.nodes.length).toBeGreaterThan(20);
      expect(cosmos.layers.length).toBeGreaterThanOrEqual(3);
      // Every node's layerId must resolve to a declared layer.
      const layerIds = new Set(cosmos.layers.map((l) => l.id));
      for (const node of cosmos.nodes) {
        if (node.layerId) expect(layerIds.has(node.layerId)).toBe(true);
      }
      // Every edge endpoint must be a real node.
      const nodeIds = new Set(cosmos.nodes.map((n) => n.id));
      for (const edge of cosmos.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    });
  }
});

describe("enums mirror types.ts", () => {
  // types.ts unions are compile-time only; assert the runtime arrays
  // here match what the viewer's normalizer + UI expect. These literals
  // are intentionally duplicated from types.ts so a rename there without
  // updating schema.ts breaks the build review here.
  test("node categories", () => {
    expect([...NODE_CATEGORIES]).toEqual([
      "code",
      "config",
      "docs",
      "infra",
      "data",
      "domain",
      "knowledge",
      "other",
    ]);
  });
  test("node complexities", () => {
    expect([...NODE_COMPLEXITIES]).toEqual(["simple", "moderate", "complex"]);
  });
  test("source kinds", () => {
    expect([...SOURCE_KINDS]).toEqual(["file", "url", "passage", "image", "audio", "video"]);
  });
  test("edge directions", () => {
    expect([...EDGE_DIRECTIONS]).toEqual(["forward", "backward", "bidirectional"]);
  });
  test("trust levels", () => {
    expect([...NODE_TRUST]).toEqual(["verified", "weak", "unverifiable"]);
  });
});

describe("zod validators behave", () => {
  test("a clean node parses", () => {
    expect(
      zNode.safeParse({
        id: "fn-auth-login",
        type: "function",
        name: "login",
        summary: "Authenticates a user.",
        sources: [{ kind: "file", path: "src/auth.ts", range: [10, 40] }],
      }).success,
    ).toBe(true);
  });

  test("a node missing a required field is rejected", () => {
    const r = zNode.safeParse({ id: "x", type: "function" });
    expect(r.success).toBe(false);
  });

  test("each source kind round-trips", () => {
    const refs = [
      { kind: "file", path: "a.ts", range: [1, 2] },
      { kind: "url", url: "https://example.com" },
      { kind: "passage", file: "ch.md", locator: "¶12", quote: "..." },
      { kind: "image", path: "x.png" },
      { kind: "audio", path: "x.mp3", t: 5 },
      { kind: "video", path: "x.mp4", t: 5 },
    ];
    for (const ref of refs) expect(zSourceRef.safeParse(ref).success).toBe(true);
  });

  test("an unknown source kind is rejected", () => {
    expect(zSourceRef.safeParse({ kind: "tweet", url: "x" }).success).toBe(false);
  });

  test("validateCosmos surfaces flat errors", () => {
    const r = validateCosmos({ version: "1", project: {}, nodes: "nope", edges: [], layers: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => typeof e === "string")).toBe(true);
  });
});

describe("derived JSON Schema is workflow-ready", () => {
  const NAMES: CosmosJsonSchemaName[] = [
    "cosmos",
    "node",
    "edge",
    "perspective",
    "partitionExtraction",
    "crossEdges",
    "nodeVerdict",
    "verificationBatch",
    "completeness",
    "perspectiveSet",
    "perspectiveJudgment",
  ];

  test("every stage schema generates an object schema", () => {
    const all = allJsonSchemas();
    for (const name of NAMES) {
      const js = all[name] as { type?: string; properties?: unknown };
      expect(js.type).toBe("object");
      expect(js.properties).toBeDefined();
    }
  });

  test("source refs become a oneOf discriminated by kind", () => {
    const node = toJsonSchema("node") as {
      properties: { sources: { items: { oneOf?: unknown[] } } };
    };
    const oneOf = node.properties.sources.items.oneOf;
    expect(Array.isArray(oneOf)).toBe(true);
    expect(oneOf!.length).toBe(SOURCE_KINDS.length);
  });

  test("the JSON Schema is serializable (no cycles, embeddable in a workflow)", () => {
    const all = allJsonSchemas();
    expect(() => JSON.stringify(all)).not.toThrow();
  });
});

describe("projection.workflow.js stays in sync with zod", () => {
  // The workflow runs as sandboxed plain JS and can't import schema.ts,
  // so it inlines a copy of allJsonSchemas() between markers, regenerated
  // by scripts/gen-workflow-schemas.ts. This test fails the moment the
  // inlined literal drifts from the zod truth — run the generator to fix.
  const WORKFLOW = join(import.meta.dir, "..", "skill", "references", "projection.workflow.js");

  function extractInlinedSchemas(): unknown {
    const src = readFileSync(WORKFLOW, "utf8");
    const start = src.indexOf("// pneuma:schemas:start");
    const end = src.indexOf("// pneuma:schemas:end");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    const assignIdx = block.indexOf("const SCHEMAS =");
    expect(assignIdx).toBeGreaterThanOrEqual(0);
    const json = block.slice(assignIdx + "const SCHEMAS =".length).trim();
    return JSON.parse(json);
  }

  test("inlined SCHEMAS equals allJsonSchemas() — regenerate if this fails", () => {
    const inlined = extractInlinedSchemas();
    expect(inlined).toEqual(allJsonSchemas());
  });

  test("the placeholder was actually replaced", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).not.toContain("__SCHEMAS__");
  });
});
