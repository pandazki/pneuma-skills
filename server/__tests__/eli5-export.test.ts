/**
 * ELI5 export + deploy routes.
 *
 * An eli5 topic is one content set: `<topic>/manifest.json` listing
 * `audiences[]` in ladder order (simplest register first) plus one
 * self-contained HTML page per audience under `<topic>/pages/`. Export
 * mirrors webcraft's quadruple — preview page, per-rung download, whole-topic
 * zip, deploy — with two eli5-specific server surfaces the deploy script
 * fetches: `/export/eli5/site-index` (the ladder landing page that becomes
 * the deployed `index.html`) and `?nav=ladder` on the download route (the
 * way-back navigation injected into every deployed rung).
 *
 * These tests pin the pure server parts end-to-end against a real Hono app +
 * on-disk workspace, mirroring wordtaste-export.test.ts: content-set
 * resolution, the pages/-relative asset base, ladder order, escaping, the
 * nav round trip, and download filenames (incl. the CJK fallback).
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportRoutes } from "../routes/export.js";
import { HookBus } from "../../core/hook-bus.js";
import type { SessionInfo } from "../../core/types/plugin.js";

let workspace: string;
let app: Hono;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pneuma-eli5-export-"));
  app = new Hono();
  registerExportRoutes(app, { workspace });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A minimal but real audience page: full document, inline CSS, one asset ref. */
