/**
 * generate_svg.mjs — GPT Image 2.6 SVG on fal.ai.
 *
 * The request shape is the contract fal enforces (without
 * `provider_options.svg.model` it answers 422), so it is pinned exactly.
 * The network half runs against an injected `fetch` that plays fal's queue
 * and CDN; the CLI runs from an installed-skill layout behind a preloaded
 * fetch fixture. Nothing here can reach fal.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSvgRequest,
  costLine,
  generateSvg,
  inspectSvg,
  normalizeColor,
  svgCost,
} from "../generate_svg.mjs";

const workspace = mkdtempSync(join(tmpdir(), "pneuma-svg-test-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const SUNBURST_QUEUE = "https://queue.fal.run/openai/gpt-image-2.6/sunburst/text-to-image";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");

/** The shape fal returned for a six-icon line set (2026-11-05), trimmed to two icons. */
const ICONS = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <title>Note-taking app line icons</title>
  <desc>Outlined icons: search &amp; share.</desc>
  <g fill="none" stroke="#254F42" stroke-width="12" stroke-linecap="round">
    <g id="search"><circle cx="148" cy="696" r="108" /><line x1="224" y1="772" x2="290" y2="838" /></g>
    <g id="share"><circle cx="780" cy="720" r="42" /><line x1="817" y1="698" x2="899" y2="652" /></g>
  </g>
