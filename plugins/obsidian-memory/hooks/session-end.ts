import type { HookContext } from "../../../core/types/plugin.js";
import { ObsidianMemorySource } from "../obsidian-api.js";

interface SessionEndPayload {
  sessionId: string;
  mode: string;
  workspace: string;
}

export default async function (ctx: HookContext<SessionEndPayload>) {
  const { apiUrl, apiKey, sessionLogFolder } = ctx.settings as Record<
    string,
    string
  >;

  if (!apiKey) return;

  const source = new ObsidianMemorySource({
    apiUrl: apiUrl || "https://localhost:27124",
    apiKey,
  });

  const isAvailable = await source.available();
  if (!isAvailable) return;

  // Build session summary
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(":", "");
  const filename = `${ctx.payload.mode}-${dateStr}-${timeStr}`;
  const folder = sessionLogFolder || "pneuma/sessions";
  const path = `${folder}/${filename}.md`;

  const content = [
    `# Session: ${ctx.payload.mode}`,
    "",
    `- **Date:** ${now.toISOString()}`,
    `- **Mode:** ${ctx.payload.mode}`,
    `- **Workspace:** ${ctx.payload.workspace}`,
    `- **Session ID:** ${ctx.payload.sessionId}`,
    "",
    "## Notes",
    "",
    "_Session ended. Add your notes here._",
    "",
  ].join("\n");

  await source.write(path, content, {
    tags: ["pneuma", "session", ctx.payload.mode],
  });

  console.log(`[obsidian-memory] Session log written to vault: ${path}`);
}
