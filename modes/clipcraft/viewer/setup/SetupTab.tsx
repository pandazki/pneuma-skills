import { useCallback } from "react";
import { useSetupListing } from "./useSetupListing.js";
import { BibleSection } from "./BibleSection.js";
import { CardSection } from "./CardSection.js";
import { theme } from "../theme/tokens.js";

/**
 * Setup tab — surfaces the production-bible artifacts (bible /
 * cast / settings / storyboards) detected on disk by
 * `/api/setup/listing`. v1 is read-only; editing flows through the
 * agent or the user's external editor.
 *
 * Sections (Bible / Cast / Settings / Storyboards) collapse
 * independently. Empty-state copy doubles as agent-prompt
 * documentation — the user reads them and learns the methodology.
 */
export function SetupTab() {
  const { data, loading, error, refetch } = useSetupListing();

  const workspaceUrl = useCallback((p: string) => {
    // Splits on "/" then re-encodes each segment so that subdirectory
    // paths remain valid; matches the shape `useWorkspaceAssetUrl`
    // produces for the asset library.
    return `/content/${p.split("/").map(encodeURIComponent).join("/")}`;
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        background: theme.color.surface1,
        fontFamily: theme.font.ui,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: `${theme.space.space2}px ${theme.space.space3}px`,
          borderBottom: `1px solid ${theme.color.borderWeak}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={refetch}
          title="Refresh setup listing"
          style={{
            background: "transparent",
            border: "none",
            color: theme.color.ink4,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            cursor: "pointer",
            letterSpacing: theme.text.trackingBase,
            padding: `2px ${theme.space.space2}px`,
            textDecoration: "underline dotted",
            textUnderlineOffset: 3,
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: theme.space.space3,
            fontSize: theme.text.xs,
            color: theme.color.dangerInk,
          }}
        >
          Failed to load setup listing: {error}
        </div>
      )}

      <BibleSection bible={data?.bible ?? null} workspaceUrl={workspaceUrl} />
      <CardSection
        title="Cast"
        cards={data?.cast ?? []}
        workspaceUrl={workspaceUrl}
        emptyHint={
          <>
            <strong style={{ color: theme.color.ink1 }}>
              No character cards yet.
            </strong>{" "}
            Ask the agent: <em>“add a character card for [name]”</em>. A
            character card is the durable reference image + bible that every
            later shot prompt cites — the consistency engine for multi-shot
            work.
          </>
        }
      />
      <CardSection
        title="Settings"
        cards={data?.world ?? []}
        workspaceUrl={workspaceUrl}
        emptyHint={
          <>
            <strong style={{ color: theme.color.ink1 }}>
              No setting cards yet.
            </strong>{" "}
            Ask the agent: <em>“add a setting card for [location or signature
            prop]”</em>. Used when a location or prop should look identical
            across multiple shots.
          </>
        }
      />
      {/* StoryboardSection is wired in Task 7. */}
    </div>
  );
}
