/**
 * Path containment helpers (`server/utils.ts`). Every server route that maps a
 * request path onto the filesystem checks it with these: `/content/*`,
 * `/api/file`, `/api/files` (read / write / delete), the content-set replace
 * route, the export routes, the showcase and seed-gallery assets, mode
 * deletion, and the system bridge.
 *
 * The 2026-09-23 final review found `pathStartsWith` to be a plain
 * `String.startsWith`: `/a/pneuma-neighbor` counted as inside `/a/pneuma`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { canonicalPath, isContained, pathStartsWith } from "../utils.js";

describe("pathStartsWith", () => {
  test("compares whole path components", () => {
    expect(pathStartsWith("/a/pneuma-neighbor/x", "/a/pneuma")).toBe(false);
    expect(pathStartsWith("/a/pneumax", "/a/pneuma")).toBe(false);
    expect(pathStartsWith("/a/pneuma/x", "/a/pneuma")).toBe(true);
    expect(pathStartsWith("/a/pneuma", "/a/pneuma")).toBe(true);
  });

  test("a parent with a trailing separator means strictly inside", () => {
    expect(pathStartsWith("/a/modes/x", `/a/modes${sep}`)).toBe(true);
    expect(pathStartsWith("/a/modes", `/a/modes${sep}`)).toBe(false);
    expect(pathStartsWith("/a/modes-evil/x", `/a/modes${sep}`)).toBe(false);
  });

  test("the filesystem root contains every absolute path", () => {
    expect(pathStartsWith("/etc/passwd", "/")).toBe(true);
  });
});

describe("canonicalPath / isContained", () => {
  let base: string;
  let root: string;
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-paths-")));
    root = join(base, "ws");
    mkdirSync(join(root, "inner"), { recursive: true });
    mkdirSync(join(base, "outside"), { recursive: true });
    writeFileSync(join(base, "outside", "secret.txt"), "x");
    writeFileSync(join(root, "inner", "a.txt"), "a");
    symlinkSync(join(base, "outside", "secret.txt"), join(root, "out-link.txt"));
    symlinkSync(join(base, "outside"), join(root, "out-dir"));
    symlinkSync(join(root, "inner", "a.txt"), join(root, "in-link.txt"));
    symlinkSync(join(base, "outside", "not-yet.txt"), join(root, "dangling.txt"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  test("ordinary and not-yet-existing paths inside the root", () => {
    expect(isContained(join(root, "inner", "a.txt"), root)).toBe(true);
    expect(isContained(join(root, "new", "file.txt"), root)).toBe(true);
    expect(isContained(root, root)).toBe(true);
  });

  test("a sibling sharing the root's name as a prefix", () => {
    expect(isContained(join(base, "ws-neighbor", "x"), root)).toBe(false);
  });

  test("symlinks are judged by where they point", () => {
    expect(isContained(join(root, "out-link.txt"), root)).toBe(false);
    expect(isContained(join(root, "out-dir", "secret.txt"), root)).toBe(false);
    expect(isContained(join(root, "out-dir", "new.txt"), root)).toBe(false);
    expect(isContained(join(root, "in-link.txt"), root)).toBe(true);
  });

  test("a dangling symlink to outside cannot be written through", () => {
    expect(canonicalPath(join(root, "dangling.txt"))).toBe(join(base, "outside", "not-yet.txt"));
    expect(isContained(join(root, "dangling.txt"), root)).toBe(false);
  });

  test("a root reached through a symlink still contains its own files", () => {
    const alias = join(base, "ws-alias");
    symlinkSync(root, alias);
    expect(isContained(join(alias, "inner", "a.txt"), alias)).toBe(true);
    expect(isContained(join(alias, "out-link.txt"), alias)).toBe(false);
  });
});

/**
 * Finding 18 of the 2026-09-23 final review: `canonicalPath` spent one
 * recursion "depth" per missing component and returned the still-lexical
 * path at depth 32. A write to `out-link/d0/…/d34/x` through a symlink to
 * outside therefore passed `isContained`, and `mkdirSync({ recursive })`
 * followed the link. Canonicalization now fails closed: an unresolvable
 * path (a loop, too many links, an unreadable component) is `null`, and
 * `isContained` rejects it.
 */
