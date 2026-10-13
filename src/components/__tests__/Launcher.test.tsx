/** @jsxImportSource react */
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// Keep browser globals and the Vite-only i18n replacement out of sibling suites.
if (process.env.PNEUMA_LAUNCH_DIALOG_UI_TEST !== "1") {
  test("LaunchDialog preserves user backend choices and current workspace locks", async () => {
    const proc = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PNEUMA_LAUNCH_DIALOG_UI_TEST: "1" },
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
  let host: HTMLElement;
  let unmount: (() => Promise<void>) | undefined;
  let act: typeof import("react").act;
  let prepareResponse: Promise<Response> | undefined;
  let selectedDirectory = "";
  let checkedPaths: string[] = [];
  let launches: Array<{ workspace: string; backendType: string; initParams: Record<string, unknown> }> = [];
  const workspaceResponses = new Map<string, Promise<Response>>();

  beforeAll(async () => {
    win = new Window({ url: "http://localhost/" });
    for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
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
      DEFAULT_LOCALE: "en", currentLocale: () => "en", persistLocale: async () => true,
    }));
    act = (await import("react")).act;
    (win as unknown as { pneumaDesktop: unknown }).pneumaDesktop = {
      showOpenDialog: async () => selectedDirectory,
    };
    win.open = (() => null) as typeof win.open;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/launch/prepare") {
        return prepareResponse ?? Response.json({ initParams: [] });
      }
      if (url.pathname === "/api/workspace-check") {
        const path = url.searchParams.get("path")!;
        checkedPaths.push(path);
        return workspaceResponses.get(path) ?? Response.json({ hasSession: false });
      }
      if (url.pathname === "/api/launch") {
        launches.push(JSON.parse(String(init?.body)));
        return Response.json({ url: "http://localhost/started" });
      }
      return Response.json({ theme: "dark" });
    }) as typeof fetch;
  });

  beforeEach(() => {
    prepareResponse = undefined;
    selectedDirectory = "";
    checkedPaths = [];
    launches = [];
    workspaceResponses.clear();
  });
  afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    document.body.innerHTML = "";
  });
  afterAll(async () => { await win.happyDOM.close(); });

  async function mountDialog(defaultWorkspace?: string) {
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { LaunchDialog } = await import("../Launcher.js");
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = async () => { await act(async () => root.unmount()); };
    await act(async () => root.render(createElement(LaunchDialog, {
      specifier: "doc", displayName: "Document", homeDir: "/home/test", defaultWorkspace,
      defaultBackendType: "claude-code", onClose: () => {},
      backendOptions: [
        { type: "claude-code", label: "Claude Code", description: "Claude", implemented: true, available: true },
        { type: "codex", label: "Codex", description: "Codex", implemented: true, available: true },
      ],
    })));
  }

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(el => el.textContent?.trim() === label);
    if (!found) throw new Error(`Button missing: ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => { button(label).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  }
  function workspaceInput(): HTMLInputElement {
    return host.querySelector('input[type="text"]')!;
  }
  async function typeWorkspace(path: string) {
    await act(async () => {
      const input = workspaceInput();
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(input, path);
      input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  }
  async function browseWorkspace(path: string) {
    selectedDirectory = path;
    const browse = host.querySelector('button[title="Browse directories"]')!;
    await act(async () => { browse.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  }
  function deferWorkspace(path: string) {
    const response = Promise.withResolvers<Response>();
    workspaceResponses.set(path, response.promise);
    return async (body: unknown, status = 200) => {
      await act(async () => { response.resolve(Response.json(body, { status })); });
    };
  }

  test("a fresh folder result preserves the explicitly selected Codex backend", async () => {
    await mountDialog();
    await click("Codex");
    const finish = deferWorkspace("/fresh");
    await browseWorkspace("/fresh");
    await finish({ hasSession: false });
    await click("Launch");
    expect(launches[0]?.workspace).toBe("/fresh");
    expect(launches[0]?.backendType).toBe("codex");
  });

  test("late preparation cannot restore the initial path over a manually chosen workspace", async () => {
    const prepared = Promise.withResolvers<Response>();
    prepareResponse = prepared.promise;
    await mountDialog("/initial");
    await click("Codex");
    await typeWorkspace("/typed");
    await act(async () => { prepared.resolve(Response.json({ initParams: [] })); });
    expect(workspaceInput().value).toBe("/typed");
    await click("Launch");
    expect(launches[0]?.workspace).toBe("/typed");
    expect(launches[0]?.backendType).toBe("codex");
  });

  test("a late previous-path response cannot replace the current workspace lock or config", async () => {
    await mountDialog();
    const finishOld = deferWorkspace("/old");
    const finishCurrent = deferWorkspace("/current");
    await browseWorkspace("/old");
    await browseWorkspace("/current");
    await finishCurrent({ hasSession: true, mode: "doc", backendType: "codex", config: { language: "current" } });
    await finishOld({ hasSession: true, mode: "doc", backendType: "claude-code", config: { language: "old" } });
    expect(host.textContent).toContain("will resume Codex session");
    await click("Launch");
    expect(launches[0]?.workspace).toBe("/current");
    expect(launches[0]?.backendType).toBe("codex");
    expect(launches[0]?.initParams.language).toBe("current");
  });

  test("manual typing invalidates an old folder check and checks the new path", async () => {
    await mountDialog();
    await click("Codex");
    const finishOld = deferWorkspace("/old");
    await browseWorkspace("/old");
    await typeWorkspace("/typed");
    await finishOld({ hasSession: true, mode: "doc", backendType: "claude-code", config: {} });
    expect(checkedPaths).toContain("/typed");
    expect(host.textContent).not.toContain("Existing workspace");
    await click("Launch");
    expect(launches[0]?.workspace).toBe("/typed");
    expect(launches[0]?.backendType).toBe("codex");
  });

  test("an existing workspace keeps its backend locked when launching", async () => {
    await mountDialog();
    await click("Codex");
    const finish = deferWorkspace("/existing");
    await browseWorkspace("/existing");
    await finish({ hasSession: true, mode: "doc", backendType: "claude-code", config: {} });
    expect(button("Codex").disabled).toBe(true);
    expect(button("Claude Code").disabled).toBe(true);
    expect(host.textContent).toContain("will resume Claude session");
    await click("Launch");
    expect(launches[0]?.backendType).toBe("claude-code");
  });

  test("leaving a locked workspace restores the user's fresh-session choice", async () => {
    await mountDialog();
    await click("Codex");
    const finish = deferWorkspace("/existing");
    await browseWorkspace("/existing");
    await finish({ hasSession: true, mode: "doc", backendType: "claude-code", config: {} });
    await browseWorkspace("/fresh");
    expect(button("Codex").disabled).toBe(false);
    await click("Launch");
    expect(launches[0]?.backendType).toBe("codex");
  });

  test("launch waits for the current path check before choosing its backend", async () => {
    await mountDialog();
    await click("Codex");
    const finish = deferWorkspace("/pending");
    await browseWorkspace("/pending");
    expect(button("Launch").disabled).toBe(true);
    await click("Launch");
    expect(launches).toEqual([]);
    await finish({ hasSession: true, mode: "doc", backendType: "claude-code", config: {} });
    await click("Launch");
    expect(launches[0]?.backendType).toBe("claude-code");
  });

  test("revisiting a previous path waits for a fresh workspace check", async () => {
    await mountDialog("/previous");
    await click("Codex");
    const finishOther = deferWorkspace("/other");
    await typeWorkspace("/other");
    const finishPrevious = deferWorkspace("/previous");
    await typeWorkspace("/previous");
    expect(button("Launch").disabled).toBe(true);
    await finishOther({ hasSession: false });
    expect(button("Launch").disabled).toBe(true);
    await finishPrevious({ hasSession: true, mode: "doc", backendType: "claude-code", config: {} });
    await click("Launch");
    expect(launches[0]?.workspace).toBe("/previous");
    expect(launches[0]?.backendType).toBe("claude-code");
  });

  test("selecting the current directory keeps its completed check usable", async () => {
    await mountDialog("/current");
    await click("Codex");
    await browseWorkspace("/current");
    expect(button("Launch").disabled).toBe(false);
    await click("Launch");
    expect(launches[0]?.backendType).toBe("codex");
  });

  test("a failed workspace check is visible and cannot launch with an assumed backend", async () => {
    await mountDialog();
    const finish = deferWorkspace("/unreadable");
    await browseWorkspace("/unreadable");
    await finish({ error: "Workspace check failed" }, 500);
    expect(host.textContent).toContain("Workspace check failed");
    expect(button("Launch").disabled).toBe(true);
    await click("Launch");
    expect(launches).toEqual([]);
  });
}
