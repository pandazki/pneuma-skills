/**
 * `<pneuma:env>` session-start dispatch — builds the chat-tag the server
 * injects as the first user-side message after the agent connects.
 *
 * The skill (`pneuma-project/SKILL.md`) teaches the agent how to read the
 * tag's `reason` attribute and adjust its first response. Four reasons:
 *
 *   - `opened`     — fresh start (mode card, "+ New session", launcher)
 *   - `switched`   — clicked a sibling session in ProjectPanel (no Smart Handoff)
 *   - `handed-off` — confirmed Smart Handoff (`inbound-handoff.json` present)
 *   - `borrow`     — spawned as a borrow target (`borrow-brief.json` present): a
 *                    bounded sub-task for a live host session A, with a return
 *                    obligation. Distinct from `handed-off` (which is terminal —
 *                    A is gone) so the skill can teach B to finish + call
 *                    `pneuma borrow-return` rather than treat the job as a takeover.
 *
 * Symmetric with the viewer's `<viewer-context>` — informational, not
 * directive; the agent decides what to do based on the user's next message.
 */

import type { InboundHandoffPayload } from "../server/skill-installer.js";

/**
 * Escape a string for inclusion as an XML attribute value. Project names
 * with quotes / `&` would otherwise break the surrounding tag — same rule
 * the cancel-tag dispatch uses on reason strings.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface EnvTagInput {
  /** Mode the new session is running in (always present). */
  mode: string;
  /** Project display name from the project manifest, when applicable. */
  projectName?: string;
  /** Inbound payload from `inbound-handoff.json`, if the session was a Smart Handoff target. */
  inbound?: InboundHandoffPayload | null;
  /**
   * Absolute path to `<sessionDir>/.pneuma/inbound-handoff.json` when the
   * session was a Smart Handoff target. Surfaces in the `handed-off` env tag
   * as `inbound_path` so the agent (and a debugging human) can locate the
   * raw JSON payload without having to derive it. The CLAUDE.md
   * `pneuma:handoff` block already carries the parsed content; this is a
   * pointer for callers that need the original.
   */
  inboundPath?: string;
  /**
   * Source-session identity from `--from-session-*` CLI flags — populated when
   * the session was spawned by clicking a sibling row in ProjectPanel. Empty
   * strings count as "not provided".
   */
  fromSessionId?: string;
  fromMode?: string;
  fromDisplayName?: string;
  /**
   * Borrow id when this session was spawned as a borrow target (the host A
   * dispatched `pneuma borrow`, the server staged a `borrow-brief.json`, and
   * `bin/pneuma.ts` threaded `--borrow <id>` into the child). Its presence
   * selects `reason="borrow"` — the most specific provenance — which wins over
   * the `inbound`/handed-off branch because a borrow brief is inbound-shaped
   * (it reuses the handoff payload vocabulary for the host's context) yet must
   * NOT be read as a terminal takeover. Empty / whitespace strings count as
   * "not a borrow" and fall through to the normal opened/switched/handed-off
   * resolution. Surfaced as the `borrow_id` attr so B's skill can wire the
   * `pneuma borrow-return` obligation without re-deriving it from disk.
   */
  borrowId?: string;
  /**
   * User's UI language preference (BCP-47 like "zh-CN", "ja", "en"). When
   * the user has explicitly picked a language in Pneuma's Language menu,
   * surface it to the agent so it can default replies, file names, and
   * generated copy to that language without the user having to repeat it
   * every turn. Omitted when no preference is set — the agent should keep
   * its own defaults rather than guess.
   */
  userLocale?: string;
}

/**
 * Build the env tag string. Prefers `inbound` (handoff path) over
 * `fromSession*` (switched path) over the bare `opened` path. Returns
 * `null` only if `mode` is missing — every session has a mode in practice.
 */
export function buildEnvTag(input: EnvTagInput): string | null {
  if (!input.mode) return null;

  const parts: string[] = [];
  const push = (key: string, value: string | undefined) => {
    if (value === undefined || value === null) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    parts.push(`${key}="${escapeXmlAttr(trimmed)}"`);
  };

  const borrowId = input.borrowId?.trim();
  if (borrowId) {
    // Borrow target: the most specific provenance. A borrow brief is
    // inbound-shaped, so `input.inbound` is typically also populated with the
    // host's context — we surface that `from_*` context here too, but under
    // `reason="borrow"` (not `handed-off`) plus the `borrow_id` the skill
    // needs for the return leg. The host-context fields fall back to the
    // bare `from*` flags when no inbound payload accompanies the borrow.
    push("reason", "borrow");
    push("project", input.projectName);
    push("mode", input.mode);
    push("borrow_id", borrowId);
    push("from_session", input.inbound?.source_session_id ?? input.fromSessionId);
    push("from_mode", input.inbound?.source_mode ?? input.fromMode);
    push("from_display_name", input.inbound?.source_display_name ?? input.fromDisplayName);
    push("language", input.inbound?.language);
  } else if (input.inbound && input.inbound.handoff_id) {
    push("reason", "handed-off");
    push("project", input.projectName);
    push("mode", input.mode);
    push("from_session", input.inbound.source_session_id);
    push("from_mode", input.inbound.source_mode);
    push("from_display_name", input.inbound.source_display_name);
    push("inbound_path", input.inboundPath);
    // Source-conversation language (when the handoff carries one). Distinct
    // from `user_locale` below: that's Pneuma's UI setting, this is the
    // language the user was speaking with the source agent. The handoff
    // section in CLAUDE.md tells the target agent to reply in this
    // language; surfacing the same hint inline in the env tag means agents
    // that don't bother with CLAUDE.md still see it.
    push("language", input.inbound.language);
  } else if (input.fromSessionId && input.fromSessionId.trim().length > 0) {
    push("reason", "switched");
    push("project", input.projectName);
    push("mode", input.mode);
    push("from_session", input.fromSessionId);
    push("from_mode", input.fromMode);
    push("from_display_name", input.fromDisplayName);
  } else {
    push("reason", "opened");
    push("project", input.projectName);
    push("mode", input.mode);
  }

  // User locale is appended regardless of `reason` — the agent's response
  // language is orthogonal to whether the session was opened, switched, or
  // handed off. Theme is intentionally left out: it's surfaced via
  // `PNEUMA_USER_THEME` for skills that want to act on it, but doesn't
  // belong in the agent's first-turn context.
  push("user_locale", input.userLocale);

  return `<pneuma:env ${parts.join(" ")} />`;
}
