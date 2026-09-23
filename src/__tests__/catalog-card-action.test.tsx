/** @jsxImportSource react */
/**
 * The action on a catalog mode's gallery card is the one place the launcher
 * has to be honest about four different situations, three of which a
 * screenshot of a healthy machine never shows:
 *
 *  - not downloaded → the action says so ("Download and open"), not "Launch";
 *  - installed for another core release → it says it will update;
 *  - downloading → a real percentage from the stream, and NO percentage at
 *    all while the server has not announced a total (an indeterminate bar
 *    instead of a confident "0%");
 *  - failed → the server's own reason, plus a retry that actually retries.
 *
 * Rendered rather than asserted on strings, because "the button reads as
 * download, not open" is a property of what ships, and because the progress
 * element has to carry its ARIA value for anything but a sighted user to
 * follow the download at all.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(async () => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
  // `src/i18n/index.ts` reads its resources through Vite's `import.meta.glob`,
  // which does not exist outside the bundler — initialise the one namespace
  // these components read, from the catalogue file the app ships.
  const [{ default: i18n }, { initReactI18next }, { default: launcher }] = await Promise.all([
    import("i18next"),
    import("react-i18next"),
    import("../i18n/locales/en/launcher.json"),
  ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { launcher } },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => restore?.());

interface Mounted {
  host: HTMLElement;
  text(): string;
  progressBar(): HTMLElement | null;
  click(selector: string): Promise<void>;
  unmount(): Promise<void>;
}

async function mountAction(props: {
  stale: boolean;
  install?: { phase: "installing" | "done" | "error"; received: number; total: number; error?: string };
  onStart?: () => void;
}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CatalogCardAction } = await import("../components/CatalogInstall.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(CatalogCardAction, {
        stale: props.stale,
        install: props.install as never,
        onStart: props.onStart ?? (() => {}),
      }),
    );
  });

  return {
    host,
    text: () => host.textContent ?? "",
    progressBar: () => host.querySelector("[role='progressbar']") as HTMLElement | null,
    click: async (selector: string) => {
      const el = host.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element for ${selector}`);
      await act(async () => {
        el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("catalog card action", () => {
  test("a mode that is not downloaded offers a download, not a launch", async () => {
    const m = await mountAction({ stale: false });
    expect(m.text()).toContain("Download and open");
    expect(m.text()).not.toContain("Launch");
    expect(m.host.querySelector("svg")).not.toBeNull(); // the download glyph, not an emoji
    await m.unmount();
  });

  test("an install left behind by an older core offers an update", async () => {
    const m = await mountAction({ stale: true });
    expect(m.text()).toContain("Update and open");
    await m.unmount();
  });

  test("a running download reports the stream's own percentage", async () => {
    const m = await mountAction({
      stale: false,
      install: { phase: "installing", received: 2_500_000, total: 10_000_000 },
    });
    expect(m.text()).toContain("25%");
    expect(m.progressBar()?.getAttribute("aria-valuenow")).toBe("25");
    await m.unmount();
  });

  test("before the server announces a total, no percentage is claimed", async () => {
    const m = await mountAction({
      stale: false,
      install: { phase: "installing", received: 0, total: 0 },
    });
    expect(m.text()).toContain("Starting download");
    expect(m.text()).not.toContain("%");
    expect(m.progressBar()).not.toBeNull();
    expect(m.progressBar()?.getAttribute("aria-valuenow")).toBeNull();
    await m.unmount();
  });

  test("a failure shows the server's reason and retries on demand", async () => {
    let retries = 0;
    const m = await mountAction({
      stale: false,
      install: {
        phase: "error",
        received: 0,
        total: 0,
        error: "sha256 mismatch for backlot-0.3.1.tar.gz",
      },
      onStart: () => { retries += 1; },
    });
    expect(m.text()).toContain("sha256 mismatch for backlot-0.3.1.tar.gz");
    expect(m.text()).toContain("Retry");
    await m.click("button");
    expect(retries).toBe(1);
    await m.unmount();
  });

  test("a failure with no message still names what went wrong", async () => {
    const m = await mountAction({
      stale: false,
      install: { phase: "error", received: 0, total: 0, error: "" },
    });
    expect(m.text()).toContain("Download failed");
    await m.unmount();
  });
});
