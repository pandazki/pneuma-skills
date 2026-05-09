import { useSetupListing } from "./useSetupListing.js";
import { theme } from "../theme/tokens.js";

/**
 * Setup tab — surfaces the production-bible artifacts (bible /
 * cast / settings / storyboards) detected on disk by
 * `/api/setup/listing`. v1 is read-only; editing flows through the
 * agent or the user's external editor.
 *
 * This is the bare-bones shell — Bible / Cast / Settings / Storyboards
 * sections are wired up in subsequent tasks.
 */
export function SetupTab() {
  const { data, loading, error } = useSetupListing();

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
          padding: theme.space.space3,
          fontSize: theme.text.xs,
          color: theme.color.ink3,
          letterSpacing: theme.text.trackingBase,
        }}
      >
        Setup tab placeholder. Bible: {data?.bible ? "present" : "none"}.
        Cast: {data?.cast.length ?? 0}. Settings: {data?.world.length ?? 0}.
        Storyboards: {data?.storyboards.length ?? 0}.
      </div>
      {error && (
        <div
          style={{
            padding: theme.space.space3,
            fontSize: theme.text.xs,
            color: theme.color.dangerInk,
          }}
        >
          Error: {error}
        </div>
      )}
      {loading && (
        <div
          style={{
            padding: theme.space.space3,
            fontSize: theme.text.xs,
            color: theme.color.ink4,
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}
