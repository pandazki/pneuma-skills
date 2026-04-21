import { describe, test, expect } from "bun:test";
import { reconcileAssets, type FsEntry, type RegisteredEntry } from "../reconcile.js";

function fs(uri: string, size = 1234, mtime = 1_700_000_000_000): FsEntry {
  return { uri, size, mtime };
}

function reg(assetId: string, uri: string): RegisteredEntry {
  return { assetId, uri };
}

describe("reconcileAssets", () => {
  test("empty inputs produce an empty report", () => {
    expect(reconcileAssets([], [])).toEqual({
      registered: [],
      orphaned: [],
      missing: [],
    });
  });

  test("file on disk with no matching registry entry is orphaned", () => {
    const fsList = [fs("assets/video/foo.mp4")];
    const regList: RegisteredEntry[] = [];
    expect(reconcileAssets(fsList, regList)).toEqual({
      registered: [],
      orphaned: [fs("assets/video/foo.mp4")],
      missing: [],
    });
  });

  test("registry entry with no file on disk is missing", () => {
    const fsList: FsEntry[] = [];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    expect(reconcileAssets(fsList, regList)).toEqual({
      registered: [],
      orphaned: [],
      missing: [reg("asset-a", "assets/video/foo.mp4")],
    });
  });

  test("matching URI classifies as registered and carries both views", () => {
    const fsList = [fs("assets/video/foo.mp4", 5000, 9999)];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    const report = reconcileAssets(fsList, regList);
    expect(report.orphaned).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.registered).toEqual([
      { assetId: "asset-a", uri: "assets/video/foo.mp4", size: 5000, mtime: 9999 },
    ]);
  });

  test("URI comparison is case-sensitive and normalizes forward slashes only", () => {
    const fsList = [fs("assets/video/Foo.mp4")];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    const report = reconcileAssets(fsList, regList);
    expect(report.orphaned.map((e) => e.uri)).toEqual(["assets/video/Foo.mp4"]);
    expect(report.missing.map((e) => e.uri)).toEqual(["assets/video/foo.mp4"]);
    expect(report.registered).toEqual([]);
  });

  test("handles mixed sets without cross-contamination", () => {
    const fsList = [
      fs("assets/video/a.mp4"),
      fs("assets/image/b.png"),
      fs("assets/audio/c.mp3"),
    ];
    const regList = [
      reg("asset-a", "assets/video/a.mp4"),
      reg("asset-dead", "assets/video/gone.mp4"),
    ];
    const report = reconcileAssets(fsList, regList);
    expect(report.registered.map((e) => e.uri).sort()).toEqual(["assets/video/a.mp4"]);
    expect(report.orphaned.map((e) => e.uri).sort()).toEqual([
      "assets/audio/c.mp3",
      "assets/image/b.png",
    ]);
    expect(report.missing.map((e) => e.uri)).toEqual(["assets/video/gone.mp4"]);
  });
});