describe("canonicalPath fails closed", () => {
  let base: string;
  let root: string;
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-canon-")));
    root = join(base, "ws");
    mkdirSync(join(root, "real", "sub"), { recursive: true });
    mkdirSync(join(base, "outside", "x"), { recursive: true });
    writeFileSync(join(root, "file.txt"), "f");
    symlinkSync(join(base, "outside"), join(root, "out-dir"));
    symlinkSync(join(root, "real"), join(root, "in-dir"));
    symlinkSync("loop-b", join(root, "loop-a"));
    symlinkSync("loop-a", join(root, "loop-b"));
    // A dangling link whose target climbs out through another link: the
    // kernel resolves `out-dir/..` physically (to `base`), not lexically.
    symlinkSync("out-dir/x/../../escaped.txt", join(root, "dotdot-link"));
    // A relative dangling link that stays inside.
    symlinkSync("real/not-yet.txt", join(root, "in-dangling"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const deep = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);

  test("a deep missing suffix under an outside symlink is outside", () => {
    const target = join(root, "out-dir", ...deep(35), "deep.txt");
    expect(canonicalPath(target)).toBe(join(base, "outside", ...deep(35), "deep.txt"));
    expect(isContained(target, root)).toBe(false);
  });

  test("a deep missing suffix inside the root stays inside", () => {
    expect(isContained(join(root, ...deep(80), "deep.txt"), root)).toBe(true);
    expect(isContained(join(root, "in-dir", ...deep(80), "deep.txt"), root)).toBe(true);
    expect(canonicalPath(join(root, "in-dir", "a", "b"))).toBe(join(root, "real", "a", "b"));
  });

  test("a symlink loop is rejected, not treated as a lexical path", () => {
    expect(canonicalPath(join(root, "loop-a"))).toBeNull();
    expect(canonicalPath(join(root, "loop-a", "child.txt"))).toBeNull();
    expect(isContained(join(root, "loop-a", "child.txt"), root)).toBe(false);
  });

  test("a dangling link target is resolved physically, component by component", () => {
    expect(canonicalPath(join(root, "dotdot-link"))).toBe(join(base, "escaped.txt"));
    expect(isContained(join(root, "dotdot-link"), root)).toBe(false);
    expect(isContained(join(root, "in-dangling"), root)).toBe(true);
  });

  test("a path through a regular file is rejected", () => {
    expect(canonicalPath(join(root, "file.txt", "child"))).toBeNull();
    expect(isContained(join(root, "file.txt", "child"), root)).toBe(false);
  });

  test("the canonical form of a missing tail uses the canonical spelling of its existing prefix", () => {
    // /tmp → /private/tmp on macOS; the root is canonicalized the same way.
    const viaAlias = join(base, "ws-alias");
    symlinkSync(root, viaAlias);
    expect(canonicalPath(join(viaAlias, "new", "file.txt"))).toBe(join(root, "new", "file.txt"));
    expect(isContained(join(viaAlias, "new", "file.txt"), viaAlias)).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("canonicalPath on POSIX", () => {
  test("a backslash is part of a filename, so a link named `a\\b` is followed", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-canon-bs-")));
    try {
      const root = join(base, "ws");
      mkdirSync(root, { recursive: true });
      mkdirSync(join(base, "outside"), { recursive: true });
      symlinkSync(join(base, "outside"), join(root, "a\\b"));
      expect(canonicalPath(join(root, "a\\b", "new.txt"))).toBe(join(base, "outside", "new.txt"));
      expect(isContained(join(root, "a\\b", "new.txt"), root)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
