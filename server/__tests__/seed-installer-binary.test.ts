/**
 * Binary-safety of the seed copy path.
 *
 * The original rule was an extension *allowlist of binaries*: anything
 * not on the list was read as UTF-8, run through `applyTemplateParams`,
 * and written back — so any unlisted binary (previz ships `scene.glb`
 * and `scene.blend`, and every mode with init params hits this path)
 * came out the other side with its non-UTF-8 bytes replaced by U+FFFD.
 * These tests pin the inverted default: unknown extension + NUL byte in
 * the first 8 KiB ⇒ copy the bytes untouched.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySeedEntry, isBinarySeedFile } from "../seed-installer.js";

let seedBase: string;
let workspace: string;

beforeEach(async () => {
  seedBase = await mkdtemp(join(tmpdir(), "pneuma-seedbin-src-"));
  workspace = await mkdtemp(join(tmpdir(), "pneuma-seedbin-dst-"));
});
afterEach(async () => {
  await rm(seedBase, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

/** A minimal but realistic binary glTF: magic + version + length, then a
 *  JSON chunk header, then bytes no UTF-8 decoder will round-trip. */
function glbBytes(): Buffer<ArrayBuffer> {
  const payload = [
    0x7b, 0x7d, 0x00, 0x00, // "{}" + padding NULs
    0x80, 0x81, 0xfe, 0xff, // lone continuation bytes + invalid UTF-8
    0xc3, 0x28, 0xed, 0xa0, 0x80, // overlong / surrogate sequences
  ];
  const all = Buffer.alloc(20 + payload.length);
  all.write("glTF", 0, "ascii");
  all.writeUInt32LE(2, 4); // version
  all.writeUInt32LE(all.length, 8); // total length
  all.writeUInt32LE(payload.length, 12); // chunk length
  all.write("JSON", 16, "ascii");
  Buffer.from(payload).copy(all, 20);
  return all;
}

describe("isBinarySeedFile", () => {
  it("classifies known binary extensions without reading the file", () => {
    // These paths do not exist on disk — the extension fast path decides.
    for (const name of [
      "scene.glb",
      "scene.blend",
      "buffer.bin",
      "clip.webm",
      "clip.mov",
      "voice.m4a",
      "track.flac",
      "body.otf",
      "hero.avif",
      "engine.wasm",
      "bundle.7z",
      "logo.png",
      "photo.JPEG",
      "font.woff2",
      "doc.pdf",
      "icon.svg",
    ]) {
      expect(isBinarySeedFile(join(seedBase, "missing", name))).toBe(true);
    }
  });

  it("classifies text extensions as text", async () => {
    for (const name of [
      "index.html",
      "data.json",
      "notes.md",
      "app.js",
      "App.tsx",
      "style.css",
      "run.py",
      "graph.mmd",
      "board.drawio",
      "sketch.excalidraw",
      "plain.txt",
      "Makefile",
    ]) {
      await writeFile(join(seedBase, name), "hello {{name}}\n");
      expect(isBinarySeedFile(join(seedBase, name))).toBe(false);
    }
  });

  it("sniffs content for unknown extensions", async () => {
    await writeFile(join(seedBase, "mystery.qzx"), Buffer.from([0x41, 0x00, 0x42]));
    await writeFile(join(seedBase, "plain.qzx"), "just text, no NUL\n");
    expect(isBinarySeedFile(join(seedBase, "mystery.qzx"))).toBe(true);
    expect(isBinarySeedFile(join(seedBase, "plain.qzx"))).toBe(false);
  });

  it("sniffs only the first 8 KiB", async () => {
    const inWindow = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from([0x00])]);
    const pastWindow = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0x00])]);
    await writeFile(join(seedBase, "edge-in.dat1"), inWindow);
    await writeFile(join(seedBase, "edge-out.dat1"), pastWindow);
    expect(isBinarySeedFile(join(seedBase, "edge-in.dat1"))).toBe(true);
    expect(isBinarySeedFile(join(seedBase, "edge-out.dat1"))).toBe(false);
  });

  it("treats an empty file as text", async () => {
    await writeFile(join(seedBase, "empty.unknownext"), "");
    expect(isBinarySeedFile(join(seedBase, "empty.unknownext"))).toBe(false);
  });
});

