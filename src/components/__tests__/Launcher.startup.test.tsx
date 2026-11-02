/** @jsxImportSource react */
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

if (process.env.PNEUMA_LAUNCHER_STARTUP_UI_TEST !== "1") {
  test("Launcher progressively renders independent resources and keeps launch availability safe", async () => {
    const proc = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PNEUMA_LAUNCHER_STARTUP_UI_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
  let win: Window;
  let host: HTMLElement;
  let unmount: (() => Promise<void>) | undefined;
  let act: typeof import("react").act;
  let locale = "en";
  const routes = new Map<string, () => Promise<Response> | Response>();
  const requests: string[] = [];
  const signals = new Map<string, AbortSignal>();
  const registry = (name = "Local Board", state = "ready") => ({
    builtins: [{ name: "board", displayName: name, description: "A local mode", version: "1", type: "builtin" }],
    catalog: [], local: [], published: [], publishedStatus: { state },
  });
  const backends = { backends: [{ type: "codex", label: "Codex", description: "Codex", implemented: true, available: true }], defaultBackendType: "codex" };

  beforeAll(async () => {
    win = new Window({ url: "http://localhost/" });
    for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
      (globalThis as unknown as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
    }
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const { default: i18n } = await import("i18next");
    const { initReactI18next } = await import("react-i18next");
    await i18n.use(initReactI18next).init({
      lng: "en", fallbackLng: "en", interpolation: { escapeValue: false },
      resources: { en: { launcher: (await import("../../i18n/locales/en/launcher.json")).default } },
    });
    mock.module("../../i18n/index.js", () => ({
      default: i18n, SUPPORTED_LOCALES: ["en"], LOCALE_LABELS: { en: "English" },
      DEFAULT_LOCALE: "en", currentLocale: () => locale, persistLocale: async () => true,
    }));
    // WebGL drawing is unrelated to request ordering; keep the actual launcher,
    // cards, dialogs, data hook, and event handlers under test.
    mock.module("../reactbits/Galaxy", () => ({ default: () => null }));
    act = (await import("react")).act;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const key = url.pathname + url.search;
      requests.push(key);
      if (init?.signal) signals.set(key, init.signal);
      const handler = routes.get(key) ?? routes.get(url.pathname);
      if (handler) return handler();
      if (url.pathname === "/api/agent-commands") return Response.json({ promptDismissed: true, items: [] });
      if (url.pathname === "/api/workspace-check") return Response.json({ hasSession: false });
      if (url.pathname === "/api/launch/prepare") return Response.json({ initParams: [] });
      return Response.json({ theme: "dark", favorites: [], keys: [] });
    }) as typeof fetch;
  });
  beforeEach(() => {
    locale = "en";
    requests.length = 0;
    signals.clear();
    routes.clear();
    routes.set("/api/backends", () => Response.json(backends));
    routes.set("/api/registry", () => Response.json(registry()));
    routes.set("/api/sessions", () => Response.json({ sessions: [], homeDir: "/home/test" }));
    routes.set("/api/running", () => Response.json({ processes: [] }));
    routes.set("/api/projects", () => Response.json({ projects: [] }));
    routes.set("/api/libraries", () => Response.json({ libraries: [] }));
  });
  afterEach(async () => {
    await unmount?.();
    document.body.innerHTML = "";
  });
  afterAll(async () => { await win.happyDOM.close(); });

  async function mount() {
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: Launcher } = await import("../Launcher.js");
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = async () => { await act(async () => root.unmount()); };
    await act(async () => root.render(createElement(Launcher)));
  }
  async function click(element: Element) {
    await act(async () => { element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  }
  function button(text: string): HTMLButtonElement {
    const found = [...(host.querySelector('[role="dialog"]') ?? host).querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
    if (!found) throw new Error(`Button missing: ${text}`);
    return found;
  }

  test("local modes render with backend and community discovery pending; launch waits for verified availability", async () => {
    const backend = Promise.withResolvers<Response>();
    routes.set("/api/backends", () => backend.promise);
    routes.set("/api/registry", () => Response.json(registry("Local Board", "loading")));
    await mount();
    expect(host.textContent).toContain("Local Board");
    expect(host.querySelector("main")?.dataset.launcherLocalReady).toBe("true");
    expect(host.querySelector("main")?.dataset.launcherBackendsReady).toBe("false");
    expect(host.textContent).toContain("Checking community modes");
    const tile = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Local Board"))!;
    await click(tile);
    expect(button("Launch").disabled).toBe(true);
    expect(host.textContent).toContain("Checking available agents");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(requests.filter((path) => path === "/api/backends")).toHaveLength(1);
    expect(signals.get("/api/backends")?.aborted).toBe(false);
    await act(async () => backend.resolve(Response.json(backends)));
    expect(host.querySelector("main")?.dataset.launcherBackendsReady).toBe("true");
    expect(button("Launch").disabled).toBe(false);
    expect(requests.filter((path) => path === "/api/launch")).toHaveLength(0);
  });

  test("sessions display before modes or projects return, with independent failures and retries", async () => {
    const modes = Promise.withResolvers<Response>();
    routes.set("/api/registry", () => modes.promise);
    routes.set("/api/projects", () => new Response("unavailable", { status: 503 }));
    routes.set("/api/sessions", () => Response.json({ sessions: [{ id: "one", mode: "board", displayName: "Draft", sessionName: "My local draft", workspace: "/work/draft", backendType: "codex", lastAccessed: Date.now() }], homeDir: "/home/test" }));
    await mount();
    expect(host.textContent).toContain("My local draft");
    expect(host.textContent).toContain("Could not load projects");
    expect(host.textContent).not.toContain("No projects yet");
    routes.set("/api/projects", () => Response.json({ projects: [] }));
    await click(host.querySelector('[data-launcher-resource="projects"] button')!);
    expect(host.querySelector('[data-launcher-resource="projects"]')).toBeNull();
    await act(async () => modes.resolve(Response.json(registry())));
    expect(host.textContent).toContain("Local Board");
    expect(host.textContent).toContain("My local draft");
  });

  test("late locale results cannot replace the newest localized mode list", async () => {
    const en = Promise.withResolvers<Response>();
    routes.set("/api/registry?locale=en", () => en.promise);
    routes.set("/api/registry?locale=ja", () => Response.json(registry("Current Japanese Board", "loading")));
    await mount();
    locale = "ja";
    await act(async () => { window.dispatchEvent(new Event("pneuma:locale-changed")); });
    expect(host.textContent).toContain("Current Japanese Board");
    expect(signals.get("/api/registry?locale=en")?.aborted).toBe(true);
    await act(async () => en.resolve(Response.json(registry("Stale English Board"))));
    expect(host.textContent).toContain("Current Japanese Board");
    expect(host.textContent).not.toContain("Stale English Board");
  });

  test("failed resource refresh retains the last-good cards and an explicit error", async () => {
    await mount();
    routes.set("/api/registry", () => new Response("offline", { status: 503 }));
    await act(async () => { window.dispatchEvent(new Event("pneuma:libraries-updated")); });
    expect(host.textContent).toContain("Local Board");
    expect(host.textContent).toContain("Could not load local modes");
    routes.set("/api/registry", () => Response.json({ ...registry(), publishedStatus: { state: "error", error: "Offline" } }));
    await click(host.querySelector('[data-launcher-resource="modes"] button')!);
    expect(host.textContent).toContain("Community modes could not be refreshed");
    routes.set("/api/registry", () => Response.json(registry()));
    await click(host.querySelector('[data-launcher-resource="published"] button')!);
    expect(requests).toContain("/api/registry?locale=en&refreshPublished=1");
    expect(host.querySelector('[data-launcher-resource="published"]')).toBeNull();
  });

  test("unmount aborts pending launcher reads and does not schedule further requests", async () => {
    const backend = Promise.withResolvers<Response>();
    routes.set("/api/backends", () => backend.promise);
    await mount();
    expect(signals.get("/api/backends")?.aborted).toBe(false);
    await unmount?.();
    unmount = undefined;
    expect(signals.get("/api/backends")?.aborted).toBe(true);
    const count = requests.length;
    await act(async () => backend.resolve(Response.json(backends)));
    expect(requests).toHaveLength(count);
  });

  test("backend discovery failure leaves local cards usable but cannot launch on fallback availability", async () => {
    routes.set("/api/backends", () => new Response("offline", { status: 503 }));
    await mount();
    expect(host.textContent).toContain("Local Board");
    const tile = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Local Board"))!;
    await click(tile);
    expect(button("Launch").disabled).toBe(true);
    expect(host.textContent).toContain("Agent availability could not be checked");
    expect(requests.filter((path) => path === "/api/launch")).toHaveLength(0);
  });

  test.each(["focus", "visibilitychange"])("returning via %s rechecks unavailable agents and coalesces return events", async (firstEvent) => {
    routes.set("/api/backends", () => Response.json({
      ...backends, backends: [{ ...backends.backends[0], available: false, reason: "Not installed" }],
    }));
    await mount();
    const tile = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Local Board"))!;
    await click(tile);
    expect(button("Launch").disabled).toBe(true);

    const installed = Promise.withResolvers<Response>();
    routes.set("/api/backends", () => installed.promise);
    await act(async () => {
      const events = firstEvent === "focus" ? ["focus", "visibilitychange"] : ["visibilitychange", "focus"];
      for (const event of events) (event === "focus" ? window : document).dispatchEvent(new Event(event));
    });
    expect(requests.filter((path) => path === "/api/backends")).toHaveLength(2);
    expect(button("Launch").disabled).toBe(true);
    await act(async () => installed.resolve(Response.json(backends)));
    expect(button("Launch").disabled).toBe(false);
  });

  test.each([true, false])("settings backend changes update launch availability (initially disabled: %s)", async (initiallyDisabled) => {
    let disabled = initiallyDisabled;
    routes.set("/api/backends", () => Response.json({
      ...backends, backends: [{ ...backends.backends[0], disabled }],
    }));
    routes.set("/api/backends/codex/disabled", () => {
      disabled = !disabled;
      return Response.json({ ok: true });
    });
    await mount();
    await click(host.querySelector('button[title="Settings"]')!);
    const settings = host.querySelector('[role="dialog"][aria-label="Settings"]')!;
    await click(settings.querySelector(`button[title="${initiallyDisabled ? "Show" : "Hide"} this backend ${initiallyDisabled ? "in" : "from"} session-creation pickers"]`)!);
    await click(settings.querySelector('button[aria-label="close"]')!);
    const tile = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Local Board"))!;
    await click(tile);
    expect(button("Launch").disabled).toBe(!initiallyDisabled);
  });

  test("gallery keeps empty pending and failed buckets visible and retries without losing cards", async () => {
    const initial = Promise.withResolvers<Response>();
    routes.set("/api/registry", () => initial.promise);
    await mount();
    const allModes = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("All Modes"))!;
    await click(allModes);
    const gallery = host.querySelector('[role="dialog"][aria-label="Mode Gallery"]')!;
    expect(gallery.textContent).toContain("Loading local modes");
    expect(gallery.textContent).not.toContain("No local modes yet");
    await act(async () => initial.resolve(new Response("offline", { status: 503 })));
    expect(gallery.textContent).toContain("Could not load local modes");
    expect(gallery.textContent).not.toContain("No local modes yet");

    routes.set("/api/registry", () => Response.json(registry("Local Board", "loading")));
    await click(gallery.querySelector('[data-launcher-resource="modes"] button')!);
    expect(gallery.textContent).toContain("Local Board");
    expect(gallery.textContent).toContain("Published");
    expect(gallery.textContent).toContain("Checking community modes");

    routes.set("/api/registry", () => Response.json({ ...registry(), publishedStatus: { state: "error", error: "Offline" } }));
    await act(async () => { window.dispatchEvent(new Event("pneuma:libraries-updated")); });
    expect(gallery.textContent).toContain("Community modes could not be refreshed");
    const published = [{ name: "community", displayName: "Community Board", version: "1", publishedAt: "2026-11-02", archiveUrl: "https://example.com/community.tar.gz" }];
    routes.set("/api/registry", () => Response.json({ ...registry(), published }));
    await click(gallery.querySelector('[data-launcher-resource="published"] button')!);
    expect(gallery.textContent).toContain("Community Board");
    expect(gallery.querySelector('[data-launcher-resource="published"]')).toBeNull();

    routes.set("/api/registry", () => Response.json({ ...registry(), published, publishedStatus: { state: "error", error: "Offline again" } }));
    await act(async () => { window.dispatchEvent(new Event("pneuma:libraries-updated")); });
    expect(gallery.textContent).toContain("Community Board");
    expect(gallery.textContent).toContain("Community modes could not be refreshed");
    expect(gallery.querySelector('[data-launcher-resource="published"] button')).not.toBeNull();
  });
}
