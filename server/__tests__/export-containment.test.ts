/**
 * Export routes stay inside the workspace (finding 19 of the 2026-09-23 final
 * review).
 *
 * Every export builder resolves a content-set directory from `?contentSet=`
 * (or discovers one), then reads the files its manifest names and inlines the
 * assets those files reference. Before this fix only wordtaste and eli5 had a
 * lexical guard on the content set, and none checked symlinks: `?contentSet=
 * ../outside` exported an outside deck, a content set symlinked to outside
 * exported it too, and a manifest entry or stylesheet that was a symlink to
 * outside was read and inlined. All of these go through `isContained` now.
 *
 * The positive half pins what must keep working: normal exports of every
 * mode, a content set reached through an in-root symlink, and inlining of
 * in-root assets.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportRoutes } from "../routes/export.js";

const SENTINEL = "OUTSIDE-EXPORT-SENTINEL";
const GOOD = "GOOD-EXPORT-CONTENT";
const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/** The outside image: its base64 must never appear in an export. */
const SECRET_PNG = Buffer.concat([DOT_PNG, Buffer.from(SENTINEL)]);
const hasZip = Bun.which("zip") !== null;

let base: string;
let workspace: string;
let outside: string;
let app: Hono;

function page(label: string, extraHead = "", extraBody = ""): string {
  return `<!DOCTYPE html><html><head><title>${label}</title>${extraHead}</head><body><h1>${label}</h1>${extraBody}</body></html>`;
}

