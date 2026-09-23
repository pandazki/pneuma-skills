/**
 * Workspace files delivered to the browser as TEXT.
 *
 * The cold-start snapshot (`GET /api/files`) and the watcher's
 * `content_update` both carry file bodies inside JSON, and both deliver
 * whatever a mode's `watchPatterns` match. A directory glob
 * (`**\/motions/**\/*`, `**\/assets/**\/*`) or a font pattern (`**\/*.woff2`)
 * matches binaries, and a binary read as UTF-8 is not content at all: every
 * invalid sequence becomes U+FFFD, so the body is both useless and larger than
 * the file. A sprite workspace with 2,727 frame PNGs and a few dozen
 * WebP/WebM/MP4 loops made a 1.89 GB snapshot that way (2026-09-23).
 *
 * The contract both callers apply: a binary match is still reported by path,
 * with empty content — the shape image change signals have always had — and
 * its bytes are served by `/content/*`.
 *
 * This is a different question from `seed-installer.ts::isBinarySeedFile`
 * ("must this be copied byte-for-byte?"), which may answer yes for text
 * (`.svg`) because a byte copy is always safe. Here a wrong "binary" would
 * hide text a viewer reads, so the extension list names only formats that are
 * never text, and everything else is decided by the same NUL sniff.
 */

import { readFileSync } from "node:fs";

/** Formats that are never text. Not exhaustive — the content sniff covers the rest. */
const BINARY_EXT_RE =
  /\.(png|apng|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic|psd|woff2?|ttf|otf|eot|mp[34]|m4[av]|aac|wav|ogg|oga|opus|flac|webm|mov|mkv|avi|glb|blend|bin|wasm|zip|gz|tgz|tar|7z|pdf|lottie|riv)$/i;

/** How much of a file is inspected for a NUL byte. Text never contains one. */
const SNIFF_BYTES = 8192;

/**
 * The file's text, or `null` when it is binary.
 *
 * A known binary extension is answered without touching the disk. Anything
 * else is read once and classified by whether its first {@link SNIFF_BYTES}
 * contain a NUL — every binary container we produce (PNG, WebP, WebM, MP4,
 * glTF-binary, zip, fonts) has one in its header.
 *
 * Throws when the file cannot be read, like `readFileSync` — callers keep
 * their existing skip-unreadable handling.
 */
export function readWorkspaceText(absPath: string): string | null {
  if (BINARY_EXT_RE.test(absPath)) return null;
  const bytes = readFileSync(absPath);
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return null;
  return bytes.toString("utf-8");
}
