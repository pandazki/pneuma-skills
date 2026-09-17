import type { SubagentSpawnRef } from "../../core/types/agent-backend.js";

/**
 * The Claude Code tools that spawn an agent. `Task` is the long-standing
 * name; `Agent` is the newer alias for the same call. Both put the spawned
 * agent's description in `input.description` and its persona in
 * `input.subagent_type`.
 */
const SPAWN_TOOL_NAMES = new Set(["Task", "Agent"]);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pure helper behind `claudeCodeModule.subagentSpawn`. The spawning block's
 * own `tool_use.id` is the agent's attribution key, so this only has to name
 * the agent: `description` is what the spawner wrote for this particular run,
 * `subagent_type` is the persona it picked, and the tool name is the last
 * resort so a card is never nameless.
 */
export function claudeSubagentSpawn(
  toolName: string,
  input: Record<string, unknown>,
): SubagentSpawnRef | undefined {
  if (!SPAWN_TOOL_NAMES.has(toolName)) return undefined;
  const subagentType = nonEmptyString(input.subagent_type);
  const label = nonEmptyString(input.description) ?? subagentType ?? toolName;
  return subagentType ? { label, detail: subagentType } : { label };
}