</svg>
`;

interface Call { url: string; method: string; body?: Record<string, any>; auth?: string }

/** fal's queue and CDN, played by one `fetch`: submit → COMPLETED → result → file. */
function fakeFal({ svg = ICONS, submitStatus = 200, images }: { svg?: string | Uint8Array; submitStatus?: number; images?: unknown[] } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined, auth: headers.Authorization });
    if (method === "POST") {
      if (submitStatus !== 200) return new Response('{"detail":"Invalid request"}', { status: submitStatus });
      return Response.json({ request_id: "req-svg-1", status_url: "https://queue.test/req/status", response_url: "https://queue.test/req", cancel_url: "https://queue.test/req/cancel" });
    }
    if (method === "PUT") return Response.json({ status: "CANCELLED" });
    if (url.startsWith("https://queue.test/req/status")) return Response.json({ status: "COMPLETED" });
    if (url === "https://queue.test/req") return Response.json({ images: images ?? [{ url: "https://cdn.test/a.svg", content_type: "image/svg+xml" }] });
    if (url === "https://cdn.test/a.svg") return new Response(typeof svg === "string" ? svg : new Blob([Buffer.from(svg)]));
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

let dirs = 0;
const freshDir = () => join(workspace, `out-${++dirs}`);

describe("the request fal is sent", () => {
  test("the default is the configuration measured clean: one Sunburst / medium SVG authored by gpt-6.1-terra", () => {
    // 2026-11-05 A/B: 5 of 5 clean sets; Flare / low / gpt-5.4 broke 4 of 6.
    expect(buildSvgRequest({ prompt: "Six line icons" })).toEqual({
      url: "https://fal.run/openai/gpt-image-2.6/sunburst/text-to-image",
      model: "openai/gpt-image-2.6-sunburst",
      author: "gpt-6.1-terra",
      body: {
        prompt: "Six line icons",
        output_format: "svg",
        num_images: 1,
        image_size: { width: 1024, height: 1024 },
        quality: "medium",
        provider_options: { svg: { model: "gpt-6.1-terra" } },
      },
    });
  });

  test("the fast settings, another author, a size and a background are sent as asked", () => {
    for (const model of ["flare", "gpt-image-2.6-flare", "openai/gpt-image-2.6-flare"]) {
      const request = buildSvgRequest({ prompt: "A mark", model, author: "gpt-6.1-sol", quality: "low", imageSize: "1536x1024", background: "transparent" });
      expect(request.url).toBe("https://fal.run/openai/gpt-image-2.6/flare/text-to-image");
      expect(request.model).toBe("openai/gpt-image-2.6-flare");
      expect(request.body).toMatchObject({ quality: "low", image_size: { width: 1536, height: 1024 }, background: "transparent", provider_options: { svg: { model: "gpt-6.1-sol" } } });
    }
    expect(buildSvgRequest({ prompt: "x" })).not.toHaveProperty("body.background");
  });

  test("GPT authors before GPT-6 are refused before any request", async () => {
    for (const author of ["gpt-5.4", "gpt-5.5", "gpt-5.5-mini", "GPT-4o", "gpt-5"]) {
      expect(() => buildSvgRequest({ prompt: "x", author })).toThrow(/before GPT-6 are not used/);
    }
    for (const author of ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-7"]) {
      expect(buildSvgRequest({ prompt: "x", author }).body.provider_options).toEqual({ svg: { model: author } });
    }
    const fal = fakeFal();
    await expect(generateSvg({ prompt: "x", author: "gpt-5.4", apiKey: "k", outputDir: freshDir() }, { fetchImpl: fal.fetchImpl })).rejects.toThrow(/before GPT-6/);
    expect(fal.calls).toHaveLength(0);
  });

  test("fal's published size limits and enums are enforced before a request", () => {
    // Multiples of 16, longest edge <= 3840, aspect <= 3:1, 655,360..8,294,400 pixels.
    expect(buildSvgRequest({ prompt: "x", imageSize: "3840x2160" }).body.image_size).toEqual({ width: 3840, height: 2160 });
    expect(buildSvgRequest({ prompt: "x", imageSize: "1024X768" }).body.image_size).toEqual({ width: 1024, height: 768 });
    for (const [imageSize, reason] of [["1000x1000", "multiples of 16"], ["4096x1024", "at most 3840"], ["3008x992", "3:1"], ["512x512", "total pixels"], ["3840x3840", "total pixels"], ["square", "expected WxH"]]) {
      expect(() => buildSvgRequest({ prompt: "x", imageSize })).toThrow(reason);
    }
    expect(() => buildSvgRequest({ prompt: "x", quality: "xhigh" })).toThrow("--quality");
    expect(() => buildSvgRequest({ prompt: "x", background: "white" })).toThrow("--background");
    expect(() => buildSvgRequest({ prompt: "x", model: "gpt-image-2.5-flare" })).toThrow("--model");
    expect(() => buildSvgRequest({ prompt: "x", author: "gpt 5" })).toThrow("--author");
    expect(() => buildSvgRequest({ prompt: " " })).toThrow("prompt");
    expect(() => buildSvgRequest({ prompt: "x".repeat(32001) })).toThrow("32000");
  });
});

describe("what the SVG is", () => {
  test("a hand-authored icon set reads as pure vector with its counts, title and colours", () => {
    const report = inspectSvg(ICONS, { palette: "#254F42, #F57843" });
    expect(report).toMatchObject({
      viewBox: "0 0 1024 1024", width: "1024", height: "1024",
      title: "Note-taking app line icons", desc: "Outlined icons: search & share.",
      elements: { total: 10, byTag: { svg: 1, title: 1, desc: 1, g: 3, circle: 2, line: 2 } },
      vector: { pure: true, imageElements: 0, rasterDataUris: 0, externalRefs: 0 },
      text: { elements: 0, fonts: [] },
      colors: ["#254f42"], offPalette: [], background: null,
      activeContent: { scripts: 0, eventHandlers: 0, foreignObjects: 0, embeds: 0, scriptUrls: 0, entities: 0 },
      warnings: [],
    });
    expect(inspectSvg(ICONS)).not.toHaveProperty("offPalette");
  });

  test("embedded raster, lettering, external references and active content are each called out", () => {
    const report = inspectSvg(`<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAAA" width="10" height="10"/><image href="https://example.com/a.png"/><text x="1" y="5" font-family="Inter, sans-serif">MORROW</text><g onload="x()"><script>x()</script></g></svg>`);
    expect(report.vector).toEqual({ pure: false, imageElements: 2, rasterDataUris: 1, externalRefs: 1 });
    expect(report.text).toEqual({ elements: 1, fonts: ["Inter, sans-serif"] });
    expect(report.activeContent).toEqual({ scripts: 1, eventHandlers: 1, foreignObjects: 0, embeds: 0, scriptUrls: 0, entities: 0 });
    const warnings = report.warnings.join("\n");
    expect(warnings).toContain("not a true vector");
    expect(warnings).toContain("external URL");
    expect(warnings).toContain("<text>");
    expect(warnings).toContain("active content");
  });

  test("every way an SVG can run code is counted — the count is the distribution gate, so it may over-count but never miss", () => {
    const active = (body: string) => inspectSvg(`<svg viewBox="0 0 10 10">${body}</svg>`).activeContent;
    const total = (body: string) => Object.values(active(body)).reduce((a, n) => a + n, 0);
    // A handler after a quoted value holding '>' (the old scan stopped there).
    expect(active(`<g title="a>b" onclick="x()"><path d="M0 0"/></g>`).eventHandlers).toBeGreaterThanOrEqual(1);
    expect(active(`<path d="M0 0"/><svg/onload=alert(1)><path d="M0 0"/></svg>`).eventHandlers).toBeGreaterThanOrEqual(1);
    // Script URLs, however the attribute is spelled or encoded.
    for (const link of [
      `<a href="javascript:alert(1)"><path d="M0 0"/></a>`,
      `<a xlink:href="javascript:alert(1)"><path d="M0 0"/></a>`,
      `<a href=" JavaScript:alert(1)"><path d="M0 0"/></a>`,
      `<a href="&#106;avascript:alert(1)"><path d="M0 0"/></a>`,
      `<a href="java&#x09;script:alert(1)"><path d="M0 0"/></a>`,
      `<a><set attributeName="href" to="javascript:alert(1)"/><path d="M0 0"/></a>`,
    ]) {
      expect(active(link).scriptUrls).toBeGreaterThanOrEqual(1);
    }
    // Elements, in any case and with a namespace prefix.
    expect(active(`<SCRIPT>alert(1)</SCRIPT>`).scripts).toBeGreaterThanOrEqual(1);
    expect(active(`<svg:script>alert(1)</svg:script>`).scripts).toBeGreaterThanOrEqual(1);
    expect(active(`<foreignobject><div/></foreignobject>`).foreignObjects).toBeGreaterThanOrEqual(1);
    for (const tag of ["iframe", "embed", "object", "IFRAME"]) {
      expect(active(`<${tag} src="x"></${tag}>`).embeds).toBeGreaterThanOrEqual(1);
    }
    // An internal DTD entity hides markup from the text: a browser opening
    // the file as SVG expands it into a live element.
    for (const value of [
      "&#60;script&#62;alert(1)&#60;/script&#62;",
      "&#x3c;foreignObject&#x3e;&#x3c;iframe src='x'/&#x3e;&#x3c;/foreignObject&#x3e;",
      "&#60;iframe src='x'&#62;&#60;/iframe&#62;",
    ]) {
      const report = inspectSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "${value}">]><svg viewBox="0 0 10 10">&x;</svg>`);
      expect(Object.values(report.activeContent).reduce((a, n) => a + n, 0)).toBeGreaterThanOrEqual(1);
      expect(report.activeContent.entities).toBe(1);
      expect(report.warnings.join("\n")).toContain("active content");
    }
    // And a drawing with none of it counts nothing, with words that only look close.
    expect(total(`<title>Icons based on a grid</title><desc>javascript-free; one onion</desc><g fill="none" stroke="#000"><path d="M0 0"/></g>`)).toBe(0);
    const warned = inspectSvg(`<svg viewBox="0 0 10 10"><a href="javascript:x()"><path d="M0 0"/></a></svg>`).warnings.join("\n");
    expect(warned).toContain("active content");
    expect(warned).toContain("javascript:");
  });

  test("colours from attributes, inline styles and <style> are normalised; non-paints are not colours", () => {
    const svg = `<svg viewBox="0 0 10 10"><style>.a{stroke:#F57843}</style><defs><linearGradient id="g"><stop stop-color="rgb(255, 0, 0)"/></linearGradient></defs>
      <path fill="#FFF" d="M0 0"/><path style="fill:#254F42;stroke:none" d="M0 0"/><path fill="url(#g)" stroke="currentColor" d="M0 0"/><path fill="rebeccapurple" d="M0 0"/></svg>`;
    const report = inspectSvg(svg, { palette: ["#f57843", "#254F42", "#FFFFFF"] });
    expect(report.colors.sort()).toEqual(["#254f42", "#f57843", "#ff0000", "#ffffff", "rebeccapurple"]);
    expect(report.offPalette!.sort()).toEqual(["#ff0000", "rebeccapurple"]);
    expect(report.warnings.join("\n")).toContain("outside the palette: ");
    expect(normalizeColor("#abcd")).toBe("#aabbcc");
    expect(normalizeColor("#11223344")).toBe("#112233");
    expect(normalizeColor("rgba(100%, 0%, 50%, 0.5)")).toBe("#ff0080");
    expect(normalizeColor("black")).toBe("#000000");
    expect(normalizeColor("none")).toBeNull();
    expect(() => inspectSvg(ICONS, { palette: "persimmon" })).toThrow("--palette");
  });

  test("a full-canvas first rect is the file's own background; a clip-path rect is not", () => {
    expect(inspectSvg(`<svg viewBox="0 0 1024 1024"><rect x="0" y="0" width="1024" height="1024" fill="#f3ead8"/><path d="M0 0"/></svg>`).background).toBe("#f3ead8");
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><rect width="100%" height="100%" fill="url(#glow)"/></svg>`).background).toBe("url(#glow)");
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><g fill="#123456"><rect width="100" height="50"/></g></svg>`).background).toBe("inherited fill");
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><clipPath id="c"><rect width="100" height="50"/></clipPath><path d="M0 0"/></svg>`).background).toBeNull();
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><rect width="40" height="50" fill="#000"/></svg>`).background).toBeNull();
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><rect width="100" height="50" fill="none"/></svg>`).background).toBeNull();
    expect(inspectSvg(`<svg viewBox="0 0 100 50"><rect width="100" height="50" fill="#f9f6ee"/></svg>`).warnings.join("\n")).toContain("not transparent");
  });

  test("only a complete SVG document passes; a prolog before the root is allowed", () => {
    expect(inspectSvg(`﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>\n<!-- end -->\n`).elements.byTag.path).toBe(1);
    expect(() => inspectSvg(PNG)).toThrow("received PNG image bytes");
    expect(() => inspectSvg("<html><body><svg></svg></body></html>")).toThrow("root element is <html>");
    expect(() => inspectSvg(`<svg viewBox="0 0 1 1"><path d="M0 0"/>`)).toThrow("never closed");
    expect(() => inspectSvg(`<svg viewBox="0 0 1 1"/>`)).toThrow("never closed");
    expect(() => inspectSvg("")).toThrow("empty");
    expect(() => inspectSvg("Invalid request")).toThrow("not markup");
    expect(inspectSvg(`<svg><path d="M0 0"/></svg>`).warnings).toContain("has no viewBox — it will not scale predictably");
  });
});

