import type { ContentBlock } from "../types.js";
import type { ChatMessage } from "../types.js";

let idCounter = 0;
export function nextId(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

/** Merge content blocks from two assistant messages, deduplicating by JSON identity. */
export function mergeContentBlocks(prev?: ContentBlock[], next?: ContentBlock[]): ContentBlock[] | undefined {
  const prevBlocks = prev || [];
  const nextBlocks = next || [];
  if (prevBlocks.length === 0 && nextBlocks.length === 0) return undefined;
  const merged: ContentBlock[] = [];
  const seen = new Set<string>();
  for (const block of prevBlocks) {
    const key = JSON.stringify(block);
    if (!seen.has(key)) { seen.add(key); merged.push(block); }
  }
  for (const block of nextBlocks) {
    const key = JSON.stringify(block);
    if (!seen.has(key)) { seen.add(key); merged.push(block); }
  }
  return merged;
}

export function extractTextContent(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "thinking") return b.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Merge two assistant messages with the same id — combines content blocks. */
export function mergeAssistantMessage(prev: ChatMessage, incoming: ChatMessage): ChatMessage {
  const mergedBlocks = mergeContentBlocks(prev.contentBlocks, incoming.contentBlocks);
  const content = mergedBlocks?.length ? extractTextContent(mergedBlocks) : (incoming.content || prev.content);
  return {
    ...prev,
    ...incoming,
    content,
    contentBlocks: mergedBlocks,
    timestamp: prev.timestamp ?? incoming.timestamp,
  };
}

/** Filter files by content set prefix and strip the prefix from paths. */
export function filterAndRemapFiles(
  files: { path: string; content: string }[],
  prefix: string,
): { path: string; content: string }[] {
  const pfx = prefix + "/";
  return files
    .filter((f) => f.path.startsWith(pfx))
    .map((f) => ({ path: f.path.slice(pfx.length), content: f.content }));
}
