/**
 * PneumaSignalPill — chat-side rendering for `<pneuma:*>` system signal tags.
 *
 * The agent receives synthetic user messages like
 * `<pneuma:env reason="opened" project="Pneuma Demo Project" mode="kami" />`
 * to communicate user-behavior signals (opened a session, switched from a
 * sibling, requested handoff, cancelled handoff). These tags are
 * meaningful TO the agent but visually noisy IN chat — a verbose XML blob
 * sitting in a user bubble breaks the conversation flow.
 *
 * This component detects pneuma tags and renders them as a centered
 * horizontal-divider marker (matching the existing `session_event` style),
 * with a brief plain-language summary. Debug mode (`--debug` flag) expands
 * the marker to show the raw tag below for inspection.
 *
 * Tags handled:
 *   - <pneuma:env reason="opened|switched|handed-off" ... />
 *   - <pneuma:request-handoff target="..." intent="..." ... />
 *   - <pneuma:handoff-cancelled reason="..." />
 */
import { useState } from "react";
import { useStore } from "../store/index.js";

interface ParsedPneumaTag {
  raw: string;
  /** Tag name without the `pneuma:` prefix (e.g. "env", "request-handoff"). */
  kind: string;
  attrs: Record<string, string>;
}

/**
 * Parse a self-closing pneuma XML tag. Returns null if the content isn't
 * a pure pneuma tag (mixed content, whitespace-padded text, multi-tag, etc.
 * — those keep the regular chat-bubble rendering).
 */
export function parsePneumaTag(content: string): ParsedPneumaTag | null {
  const trimmed = content.trim();
  // Must be a single self-closing tag with namespace `pneuma:`. Anything else
  // (text + tag, multiple tags, opening-only tag) we leave as plain content.
  const match = trimmed.match(/^<pneuma:([a-z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*\/>$/i);
  if (!match) return null;
  const kind = match[1];
  const attrPart = match[2] ?? "";
  const attrs: Record<string, string> = {};
  for (const m of attrPart.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return { raw: trimmed, kind, attrs };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Build the human-readable summary for a parsed pneuma tag. Each branch
 * stays one short sentence — the marker is informational chrome, not a
 * notification body.
 */
function summarize(tag: ParsedPneumaTag): string {
  const a = tag.attrs;
  if (tag.kind === "env") {
    const project = a.project;
    const mode = a.mode;
    if (a.reason === "opened") {
      return project
        ? `Opened a fresh ${mode ?? "session"} session in ${project}`
        : `Opened a fresh ${mode ?? "session"} session`;
    }
    if (a.reason === "switched") {
      const from = a.from_display_name || a.from_session?.slice(0, 8) || "another session";
      const fromMode = a.from_mode ? ` (${a.from_mode})` : "";
      return `Switched here from ${from}${fromMode}`;
    }
    if (a.reason === "handed-off") {
      const fromMode = a.from_mode ?? "another mode";
      return `Handed off from ${fromMode}`;
    }
    return `Environment signal: ${a.reason ?? "unknown"}`;
  }
  if (tag.kind === "request-handoff") {
    const target = a.target ?? "another mode";
    return `Requesting handoff to ${target}${a.intent ? ` — ${a.intent}` : ""}`;
  }
  if (tag.kind === "handoff-cancelled") {
    return a.reason ? `Handoff cancelled — ${a.reason}` : "Handoff cancelled";
  }
  return `Pneuma signal: ${tag.kind}`;
}

export function PneumaSignalPill({ tag }: { tag: ParsedPneumaTag }) {
  const debug = useStore((s) => s.debugMode);
  const [expanded, setExpanded] = useState(false);
  const showRaw = debug || expanded;
  const label = summarize(tag);
  return (
    <div className="py-1">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-cc-border" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={debug ? "Pneuma signal (debug always on)" : expanded ? "Hide raw tag" : "Show raw tag"}
          className="text-[11px] text-cc-muted/80 italic shrink-0 px-1 hover:text-cc-fg transition-colors cursor-pointer inline-flex items-center gap-1.5"
        >
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-cc-primary/60" />
          {label}
        </button>
        <div className="flex-1 h-px bg-cc-border" />
      </div>
      {showRaw ? (
        <div className="mx-auto mt-1.5 max-w-[80%] text-[10px] font-mono-code text-cc-muted/60 px-2 break-all text-center">
          {tag.raw}
        </div>
      ) : null}
    </div>
  );
}