describe("copySeedEntry — binary preservation with params present", () => {
  it("copies a .glb byte-for-byte", async () => {
    const bytes = glbBytes();
    await writeFile(join(seedBase, "scene.glb"), bytes);
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "scene.glb",
      dst: "scene.glb",
      params: { title: "First Light", shots: 3 },
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "scene.glb"))).toEqual(bytes);
  });

  it("copies an unknown-extension binary byte-for-byte", async () => {
    // No extension rule can save this one — only the NUL sniff can.
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x7b, 0x7b, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x7d, 0x7d, 0x80]);
    await writeFile(join(seedBase, "rig.pneumarig"), bytes);
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "rig.pneumarig",
      dst: "rig.pneumarig",
      params: { title: "First Light" },
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "rig.pneumarig"))).toEqual(bytes);
  });

  it("copies binaries inside a seed directory byte-for-byte", async () => {
    await mkdir(join(seedBase, "first-light", "shots"), { recursive: true });
    const glb = glbBytes();
    const blend = Buffer.from([0x42, 0x4c, 0x45, 0x4e, 0x44, 0x45, 0x52, 0x00, 0x90, 0xfe]);
    await writeFile(join(seedBase, "first-light", "shots", "scene.glb"), glb);
    await writeFile(join(seedBase, "first-light", "scene.blend"), blend);
    await writeFile(join(seedBase, "first-light", "previz.json"), '{"title":"{{title}}"}');

    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "first-light/",
      dst: "./",
      params: { title: "First Light" },
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "shots", "scene.glb"))).toEqual(glb);
    expect(readFileSync(join(workspace, "scene.blend"))).toEqual(blend);
    expect(readFileSync(join(workspace, "previz.json"), "utf-8")).toBe('{"title":"First Light"}');
  });
});

describe("copySeedEntry — text substitution is unchanged", () => {
  it("still substitutes params in single text files", async () => {
    await writeFile(join(seedBase, "README.md"), "# {{title}}\n\nby {{author}}\n");
    await writeFile(join(seedBase, "config.json"), '{"name":"{{title}}","n":{{count}}}');

    copySeedEntry({
      workspace,
      seedBase,
      src: "README.md",
      dst: "README.md",
      params: { title: "First Light", author: "Pandazki", count: 3 },
      locale: "en",
    });
    copySeedEntry({
      workspace,
      seedBase,
      src: "config.json",
      dst: "config.json",
      params: { title: "First Light", author: "Pandazki", count: 3 },
      locale: "en",
    });

    expect(readFileSync(join(workspace, "README.md"), "utf-8")).toBe("# First Light\n\nby Pandazki\n");
    expect(readFileSync(join(workspace, "config.json"), "utf-8")).toBe('{"name":"First Light","n":3}');
  });

  it("still substitutes params across every text extension in a directory", async () => {
    await mkdir(join(seedBase, "tpl"), { recursive: true });
    const names = [
      "index.html",
      "data.json",
      "notes.md",
      "app.js",
      "App.tsx",
      "style.css",
      "run.py",
      "graph.mmd",
      "board.drawio",
      "sketch.excalidraw",
      "plain.txt",
    ];
    for (const n of names) await writeFile(join(seedBase, "tpl", n), `<<{{title}}>>`);

    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "tpl/",
      dst: "tpl",
      params: { title: "First Light" },
      locale: "en",
    });
    expect(result).not.toBeNull();
    for (const n of names) {
      expect(readFileSync(join(workspace, "tpl", n), "utf-8")).toBe("<<First Light>>");
    }
  });

  it("leaves UTF-8 text with multibyte characters intact", async () => {
    await writeFile(join(seedBase, "zh.md"), "# {{title}}\n\n中文内容 — 漢字、絵文字\n");
    copySeedEntry({
      workspace,
      seedBase,
      src: "zh.md",
      dst: "zh.md",
      params: { title: "初光" },
      locale: "en",
    });
    expect(readFileSync(join(workspace, "zh.md"), "utf-8")).toBe("# 初光\n\n中文内容 — 漢字、絵文字\n");
  });
});
