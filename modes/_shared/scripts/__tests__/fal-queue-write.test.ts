/**
 * fal-queue.mjs::writeNewFile — how a paid result lands on disk without
 * replacing anything that is already there.
 *
 * The scripts that pay for a file (generate_gif.mjs, generate_svg.mjs)
 * check the target before paying; this pins the second half: the placement
 * itself refuses an existing file, keeps the bytes it could not place, and
 * leaves no staged file behind when it succeeds.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeNewFile } from "../fal-queue.mjs";

const workspace = mkdtempSync(join(tmpdir(), "fal-write-test-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
let dirs = 0;
const freshDir = () => join(workspace, `d-${++dirs}`);

describe("writeNewFile", () => {
  test("writes the bytes at the path, creating its directory, and leaves nothing else", () => {
    const dir = freshDir();
    const path = join(dir, "nested", "take-1.gif");
    expect(writeNewFile(path, Buffer.from("GIF89a…"))).toBe(path);
    expect(readFileSync(path, "utf8")).toBe("GIF89a…");
    expect(readdirSync(join(dir, "nested"))).toEqual(["take-1.gif"]);
  });

  test("an existing file is never replaced; the new bytes are kept and named", () => {
    const dir = freshDir();
    const path = join(dir, "mark.svg");
    writeNewFile(path, "first");
    let error: (Error & { code?: string; keptAt?: string }) | undefined;
    try {
      writeNewFile(path, "second");
    } catch (e) {
      error = e as Error & { code?: string; keptAt?: string };
    }
    expect(error?.code).toBe("EEXIST");
    expect(readFileSync(path, "utf8")).toBe("first");
    expect(readFileSync(error!.keptAt!, "utf8")).toBe("second");
    expect(error?.message).toContain(error!.keptAt!);
    expect(readdirSync(dir).map((name) => join(dir, name)).sort()).toEqual([error!.keptAt!, path].sort());
  });

  test("a target whose directory cannot be made fails before anything is staged", () => {
    const dir = freshDir();
    const blocker = join(dir, "blocker");
    writeNewFile(blocker, "a file, not a directory");
    expect(() => writeNewFile(join(blocker, "x.gif"), "bytes")).toThrow();
    expect(readdirSync(dir)).toEqual(["blocker"]);
  });
});
