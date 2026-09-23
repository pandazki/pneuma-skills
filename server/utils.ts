/**
 * Shared server utilities.
 */

import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export const isWin = process.platform === "win32";

/**
 * Whether `child` is `parent` or lies inside it, compared by whole path
 * components (case-insensitive on Windows): `/a/ws-neighbor` is NOT inside
 * `/a/ws`. A `parent` given with a trailing separator means strictly inside —
 * the directory itself does not count.
 *
 * Both paths are compared as given; callers pass absolute, normalized paths
 * (`resolve` / `join`). This is a lexical check: a symlink inside `parent`
 * can still point anywhere — use `isContained` where the filesystem is read
 * or written through the path.
 */
export function pathStartsWith(child: string, parent: string): boolean {
  const norm = (p: string) => (isWin ? p.toLowerCase() : p);
  const c = norm(child);
  let p = norm(parent);
  const isSep = (ch: string | undefined) => ch === sep || ch === "/";
  const strict = p.length > 1 && isSep(p[p.length - 1]) && !/^[a-z]:[\\/]$/i.test(p);
  if (strict) p = p.slice(0, -1);
  if (c === p) return !strict;
  if (!c.startsWith(p)) return false;
  // Filesystem root ("/" or "C:\"): everything absolute is inside it.
  if (isSep(p[p.length - 1])) return true;
  return isSep(c[p.length]);
}

/** Symlinks followed while canonicalizing one path — the kernel's own order of magnitude (Linux: 40). */
const MAX_SYMLINK_HOPS = 40;

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/**
 * Path components, split the way the platform does: `/` only on POSIX, where
 * a backslash is an ordinary filename character (a link named `a\b` must
 * stay one component), and either separator on Windows.
 */
function components(p: string): string[] {
  return p.split(isWin ? /[\\/]+/ : /\/+/).filter((c) => c !== "" && c !== ".");
}

/**
 * The canonical form of `p` with every symlink resolved, or `null` when that
 * cannot be established.
 *
 * A path that does not exist (yet) resolves component by component, the way
 * the kernel will once something is created there: existing components and
 * links are followed — a dangling link to where it points, `..` inside a link
 * target against the directory the link actually resolved to — and the first
 * missing component starts a literal suffix appended to the canonical form of
 * its existing parent. The number of missing components is unbounded; the
 * number of links followed is not.
 *
 * `null` (fail closed) for a symlink loop or more than {@link MAX_SYMLINK_HOPS}
 * links, a component that is not a directory, a `..` below a missing
 * component, and any filesystem error other than "does not exist".
 */
export function canonicalPath(p: string): string | null {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") return null; // ELOOP, ENOTDIR, EACCES, ...
  }

  let current = parse(abs).root; // always an existing, canonical directory
  const pending = components(abs.slice(current.length));
  let hops = 0;
  while (pending.length > 0) {
    const name = pending.shift()!;
    if (name === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, name);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch (err) {
      if (errorCode(err) !== "ENOENT") return null;
      // `next` does not exist, so nothing beneath it can be a link and the
      // rest is literal — unless it climbs back out with `..`, which the
      // kernel would refuse (ENOENT) rather than collapse lexically.
      if (pending.includes("..")) return null;
      try {
        return join(realpathSync(current), name, ...pending);
      } catch {
        return null;
      }
    }
    if (isLink) {
      if (++hops > MAX_SYMLINK_HOPS) return null;
      let target: string;
      try {
        target = readlinkSync(next);
      } catch {
        return null;
      }
      if (target === "") return null;
      if (isAbsolute(target)) current = parse(resolve(target)).root;
      pending.unshift(...components(isAbsolute(target) ? target.slice(parse(target).root.length) : target));
      continue;
    }
    current = next;
  }
  // Every component exists; realpath failed only because something changed
  // underneath us. Settle on what realpath says now.
  try {
    return realpathSync(current);
  } catch {
    return null;
  }
}

/**
 * The single authority for "is this path inside an owned root": `candidate`
 * lies inside `root` (or is `root`) both as written and once symlinks are
 * resolved. No `..`, no sibling directory sharing the root's name as a
 * prefix, and no symlink whose target is outside the root. A symlink whose
 * canonical target stays inside the root is allowed. Fails closed: when
 * either path cannot be canonicalized (see {@link canonicalPath}) the answer
 * is "not contained".
 *
 * Every server boundary that reads, writes, or deletes a workspace path from
 * a request, a manifest, or a watcher event checks it here. The deliberate
 * exceptions are named where they live: the system bridge's OS handoff
 * (`resolveOsHandoffPath`) and project-management actions, which address
 * existing paths the user chose outside any workspace.
 *
 * The check and the later filesystem operation are separate calls: a path
 * swapped for a symlink in between (a race by a local process) is not caught.
 */
export function isContained(candidate: string, root: string): boolean {
  if (!pathStartsWith(resolve(candidate), resolve(root))) return false;
  const c = canonicalPath(candidate);
  const r = canonicalPath(root);
  return c !== null && r !== null && pathStartsWith(c, r);
}

/**
 * Whether `value` is a Git object id (abbreviated or full, SHA-1 or SHA-256
 * hex). A request- or package-supplied commit/tree/blob name must pass this
 * before it reaches a git argument vector: anything else — `--output=…`,
 * `--remote=… --exec=…`, a ref expression — is refused, since git parses a
 * leading `-` as an option even in a position meant for a revision.
 */
export function isGitObjectId(value: string): boolean {
  return /^[0-9a-f]{7,64}$/i.test(value);
}
