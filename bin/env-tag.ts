/**
 * `<pneuma:env>` session-start dispatch — builds the chat-tag the server
 * injects as the first user-side message after the agent connects.
 *
 * The skill (`pneuma-project/SKILL.md`) teaches the agent how to read the
 * tag's `reason` attribute and adjust its first response. Three reasons:
 *
 *   - `opened`     — fresh start (mode card, "+ New session", launcher)
 *   - `switched`   — clicked a sibling session in ProjectPanel (no Smart Handoff)
 *   - `handed-off` — confirmed Smart Handoff (`inbound-handoff.json` present)
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
   * Source-session identity from `--from-session-*` CLI flags — populated when
   * the session was spawned by clicking a sibling row in ProjectPanel. Empty
   * strings count as "not provided".
   */
  fromSessionId?: string;
  fromMode?: string;
  fromDisplayName?: string;
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

  if (input.inbound && input.inbound.handoff_id) {
    push("reason", "handed-off");
    push("project", input.projectName);
    push("mode", input.mode);
    push("from_session", input.inbound.source_session_id);
    push("from_mode", input.inbound.source_mode);
    push("from_display_name", input.inbound.source_display_name);
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

  return `<pneuma:env ${parts.join(" ")} />`;
}