function pageHtml(label: string, extras = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${label}</title>
<style>body { background: #fff8ef; }</style>
</head>
<body>
<h1>${label}</h1>
<img src="../assets/dot.png" alt="">
${extras}
</body>
</html>`;
}

/** 1x1 transparent PNG. */
const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface SeedAudience {
  id: string;
  label: string;
  file?: string;
  tone?: string;
  html?: string;
}

/** Write a topic (manifest + pages + one asset) into `dir` relative to the workspace ("" = root). */
async function seedTopic(
  dir: string,
  opts: { title: string; topic?: string; language?: string; audiences: SeedAudience[] },
): Promise<void> {
  const base = dir ? join(workspace, dir) : workspace;
  await mkdir(join(base, "pages"), { recursive: true });
  await mkdir(join(base, "assets"), { recursive: true });
  await writeFile(join(base, "assets", "dot.png"), DOT_PNG);
  const audiences = opts.audiences.map((a) => ({
    id: a.id,
    label: a.label,
    file: a.file ?? `pages/${a.id}.html`,
    ...(a.tone ? { tone: a.tone } : {}),
  }));
  for (const [i, a] of audiences.entries()) {
    await writeFile(join(base, a.file), opts.audiences[i].html ?? pageHtml(a.label), "utf-8");
  }
  await writeFile(
    join(base, "manifest.json"),
    JSON.stringify({
      title: opts.title,
      ...(opts.topic ? { topic: opts.topic } : {}),
      ...(opts.language ? { language: opts.language } : {}),
      audiences,
    }),
    "utf-8",
  );
}

const LADDER = {
  title: "What is a database index?",
  topic: "database-index",
  language: "en",
  audiences: [
    { id: "age-5", label: "Age 5", tone: "playful and delighted" },
    { id: "manager", label: "Manager", tone: "memo; decision at the end" },
    { id: "engineer", label: "Engineer" },
  ],
};

// ── /export/eli5 — the export page ──────────────────────────────────────────

describe("GET /export/eli5", () => {
  it("renders every rung in ladder order with its number and label", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5?contentSet=database-index");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("What is a database index?");
    const posA = html.indexOf("Age 5");
    const posB = html.indexOf("Manager");
    const posC = html.indexOf("Engineer");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(posA);
    expect(posC).toBeGreaterThan(posB);
  });

  it("carries the deploy toolbar, modal, and collectDeployFiles wiring", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (await app.request("/export/eli5?contentSet=database-index")).text();
    expect(html).toContain("deploy-trigger-btn");
    expect(html).toContain("vercel-modal");
    expect(html).toContain("function collectDeployFiles");
    // The deploy script fetches the two eli5-specific server surfaces.
    expect(html).toContain("/export/eli5/site-index");
    expect(html).toContain("nav=ladder");
  });

  it("gives each rung a download control and the toolbar a zip control", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (await app.request("/export/eli5?contentSet=database-index")).text();
    expect(html).toContain("/export/eli5/download");
    expect(html).toContain("/export/eli5/zip");
  });

  it("resolves each page's relative assets from its own directory under /content", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (await app.request("/export/eli5?contentSet=database-index")).text();
    expect(html).toContain("/content/database-index/pages/");
  });

  it("escapes </script> inside embedded page HTML so the page does not truncate", async () => {
    await seedTopic("database-index", {
      ...LADDER,
      audiences: [
        {
          id: "age-5",
          label: "Age 5",
          html: pageHtml("Age 5", "<script>console.log('inline')</script>"),
        },
      ],
    });
    const html = await (await app.request("/export/eli5?contentSet=database-index")).text();
    // The embedded JSON must not contain a raw </script>; the document must
    // survive to its real end.
    expect(html).toContain("<\\/script>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("falls back to a workspace-root manifest when no contentSet is given", async () => {
    await seedTopic("", LADDER);
    const res = await app.request("/export/eli5");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Age 5");
  });

  it("auto-discovers the first subdirectory holding a manifest.json", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Age 5");
    // The discovered content set must flow into the /content base, not be lost.
    expect(html).toContain("/content/database-index/pages/");
  });

  it("404s when no manifest exists anywhere", async () => {
    const res = await app.request("/export/eli5");
    expect(res.status).toBe(404);
  });

  it("404s when the manifest has no audiences", async () => {
    await mkdir(join(workspace, "empty"), { recursive: true });
    await writeFile(join(workspace, "empty", "manifest.json"), JSON.stringify({ title: "T", audiences: [] }));
    const res = await app.request("/export/eli5?contentSet=empty");
    expect(res.status).toBe(404);
  });

  it("rejects a contentSet that escapes the workspace", async () => {
    const res = await app.request(`/export/eli5?contentSet=${encodeURIComponent("../../etc")}`);
    expect(res.status).toBe(400);
  });
});

// ── /export/eli5/download — one rung, self-contained ────────────────────────

describe("GET /export/eli5/download", () => {
  it("inlines assets relative to the page's own directory (pages/), not the topic root", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5/download?contentSet=database-index&page=age-5");
    expect(res.status).toBe(200);
    const html = await res.text();
    // ../assets/dot.png resolves from <topic>/pages/ → <topic>/assets/dot.png.
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("../assets/dot.png");
  });

  it("picks the audience by id", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (
      await app.request("/export/eli5/download?contentSet=database-index&page=manager")
    ).text();
    expect(html).toContain("<h1>Manager</h1>");
  });

  it("falls back to the first rung when the id names nothing", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (
      await app.request("/export/eli5/download?contentSet=database-index&page=nope")
    ).text();
    expect(html).toContain("<h1>Age 5</h1>");
  });

  it("names the file after the topic title and audience label", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5/download?contentSet=database-index&page=manager");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toContain("Manager");
    expect(cd).toContain(".html");
    expect(cd).toContain("filename*=UTF-8''");
  });

  it("CJK-only titles fall back to contentSet + audience id — distinct per rung", async () => {
    await seedTopic("how-llms-work", {
      title: "大语言模型是怎么工作的？",
      audiences: [
        { id: "kid-8", label: "8 岁孩子" },
        { id: "pm", label: "产品经理" },
      ],
    });
    const cd1 =
      (await app.request("/export/eli5/download?contentSet=how-llms-work&page=kid-8")).headers.get(
        "content-disposition",
      ) ?? "";
    const cd2 =
      (await app.request("/export/eli5/download?contentSet=how-llms-work&page=pm")).headers.get(
        "content-disposition",
      ) ?? "";
    expect(cd1).toContain('filename="how-llms-work-kid-8.html"');
    expect(cd2).toContain('filename="how-llms-work-pm.html"');
    // Capable browsers still get the real title.
    expect(cd1).toContain("filename*=UTF-8''");
  });

  it("does NOT carry the ladder nav on a plain download", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (
      await app.request("/export/eli5/download?contentSet=database-index&page=age-5")
    ).text();
    expect(html).not.toContain("pneuma-eli5-nav");
  });

  it("nav=ladder injects a way back: sibling rungs + the ladder landing", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (
      await app.request("/export/eli5/download?contentSet=database-index&page=manager&nav=ladder")
    ).text();
    expect(html).toContain("pneuma-eli5-nav");
    expect(html).toContain('href="age-5.html"');
    expect(html).toContain('href="engineer.html"');
    expect(html).toContain('href="../index.html"');
    // The current rung is marked, and the nav sits inside the body.
    expect(html).toContain('aria-current="page"');
    expect(html.indexOf("pneuma-eli5-nav")).toBeLessThan(html.lastIndexOf("</body>"));
  });

  it("emits export:before and export:after on the hook bus", async () => {
    await seedTopic("database-index", LADDER);
    const hookBus = new HookBus();
    const sessionInfo: SessionInfo = {
      sessionId: "s1",
      mode: "eli5",
      workspace,
      backendType: "claude-code",
    };
    const seen: string[] = [];
    hookBus.on("export:before", "probe", async (ctx) => {
      seen.push(`before:${(ctx.payload as { format?: string }).format}`);
      return ctx.payload;
    });
    hookBus.on("export:after", "probe", async (ctx) => {
      seen.push(`after:${(ctx.payload as { format?: string }).format}`);
      return ctx.payload;
    });
    const hooked = new Hono();
    registerExportRoutes(hooked, { workspace, hookBus, sessionInfo });
    const res = await hooked.request("/export/eli5/download?contentSet=database-index&page=age-5");
    expect(res.status).toBe(200);
    // export:after is emitted best-effort (not awaited); give it a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toContain("before:eli5-html");
    expect(seen).toContain("after:eli5-html");
  });

  it("404s when there is no manifest and 400s on traversal", async () => {
    expect((await app.request("/export/eli5/download")).status).toBe(404);
    expect(
      (await app.request(`/export/eli5/download?contentSet=${encodeURIComponent("../../etc")}`)).status,
    ).toBe(400);
  });
});

// ── /export/eli5/site-index — the ladder landing page ───────────────────────

describe("GET /export/eli5/site-index", () => {
  it("renders the ladder: numbered rungs in order, each linking its page", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5/site-index?contentSet=database-index");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("What is a database index?");
    expect(html).toContain('href="pages/age-5.html"');
    expect(html).toContain('href="pages/manager.html"');
    expect(html).toContain('href="pages/engineer.html"');
    const posA = html.indexOf('href="pages/age-5.html"');
    const posB = html.indexOf('href="pages/manager.html"');
    const posC = html.indexOf('href="pages/engineer.html"');
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
  });

  it("shows the tone when the manifest recorded one", async () => {
    await seedTopic("database-index", LADDER);
    const html = await (
      await app.request("/export/eli5/site-index?contentSet=database-index")
    ).text();
    expect(html).toContain("playful and delighted");
  });

  it("escapes manifest text — a hostile title cannot inject markup", async () => {
    await seedTopic("xss", {
      title: 'T<script>alert(1)</script>',
      audiences: [{ id: "a", label: 'L<img src=x onerror=alert(1)>' }],
    });
    const html = await (await app.request("/export/eli5/site-index?contentSet=xss")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("404s without a manifest and 400s on traversal", async () => {
    expect((await app.request("/export/eli5/site-index")).status).toBe(404);
    expect(
      (await app.request(`/export/eli5/site-index?contentSet=${encodeURIComponent("../x")}`)).status,
    ).toBe(400);
  });
});

// ── /export/eli5/zip — the whole topic ──────────────────────────────────────

describe("GET /export/eli5/zip", () => {
  const hasZip = !!Bun.which("zip");
  const hasUnzip = !!Bun.which("unzip");

  it.skipIf(!hasZip)("returns a zip of the topic directory", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5/zip?contentSet=database-index");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain(".zip");
  });

  it.skipIf(!hasZip || !hasUnzip)("the zip holds the manifest and the pages", async () => {
    await seedTopic("database-index", LADDER);
    const res = await app.request("/export/eli5/zip?contentSet=database-index");
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpZip = join(workspace, "probe.zip");
    await writeFile(tmpZip, buf);
    const proc = Bun.spawn(["unzip", "-l", tmpZip], { stdout: "pipe", stderr: "ignore" });
    const listing = await new Response(proc.stdout).text();
    await proc.exited;
    expect(listing).toContain("manifest.json");
    expect(listing).toContain("pages/age-5.html");
    expect(listing).toContain("pages/manager.html");
  });

  it.skipIf(!hasZip)("400s on traversal", async () => {
    const res = await app.request(`/export/eli5/zip?contentSet=${encodeURIComponent("../../etc")}`);
    expect(res.status).toBe(400);
  });
});
