/** @jsxImportSource react */
/**
 * The chat panel's subagent chrome, in a DOM.
 *
 * Two things are pinned here. First §2.1.4: a session with no team renders the
 * conversation it always did — no strip, no cards, a composer the user can
 * type into. Second the `Escape` contract: the agent view listens on `window`
 * (the panel is rarely focused), which puts it in competition with every other
 * overlay in the app — the image lightbox, the settings sheet, the project
 * dialog, the mode viewers — none of which call `preventDefault`. Closing a
 * lightbox must not also throw the reader out of the agent's conversation.
 *
 * Same happy-dom harness as `MessageBubble.subagent-grouping.test.tsx`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
    "localStorage",
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
  // `src/i18n/index.ts` reads its catalogue through Vite's `import.meta.glob`,
  // which does not exist outside the bundler; initialise the namespaces this
  // panel reads from the same shipped files.
  const [{ default: i18n }, { initReactI18next }, subagent, chatPanel, chatInput, toolBlock, messageBubble] =
    await Promise.all([
      import("i18next"),
      import("react-i18next"),
      import("../../i18n/locales/en/subagent.json"),
      import("../../i18n/locales/en/chat-panel.json"),
      import("../../i18n/locales/en/chat-input.json"),
      import("../../i18n/locales/en/tool-block.json"),
      import("../../i18n/locales/en/message-bubble.json"),
    ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        subagent: subagent.default,
        "chat-panel": chatPanel.default,
        "chat-input": chatInput.default,
        "tool-block": toolBlock.default,
        "message-bubble": messageBubble.default,
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => restore?.());

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

beforeEach(async () => {
  const { useStore } = await import("../../store/index.js");
  useStore.setState({ messages: [], streaming: null, activity: null, cliConnected: true, replayMode: false });
  useStore.getState().resetSubagents();
});

async function mount(): Promise<HTMLElement> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChatPanel } = await import("../ChatPanel.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(ChatPanel));
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host as unknown as HTMLElement;
}

function assistant(id: string, text: string, parent: string | null) {
  return {
    id,
    role: "assistant" as const,
    content: text,
    contentBlocks: [{ type: "text" as const, text }],
    timestamp: 1,
    parentToolUseId: parent,
  };
}

describe("a session with no team renders the conversation it always did", () => {
  test("no strip, no cards, and a composer to type into", async () => {
    const { useStore } = await import("../../store/index.js");
    useStore.setState({
      messages: [
        { id: "u1", role: "user", content: "make the hero two columns", timestamp: 1 },
        assistant("m1", "Done — the hero is a two-column grid now.", null),
      ],
    });

    const host = await mount();
    expect(host.querySelectorAll("[data-subagent-strip]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-subagent-card]")).toHaveLength(0);
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.textContent).toContain("Done — the hero is a two-column grid now.");
  });
});

describe("the agent view", () => {
  test("shows the strip, the breadcrumb and the read-only note instead of a composer", async () => {
    const { act } = await import("react");
    const { useStore } = await import("../../store/index.js");
    useStore.setState({
      messages: [
        assistant("m1", "spawning a judge", null),
        assistant("m2", "the third capture is the one", "task-1"),
      ],
    });
    useStore.getState().upsertSubagent(
      { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
      1,
    );

    const host = await mount();
    // Root view first: the strip is there, and the subagent's reply appears
    // only as its card's activity line — never as a bubble in this timeline.
    expect(host.querySelectorAll("[data-subagent-strip]")).toHaveLength(1);
    const card = host.querySelector("[data-subagent-card]")!;
    expect(card.textContent).toContain("the third capture is the one");
    const scroller = host.querySelector(".overflow-y-auto")!.cloneNode(true) as HTMLElement;
    for (const node of [...scroller.querySelectorAll("[data-subagent-card]")]) node.remove();
    const bubbleText = scroller.textContent ?? "";
    expect(bubbleText).toContain("spawning a judge");
    expect(bubbleText).not.toContain("the third capture is the one");

    await act(async () => {
      useStore.getState().setViewingAgent("task-1");
    });
    expect(host.textContent).toContain("the third capture is the one");
    expect(host.textContent).not.toContain("spawning a judge");
    expect(host.textContent).toContain("view only");
    // The composer is hidden rather than unmounted, so a half-typed message
    // to the root agent survives a peek — but it is out of the tab order.
    const composer = host.querySelector("textarea");
    expect(composer).not.toBeNull();
    expect(composer!.closest("div.hidden")).not.toBeNull();
  });

  test("the strip row sits outside the scroller, so nothing scrolls under it", async () => {
    const { useStore } = await import("../../store/index.js");
    useStore.setState({ messages: [assistant("m1", "hello", null)] });
    useStore.getState().upsertSubagent(
      { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
      1,
    );

    const host = await mount();
    const strip = host.querySelector("[data-subagent-strip]")!;
    const scroller = host.querySelector(".overflow-y-auto")!;
    expect(scroller.contains(strip)).toBe(false);
    // …and the status pill shares that row rather than floating over the
    // conversation's top-right corner, where an expanded pill overlapped it.
    const pill = host.querySelector(".rounded-full.cursor-pointer");
    expect(pill?.className).not.toContain("absolute");
  });
});

describe("Escape only leaves the agent view when nothing else owns the key", () => {
  async function openAgentView(): Promise<HTMLElement> {
    const { act } = await import("react");
    const { useStore } = await import("../../store/index.js");
    useStore.setState({ messages: [assistant("m2", "judging", "task-1")] });
    useStore.getState().upsertSubagent(
      { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
      1,
    );
    const host = await mount();
    await act(async () => {
      useStore.getState().setViewingAgent("task-1");
    });
    return host;
  }

  async function pressEscape(target: EventTarget): Promise<void> {
    const { act } = await import("react");
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  test("with nothing focused it leaves one level", async () => {
    const { useStore } = await import("../../store/index.js");
    await openAgentView();
    await pressEscape(document.body);
    expect(useStore.getState().viewingAgentId).toBeNull();
  });

  test("a keystroke aimed at the chat itself leaves one level too", async () => {
    const { useStore } = await import("../../store/index.js");
    const host = await openAgentView();
    await pressEscape(host.querySelector("[data-subagent-strip] button")!);
    expect(useStore.getState().viewingAgentId).toBeNull();
  });

  test("closing a lightbox does not also close the agent view", async () => {
    const { useStore } = await import("../../store/index.js");
    await openAgentView();
    // Every overlay in the app closes on Escape and none marks the event
    // handled, so the agent view has to stand down while one is mounted.
    const lightbox = document.createElement("div");
    lightbox.setAttribute("role", "dialog");
    const closeButton = document.createElement("button");
    lightbox.appendChild(closeButton);
    document.body.appendChild(lightbox);

    await pressEscape(closeButton);
    expect(useStore.getState().viewingAgentId).toBe("task-1");
    // Even a body-targeted keystroke belongs to the overlay while it is up.
    await pressEscape(document.body);
    expect(useStore.getState().viewingAgentId).toBe("task-1");

    lightbox.remove();
    await pressEscape(document.body);
    expect(useStore.getState().viewingAgentId).toBeNull();
  });

  test("a dropdown or panel outside the chat keeps its own Escape", async () => {
    const { useStore } = await import("../../store/index.js");
    await openAgentView();
    // A content-set picker / editor picker / mode viewer control: focused,
    // outside the chat subtree, no `role="dialog"` of its own.
    const picker = document.createElement("button");
    document.body.appendChild(picker);
    await pressEscape(picker);
    expect(useStore.getState().viewingAgentId).toBe("task-1");
  });

  test("Escape typed into the composer is the composer's", async () => {
    const { useStore } = await import("../../store/index.js");
    const host = await openAgentView();
    await pressEscape(host.querySelector("textarea")!);
    expect(useStore.getState().viewingAgentId).toBe("task-1");
  });
});
