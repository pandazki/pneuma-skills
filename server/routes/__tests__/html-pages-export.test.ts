import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildHtmlPagesExport } from "../html-pages-export.js";

test("shared export keeps copy as data in HTML and scripts, with caller-owned routes", () => {
  const title = `A 'brand' </script><script>alert(1)</script>`;
  const { html } = buildHtmlPagesExport({ title, contentSet: 'a "quoted" project',
    downloadRoute: "/export/fixture/file", zipRoute: "/export/fixture/zip",
    pageContents: [{ file: "book.html", title, html: "<!doctype html><h1>ARTIFACT</h1>" }] });
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  try {
    window.document.write(html);
    expect(window.document.querySelector("h1")?.textContent).toBe(title);
    expect(window.document.querySelector("base")?.getAttribute("href")).toBe('/content/a%20%22quoted%22%20project/');
    const scripts = Array.from(window.document.scripts).filter((s) => !s.src);
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(() => new Function(script.textContent!)).not.toThrow();
    expect(html).toContain('fetch("/export/fixture/file"');
    expect(html).toContain('window.open("/export/fixture/zip"');
    expect(html).not.toContain("/export/webcraft/");
    expect(window.document.querySelector("#print-btn")?.textContent).toBe("Print / Save PDF");
    expect(window.document.querySelector("#screenshot-btn")?.textContent).toBe("Screenshot PNG");
  } finally { window.happyDOM.abort(); }
});
