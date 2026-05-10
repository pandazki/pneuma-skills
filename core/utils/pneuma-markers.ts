/**
 * Shared helper for the resume-induced-duplicate dedup paths in the chat
 * pipeline (server/ws-bridge.ts messageHistory, src/store/chat-slice.ts
 * appendMessage, src/ws.ts message_history replay).
 *
 * "Pneuma marker only" means the trimmed user message is *exactly* one
 * pneuma envelope (`<pneuma:env reason="opened" />`,
 * `<pneuma:askq-answer>…</pneuma:askq-answer>`, etc.) with no real user
 * input mixed in. Such messages are auto-redispatched on every session
 * reopen and must not block the resume-dedup walk-back over assistant
 * duplicates.
 *
 * Earlier copies of this check used
 *   /^<pneuma:[a-z-]+\b[^>]*>[\s\S]*<\/pneuma:[a-z-]+>$/i
 * which is greedy and unanchored on the closing tag-name. A user message
 * like `<pneuma:env … />\nplease continue\n<pneuma:askq-answer>…</…>`
 * matched as one big "marker", so the real input in the middle was
 * silently classified as non-meaningful and the dedup proceeded —
 * potentially overwriting legitimate distinct assistant turns.
 *
 * This helper is the single source of truth. Three call sites import it
 * so the regex stays consistent across the server and browser bundles.
 */
export function isPneumaMarkerOnly(text: string): boolean {
  if (typeof text !== "string") return false;
  const s = text.trim();
  if (s.length === 0) return false;
  // Self-closing: `<pneuma:foo … />` with nothing after the `/>`. The
  // `[^>]*` excludes `>`, so attribute values containing `>` are not
  // supported (matches the prior regex behavior — none of Pneuma's
  // emitted tags contain `>` inside attribute values).
  if (/^<pneuma:[a-z-]+\b[^>]*\/>$/i.test(s)) return true;
  // Paired: open + body + close, where:
  //   - the close tag's name backreferences the open tag's name (so
  //     `<pneuma:foo>…</pneuma:bar>` is rejected), and
  //   - the body cannot contain `</pneuma:` (so two adjacent markers
  //     `<pneuma:env>…</pneuma:env>foo<pneuma:env>…</pneuma:env>` cannot
  //     be matched as a single "marker" by the regex's greedy backtrack).
  return /^<pneuma:([a-z-]+)\b[^>]*>(?:(?!<\/pneuma:).)*<\/pneuma:\1>$/is.test(s);
}
