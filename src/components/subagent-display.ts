/**
 * Pure derivations behind the subagent cards, strip, and agent-view header.
 * Kept out of the components (like `viewer-locator-parse.ts`) so tests can
 * import them without dragging in React or a DOM.
 */

import type { ChatMessage } from "../types.js";
import type { SubagentEntry } from "../store/subagent-slice.js";

/** Longest activity line the card shows before eliding. */
const SNIPPET_MAX = 90;

function snippet(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_MAX) return flat;
  return `${flat.slice(0, SNIPPET_MAX - 1)}…`;
}

/**
 * What to call this agent. The roster label wins; a fallback entry (§3.4) has
 * an empty label, so fall back to the spawn call's own input — the client
 * already knows Claude's `Task` shape — and finally to the generic label.
 */
export function deriveSubagentLabel(
  entry: Pick<SubagentEntry, "label"> | undefined,
  anchorInput: Record<string, unknown> | undefined,
  genericLabel: string,
): string {
  const rostered = entry?.label?.trim();
  if (rostered) return rostered;
  const description = anchorInput?.description;
  if (typeof description === "string" && description.trim()) return description.trim();
  const subagentType = anchorInput?.subagent_type;
  if (typeof subagentType === "string" && subagentType.trim()) return subagentType.trim();
  return genericLabel;
}

/**
 * The agent's ancestry, outermost first, ending with `id` itself. Drives the
 * breadcrumb (`主对话 / builder / judge`). Defensive against a cycle in
 * `parent_id`, which would otherwise hang the render.
 */
export function subagentAncestry(
  subagents: Map<string, SubagentEntry>,
  id: string,
): SubagentEntry[] {
  const chain: SubagentEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry = subagents.get(cursor);
    if (!entry) break;
    chain.unshift(entry);
    cursor = entry.parent_id;
  }
  return chain;
}

/**
 * One line of the agent's latest activity, read from its own messages: the
 * last tool call or the last text it produced. `null` when it has said
 * nothing yet (the card then shows the waiting state).
 */
export function latestSubagentActivity(
  messages: ChatMessage[],
  agentId: string,
  describeTool: (name: string, input: Record<string, unknown>) => string,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ((message.parentToolUseId ?? null) !== agentId) continue;
    const blocks = message.contentBlocks ?? [];
    for (let b = blocks.length - 1; b >= 0; b--) {
      const block = blocks[b];
      if (block.type === "tool_use") return snippet(describeTool(block.name, block.input));
      if (block.type === "text" && block.text.trim()) return snippet(block.text);
    }
    if (message.content?.trim()) return snippet(message.content);
  }
  return null;
}

/** The last line of a streaming buffer — the freshest thing the agent said. */
export function streamingTail(text: string | undefined): string | null {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return snippet(lines[lines.length - 1]);
}

/** Every `tool_use` id present in any message — the set of existing anchors. */
export function collectToolUseIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const block of message.contentBlocks ?? []) {
      if (block.type === "tool_use") ids.add(block.id);
    }
  }
  return ids;
}

/**
 * Attribution keys that need a card but have no anchor `tool_use` block in any
 * message — a pre-fix Claude history keeps the subagent's reply and loses the
 * `Task` call that spawned it. Per §3.4 these get a synthetic card in the view
 * that owns them, placed before the first message of that view which follows
 * the agent's first attributed message.
 */
export function orphanSubagentPlacements(
  messages: ChatMessage[],
  subagents: Map<string, SubagentEntry>,
  viewingAgentId: string | null,
): { beforeMessageId: Map<string, string[]>; trailing: string[] } {
  const beforeMessageId = new Map<string, string[]>();
  const trailing: string[] = [];
  if (subagents.size === 0) return { beforeMessageId, trailing };

  const anchored = collectToolUseIds(messages);
  const orphans = [...subagents.values()]
    .filter((entry) => !anchored.has(entry.id) && (entry.parent_id ?? null) === viewingAgentId)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  if (orphans.length === 0) return { beforeMessageId, trailing };

  for (const entry of orphans) {
    const firstAttributed = messages.findIndex(
      (m) => (m.parentToolUseId ?? null) === entry.id,
    );
    const from = firstAttributed === -1 ? 0 : firstAttributed + 1;
    let anchorId: string | null = null;
    for (let i = from; i < messages.length; i++) {
      if ((messages[i].parentToolUseId ?? null) === viewingAgentId) {
        anchorId = messages[i].id;
        break;
      }
    }
    if (anchorId === null) {
      trailing.push(entry.id);
      continue;
    }
    const bucket = beforeMessageId.get(anchorId);
    if (bucket) bucket.push(entry.id);
    else beforeMessageId.set(anchorId, [entry.id]);
  }

  return { beforeMessageId, trailing };
}
