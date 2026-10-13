/** @jsxImportSource react */
import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// Isolate the Vite-only i18n module replacement so it cannot change
// other frontend suites' imports or global browser state.
if (process.env.PNEUMA_HANDOFF_UI_TEST !== "1") {
  test("ProjectPanel preserves the selected backend through Smart Handoff", async () => {
    const proc = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PNEUMA_HANDOFF_UI_TEST: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
  let win: Window;
  let unmount: () => Promise<void>;
  let host: HTMLElement;
  let closes = 0;
  let rejected = false;
  let requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let act: typeof import("react").act;
  let initialState: ReturnType<typeof import("../../store.js").useStore.getState>;

  beforeAll(async () => {
    win = new Window({ url: "http://localhost/?session=source&mode=doc" });
    for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
      (globalThis as unknown as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
    }
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const { default: i18n } = await import("i18next");
    const { initReactI18next } = await import("react-i18next");
    await i18n.use(initReactI18next).init({
      lng: "en", fallbackLng: "en", interpolation: { escapeValue: false },
      resources: { en: {
        "project-panel": (await import("../../i18n/locales/en/project-panel.json")).default,
        handoff: (await import("../../i18n/locales/en/handoff.json")).default,
      } },
    });
    mock.module("../../i18n/index.js", () => ({
      default: i18n, SUPPORTED_LOCALES: ["en"], LOCALE_LABELS: { en: "English" },
      DEFAULT_LOCALE: "en", currentLocale: () => "en", persistLocale: async () => true,
    }));
    act = (await import("react")).act;
    initialState = (await import("../../store.js")).useStore.getState();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        requests.push({ path, body });
        if (path.endsWith("/api/handoffs/request")) {
          return rejected
            ? Response.json({ error: "Selected backend is unavailable" }, { status: 400 })
            : Response.json({ request_id: "requested", status: "preparing" });
        }
        if (path.endsWith("/api/launch/prepare")) return Response.json({ initParams: [] });
      }
      if (path.endsWith("/sessions")) return Response.json({ project: { name: "demo", displayName: "Demo", root: "/demo" }, sessions: [] });
      if (path.endsWith("/api/registry")) return Response.json({ builtins: [{ name: "slide", displayName: "Slides" }] });
      if (path.endsWith("/api/backends")) return Response.json({
        defaultBackendType: "claude-code",
        backends: [
          { type: "claude-code", label: "Claude Code", implemented: true, available: true },
          { type: "codex", label: "Codex", implemented: true, available: true },
        ],
      });
      return Response.json({ projects: [], favorites: [], editors: [] });
    }) as unknown as typeof fetch;
  });
  afterEach(async () => {
    await unmount?.();
    (await import("../../store.js")).useStore.setState(initialState, true);
    document.body.innerHTML = "";
    requests = [];
    closes = 0;
    rejected = false;
  });
  afterAll(async () => { await win.happyDOM.close(); });

  async function mountPanel() {
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useStore } = await import("../../store.js");
    const { default: ProjectPanel } = await import("../ProjectPanel.js");
    useStore.setState({
      session: { session_id: "source", backend_type: "claude-code" } as never,
      projectContext: { projectRoot: "/demo" }, modeManifest: { name: "doc" } as never,
    });
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = async () => { await act(async () => root.unmount()); };
    await act(async () => root.render(createElement(ProjectPanel, { projectRoot: "/demo", onClose: () => { closes++; } })));
  }
  async function clickButton(label: string) {
    const button = [...host.querySelectorAll("button")].find(el => el.textContent?.trim() === label);
    if (!button) throw new Error("Button missing: " + label);
    await act(async () => { button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  }
  async function chooseHandoff() {
    await mountPanel();
    await clickButton("Slides");
    await clickButton("Codex");
    const checkbox = host.querySelector('input[type="checkbox"]')!;
    await act(async () => { checkbox.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event); });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, 'Make a "deck" & explain <scope>');
      textarea.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  }

  test("Codex selection is sent to the server even when Claude is the default and source", async () => {
    await chooseHandoff();
    await clickButton("Confirm");
    expect(requests.find(req => req.path.endsWith("/api/handoffs/request"))?.body).toEqual({
      source_session_id: "source", target_mode: "slide", target_backend: "codex",
      intent: 'Make a "deck" & explain <scope>',
    });
    expect(closes).toBe(1);
    expect(requests.some(req => req.path.endsWith("/api/launch"))).toBe(false);
  });

  test("a review opened without the launch sheet displays the server-owned backend", async () => {
    const { useStore } = await import("../../store.js");
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: HandoffCard } = await import("../HandoffCard.js");
    useStore.getState().setProposedHandoff({
      handoff_id: "requested", proposed_at: Date.now(),
      payload: { target_mode: "slide", target_backend: "codex", intent: "Prepare the deck" },
    });
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = async () => { await act(async () => root.unmount()); };
    await act(async () => root.render(createElement(HandoffCard)));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Codex");
    expect(host.textContent).not.toContain("Claude Code");
  });

  test("a rejected request keeps the selection visible and reports the server error", async () => {
    rejected = true;
    await chooseHandoff();
    await clickButton("Confirm");
    expect(closes).toBe(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Selected backend is unavailable");
    expect(host.querySelector("textarea")?.value).toBe('Make a "deck" & explain <scope>');
    rejected = false;
    await clickButton("Confirm");
    const handoffs = requests.filter(req => req.path.endsWith("/api/handoffs/request"));
    expect(handoffs).toHaveLength(2);
    expect(handoffs[1]?.body.target_backend).toBe("codex");
    expect(closes).toBe(1);
  });
}
