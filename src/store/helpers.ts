import type { ContentBlock } from "../types.js";
import type { ChatMessage } from "../types.js";
import { mergeContentBlocks as mergeBlocks } from "../../core/utils/content-blocks.js";

let idCounter = 0;
export function nextId(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

/**
 * Merge content blocks from two assistant messages, deduplicating by JSON
 * identity — the shared rule in `core/utils/content-blocks.ts`, which the
 * bridge applies to `messageHistory` on the same frames.
 *
 * The one thing that is local to the chat store: `ChatMessage.contentBlocks`
 * is optional, and "no blocks at all" must stay `undefined` rather than
 * become an empty array (a text-only message that never carried blocks would
 * otherwise start rendering as a message with zero blocks). Dedupe can never
 * empty a non-empty input, so an empty merge means both inputs were empty.
 */
export function mergeContentBlocks(prev?: ContentBlock[], next?: ContentBlock[]): ContentBlock[] | undefined {
  const merged = mergeBlocks(prev, next);
  return merged.length > 0 ? merged : undefined;
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