describe("one paid run", () => {
  test("submits once, verifies, writes the SVG and reports what it is and what it cost", async () => {
    const fal = fakeFal();
    const notes: string[] = [];
    const outputDir = freshDir();
    const result = await generateSvg(
      { prompt: "Two line icons in forest green", apiKey: "fixture-key", outputDir, filenamePrefix: "icons", palette: "#254F42", onNote: (m) => notes.push(m) },
      { fetchImpl: fal.fetchImpl },
    );
    expect(fal.posts()).toHaveLength(1);
    expect(fal.posts()[0]).toMatchObject({ url: SUNBURST_QUEUE, auth: "Key fixture-key", body: buildSvgRequest({ prompt: "Two line icons in forest green" }).body });
    const path = join(outputDir, "icons.svg");
    expect(readFileSync(path, "utf8")).toBe(ICONS);
    expect(readdirSync(outputDir)).toEqual(["icons.svg"]);
    expect(result).toMatchObject({
      backend: "fal", model: "openai/gpt-image-2.6-sunburst", author: "gpt-6.1-terra",
      endpoint: "https://fal.run/openai/gpt-image-2.6/sunburst/text-to-image",
      requestId: "req-svg-1", quality: "medium", imageSize: "1024x1024",
      files: [path], urls: ["https://cdn.test/a.svg"],
      report: { vector: { pure: true }, colors: ["#254f42"], offPalette: [], warnings: [] },
      cost: { usd: null, basis: "unknown" },
    });
    expect(notes.join("\n")).toContain("typically ≈50–80 s");
    expect(notes.join("\n")).not.toContain("NOTE:");
  });

  test("an unmeasured GPT-6 author is sent, after a note that its quality is unknown", async () => {
    const fal = fakeFal();
    const notes: string[] = [];
    await generateSvg({ prompt: "x", author: "gpt-6.1-sol", apiKey: "k", outputDir: freshDir(), onNote: (m) => notes.push(m) }, { fetchImpl: fal.fetchImpl });
    expect(fal.posts()[0].body?.provider_options).toEqual({ svg: { model: "gpt-6.1-sol" } });
    expect(notes.join("\n")).toContain("NOTE: author gpt-6.1-sol is not one of the measured ones");
    expect(notes.join("\n")).toContain("about a minute");
  });

  test("an unmeasured author is sent as given, with a note", async () => {
    const fal = fakeFal();
    const notes: string[] = [];
    await generateSvg({ prompt: "x", author: "gpt-7", apiKey: "k", outputDir: freshDir(), onNote: (m) => notes.push(m) }, { fetchImpl: fal.fetchImpl });
    expect(fal.posts()[0].body?.provider_options).toEqual({ svg: { model: "gpt-7" } });
    expect(notes.join("\n")).toContain("gpt-7 is not one of the measured ones");
  });

  test("a result that is not an SVG is refused with its request id and nothing is saved", async () => {
    for (const svg of [PNG, "<html>error</html>"]) {
      const fal = fakeFal({ svg });
      const outputDir = freshDir();
      const error = await generateSvg({ prompt: "x", apiKey: "k", outputDir, onNote: () => {} }, { fetchImpl: fal.fetchImpl }).then(() => null, (e) => e);
      expect(error?.requestId).toBe("req-svg-1");
      expect(error?.message).toContain("nothing was saved");
      expect(existsSync(join(outputDir, "vector.svg"))).toBe(false);
    }
    const empty = await generateSvg({ prompt: "x", apiKey: "k", outputDir: freshDir(), onNote: () => {} }, { fetchImpl: fakeFal({ images: [] }).fetchImpl }).then(() => null, (e) => e);
    expect(empty?.message).toContain("no SVG URL");
    expect(empty?.requestId).toBe("req-svg-1");
  });

  test("a refused submit is reported once and never resent", async () => {
    const fal = fakeFal({ submitStatus: 422 });
    const outputDir = freshDir();
    await expect(generateSvg({ prompt: "x", apiKey: "k", outputDir, onNote: () => {} }, { fetchImpl: fal.fetchImpl })).rejects.toThrow("HTTP 422");
    expect(fal.posts()).toHaveLength(1);
    expect(existsSync(outputDir)).toBe(false);
  });

  test("a file that appears at the target while the job runs is never replaced; the paid result is kept beside it", async () => {
    // Two runs with one prefix both pass the pre-payment check. The one that
    // lands second must not replace the first: its bytes are kept elsewhere.
    const outputDir = freshDir();
    const target = join(outputDir, "mark.svg");
    const fal = fakeFal();
    const racing = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "https://cdn.test/a.svg") {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(target, "the other run's mark");
      }
      return fal.fetchImpl(input, init);
    }) as typeof fetch;
    const error = await generateSvg({ prompt: "x", apiKey: "k", outputDir, filenamePrefix: "mark", onNote: () => {} }, { fetchImpl: racing })
      .then(() => null, (e) => e);
    expect(readFileSync(target, "utf8")).toBe("the other run's mark");
    expect(error?.requestId).toBe("req-svg-1");
    expect(error?.message).toContain("https://cdn.test/a.svg");
    expect(error?.message).toContain("do not resubmit");
    const kept = readdirSync(outputDir).filter((name) => name !== "mark.svg");
    expect(kept).toHaveLength(1);
    expect(error?.message).toContain(join(outputDir, kept[0]));
    expect(readFileSync(join(outputDir, kept[0]), "utf8")).toBe(ICONS);
  });

  test("an existing target, a missing key or a bad option stops it before any request", async () => {
    const outputDir = freshDir();
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "mark.svg"), "approved");
    const fal = fakeFal();
    await expect(generateSvg({ prompt: "x", apiKey: "k", outputDir, filenamePrefix: "mark" }, { fetchImpl: fal.fetchImpl })).rejects.toThrow("already exists");
    expect(readFileSync(join(outputDir, "mark.svg"), "utf8")).toBe("approved");
    await expect(generateSvg({ prompt: "x", apiKey: "", outputDir }, { fetchImpl: fal.fetchImpl })).rejects.toThrow("FAL_KEY");
    await expect(generateSvg({ prompt: "x", apiKey: "k", outputDir, palette: "green" }, { fetchImpl: fal.fetchImpl })).rejects.toThrow("--palette");
    await expect(generateSvg({ prompt: "x", apiKey: "k", outputDir, filenamePrefix: "../escape" }, { fetchImpl: fal.fetchImpl })).rejects.toThrow("--filename-prefix");
    expect(fal.calls).toHaveLength(0);
  });

  test("the cost line says unknown, why, and fal's list price — never a figure", () => {
    const line = costLine(svgCost({ author: "gpt-6.1-terra" }));
    expect(line).toStartWith("cost: unknown (");
    expect(line).toContain("gpt-6.1-terra authoring pass");
    expect(line).toContain("reports no usage");
    expect(line).toContain("image output at $30 per 1M tokens");
    expect(line).not.toMatch(/≈/);
  });
});

