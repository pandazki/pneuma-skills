/**
 * Craft project file contract (`core/types/craft-project.ts`).
 *
 * Pins the three mappings the format depends on:
 *   - the core types against upstream `@pneuma-craft/core` (checked by tsc:
 *     a drift in either makes this file fail to typecheck);
 *   - the runtime enums in `modes/_shared/scripts/craft-project.mjs` against
 *     the core types (every member, both directions);
 *   - every `pneuma-craft/project/v1` file the repository ships as a seed
 *     against the shared validator, and its sidecar against the writer's
 *     key ordering (the sidecar must come back untouched, byte for byte).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  Actor,
  Asset,
  AssetStatus,
  AssetType,
  Operation,
  OperationType,
  ProvenanceEdge,
} from "@pneuma-craft/core";

import {
  CRAFT_PROJECT_SCHEMA,
  type CraftActor,
  type CraftAsset,
  type CraftAssetStatus,
  type CraftAssetType,
  type CraftBilling,
  type CraftCostBasis,
  type CraftOperation,
  type CraftOperationType,
  type CraftProvenanceEdge,
} from "../types/craft-project.js";
import * as craft from "../../modes/_shared/scripts/craft-project.mjs";
import { loadProject, saveProject } from "../../modes/_shared/scripts/craft-project-io.mjs";

const ROOT = resolve(import.meta.dir, "../..");

// ── Type-level mapping to upstream (enforced by `bun run typecheck`) ─────────

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

/* eslint-disable @typescript-eslint/no-unused-vars */
type _Status = Assert<Equal<CraftAssetStatus, AssetStatus>>;
type _Type = Assert<Equal<CraftAssetType, AssetType>>;
type _Op = Assert<Equal<CraftOperationType, OperationType>>;
type _Actor = Assert<Equal<CraftActor, Actor>>;
// An on-disk asset is an upstream asset apart from metadata (JSON-only here).
type _AssetKeys = Assert<Equal<Exclude<keyof CraftAsset, "metadata">, Exclude<keyof Asset, "metadata">>>;
// An on-disk edge is an upstream edge without `id` (assigned at hydration).
type _EdgeKeys = Assert<Equal<keyof CraftProvenanceEdge, Exclude<keyof ProvenanceEdge, "id">>>;
type _OpKeys = Assert<Equal<keyof CraftOperation, keyof Operation>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

// An on-disk edge plus an id hydrates into an upstream edge as is.
const hydrate = (edge: CraftProvenanceEdge, id: string): ProvenanceEdge => ({ ...edge, id });

describe("craft project types ↔ craft-project.mjs", () => {
  test("the schema constant is one value", () => {
    expect(craft.CRAFT_PROJECT_SCHEMA).toBe(CRAFT_PROJECT_SCHEMA);
  });

  // A Record keyed by the type fails to compile when the union grows, and the
  // runtime comparison fails when the JS enum drifts — both directions.
  const exhaustive = <K extends string>(record: Record<K, true>) => Object.keys(record).sort();
  test.each([
    ["ASSET_TYPES", craft.ASSET_TYPES, exhaustive<CraftAssetType>({ video: true, image: true, audio: true, text: true })],
    ["ASSET_STATUSES", craft.ASSET_STATUSES, exhaustive<CraftAssetStatus>({ pending: true, generating: true, ready: true, failed: true })],
    ["OPERATION_TYPES", craft.OPERATION_TYPES, exhaustive<CraftOperationType>({
      upload: true, import: true, generate: true, derive: true, select: true, composite: true,
    })],
    ["ACTORS", craft.ACTORS, exhaustive<CraftActor>({ human: true, agent: true })],
    ["COST_BASES", craft.COST_BASES, exhaustive<CraftCostBasis>({ estimate: true, reported: true, table: true })],
    ["BILLINGS", craft.BILLINGS, exhaustive<CraftBilling>({ none: true, unknown: true })],
  ])("%s matches the core type", (_name, runtime, declared) => {
    expect(([...runtime] as string[]).sort()).toEqual(declared);
  });

  test("a hydrated edge keeps every on-disk field", () => {
    const edge: CraftProvenanceEdge = {
      toAssetId: "b",
      fromAssetId: "a",
      operation: { type: "derive", actor: "agent", timestamp: 1, params: { op: "contact-sheet" } },
    };
    expect(hydrate(edge, "e1")).toEqual({ ...edge, id: "e1" });
  });
});

// ── Seeds ──────────────────────────────────────────────────────────────────

const seeds = [...new Bun.Glob("modes/*/seed/**/project.json").scanSync({ cwd: ROOT, onlyFiles: true })]
  .sort()
  .filter((path) => {
    try {
      return JSON.parse(readFileSync(join(ROOT, path), "utf-8"))?.$schema === CRAFT_PROJECT_SCHEMA;
    } catch {
      return false;
    }
  });

const scratch = mkdtempSync(join(tmpdir(), "craft-project-contract-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("every craft project seed", () => {
  test("there are seeds to check", () => {
    // clipcraft and sprite ship craft projects; an empty glob would make the
    // checks below vacuous.
    expect(seeds.length).toBeGreaterThanOrEqual(2);
  });

  test.each(seeds)("%s validates", (path) => {
    const result = craft.readProjectFile(readFileSync(join(ROOT, path), "utf-8"));
    expect(result.ok ? null : result.error).toBeNull();
  });

  test.each(seeds.map((path, index) => [path, index] as const))("%s keeps its sidecar byte for byte through load → save", (path, index) => {
    const source = join(ROOT, path);
    const original = JSON.parse(readFileSync(source, "utf-8"));
    const sidecarKeys = Object.keys(original).filter((key) => !craft.PROJECT_KEYS.includes(key));
    expect(sidecarKeys.length).toBeGreaterThan(0);

    const copy = join(scratch, `seed-${index}.json`);
    copyFileSync(source, copy);
    saveProject(copy, loadProject(copy, { sidecarKey: sidecarKeys[0] }));
    const written = JSON.parse(readFileSync(copy, "utf-8"));

    // Same top-level order: craft keys first, then the sidecar where it was.
    expect(Object.keys(written)).toEqual(Object.keys(original));
    for (const key of sidecarKeys) {
      // Compact stringify is order-sensitive at every depth.
      expect(JSON.stringify(written[key])).toBe(JSON.stringify(original[key]));
    }
    expect(written).toEqual(original);
  });

  test("a seed the writer itself produced comes back byte for byte", () => {
    // sprite's seed was written by a writer with the same key order and
    // formatting; clipcraft's seeds are hand-formatted (`13.0`), so only
    // their key order and values are comparable.
    const source = join(ROOT, "modes/sprite/seed/lumi/project.json");
    const copy = join(scratch, "lumi.json");
    copyFileSync(source, copy);
    saveProject(copy, loadProject(copy, { sidecarKey: "sprite" }));
    expect(readFileSync(copy, "utf-8")).toBe(readFileSync(source, "utf-8"));
  });
});
