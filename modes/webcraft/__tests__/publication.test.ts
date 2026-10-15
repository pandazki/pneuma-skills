import { describe, expect, test } from "bun:test";
import publication from "../publication.js";

describe("Webcraft public projection", () => {
  test("publishes the selected site's rendering surface and sanitizes manifest/private state", async () => {
    const result = await publication.project({ files: [
      { path: "site/manifest.json", content: JSON.stringify({ pages: [{ file: "index.html", title: "Home", secret: "hidden" }], secret: "private" }) },
      { path: "site/index.html", content: '<link href="styles.css"><h1>Hello</h1>' },
      { path: "site/styles.css", content: "h1 { color: red }" },
      { path: "site/data.json", content: '{"items":["public"]}' },
      { path: "site/config.json", content: '{"token":"private"}' },
      { path: "site/.env", content: "SECRET=private" },
      { path: "other/index.html", content: "Other site" },
      { path: "session.json", content: "private" },
    ], contentSet: "site", activeFile: "index.html", initParams: { apiKey: "private" } });
    expect(result.resources).toEqual(["site/index.html", "site/styles.css", "site/data.json"]);
    expect(result.page).toBe("site/index.html");
    expect(result.projection.entryAddress).toEqual({ contentSet: "site", page: "index.html" });
    expect(result.projection.sources.site).toEqual({ byContentSet: { site: { pages: [{ file: "index.html", title: "Home" }] } } });
    expect(result.projection.initParams).toBeUndefined();
    expect(JSON.stringify(result.projection)).not.toContain("private");
    expect(JSON.stringify(result.projection)).not.toContain("hidden");
    expect((result as { projectionInputs?: string[] }).projectionInputs).toEqual(["site/manifest.json"]);
  });

  test("refuses traversal and a missing public entry instead of choosing another site", () => {
    const base = { files: [{ path: "site/index.html", content: "ok" }], activeFile: "index.html", initParams: {} };
    expect(() => publication.project({ ...base, contentSet: "../site" })).toThrow();
    expect(() => publication.project({ ...base, contentSet: "missing" })).toThrow();
  });

  test("root sites retain nested assets and explicit data dependencies while excluding another content set", async () => {
    const result = await publication.project({ files: [
      { path: "manifest.json", content: '{"pages":[{"file":"docs/guide.html","title":"A named guide"}]}' },
      { path: "docs/guide.html", content: '<script src="../assets/main.js"></script>' },
      { path: "assets/main.js", content: 'fetch("/data.json")' },
      { path: "assets/image.png", content: "" },
      { path: "data.json", content: '{"public":true}' },
      { path: "unrelated.json", content: '{"private":true}' },
      { path: "another/manifest.json", content: '{"pages":[{"file":"index.html"}]}' },
      { path: "another/index.html", content: "Other site" },
      { path: "implicit/index.html", content: "Another implicit content set" },
      { path: "implicit/styles.css", content: "body { color: red }" },
    ], contentSet: null, activeFile: "docs/guide.html", initParams: {} });
    expect(result.resources).toEqual(["docs/guide.html", "assets/main.js", "assets/image.png", "data.json"]);
    expect(result.projection.sources.site).toEqual({ byContentSet: { "": { pages: [{ file: "docs/guide.html", title: "A named guide" }] } } });
    expect((result as { projectionInputs?: string[] }).projectionInputs).toEqual(["manifest.json"]);
  });
});
