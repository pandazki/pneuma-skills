import { describe, expect, it } from "bun:test";
import { mkdtemp, cp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStudio, resolveAddress, contentUrl, saveStudio } from "../domain.js";
import { parseProject, emptyProject } from "../skill/scripts/model.js";
import { exportBrandSite } from "../skill/scripts/export-site.js";

const seed = await Bun.file(join(import.meta.dir, "../seed/morrow/brand.json")).text();
const file = (path: string, content: string) => ({ path, content });

describe("brand project", () => {
  it("loads independent projects and exposes a malformed one without losing the others", () => {
    const studio = loadStudio([file("one/brand.json", seed), file("bad/brand.json", "{")]);
    expect(studio.byContentSet.one.project?.title).toBe("Morrow");
    expect(studio.byContentSet.bad.error).toContain("bad/brand.json");
    expect(loadStudio([]).byContentSet).toEqual({});
  });
  it("keeps planned and failed states observable and validates application relationships", () => {
    const p = emptyProject();
    p.items = [{ ...parseProject(seed).items[0], id: "pending", status: "planned", file: undefined, contexts: [] }];
    expect(parseProject(JSON.stringify(p)).items[0].status).toBe("planned");
    p.items[0].contexts = ["unknown"];
    expect(() => parseProject(JSON.stringify(p))).toThrow("Unknown application");
    p.items[0].contexts = [];
    p.items[0].status = "failed";
    expect(() => parseProject(JSON.stringify(p))).toThrow("error explanation");
  });
  it("rejects duplicate IDs, dangling references and out-of-bounds regions", () => {
    const p = parseProject(seed);
    p.items[1].id = p.items[0].id;
    expect(() => parseProject(JSON.stringify(p))).toThrow("Duplicate item");
    p.items[1].id = "wordmark";
    p.items[1].referenceIds = ["missing"];
    expect(() => parseProject(JSON.stringify(p))).toThrow("Invalid reference");
    p.items[1].referenceIds = [];
    p.items[0].regions[0].width = 1;
    expect(() => parseProject(JSON.stringify(p))).toThrow("Region must fit");
  });
  it("rejects paths that escape or carry URL syntax", () => {
    for (const path of ["../secret.png", "/tmp/x.png", "a/../../x.png", "https://x/a.png", "a\\x.png", "%2e%2e/x.png"]) {
      const p = parseProject(seed); p.items[0].file = path;
      expect(() => parseProject(JSON.stringify(p))).toThrow();
    }
    expect(contentUrl("demo", "assets/a b.png", 2)).toBe("/content/demo/assets/a%20b.png?v=2");
  });
  it("resolves the same stable address after reorder and rejects invalid fine targets", () => {
    const p = parseProject(seed); p.items.reverse();
    const studio = loadStudio([file("one/brand.json", JSON.stringify(p))]);
    const result = resolveAddress(studio, "one", { item: "brand-world", region: "palette" });
    expect("item" in result && result.item?.id).toBe("brand-world");
    expect(resolveAddress(studio, "one", { item: "brand-world", region: "missing" })).toHaveProperty("error");
    expect(resolveAddress(studio, "one", { contentSet: "missing", item: "brand-world" })).toHaveProperty("error");
    expect(() => saveStudio()).toThrow("does not write");
  });
  it("exports a portable book with embedded assets, escaped copy, and no research references", async () => {
    const root = await mkdtemp(join(tmpdir(), "brand-export-"));
    try {
      await cp(join(import.meta.dir, "../seed/morrow"), root, { recursive: true });
      const p = parseProject(seed);
      p.title = '<script>alert("x")</script>';
      p.items.push({ ...p.items[0], id: "research", stage: "references", title: "Private research" });
      await writeFile(join(root, "brand.json"), JSON.stringify(p));
      const html = await exportBrandSite(root);
      expect(html).toContain("data:image/webp;base64,");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain('<script>alert("x")');
      expect(html).not.toContain("Private research");
      expect(await readFile(join(root, "brand-book.html"), "utf8")).toBe(html);
      await rm(join(root, "brand-book.html"));
      const outside = join(root, "outside-sentinel.txt");
      await writeFile(outside, "unchanged");
      await symlink(outside, join(root, "brand-book.html"));
      await expect(exportBrandSite(root)).rejects.toThrow("symbolic link");
      expect(await readFile(outside, "utf8")).toBe("unchanged");
      await rm(join(root, p.items[0].file!));
      await symlink("/etc/hosts", join(root, p.items[0].file!));
      await expect(exportBrandSite(root)).rejects.toThrow("escapes");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
