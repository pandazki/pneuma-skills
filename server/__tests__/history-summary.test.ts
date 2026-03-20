import { describe, expect, test } from "bun:test";
import { generateSummary } from "../history-summary.js";

describe("generateSummary", () => {
  test("extracts overview from user messages", () => {
    const messages = [
      { type: "user_message", content: "Create a landing page", timestamp: 1000, id: "1" },
      { type: "user_message", content: "Add a dark theme", timestamp: 2000, id: "2" },
      { type: "user_message", content: "Fix the mobile layout", timestamp: 3000, id: "3" },
      { type: "user_message", content: "Deploy to production", timestamp: 4000, id: "4" },
    ] as any;
    const summary = generateSummary(messages, []);
    expect(summary.overview).toContain("Create a landing page");
    expect(summary.overview).toContain("4 turns total");
  });

  test("extracts recent conversation (last 3 turns)", () => {
    const messages: any[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ type: "user_message", content: `User message ${i}`, timestamp: i * 1000, id: `u${i}` });
      messages.push({
        type: "assistant",
        message: { id: `a${i}`, content: [{ type: "text", text: `Response ${i}` }], model: "test", stop_reason: "end_turn", role: "assistant" },
        parent_tool_use_id: null,
        timestamp: i * 1000 + 500,
      });
    }
    const summary = generateSummary(messages, []);
    expect(summary.recentConversation).toContain("User message 4");
    expect(summary.recentConversation).toContain("Response 4");
    expect(summary.recentConversation).not.toContain("User message 0");
  });

  test("generates workspace file list", () => {
    const files = [
      { path: "index.html", lines: 100 },
      { path: "style.css", lines: 50 },
    ];
    const summary = generateSummary([], files);
    expect(summary.workspaceFiles).toEqual(files);
  });
});
