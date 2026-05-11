import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { theme } from "../theme/tokens.js";
import type { BibleEntry } from "./useSetupListing.js";

/**
 * BibleSection — read-only markdown rendering of `setup/bible.md`.
 *
 * The bible is the agent's primary writing surface for tone / palette
 * / camera grammar / casting / locations; the user reads it here and
 * edits via the agent or external editor (no inline editing in v1).
 */

interface Props {
  bible: BibleEntry | null;
  /** Maps a workspace-relative path to a fetchable URL — the server's
   *  `/content/<path>` static-file route. */
  workspaceUrl: (path: string) => string;
}

export function BibleSection({ bible, workspaceUrl }: Props) {
  const [body, setBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bible) {
      setBody("");
      setError(null);
      return;
    }
    let cancelled = false;
    // mtime included as a cache-buster so an agent edit shows up after refetch.
    const url = `${workspaceUrl(bible.path)}?v=${bible.mtime}`;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`)))
      .then((t) => {
        if (!cancelled) {
          setBody(t);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bible, workspaceUrl]);

  if (!bible) {
    return (
      <SectionShell title="Project Bible (0)" defaultOpen>
        <EmptyHint>
          <strong style={{ color: theme.color.ink1 }}>No project bible yet.</strong>{" "}
          Ask the agent: <em>“set up the project bible”</em>. The bible is where
          you lock the project's tone, palette, camera grammar, casting, and
          locations before any image generates.
        </EmptyHint>
      </SectionShell>
    );
  }
  return (
    <SectionShell title="Project Bible (1)" defaultOpen>
      {error ? (
        <div
          style={{
            padding: theme.space.space3,
            fontSize: theme.text.xs,
            color: theme.color.dangerInk,
          }}
        >
          Failed to load: {error}
        </div>
      ) : (
        <div
          style={{
            padding: theme.space.space3,
            fontSize: theme.text.xs,
            lineHeight: theme.text.lineHeightBody,
            color: theme.color.ink1,
            fontFamily: theme.font.ui,
          }}
          className="setup-tab-markdown"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
    </SectionShell>
  );
}

// SectionShell is a small disclosure-wrapper used by all four sections.
// Inlined for now (per plan) — extract to a helper later if duplicated.
export function SectionShell({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div
      style={{
        borderBottom: `1px solid ${theme.color.borderWeak}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${theme.space.space2}px ${theme.space.space3}px`,
          background: "transparent",
          border: "none",
          color: open ? theme.color.ink1 : theme.color.ink2,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          cursor: "pointer",
          transition: `color ${theme.duration.quick}ms ${theme.easing.out}`,
        }}
      >
        <span>{title}</span>
        <span
          aria-hidden
          style={{
            color: theme.color.ink4,
            fontSize: theme.text.xs,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: `transform ${theme.duration.quick}ms ${theme.easing.out}`,
            display: "inline-block",
            width: 10,
            textAlign: "center",
          }}
        >
          ▸
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: `${theme.space.space2}px ${theme.space.space3}px ${theme.space.space3}px`,
        fontSize: theme.text.xs,
        lineHeight: theme.text.lineHeightSnug,
        color: theme.color.ink3,
      }}
    >
      {children}
    </div>
  );
}
