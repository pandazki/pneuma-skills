import { useState, type ReactNode } from "react";
import { theme } from "../theme/tokens.js";
import type { CardEntry } from "./useSetupListing.js";
import { SectionShell, EmptyHint } from "./BibleSection.js";
import { CardLightbox } from "./CardLightbox.js";

/**
 * CardSection — generic renderer used for both Cast and Settings.
 * Lays out 80×80 thumbnail tiles in a flex-wrap grid, with the card
 * name labeled below. Click a tile → opens `CardLightbox` for the
 * full reference image + bible markdown, plus a "Used by N clips"
 * counter pulled from the provenance graph.
 *
 * Empty state shows the spec's exact agent-prompt copy — those
 * strings double as user-facing methodology documentation.
 */

interface Props {
  title: "Cast" | "Settings";
  emptyHint: ReactNode;
  cards: CardEntry[];
  workspaceUrl: (p: string) => string;
}

export function CardSection({ title, emptyHint, cards, workspaceUrl }: Props) {
  const [active, setActive] = useState<CardEntry | null>(null);
  const count = cards.length;

  return (
    <>
      <SectionShell title={`${title} (${count})`} defaultOpen>
        {count === 0 ? (
          <EmptyHint>{emptyHint}</EmptyHint>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: theme.space.space2,
              padding: theme.space.space3,
            }}
          >
            {cards.map((card) => (
              <CardTile
                key={card.mdPath}
                card={card}
                workspaceUrl={workspaceUrl}
                onOpen={() => setActive(card)}
              />
            ))}
          </div>
        )}
      </SectionShell>

      {active && (
        <CardLightbox
          card={active}
          kind={title === "Cast" ? "character" : "setting"}
          workspaceUrl={workspaceUrl}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

function CardTile({
  card,
  workspaceUrl,
  onOpen,
}: {
  card: CardEntry;
  workspaceUrl: (p: string) => string;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const url = card.imagePath
    ? `${workspaceUrl(card.imagePath)}?v=${card.mtime}`
    : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={card.name}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.space.space1,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        width: 80,
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
          background: theme.color.surface2,
          border: hover
            ? `1px solid ${theme.color.accentBorder}`
            : `1px solid ${theme.color.borderWeak}`,
          boxShadow: hover ? theme.elevation.s1 : "none",
          transition: `border-color ${theme.duration.quick}ms ${theme.easing.out}, box-shadow ${theme.duration.quick}ms ${theme.easing.out}`,
        }}
      >
        {url ? (
          <img
            src={url}
            alt={card.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: theme.font.display,
              fontSize: theme.text.lg,
              fontWeight: theme.text.weightSemibold,
              color: theme.color.ink3,
              letterSpacing: theme.text.trackingTight,
              textTransform: "uppercase",
              background: `linear-gradient(135deg, ${theme.color.surface2}, ${theme.color.surface3})`,
            }}
          >
            {card.name.slice(0, 2)}
          </div>
        )}
      </div>
      <span
        style={{
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          color: hover ? theme.color.ink1 : theme.color.ink2,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          maxWidth: 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          transition: `color ${theme.duration.quick}ms ${theme.easing.out}`,
        }}
      >
        {card.name}
      </span>
    </button>
  );
}
