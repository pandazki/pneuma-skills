import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import {
  LAUNCHER_SKELETON_BOOT_SCRIPT,
  LAUNCHER_SKELETON_TEMPLATE_ID,
  launcherSkeletonIndexTags,
  launcherSkeletonMarkup,
  launcherSkeletonPage,
} from "../launcher-skeleton.js";
import { LAUNCHER_SKELETON_PERIOD_MS, LauncherPageSkeleton } from "../../src/components/LauncherSkeleton.js";
import { readEntryParams } from "../../src/launcher-route.js";
import { resolveInitialTheme } from "../../src/hooks/useAppTheme.js";

/** Run a page script with a happy-dom window's globals, as the browser would during parsing. */
function runScript(win: Window, script: string) {
  const scope = win as unknown as Record<string, unknown>;
  new Function("window", "document", "location", "localStorage", "matchMedia", script)(
    win, win.document, win.location, win.localStorage, (query: string) => win.matchMedia(query),
  );
  return scope;
}

function indexPage(url: string, options: { saved?: string | null; scheme?: "light" | "dark"; desktop?: boolean } = {}) {
  const win = new Window({ url, settings: { device: { prefersColorScheme: options.scheme ?? "dark" } } });
  if (options.saved) win.localStorage.setItem("pneuma-launcher-theme", options.saved);
  if (options.desktop) (win as unknown as Record<string, unknown>).pneumaDesktop = {};
  win.document.body.innerHTML = `<div id="root"></div><template id="${LAUNCHER_SKELETON_TEMPLATE_ID}">${launcherSkeletonMarkup()}</template>`;
  runScript(win, LAUNCHER_SKELETON_BOOT_SCRIPT);
  return { win, page: win.document.querySelector("#root > [data-launcher-skeleton=\"page\"]") };
}

describe("launcher skeleton boot script", () => {
  test("shows the skeleton exactly where App opens the launcher", async () => {
    const searches = ["", "?launcher=1", "?session=abc", "?mode=doc", "?session=abc&launcher", "?project=%2Fwork%2Fsite",
      "?project=", "?project=%2Fwork&session=s1", "?project=%2Fwork&launcher=1", "?importUrl=https%3A%2F%2Fexample.com", "?surface=chat&session=s"];
    for (const search of searches) {
      const { win, page } = indexPage(`http://localhost:17996/${search}`);
      expect({ search, shown: page !== null }).toEqual({ search, shown: readEntryParams(search).opensLauncher });
      await win.happyDOM.close();
    }
  });

  test("applies the theme the launcher will render with before the server answers", async () => {
    for (const saved of [null, "light", "dark", "system", "sepia"]) {
      for (const scheme of ["light", "dark"] as const) {
        const { win, page } = indexPage("http://localhost:17996/", { saved, scheme });
        const globals = globalThis as unknown as Record<string, unknown>;
        const previous = { localStorage: globals.localStorage, window: globals.window };
        globals.localStorage = win.localStorage;
        globals.window = win;
        try {
          expect({ saved, scheme, light: page!.classList.contains("cc-theme-light") })
            .toEqual({ saved, scheme, light: resolveInitialTheme() === "light" });
        } finally {
          globals.localStorage = previous.localStorage;
          globals.window = previous.window;
          await win.happyDOM.close();
        }
      }
    }
  });

  test("the booted static page matches the React fallback the launcher route renders next", async () => {
    const { win, page } = indexPage("http://localhost:17996/", { saved: "light", desktop: true });
    const host = win.document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(LauncherPageSkeleton, { light: true, desktop: true }));
    const fallback = host.querySelector("[data-launcher-skeleton=\"page\"]")!;
    expect(new Set(page!.className.split(/\s+/).filter(Boolean))).toEqual(new Set(fallback.className.split(/\s+/).filter(Boolean)));
    expect(page!.hasAttribute("data-desktop")).toBe(true);
    expect(page!.innerHTML).toBe(fallback.innerHTML);
    const delay = Number.parseInt((page as unknown as HTMLElement).style.getPropertyValue("--launcher-skeleton-delay"), 10);
    expect(delay).toBeLessThanOrEqual(0);
    expect(delay).toBeGreaterThan(-LAUNCHER_SKELETON_PERIOD_MS);
    await win.happyDOM.close();
  });

  test("leaves an already rendered root alone", async () => {
    const win = new Window({ url: "http://localhost:17996/" });
    win.document.body.innerHTML = `<div id="root"><p>app</p></div><template id="${LAUNCHER_SKELETON_TEMPLATE_ID}">${launcherSkeletonMarkup()}</template>`;
    runScript(win, LAUNCHER_SKELETON_BOOT_SCRIPT);
    expect(win.document.getElementById("root")!.innerHTML).toBe("<p>app</p>");
    await win.happyDOM.close();
  });
});

describe("launcher skeleton build outputs", () => {
  test("index.html receives the template, its boot script and the wordmark font preload", () => {
    const tags = launcherSkeletonIndexTags();
    expect(tags.map((tag) => `${tag.tag}:${tag.injectTo}`)).toEqual(["link:head", "template:body", "script:body"]);
    expect(tags[1].children).toContain('data-launcher-skeleton="page"');
    for (const section of ["featured", "projects", "sessions", "modes"]) expect(tags[1].children).toContain(`data-launcher-skeleton="${section}"`);
    const font = (tags[0].attrs as { href: string }).href;
    expect(readFileSync(join(import.meta.dir, "../../public", font)).byteLength).toBeGreaterThan(0);
  });

  test("the desktop page resolves its assets beside it and takes the theme from its query", async () => {
    const html = launcherSkeletonPage(`@font-face{src:url(/fonts/a.woff2)}.x{background:url("/logo.png")}.y{background:url(data:image/png;base64,AA)}`);
    expect(html).toContain("url(./fonts/a.woff2)");
    expect(html).toContain('url("./logo.png")');
    expect(html).toContain("url(data:image/png;base64,AA)");
    expect(html).toContain('src="./logo.png"');
    expect(html).not.toContain("<script type=\"module\"");
    const head = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    for (const [theme, light] of [["light", true], ["dark", false]] as const) {
      const win = new Window({ url: `file:///Applications/Pneuma/dist/launcher-skeleton.html?theme=${theme}` });
      (win as unknown as Record<string, unknown>).pneumaDesktop = {};
      runScript(win, head);
      expect(win.document.documentElement.classList.contains("cc-theme-light")).toBe(light);
      expect(win.document.documentElement.hasAttribute("data-desktop")).toBe(true);
      await win.happyDOM.close();
    }
  });

  test("the stylesheet sweep period is the one the phase is computed from", () => {
    const css = readFileSync(join(import.meta.dir, "../../src/index.css"), "utf8");
    expect(css).toContain(`animation: launcherSkeletonSweep ${LAUNCHER_SKELETON_PERIOD_MS}ms linear infinite`);
  });
});