/** A content set every export mode can read: slides, pages, audiences, draft. */
function writeSet(dir: string, label: string, opts: { pageFile?: string } = {}) {
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "dot.png"), DOT_PNG);
  writeFileSync(join(dir, "one.html"), page(label, "", `<img src="assets/dot.png">`));
  writeFileSync(join(dir, "theme.css"), `/* ${label} theme */`);
  writeFileSync(join(dir, "draft.md"), `# ${label}\n`);
  const file = opts.pageFile ?? "one.html";
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      title: label,
      slides: [{ file, title: label }],
      pages: [{ file, title: label }],
      audiences: [{ id: "a", label: "A", file }],
    }),
  );
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-export-containment-")));
  workspace = join(base, "ws");
  outside = join(base, "outside");
  mkdirSync(workspace, { recursive: true });
  writeSet(outside, SENTINEL);
  writeFileSync(join(outside, "sentinel.css"), `body::after { content: "${SENTINEL}"; }`);
  writeFileSync(join(outside, "sentinel.html"), page(SENTINEL));
  writeFileSync(join(outside, "secret.png"), SECRET_PNG);

  writeSet(join(workspace, "good"), GOOD);
  // A content set reached through an in-root symlink is a normal content set.
  symlinkSync(join(workspace, "good"), join(workspace, "aliased"));
  // A content set that is a symlink to outside.
  symlinkSync(outside, join(workspace, "ext"));

  // A content set whose manifest names a file that is a symlink to outside.
  writeSet(join(workspace, "mixed"), GOOD, { pageFile: "leak.html" });
  symlinkSync(join(outside, "sentinel.html"), join(workspace, "mixed", "leak.html"));

  // A content set whose own manifest.json is a symlink to outside.
  mkdirSync(join(workspace, "linked-manifest"), { recursive: true });
  symlinkSync(join(outside, "manifest.json"), join(workspace, "linked-manifest", "manifest.json"));
  symlinkSync(join(outside, "one.html"), join(workspace, "linked-manifest", "one.html"));

  // A content set whose page references outside assets through symlinks.
  writeSet(join(workspace, "inline"), GOOD);
  symlinkSync(join(outside, "sentinel.css"), join(workspace, "inline", "leak.css"));
  symlinkSync(join(outside, "secret.png"), join(workspace, "inline", "leak.png"));
  writeFileSync(
    join(workspace, "inline", "one.html"),
    page(GOOD, `<link rel="stylesheet" href="leak.css">`, `<img src="leak.png"><img src="assets/dot.png">`),
  );
  // Slide theme symlinked to outside.
  writeSet(join(workspace, "theme-leak"), GOOD);
  rmSync(join(workspace, "theme-leak", "theme.css"));
  symlinkSync(join(outside, "sentinel.css"), join(workspace, "theme-leak", "theme.css"));
  // A content set containing a symlink to an outside file, for the zip routes.
  writeSet(join(workspace, "zipleak"), GOOD);
  symlinkSync(join(outside, "sentinel.html"), join(workspace, "zipleak", "leak.html"));

  app = new Hono();
  registerExportRoutes(app, {
    workspace,
    initParams: { slideWidth: 1280, slideHeight: 720 },
    watchPatterns: ["**/*.html", "**/*.css", "**/*.md"],
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function body(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

describe("exports refuse content outside the workspace", () => {
  const attacks = [
    "/export/slides?contentSet=../outside",
    "/export/slides?contentSet=ext",
    "/export/slides/download?contentSet=ext",
    "/export/slides/player?contentSet=ext",
    "/export/webcraft?contentSet=../outside",
    "/export/webcraft?contentSet=ext",
    "/export/webcraft/download?contentSet=ext",
    "/export/kami?contentSet=ext",
    "/export/kami/download?contentSet=ext",
    "/export/wordtaste/download?contentSet=ext",
    "/export/eli5?contentSet=ext",
    "/export/eli5/download?contentSet=ext",
    "/export/eli5/site-index?contentSet=ext",
    // Manifest-selected file symlinked to outside.
    "/export/slides?contentSet=mixed",
    "/export/slides/player?contentSet=mixed",
    "/export/webcraft?contentSet=mixed",
    "/export/webcraft/download?contentSet=mixed",
    "/export/kami?contentSet=mixed",
    "/export/kami/download?contentSet=mixed",
    "/export/eli5?contentSet=mixed",
    "/export/eli5/download?contentSet=mixed",
    // The manifest itself symlinked to outside.
    "/export/slides?contentSet=linked-manifest",
    "/export/webcraft/download?contentSet=linked-manifest",
    "/export/eli5/site-index?contentSet=linked-manifest",
    // The slide theme symlinked to outside.
    "/export/slides?contentSet=theme-leak",
    "/export/slides/player?contentSet=theme-leak",
  ];
  for (const path of attacks) {
    it(`${path} is refused and leaks nothing`, async () => {
      const res = await app.request(path);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await body(res)).not.toContain(SENTINEL);
    });
  }

  it("assets referenced through symlinks to outside are not inlined", async () => {
    for (const path of ["/export/webcraft/download?contentSet=inline", "/export/kami/download?contentSet=inline", "/export/slides/download?contentSet=inline"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const text = await body(res);
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(SECRET_PNG.toString("base64"));
    }
    // The in-root image next to them still inlines.
    const ok = await body(await app.request("/export/webcraft/download?contentSet=inline"));
    expect(ok).toContain(`data:image/png;base64,${DOT_PNG.toString("base64")}`);
  });

  it.skipIf(!hasZip)("zip exports refuse a content set that is, or contains, a symlink to outside", async () => {
    for (const path of [
      "/export/webcraft/zip?contentSet=ext",
      "/export/webcraft/zip?contentSet=../outside",
      "/export/webcraft/zip?contentSet=zipleak",
      "/export/eli5/zip?contentSet=ext",
      "/export/eli5/zip?contentSet=zipleak",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await body(res)).not.toContain(SENTINEL);
    }
  });
});

describe("exports inside the workspace keep working", () => {
  const normal = [
    "/export/slides?contentSet=good",
    "/export/slides/download?contentSet=good",
    "/export/slides/player?contentSet=good",
    "/export/webcraft?contentSet=good",
    "/export/webcraft/download?contentSet=good",
    "/export/kami?contentSet=good",
    "/export/kami/download?contentSet=good",
    "/export/wordtaste/download?contentSet=good",
    "/export/eli5?contentSet=good",
    "/export/eli5/download?contentSet=good",
    "/export/eli5/site-index?contentSet=good",
    // Through an in-root symlinked content set.
    "/export/slides?contentSet=aliased",
    "/export/webcraft/download?contentSet=aliased",
    "/export/wordtaste/download?contentSet=aliased",
  ];
  for (const path of normal) {
    it(`${path} exports the content set`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const text = await body(res);
      expect(text).toContain(GOOD);
      expect(text).not.toContain(SENTINEL);
    });
  }

  it("downloads inline in-root assets", async () => {
    const text = await body(await app.request("/export/webcraft/download?contentSet=good"));
    expect(text).toContain(`data:image/png;base64,${DOT_PNG.toString("base64")}`);
  });

  it.skipIf(!hasZip)("zip exports of a normal content set succeed", async () => {
    for (const path of ["/export/webcraft/zip?contentSet=good", "/export/eli5/zip?contentSet=good", "/export/webcraft/zip?contentSet=aliased"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(await body(res)).toContain("manifest.json");
    }
  });

  it("the file snapshot lists workspace files and never outside ones", async () => {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: { path: string; content: string }[] };
    expect(files.some((f) => f.path === "good/one.html")).toBe(true);
    expect(files.some((f) => f.content.includes(SENTINEL))).toBe(false);
  });
});

describe("remotion export", () => {
  let ws: string;
  let remotion: Hono;
  const ROOT_TSX = `import { Composition } from "remotion";
import { Main } from "./Main";
export const Root = () => <Composition id="main" component={Main} durationInFrames={30} fps={30} width={640} height={360} />;
`;
  beforeAll(() => {
    ws = join(base, "remotion-ws");
    mkdirSync(join(ws, "src"), { recursive: true });
    mkdirSync(join(ws, "public"), { recursive: true });
    writeFileSync(join(ws, "src", "Root.tsx"), ROOT_TSX);
    writeFileSync(join(ws, "src", "Main.tsx"), `export const Main = () => <div>${GOOD}</div>;\n`);
    writeFileSync(join(outside, "Leak.tsx"), `export const Leak = () => <div>${SENTINEL}</div>;\n`);
    symlinkSync(join(outside, "Leak.tsx"), join(ws, "src", "Leak.tsx"));
    symlinkSync(join(outside, "secret.png"), join(ws, "public", "leak.png"));
    writeFileSync(join(ws, "public", "dot.png"), DOT_PNG);
    remotion = new Hono();
    registerExportRoutes(remotion, { workspace: ws });
  });

  it("exports in-root sources and assets, never outside ones", async () => {
    const res = await remotion.request("/export/remotion/download");
    expect(res.status).toBe(200);
    const text = await body(res);
    expect(text).toContain(GOOD);
    expect(text).toContain(DOT_PNG.toString("base64"));
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(SECRET_PNG.toString("base64"));
    expect(readdirSync(join(ws, "src")).sort()).toEqual(["Leak.tsx", "Main.tsx", "Root.tsx"]);
  });
});
