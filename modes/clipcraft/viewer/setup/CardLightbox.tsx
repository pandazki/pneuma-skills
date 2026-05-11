import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { theme } from "../theme/tokens.js";
import { XIcon } from "../icons/index.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import type { CardEntry } from "./useSetupListing.js";

/**
 * CardLightbox — full-screen detail view of a character or setting
 * card. Two-column layout: reference image on the left, bible
 * markdown on the right. Below the right column we surface "Used by
 * N clips" — counted from provenance edges whose
 * `operation.params.image_urls` (or `imageUrls`) reference this
 * card's image.
 *
 * Reuses the AssetLightbox shell shape (overlay + close button +
 * grid layout) so it visually anchors the same as opening any
 * asset in the library.
 */

interface Props {
  card: CardEntry;
  kind: "character" | "setting";
  workspaceUrl: (p: string) => string;
  onClose: () => void;
}

export function CardLightbox({ card, kind, workspaceUrl, onClose }: Props) {
  const [body, setBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Escape-to-close, matching AssetLightbox.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus-trap on the inner modal so Tab keys cycle within the dialog
  // instead of leaking out to the underlying chat / timeline.
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  // Fetch the markdown body. mtime is included as a cache-buster.
  useEffect(() => {
    let cancelled = false;
    const url = `${workspaceUrl(card.mdPath)}?v=${card.mtime}`;
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
  }, [card.mdPath, card.mtime, workspaceUrl]);

  const promptPath = derivePromptPath(card);
  const [hasPromptFile, setHasPromptFile] = useState(false);
  useEffect(() => {
    if (!promptPath) {
      setHasPromptFile(false);
      return;
    }
    let cancelled = false;
    // HEAD request so we don't pay for the body. Server treats
    // missing files as 404 from the same /content/* route.
    fetch(workspaceUrl(promptPath), { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setHasPromptFile(r.ok);
      })
      .catch(() => {
        if (!cancelled) setHasPromptFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [promptPath, workspaceUrl]);

  // Count clips that reference this card's image via provenance edges.
  // We accept both snake_case (`image_urls`) and camelCase (`imageUrls`)
  // variants because different callers in the codebase have used both.
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const usageCount = useMemo(() => {
    if (!card.imagePath) return 0;
    const candidates = new Set<string>();
    candidates.add(card.imagePath);
    candidates.add(`/${card.imagePath}`);
    let count = 0;
    for (const edge of coreState.provenance.edges.values()) {
      const params = (edge.operation as any)?.params;
      if (!params || typeof params !== "object") continue;
      const urls: unknown =
        (params.image_urls as unknown) ?? (params.imageUrls as unknown);
      if (!Array.isArray(urls)) continue;
      const matched = urls.some(
        (u) => typeof u === "string" && candidates.has(u),
      );
      if (matched) count += 1;
    }
    return count;
  }, [card.imagePath, coreState.provenance.edges]);

  const imageUrl = card.imagePath
    ? `${workspaceUrl(card.imagePath)}?v=${card.mtime}`
    : null;

  const titleLabel = kind === "character" ? "Character Card" : "Setting Card";

  return (
    <div
      ref={modalRef}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "oklch(0% 0 0 / 0.8)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.font.ui,
        padding: theme.space.space5,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="close"
        title="Close (Esc)"
        style={{
          position: "absolute",
          top: theme.space.space4,
          right: theme.space.space4,
          width: 32,
          height: 32,
          borderRadius: theme.radius.pill,
          background: theme.color.surface2,
          border: `1px solid ${theme.color.border}`,
          color: theme.color.ink1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 1,
        }}
      >
        <XIcon size={14} />
      </button>

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${titleLabel}: ${card.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: theme.space.space5,
          width: "min(1400px, 96vw)",
          maxHeight: "86vh",
          background: theme.color.surface1,
          border: `1px solid ${theme.color.borderStrong}`,
          borderRadius: theme.radius.lg,
          boxShadow: theme.elevation.s3,
          overflow: "hidden",
        }}
      >
        {/* Left: reference image */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 0,
            minHeight: 0,
            padding: theme.space.space5,
            background: theme.color.surface0,
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={card.name}
              style={{
                maxWidth: "100%",
                maxHeight: "76vh",
                objectFit: "contain",
                borderRadius: theme.radius.sm,
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                maxHeight: "76vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: theme.font.display,
                fontSize: theme.text.xl,
                color: theme.color.ink3,
                background: `linear-gradient(135deg, ${theme.color.surface2}, ${theme.color.surface3})`,
                borderRadius: theme.radius.sm,
                textTransform: "uppercase",
                letterSpacing: theme.text.trackingCaps,
              }}
            >
              No reference image
            </div>
          )}
        </div>

        {/* Right: markdown + meta */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            padding: theme.space.space5,
            borderLeft: `1px solid ${theme.color.borderWeak}`,
            background: theme.color.surface1,
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              marginBottom: theme.space.space1,
            }}
          >
            {titleLabel}
          </div>
          <div
            style={{
              fontSize: theme.text.lg,
              fontWeight: theme.text.weightSemibold,
              color: theme.color.ink0,
              letterSpacing: theme.text.trackingTight,
              marginBottom: theme.space.space1,
              textTransform: "uppercase",
            }}
          >
            {card.name}
          </div>
          <div
            style={{
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              marginBottom: theme.space.space4,
            }}
          >
            {card.mdPath}
          </div>

          <div
            style={{
              fontSize: theme.text.sm,
              lineHeight: theme.text.lineHeightBody,
              color: theme.color.ink1,
              flex: 1,
            }}
            className="setup-tab-markdown"
          >
            {error ? (
              <div style={{ color: theme.color.dangerInk }}>
                Failed to load: {error}
              </div>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {body}
              </ReactMarkdown>
            )}
          </div>

          <div
            style={{
              marginTop: theme.space.space4,
              paddingTop: theme.space.space3,
              borderTop: `1px solid ${theme.color.borderWeak}`,
              display: "flex",
              flexDirection: "column",
              gap: theme.space.space2,
              fontSize: theme.text.xs,
              color: theme.color.ink3,
            }}
          >
            <span>
              {usageCount === 0
                ? "Not yet referenced by any generation."
                : `Used by ${usageCount} clip${usageCount === 1 ? "" : "s"}.`}
            </span>
            {hasPromptFile && promptPath && (
              <a
                href={workspaceUrl(promptPath)}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: theme.color.accentBright,
                  textDecoration: "underline dotted",
                  textUnderlineOffset: 3,
                }}
              >
                Open prompt file
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Derive the prompt-file path for a card. Both layouts are accepted:
 *   flat:    setup/cast/kira.md          → setup/cast/kira.prompt.md
 *   nested:  setup/cast/anya/card.md     → setup/cast/anya/prompt.md
 * Returns null if the path doesn't fit either pattern.
 */
function derivePromptPath(card: CardEntry): string | null {
  if (card.mdPath.endsWith("/card.md")) {
    return card.mdPath.replace(/\/card\.md$/, "/prompt.md");
  }
  if (card.mdPath.endsWith(".md")) {
    return card.mdPath.replace(/\.md$/, ".prompt.md");
  }
  return null;
}