describe("the installed CLI", () => {
  // Exactly what a mode whitelists: the script and the queue runner it imports.
  const installed = join(workspace, "skill", "scripts");
  mkdirSync(installed, { recursive: true });
  for (const script of ["generate_svg.mjs", "fal-queue.mjs"]) copyFileSync(join(import.meta.dir, "..", script), join(installed, script));
  const preload = join(workspace, "fal-fixture.mjs");
  writeFileSync(preload, `import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  appendFileSync(process.env.SVG_TEST_LOG, JSON.stringify({ url, method: init.method ?? "GET", body: init.body ?? null }) + "\\n");
  if (init.method === "POST") return Response.json({ request_id: "req-cli", status_url: "https://queue.test/req/status", response_url: "https://queue.test/req", cancel_url: "https://queue.test/req/cancel" });
  if (url.startsWith("https://queue.test/req/status")) return Response.json({ status: "COMPLETED" });
  if (url === "https://queue.test/req") return Response.json({ images: [{ url: "https://cdn.test/a.svg", content_type: "image/svg+xml" }] });
  if (url === "https://cdn.test/a.svg") return new Response(${JSON.stringify(ICONS)});
  throw new Error("unexpected " + url);
};`);
  let run = 0;
  function cli(args: string[], key = "fixture-key") {
    const log = join(workspace, `cli-${++run}.log`);
    const child = Bun.spawnSync([process.execPath, "--env-file=/dev/null", "--preload", preload, join(installed, "generate_svg.mjs"), ...args], {
      cwd: workspace,
      env: { PATH: process.env.PATH ?? "", FAL_KEY: key, OPENROUTER_API_KEY: "openrouter-only", SVG_TEST_LOG: log },
      stdout: "pipe", stderr: "pipe",
    });
    const requests = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString(), requests };
  }

  test("a run prints one JSON object on stdout and the cost line on stderr", () => {
    const outputDir = join(workspace, "cli-out");
    const result = cli(["Two line icons", "--output-dir", outputDir, "--filename-prefix", "icons", "--palette", "#254F42", "--model", "flare", "--quality", "low", "--author", "gpt-6.1-sol"]);
    expect(result.code).toBe(0);
    const json = JSON.parse(result.out);
    expect(json).toMatchObject({ backend: "fal", model: "openai/gpt-image-2.6-flare", author: "gpt-6.1-sol", quality: "low", requestId: "req-cli", files: [join(outputDir, "icons.svg")], report: { offPalette: [] } });
    expect(result.err).toContain("cost: unknown (");
    const posts = result.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://queue.fal.run/openai/gpt-image-2.6/flare/text-to-image");
    expect(JSON.parse(posts[0].body)).toMatchObject({ output_format: "svg", quality: "low", provider_options: { svg: { model: "gpt-6.1-sol" } } });
    expect(result.err).toContain("not one of the measured ones");
    expect(readFileSync(join(outputDir, "icons.svg"), "utf8")).toBe(ICONS);
  });

  test("--help documents the flags; a missing key or prompt fails before any request", () => {
    const help = cli(["--help"]);
    expect(help.code).toBe(0);
    for (const flag of ["--model", "--author", "--quality", "--image-size", "--background", "--palette", "--output-dir", "--filename-prefix", "gpt-6.1-terra", "before GPT-6"]) {
      expect(help.err).toContain(flag);
    }
    const noKey = cli(["x", "--output-dir", join(workspace, "no-key")], "");
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY not found");
    expect(noKey.requests).toEqual([]);
    const noPrompt = cli([]);
    expect(noPrompt.code).toBe(1);
    expect(noPrompt.err).toContain("the prompt is the one positional argument");
    expect(cli(["x", "--prompt", "y"]).code).toBe(1);
  });
});
