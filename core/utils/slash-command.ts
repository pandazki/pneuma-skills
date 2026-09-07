/**
 * A user message that IS a slash command: `/name`, optionally followed by
 * arguments.
 *
 * Every backend resolves commands by the first characters of the message —
 * Claude Code expands `<cwd>/.claude/commands/*.md`, the Codex adapter
 * translates `/compact` into `thread/compact/start`, Kimi answers its ACP
 * command list — so a command has to travel verbatim. Anything the runtime
 * would normally staple to the front of a user turn (`<viewer-context>`,
 * `<user-actions>`, queued `<pneuma:env>` tags) is held back for the next
 * ordinary message instead: it is context for the model, and a command turn
 * never reaches the model as prose. A `/compact` typed as the first message
 * after opening a session used to arrive as `<pneuma:env …/>\n/compact` and
 * was answered by the model as a question about its context.
 *
 * `/Users/me/notes.md` is not a command: the name may not contain another
 * slash and must end at whitespace or the end of the message.
 */
export const SLASH_COMMAND_PATTERN = /^\s*\/[A-Za-z][\w:-]*(?=\s|$)/;

export function isSlashCommandMessage(content: string): boolean {
  return SLASH_COMMAND_PATTERN.test(content);
}
