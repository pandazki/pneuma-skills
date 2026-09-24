/**
 * Workspace watcher contract: the backend kinds, the `PNEUMA_WATCHER`
 * override's accepted values, and the health record `GET /api/session`
 * reports as `watcher`. The runtime behaviour behind these names is pinned
 * by `server/__tests__/watch-contract.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  WATCHER_BACKEND_KINDS,
  parseWatcherBackendKind,
  type WatcherHealth,
} from "../types/workspace-watcher.js";

describe("watcher backend kinds", () => {
  test("exactly the two implemented backends", () => {
    expect([...WATCHER_BACKEND_KINDS]).toEqual(["native", "chokidar"]);
  });

  test("PNEUMA_WATCHER accepts each kind, case- and space-insensitively", () => {
    expect(parseWatcherBackendKind("native")).toBe("native");
    expect(parseWatcherBackendKind("chokidar")).toBe("chokidar");
    expect(parseWatcherBackendKind(" Native ")).toBe("native");
    expect(parseWatcherBackendKind("CHOKIDAR")).toBe("chokidar");
  });

  test("anything else is not a backend (the caller keeps the platform default)", () => {
    expect(parseWatcherBackendKind(undefined)).toBeNull();
    expect(parseWatcherBackendKind(null)).toBeNull();
    expect(parseWatcherBackendKind("")).toBeNull();
    expect(parseWatcherBackendKind("polling")).toBeNull();
    expect(parseWatcherBackendKind("parcel")).toBeNull();
  });
});

describe("watcher health record", () => {
  test("carries the backend, readiness, degradation and last event time", () => {
    const health: WatcherHealth = {
      backend: "native",
      ready: true,
      degraded: false,
      lastEventAt: null,
    };
    // The wire shape is plain JSON: every field survives a round trip.
    expect(JSON.parse(JSON.stringify(health))).toEqual(health);
    expect(Object.keys(health).sort()).toEqual(["backend", "degraded", "lastEventAt", "ready"]);
  });
});
