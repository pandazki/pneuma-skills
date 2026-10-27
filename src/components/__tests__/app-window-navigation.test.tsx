/** @jsxImportSource react */
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AppWindowRequest } from "../../../core/types/desktop-window.js";

if (process.env.PNEUMA_APP_WINDOW_UI_TEST !== "1") {
  test("app-owned window controls dispatch explicitly and preserve browser links", async () => {
    const proc = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PNEUMA_APP_WINDOW_UI_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
  let win: Window;
  let host: HTMLElement;
  let root: import("react-dom/client").Root;
  let act: typeof import("react").act;
  let createElement: typeof import("react").createElement;
  let nativeRequests: AppWindowRequest[];
  let browserRequests: unknown[][];
  let rejection: Error | undefined;

  beforeAll(async () => {
    win = new Window({ url: "http://localhost:17007/", settings: { disableIframePageLoading: true } });
    for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MouseEvent", "ResizeObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
      Reflect.set(globalThis, key, Reflect.get(win, key));
    }
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    ({ act, createElement } = await import("react"));
    const i18n = (await import("i18next")).default;
    await i18n.use((await import("react-i18next")).initReactI18next).init({ lng: "en", resources: {} });
    mock.module("../../i18n/index.js", () => ({ default: i18n }));
  });
  beforeEach(async () => {
    nativeRequests = []; browserRequests = []; rejection = undefined;
    window.pneumaDesktop = { openAppWindow: async (request) => { nativeRequests.push(request); if (rejection) throw rejection; } };
    win.open = (...args) => { browserRequests.push(args); return null; };
    host = document.createElement("div"); document.body.append(host);
    root = (await import("react-dom/client")).createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  afterAll(async () => { await win.happyDOM.close(); });

  test("helper resolves destinations and preserves hidden-session parameters", async () => {
    const { openAppWindow } = await import("../../utils/window-navigation.js");
    await openAppWindow({ kind: "session", url: "/?background=1&borrow=abc" });
    await openAppWindow({ kind: "export", url: "/export/webcraft?contentSet=a%2Fb" });
    expect(nativeRequests).toEqual([
      { kind: "session", url: "http://localhost:17007/?background=1&borrow=abc" },
      { kind: "export", url: "http://localhost:17007/export/webcraft?contentSet=a%2Fb" },
    ]);
    expect(browserRequests).toEqual([]);
  });

  test("browser helper opens synchronously and accepts noopener's null return", async () => {
    delete window.pneumaDesktop;
    const { openAppWindow } = await import("../../utils/window-navigation.js");
    const opened = openAppWindow({ kind: "export", url: "/export/slides" });
    expect(browserRequests).toEqual([["http://localhost:17007/export/slides", "_blank", "noopener,noreferrer"]]);
    await opened;
  });

  test("bridge rejection never falls back to browser window creation", async () => {
    rejection = new Error("Native window refused");
    const { openAppWindow } = await import("../../utils/window-navigation.js");
    await expect(openAppWindow({ kind: "session", url: "/" })).rejects.toThrow("Native window refused");
    expect(browserRequests).toEqual([]);
  });

  const project = { id: "project", root: "/work/a b", name: "a", displayName: "Project A", lastAccessed: 0, createdAt: 0, sessionCount: 0, modeBreakdown: [] };
  for (const variant of ["featured", "compact"] as const) {
    test(`${variant} project link handles desktop click, modifiers, keyboard activation and middle click`, async () => {
      const { ProjectCard } = await import("../ProjectCard.js");
      await act(async () => root.render(createElement(ProjectCard, { project, variant, homeDir: "/work" })));
      const link = host.querySelector("a")!;
      expect(link.getAttribute("href")).toBe("/?project=%2Fwork%2Fa%20b");
      for (const init of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { detail: 0 }, { button: 1 }]) {
        const event = new MouseEvent(init.button === 1 ? "auxclick" : "click", { bubbles: true, cancelable: true, ...init });
        await act(async () => { link.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(true);
      }
      expect(nativeRequests).toHaveLength(6);
      expect(nativeRequests.every((request) => request.kind === "session" && request.url === "http://localhost:17007/?project=%2Fwork%2Fa%20b")).toBe(true);
      expect(browserRequests).toEqual([]);
      const rightClick = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
      await act(async () => { link.dispatchEvent(rightClick); });
      expect(rightClick.defaultPrevented).toBe(false);
      expect(nativeRequests).toHaveLength(6);
      rejection = new Error("Project window refused");
      await act(async () => { link.click(); });
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Project window refused");
      expect(browserRequests).toEqual([]);
    });

    test(`${variant} project link leaves ordinary browser navigation intact`, async () => {
      delete window.pneumaDesktop;
      const { ProjectCard } = await import("../ProjectCard.js");
      await act(async () => root.render(createElement(ProjectCard, { project, variant, homeDir: "/work" })));
      const link = host.querySelector("a")!;
      for (const init of [{}, { metaKey: true }, { button: 1 }]) {
        const event = new MouseEvent(init.button === 1 ? "auxclick" : "click", { bubbles: true, cancelable: true, ...init });
        let defaultPrevented = true;
        host.addEventListener(event.type, (e) => { defaultPrevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
        await act(async () => { link.dispatchEvent(event); });
        expect(defaultPrevented).toBe(false);
      }
      expect(link.target).toBe("_blank");
      expect(nativeRequests).toEqual([]);
      expect(browserRequests).toEqual([]);
    });
  }

  test("Webcraft export button uses the shared viewer callback and displays native failure", async () => {
    const { useStore } = await import("../../store.js");
    const { useViewerProps } = await import("../../hooks/useViewerProps.js");
    const WebPreview = (await import("../../../modes/webcraft/viewer/WebPreview.js")).default;
    const manifest = (await import("../../../modes/webcraft/manifest.js")).default;
    const previous = useStore.getState();
    useStore.setState({ modeManifest: manifest, activeContentSet: "site one", staticPlayer: true });
    function Viewer() { return createElement(WebPreview, { ...useViewerProps({ theme: "dark", locale: "en" }), readonly: false }); }
    try {
      await act(async () => root.render(createElement(Viewer)));
      const exportButton = host.querySelector<HTMLButtonElement>('button[title*="Export"]');
      expect(exportButton).not.toBeNull();
      await act(async () => { exportButton!.click(); });
      expect(nativeRequests).toEqual([{ kind: "export", url: "http://localhost:17007/export/webcraft?contentSet=site%20one" }]);
      rejection = new Error("Export window refused");
      await act(async () => { exportButton!.click(); });
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Export window refused");
      expect(browserRequests).toEqual([]);
    } finally { await act(async () => root.unmount()); useStore.setState(previous); }
  });
  for (const mode of ["slide", "kami", "eli5", "brand", "remotion"] as const) {
    test(`${mode} export control opens an app export window and reports rejection`, async () => {
      const { MemorySource } = await import("../../../core/sources/memory.js");
      const { BrowserFileChannel } = await import("../../runtime/file-channel.js");
      const { useStore } = await import("../../store.js");
      const previous = useStore.getState();
      useStore.setState({ activeContentSet: "site one", staticPlayer: false });
      const previews = {
        slide: () => import("../../../modes/slide/viewer/SlidePreview.js"),
        kami: () => import("../../../modes/kami/viewer/KamiPreview.js"),
        eli5: () => import("../../../modes/eli5/viewer/Eli5Preview.js"),
        brand: () => import("../../../modes/brand/viewer/BrandPreview.js"),
        remotion: () => import("../../../modes/remotion/viewer/RemotionPreview.js"),
      };
      const Preview = (await previews[mode]()).default;
      const sources: import("../../../core/types/viewer-contract.js").ViewerPreviewProps["sources"] = {};
      if (mode === "eli5") sources.explainer = new MemorySource({ initial: { byContentSet: { "site one": { title: "Topic", audiences: [] } } } });
      if (mode === "brand") {
        const { emptyProject } = await import("../../../modes/brand/skill/scripts/model.js");
        const { loadStudio } = await import("../../../modes/brand/domain.js");
        sources.studio = new MemorySource({ initial: loadStudio([{ path: "site one/brand.json", content: JSON.stringify(emptyProject()) }]) });
      }
      if (mode === "remotion") {
        sources.files = new MemorySource({ initial: [
          { path: "src/Root.tsx", content: 'import { Composition } from "remotion"; import { Demo } from "./Demo"; export const Root = () => <Composition id="Demo" component={Demo} durationInFrames={30} fps={30} width={320} height={180} />;' },
          { path: "src/Demo.tsx", content: 'export const Demo = () => <div>Demo</div>;' },
        ] });
      }
      try {
        await act(async () => root.render(createElement(Preview, {
          sources, fileChannel: new BrowserFileChannel(), selection: null, onSelect: () => {},
          mode: "view", imageVersion: 0, theme: "dark", locale: "en", readonly: false,
        })));
        if (mode === "remotion") await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
        const control = [...host.querySelectorAll<HTMLElement>("button, a")].find((el) => el.textContent?.trim().startsWith("Export") || el.title.startsWith("Export"));
        expect(control).toBeDefined();
        await act(async () => { control!.click(); });
        expect(nativeRequests).toHaveLength(1);
        expect(nativeRequests[0].kind).toBe("export");
        const destination = new URL(nativeRequests[0].url);
        expect(destination.pathname).toBe(`/export/${mode === "slide" ? "slides" : mode}`);
        if (mode === "remotion") expect(destination.searchParams.get("composition")).toBe("Demo");
        else expect(destination.searchParams.get("contentSet")).toBe("site one");
        rejection = new Error(`${mode} export refused`);
        await act(async () => { control!.click(); });
        expect(host.textContent).toContain(`${mode} export refused`);
        expect(browserRequests).toEqual([]);
      } finally { await act(async () => root.unmount()); useStore.setState(previous); }
    });
  }

}
