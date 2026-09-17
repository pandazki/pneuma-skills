/** @jsxImportSource react */
/**
 * Spawn anchors are cards, never a tool group.
 *
 * Claude fans out three `Task` calls in one assistant message. The existing
 * grouping folds consecutive same-name `tool_use` blocks into one
 * `ToolGroupBlock` ("Subagent ×3"), which is exactly the wrong reading: three
 * spawns are three agents, each with its own status, its own latest activity,
 * and its own conversation to open (§2.4). This pins that a `tool_use` whose
 * id is an attribution key renders as its own `SubagentCard`, and that a
 * normal tool run still groups.
 *
 * Same happy-dom harness as `InitParamForm.multiselect.test.tsx`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ChatMessage, ContentBlock } from "../../types.js";

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
  // `src/i18n/index.ts` reads its catalogue through Vite's `import.meta.glob`,
  // which does not exist outside the bundler; initialise the namespaces these
  // components read from the same shipped files.
  const [{ default: i18n }, { initReactI18next }, subagent, toolBlock, messageBubble] = await Promise.all([
    import("i18next"),
    import("react-i18next"),
    import("../../i18n/locales/en/subagent.json"),
    import("../../i18n/locales/en/tool-block.json"),
    import("../../i18n/locales/en/message-bubble.json"),
  ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        subagent: subagent.default,
        "tool-block": toolBlock.default,
        "message-bubble": messageBubble.default,
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => restore?.());

function spawnBlock(id: string, description: string): ContentBlock {
  return { type: "tool_use", id, name: "Task", input: { description, subagent_type: "general-purpose", prompt: "go" } };
}

function message(blocks: ContentBlock[]): ChatMessage {
  return {
    id: "m-1",
    role: "assistant",
    content: "",
    contentBlocks: blocks,
    timestamp: 1,
    parentToolUseId: null,
  };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function mount(msg: ChatMessage, subagentIds?: Set<string>): Promise<HTMLElement> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: MessageBubble } = await import("../MessageBubble.js");
  const { useStore } = await import("../../store/index.js");

  useStore.setState({ messages: [msg] });
  useStore.getState().resetSubagents();

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MessageBubble, { message: msg, subagentIds }));
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host as unknown as HTMLElement;
}

describe("groupContentBlocks", () => {
  test("a spawn anchor is its own group; consecutive spawns never merge", async () => {
    const { groupContentBlocks } = await import("../MessageBubble.js");
    const blocks = [
      spawnBlock("task-1", "judge the captures"),
      spawnBlock("task-2", "build the deck"),
    ];
    const grouped = groupContentBlocks(blocks, new Set(["task-1", "task-2"]));
    expect(grouped.map((g) => g.kind)).toEqual(["subagent", "subagent"]);
    expect(grouped.map((g) => (g.kind === "subagent" ? g.id : null))).toEqual(["task-1", "task-2"]);
  });

  test("without the attribution keys the same blocks still group as before", async () => {
    const { groupContentBlocks } = await import("../MessageBubble.js");
    const grouped = groupContentBlocks([
      spawnBlock("task-1", "judge the captures"),
      spawnBlock("task-2", "build the deck"),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe("tool_group");
    expect(grouped[0].kind === "tool_group" && grouped[0].items).toHaveLength(2);
  });

  test("a spawn anchor does not swallow the ordinary tool run around it", async () => {
    const { groupContentBlocks } = await import("../MessageBubble.js");
    const grouped = groupContentBlocks(
      [
        { type: "tool_use", id: "r-1", name: "Read", input: { file_path: "/a.md" } },
        spawnBlock("task-1", "judge the captures"),
        { type: "tool_use", id: "r-2", name: "Read", input: { file_path: "/b.md" } },
      ],
      new Set(["task-1"]),
    );
    expect(grouped.map((g) => g.kind)).toEqual(["tool_group", "subagent", "tool_group"]);
  });
});

describe("what the bubble renders", () => {
  test("two spawns render two cards, each named by its own description", async () => {
    const host = await mount(
      message([spawnBlock("task-1", "judge the captures"), spawnBlock("task-2", "build the deck")]),
      new Set(["task-1", "task-2"]),
    );
    const cards = [...host.querySelectorAll("[data-subagent-card]")];
    expect(cards.map((c) => c.getAttribute("data-subagent-card"))).toEqual(["task-1", "task-2"]);
    expect(host.textContent).toContain("judge the captures");
    expect(host.textContent).toContain("build the deck");
    // No roster snapshot yet: the card says so instead of faking activity.
    expect(host.textContent).toContain("Waiting for output…");
    expect(host.textContent).toContain("View conversation");
  });

  test("an ordinary pair of reads still renders one collapsed group, no card", async () => {
    const host = await mount(
      message([
        { type: "tool_use", id: "r-1", name: "Read", input: { file_path: "/a.md" } },
        { type: "tool_use", id: "r-2", name: "Read", input: { file_path: "/b.md" } },
      ]),
      new Set(["task-1"]),
    );
    expect(host.querySelectorAll("[data-subagent-card]")).toHaveLength(0);
    expect(host.textContent).toContain("Read File");
    expect(host.textContent).toContain("2");
  });

  test("clicking a card opens that agent's view", async () => {
    const { act } = await import("react");
    const { useStore } = await import("../../store/index.js");
    const host = await mount(message([spawnBlock("task-1", "judge the captures")]), new Set(["task-1"]));
    const card = host.querySelector("[data-subagent-card]")!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().viewingAgentId).toBe("task-1");
    useStore.getState().setViewingAgent(null);
  });
});
