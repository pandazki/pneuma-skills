import type { BrowserIncomingMessage } from "./session-types.js";
import type { SessionSummary } from "../core/types/shared-history.js";

export function generateSummary(
  messages: BrowserIncomingMessage[],
  workspaceFiles: { path: string; lines: number }[],
): SessionSummary {
  const userMessages = messages.filter((m) => m.type === "user_message") as Array<{ type: "user_message"; content: string; timestamp: number }>;
  const assistantMessages = messages.filter((m) => m.type === "assistant") as Array<{ type: "assistant"; message: { content: Array<{ type: string; text?: string }> } }>;

  // Overview: first 3 user messages + total turn count
  const firstThree = userMessages.slice(0, 3).map((m) => m.content).join("; ");
  const overview = userMessages.length <= 3
    ? firstThree
    : `${firstThree} ... (${userMessages.length} turns total)`;

  // Key decisions: extract lines from assistant messages containing decision-like words
  const keyDecisions: string[] = [];
  for (const msg of assistantMessages) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        const lines = block.text.split("\n");
        for (const line of lines) {
          if (/(?:decided|chose|using|selected|went with|picked|opted)/i.test(line) && line.length < 200) {
            keyDecisions.push(line.trim());
            if (keyDecisions.length >= 10) break;
          }
        }
      }
      if (keyDecisions.length >= 10) break;
    }
  }

  // Recent conversation: last 3 turns (user + assistant pairs)
  const recentTurns: string[] = [];
  const lastUserMsgs = userMessages.slice(-3);
  for (const userMsg of lastUserMsgs) {
    recentTurns.push(`[user] ${userMsg.content}`);
    const userIdx = messages.indexOf(userMsg as any);
    for (let i = userIdx + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.type === "assistant") {
        const textBlocks = (m as any).message?.content?.filter((b: any) => b.type === "text") ?? [];
        const text = textBlocks.map((b: any) => b.text).join("\n").slice(0, 500);
        if (text) recentTurns.push(`[assistant] ${text}`);
        break;
      }
      if (m.type === "user_message") break;
    }
  }

  return {
    overview,
    keyDecisions: keyDecisions.slice(0, 5),
    workspaceFiles,
    recentConversation: recentTurns.join("\n"),
  };
}
