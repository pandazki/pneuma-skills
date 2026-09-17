/**
 * The one definition of "merge two frames of the same assistant message".
 *
 * Claude Code delivers a single assistant message as several NDJSON frames
 * that all share `message.id`, one content block each (`tool_use`, then
 * `text`, …). Both ends of the pipeline have to fold those frames back into
 * one message: the bridge does it for `messageHistory`
 * (`server/ws-bridge.ts::handleAssistantMessage`) and the browser does it for
 * the rendered chat (`src/store/helpers.ts::mergeAssistantMessage`). The rule
 * has to be identical or a refresh changes what the user sees, so it lives
 * here — the same reason `core/utils/pneuma-markers.ts` exists — instead of
 * being written twice with a "change one and change the other" comment.
 *
 * The rule: existing blocks keep their order and come first, then incoming
 * blocks that are not already present. Identity is JSON identity of the whole
 * block, which is what makes a repeated frame idempotent; a genuinely new
 * `tool_use` differs by its `id`, so it is never mistaken for a repeat.
 *
 * Generic over the block type on purpose: this is a structural rule about
 * arrays of JSON-serialisable values, and `core/` should not have to reach
 * into `server/session-types.ts` for `ContentBlock` to express it.
 */
export function mergeContentBlocks<T>(
  prev: readonly T[] | undefined,
  next: readonly T[] | undefined,
): T[] {
  const prevBlocks = Array.isArray(prev) ? prev : [];
  const nextBlocks = Array.isArray(next) ? next : [];
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const block of [...prevBlocks, ...nextBlocks]) {
    const key = JSON.stringify(block);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(block);
  }
  return merged;
}

/**
 * True when every block in `blocks` is already present in `within` by the
 * same JSON identity `mergeContentBlocks` uses — i.e. merging them in would
 * be a no-op. The bridge asks this to recognise a `--resume` re-emit of a
 * message whose blocks it already persisted.
 */
export function containsAllBlocks<T>(
  within: readonly T[] | undefined,
  blocks: readonly T[] | undefined,
): boolean {
  const haystack = Array.isArray(within) ? within : [];
  const needles = Array.isArray(blocks) ? blocks : [];
  if (needles.length === 0) return false;
  const seen = new Set(haystack.map((block) => JSON.stringify(block)));
  return needles.every((block) => seen.has(JSON.stringify(block)));
}
